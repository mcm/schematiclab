// Shared building blocks for the hand ports of FramedBlocks'
// `client/model/geometry/**/*Geometry.java` classes (`geometry-specs.ts`
// and the per-package files next to it): Minecraft `Direction` helpers,
// the `Modifiers`/`QuadModifier` API and common property values.
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e.

import type {
  Axis,
  Direction,
  HorizontalDirection,
  QuadOp,
  Vec3,
} from "../../../src/lib/render/camo/shape-pack";

export type BlockState = Readonly<Record<string, string>>;

/** One exported quad: the camo's `face` quad through `ops`. */
export interface QuadPiece {
  face: Direction;
  ops: QuadOp[];
  /** Exported with its own direction as cull face. */
  cull: boolean;
}

/** `transformQuad` for one block state, called once per camo face. */
export type TransformQuad = (quadDir: Direction, quadMap: QuadPiece[]) => void;

export interface GeometrySpec {
  /**
   * Properties that affect the shape, with every value; the first value is
   * the block's default. Other properties are ignored.
   */
  properties: Readonly<Record<string, readonly string[]>>;
  /** The Java constructor: reads the state, returns `transformQuad`. */
  geometry: (state: BlockState) => TransformQuad;
  /** `FullFacePredicate`: faces that use the camo quad unmodified. */
  fullFaces?: (state: BlockState) => readonly Direction[];
  /** `Geometry.transformAllQuads()`: full faces also go through `transformQuad`. */
  transformAllQuads?: boolean | ((state: BlockState) => boolean);
  /**
   * `collectAdditionalParts*()` that add another block state's model
   * unchanged (the vanilla rail on rail slopes), rendered as a `block` piece.
   */
  additionalBlock?: (state: BlockState) => {
    name: string;
    properties: BlockState;
  };
}

// ── Minecraft `Direction` ──────────────────────────────────────────────────

/** `Direction.values()` order (ordinals). */
export const DIRECTIONS: readonly Direction[] = [
  "down",
  "up",
  "north",
  "south",
  "west",
  "east",
];

const AXIS_OF: Record<Direction, Axis> = {
  down: "y",
  up: "y",
  north: "z",
  south: "z",
  west: "x",
  east: "x",
};

const OPPOSITE: Record<Direction, Direction> = {
  down: "up",
  up: "down",
  north: "south",
  south: "north",
  west: "east",
  east: "west",
};

/** `Direction.getClockWise(Axis)`: clockwise looking from the positive end. */
const CLOCKWISE: Record<Axis, Partial<Record<Direction, Direction>>> = {
  x: { down: "south", south: "up", up: "north", north: "down" },
  y: { north: "east", east: "south", south: "west", west: "north" },
  z: { down: "west", west: "up", up: "east", east: "down" },
};

export const axisOf = (dir: Direction): Axis => AXIS_OF[dir];
export const opposite = (dir: Direction): Direction => OPPOSITE[dir];
export const isY = (dir: Direction) => axisOf(dir) === "y";
export const isX = (dir: Direction) => axisOf(dir) === "x";
export const isZ = (dir: Direction) => axisOf(dir) === "z";
export const isPositive = (dir: Direction) =>
  dir === "up" || dir === "south" || dir === "east";

export function clockWise(dir: Direction, axis: Axis = "y"): Direction {
  const result = CLOCKWISE[axis][dir];
  if (result === undefined) throw new Error(`${dir} is on the ${axis} axis`);
  return result;
}

export function counterClockWise(dir: Direction, axis: Axis = "y"): Direction {
  return opposite(clockWise(dir, axis));
}

export function fromAxis(axis: Axis, positive: boolean): Direction {
  const dirs: Record<Axis, [Direction, Direction]> = {
    x: ["west", "east"],
    y: ["down", "up"],
    z: ["north", "south"],
  };
  return dirs[axis][positive ? 1 : 0];
}

/** `DirUtils.getPerpendicularAxis(a, b)`: the third axis. */
export function perpendicularAxis(a: Axis, b: Axis): Axis {
  return (["x", "y", "z"] as const).find((axis) => axis !== a && axis !== b)!;
}

