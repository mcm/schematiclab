// Layered writes (Cairn `SPEC.md` section 3a). Operations don't paint cells
// directly: every placement is logged per cell with its layer (`priority`),
// program order, `carve`, `only_empty`, `replace` and program path, and
// `compose` resolves each cell's log once the whole program has run. So a
// block from a higher layer wins over a lower one whichever was written
// first. Worker-safe.
//
// Within a cell, writes apply in (priority, program order):
// - a block overwrites whatever is there (it can only come from its own or a
//   lower layer, since higher layers apply later);
// - air erases only a block from its own layer, unless the write carves;
// - `only_empty` and `replace` are judged against the cell as composed from
//   the writes applied before it.

import type { BlockKind, BlockRegistry } from "../blockdata/registry";
import { AIR, type MaterialResolver } from "./materials";
import type { ProgramError, ReplaceSpec } from "./program";

export type Pos = readonly [number, number, number];

/** A layer: `priority` and `carve`, inherited by nested operations. */
export interface Layer {
  priority: number;
  carve: boolean;
}

/**
 * The layer of the operation being run. Each operation whose argument object
 * sets `priority` or `carve` runs `within` it; nested operations inherit it.
 */
export class LayerStack {
  private readonly stack: Layer[] = [{ priority: 0, carve: false }];

  get current(): Layer {
    return this.stack[this.stack.length - 1];
  }

  /** Runs `fn` in `arg`'s layer: its `priority` and `carve`, else the current ones. */
  within<T>(arg: unknown, fn: () => T): T {
    if (typeof arg !== "object" || arg === null || Array.isArray(arg)) {
      return fn();
    }
    const { priority, carve } = arg as { priority?: unknown; carve?: unknown };
    if (priority === undefined && carve === undefined) return fn();
    const current = this.current;
    this.stack.push({
      priority: Number.isInteger(priority)
        ? (priority as number)
        : current.priority,
      carve: typeof carve === "boolean" ? carve : current.carve,
    });
    try {
      return fn();
    } finally {
      this.stack.pop();
    }
  }
}

/** What `replace` may overwrite: any non-air block, or these block ids. */
export type ReplaceSet = "solid" | ReadonlySet<string>;

/**
 * The `replace` set `spec` names: block ids, roles and mixes resolve to their
 * block ids (states are ignored); `"solid"` or `"any"` anywhere means any
 * non-air block. Throws `BuildError`.
 */
export function resolveReplace(
  resolver: MaterialResolver,
  spec: ReplaceSpec,
  path: string,
): ReplaceSet {
  const items = Array.isArray(spec) ? spec : [spec];
  if (items.some((item) => item === "solid" || item === "any")) return "solid";
  const ids = new Set<string>();
  items.forEach((item, i) => {
    const at = Array.isArray(spec) ? `${path}[${i}]` : path;
    for (const entry of resolver.resolve(item, at).entries) ids.add(entry.id);
  });
  return ids;
}

export interface PlacedBlock {
  /** `minecraft:`-prefixed block id, never air. */
  id: string;
  /** World block states. */
  states: Record<string, string>;
}

export interface Write extends Layer {
  /** Program order; writes of one placement (both door halves) share it. */
  seq: number;
  /** The block written, or null for air. */
  block: PlacedBlock | null;
  onlyEmpty: boolean;
  replace: ReplaceSet | null;
  /** The program path of the operation that wrote it. */
  path: string;
  /** True for a hand-placed `block` (furniture, lights…). */
  point: boolean;
}

/** One cell's log composed into its final block, or null for air. */
export function composeCell(writes: readonly Write[]): PlacedBlock | null {
  return winningWrite(writes)?.block ?? null;
}

// The write whose block a cell ends up with, or null for air.
function winningWrite(writes: readonly Write[]): Write | null {
  return resolveCell(writes).winner;
}

