// Versioned JSON schema for a camo shape pack (`public/camo-shapes/*.json`):
// per camo-capable block id, an ordered list of block-state rules, each
// describing the block's shape as pieces cut from its camo's full-cube mesh.
//
// Coordinates are model pixels (0..16 per block axis), like block model JSON.
// Packs are generated (`pnpm gen:camo-shapes`) and fetched at runtime, so
// `validateShapePack` checks everything before the mesh engine trusts it.
// Pure: no DOM, no deepslate.

/** Current `formatVersion`; bump on any incompatible schema change. */
export const SHAPE_PACK_FORMAT_VERSION = 2;

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

/** Horizontal directions, for ops that only accept a horizontal edge. */
export const HORIZONTAL_DIRECTIONS = [
  "north",
  "south",
  "west",
  "east",
] as const;
export type HorizontalDirection = (typeof HORIZONTAL_DIRECTIONS)[number];

/**
 * A per-quad operation for non-axis-aligned shapes, ported from FramedBlocks
 * `Modifiers` and Copycats+ `QuadTransform`s. Ops run on each cropped camo
 * face quad in the piece's canonical frame, in order; an op that fails (a
 * FramedBlocks cut that removes the whole quad) drops the quad.
 *
 * Positions, lengths and offsets are model pixels (0..16) where the mods use
 * block fractions (FramedBlocks `.5F` is `8` here); angles are degrees and
 * scale factors are unitless. Directions and "clockwise" follow Minecraft
 * (`north` → `east` → `south` → `west` seen from above), and a quad's
 * direction is the face it was cut from, as in both mods.
 *
 * UVs: FramedBlocks cuts re-derive UVs from the new vertex positions
 * (textures stay in block space); every other op moves vertices and keeps
 * their UVs, stretching the texture, unless wrapped in `updateUV`
 * (Copycats+ `QuadUVUpdate`), which shifts UVs by how far each vertex moved
 * within the quad's plane.
 */
export type QuadOp =
  /** FramedBlocks `cut(Direction, lengthOne, lengthTwo)`: `lengths` are for the corners clockwise and counter-clockwise from the edge (see `quad-ops.ts`). */
  | { op: "cut"; edge: Direction; lengths: [number, number] }
  /** FramedBlocks `cutTopBottom(minX, minZ, maxX, maxZ)`; up/down quads only. */
  | { op: "cutTopBottom"; from: [number, number]; to: [number, number] }
  /** FramedBlocks `cutSide(minXZ, minY, maxXZ, maxY)`; horizontal quads only. */
  | { op: "cutSide"; from: [number, number]; to: [number, number] }
  /** FramedBlocks `cutSide(cutDir, lengthCW, lengthCCW)`; horizontal quads only. */
  | { op: "cutSide"; edge: Direction; lengthCW: number; lengthCCW: number }
  /** FramedBlocks `cutCopycat(cutDir, offNeg, offPos)`. */
  | { op: "cutCopycat"; edge: Direction; offsets: [number, number] }
  /** FramedBlocks `cutPrismTriangle(up, back)`; horizontal quads only. */
  | { op: "cutPrismTriangle"; up: boolean; back: boolean }
  /** FramedBlocks `cutPrismTriangle(cutDir, back)`; up/down quads only. */
  | { op: "cutPrismTriangle"; edge: HorizontalDirection; back: boolean }
  /** FramedBlocks `cutSmallTriangle(cutDir)`. */
  | { op: "cutSmallTriangle"; edge: Direction }
  /** FramedBlocks `makeHorizontalSlope(rightEdge, angle)`; horizontal quads only. */
  | { op: "makeHorizontalSlope"; rightEdge: boolean; angle: number }
  /** FramedBlocks `makeVerticalSlope(topEdge, angle)`; horizontal quads only. */
  | { op: "makeVerticalSlope"; topEdge: boolean; angle: number }
  /** FramedBlocks `makeVerticalSlope(edge, angle)`; up/down quads only. */
  | { op: "makeVerticalSlope"; edge: HorizontalDirection; angle: number }
  /**
   * Rotation about `axis` through `origin`, right-handed (counter-clockwise
   * looking from the positive end of the axis). FramedBlocks `rotate` with
   * `rescale`/`scaleMult`; Copycats+ `QuadRotate` is one op per non-zero
   * axis, X then Y then Z, without `rescale`.
   */
  | {
      op: "rotate";
      axis: Axis;
      origin: Vec3;
      angle: number;
      rescale: boolean;
      scaleMult: Vec3;
    }
  /** FramedBlocks `scaleFace(factor, origin)`. */
  | { op: "scaleFace"; factor: number; origin: Vec3 }
  /** FramedBlocks `setPosition(posTarget)`. */
  | { op: "setPosition"; position: number }
  /** FramedBlocks `setPosition(float[4])`. */
  | { op: "setPosition"; positions: [number, number, number, number] }
  /** FramedBlocks `offset(dir, amount)`. */
  | { op: "offset"; direction: Direction; amount: number }
  /** Copycats+ `QuadTranslate`. */
  | { op: "translate"; by: Vec3 }
  /** Copycats+ `QuadScale`. */
  | { op: "scale"; pivot: Vec3; factors: Vec3 }
  /**
   * Copycats+ `QuadSlope` with its (always linear) `QuadSlope.map`
   * function: the vertex height towards `face` is scaled by
   * `map(from[0], from[1], to[0], to[1], input) / 16`, where `input` is the
   * vertex's first (`a`) or second (`b`) remaining coordinate (x/y/z order).
   */
  | {
      op: "slope";
      face: Direction;
      input: "a" | "b";
      from: [number, number];
      to: [number, number];
    }
  /** Copycats+ `QuadUVUpdate`: runs `ops`, then moves UVs with the vertices. */
  | { op: "updateUV"; ops: QuadOp[] };