/** `Direction.from2DDataValue`. */
export const from2DDataValue = (value: number): Direction =>
  (["south", "west", "north", "east"] as const)[value & 3];

/** `Direction.toYRot()`. */
const Y_ROT: Partial<Record<Direction, number>> = {
  south: 0,
  west: 90,
  north: 180,
  east: 270,
};
export const toYRot = (dir: Direction): number => Y_ROT[dir] ?? 0;

// ── `Modifiers` (block fractions in, shape-pack pixels out) ───────────────

export type Modifier = QuadOp[];

/** Block fraction to model pixels, rounding off float noise. */
const px = (n: number) => Math.round(n * 16 * 1e6) / 1e6;
const pxVec = ([x, y, z]: Vec3): Vec3 => [px(x), px(y), px(z)];

const CENTER: Vec3 = [0.5, 0.5, 0.5];

export const Modifiers = {
  noop: (): Modifier => [],
  /** `cut(Direction, length)` and `cut(Direction, lengthOne, lengthTwo)`. */
  cut: (edge: Direction, lengthOne: number, lengthTwo = lengthOne): Modifier =>
    // A full-length cut is Java's `NOOP_MODIFIER`, even on the quad's axis.
    lengthOne === 1 && lengthTwo === 1
      ? []
      : [{ op: "cut", edge, lengths: [px(lengthOne), px(lengthTwo)] }],
  /** `cut(Direction.Axis, length)`: both ends of the axis. */
  cutAxis: (axis: Axis, length: number): Modifier => [
    ...Modifiers.cut(fromAxis(axis, false), length),
    ...Modifiers.cut(fromAxis(axis, true), length),
  ],
  cutTopBottom: (
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ): Modifier => [
    {
      op: "cutTopBottom",
      from: [px(minX), px(minZ)],
      to: [px(maxX), px(maxZ)],
    },
  ],
  /**
   * `cutSide(minXZ, minY, maxXZ, maxY)` and
   * `cutSide(cutDir, lengthCW, lengthCCW)`; horizontal quads only.
   */
  cutSide: (
    minXZOrEdge: number | Direction,
    a: number,
    b: number,
    maxY?: number,
  ): Modifier =>
    typeof minXZOrEdge === "number"
      ? [
          {
            op: "cutSide",
            from: [px(minXZOrEdge), px(a)],
            to: [px(b), px(maxY!)],
          },
        ]
      : [
          {
            op: "cutSide",
            edge: minXZOrEdge,
            lengthCW: px(a),
            lengthCCW: px(b),
          },
        ],
  /**
   * `cutPrismTriangle(up, back)` for side quads and
   * `cutPrismTriangle(cutDir, back)` for up/down quads.
   */
  cutPrismTriangle: (upOrEdge: boolean | Direction, back: boolean): Modifier =>
    typeof upOrEdge === "boolean"
      ? [{ op: "cutPrismTriangle", up: upOrEdge, back }]
      : [
          {
            op: "cutPrismTriangle",
            edge: upOrEdge as HorizontalDirection,
            back,
          },
        ],
  cutSmallTriangle: (edge: Direction): Modifier => [
    { op: "cutSmallTriangle", edge },
  ],
  makeHorizontalSlope: (rightEdge: boolean, angle: number): Modifier => [
    { op: "makeHorizontalSlope", rightEdge, angle },
  ],
  /**
   * `makeVerticalSlope(topEdge, angle)` for side quads and
   * `makeVerticalSlope(edge, angle)` for up/down quads.
   */
  makeVerticalSlope: (
    topEdgeOrEdge: boolean | Direction,
    angle: number,
  ): Modifier =>
    typeof topEdgeOrEdge === "boolean"
      ? [{ op: "makeVerticalSlope", topEdge: topEdgeOrEdge, angle }]
      : [
          {
            op: "makeVerticalSlope",
            edge: topEdgeOrEdge as HorizontalDirection,
            angle,
          },
        ],
  setPosition: (position: number): Modifier => [
    { op: "setPosition", position: px(position) },
  ],
  offset: (direction: Direction, amount: number): Modifier =>
    amount === 0 ? [] : [{ op: "offset", direction, amount: px(amount) }],
  rotate: (
    axis: Axis,
    origin: Vec3,
    angle: number,
    rescale = false,
    scaleMult: Vec3 = [1, 1, 1],
  ): Modifier => [
    {
      op: "rotate",
      axis,
      origin: pxVec(origin),
      angle,
      rescale,
      scaleMult: scaleMult.map(Math.abs) as Vec3,
    },
  ],
  rotateCentered: (axis: Axis, angle: number, rescale = false): Modifier =>
    Modifiers.rotate(axis, CENTER, angle, rescale),
  scaleFace: (factor: number, origin: Vec3): Modifier => [
    { op: "scaleFace", factor, origin: pxVec(origin) },
  ],
  /** Copycats+-style translation, for block-entity-renderer transforms. */
  translate: (by: Vec3): Modifier => [{ op: "translate", by: pxVec(by) }],
  /** Copycats+-style scale about `pivot`, for block-entity-renderer transforms. */
  scale: (pivot: Vec3, factor: number): Modifier => [
    { op: "scale", pivot: pxVec(pivot), factors: [factor, factor, factor] },
  ],
};

