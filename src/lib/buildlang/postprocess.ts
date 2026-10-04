// Neighbour-dependent block states (port of Cairn's `cairn/postprocess.py`).
// The game computes these when a player places a block; a pasted schematic
// keeps whatever it carries, so the compiler computes them itself:
//
// - stair `shape` (inner and outer corners), Minecraft's
//   `StairBlock.getStairsShape`;
// - pane, iron bar, fence and wall side connections, after the game's
//   `connectsTo` rules: panes and bars join each other, fences join fences of
//   their kind (wooden or nether brick), walls join walls, all of them join a
//   fence gate that lines up with them and a full block's sturdy face, and
//   from 1.16 walls and panes also join each other. Walls from 1.16 have
//   `none`/`low`/`tall` sides (tall under a block that covers the side) and
//   the game's post rule; before that, boolean sides and a post unless the
//   wall runs straight with air above.
//
// Only properties the target version's block has are written, with values it
// allows. There is no collision data in the registry, so "full block" goes by
// the block's kind (Cairn: `is_full_opaque`): plain blocks, logs, pillars and
// glass, double slabs and the back of stairs, minus the blocks the game
// refuses to connect to (leaves, pumpkins, melons, barriers, shulker boxes)
// and a few plain-kind blocks that are plainly not cubes. Worker-safe.

import type { BlockRegistry } from "../blockdata/registry";
import type { BlockGrid, PlacedBlock, Pos } from "./writes";

type Horizontal = "north" | "east" | "south" | "west";

const HORIZONTALS: readonly Horizontal[] = ["north", "east", "south", "west"];

const STEP: Readonly<Record<Horizontal, Pos>> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
};

const CLOCKWISE: Readonly<Record<Horizontal, Horizontal>> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};

const OPPOSITE: Readonly<Record<Horizontal, Horizontal>> = {
  north: "south",
  east: "west",
  south: "north",
  west: "east",
};

const COUNTER_CLOCKWISE: Readonly<Record<Horizontal, Horizontal>> = {
  north: "west",
  east: "north",
  south: "east",
  west: "south",
};

const isHorizontal = (v: string | undefined): v is Horizontal =>
  v !== undefined && Object.hasOwn(STEP, v);

const sameAxis = (a: Horizontal, b: Horizontal) => a === b || a === OPPOSITE[b];

// `isExceptionForConnection`: full blocks fences, panes and walls skip.
const NEVER_CONNECT =
  /^minecraft:(barrier|pumpkin|carved_pumpkin|jack_o_lantern|melon|(\w+_)?shulker_box)$/;

// Plain-kind blocks whose sides are not full faces.
const NOT_FULL =
  /^minecraft:(\w+_)?(anvil|bell|brewing_stand|cake|campfire|candle|chain|cobweb|conduit|dragon_egg|enchanting_table|end_rod|grindstone|hopper|lectern|lily_pad|sea_pickle|snow|scaffolding|stonecutter|turtle_egg|rail|head|skull|daylight_detector|comparator|repeater|redstone_wire|tripwire|tripwire_hook|cactus|bamboo|cocoa|amethyst_cluster|\w+_bud|pointed_dripstone|azalea|flowering_azalea|big_dripleaf|small_dripleaf|decorated_pot)$/;

// Wall posts rise under these (`#wall_post_override`).
const POST_OVERRIDE_KINDS = new Set([
  "torch",
  "sign",
  "banner",
  "pressure_plate",
]);

interface Cell {
  id: string;
  /** Registry defaults overlaid with the placed states. */
  state: Record<string, string>;
  kind: string;
}

type Connector = "pane" | "fence" | "wall";

