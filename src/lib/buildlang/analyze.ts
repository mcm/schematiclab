// Deterministic checks of a compiled build (port of Cairn's
// `cairn/metrics.py`), fed back to the agent with the render: connectivity,
// enclosure at half-block resolution, symmetry, feature counts, blocked doors
// and top materials. `formatReport` lays it out like Cairn's
// `samples/*.report.md`. Worker-safe.
//
// Differences from Cairn: flood fill and component labelling are done here
// (no scipy), a block's 2×2×2 occupancy comes from its kind and state (no
// collision geometry), and every finding that came from an operation names
// its program path.

import type { BlockKind, BlockRegistry } from "../blockdata/registry";
import type { CompileResult } from "./compiler";
import type { RoofInfo } from "./roofs";
import { formatProgramError, type ProgramError } from "./program";
import type { PlacedBlock, Pos } from "./writes";

/** Smallest enclosed space (in blocks) the report lists as a room. */
export const MIN_ROOM_BLOCKS = 8;

const MAX_ROOMS = 10;
const MAX_FLOATING = 8;
const MAX_MATERIALS = 12;
const MAX_NOTES = 20;
const MAX_LEAK_EXAMPLES = 4;

/**
 * Most half-block cells the enclosure flood fill visits (about a 128-block
 * cube's bounding box). Bigger bounding boxes skip it: a 256-block cube would
 * need ~137 million cells and several seconds.
 */
export const MAX_ENCLOSURE_CELLS = 24_000_000;

export interface FloatingPiece {
  blocks: number;
  /** The piece's lowest block (lowest y, then z, then x). */
  example: Pos;
  /** Up to four block ids (without `minecraft:`), sorted. */
  materials: string[];
  /** The program path that placed `example`. */
  path: string | null;
}

export interface BlockedDoor {
  /** The lower half of the door. */
  door: Pos;
  doorPath: string | null;
  /** The feet cell on the blocked side. */
  side: Pos;
  /** The solid block in the way (without `minecraft:`) and where it is. */
  by: string;
  at: Pos;
  byPath: string | null;
}

/** A roof whose underside outside air reaches. */
export interface RoofLeak {
  /** The roof operations' program paths, joined. */
  roof: string;
  /** Columns under the roof (no overhang) where outside air gets in. */
  columns: number;
  /** The lowest leaking cells (y, then x, then z), up to four. */
  examples: Pos[];
  /** World y of the eave. */
  eaveY: number;
}

export interface Features {
  doors: number;
  window_blocks: number;
  stairs: number;
  slabs: number;
  light_sources: number;
}

export interface Analysis {
  name: string;
  size: Pos;
  blockCount: number;
  /** Blocks written outside the build size and dropped. */
  outOfBounds: number;
  /** Occupied bounding box, or null for an empty build. */
  bbox: { min: Pos; max: Pos; dims: Pos } | null;
  /** Pieces connected through faces or edges. */
  components: number;
  /** The largest pieces whose lowest block is above the lowest layer. */
  floating: FloatingPiece[];
  floatingCount: number;
  /**
   * Blocks of air sealed from the outside (half-block resolution), or null
   * when the bounding box is too big to measure (`MAX_ENCLOSURE_CELLS`).
   */
  enclosedAir: number | null;
  /** Sealed spaces of at least `MIN_ROOM_BLOCKS` blocks, largest first. */
  enclosedSpaces: number[];
  /**
   * Roofs outside air gets under (empty when enclosure isn't measured,
   * like `enclosedAir`).
   */
  roofLeaks: RoofLeak[];
  /** Share of blocks matching their mirror image, 0–1 (3 decimals). */
  symmetry: { leftRight: number; frontBack: number };
  features: Features;
  blockedDoors: BlockedDoor[];
  /** Most used block ids (without `minecraft:`) with counts. */
  materials: [string, number][];
}

const shortId = (id: string) => id.replace(/^minecraft:/, "");

