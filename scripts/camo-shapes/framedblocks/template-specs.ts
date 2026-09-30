// Hand port of FramedBlocks'
// `client/model/geometry/templated/TemplateSpecs.java` (per-state template
// transforms) and of the `calculateParts()` of the double blocks. Their parts
// are templated blocks or bespoke geometries (`geometry-specs.ts`). Read by
// `scripts/generate-camo-shapes.mts`.
//
// A templated block's model is the union of its source files' cubes (from
// `framed_templates/*.json`, or vanilla models for `minecraft:` ids), each
// transformed by the source file's transform and then the spec's transform.
// Transforms follow `TemplateTransformBuilder`: rotate about X, then Y, then
// Z, then mirror X, Y, Z. FramedBlocks' quadrants turn the same way as
// blockstate `x`/`y` rotations (and the shape pack's `rotateZ90` takes up to
// east), so they map one-to-one onto shape-pack transform ops.
//
// Not ported (render differences only): copycat-style face cutting
// (`copycatPredicate`), overlays, `useBaseModel`/`appendBaseModel` (e.g. the
// bookshelf's books) and connected textures. State mergers are ported only
// where they change geometry (doors); the others only fold visually
// identical states together.

import type { Vec3 } from "../../../src/lib/render/camo/shape-pack";

import {
  COMPOUND_DIRECTION,
  CORNER_TYPE,
  CornerType,
  DIRECTION_AXIS,
  SLOPE_TYPE,
} from "./geometry-api.ts";

export type Quadrant = 0 | 90 | 180 | 270;

/** `TemplateTransformBuilder`. */
export interface Xform {
  x?: Quadrant;
  y?: Quadrant;
  z?: Quadrant;
  mirrorX?: boolean;
  mirrorY?: boolean;
  mirrorZ?: boolean;
}

/**
 * Port of FramedBlocks `Modifiers.rotate` used as a post modifier: rotates
 * every face quad about `axis` through `origin` (model pixels).
 */
export interface RotatePostModifier {
  axis: "x" | "y" | "z";
  origin: Vec3;
  angle: number;
}

export interface SourceFile {
  /**
   * `framedblocks:<name>` for `framed_templates/<name>.json`
   * (`SourceType.TEMPLATE`), `minecraft:block/<name>` for a vanilla model
   * (`SourceType.MODEL`).
   */
  id: string;
  xform?: Xform;
}

export interface TemplateGeometry {
  sources: SourceFile[];
  transform?: Xform;
  postModifier?: RotatePostModifier;
}

export type BlockState = Readonly<Record<string, string>>;

export interface TemplateSpec {
  /**
   * Properties that affect the shape, with every value; the first value is
   * the block's default. Other properties are ignored.
   */
  properties: Readonly<Record<string, readonly string[]>>;
  geometry: (state: BlockState) => TemplateGeometry;
}

export interface PartState {
  /** Block id without namespace, e.g. `framed_slab`. */
  block: string;
  /** Properties not listed use the part block's defaults. */
  props: BlockState;
}

export interface DoubleBlockSpec {
  properties: Readonly<Record<string, readonly string[]>>;
  /** `[partOne, partTwo]`: `camo` renders part one, `camo_two` part two. */
  parts: (state: BlockState) => [PartState, PartState];
}

// ── Property values ────────────────────────────────────────────────────────

const BOOL = ["false", "true"] as const;
const HORIZONTAL = ["north", "south", "west", "east"] as const;
const FACING = ["north", "east", "south", "west", "up", "down"] as const;
const AXIS = ["y", "x", "z"] as const;
const STAIRS_SHAPE = [
  "straight",
  "inner_left",
  "inner_right",
  "outer_left",
  "outer_right",
] as const;
const STAIRS_TYPE = [
  "vertical",
  "top_fwd",
  "top_ccw",
  "top_both",
  "bottom_fwd",
  "bottom_ccw",
  "bottom_both",
] as const;
/** `CornerTubeOrientation`: `<primary>_<secondary>`. */
const CORNER_TUBE_ORIENTATION = [
  "up_north",
  "up_east",
  "up_south",
  "up_west",
  "down_north",
  "down_east",
  "down_south",
  "down_west",
  "north_east",
  "east_south",
  "south_west",
  "west_north",
] as const;
const POWER = Array.from({ length: 16 }, (_, i) => String(i));
const LAYERS = ["1", "2", "3", "4", "5", "6", "7", "8"];

// ── Direction helpers ──────────────────────────────────────────────────────

const CLOCKWISE: Record<string, string> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};
const COUNTER_CLOCKWISE: Record<string, string> = {
  north: "west",
  west: "south",
  south: "east",
  east: "north",
};
const OPPOSITE: Record<string, string> = {
  north: "south",
  south: "north",
  west: "east",
  east: "west",
  up: "down",
  down: "up",
};

export function clockWise(dir: string): string {
  return CLOCKWISE[dir];
}

export function counterClockWise(dir: string): string {
  return COUNTER_CLOCKWISE[dir];
}

export function opposite(dir: string): string {
  return OPPOSITE[dir];
}

const isY = (dir: string) => dir === "up" || dir === "down";
const isTrue = (value: string) => value === "true";

/** `TemplateUtils.getHorizontalQuadrant(Direction)`. */
export function horizontalQuadrant(dir: string): Quadrant {
  switch (dir) {
    case "east":
      return 90;
    case "south":
      return 180;
    case "west":
      return 270;
    default:
      return 0;
  }
}

/** `TemplateUtils.getVerticalQuadrant(...)`. */
function verticalQuadrant(dir: string): Quadrant {
  return dir === "down" ? 90 : dir === "up" ? 270 : 0;
}

/** `TemplateUtils.applyAxisRotation(state)`. */
function axisRotation(axis: string): Xform {
  return axis === "x" ? { z: 90 } : axis === "z" ? { x: 90 } : {};
}