export type QuadOpName = QuadOp["op"];

/**
 * A piece of the shape, written in its canonical orientation: the camo
 * mesh is cropped to `select`, moved by `offset`, then `transform` is
 * applied in order. `cull` lists the piece's faces (canonical frame) that
 * are dropped when deepslate reports the neighbour on that side as culling,
 * like a model face's `cullface`.
 *
 * Only camo faces listed in `faces` (canonical frame) are used. `ops` run
 * on each face quad after the crop and offset, before `transform`.
 */
export interface ShapePiece {
  /** Camo slot the piece takes its texture from, e.g. `camo`, `camo_two`, `top`. */
  slot: string;
  select: Box;
  /** In model pixels. */
  offset: Vec3;
  transform: TransformOp[];
  cull: Direction[];
  faces: Direction[];
  ops: QuadOp[];
  /**
   * Set on pieces generated from a FramedBlocks `framed_templates/*.json`
   * cube: the template id and the cube's index in its `elements`. A loaded
   * jar's copy of the template replaces these pieces (`template-overrides.ts`).
   */
  template?: PieceTemplate;
  /**
   * Copycats' `assembleAll()` for a same-kind material (a fence camo on a
   * copycat fence) and Create's trapdoor-material panel: the slot's whole
   * camo mesh, unchanged (`select`, `offset`, `transform`, `faces` and
   * `ops` don't apply). Faces in `cull` on the block boundary still cull.
   */
  whole?: boolean;
  /**
   * On a `whole` piece: keep only the camo quads whose vertices all lie
   * strictly between `min` and `max` (model pixels, block frame) on `axis`.
   * The Copycats+ cogwheels drop a cogwheel material's shaft this way.
   */
  keepInside?: KeepInside;
  /**
   * The camo is meshed with the block's own values for the properties both
   * share (Copycats+ `updatePropertiesIfMatch`), e.g. a fence camo takes
   * the copycat fence's connections.
   */
  copyProperties?: boolean;
  /**
   * Instead of cutting the camo, render this block model (rotated like a
   * blockstate variant) with its textures swapped for the camo's (Create
   * `CopycatBarsModel`). `select` and the other geometry fields don't apply.
   */
  model?: PieceModel;
  /**
   * Instead of cutting the camo, render this block state through its own
   * blockstate and models, unchanged (the vanilla rail on FramedBlocks'
   * rail slopes). `slot` and the geometry fields don't apply.
   */
  block?: PieceBlock;
}