// Composes a cell: the winning write (null for air) and every block write that
// took effect at some point. Writes that `onlyEmpty` or `replace` rejected
// never took part in the cell.
function resolveCell(writes: readonly Write[]): {
  winner: Write | null;
  applied: Set<Write>;
} {
  const ordered = [...writes].sort(
    (a, b) => a.priority - b.priority || a.seq - b.seq,
  );
  const applied = new Set<Write>();
  let current: Write | null = null;
  for (const w of ordered) {
    if (w.onlyEmpty && current !== null) continue;
    if (w.replace === "solid") {
      if (current === null) continue;
    } else if (
      w.replace !== null &&
      !w.replace.has(current?.block?.id ?? AIR)
    ) {
      continue;
    }
    if (w.block === null) {
      if (current !== null && (w.carve || current.priority === w.priority)) {
        current = null;
      }
      continue;
    }
    current = w;
    applied.add(w);
  }
  return { winner: current, applied };
}

/** Kinds always set into a wall: a door in a wall isn't a collision. */
const WALL_MOUNTED_KINDS: ReadonlySet<BlockKind> = new Set([
  "door",
  "trapdoor",
  "wall_torch",
]);

// Wall variants of signs and banners (`oak_wall_sign`, `red_wall_banner`…).
const WALL_SIGN_OR_BANNER = /_wall_(hanging_)?sign$|_wall_banner$/;

/**
 * Whether `block` is mounted on a wall face: doors, trapdoors and wall
 * torches, buttons and levers with `face=wall`, and wall signs and banners.
 * Pressure plates and standing or ceiling variants are not.
 */
function isWallMounted(registry: BlockRegistry, block: PlacedBlock): boolean {
  const kind = registry.kind(block.id);
  if (WALL_MOUNTED_KINDS.has(kind)) return true;
  if (kind === "button" || kind === "lever") {
    const face = block.states.face ?? registry.defaults(block.id)?.face;
    return face === "wall";
  }
  if (kind === "sign" || kind === "banner") {
    return WALL_SIGN_OR_BANNER.test(block.id);
  }
  return false;
}

/** Kinds of the full, opaque blocks walls are built from. */
export const WALL_KINDS: ReadonlySet<BlockKind> = new Set([
  "block",
  "log",
  "pillar",
]);

const shortId = (id: string) => id.replace(/^minecraft:/, "");

/** The per-cell write log of one build. */
export class WriteLog {
  /** Writes that fell outside the build and were dropped. */
  outOfBounds = 0;
  /** Dropped writes per program path, in the order first seen. */
  readonly outOfBoundsByPath = new Map<string, number>();
  private readonly cells = new Map<number, Write[]>();
  private seq = 0;

  constructor(readonly size: Pos) {}

  /** The next program-order number, one per placement. */
  nextSeq(): number {
    return ++this.seq;
  }

  /** Logs `write` at world `pos`; false (and counted) when outside the build. */
  write(pos: Pos, write: Write): boolean {
    const index = this.index(pos);
    if (index === null) {
      this.outOfBounds++;
      this.outOfBoundsByPath.set(
        write.path,
        (this.outOfBoundsByPath.get(write.path) ?? 0) + 1,
      );
      return false;
    }
    const log = this.cells.get(index);
    if (log) log.push(write);
    else this.cells.set(index, [write]);
    return true;
  }

  /** The writes logged at `pos`, in the order they were written. */
  writesAt(pos: Pos): readonly Write[] {
    const index = this.index(pos);
    return (index === null ? undefined : this.cells.get(index)) ?? [];
  }

  /** The block `pos` composes to so far, or null for air. */
  peek(pos: Pos): PlacedBlock | null {
    return composeCell(this.writesAt(pos));
  }

  /** The write `pos` composes to, or null for air. */
  winnerAt(pos: Pos): Write | null {
    return winningWrite(this.writesAt(pos));
  }

