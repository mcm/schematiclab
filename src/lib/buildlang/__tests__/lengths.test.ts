import { describe, expect, it } from "vitest";

import {
  parseLength,
  resolvePosition,
  resolveSize,
  roundHalfEven,
  splitSizes,
  type Length,
  type LengthContext,
} from "../lengths";

function parse(spec: unknown, context: LengthContext): Length {
  const result = parseLength(spec, context);
  if (!result.ok) throw new Error(result.error);
  return result.length;
}

function parseError(spec: unknown, context: LengthContext): string {
  const result = parseLength(spec, context);
  if (result.ok) throw new Error(`${JSON.stringify(spec)} parsed`);
  return result.error;
}

describe("parseLength", () => {
  it("parses integers", () => {
    expect(parse(5, "size")).toEqual({ kind: "blocks", value: 5 });
    expect(parse(0, "part")).toEqual({ kind: "blocks", value: 0 });
    expect(parse(3, "position")).toEqual({ kind: "blocks", value: 3 });
  });

  it("allows negative integers only as positions", () => {
    expect(parse(-3, "position")).toEqual({ kind: "blocks", value: -3 });
    expect(parseError(-3, "size")).toMatch(/must not be negative/);
    expect(parseError(-1, "part")).toMatch(/must not be negative/);
  });

  it("rejects fractional numbers", () => {
    expect(parseError(2.5, "size")).toMatch(/not a whole number/);
  });

  it("parses percentages", () => {
    expect(parse("50%", "size")).toEqual({ kind: "percent", value: 50 });
    expect(parse(" 33.5% ", "part")).toEqual({ kind: "percent", value: 33.5 });
    expect(parse("-10%", "position")).toEqual({ kind: "percent", value: -10 });
    expect(parseError("-10%", "size")).toMatch(/must not be negative/);
    expect(parseError("1e2%", "size")).toMatch(/invalid size/);
    expect(parseError("%", "size")).toMatch(/invalid size/);
    expect(parseError(`${"9".repeat(400)}%`, "size")).toMatch(/is too big/);
  });

  it("parses the rest of the parent", () => {
    expect(parse("~", "size")).toEqual({ kind: "rest", weight: 1 });
    expect(parse("~", "part")).toEqual({ kind: "rest", weight: 1 });
    expect(parse("rest", "size")).toEqual({ kind: "rest", weight: 1 });
    expect(parseError("~", "position")).toMatch(/invalid position/);
  });

  it("parses weighted rests in split parts only", () => {
    expect(parse("~2", "part")).toEqual({ kind: "rest", weight: 2 });
    expect(parse("~0.5", "part")).toEqual({ kind: "rest", weight: 0.5 });
    expect(parseError(`~${"9".repeat(400)}`, "part")).toMatch(/is too big/);
    expect(parseError("~2", "size")).toMatch(/only allowed for split parts/);
    expect(parseError("~0", "part")).toMatch(/must be positive/);
    expect(parseError("~x", "part")).toMatch(/invalid size/);
  });

  it("parses alignments as positions only", () => {
    expect(parse("center", "position")).toEqual({
      kind: "align",
      align: "center",
    });
    expect(parse("start", "position")).toEqual({
      kind: "align",
      align: "start",
    });
    expect(parse("end", "position")).toEqual({ kind: "align", align: "end" });
    expect(parse("centre", "position")).toEqual({
      kind: "align",
      align: "center",
    });
    expect(parseError("center", "size")).toMatch(/invalid size/);
  });

  it("rejects other values with the forms it accepts", () => {
    expect(parseError("left", "position")).toBe(
      'invalid position "left" (use an integer (negative counts from the far end), "N%", "center", "start" or "end")',
    );
    expect(parseError(true, "size")).toMatch(/invalid size true/);
    expect(parseError(null, "part")).toMatch(/invalid size null/);
    expect(parseError([1], "size")).toMatch(/invalid size \[1\]/);
  });
});

describe("roundHalfEven", () => {
  it("rounds halves like Python", () => {
    expect([0.5, 1.5, 2.5, 3.4, 3.6, -2.5].map(roundHalfEven)).toEqual([
      0, 2, 2, 3, 4, -2,
    ]);
  });
});

describe("resolveSize", () => {
  it("resolves blocks, percentages and the rest", () => {
    expect(resolveSize(parse(4, "size"), 10, 7)).toBe(4);
    expect(resolveSize(parse("50%", "size"), 9, 0)).toBe(4);
    expect(resolveSize(parse("100%", "size"), 13, 0)).toBe(13);
    expect(resolveSize(parse("~", "size"), 10, 7)).toBe(7);
  });

  it("refuses alignments", () => {
    expect(() => resolveSize({ kind: "align", align: "end" }, 10, 0)).toThrow();
  });
});

describe("resolvePosition", () => {
  it("counts negative positions from the far end", () => {
    expect(resolvePosition(parse(-1, "position"), 10, 1)).toBe(9);
    expect(resolvePosition(parse(-3, "position"), 10, 1)).toBe(7);
    expect(resolvePosition(parse(2, "position"), 10, 1)).toBe(2);
  });

  it("resolves percentages", () => {
    expect(resolvePosition(parse("50%", "position"), 10, 1)).toBe(5);
    expect(resolvePosition(parse("-20%", "position"), 10, 1)).toBe(8);
  });

  it("aligns the child within the parent", () => {
    expect(resolvePosition(parse("center", "position"), 9, 1)).toBe(4);
    expect(resolvePosition(parse("center", "position"), 10, 3)).toBe(3);
    expect(resolvePosition(parse("start", "position"), 10, 3)).toBe(0);
    expect(resolvePosition(parse("end", "position"), 10, 3)).toBe(7);
  });

  it("refuses rest lengths", () => {
    expect(() => resolvePosition({ kind: "rest", weight: 1 }, 10, 1)).toThrow();
  });
});

describe("splitSizes", () => {
  const parts = (...specs: unknown[]) => specs.map((s) => parse(s, "part"));

  it("shares the rest by weight", () => {
    expect(splitSizes(parts(2, "~2", "~"), 11)).toEqual({
      sizes: [2, 6, 3],
      overflow: 0,
    });
  });

  it("gives leftover blocks to the largest fractions, in order", () => {
    expect(splitSizes(parts("~", "~", "~"), 10).sizes).toEqual([4, 3, 3]);
    expect(splitSizes(parts("~", "~2"), 4).sizes).toEqual([1, 3]);
  });

  it("mixes percentages and fixed sizes", () => {
    expect(splitSizes(parts("25%", 1, "~"), 12).sizes).toEqual([3, 1, 8]);
  });

  it("reserves nothing for rest parts when fixed parts fill the space", () => {
    expect(splitSizes(parts(5, "~", 5), 10).sizes).toEqual([5, 0, 5]);
  });

  it("cuts trailing parts and reports the overflow", () => {
    expect(splitSizes(parts(4, 4, 4), 10)).toEqual({
      sizes: [4, 4, 2],
      overflow: 2,
    });
    expect(splitSizes(parts(12, "~", 3), 10)).toEqual({
      sizes: [10, 0, 0],
      overflow: 5,
    });
  });
});