export interface KeepInside {
  axis: Axis;
  min: number;
  max: number;
}

export interface PieceBlock {
  /** Block id, e.g. `minecraft:rail`. */
  name: string;
  properties: Readonly<Record<string, string>>;
}

export interface PieceModel {
  /** Model id, e.g. `create:block/copycat_panel/bars`. */
  id: string;
  /** Blockstate-style rotations in degrees (multiples of 90). */
  x: number;
  y: number;
  /** Camo face (block frame) whose texture replaces the model's textures. */
  face: Direction;
}

export interface PieceTemplate {
  /** `framedblocks:<name>` for `framed_templates/<name>.json`. */
  id: string;
  element: number;
}

/** One cube of a FramedBlocks geometry template. */
export interface TemplateCube {
  box: Box;
  /** Face → cullable. Faces not listed aren't part of the cube. */
  faces: Partial<Record<Direction, boolean>>;
}

/**
 * Pieces for the block states matching `when`: every listed property must
 * equal the given value or one of its `|`-separated alternatives. A rule
 * without `when` matches every state.
 *
 * A key can also list `|`-separated names: a property's current name, then
 * the names older mod versions saved it under (FramedBlocks' `yslope` became
 * `alt_slope`). The first name the state has is compared, and a state with
 * none of them matches, so such blocks list the default value's rule first.
 *
 * Rules with the same `group` (or none) are alternatives, first match wins;
 * each group is matched on its own and the matches' pieces add up. Copycats+
 * multi-state blocks put each part in its own group, so a part's rules only
 * depend on the properties that part reads.
 */
export interface ShapeRule {
  when?: Record<string, string>;
  /** Also requires the camo in a slot to be of a kind of block. */
  material?: MaterialCondition;
  group?: string;
  pieces: ShapePiece[];
}

/**
 * A camo test standing in for the mods' `instanceof` checks on the
 * material's block class, which block ids can't answer: the camo in `slot`
 * is a block whose id path ends with one of `suffixes` (vanilla naming, e.g.
 * `_fence` for `FenceBlock`) and whose state has every one of `properties`.
 */
export interface MaterialCondition {
  slot: string;
  suffixes: string[];
  properties?: string[];
}

/** The part of a camo slot (`src/lib/camo/extract.ts`) rules look at. */
export interface RuleSlot {
  slot: string;
  kind: string;
  state: { name: string; properties: Record<string, string> } | null;
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

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ShapePackError(path, "expected a finite number");
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ShapePackError(path, "expected a boolean");
  }
  return value;
}