/** Sets the neighbour-dependent states of every block in `grid`, in place. */
export function postprocess(grid: BlockGrid, registry: BlockRegistry): void {
  const cellAt = (pos: Pos): Cell | null => {
    const block = grid.get(pos);
    if (!block) return null;
    return {
      id: block.id,
      state: { ...registry.defaults(block.id), ...block.states },
      kind: registry.kind(block.id),
    };
  };
  const writeStates = (
    pos: Pos,
    block: PlacedBlock,
    states: Record<string, string>,
  ) => {
    const properties = registry.properties(block.id) ?? {};
    const next = { ...block.states };
    let changed = false;
    for (const [name, value] of Object.entries(states)) {
      if (!properties[name]?.includes(value) || next[name] === value) continue;
      next[name] = value;
      changed = true;
    }
    if (changed) grid.set(pos, { id: block.id, states: next });
  };

  // Stairs first, against the placed stairs, so connections see the corners.
  const stairs: [Pos, PlacedBlock, string][] = [];
  for (const [pos, block] of grid.entries()) {
    if (registry.kind(block.id) !== "stairs") continue;
    if (!registry.properties(block.id)?.shape) continue;
    const own = block.states.shape;
    if (own !== undefined && own !== "straight") continue;
    const shape = stairShape(cellAt, pos);
    if (shape !== "straight") stairs.push([pos, block, shape]);
  }
  for (const [pos, block, shape] of stairs) writeStates(pos, block, { shape });

  // Wall/pane cross-connections arrived in 1.16, with the none/low/tall sides.
  const modern =
    registry
      .properties("minecraft:cobblestone_wall")
      ?.north?.includes("low") === true;

  const connections = new Map<string, Record<Horizontal, boolean>>();
  const connectors: [Pos, PlacedBlock, Connector][] = [];
  for (const [pos, block] of grid.entries()) {
    const kind = registry.kind(block.id);
    if (kind !== "pane" && kind !== "fence" && kind !== "wall") continue;
    const sides = {} as Record<Horizontal, boolean>;
    for (const dir of HORIZONTALS) {
      sides[dir] = connects(
        kind,
        block.id,
        dir,
        cellAt(step(pos, dir)),
        modern,
      );
    }
    connections.set(String(pos), sides);
    connectors.push([pos, block, kind]);
  }

  // Top down, so a wall knows whether the wall above it has a post.
  connectors.sort(([a], [b]) => b[1] - a[1]);
  const posts = new Map<string, boolean>();
  for (const [pos, block, kind] of connectors) {
    const sides = connections.get(String(pos))!;
    const domain = registry.properties(block.id)?.north ?? [];
    if (kind !== "wall" || !domain.includes("low")) {
      const states: Record<string, string> = {};
      for (const dir of HORIZONTALS) states[dir] = String(sides[dir]);
      if (kind === "wall") {
        const straight =
          (sides.north && sides.south && !sides.east && !sides.west) ||
          (sides.east && sides.west && !sides.north && !sides.south);
        states.up = String(!straight || grid.get(above(pos)) !== null);
      }
      writeStates(pos, block, states);
      continue;
    }
    const up = above(pos);
    const top = cellAt(up);
    const topSides = connections.get(String(up));
    const states: Record<string, string> = {};
    for (const dir of HORIZONTALS) {
      states[dir] = !sides[dir]
        ? "none"
        : coversSide(top, topSides, dir)
          ? "tall"
          : "low";
    }
    const post = wallPost(states, top, posts.get(String(up)));
    posts.set(String(pos), post);
    states.up = String(post);
    writeStates(pos, block, states);
  }
}

function step(pos: Pos, dir: Horizontal): Pos {
  const [dx, , dz] = STEP[dir];
  return [pos[0] + dx, pos[1], pos[2] + dz];
}

const above = (pos: Pos): Pos => [pos[0], pos[1] + 1, pos[2]];

