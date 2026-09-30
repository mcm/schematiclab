// Versioned JSON schema for a camo shape pack (`public/camo-shapes/*.json`):
// per camo-capable block id, an ordered list of block-state rules, each
// describing the block's shape as pieces cut from its camo's full-cube mesh.
//
// Coordinates are model pixels (0..16 per block axis), like block model JSON.
// Packs are generated (`pnpm gen:camo-shapes`) and fetched at runtime, so
// `validateShapePack` checks everything before the mesh engine trusts it.
// Pure: no DOM, no deepslate.

/** Current `formatVersion`; bump on any incompatible schema change. */
export const SHAPE_PACK_FORMAT_VERSION = 1;

export const DIRECTIONS = [
  "down",
  "up",
  "north",
  "south",
  "west",
  "east",
] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type Axis = "x" | "y" | "z";
export type Vec3 = [number, number, number];

/** Axis-aligned box in model pixels, `from <= to` on every axis. */
export interface Box {
  from: Vec3;
  to: Vec3;
}

/**
 * One transform step, applied about the block centre (8, 8, 8).
 *
 * Rotations turn clockwise when looking from the positive end of the axis
 * towards the origin, matching blockstate variant `x`/`y` rotations:
 * `rotateY90` takes north to east, `rotateX90` takes up to north and
 * `rotateZ90` takes up to east. Flips mirror across the centre plane
 * perpendicular to the axis.
 */
export const TRANSFORM_OPS = [
  "rotateX90",
  "rotateX180",
  "rotateX270",
  "rotateY90",
  "rotateY180",
  "rotateY270",
  "rotateZ90",
  "rotateZ180",
  "rotateZ270",
  "flipX",
  "flipY",
  "flipZ",
] as const;
export type TransformOp = (typeof TRANSFORM_OPS)[number];

/**
 * A piece of the shape, written in its canonical orientation: the camo
 * mesh is cropped to `select`, moved by `offset`, then `transform` is
 * applied in order. `cull` lists the piece's faces (canonical frame) that
 * are dropped when deepslate reports the neighbour on that side as culling,
 * like a model face's `cullface`.
 */
export interface ShapePiece {
  /** Camo slot the piece takes its texture from, e.g. `camo`, `camo_two`, `top`. */
  slot: string;
  select: Box;
  /** In model pixels. */
  offset: Vec3;
  transform: TransformOp[];
  cull: Direction[];
}

/**
 * Pieces for the block states matching `when`: every listed property must
 * equal the given value or one of its `|`-separated alternatives. A rule
 * without `when` matches every state.
 */
export interface ShapeRule {
  when?: Record<string, string>;
  pieces: ShapePiece[];
}

export interface ShapePackSource {
  /** Mod namespace the pack covers, e.g. `framedblocks`. */
  mod: string;
  repository: string;
  commit: string;
  modVersion: string;
  license: string;
}

export interface ShapePack {
  formatVersion: typeof SHAPE_PACK_FORMAT_VERSION;
  source: ShapePackSource;
  /** Keyed by full block id; rules are tried in order, first match wins. */
  blocks: Record<string, ShapeRule[]>;
}

export class ShapePackError extends Error {
  constructor(path: string, message: string) {
    super(`Invalid shape pack at ${path}: ${message}`);
    this.name = "ShapePackError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ShapePackError(path, "expected an object");
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value))
    throw new ShapePackError(path, "expected an array");
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") {
    throw new ShapePackError(path, "expected a non-empty string");
  }
  return value;
}

function expectVec3(value: unknown, path: string): Vec3 {
  const items = expectArray(value, path);
  if (
    items.length !== 3 ||
    !items.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    throw new ShapePackError(path, "expected 3 finite numbers");
  }
  return [items[0], items[1], items[2]] as Vec3;
}