const T = (name: string) => `framedblocks:${name}`;
const M = (name: string) => `minecraft:block/${name}`;

// ── Spec factories (`TemplateUtils`) ───────────────────────────────────────

function unitSpec(id: string): TemplateSpec {
  return { properties: {}, geometry: () => ({ sources: [{ id }] }) };
}

function topBottomSpec(id: string): TemplateSpec {
  return {
    properties: { top: BOOL },
    geometry: (s) => ({
      sources: [{ id }],
      transform: { mirrorY: isTrue(s.top) },
    }),
  };
}

function topBottomHorFacingSpec(id: string): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL },
    geometry: (s) => ({
      sources: [{ id }],
      transform: { y: horizontalQuadrant(s.facing), mirrorY: isTrue(s.top) },
    }),
  };
}

function facingSpec(id: string): TemplateSpec {
  return {
    properties: { facing: FACING },
    geometry: (s) => ({
      sources: [{ id }],
      transform: {
        x: verticalQuadrant(s.facing),
        y: horizontalQuadrant(s.facing),
      },
    }),
  };
}

function axisSpec(file: (s: BlockState) => string, extra = {}): TemplateSpec {
  return {
    properties: { axis: AXIS, ...extra },
    geometry: (s) => ({
      sources: [{ id: file(s) }],
      transform: axisRotation(s.axis),
    }),
  };
}

function horizontalSpec(sources: SourceFile[], invert = false): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL },
    geometry: (s) => ({
      sources,
      transform: {
        y: horizontalQuadrant(invert ? opposite(s.facing) : s.facing),
      },
    }),
  };
}

// ── Ports of the `TemplateSpecs` builders ──────────────────────────────────

function stairs(): TemplateSpec {
  return {
    properties: {
      facing: HORIZONTAL,
      half: ["bottom", "top"],
      shape: STAIRS_SHAPE,
    },
    geometry: (s) => {
      const model =
        s.shape === "straight"
          ? T("stairs_straight")
          : s.shape.startsWith("inner")
            ? T("stairs_inner")
            : T("stairs_outer");
      const modelRotY: Quadrant = s.shape.endsWith("right") ? 90 : 0;
      return {
        sources: [{ id: model, xform: { y: modelRotY } }],
        transform: {
          y: horizontalQuadrant(s.facing),
          mirrorY: s.half === "top",
        },
      };
    },
  };
}

function halfStairs(): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, right: BOOL },
    geometry: (s) => ({
      sources: [
        { id: T("half_stairs_left"), xform: { mirrorX: isTrue(s.right) } },
      ],
      transform: { y: horizontalQuadrant(s.facing), mirrorY: isTrue(s.top) },
    }),
  };
}

function verticalStairs(): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL, type: STAIRS_TYPE },
    geometry: (s) => {
      const model =
        s.type === "vertical"
          ? T("stairs_straight")
          : s.type === "bottom_both" || s.type === "top_both"
            ? T("threeway_corner_pillar")
            : T("stairs_outer");
      const xform: Record<string, Xform> = {
        vertical: { z: 90 },
        bottom_fwd: { z: 90 },
        top_fwd: { y: 90, z: 90 },
        top_ccw: { x: 270, z: 270 },
        bottom_ccw: { x: 270 },
        top_both: {},
        bottom_both: { mirrorY: true },
      };
      return {
        sources: [{ id: model, xform: xform[s.type] }],
        transform: { y: horizontalQuadrant(s.facing) },
      };
    },
  };
}

function verticalHalfStairs(): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL },
    geometry: (s) => ({
      sources: [{ id: T("half_stairs_left"), xform: { z: 90 } }],
      transform: { y: horizontalQuadrant(s.facing), mirrorY: !isTrue(s.top) },
    }),
  };
}

function fence(): TemplateSpec {
  const arms: [string, Quadrant][] = [
    ["north", 0],
    ["east", 90],
    ["south", 180],
    ["west", 270],
  ];
  return {
    properties: { north: BOOL, east: BOOL, south: BOOL, west: BOOL },
    geometry: (s) => ({
      sources: [
        { id: T("post") },
        ...arms
          .filter(([side]) => isTrue(s[side]))
          .map(([, y]) => ({ id: T("fence_arm"), xform: { y } })),
      ],
    }),
  };
}

function fenceGate(): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL, open: BOOL, in_wall: BOOL },
    geometry: (s) => {
      const name =
        (isTrue(s.in_wall) ? "fence_gate_in_wall" : "fence_gate") +
        (isTrue(s.open) ? "_open" : "");
      return {
        sources: [{ id: T(name) }],
        transform: { y: horizontalQuadrant(s.facing) },
      };
    },
  };
}

/** `door(...)` with `FramedDoorBlock.DoorStateMerger` folded in. */
function door(): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL, hinge: ["left", "right"], open: BOOL },
    geometry: (s) => {
      let facing = s.facing;
      if (isTrue(s.open)) {
        // Rotate to the visually equivalent closed variant.
        facing =
          s.hinge === "right" ? counterClockWise(facing) : clockWise(facing);
      }
      return {
        sources: [{ id: T("door") }],
        transform: { y: horizontalQuadrant(opposite(facing)) },
      };
    },
  };
}

function trapdoor(): TemplateSpec {
  return {
    properties: {
      facing: HORIZONTAL,
      half: ["bottom", "top"],
      open: BOOL,
      rotate_texture: BOOL,
    },
    geometry: (s) => {
      const open = isTrue(s.open);
      const rotTex = isTrue(s.rotate_texture);
      if (open && !rotTex) {
        return {
          sources: [{ id: M("template_trapdoor_open") }],
          transform: { y: horizontalQuadrant(s.facing) },
        };
      }
      const top = s.half === "top";
      const geometry: TemplateGeometry = {
        sources: [
          { id: M(top ? "template_trapdoor_top" : "template_trapdoor_bottom") },
        ],
      };
      if (open) geometry.postModifier = trapdoorPostModifier(s.facing, top);
      return geometry;
    },
  };
}