/** `QuadModifier`: collects modifiers for one camo face quad. */
export class QuadModifier {
  private readonly face: Direction;
  private readonly ops: QuadOp[];

  private constructor(face: Direction, ops: QuadOp[]) {
    this.face = face;
    this.ops = ops;
  }

  static of(face: Direction): QuadModifier {
    return new QuadModifier(face, []);
  }

  apply(modifier: Modifier): QuadModifier {
    this.ops.push(...modifier);
    return this;
  }

  applyIf(modifier: Modifier, apply: boolean): QuadModifier {
    return apply ? this.apply(modifier) : this;
  }

  derive(): QuadModifier {
    return new QuadModifier(this.face, [...this.ops]);
  }

  export(quadMap: QuadPiece[], cullFace: Direction | null): void {
    quadMap.push({
      face: this.face,
      ops: [...this.ops],
      cull: cullFace === this.face,
    });
  }
}

/** `MultiQuadModifier`: the same modifiers on several quads. */
export class MultiQuadModifier {
  private readonly mods: QuadModifier[];

  constructor(mods: QuadModifier[]) {
    this.mods = mods;
  }

  static of(...mods: QuadModifier[]): MultiQuadModifier {
    return new MultiQuadModifier(mods);
  }

  apply(modifier: Modifier): MultiQuadModifier {
    for (const mod of this.mods) mod.apply(modifier);
    return this;
  }

  derive(): MultiQuadModifier {
    return new MultiQuadModifier(this.mods.map((mod) => mod.derive()));
  }

  export(quadMap: QuadPiece[], cullFace: Direction | null): void {
    for (const mod of this.mods) mod.export(quadMap, cullFace);
  }
}

// ── Property values ────────────────────────────────────────────────────────

export const BOOL = ["false", "true"] as const;
export const HORIZONTAL = ["north", "south", "west", "east"] as const;
export const FACING = ["north", "east", "south", "west", "up", "down"] as const;
export const WALL_SIDE = ["none", "low", "tall"] as const;
export const ROTATION_16 = Array.from({ length: 16 }, (_, i) => String(i));
export const NULLABLE_FACE = ["none", ...DIRECTIONS] as const;
export const RAIL_SHAPE_STRAIGHT = [
  "north_south",
  "east_west",
  "ascending_east",
  "ascending_west",
  "ascending_north",
  "ascending_south",
] as const;
export const RAIL_SHAPE = [
  ...RAIL_SHAPE_STRAIGHT,
  "south_east",
  "south_west",
  "north_west",
  "north_east",
] as const;