/** Port of Minecraft's `StairBlock.getStairsShape`. */
function stairShape(cellAt: (pos: Pos) => Cell | null, pos: Pos): string {
  const self = cellAt(pos)!;
  const facing = self.state.facing;
  const half = self.state.half;
  if (!isHorizontal(facing)) return "straight";
  const stairFacing = (dir: Horizontal): Horizontal | null => {
    const other = cellAt(step(pos, dir));
    if (other?.kind !== "stairs" || other.state.half !== half) return null;
    return isHorizontal(other.state.facing) ? other.state.facing : null;
  };
  // A neighbour stair facing the same way would continue the straight run.
  const canTakeShape = (dir: Horizontal) => stairFacing(dir) !== facing;

  const back = stairFacing(facing);
  if (back && !sameAxis(back, facing) && canTakeShape(OPPOSITE[back])) {
    return back === COUNTER_CLOCKWISE[facing] ? "outer_left" : "outer_right";
  }
  const front = stairFacing(OPPOSITE[facing]);
  if (front && !sameAxis(front, facing) && canTakeShape(front)) {
    return front === COUNTER_CLOCKWISE[facing] ? "inner_left" : "inner_right";
  }
  return "straight";
}

/** Whether a pane, fence or wall at some cell joins `other`, `dir` of it. */
function connects(
  kind: Connector,
  id: string,
  dir: Horizontal,
  other: Cell | null,
  modern: boolean,
): boolean {
  if (!other) return false;
  if (sturdyFace(other, OPPOSITE[dir])) return true;
  if (other.kind === "fence_gate") {
    // The gate lines up when it faces across the connection.
    if (kind === "pane") return false;
    const facing = other.state.facing;
    return isHorizontal(facing) && sameAxis(facing, CLOCKWISE[dir]);
  }
  switch (kind) {
    case "pane":
      return other.kind === "pane" || (modern && other.kind === "wall");
    case "fence":
      return (
        other.kind === "fence" &&
        (other.id === NETHER_BRICK_FENCE) === (id === NETHER_BRICK_FENCE)
      );
    case "wall":
      return other.kind === "wall" || (modern && other.kind === "pane");
  }
}

const NETHER_BRICK_FENCE = "minecraft:nether_brick_fence";

/** Whether `cell`'s face towards `face` is full (from its kind and state). */
function sturdyFace(cell: Cell, face: Horizontal): boolean {
  if (NEVER_CONNECT.test(cell.id)) return false;
  switch (cell.kind) {
    case "block":
      return !NOT_FULL.test(cell.id);
    case "log":
    case "pillar":
    case "glass":
      return true;
    case "slab":
      return cell.state.type === "double";
    case "stairs":
      return (
        cell.state.facing === face && !cell.state.shape?.startsWith("outer")
      );
    default:
      return false;
  }
}

/** Whether the block above has a full bottom face (a wall side goes tall). */
function fullBottom(cell: Cell): boolean {
  switch (cell.kind) {
    case "block":
      return !NOT_FULL.test(cell.id);
    case "log":
    case "pillar":
    case "glass":
    case "leaves":
    case "carpet":
      return true;
    case "slab":
      return cell.state.type !== "top";
    case "stairs":
      return cell.state.half !== "top";
    default:
      return false;
  }
}

// A wall side is tall when the block above covers it: a full bottom face, or
// a wall or pane above running the same way.
function coversSide(
  top: Cell | null,
  topSides: Record<Horizontal, boolean> | undefined,
  dir: Horizontal,
): boolean {
  if (!top) return false;
  if (fullBottom(top)) return true;
  return (
    (top.kind === "wall" || top.kind === "pane") && topSides?.[dir] === true
  );
}

// `WallBlock.shouldRaisePost`, with the block above's bottom judged by kind.
function wallPost(
  sides: Record<string, string>,
  top: Cell | null,
  topPost: boolean | undefined,
): boolean {
  if (top?.kind === "wall" && topPost) return true;
  const none = (dir: Horizontal) => sides[dir] === "none";
  if (
    HORIZONTALS.every(none) ||
    none("north") !== none("south") ||
    none("east") !== none("west")
  ) {
    return true;
  }
  if (
    (sides.north === "tall" && sides.south === "tall") ||
    (sides.east === "tall" && sides.west === "tall")
  ) {
    return false;
  }
  if (!top) return false;
  return (
    POST_OVERRIDE_KINDS.has(top.kind) ||
    fullBottom(top) ||
    ["wall", "pane", "fence", "lantern", "pot", "chest"].includes(top.kind)
  );
}