function validateBox(value: unknown, path: string): Box {
  const box = expectRecord(value, path);
  const from = expectVec3(box.from, `${path}.from`);
  const to = expectVec3(box.to, `${path}.to`);
  for (let axis = 0; axis < 3; axis++) {
    if (from[axis] < 0 || to[axis] > 16 || from[axis] > to[axis]) {
      throw new ShapePackError(path, "expected 0 <= from <= to <= 16");
    }
  }
  return { from, to };
}

function validateEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T[] {
  if (value === undefined) return [];
  return expectArray(value, path).map((item, i) => {
    if (!allowed.includes(item as T)) {
      throw new ShapePackError(
        `${path}[${i}]`,
        `expected one of ${allowed.join(", ")}`,
      );
    }
    return item as T;
  });
}

function validatePiece(value: unknown, path: string): ShapePiece {
  const piece = expectRecord(value, path);
  return {
    slot: expectString(piece.slot, `${path}.slot`),
    select: validateBox(piece.select, `${path}.select`),
    offset:
      piece.offset === undefined
        ? [0, 0, 0]
        : expectVec3(piece.offset, `${path}.offset`),
    transform: validateEnumList(
      piece.transform,
      TRANSFORM_OPS,
      `${path}.transform`,
    ),
    cull: validateEnumList(piece.cull, DIRECTIONS, `${path}.cull`),
  };
}

function validateRule(value: unknown, path: string): ShapeRule {
  const rule = expectRecord(value, path);
  const pieces = expectArray(rule.pieces, `${path}.pieces`).map((piece, i) =>
    validatePiece(piece, `${path}.pieces[${i}]`),
  );
  if (rule.when === undefined) return { pieces };
  const when = Object.fromEntries(
    Object.entries(expectRecord(rule.when, `${path}.when`)).map(
      ([key, expected]) => [key, expectString(expected, `${path}.when.${key}`)],
    ),
  );
  return { when, pieces };
}

/**
 * Checks untrusted pack JSON and returns it normalized: a piece's optional
 * `offset`, `transform` and `cull` default to `[0,0,0]`, `[]` and `[]`.
 * Throws `ShapePackError` naming the first invalid path.
 */
export function validateShapePack(json: unknown): ShapePack {
  const pack = expectRecord(json, "$");
  if (pack.formatVersion !== SHAPE_PACK_FORMAT_VERSION) {
    throw new ShapePackError(
      "$.formatVersion",
      `expected ${SHAPE_PACK_FORMAT_VERSION}, got ${JSON.stringify(pack.formatVersion)}`,
    );
  }
  const source = expectRecord(pack.source, "$.source");
  const blocks = Object.fromEntries(
    Object.entries(expectRecord(pack.blocks, "$.blocks")).map(([id, rules]) => {
      const path = `$.blocks["${id}"]`;
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) {
        throw new ShapePackError(path, "expected a namespaced block id");
      }
      return [
        id,
        expectArray(rules, path).map((rule, i) =>
          validateRule(rule, `${path}[${i}]`),
        ),
      ];
    }),
  );
  return {
    formatVersion: SHAPE_PACK_FORMAT_VERSION,
    source: {
      mod: expectString(source.mod, "$.source.mod"),
      repository: expectString(source.repository, "$.source.repository"),
      commit: expectString(source.commit, "$.source.commit"),
      modVersion: expectString(source.modVersion, "$.source.modVersion"),
      license: expectString(source.license, "$.source.license"),
    },
    blocks,
  };
}

/** First rule of `rules` whose `when` matches `props`, or `null`. */
export function matchShapeRule(
  rules: readonly ShapeRule[],
  props: Readonly<Record<string, string>>,
): ShapeRule | null {
  for (const rule of rules) {
    if (rule.when === undefined) return rule;
    const matches = Object.entries(rule.when).every(([key, expected]) => {
      const actual = Object.hasOwn(props, key) ? props[key] : undefined;
      return actual !== undefined && expected.split("|").includes(actual);
    });
    if (matches) return rule;
  }
  return null;
}