// 18-neighbourhood (faces and edges): roof stairs and slabs legitimately touch
// only along edges.
const N18: readonly Pos[] = (() => {
  const out: Pos[] = [];
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      for (const c of [-1, 0, 1]) {
        const n = Math.abs(a) + Math.abs(b) + Math.abs(c);
        if (n > 0 && n <= 2) out.push([a, b, c]);
      }
    }
  }
  return out;
})();

const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};
const COUNTER_CLOCKWISE: Readonly<Record<string, string>> = {
  north: "west",
  west: "south",
  south: "east",
  east: "north",
};
const CLOCKWISE: Readonly<Record<string, string>> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};

/** Kinds that seal their whole cell (panes and doors count as sealing). */
const SEALING_KINDS: ReadonlySet<BlockKind> = new Set([
  "block",
  "log",
  "pillar",
  "glass",
  "leaves",
  "pane",
  "door",
  "wall",
  "chest",
]);

/** Kinds that stop a player walking through a door (Cairn's full blocks). */
const DOOR_BLOCKING_KINDS: ReadonlySet<BlockKind> = new Set([
  "block",
  "log",
  "pillar",
  "glass",
  "leaves",
]);

const LIGHT_KINDS: ReadonlySet<BlockKind> = new Set([
  "torch",
  "wall_torch",
  "lantern",
]);
const LIGHT_BLOCKS: ReadonlySet<string> = new Set([
  "glowstone",
  "sea_lantern",
  "shroomlight",
  "campfire",
  "soul_campfire",
  "end_rod",
  "jack_o_lantern",
  "redstone_lamp",
]);

// A block's 2×2×2 occupancy as a bit mask: bit (x + 2y + 4z), 0 = low half.
const FULL = 0xff;
const bit = (x: number, y: number, z: number) => 1 << (x + 2 * y + 4 * z);

function layerMask(y: number, inQuadrant: (x: number, z: number) => boolean) {
  let m = 0;
  for (const x of [0, 1]) {
    for (const z of [0, 1]) if (inQuadrant(x, z)) m |= bit(x, y, z);
  }
  return m;
}

// The quadrants on the `direction` side of a cell.
function towards(direction: string): (x: number, z: number) => boolean {
  const [dx, dz] = DIRECTIONS[direction] ?? DIRECTIONS.south;
  return (x, z) => (dx !== 0 ? x === (dx > 0 ? 1 : 0) : z === (dz > 0 ? 1 : 0));
}

function stairMask(state: Record<string, string>): number {
  const facing = Object.hasOwn(DIRECTIONS, state.facing)
    ? state.facing
    : "north";
  const [solidY, stepY] = state.half === "top" ? [1, 0] : [0, 1];
  const front = towards(facing);
  const ccw = towards(COUNTER_CLOCKWISE[facing]);
  const cw = towards(CLOCKWISE[facing]);
  const step: Record<string, (x: number, z: number) => boolean> = {
    inner_left: (x, z) => front(x, z) || ccw(x, z),
    inner_right: (x, z) => front(x, z) || cw(x, z),
    outer_left: (x, z) => front(x, z) && ccw(x, z),
    outer_right: (x, z) => front(x, z) && cw(x, z),
  };
  const shape = Object.hasOwn(step, state.shape) ? step[state.shape] : front;
  return layerMask(solidY, () => true) | layerMask(stepY, shape);
}

/** The 2×2×2 occupancy of a placed block, from its kind and state. */
export function blockMask(registry: BlockRegistry, block: PlacedBlock): number {
  const kind = registry.kind(block.id);
  if (SEALING_KINDS.has(kind)) return FULL;
  const state = { ...registry.defaults(block.id), ...block.states };
  switch (kind) {
    case "slab":
      if (state.type === "double") return FULL;
      return layerMask(state.type === "top" ? 1 : 0, () => true);
    case "stairs":
      return stairMask(state);
    case "bed":
      return layerMask(0, () => true);
    default:
      return 0;
  }
}