  /** The program path of the write `pos` composes to, or null for air. */
  pathAt(pos: Pos): string | null {
    return this.winnerAt(pos)?.path ?? null;
  }

  /** Every non-air cell's final block. */
  *compose(): Generator<[Pos, PlacedBlock]> {
    for (const [index, writes] of this.cells) {
      const block = composeCell(writes);
      if (block) yield [this.pos(index), block];
    }
  }

  /** Every non-air cell's final block, as a grid. */
  composeGrid(): BlockGrid {
    const grid = new BlockGrid(this.size);
    for (const [pos, block] of this.compose()) grid.set(pos, block);
    return grid;
  }

  /**
   * Warnings for hand-placed blocks sharing a cell with another operation's
   * block (only writes that took effect: an `only_empty` or `replace` write
   * the cell rejected doesn't count), which is almost always a mistake (a bed inside a chimney). Painting
   * over on purpose (walls, then windows) isn't checked; neither is a
   * wall-mounted block (`isWallMounted`) set into solid wall blocks. One
   * warning per (point path, other path, outcome).
   */
  collisions(registry: BlockRegistry): ProgramError[] {
    const out: ProgramError[] = [];
    const seen = new Set<string>();
    for (const [index, writes] of this.cells) {
      const { winner, applied } = resolveCell(writes);
      const points = writes.filter((w) => w.point && applied.has(w));
      if (points.length === 0) continue;
      for (const point of points) {
        const block = point.block as PlacedBlock;
        const others = writes.filter(
          (w) => applied.has(w) && w.path !== point.path,
        );
        if (others.length === 0) continue;
        if (
          isWallMounted(registry, block) &&
          others.every((w) => WALL_KINDS.has(registry.kind(w.block!.id)))
        ) {
          continue;
        }
        const other = others.reduce((a, b) =>
          b.priority > a.priority ||
          (b.priority === a.priority && b.seq > a.seq)
            ? b
            : a,
        );
        const won = winner === point;
        const verb = won ? "replaced" : "was overwritten by";
        const key = JSON.stringify([point.path, other.path, verb]);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          path: point.path,
          message:
            `${shortId(block.id)} at ${JSON.stringify(this.pos(index))} ${verb} ` +
            `${shortId(other.block!.id)} from ${other.path} ` +
            `(two features occupy the same space; move one of them)`,
        });
      }
    }
    return out;
  }

  private index(pos: Pos): number | null {
    return cellIndex(this.size, pos);
  }

  private pos(index: number): Pos {
    return cellPos(this.size, index);
  }
}

/** The composed blocks of a build: non-air cells only. */
export class BlockGrid {
  private readonly cells = new Map<number, PlacedBlock>();

  constructor(readonly size: Pos) {}

  get count(): number {
    return this.cells.size;
  }

  /** The block at `pos`, or null for air and cells outside the build. */
  get(pos: Pos): PlacedBlock | null {
    const index = cellIndex(this.size, pos);
    return (index === null ? undefined : this.cells.get(index)) ?? null;
  }

  /** Sets a cell inside the build (outside ones are ignored). */
  set(pos: Pos, block: PlacedBlock): void {
    const index = cellIndex(this.size, pos);
    if (index !== null) this.cells.set(index, block);
  }

  /** Clears a cell to air. */
  delete(pos: Pos): void {
    const index = cellIndex(this.size, pos);
    if (index !== null) this.cells.delete(index);
  }

  *entries(): Generator<[Pos, PlacedBlock]> {
    for (const [index, block] of this.cells) {
      yield [cellPos(this.size, index), block];
    }
  }
}

function cellIndex(size: Pos, pos: Pos): number | null {
  const [w, h, d] = size;
  const [x, y, z] = pos;
  if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return null;
  return (y * d + z) * w + x;
}

function cellPos(size: Pos, index: number): Pos {
  const [w, , d] = size;
  return [index % w, Math.floor(index / (w * d)), Math.floor(index / w) % d];
}