/** `TrapdoorPostModifierProvider`: swings the closed model open. */
function trapdoorPostModifier(dir: string, top: boolean): RotatePostModifier {
  const positive = dir === "south" || dir === "east";
  const isZ = dir === "north" || dir === "south";
  const xz = positive ? 1.5 : 14.5;
  return {
    axis: isZ ? "x" : "z",
    origin: [xz, top ? 14.5 : 1.5, xz],
    angle: (positive !== isZ) === top ? -90 : 90,
  };
}

function pressurePlate(weighted: boolean): TemplateSpec {
  return {
    properties: weighted ? { power: POWER } : { powered: BOOL },
    geometry: (s) => {
      const down = weighted ? s.power !== "0" : isTrue(s.powered);
      return {
        sources: [
          { id: M(down ? "pressure_plate_down" : "pressure_plate_up") },
        ],
      };
    },
  };
}

function button(large: boolean): TemplateSpec {
  return {
    properties: {
      face: ["wall", "floor", "ceiling"],
      facing: HORIZONTAL,
      powered: BOOL,
    },
    geometry: (s) => {
      const down = isTrue(s.powered);
      const id = large
        ? T(down ? "large_button_pressed" : "large_button")
        : down
          ? T("button_pressed")
          : M("button");
      const x: Quadrant = s.face === "floor" ? 0 : s.face === "wall" ? 90 : 180;
      const dir = s.face === "ceiling" ? opposite(s.facing) : s.facing;
      return {
        sources: [{ id }],
        transform: { x, y: horizontalQuadrant(dir) },
      };
    },
  };
}

function partialBoard(name: string): TemplateSpec {
  return {
    properties: { facing_dir: COMPOUND_DIRECTION },
    geometry: (s) => {
      const [direction, orientation] = s.facing_dir.split("_");
      let modelRotY: Quadrant;
      switch (orientation) {
        case "down":
          modelRotY = 0;
          break;
        case "up":
          modelRotY = 180;
          break;
        case "north":
          modelRotY = (
            { down: 0, up: 180, west: 270, east: 90 } as Record<
              string,
              Quadrant
            >
          )[direction];
          break;
        case "south":
          modelRotY = (
            { down: 180, up: 0, west: 90, east: 270 } as Record<
              string,
              Quadrant
            >
          )[direction];
          break;
        case "west":
          modelRotY = direction === "north" ? 90 : 270;
          break;
        default:
          modelRotY = direction === "north" ? 270 : 90;
      }
      const rootRotX: Quadrant =
        direction === "down" ? 0 : direction === "up" ? 180 : 90;
      const rootRotY: Quadrant =
        direction === "north"
          ? 180
          : direction === "west"
            ? 90
            : direction === "east"
              ? 270
              : 0;
      return {
        sources: [{ id: T(name), xform: { y: modelRotY } }],
        transform: { x: rootRotX, y: rootRotY },
      };
    },
  };
}

function cornerStrip(): TemplateSpec {
  return {
    properties: { facing: HORIZONTAL, type: ["bottom", "horizontal", "top"] },
    geometry: (s) => {
      const z: Quadrant =
        s.type === "bottom" ? 0 : s.type === "horizontal" ? 90 : 180;
      return {
        sources: [{ id: T("corner_strip"), xform: { z } }],
        transform: { y: horizontalQuadrant(s.facing) },
      };
    },
  };
}

function lattice(thick: boolean): TemplateSpec {
  return {
    properties: { x_axis: BOOL, y_asix: BOOL, z_axis: BOOL },
    geometry: (s) => {
      const x = isTrue(s.x_axis);
      const y = isTrue(s.y_asix);
      const z = isTrue(s.z_axis);
      if (Number(x) + Number(y) + Number(z) === 1) {
        return {
          sources: [{ id: T(thick ? "pillar" : "post") }],
          transform: x ? { z: 90 } : z ? { x: 90 } : {},
        };
      }
      const core = T(thick ? "lattice_core_thick" : "lattice_core");
      const arm = T(thick ? "lattice_arm_thick" : "lattice_arm");
      return {
        sources: [
          { id: x ? arm : core, xform: { z: 90 } },
          { id: y ? arm : core },
          { id: z ? arm : core, xform: { x: 90 } },
        ],
      };
    },
  };
}

function cornerTube(): TemplateSpec {
  return {
    properties: { orientation: CORNER_TUBE_ORIENTATION, thick: BOOL },
    geometry: (s) => {
      const [primary, secondary] = s.orientation.split("_");
      const yRotDir = isY(primary) ? secondary : primary;
      const z: Quadrant = primary === "up" ? 0 : primary === "down" ? 180 : 90;
      return {
        sources: [
          {
            id: T(isTrue(s.thick) ? "corner_tube_thick" : "corner_tube"),
            xform: { z },
          },
        ],
        transform: { y: horizontalQuadrant(yRotDir) },
      };
    },
  };
}

function hopper(): TemplateSpec {
  return {
    properties: { facing: ["down", "north", "south", "west", "east"] },
    geometry: (s) => ({
      sources: [{ id: T(s.facing === "down" ? "hopper" : "hopper_side") }],
      transform: { y: horizontalQuadrant(s.facing) },
    }),
  };
}

function layeredCube(): TemplateSpec {
  return {
    properties: {
      facing: ["up", ...FACING.filter((f) => f !== "up")],
      layers: LAYERS,
    },
    geometry: (s) => {
      const layers = Number(s.layers);
      const x: Quadrant =
        s.facing === "down" ? 180 : s.facing === "up" ? 0 : 90;
      return {
        sources: [
          { id: M(layers === 8 ? "cube" : `snow_height${layers * 2}`) },
        ],
        transform: { x, y: horizontalQuadrant(s.facing) },
      };
    },
  };
}