/** Growable stack of cell indices for flood fills. */
class IndexStack {
  private items = new Int32Array(1024);
  length = 0;

  push(i: number): void {
    if (this.length === this.items.length) {
      const grown = new Int32Array(this.items.length * 2);
      grown.set(this.items);
      this.items = grown;
    }
    this.items[this.length++] = i;
  }

  pop(): number {
    return this.items[--this.length];
  }
}

const AIR_CELL = 0;
const SOLID_CELL = 1;
const VISITED_CELL = 2;

// Half-block cells of padding around the bounding box (one block).
const ENCLOSURE_PAD = 2;

// The half-block cells `enclosure` allocates for a bounding box of `dims`.
function enclosureCells(dims: Pos): number {
  return dims.reduce((n, d) => n * (2 * d + 2 * ENCLOSURE_PAD), 1);
}

/**
 * Enclosed air at half-block resolution over the occupied bounding box (plus a
 * block of padding): total sealed air and the size of each sealed space, both
 * in whole blocks (8 sub-cells each, rounded down like Cairn).
 */
function enclosure(
  registry: BlockRegistry,
  blocks: [Pos, PlacedBlock][],
  min: Pos,
  dims: Pos,
  outsideCheck: (isOutside: (pos: Pos) => boolean) => void,
): { air: number; rooms: number[] } {
  const [w, h, d] = dims.map((n) => 2 * n + 2 * ENCLOSURE_PAD);
  const cells = new Uint8Array(w * h * d);
  const masks = new Map<string, number>();
  for (const [[x, y, z], block] of blocks) {
    const key = JSON.stringify([block.id, block.states]);
    let mask = masks.get(key);
    if (mask === undefined) {
      mask = blockMask(registry, block);
      masks.set(key, mask);
    }
    if (mask === 0) continue;
    const X = 2 * (x - min[0]) + ENCLOSURE_PAD;
    const Y = 2 * (y - min[1]) + ENCLOSURE_PAD;
    const Z = 2 * (z - min[2]) + ENCLOSURE_PAD;
    for (let i = 0; i < 8; i++) {
      if (!(mask & (1 << i))) continue;
      const sx = X + (i & 1);
      const sy = Y + ((i >> 1) & 1);
      const sz = Z + ((i >> 2) & 1);
      cells[(sy * d + sz) * w + sx] = SOLID_CELL;
    }
  }
  const layer = w * d;
  const steps = [1, -1, w, -w, layer, -layer];
  const stack = new IndexStack();
  // Fills the air connected to `start` (6-connected), returning its size.
  // Index steps may wrap a row, but only between padding cells, which are
  // all outside air anyway.
  const fill = (start: number): number => {
    let size = 0;
    cells[start] = VISITED_CELL;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop();
      size++;
      for (const step of steps) {
        const n = i + step;
        if (n >= 0 && n < cells.length && cells[n] === AIR_CELL) {
          cells[n] = VISITED_CELL;
          stack.push(n);
        }
      }
    }
    return size;
  };
  fill(0);
  // Whether outside air reaches any half-block cell of block `pos` (cells
  // beyond the padded bounding box are outside).
  outsideCheck(([x, y, z]) => {
    const X = 2 * (x - min[0]) + ENCLOSURE_PAD;
    const Y = 2 * (y - min[1]) + ENCLOSURE_PAD;
    const Z = 2 * (z - min[2]) + ENCLOSURE_PAD;
    if (X < 0 || Y < 0 || Z < 0 || X + 1 >= w || Y + 1 >= h || Z + 1 >= d) {
      return true;
    }
    for (let i = 0; i < 8; i++) {
      const sx = X + (i & 1);
      const sy = Y + ((i >> 1) & 1);
      const sz = Z + ((i >> 2) & 1);
      if (cells[(sy * d + sz) * w + sx] === VISITED_CELL) return true;
    }
    return false;
  });
  let air = 0;
  const rooms: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== AIR_CELL) continue;
    const size = fill(i);
    air += size;
    rooms.push(Math.floor(size / 8));
  }
  rooms.sort((a, b) => b - a);
  return { air: Math.floor(air / 8), rooms };
}

