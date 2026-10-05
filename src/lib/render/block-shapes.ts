// Sub-block shapes for the static renders: stairs, slabs, fences, panes,
// walls, doors, trapdoors and carpets drawn as the boxes they really fill,
// so roofs and details read correctly in the contact sheet. Every other
// block is a full cube.
//
// Pure: no DOM. Shapes follow the vanilla outline shapes of the modern
// (1.13+) block states; legacy states are translated before rendering
// (`display-translation.ts`).

/** An axis-aligned box in block-local 0–1 coordinates: [x0, y0, z0, x1, y1, z1]. */
export type BlockBox = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

type Properties = Readonly<Record<string, string>>;
type Side = "north" | "south" | "east" | "west";

const px = (n: number) => n / 16;

const SIDES: readonly Side[] = ["north", "south", "east", "west"];

// The half (or the quarter, with `across`) of the block towards `side`, as an
// x and z range.
function sideRange(side: Side): [[number, number], [number, number]] {
  switch (side) {
    case "north":
      return [
        [0, 1],
        [0, 0.5],
      ];
    case "south":
      return [
        [0, 1],
        [0.5, 1],
      ];
    case "west":
      return [
        [0, 0.5],
        [0, 1],
      ];
    case "east":
      return [
        [0.5, 1],
        [0, 1],
      ];
  }
}

function clockwise(side: Side): Side {
  return (
    { north: "east", east: "south", south: "west", west: "north" } as const
  )[side];
}

function counterClockwise(side: Side): Side {
  return (
    { north: "west", west: "south", south: "east", east: "north" } as const
  )[side];
}

function opposite(side: Side): Side {
  return (
    { north: "south", south: "north", east: "west", west: "east" } as const
  )[side];
}

function asSide(value: string | undefined, fallback: Side): Side {
  return value !== undefined && (SIDES as readonly string[]).includes(value)
    ? (value as Side)
    : fallback;
}

// The x/z footprint of the quarter where `a` and `b` (perpendicular) meet.
function quarter(a: Side, b: Side): [[number, number], [number, number]] {
  const [ax, az] = sideRange(a);
  const [bx, bz] = sideRange(b);
  return [
    [Math.max(ax[0], bx[0]), Math.min(ax[1], bx[1])],
    [Math.max(az[0], bz[0]), Math.min(az[1], bz[1])],
  ];
}

function box(
  [x0, x1]: [number, number],
  [y0, y1]: [number, number],
  [z0, z1]: [number, number],
): BlockBox {
  return [x0, y0, z0, x1, y1, z1];
}

function stairs(properties: Properties): BlockBox[] {
  const facing = asSide(properties.facing, "north");
  const top = properties.half === "top";
  const base: [number, number] = top ? [0.5, 1] : [0, 0.5];
  const step: [number, number] = top ? [0, 0.5] : [0.5, 1];
  const boxes = [box([0, 1], base, [0, 1])];
  const add = ([x, z]: [[number, number], [number, number]]) =>
    boxes.push(box(x, step, z));
  switch (properties.shape) {
    case "outer_left":
      add(quarter(facing, counterClockwise(facing)));
      break;
    case "outer_right":
      add(quarter(facing, clockwise(facing)));
      break;
    case "inner_left":
      add(sideRange(facing));
      add(quarter(opposite(facing), counterClockwise(facing)));
      break;
    case "inner_right":
      add(sideRange(facing));
      add(quarter(opposite(facing), clockwise(facing)));
      break;
    default:
      add(sideRange(facing));
  }
  return boxes;
}

function slab(properties: Properties): BlockBox[] | null {
  switch (properties.type ?? properties.half) {
    case "double":
      return null;
    case "top":
      return [box([0, 1], [0.5, 1], [0, 1])];
    default:
      return [box([0, 1], [0, 0.5], [0, 1])];
  }
}