function expectNumbers<N extends number>(
  value: unknown,
  length: N,
  path: string,
): number[] & { length: N } {
  const items = expectArray(value, path);
  if (items.length !== length) {
    throw new ShapePackError(path, `expected ${length} finite numbers`);
  }
  return items.map((n, i) => expectNumber(n, `${path}[${i}]`)) as number[] & {
    length: N;
  };
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (!allowed.includes(value as T)) {
    throw new ShapePackError(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

const AXES = ["x", "y", "z"] as const;

function expectPair(value: unknown, path: string): [number, number] {
  const [a, b] = expectNumbers(value, 2, path);
  return [a, b];
}

function validateOp(value: unknown, path: string): QuadOp {
  const op = expectRecord(value, path);
  const field = (key: string) => `${path}.${key}`;
  const direction = (key: string) =>
    expectEnum(op[key], DIRECTIONS, field(key));
  const horizontal = (key: string) =>
    expectEnum(op[key], HORIZONTAL_DIRECTIONS, field(key));
  const number = (key: string) => expectNumber(op[key], field(key));
  const boolean = (key: string) => expectBoolean(op[key], field(key));
  const pair = (key: string) => expectPair(op[key], field(key));
  const vec3 = (key: string) => expectVec3(op[key], field(key));
  switch (op.op) {
    case "cut":
      return { op: "cut", edge: direction("edge"), lengths: pair("lengths") };
    case "cutTopBottom":
      return { op: "cutTopBottom", from: pair("from"), to: pair("to") };
    case "cutSide":
      return op.edge === undefined
        ? { op: "cutSide", from: pair("from"), to: pair("to") }
        : {
            op: "cutSide",
            edge: direction("edge"),
            lengthCW: number("lengthCW"),
            lengthCCW: number("lengthCCW"),
          };
    case "cutCopycat":
      return {
        op: "cutCopycat",
        edge: direction("edge"),
        offsets: pair("offsets"),
      };
    case "cutPrismTriangle":
      return op.edge === undefined
        ? {
            op: "cutPrismTriangle",
            up: boolean("up"),
            back: boolean("back"),
          }
        : {
            op: "cutPrismTriangle",
            edge: horizontal("edge"),
            back: boolean("back"),
          };
    case "cutSmallTriangle":
      return { op: "cutSmallTriangle", edge: direction("edge") };
    case "makeHorizontalSlope":
      return {
        op: "makeHorizontalSlope",
        rightEdge: boolean("rightEdge"),
        angle: number("angle"),
      };
    case "makeVerticalSlope":
      return op.edge === undefined
        ? {
            op: "makeVerticalSlope",
            topEdge: boolean("topEdge"),
            angle: number("angle"),
          }
        : {
            op: "makeVerticalSlope",
            edge: horizontal("edge"),
            angle: number("angle"),
          };
    case "rotate":
      return {
        op: "rotate",
        axis: expectEnum(op.axis, AXES, field("axis")),
        origin: vec3("origin"),
        angle: number("angle"),
        rescale: op.rescale === undefined ? false : boolean("rescale"),
        scaleMult: op.scaleMult === undefined ? [1, 1, 1] : vec3("scaleMult"),
      };
    case "scaleFace":
      return {
        op: "scaleFace",
        factor: number("factor"),
        origin: vec3("origin"),
      };
    case "setPosition": {
      if (op.positions === undefined) {
        return { op: "setPosition", position: number("position") };
      }
      const [a, b, c, d] = expectNumbers(op.positions, 4, field("positions"));
      return { op: "setPosition", positions: [a, b, c, d] };
    }
    case "offset":
      return {
        op: "offset",
        direction: direction("direction"),
        amount: number("amount"),
      };
    case "translate":
      return { op: "translate", by: vec3("by") };
    case "scale":
      return { op: "scale", pivot: vec3("pivot"), factors: vec3("factors") };
    case "slope": {
      const from = pair("from");
      if (from[0] === from[1]) {
        throw new ShapePackError(field("from"), "expected a non-empty range");
      }
      return {
        op: "slope",
        face: direction("face"),
        input: expectEnum(op.input, ["a", "b"] as const, field("input")),
        from,
        to: pair("to"),
      };
    }
    case "updateUV":
      return {
        op: "updateUV",
        ops: validateOps(op.ops, field("ops")),
      };
    default:
      throw new ShapePackError(field("op"), "expected a known quad op");
  }
}

function validateOps(value: unknown, path: string): QuadOp[] {
  if (value === undefined) return [];
  return expectArray(value, path).map((op, i) =>
    validateOp(op, `${path}[${i}]`),
  );
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
    faces:
      piece.faces === undefined
        ? [...DIRECTIONS]
        : validateEnumList(piece.faces, DIRECTIONS, `${path}.faces`),
    ops: validateOps(piece.ops, `${path}.ops`),
    ...(piece.template === undefined
      ? {}
      : {
          template: validatePieceTemplate(piece.template, `${path}.template`),
        }),
    ...(piece.whole === undefined
      ? {}
      : { whole: expectBoolean(piece.whole, `${path}.whole`) }),
    ...(piece.keepInside === undefined
      ? {}
      : {
          keepInside: validateKeepInside(
            piece.keepInside,
            `${path}.keepInside`,
          ),
        }),
    ...(piece.copyProperties === undefined
      ? {}
      : {
          copyProperties: expectBoolean(
            piece.copyProperties,
            `${path}.copyProperties`,
          ),
        }),
    ...(piece.model === undefined
      ? {}
      : { model: validatePieceModel(piece.model, `${path}.model`) }),
    ...(piece.block === undefined
      ? {}
      : { block: validatePieceBlock(piece.block, `${path}.block`) }),
  };
}

function validateKeepInside(value: unknown, path: string): KeepInside {
  const keep = expectRecord(value, path);
  const min = expectNumber(keep.min, `${path}.min`);
  const max = expectNumber(keep.max, `${path}.max`);
  if (min >= max) throw new ShapePackError(path, "expected min < max");
  return { axis: expectEnum(keep.axis, AXES, `${path}.axis`), min, max };
}

function validatePieceBlock(value: unknown, path: string): PieceBlock {
  const block = expectRecord(value, path);
  const properties = expectRecord(block.properties ?? {}, `${path}.properties`);
  return {
    name: expectString(block.name, `${path}.name`),
    properties: Object.fromEntries(
      Object.entries(properties).map(([key, v]) => [
        key,
        expectString(v, `${path}.properties.${key}`),
      ]),
    ),
  };
}

function expectQuarterTurn(value: unknown, path: string): number {
  if (value === undefined) return 0;
  const angle = expectNumber(value, path);
  if (![0, 90, 180, 270].includes(angle)) {
    throw new ShapePackError(path, "expected 0, 90, 180 or 270");
  }
  return angle;
}

function validatePieceModel(value: unknown, path: string): PieceModel {
  const model = expectRecord(value, path);
  return {
    id: expectString(model.id, `${path}.id`),
    x: expectQuarterTurn(model.x, `${path}.x`),
    y: expectQuarterTurn(model.y, `${path}.y`),
    face:
      model.face === undefined
        ? "north"
        : expectEnum(model.face, DIRECTIONS, `${path}.face`),
  };
}

function validateMaterialCondition(
  value: unknown,
  path: string,
): MaterialCondition {
  const condition = expectRecord(value, path);
  const strings = (key: string) =>
    expectArray(condition[key], `${path}.${key}`).map((item, i) =>
      expectString(item, `${path}.${key}[${i}]`),
    );
  const suffixes = strings("suffixes");
  if (suffixes.length === 0) {
    throw new ShapePackError(`${path}.suffixes`, "expected a suffix");
  }
  return {
    slot: expectString(condition.slot, `${path}.slot`),
    suffixes,
    ...(condition.properties === undefined
      ? {}
      : { properties: strings("properties") }),
  };
}

function validatePieceTemplate(value: unknown, path: string): PieceTemplate {
  const template = expectRecord(value, path);
  const element = template.element;
  if (
    typeof element !== "number" ||
    !Number.isInteger(element) ||
    element < 0
  ) {
    throw new ShapePackError(`${path}.element`, "expected an index");
  }
  return { id: expectString(template.id, `${path}.id`), element };
}

function validateRule(value: unknown, path: string): ShapeRule {
  const rule = expectRecord(value, path);
  const pieces = expectArray(rule.pieces, `${path}.pieces`).map((piece, i) =>
    validatePiece(piece, `${path}.pieces[${i}]`),
  );
  const material =
    rule.material === undefined
      ? {}
      : {
          material: validateMaterialCondition(
            rule.material,
            `${path}.material`,
          ),
        };
  const extra = {
    ...material,
    ...(rule.group === undefined
      ? {}
      : { group: expectString(rule.group, `${path}.group`) }),
  };
  if (rule.when === undefined) return { ...extra, pieces };
  const when = Object.fromEntries(
    Object.entries(expectRecord(rule.when, `${path}.when`)).map(
      ([key, expected]) => [key, expectString(expected, `${path}.when.${key}`)],
    ),
  );
  return { when, ...extra, pieces };
}

/**
 * Checks untrusted pack JSON and returns it normalized: a piece's optional
 * `offset`, `transform`, `cull`, `faces` and `ops` default to `[0,0,0]`,
 * `[]`, `[]`, every direction and `[]`; a `rotate` op's `rescale` and
 * `scaleMult` default to `false` and `[1,1,1]`.
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

/** Whether the camo in `condition.slot` of `slots` meets `condition`. */
export function matchesMaterial(
  condition: MaterialCondition,
  slots: readonly RuleSlot[],
): boolean {
  const slot = slots.find((s) => s.slot === condition.slot);
  if (slot === undefined || slot.kind !== "block" || slot.state === null) {
    return false;
  }
  const { name, properties } = slot.state;
  const path = name.slice(name.indexOf(":") + 1);
  return (
    condition.suffixes.some((suffix) => path.endsWith(suffix)) &&
    (condition.properties ?? []).every((key) => Object.hasOwn(properties, key))
  );
}

function ruleMatches(
  rule: ShapeRule,
  props: Readonly<Record<string, string>>,
  slots: readonly RuleSlot[],
): boolean {
  if (rule.material !== undefined && !matchesMaterial(rule.material, slots)) {
    return false;
  }
  if (rule.when === undefined) return true;
  return Object.entries(rule.when).every(([key, expected]) => {
    const names = key.split("|");
    const name = names.find((n) => Object.hasOwn(props, n));
    // A legacy state without the property (or its old names) matches.
    if (name === undefined) return names.length > 1;
    return expected.split("|").includes(props[name]);
  });
}

// Merged rules of grouped packs, per rule list and matched rule indices, so
// a state always gets the same rule object (callers cache by rule).
const mergedRules = new WeakMap<readonly ShapeRule[], Map<string, ShapeRule>>();

/**
 * The rule for a block state: the first rule of each `group` whose `when`
 * matches `props` and whose `material` condition (if any) matches `slots`.
 * With one matching group that rule itself, with several a rule holding all
 * their pieces, and `null` when nothing matches.
 */
export function matchShapeRule(
  rules: readonly ShapeRule[],
  props: Readonly<Record<string, string>>,
  slots: readonly RuleSlot[] = [],
): ShapeRule | null {
  const matched: number[] = [];
  const done = new Set<string | undefined>();
  for (const [index, rule] of rules.entries()) {
    if (done.has(rule.group) || !ruleMatches(rule, props, slots)) continue;
    done.add(rule.group);
    matched.push(index);
  }
  if (matched.length === 0) return null;
  if (matched.length === 1) return rules[matched[0]];
  let cache = mergedRules.get(rules);
  if (cache === undefined) {
    cache = new Map();
    mergedRules.set(rules, cache);
  }
  const key = matched.join(",");
  let merged = cache.get(key);
  if (merged === undefined) {
    merged = { pieces: matched.flatMap((index) => rules[index].pieces) };
    cache.set(key, merged);
  }
  return merged;
}

/**
 * Parses a FramedBlocks `framed_templates/*.json` file (`GeometryTemplate.CODEC`):
 * `elements` of `from`/`to` boxes whose `faces` map each face to a cullable
 * flag, or, like a block model, to an object that is cullable when it has a
 * `cullface`. Box corners may come in either order. Throws `ShapePackError`
 * naming the first invalid path.
 */
export function parseFramedTemplate(json: unknown, path = "$"): TemplateCube[] {
  const template = expectRecord(json, path);
  return expectArray(template.elements, `${path}.elements`).map((value, i) => {
    const where = `${path}.elements[${i}]`;
    const element = expectRecord(value, where);
    const a = expectVec3(element.from, `${where}.from`);
    const b = expectVec3(element.to, `${where}.to`);
    const box = validateBox(
      {
        from: [0, 1, 2].map((axis) => Math.min(a[axis], b[axis])),
        to: [0, 1, 2].map((axis) => Math.max(a[axis], b[axis])),
      },
      where,
    );
    const faces: Partial<Record<Direction, boolean>> = {};
    for (const [face, spec] of Object.entries(
      expectRecord(element.faces, `${where}.faces`),
    )) {
      const dir = expectEnum(face, DIRECTIONS, `${where}.faces`);
      faces[dir] = isRecord(spec)
        ? spec.cullface !== undefined
        : expectBoolean(spec, `${where}.faces.${face}`);
    }
    return { box, faces };
  });
}