// ── Templated blocks, keyed by block id without namespace ──────────────────

export const TEMPLATE_SPECS: Readonly<Record<string, TemplateSpec>> = {
  framed_slab: topBottomSpec(M("slab")),
  framed_slab_edge: topBottomHorFacingSpec(T("slab_edge")),
  framed_slab_corner: topBottomHorFacingSpec(T("slab_corner")),
  framed_panel: horizontalSpec([{ id: M("slab"), xform: { x: 270 } }]),
  framed_corner_pillar: horizontalSpec([
    { id: T("slab_edge"), xform: { z: 90 } },
  ]),
  framed_stairs: stairs(),
  framed_half_stairs: halfStairs(),
  framed_vertical_stairs: verticalStairs(),
  framed_vertical_half_stairs: verticalHalfStairs(),
  framed_threeway_corner_pillar: topBottomHorFacingSpec(
    T("threeway_corner_pillar"),
  ),
  framed_fence: fence(),
  framed_fence_gate: fenceGate(),
  framed_door: door(),
  framed_iron_door: door(),
  framed_trapdoor: trapdoor(),
  framed_iron_trapdoor: trapdoor(),
  framed_pressure_plate: pressurePlate(false),
  framed_stone_pressure_plate: pressurePlate(false),
  framed_obsidian_pressure_plate: pressurePlate(false),
  framed_gold_pressure_plate: pressurePlate(true),
  framed_iron_pressure_plate: pressurePlate(true),
  // `WrapHelper.copy` of the plain plates.
  framed_waterloggable_pressure_plate: pressurePlate(false),
  framed_waterloggable_stone_pressure_plate: pressurePlate(false),
  framed_waterloggable_obsidian_pressure_plate: pressurePlate(false),
  framed_waterloggable_gold_pressure_plate: pressurePlate(true),
  framed_waterloggable_iron_pressure_plate: pressurePlate(true),
  framed_ladder: horizontalSpec([{ id: T("ladder") }]),
  framed_button: button(false),
  framed_stone_button: button(false),
  framed_large_button: button(true),
  framed_large_stone_button: button(true),
  framed_wall_sign: horizontalSpec([{ id: T("wall_sign") }]),
  framed_half_board: partialBoard("half_board"),
  framed_corner_board: partialBoard("corner_board"),
  framed_inner_corner_board: partialBoard("inner_corner_board"),
  framed_corner_strip: cornerStrip(),
  framed_lattice_block: lattice(false),
  framed_thick_lattice: lattice(true),
  framed_horizontal_pane: unitSpec(T("horizontal_pane")),
  framed_pillar: axisSpec(() => T("pillar")),
  framed_half_pillar: facingSpec(T("half_pillar")),
  framed_pillar_socket: facingSpec(T("pillar_socket")),
  framed_post: axisSpec(() => T("post")),
  framed_gate: door(),
  framed_iron_gate: door(),
  framed_bookshelf: unitSpec(T("bookshelf")),
  framed_chiseled_bookshelf: horizontalSpec([{ id: T("chiseled_bookshelf") }]),
  framed_centered_slab: unitSpec(T("centered_slab")),
  framed_centered_panel: {
    properties: { facing: ["north", "east"] },
    geometry: (s) => ({
      sources: [{ id: T("centered_panel") }],
      transform: {
        x: verticalQuadrant(s.facing),
        y: horizontalQuadrant(s.facing),
      },
    }),
  },
  framed_masonry_corner_segment: topBottomHorFacingSpec(
    T("masonry_corner_segment"),
  ),
  framed_checkered_cube_segment: {
    properties: { second: BOOL },
    geometry: (s) => ({
      sources: [{ id: T("checkered_cube_segment") }],
      transform: { y: isTrue(s.second) ? 90 : 0 },
    }),
  },
  framed_checkered_slab_segment: {
    properties: { top: BOOL, second: BOOL },
    geometry: (s) => {
      const top = isTrue(s.top);
      return {
        sources: [{ id: T("checkered_slab_segment") }],
        transform: { y: isTrue(s.second) !== top ? 90 : 0, mirrorY: top },
      };
    },
  },
  framed_checkered_panel_segment: {
    properties: { facing: HORIZONTAL, second: BOOL },
    geometry: (s) => ({
      sources: [
        {
          id: T("checkered_panel_segment"),
          xform: {
            z: isTrue(s.second) ? 90 : 0,
            mirrorX: s.facing === "west" || s.facing === "east",
          },
        },
      ],
      transform: { y: horizontalQuadrant(s.facing) },
    }),
  },
  framed_tube: axisSpec((s) => T(isTrue(s.thick) ? "tube_thick" : "tube"), {
    thick: BOOL,
  }),
  framed_corner_tube: cornerTube(),
  framed_hopper: hopper(),
  framed_layered_cube: layeredCube(),
  framed_path: unitSpec(M("dirt_path")),
  framed_shelf: horizontalSpec([
    { id: M("template_shelf_body") },
    { id: M("template_shelf_unpowered") },
  ]),
};

// ── Double blocks (ports of `calculateParts()`) ────────────────────────────

const part = (block: string, props: BlockState = {}): PartState => ({
  block,
  props,
});

const bool = (value: boolean) => String(value);

/** `FramedDoubleStairsBlock` and the sliced/divided stairs share these. */
const STAIRS_PROPERTIES = {
  facing: HORIZONTAL,
  half: ["bottom", "top"],
  shape: STAIRS_SHAPE,
} as const;

const VERTICAL_STAIRS_PROPERTIES = {
  facing: HORIZONTAL,
  type: STAIRS_TYPE,
} as const;