/**
 * Per roof: the core columns where outside air reaches a cell between the
 * eave and the roof surface (the first such cell of each column, from the
 * eave up). Usually a gap between the wall tops and the roof.
 */
function roofLeaks(
  result: CompileResult,
  outside: (pos: Pos) => boolean,
): RoofLeak[] {
  const leaks: RoofLeak[] = [];
  for (const info of result.roofs) {
    const hits = leakingColumns(result, info, outside);
    if (hits.length === 0) continue;
    hits.sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
    leaks.push({
      roof: info.path,
      columns: hits.length,
      examples: hits.slice(0, MAX_LEAK_EXAMPLES),
      eaveY: info.base,
    });
  }
  return leaks;
}

function leakingColumns(
  result: CompileResult,
  info: RoofInfo,
  outside: (pos: Pos) => boolean,
): Pos[] {
  const hits: Pos[] = [];
  for (const [x, z] of info.core) {
    const top = info.top(x, z);
    if (top === undefined) continue;
    for (let y = info.base; y < top; y++) {
      if (result.blocks.get([x, y, z]) !== null) continue;
      if (outside([x, y, z])) {
        hits.push([x, y, z]);
        break;
      }
    }
  }
  return hits;
}

/** Analyses a compiled build's final blocks. */
export function analyze(
  result: CompileResult,
  registry: BlockRegistry,
): Analysis {
  const blocks = [...result.blocks.entries()];
  const analysis: Analysis = {
    name: result.name ?? "untitled",
    size: result.size,
    blockCount: blocks.length,
    outOfBounds: result.log.outOfBounds,
    bbox: null,
    components: 0,
    floating: [],
    floatingCount: 0,
    enclosedAir: 0,
    enclosedSpaces: [],
    roofLeaks: [],
    symmetry: { leftRight: 0, frontBack: 0 },
    features: {
      doors: 0,
      window_blocks: 0,
      stairs: 0,
      slabs: 0,
      light_sources: 0,
    },
    blockedDoors: [],
    materials: [],
  };
  if (blocks.length === 0) return analysis;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const [pos] of blocks) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], pos[a]);
      max[a] = Math.max(max[a], pos[a]);
    }
  }
  const dims: Pos = [
    max[0] - min[0] + 1,
    max[1] - min[1] + 1,
    max[2] - min[2] + 1,
  ];
  analysis.bbox = { min, max, dims };

  const counts = new Map<string, number>();
  for (const [, block] of blocks) {
    counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
  }
  analysis.materials = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_MATERIALS)
    .map(([id, n]) => [shortId(id), n]);

  // Connectivity (T2BM completeness): pieces through faces and edges, and
  // pieces that never reach the lowest layer.
  const [w, , d] = result.size;
  const index = ([x, y, z]: Pos) => (y * d + z) * w + x;
  const seen = new Set<number>();
  const floating: FloatingPiece[] = [];
  for (const [start] of blocks) {
    if (seen.has(index(start))) continue;
    seen.add(index(start));
    const queue: Pos[] = [start];
    let lowest = start;
    const ids = new Set<string>();
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q];
      ids.add(shortId(result.blocks.get(p)!.id));
      if (
        p[1] < lowest[1] ||
        (p[1] === lowest[1] &&
          (p[2] < lowest[2] || (p[2] === lowest[2] && p[0] < lowest[0])))
      ) {
        lowest = p;
      }
      for (const [dx, dy, dz] of N18) {
        const n: Pos = [p[0] + dx, p[1] + dy, p[2] + dz];
        if (result.blocks.get(n) === null || seen.has(index(n))) continue;
        seen.add(index(n));
        queue.push(n);
      }
    }
    analysis.components++;
    if (lowest[1] > min[1]) {
      floating.push({
        blocks: queue.length,
        example: lowest,
        materials: [...ids].sort().slice(0, 4),
        path: result.log.pathAt(lowest),
      });
    }
  }
  floating.sort(
    (a, b) =>
      b.blocks - a.blocks ||
      a.example[1] - b.example[1] ||
      a.example[2] - b.example[2] ||
      a.example[0] - b.example[0],
  );
  analysis.floatingCount = floating.length;
  analysis.floating = floating.slice(0, MAX_FLOATING);

  // Enclosure at half-block resolution: air leaking through the open half of
  // a stair or slab is caught (a whole-block check misses it).
  if (enclosureCells(dims) <= MAX_ENCLOSURE_CELLS) {
    const { air, rooms } = enclosure(registry, blocks, min, dims, (outside) => {
      analysis.roofLeaks = roofLeaks(result, outside);
    });
    analysis.enclosedAir = air;
    analysis.enclosedSpaces = rooms
      .filter((r) => r >= MIN_ROOM_BLOCKS)
      .slice(0, MAX_ROOMS);
  } else {
    analysis.enclosedAir = null;
  }

  // Mirror symmetry about the bounding box centre, by block id.
  let leftRight = 0;
  let frontBack = 0;
  for (const [[x, y, z], block] of blocks) {
    if (result.blocks.get([min[0] + max[0] - x, y, z])?.id === block.id) {
      leftRight++;
    }
    if (result.blocks.get([x, y, min[2] + max[2] - z])?.id === block.id) {
      frontBack++;
    }
  }
  const ratio = (n: number) => Math.round((n / blocks.length) * 1000) / 1000;
  analysis.symmetry = {
    leftRight: ratio(leftRight),
    frontBack: ratio(frontBack),
  };

  // Features, and doors without room to walk through.
  const features = analysis.features;
  for (const [pos, block] of blocks) {
    const kind = registry.kind(block.id);
    if (kind === "pane" || kind === "glass") features.window_blocks++;
    else if (kind === "stairs") features.stairs++;
    else if (kind === "slab") features.slabs++;
    if (LIGHT_KINDS.has(kind) || LIGHT_BLOCKS.has(shortId(block.id))) {
      features.light_sources++;
    }
    if (kind !== "door") continue;
    const state = { ...registry.defaults(block.id), ...block.states };
    if (state.half !== "lower") continue;
    features.doors++;
    const [dx, dz] = DIRECTIONS[state.facing] ?? DIRECTIONS.north;
    const [x, y, z] = pos;
    for (const side of [1, -1]) {
      const feet: Pos = [x + dx * side, y, z + dz * side];
      const head: Pos = [feet[0], y + 1, feet[2]];
      const at = [feet, head].find((p) => {
        const b = result.blocks.get(p);
        return b !== null && DOOR_BLOCKING_KINDS.has(registry.kind(b.id));
      });
      if (!at) continue;
      analysis.blockedDoors.push({
        door: pos,
        doorPath: result.log.pathAt(pos),
        side: feet,
        by: shortId(result.blocks.get(at)!.id),
        at,
        byPath: result.log.pathAt(at),
      });
    }
  }
  analysis.blockedDoors.sort(
    (a, b) =>
      a.door[1] - b.door[1] ||
      a.door[2] - b.door[2] ||
      a.door[0] - b.door[0] ||
      a.side[0] - b.side[0] ||
      a.side[2] - b.side[2],
  );
  return analysis;
}

