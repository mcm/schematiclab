// Build language lengths and positions (Cairn `SPEC.md` section 2, "Lengths
// and positions"). A length is parsed once into a `Length` and resolved
// against a parent size later. Worker-safe.

export type Length =
  /** A whole number of blocks. Negative only as a position (from the far end). */
  | { kind: "blocks"; value: number }
  /** Percentage of the parent's size on that axis. */
  | { kind: "percent"; value: number }
  /** `"~"` (weight 1) or `"~N"`: the rest of the parent, shared by weight. */
  | { kind: "rest"; weight: number }
  /** `"center"`, `"start"` or `"end"`: align the child within the parent. */
  | { kind: "align"; align: LengthAlign };

export type LengthAlign = "center" | "start" | "end";

/**
 * Where a length is written, which decides the forms it may take:
 * - `position`: integers (negative from the far end), `"N%"`, `"center"`/`"start"`/`"end"`
 * - `size`: non-negative integers, `"N%"`, `"~"`
 * - `part` (split part sizes): non-negative integers, `"N%"`, `"~"`, weighted `"~N"`
 */
export type LengthContext = "position" | "size" | "part";

export type LengthParseResult =
  | { ok: true; length: Length }
  | { ok: false; error: string };

const ALIGN_WORDS: Record<string, LengthAlign> = {
  center: "center",
  centre: "center",
  middle: "center",
  start: "start",
  min: "start",
  end: "end",
  max: "end",
};

const REST_WORDS = new Set(["~", "rest", "fill"]);
const PERCENT = /^(-?\d+(?:\.\d+)?)%$/;
const WEIGHT = /^~(\d+(?:\.\d+)?)$/;

function describe(spec: unknown): string {
  return typeof spec === "string" ? `"${spec}"` : JSON.stringify(spec);
}

function expected(context: LengthContext): string {
  switch (context) {
    case "position":
      return 'an integer (negative counts from the far end), "N%", "center", "start" or "end"';
    case "size":
      return 'a non-negative integer, "N%" or "~"';
    case "part":
      return 'a non-negative integer, "N%", "~" or a weighted "~N"';
  }
}

export function parseLength(
  spec: unknown,
  context: LengthContext,
): LengthParseResult {
  const fail = (): LengthParseResult => ({
    ok: false,
    error: `invalid ${context === "position" ? "position" : "size"} ${describe(spec)} (use ${expected(context)})`,
  });
  const negative = (): LengthParseResult => ({
    ok: false,
    error: `${context === "part" ? "part size" : "size"} ${describe(spec)} must not be negative`,
  });

  if (typeof spec === "number") {
    if (!Number.isInteger(spec)) {
      return {
        ok: false,
        error: `${describe(spec)} is not a whole number of blocks`,
      };
    }
    if (spec < 0 && context !== "position") return negative();
    return { ok: true, length: { kind: "blocks", value: spec } };
  }
  if (typeof spec !== "string") return fail();

  const s = spec.trim();
  const percent = PERCENT.exec(s);
  if (percent) {
    const value = Number(percent[1]);
    if (value < 0 && context !== "position") return negative();
    return { ok: true, length: { kind: "percent", value } };
  }
  if (context === "position") {
    const align = ALIGN_WORDS[s];
    return align ? { ok: true, length: { kind: "align", align } } : fail();
  }
  if (REST_WORDS.has(s)) {
    return { ok: true, length: { kind: "rest", weight: 1 } };
  }
  const weight = WEIGHT.exec(s);
  if (weight) {
    if (context !== "part") {
      return {
        ok: false,
        error: `weighted size ${describe(spec)} is only allowed for split parts; use "~"`,
      };
    }
    const value = Number(weight[1]);
    if (value <= 0) {
      return {
        ok: false,
        error: `weight in ${describe(spec)} must be positive`,
      };
    }
    return { ok: true, length: { kind: "rest", weight: value } };
  }
  return fail();
}

/** Python's `round()`: halves go to the even neighbour. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function percentOf(value: number, total: number): number {
  return roundHalfEven((total * value) / 100);
}

/**
 * Resolves a size against the parent's size `total` on that axis. `rest` is
 * what `"~"` means here (for a box, the parent after `at`). Weighted rest
 * lengths only make sense together, so use `splitSizes` for those.
 */
export function resolveSize(
  length: Length,
  total: number,
  rest: number,
): number {
  switch (length.kind) {
    case "blocks":
      return length.value;
    case "percent":
      return percentOf(length.value, total);
    case "rest":
      return rest;
    case "align":
      throw new Error("an alignment is a position, not a size");
  }
}

/**
 * Resolves a position against the parent's size `total`, for a child `size`
 * blocks long on that axis. Negative positions count from the far end
 * (`-1` is the last block).
 */
export function resolvePosition(
  length: Length,
  total: number,
  size: number,
): number {
  switch (length.kind) {
    case "align":
      if (length.align === "center") return Math.floor((total - size) / 2);
      return length.align === "end" ? total - size : 0;
    case "blocks":
    case "percent": {
      const p =
        length.kind === "blocks"
          ? length.value
          : percentOf(length.value, total);
      return p < 0 ? total + p : p;
    }
    case "rest":
      throw new Error("a rest length is a size, not a position");
  }
}

export interface SplitSizes {
  sizes: number[];
  /** Blocks the fixed sizes asked for beyond `total`; trailing parts were cut. */
  overflow: number;
}

/**
 * Sizes of consecutive parts sharing `total` blocks (CGA split). Fixed and
 * percentage parts come first; rest parts share what is left by weight, the
 * leftover blocks of the rounding going to the parts with the largest
 * fractions. Parts that don't fit are cut from the end.
 */
export function splitSizes(
  lengths: readonly Length[],
  total: number,
): SplitSizes {
  const fixed = lengths.map((length) =>
    length.kind === "rest" ? null : resolveSize(length, total, 0),
  );
  const used = fixed.reduce<number>((sum, size) => sum + (size ?? 0), 0);
  const overflow = Math.max(0, used - total);
  const remain = Math.max(0, total - used);
  const sizes = fixed.map((size) => size ?? 0);

  const weighted = lengths.flatMap((length, index) =>
    length.kind === "rest" ? [{ index, weight: length.weight }] : [],
  );
  if (weighted.length > 0) {
    const weightSum = weighted.reduce((sum, w) => sum + w.weight, 0);
    const raw = weighted.map((w) => ({
      index: w.index,
      share: (remain * w.weight) / weightSum,
    }));
    let left = remain;
    for (const r of raw) {
      sizes[r.index] = Math.floor(r.share);
      left -= sizes[r.index];
    }
    // Stable sort: equal fractions keep program order.
    const byFraction = [...raw].sort(
      (a, b) => b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)),
    );
    for (const r of byFraction.slice(0, left)) sizes[r.index] += 1;
  }

  let acc = 0;
  const clipped = sizes.map((size) => {
    const s = Math.max(0, Math.min(size, total - acc));
    acc += s;
    return s;
  });
  return { sizes: clipped, overflow };
}
