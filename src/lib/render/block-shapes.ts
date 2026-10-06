// Sub-block shapes for the static renders: stairs, slabs, fences, panes,
// walls, doors, trapdoors and carpets as the boxes of their vanilla models
// (`public/minecraft-assets/models.json`; `__tests__/block-shapes.test.ts`
// checks them against it). Every other block is a full cube.
//
// Pure: no DOM.

/** An axis-aligned box in block-local coordinates (0–1): x0, y0, z0, x1, y1, z1. */
export type ShapeBox = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

type Facing = "north" | "east" | "south" | "west";

// Clockwise quarter turns (seen from above) from east, the facing the
// vanilla models are drawn for.
const TURNS: Record<Facing, number> = { east: 0, south: 1, west: 2, north: 3 };
const FACINGS: readonly Facing[] = ["north", "east", "south", "west"];

const isFacing = (value: string | undefined): value is Facing =>
  value !== undefined && (FACINGS as readonly string[]).includes(value);

// A box given in sixteenths.
const px = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): ShapeBox => [x0 / 16, y0 / 16, z0 / 16, x1 / 16, y1 / 16, z1 / 16];

/** `box` turned clockwise (seen from above) by `turns` quarter turns. */
function turn(box: ShapeBox, turns: number): ShapeBox {
  const [, y0, , , y1] = box;
  let [x0, , z0, x1, , z1] = box;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) {
    // (x, z) → (1 - z, x), as a model's `y: 90`.
    [x0, z0, x1, z1] = [1 - z1, x0, 1 - z0, x1];
  }
  return [x0, y0, z0, x1, y1, z1];
}

// The four connection properties, with the turns from north (the side the
// vanilla side models are drawn for).
const SIDES: readonly [Facing, number][] = [
  ["north", 0],
  ["east", 1],
  ["south", 2],
  ["west", 3],
];

const hasSides = (properties: Record<string, string>) =>
  SIDES.some(([side]) => side in properties);

function stairs(properties: Record<string, string>): ShapeBox[] | undefined {
  const { facing, half, shape = "straight" } = properties;
  if (!isFacing(facing) || (half !== "bottom" && half !== "top")) {
    return undefined;
  }
  // The step's footprint for a stair facing east: the east half, a quarter
  // of it (outer), or it plus a west quarter (inner).
  const steps: Record<string, [number, number, number, number][]> = {
    straight: [[0.5, 0, 1, 1]],
    outer_right: [[0.5, 0.5, 1, 1]],
    outer_left: [[0.5, 0, 1, 0.5]],
    inner_right: [
      [0.5, 0, 1, 1],
      [0, 0.5, 0.5, 1],
    ],
    inner_left: [
      [0.5, 0, 1, 1],
      [0, 0, 0.5, 0.5],
    ],
  };
  const footprint = steps[shape];
  if (footprint === undefined) return undefined;
  const [slabY, stepY] = half === "bottom" ? [0, 0.5] : [0.5, 0];
  return [
    [0, slabY, 0, 1, slabY + 0.5, 1],
    ...footprint.map(([x0, z0, x1, z1]) =>
      turn([x0, stepY, z0, x1, stepY + 0.5, z1], TURNS[facing]),
    ),
  ];
}

function slab(properties: Record<string, string>): ShapeBox[] | undefined {
  // Pre-1.13 slabs say `half`; double slabs are their own block there.
  const type = properties.type ?? properties.half;
  if (type === "bottom") return [[0, 0, 0, 1, 0.5, 1]];
  if (type === "top") return [[0, 0.5, 0, 1, 1, 1]];
  return undefined;
}

function connected(
  properties: Record<string, string>,
  post: ShapeBox[],
  side: (value: string) => ShapeBox[],
): ShapeBox[] {
  const boxes = [...post];
  for (const [name, turns] of SIDES) {
    const value = properties[name];
    if (value === undefined) continue;
    boxes.push(...side(value).map((box) => turn(box, turns)));
  }
  return boxes;
}