/** `SlopeType`. */
export const SLOPE_TYPE = ["bottom", "horizontal", "top"] as const;
/** `CornerType`. */
export const CORNER_TYPE = [
  "bottom",
  "top",
  "horizontal_bottom_left",
  "horizontal_bottom_right",
  "horizontal_top_left",
  "horizontal_top_right",
] as const;

/** `CornerType` methods, on the serialized value. */
export const CornerType = {
  isHorizontal: (type: string) => type !== "bottom" && type !== "top",
  isTop: (type: string) =>
    type === "top" ||
    type === "horizontal_top_left" ||
    type === "horizontal_top_right",
  isRight: (type: string) =>
    type === "horizontal_bottom_right" || type === "horizontal_top_right",
  verticalOpposite: (type: string): string =>
    ({
      top: "bottom",
      bottom: "top",
      horizontal_bottom_right: "horizontal_top_right",
      horizontal_bottom_left: "horizontal_top_left",
      horizontal_top_right: "horizontal_bottom_right",
      horizontal_top_left: "horizontal_bottom_left",
    })[type] ?? type,
  /** `rotate(Rotation.CLOCKWISE_90)` (`clockwise`) or `COUNTERCLOCKWISE_90`; horizontal types only. */
  rotate: (type: string, clockwise: boolean): string => {
    const cycle = [
      "horizontal_top_left",
      "horizontal_top_right",
      "horizontal_bottom_right",
      "horizontal_bottom_left",
    ];
    const index = cycle.indexOf(type);
    if (index < 0) {
      throw new Error("Non-horizontal CornerTypes cannot be rotated");
    }
    return cycle[(index + (clockwise ? 1 : 3)) % 4];
  },
};

/** `HorizontalRotation`, in enum order. */
export const HORIZONTAL_ROTATION = ["up", "down", "right", "left"] as const;

/** `HorizontalRotation` methods, on the serialized value. */
export const HorizontalRotation = {
  withFacing: (rotation: string, dir: Direction): Direction =>
    rotation === "up"
      ? "up"
      : rotation === "down"
        ? "down"
        : rotation === "right"
          ? clockWise(dir)
          : counterClockWise(dir),
  getOpposite: (rotation: string): string =>
    ({ up: "down", down: "up", right: "left", left: "right" })[rotation]!,
  /** `rotate(Rotation.CLOCKWISE_90)` (`clockwise`) or `COUNTERCLOCKWISE_90`. */
  rotate: (rotation: string, clockwise: boolean): string =>
    clockwise
      ? { up: "right", down: "left", right: "down", left: "up" }[rotation]!
      : { up: "left", down: "right", right: "up", left: "down" }[rotation]!,
  isVertical: (rotation: string) => rotation === "up" || rotation === "down",
};

/** `CompoundDirection`: `<direction>_<orientation>`. */
export const COMPOUND_DIRECTION = [
  "down_north",
  "down_south",
  "down_west",
  "down_east",
  "up_north",
  "up_south",
  "up_west",
  "up_east",
  "north_down",
  "north_up",
  "north_west",
  "north_east",
  "south_down",
  "south_up",
  "south_west",
  "south_east",
  "west_down",
  "west_up",
  "west_north",
  "west_south",
  "east_down",
  "east_up",
  "east_north",
  "east_south",
] as const;
/** `DirectionAxis`: `<direction>_<axis>`. */
export const DIRECTION_AXIS = [
  "down_x",
  "down_z",
  "up_x",
  "up_z",
  "north_x",
  "north_y",
  "south_x",
  "south_y",
  "west_y",
  "west_z",
  "east_y",
  "east_z",
] as const;

/**
 * Properties FramedBlocks renamed, current name → older names, so rules
 * also match states saved by older versions. `yslope` became `alt_slope`
 * in 91b9e0a2 ("Move slope-toggle handling to separate interface…", 11.x),
 * with the same meaning and default.
 */
export const LEGACY_PROPERTY_NAMES: Readonly<
  Record<string, readonly string[]>
> = {
  alt_slope: ["yslope"],
};

export const isTrue = (value: string) => value === "true";
export const dir = (value: string) => value as Direction;