// ── Slope, slope edge and prism double blocks ──────────────────────────────
// Ports of `calculateParts()` in `common/block/{slope,slopeedge,prism}/`;
// the part geometries are in `slope.ts`, `slope-edge.ts` and `prism.ts`.

/** `SlopeType.getOpposite()`, keeping `horizontal` as the callers do. */
const oppositeSlopeType = (type: string) =>
  type === "top" ? "bottom" : type === "bottom" ? "top" : type;

/** `FramedElevatedDoubleCornerSlopeEdgeBlock` and its inner twin: the second part's `CornerType`. */
function elevatedDoubleCornerTypeTwo(type: string): string {
  if (!CornerType.isHorizontal(type)) return CornerType.verticalOpposite(type);
  return CornerType.rotate(
    type,
    CornerType.isRight(type) === CornerType.isTop(type),
  );
}

/** `StairsType.get(top, fwd, ccw)`. */
function stairsType(top: boolean, fwd: boolean, ccw: boolean): string {
  const half = top ? "top" : "bottom";
  if (fwd && ccw) return `${half}_both`;
  if (fwd) return `${half}_fwd`;
  if (ccw) return `${half}_ccw`;
  return "vertical";
}

const SLOPE_PROPERTIES = {
  facing: HORIZONTAL,
  type: SLOPE_TYPE,
  alt_slope: BOOL,
} as const;

const CORNER_PROPERTIES = {
  facing: HORIZONTAL,
  type: CORNER_TYPE,
  alt_slope: BOOL,
} as const;