function fence(properties: Record<string, string>): ShapeBox[] | undefined {
  if (!hasSides(properties)) return undefined;
  return connected(properties, [px(6, 0, 6, 10, 16, 10)], (value) =>
    value === "true" ? [px(7, 12, 0, 9, 15, 9), px(7, 6, 0, 9, 9, 9)] : [],
  );
}

function pane(properties: Record<string, string>): ShapeBox[] | undefined {
  if (!hasSides(properties)) return undefined;
  return connected(properties, [px(7, 0, 7, 9, 16, 9)], (value) =>
    value === "true" ? [px(7, 0, 0, 9, 16, 7)] : [],
  );
}

function wall(properties: Record<string, string>): ShapeBox[] | undefined {
  if (!hasSides(properties) && properties.up === undefined) return undefined;
  // Pre-1.16 walls connect with `true`, as a low side.
  return connected(
    properties,
    properties.up === "false" ? [] : [px(4, 0, 4, 12, 16, 12)],
    (value) =>
      value === "tall"
        ? [px(5, 0, 0, 11, 16, 8)]
        : value === "low" || value === "true"
          ? [px(5, 0, 0, 11, 14, 8)]
          : [],
  );
}

// A 3/16 thick panel against the side opposite `facing`.
const panel = (facing: Facing): ShapeBox =>
  turn(px(0, 0, 0, 3, 16, 16), TURNS[facing]);

function door(properties: Record<string, string>): ShapeBox[] | undefined {
  const { facing, open, hinge } = properties;
  if (!isFacing(facing)) return undefined;
  if (open !== "true") return [panel(facing)];
  // An open door swings a quarter turn about its hinge.
  const turns = hinge === "right" ? 3 : 1;
  return [panel(FACINGS[(FACINGS.indexOf(facing) + turns) % 4])];
}

function trapdoor(properties: Record<string, string>): ShapeBox[] | undefined {
  const { facing, half, open } = properties;
  if (open === "true") return isFacing(facing) ? [panel(facing)] : undefined;
  if (half === "top") return [px(0, 13, 0, 16, 16, 16)];
  return [px(0, 0, 0, 16, 3, 16)];
}

const CARPET: ShapeBox[] = [px(0, 0, 0, 16, 1, 16)];

const SHAPES_BY_KIND: ReadonlyMap<
  string,
  (properties: Record<string, string>) => ShapeBox[] | undefined
> = new Map([
  ["stairs", stairs],
  ["slab", slab],
  ["fence", fence],
  ["pane", pane],
  ["wall", wall],
  ["door", door],
  ["trapdoor", trapdoor],
  ["carpet", () => CARPET],
]);

/**
 * The boxes a block of shape `kind` (the block registry's vocabulary:
 * `stairs`, `slab`, `fence`, `pane`, `wall`, `door`, `trapdoor`, `carpet`)
 * with `properties` is drawn as, or `undefined` for a full cube (any other
 * kind, or properties its shape can't use). For mod blocks, whose names say
 * nothing reliable.
 */
export function blockShapeOfKind(
  kind: string,
  properties: Record<string, string>,
): readonly ShapeBox[] | undefined {
  return SHAPES_BY_KIND.get(kind)?.(properties);
}

/** The shape kind a block's name gives away, by its suffix. */
function kindOfName(blockId: string): string | undefined {
  const name = blockId.slice(blockId.indexOf(":") + 1);
  if (name.endsWith("_stairs")) return "stairs";
  if (name.endsWith("_slab")) return "slab";
  if (name.endsWith("_fence")) return "fence";
  if (name.endsWith("_pane") || name.endsWith("_bars")) return "pane";
  if (name.endsWith("_wall")) return "wall";
  if (name.endsWith("_door")) return "door";
  if (name.endsWith("trapdoor")) return "trapdoor";
  if (name.endsWith("carpet")) return "carpet";
  return undefined;
}

/**
 * The boxes `blockId` with `properties` is drawn as in the static renders, or
 * `undefined` for a full cube (every block that isn't one of the shapes
 * above, or lacks the properties its shape needs).
 */
export function blockShape(
  blockId: string,
  properties: Record<string, string>,
): readonly ShapeBox[] | undefined {
  const kind = kindOfName(blockId);
  return kind === undefined ? undefined : blockShapeOfKind(kind, properties);
}