// A centred post `post` wide and one arm per connected side, `arm` wide.
// `connected` gives each side's arm y ranges (none when unconnected).
function postAndArms(
  connected: (side: Side) => [number, number][],
  post: number,
  postHeight: [number, number] | null,
  arm: number,
): BlockBox[] {
  const p0 = 0.5 - post / 2;
  const p1 = 0.5 + post / 2;
  const a0 = 0.5 - arm / 2;
  const a1 = 0.5 + arm / 2;
  const boxes: BlockBox[] = [];
  if (postHeight !== null) boxes.push(box([p0, p1], postHeight, [p0, p1]));
  // Arms run from the edge to the post, or to the centre when there is none.
  const inner0 = postHeight !== null ? p0 : 0.5;
  const inner1 = postHeight !== null ? p1 : 0.5;
  for (const side of SIDES) {
    for (const y of connected(side)) {
      switch (side) {
        case "north":
          boxes.push(box([a0, a1], y, [0, inner0]));
          break;
        case "south":
          boxes.push(box([a0, a1], y, [inner1, 1]));
          break;
        case "west":
          boxes.push(box([0, inner0], y, [a0, a1]));
          break;
        case "east":
          boxes.push(box([inner1, 1], y, [a0, a1]));
          break;
      }
    }
  }
  return boxes;
}

const isTrue = (value: string | undefined) => value === "true";

function fence(properties: Properties): BlockBox[] {
  const rails: [number, number][] = [
    [px(6), px(9)],
    [px(12), px(15)],
  ];
  return postAndArms(
    (side) => (isTrue(properties[side]) ? rails : []),
    px(4),
    [0, 1],
    px(2),
  );
}

function pane(properties: Properties): BlockBox[] {
  return postAndArms(
    (side) => (isTrue(properties[side]) ? [[0, 1]] : []),
    px(2),
    [0, 1],
    px(2),
  );
}

function wall(properties: Properties): BlockBox[] {
  // 1.16+ uses none/low/tall; 1.13–1.15 used booleans (low).
  const height = (side: Side): [number, number][] => {
    switch (properties[side]) {
      case "low":
      case "true":
        return [[0, px(14)]];
      case "tall":
        return [[0, 1]];
      default:
        return [];
    }
  };
  const up = properties.up === undefined || isTrue(properties.up);
  return postAndArms(height, px(8), up ? [0, 1] : null, px(6));
}

// A 3px panel against one side of the block.
function panel(side: Side): BlockBox {
  const t = px(3);
  switch (side) {
    case "north":
      return box([0, 1], [0, 1], [0, t]);
    case "south":
      return box([0, 1], [0, 1], [1 - t, 1]);
    case "west":
      return box([0, t], [0, 1], [0, 1]);
    case "east":
      return box([1 - t, 1], [0, 1], [0, 1]);
  }
}

function door(properties: Properties): BlockBox[] {
  const facing = asSide(properties.facing, "north");
  // A closed door sits against the side opposite `facing`; an open one
  // swings onto the side its hinge is on.
  if (!isTrue(properties.open)) return [panel(opposite(facing))];
  return [
    panel(
      properties.hinge === "right"
        ? clockwise(facing)
        : counterClockwise(facing),
    ),
  ];
}

function trapdoor(properties: Properties): BlockBox[] {
  if (isTrue(properties.open)) {
    return [panel(opposite(asSide(properties.facing, "north")))];
  }
  const t = px(3);
  return [
    properties.half === "top"
      ? box([0, 1], [1 - t, 1], [0, 1])
      : box([0, 1], [0, t], [0, 1]),
  ];
}

const CARPET: BlockBox[] = [box([0, 1], [0, px(1)], [0, 1])];

const PANES = new Set(["minecraft:iron_bars"]);

/**
 * The boxes `blockId` in state `properties` fills, or null for a full cube
 * (every block that isn't a stair, slab, fence, pane, wall, door, trapdoor
 * or carpet, and double slabs).
 */
export function blockShape(
  blockId: string,
  properties: Properties,
): BlockBox[] | null {
  const name = blockId.slice(blockId.indexOf(":") + 1);
  if (name.endsWith("_stairs")) return stairs(properties);
  if (name.endsWith("_slab")) return slab(properties);
  if (name.endsWith("_fence")) return fence(properties);
  if (name.endsWith("_pane") || PANES.has(blockId)) return pane(properties);
  if (name.endsWith("_wall")) return wall(properties);
  if (name.endsWith("_trapdoor")) return trapdoor(properties);
  if (name.endsWith("_door")) return door(properties);
  if (name.endsWith("_carpet")) return CARPET;
  return null;
}