const SLOPE_DOUBLE_BLOCK_SPECS: Readonly<Record<string, DoubleBlockSpec>> = {
  // `FramedDoubleSlopeBlock`
  framed_double_slope: {
    properties: SLOPE_PROPERTIES,
    parts: (s) => [
      part("framed_slope", {
        facing: s.facing,
        type: s.type,
        alt_slope: s.alt_slope,
      }),
      part("framed_slope", {
        facing: opposite(s.facing),
        type: oppositeSlopeType(s.type),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedDividedSlopeBlock`
  framed_divided_slope: {
    properties: SLOPE_PROPERTIES,
    parts: (s) => {
      if (s.type === "horizontal") {
        const half = (top: boolean) =>
          part("framed_vertical_half_slope", {
            facing: s.facing,
            top: bool(top),
            alt_slope: s.alt_slope,
          });
        return [half(false), half(true)];
      }
      const half = (right: boolean) =>
        part("framed_half_slope", {
          facing: s.facing,
          top: bool(s.type === "top"),
          right: bool(right),
          alt_slope: s.alt_slope,
        });
      return [half(false), half(true)];
    },
  },
  // `FramedDoubleHalfSlopeBlock`
  framed_double_half_slope: {
    properties: { facing: HORIZONTAL, right: BOOL, alt_slope: BOOL },
    parts: (s) => [
      part("framed_half_slope", {
        facing: s.facing,
        top: "false",
        right: s.right,
        alt_slope: s.alt_slope,
      }),
      part("framed_half_slope", {
        facing: opposite(s.facing),
        top: "true",
        right: bool(!isTrue(s.right)),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedVerticalDoubleHalfSlopeBlock`
  framed_vertical_double_half_slope: {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: BOOL },
    parts: (s) => [
      part("framed_vertical_half_slope", {
        facing: s.facing,
        top: s.top,
        alt_slope: s.alt_slope,
      }),
      part("framed_vertical_half_slope", {
        facing: opposite(s.facing),
        top: s.top,
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedDoubleCornerBlock`
  framed_double_corner: {
    properties: CORNER_PROPERTIES,
    parts: (s) => [
      part("framed_inner_corner_slope", {
        facing: s.facing,
        type: s.type,
        alt_slope: s.alt_slope,
      }),
      part("framed_corner_slope", {
        facing: opposite(s.facing),
        type: CornerType.verticalOpposite(s.type),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedDoublePrismCornerBlock`
  framed_double_prism_corner: {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      offset: BOOL,
      alt_slope: BOOL,
    },
    parts: (s) => [
      part("framed_inner_prism_corner", {
        facing: s.facing,
        top: s.top,
        offset: s.offset,
        alt_slope: s.alt_slope,
      }),
      part("framed_prism_corner", {
        facing: opposite(s.facing),
        top: bool(!isTrue(s.top)),
        offset: bool(!isTrue(s.offset)),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedDoubleThreewayCornerBlock`
  framed_double_threeway_corner: {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: BOOL },
    parts: (s) => [
      part("framed_inner_threeway_corner", {
        facing: s.facing,
        top: s.top,
        alt_slope: s.alt_slope,
      }),
      part("framed_threeway_corner", {
        facing: opposite(s.facing),
        top: bool(!isTrue(s.top)),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedElevatedDoubleSlopeEdgeBlock`
  framed_elevated_double_slope_edge: {
    properties: SLOPE_PROPERTIES,
    parts: (s) => [
      part("framed_elevated_slope_edge", {
        facing: s.facing,
        type: s.type,
        alt_slope: s.alt_slope,
      }),
      part("framed_slope_edge", {
        facing: opposite(s.facing),
        type: oppositeSlopeType(s.type),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedStackedSlopeEdgeBlock`
  framed_stacked_slope_edge: {
    properties: SLOPE_PROPERTIES,
    parts: (s) => [
      s.type === "horizontal"
        ? part("framed_vertical_stairs", { facing: s.facing })
        : part("framed_stairs", {
            facing: s.facing,
            half: s.type === "top" ? "top" : "bottom",
          }),
      part("framed_slope_edge", {
        facing: s.facing,
        type: s.type,
        alt_type: "true",
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedElevatedDoubleCornerSlopeEdgeBlock`
  framed_elev_double_corner_slope_edge: {
    properties: CORNER_PROPERTIES,
    parts: (s) => [
      part("framed_elevated_corner_slope_edge", {
        facing: s.facing,
        type: s.type,
        alt_slope: s.alt_slope,
      }),
      part("framed_inner_corner_slope_edge", {
        facing: opposite(s.facing),
        type: elevatedDoubleCornerTypeTwo(s.type),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedElevatedDoubleInnerCornerSlopeEdgeBlock`
  framed_elev_double_inner_corner_slope_edge: {
    properties: CORNER_PROPERTIES,
    parts: (s) => [
      part("framed_elevated_inner_corner_slope_edge", {
        facing: s.facing,
        type: s.type,
        alt_slope: s.alt_slope,
      }),
      part("framed_corner_slope_edge", {
        facing: opposite(s.facing),
        type: elevatedDoubleCornerTypeTwo(s.type),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedStackedCornerSlopeEdgeBlock`
  framed_stacked_corner_slope_edge: {
    properties: CORNER_PROPERTIES,
    parts: (s) => {
      let one: PartState;
      if (CornerType.isHorizontal(s.type)) {
        const right = CornerType.isRight(s.type);
        one = part("framed_vertical_stairs", {
          facing: right ? clockWise(s.facing) : s.facing,
          type: stairsType(!CornerType.isTop(s.type), right, !right),
        });
      } else {
        one = part("framed_stairs", {
          facing: s.facing,
          half: CornerType.isTop(s.type) ? "top" : "bottom",
          shape: "outer_left",
        });
      }
      return [
        one,
        part("framed_corner_slope_edge", {
          facing: s.facing,
          type: s.type,
          alt_slope: s.alt_slope,
          alt_type: "true",
        }),
      ];
    },
  },
  // `FramedStackedInnerCornerSlopeEdgeBlock`
  framed_stacked_inner_corner_slope_edge: {
    properties: CORNER_PROPERTIES,
    parts: (s) => [
      part("framed_stairs", {
        facing: s.facing,
        half: CornerType.isTop(s.type) ? "top" : "bottom",
        shape: CornerType.isRight(s.type) ? "inner_right" : "inner_left",
      }),
      part("framed_inner_corner_slope_edge", {
        facing: s.facing,
        type: s.type,
        alt_slope: s.alt_slope,
        alt_type: "true",
      }),
    ],
  },
  // `FramedElevatedDoublePrismBlock`
  framed_elevated_inner_double_prism: {
    properties: { facing_axis: DIRECTION_AXIS, alt_slope: BOOL },
    parts: (s) => {
      const [direction, axis] = s.facing_axis.split("_");
      return [
        part("framed_elevated_inner_prism", {
          facing_axis: s.facing_axis,
          alt_slope: s.alt_slope,
        }),
        part("framed_prism", {
          facing_axis: `${opposite(direction)}_${axis}`,
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
  // `FramedElevatedDoubleSlopedPrismBlock`
  framed_elevated_inner_double_sloped_prism: {
    properties: { facing_dir: COMPOUND_DIRECTION, alt_slope: BOOL },
    parts: (s) => {
      const [direction, orientation] = s.facing_dir.split("_");
      return [
        part("framed_elevated_inner_sloped_prism", {
          facing_dir: s.facing_dir,
          alt_slope: s.alt_slope,
        }),
        part("framed_sloped_prism", {
          facing_dir: `${opposite(direction)}_${orientation}`,
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
};

export const DOUBLE_BLOCK_SPECS: Readonly<Record<string, DoubleBlockSpec>> = {
  framed_double_slab: {
    properties: {},
    parts: () => [
      part("framed_slab", { top: "false" }),
      part("framed_slab", { top: "true" }),
    ],
  },
  framed_double_panel: {
    properties: { facing: HORIZONTAL },
    parts: (s) => [
      part("framed_panel", { facing: s.facing }),
      part("framed_panel", { facing: opposite(s.facing) }),
    ],
  },
  // `FramedAdjustableDoubleBlock.makeStandardParts`/`makeCopycatParts`:
  // two collapsible blocks split at the block entity's `first_height`
  // (default 8); part one collapses from `facing` (up for the slab), part
  // two from the opposite side. Only the default split is representable.
  framed_adj_double_slab: {
    properties: {},
    parts: () => [
      part("framed_slab", { top: "false" }),
      part("framed_slab", { top: "true" }),
    ],
  },
  framed_adj_double_copycat_slab: {
    properties: {},
    parts: () => [
      part("framed_slab", { top: "false" }),
      part("framed_slab", { top: "true" }),
    ],
  },
  framed_adj_double_panel: {
    properties: { facing: HORIZONTAL },
    parts: (s) => [
      part("framed_panel", { facing: opposite(s.facing) }),
      part("framed_panel", { facing: s.facing }),
    ],
  },
  framed_adj_double_copycat_panel: {
    properties: { facing: HORIZONTAL },
    parts: (s) => [
      part("framed_panel", { facing: opposite(s.facing) }),
      part("framed_panel", { facing: s.facing }),
    ],
  },
  framed_double_stairs: {
    properties: STAIRS_PROPERTIES,
    parts: (s) => {
      const top = s.half === "top";
      const below = bool(!top);
      const two: Record<string, PartState> = {
        straight: part("framed_slab_edge", {
          facing: opposite(s.facing),
          top: below,
        }),
        inner_left: part("framed_slab_corner", {
          facing: opposite(s.facing),
          top: below,
        }),
        inner_right: part("framed_slab_corner", {
          facing: counterClockWise(s.facing),
          top: below,
        }),
        outer_left: part("framed_vertical_half_stairs", {
          facing: opposite(s.facing),
          top: below,
        }),
        outer_right: part("framed_vertical_half_stairs", {
          facing: counterClockWise(s.facing),
          top: below,
        }),
      };
      return [
        part("framed_stairs", {
          facing: s.facing,
          shape: s.shape,
          half: s.half,
        }),
        two[s.shape],
      ];
    },
  },
  framed_vertical_double_stairs: {
    properties: VERTICAL_STAIRS_PROPERTIES,
    parts: (s) => {
      const f = s.facing;
      const two: Record<string, PartState> = {
        vertical: part("framed_corner_pillar", { facing: opposite(f) }),
        top_fwd: part("framed_half_stairs", {
          facing: opposite(f),
          top: "true",
        }),
        top_ccw: part("framed_half_stairs", {
          facing: clockWise(f),
          top: "true",
          right: "true",
        }),
        top_both: part("framed_vertical_stairs", {
          facing: opposite(f),
          type: "bottom_both",
        }),
        bottom_fwd: part("framed_half_stairs", { facing: opposite(f) }),
        bottom_ccw: part("framed_half_stairs", {
          facing: clockWise(f),
          right: "true",
        }),
        bottom_both: part("framed_vertical_stairs", {
          facing: opposite(f),
          type: "top_both",
        }),
      };
      return [
        part("framed_vertical_stairs", { facing: f, type: s.type }),
        two[s.type],
      ];
    },
  },
  framed_double_threeway_corner_pillar: {
    properties: { facing: HORIZONTAL, top: BOOL },
    parts: (s) => [
      part("framed_threeway_corner_pillar", { facing: s.facing, top: s.top }),
      part("framed_threeway_corner_pillar", {
        facing: opposite(s.facing),
        top: bool(!isTrue(s.top)),
      }),
    ],
  },
  framed_divided_slab: {
    properties: { facing: HORIZONTAL, top: BOOL },
    parts: (s) => [
      part("framed_slab_edge", { facing: opposite(s.facing), top: s.top }),
      part("framed_slab_edge", { facing: s.facing, top: s.top }),
    ],
  },
  framed_divided_panel_horizontal: {
    properties: { facing: HORIZONTAL },
    parts: (s) => [
      part("framed_slab_edge", { facing: s.facing, top: "false" }),
      part("framed_slab_edge", { facing: s.facing, top: "true" }),
    ],
  },
  framed_divided_panel_vertical: {
    properties: { facing: HORIZONTAL },
    parts: (s) => [
      part("framed_corner_pillar", { facing: s.facing }),
      part("framed_corner_pillar", { facing: clockWise(s.facing) }),
    ],
  },
  framed_checkered_cube: {
    properties: { alt_type: BOOL },
    parts: (s) => [
      part("framed_checkered_cube_segment", { second: s.alt_type }),
      part("framed_checkered_cube_segment", {
        second: bool(!isTrue(s.alt_type)),
      }),
    ],
  },
  framed_checkered_slab: {
    properties: { top: BOOL, alt_type: BOOL },
    parts: (s) => [
      part("framed_checkered_slab_segment", { top: s.top, second: s.alt_type }),
      part("framed_checkered_slab_segment", {
        top: s.top,
        second: bool(!isTrue(s.alt_type)),
      }),
    ],
  },
  framed_checkered_panel: {
    properties: { facing: HORIZONTAL, alt_type: BOOL },
    parts: (s) => [
      part("framed_checkered_panel_segment", {
        facing: s.facing,
        second: s.alt_type,
      }),
      part("framed_checkered_panel_segment", {
        facing: s.facing,
        second: bool(!isTrue(s.alt_type)),
      }),
    ],
  },
  framed_masonry_corner: {
    properties: { facing: HORIZONTAL, top: BOOL },
    parts: (s) => [
      part("framed_masonry_corner_segment", { facing: s.facing, top: s.top }),
      part("framed_masonry_corner_segment", {
        facing: opposite(s.facing),
        top: s.top,
      }),
    ],
  },
  framed_double_corner_board: {
    properties: { facing_dir: COMPOUND_DIRECTION },
    parts: (s) => [
      part("framed_inner_corner_board", { facing_dir: s.facing_dir }),
      part("framed_corner_board", {
        facing_dir: flipOrientation(s.facing_dir),
      }),
    ],
  },
  framed_divided_board: {
    properties: { facing_dir: COMPOUND_DIRECTION },
    parts: (s) => [
      part("framed_half_board", { facing_dir: s.facing_dir }),
      part("framed_half_board", { facing_dir: flipOrientation(s.facing_dir) }),
    ],
  },
  framed_vertical_divided_stairs: {
    properties: VERTICAL_STAIRS_PROPERTIES,
    parts: (s) => {
      const f = s.facing;
      const halfStairs = (top: boolean) =>
        part("framed_vertical_half_stairs", { facing: f, top: bool(top) });
      const parts: Record<string, [PartState, PartState]> = {
        vertical: [halfStairs(false), halfStairs(true)],
        top_fwd: [
          halfStairs(false),
          part("framed_slab_edge", {
            facing: counterClockWise(f),
            top: "true",
          }),
        ],
        top_ccw: [
          halfStairs(false),
          part("framed_slab_edge", { facing: f, top: "true" }),
        ],
        top_both: [
          halfStairs(false),
          part("framed_slab_corner", { facing: f, top: "true" }),
        ],
        bottom_fwd: [
          part("framed_slab_edge", {
            facing: counterClockWise(f),
            top: "false",
          }),
          halfStairs(true),
        ],
        bottom_ccw: [
          part("framed_slab_edge", { facing: f, top: "false" }),
          halfStairs(true),
        ],
        bottom_both: [
          part("framed_slab_corner", { facing: f, top: "false" }),
          halfStairs(true),
        ],
      };
      return parts[s.type];
    },
  },
  framed_vertical_double_half_stairs: {
    properties: { facing: HORIZONTAL, top: BOOL },
    parts: (s) => [
      part("framed_vertical_half_stairs", { facing: s.facing, top: s.top }),
      part("framed_slab_corner", { facing: opposite(s.facing), top: s.top }),
    ],
  },
  framed_divided_stairs: {
    properties: STAIRS_PROPERTIES,
    parts: (s) => {
      const f = s.facing;
      const top = bool(s.half === "top");
      const halfStairs = (right: boolean) =>
        part("framed_half_stairs", { facing: f, top, right: bool(right) });
      const parts: Record<string, [PartState, PartState]> = {
        straight: [halfStairs(false), halfStairs(true)],
        inner_left: [
          part("framed_panel", { facing: counterClockWise(f) }),
          halfStairs(true),
        ],
        inner_right: [
          halfStairs(false),
          part("framed_panel", { facing: clockWise(f) }),
        ],
        outer_left: [
          halfStairs(false),
          part("framed_slab_edge", { facing: clockWise(f), top }),
        ],
        outer_right: [
          part("framed_slab_edge", { facing: counterClockWise(f), top }),
          halfStairs(true),
        ],
      };
      return parts[s.shape];
    },
  },
  framed_split_pillar_socket: {
    properties: { facing: FACING },
    parts: (s) => [
      isY(s.facing)
        ? part("framed_slab", { top: bool(s.facing === "up") })
        : part("framed_panel", { facing: s.facing }),
      part("framed_half_pillar", { facing: opposite(s.facing) }),
    ],
  },
  framed_double_half_stairs: {
    properties: { facing: HORIZONTAL, top: BOOL, right: BOOL },
    parts: (s) => {
      const right = isTrue(s.right);
      return [
        part("framed_half_stairs", {
          facing: s.facing,
          top: s.top,
          right: s.right,
        }),
        part("framed_slab_corner", {
          facing: right ? opposite(s.facing) : counterClockWise(s.facing),
          top: bool(!isTrue(s.top)),
        }),
      ];
    },
  },
  framed_sliced_stairs_slab: {
    properties: STAIRS_PROPERTIES,
    parts: (s) => {
      const f = s.facing;
      const top = s.half === "top";
      const above = bool(!top);
      const two: Record<string, PartState> = {
        straight: part("framed_slab_edge", { facing: f, top: above }),
        inner_left: part("framed_vertical_half_stairs", {
          facing: f,
          top: above,
        }),
        inner_right: part("framed_vertical_half_stairs", {
          facing: clockWise(f),
          top: above,
        }),
        outer_left: part("framed_slab_corner", { facing: f, top: above }),
        outer_right: part("framed_slab_corner", {
          facing: clockWise(f),
          top: above,
        }),
      };
      return [part("framed_slab", { top: bool(top) }), two[s.shape]];
    },
  },
  framed_sliced_stairs_panel: {
    properties: STAIRS_PROPERTIES,
    parts: (s) => {
      const f = s.facing;
      const top = bool(s.half === "top");
      const parts: Record<string, [PartState, PartState]> = {
        straight: [
          part("framed_panel", { facing: f }),
          part("framed_slab_edge", { facing: opposite(f), top }),
        ],
        inner_left: [
          part("framed_vertical_stairs", { facing: f }),
          part("framed_slab_corner", { facing: opposite(f), top }),
        ],
        inner_right: [
          part("framed_vertical_stairs", { facing: clockWise(f) }),
          part("framed_slab_corner", { facing: counterClockWise(f), top }),
        ],
        outer_left: [
          part("framed_corner_pillar", { facing: f }),
          part("framed_vertical_half_stairs", { facing: opposite(f), top }),
        ],
        outer_right: [
          part("framed_corner_pillar", { facing: clockWise(f) }),
          part("framed_vertical_half_stairs", {
            facing: counterClockWise(f),
            top,
          }),
        ],
      };
      return parts[s.shape];
    },
  },
  framed_vertical_sliced_stairs: {
    properties: { ...VERTICAL_STAIRS_PROPERTIES, right: BOOL },
    parts: (s) => {
      const f = s.facing;
      const ccw = counterClockWise(f);
      const cw = clockWise(f);
      if (isTrue(s.right)) {
        const halfStairs = (top: boolean) =>
          part("framed_half_stairs", {
            facing: ccw,
            right: "true",
            top: bool(top),
          });
        const pillar = part("framed_corner_pillar", { facing: ccw });
        const panel = part("framed_panel", { facing: f });
        const corner = (top: boolean) =>
          part("framed_slab_corner", { facing: ccw, top: bool(top) });
        const parts: Record<string, [PartState, PartState]> = {
          vertical: [panel, pillar],
          top_fwd: [halfStairs(false), pillar],
          top_ccw: [panel, corner(false)],
          top_both: [halfStairs(false), corner(false)],
          bottom_fwd: [halfStairs(true), pillar],
          bottom_ccw: [panel, corner(true)],
          bottom_both: [halfStairs(true), corner(true)],
        };
        return parts[s.type];
      }
      const halfStairs = (top: boolean) =>
        part("framed_half_stairs", { facing: f, top: bool(top) });
      const pillar = part("framed_corner_pillar", { facing: cw });
      const panel = part("framed_panel", { facing: ccw });
      const corner = (top: boolean) =>
        part("framed_slab_corner", { facing: cw, top: bool(top) });
      const parts: Record<string, [PartState, PartState]> = {
        vertical: [panel, pillar],
        top_fwd: [panel, corner(false)],
        top_ccw: [halfStairs(false), pillar],
        top_both: [halfStairs(false), corner(false)],
        bottom_fwd: [panel, corner(true)],
        bottom_ccw: [halfStairs(true), pillar],
        bottom_both: [halfStairs(true), corner(true)],
      };
      return parts[s.type];
    },
  },
  ...SLOPE_DOUBLE_BLOCK_SPECS,
};

/** `CompoundDirection.of(dir.direction(), dir.orientation().getOpposite())`. */
function flipOrientation(facingDir: string): string {
  const [direction, orientation] = facingDir.split("_");
  return `${direction}_${opposite(orientation)}`;
}