const vec = (p: readonly number[]) => `[${p.join(", ")}]`;
const percent = (n: number) => `${Math.round(n * 100)}%`;
const from = (path: string | null) => (path ? ` (from ${path})` : "");

function list(lines: string[], problems: ProgramError[], limit = Infinity) {
  if (problems.length === 0) {
    lines.push("None.");
    return;
  }
  for (const p of problems.slice(0, limit)) {
    lines.push(`- ${formatProgramError(p)}`);
  }
  if (problems.length > limit) {
    lines.push(`- … and ${problems.length - limit} more`);
  }
}

/**
 * The report of a program that failed validation and was never compiled: its
 * errors only.
 */
export function formatInvalidReport(
  name: string,
  errors: ProgramError[],
): string {
  const lines = [
    `# Build report: ${name}`,
    "The program is invalid and was not compiled.",
    "",
    "## Errors (fix these first)",
  ];
  list(lines, errors);
  return lines.join("\n") + "\n";
}

/**
 * The report as markdown: Errors, Warnings, Notes, Geometry, Features and
 * Materials, in the layout of Cairn's sample reports.
 */
export function formatReport(
  result: CompileResult,
  analysis: Analysis,
): string {
  const lines = [
    `# Build report: ${analysis.name}`,
    `size (bounds) ${vec(analysis.size)}  blocks placed ${analysis.blockCount}`,
    "",
    "## Errors (fix these first)",
  ];
  list(lines, result.errors);
  lines.push("", "## Warnings");
  list(lines, result.warnings);
  if (result.notes.length > 0) {
    lines.push("", "## Auto-repairs / notes");
    list(lines, result.notes, MAX_NOTES);
  }

  lines.push("", "## Geometry");
  const { bbox } = analysis;
  if (bbox === null) {
    lines.push("The build is EMPTY.");
  } else {
    lines.push(
      `occupied bbox ${vec(bbox.min)}..${vec(bbox.max)} (dims ${vec(bbox.dims)})`,
      `connected pieces: ${analysis.components}`,
    );
    if (analysis.floatingCount > 0) {
      lines.push(
        `FLOATING pieces (not connected to the lowest layer): ${analysis.floatingCount}`,
      );
      for (const f of analysis.floating) {
        lines.push(
          `  - ${f.blocks} block(s) near ${vec(f.example)} ` +
            `(${f.materials.join(", ")})${from(f.path)}`,
        );
      }
    }
    lines.push(
      analysis.enclosedAir === null
        ? "enclosed air: not measured (the bounding box is too big)"
        : `enclosed air: ${analysis.enclosedAir} blocks; interior spaces ` +
            `(>=${MIN_ROOM_BLOCKS} blocks): ` +
            (analysis.enclosedSpaces.length > 0
              ? vec(analysis.enclosedSpaces)
              : "NONE - the building has no sealed interior"),
      `mirror symmetry: left-right ${percent(analysis.symmetry.leftRight)}, ` +
        `front-back ${percent(analysis.symmetry.frontBack)}`,
    );
    for (const leak of analysis.roofLeaks) {
      lines.push(
        `ROOF NOT SEALED (${leak.roof}): outside air gets under the roof in ` +
          `${leak.columns} column(s), e.g. at [${leak.examples.map(vec).join(", ")}]. ` +
          `Usually a gap between the wall tops and the roof (eave y=${leak.eaveY}); ` +
          `set the roof's 'gable' infill, or lower the roof onto the walls`,
      );
    }
    for (const bd of analysis.blockedDoors) {
      lines.push(
        `BLOCKED DOOR at ${vec(bd.door)}${from(bd.doorPath)}: ${bd.by} at ` +
          `${vec(bd.at)}${from(bd.byPath)} stops a player walking through`,
      );
    }
  }
  if (analysis.outOfBounds > 0) {
    lines.push(
      `blocks dropped out of bounds: ${analysis.outOfBounds} (see Warnings)`,
    );
  }

  const f = analysis.features;
  lines.push(
    "",
    "## Features",
    `doors: ${f.doors}, window_blocks: ${f.window_blocks}, stairs: ${f.stairs}, ` +
      `slabs: ${f.slabs}, light_sources: ${f.light_sources}`,
    "",
    "## Materials (top)",
    analysis.materials.length > 0
      ? analysis.materials.map(([m, n]) => `${m} x${n}`).join(", ")
      : "None.",
  );
  return lines.join("\n") + "\n";
}
