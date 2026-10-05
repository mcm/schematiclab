// The roof engine (port of Cairn's `cairn/roofs.py`). Worker-safe.
//
// A `roof` operation places nothing while the program runs: it is turned into
// world space and collected (`createRoof`), and once the whole program has run
// every roof is placed together on its own layer (`placeRoofs`).
//
// A roof is a height field over its footprint (the scope plus its overhang),
// with the eave at the scope's y = 0 and the surface clipped at the scope's
// height. Gable, hip and pyramid roofs measure the height as pitch × the
// Chebyshev (L∞) distance to the nearest eave edge, gable ends left out of the
// distance: for equal pitches on a rectilinear plan that is the straight
// skeleton, since mitred inward offsetting of an orthogonal polygon is erosion
// by a square. Shed, gambrel, cone, dome and flat roofs use their own formula.
// Roofs at the same eave height combine by the highest surface; roofs at
// different heights stay independent (a tower's cone overhanging a low annex
// must not swallow the annex roof).
//
// The surface is turned into blocks from the local gradient (after the GDMC
// 2024 winner "Frightful Hobgoblin"): stairs, facing up-slope, where the
// surface rises by about a block per block, else bottom or top slabs, and
// full blocks for flat roofs. Each column is filled down until no side is left
// open beside a neighbour's lower surface. Stair corner shapes are recomputed
// afterwards by `postprocess`.

import { BuildError } from "./errors";
import type { Material, MaterialResolver } from "./materials";
import type { MaterialSpec } from "./program";
import type { Scope, Vec } from "./scope";

export const ROOF_TYPES = [
  "gable",
  "hip",
  "pyramid",
  "shed",
  "gambrel",
  "cone",
  "dome",
  "flat",
] as const;

export type RoofType = (typeof ROOF_TYPES)[number];

/** Roofs whose height is the distance to the nearest eave (the skeleton). */
const SKELETON: ReadonlySet<RoofType> = new Set(["gable", "hip", "pyramid"]);
const ROUND: ReadonlySet<RoofType> = new Set(["cone", "dome"]);

type Dir = readonly [number, number];

// The order matters: ties in the gradient keep the first direction.
const DIRS: readonly Dir[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONALS: readonly Dir[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const DIR_NAME = (d: Dir): string =>
  d[0] === 1 ? "east" : d[0] === -1 ? "west" : d[1] === 1 ? "south" : "north";

const cellKey = (x: number, z: number) => `${x},${z}`;

/** Where and how a roof's blocks are written. */
export interface RoofLayer {
  priority: number;
  carve: boolean;
  /** Program order of the `roof` operation: all its blocks share it. */
  seq: number;
  /** The `roof` operation's program path. */
  path: string;
}

export interface RoofMaterials {
  stairs: Material;
  slab: Material;
  block: Material;
}

/** One roof, in world space. */
export interface Roof {
  type: RoofType;
  pitch: number;
  /** World y of the eave. */
  base: number;
  /** World y the surface is clipped at. */
  cap: number;
  /** World (x, z) columns of the footprint, overhang included. */
  cells: ReadonlyMap<string, Dir>;
  /** Columns of the scope itself (no overhang). */
  core: ReadonlySet<string>;
  /** The surface height (world y) at a world point, or null outside the roof. */
  height(x: number, z: number): number | null;
  /** Whether the footprint's edge on world side `dir` is an eave (not a gable end). */
  isEave(dir: Dir): boolean;
  materials: RoofMaterials;
  solid: boolean;
  layer: RoofLayer;
}

export interface RoofArgsObject {
  type?: unknown;
  material?: unknown;
  pitch?: unknown;
  overhang?: unknown;
  ridge?: unknown;
  height?: unknown;
  solid?: unknown;
  break?: unknown;
}

const show = (v: unknown) => JSON.stringify(v) ?? String(v);

function numberArg(
  v: unknown,
  path: string,
  fallback: number,
  min: number,
  max = Infinity,
): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    const range =
      max === Infinity ? `at least ${min}` : `between ${min} and ${max}`;
    throw new BuildError(path, `must be a number ${range}, got ${show(v)}`);
  }
  return v;
}

function overhangArg(v: unknown, path: string) {
  const side = (raw: unknown, at: string, fallback: number) => {
    if (raw === undefined) return fallback;
    if (!Number.isInteger(raw) || (raw as number) < 0) {
      throw new BuildError(
        at,
        `must be an integer of at least 0, got ${show(raw)}`,
      );
    }
    return raw as number;
  };
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const all = side(o.all, `${path}.all`, 1);
    return {
      left: side(o.left, `${path}.left`, all),
      right: side(o.right, `${path}.right`, all),
      back: side(o.back, `${path}.back`, all),
      front: side(o.front, `${path}.front`, all),
    };
  }
  const n = side(v, path, 1);
  return { left: n, right: n, back: n, front: n };
}

/**
 * The roof `arg` asks for over `scope`, in world space. `layer` is the roof's
 * own layer (one below its context unless it sets `priority`). Throws
 * `BuildError`.
 */
export function createRoof(
  arg: RoofArgsObject,
  scope: Scope,
  path: string,
  resolver: MaterialResolver,
  layer: RoofLayer,
): Roof {
  const { uy } = scope;
  if (uy[0] !== 0 || uy[1] !== 1 || uy[2] !== 0) {
    throw new BuildError(path, "roofs need an upright scope");
  }
  const type = arg.type ?? "gable";
  if (
    typeof type !== "string" ||
    !(ROOF_TYPES as readonly string[]).includes(type)
  ) {
    throw new BuildError(
      `${path}.type`,
      `unknown roof type ${show(type)}. Use: ${[...ROOF_TYPES].sort().join(", ")}`,
    );
  }
  const rtype = type as RoofType;
  const [W, H, D] = scope.size;
  const capRel = numberArg(arg.height, `${path}.height`, H - 1, 0);
  const pitch = numberArg(arg.pitch, `${path}.pitch`, 1, 0);
  const kb = numberArg(arg.break, `${path}.break`, 0.5, 0, 1);
  const ov = overhangArg(arg.overhang, `${path}.overhang`);
  if (arg.solid !== undefined && typeof arg.solid !== "boolean") {
    throw new BuildError(
      `${path}.solid`,
      `must be true or false, got ${show(arg.solid)}`,
    );
  }
  let ridge = arg.ridge ?? "auto";
  if (ridge === "auto") ridge = W >= D ? "x" : "z";
  if (ridge !== "x" && ridge !== "z") {
    throw new BuildError(
      `${path}.ridge`,
      `must be "x", "z" or "auto", got ${show(arg.ridge)}`,
    );
  }

  const spec = (arg.material ?? "@roof") as MaterialSpec;
  const materialPath = arg.material === undefined ? path : `${path}.material`;
  const materials: RoofMaterials = {
    stairs: resolver.resolve(spec, materialPath, "stairs"),
    slab: resolver.resolve(spec, materialPath, "slab"),
    block: resolver.resolve(spec, materialPath, "block"),
  };

  const { left: ol, right: or, back: ob, front: of } = ov;
  const cx = (W - 1) / 2;
  const cz = (D - 1) / 2;
  const Rx = W / 2 + Math.max(ol, or);
  const Rz = D / 2 + Math.max(ob, of);
  const R = Math.max(Rx, Rz);
  const round = ROUND.has(rtype);

  // part-relative local coordinates (continuous)
  const inside = (u: number, v: number) =>
    round
      ? ((u - cx) / Rx) ** 2 + ((v - cz) / Rz) ** 2 <= 1 + 1e-9
      : -ol - 0.5 <= u &&
        u <= W - 0.5 + or &&
        -ob - 0.5 <= v &&
        v <= D - 0.5 + of;
  const dx = (u: number) => Math.min(u + ol, W - 1 + or - u);
  const dz = (v: number) => Math.min(v + ob, D - 1 + of - v);
  const gambrel = (d: number, span: number) => {
    const b = (span * kb) / 2;
    return d <= b ? 2 * pitch * d : 2 * pitch * b + 0.5 * pitch * (d - b);
  };
  const domeHeight = arg.height === undefined ? R : capRel;
  const surface: (u: number, v: number) => number = {
    gable: (u: number, v: number) => pitch * (ridge === "x" ? dz(v) : dx(u)),
    hip: (u: number, v: number) => pitch * Math.min(dx(u), dz(v)),
    pyramid: (u: number, v: number) => pitch * Math.min(dx(u), dz(v)),
    shed: (u: number, v: number) =>
      pitch * (ridge === "x" ? D - 1 + of - v : W - 1 + or - u),
    gambrel: (u: number, v: number) =>
      ridge === "x" ? gambrel(dz(v), D + ob + of) : gambrel(dx(u), W + ol + or),
    cone: (u: number, v: number) =>
      pitch * (R - 0.5 - Math.hypot(u - cx, v - cz)),
    dome: (u: number, v: number) =>
      domeHeight *
      Math.sqrt(Math.max(0, 1 - ((u - cx) / Rx) ** 2 - ((v - cz) / Rz) ** 2)),
    flat: () => 0,
  }[rtype];

  const [ox, oy, oz] = scope.origin;
  const { ux, uz } = scope;
  const base = oy;
  const toLocal = (qx: number, qz: number): [number, number] => {
    const ddx = qx - ox;
    const ddz = qz - oz;
    return [ddx * ux[0] + ddz * ux[2], ddx * uz[0] + ddz * uz[2]];
  };
  const height = (qx: number, qz: number): number | null => {
    const [u, v] = toLocal(qx, qz);
    if (!inside(u, v)) return null;
    return base + Math.max(0, Math.min(surface(u, v), capRel));
  };
  const worldCell = (u: number, v: number): Dir => {
    const w: Vec = scope.world(u, 0, v);
    return [w[0], w[2]];
  };
  const cells = new Map<string, Dir>();
  for (let u = -ol; u < W + or; u++) {
    for (let v = -ob; v < D + of; v++) {
      if (!inside(u, v)) continue;
      const c = worldCell(u, v);
      cells.set(cellKey(...c), c);
    }
  }
  const core = new Set<string>();
  for (let u = 0; u < W; u++) {
    for (let v = 0; v < D; v++) {
      if (!round || inside(u, v)) core.add(cellKey(...worldCell(u, v)));
    }
  }
  const isEave = (dir: Dir): boolean => {
    if (rtype === "hip" || rtype === "pyramid") return true;
    const lx = dir[0] * ux[0] + dir[1] * ux[2];
    const lz = dir[0] * uz[0] + dir[1] * uz[2];
    return ridge === "x" ? lz !== 0 : lx !== 0;
  };

  return {
    type: rtype,
    pitch,
    base,
    cap: base + capRel,
    cells,
    core,
    height,
    isEave,
    materials,
    solid: arg.solid === true,
    layer,
  };
}

// -- sources: things that report a surface height at a world point ------------

interface Source {
  roofs: readonly Roof[];
  height(x: number, z: number): number | null;
  cells: ReadonlyMap<string, Dir>;
  core: ReadonlySet<string>;
  flat: boolean;
  materials: RoofMaterials;
  solid: boolean;
  base: number;
  layer: RoofLayer;
}

function source(
  roofs: readonly Roof[],
  height: Source["height"],
  cells: ReadonlyMap<string, Dir>,
  core: ReadonlySet<string>,
  flat = false,
): Source {
  const first = roofs[0];
  const seq = Math.min(...roofs.map((r) => r.layer.seq));
  return {
    roofs,
    height,
    cells,
    core,
    flat,
    materials: first.materials,
    solid: roofs.some((r) => r.solid),
    base: first.base,
    layer: { ...first.layer, seq },
  };
}

/** Whether a cell of `cells` is within half a block of (qx, qz). */
function near(cells: ReadonlyMap<string, Dir>, qx: number, qz: number) {
  const xs = new Set([Math.floor(qx + 0.5), Math.ceil(qx - 0.5)]);
  const zs = new Set([Math.floor(qz + 0.5), Math.ceil(qz - 0.5)]);
  for (const x of xs) {
    for (const z of zs) if (cells.has(cellKey(x, z))) return true;
  }
  return false;
}

/**
 * The skeleton surface over the union of `roofs` (gable, hip and pyramid
 * roofs sharing an eave height and pitch): pitch × (d − ½), where d is the
 * Chebyshev distance from the point to the nearest eave cell's square (the
 * columns just outside the footprint across an eave edge). Null when the
 * footprint has no eave edge.
 *
 * Every query point lies on the half-block grid, so the distances come from
 * one king-move breadth-first search on a doubled grid: with D the Chebyshev
 * distance in half blocks to the nearest eave cell centre,
 * d = max(D − 1, 0) / 2.
 */
function skeletonSource(roofs: readonly Roof[]): Source | null {
  const cells = new Map<string, Dir>();
  const core = new Set<string>();
  for (const r of roofs) {
    for (const [k, c] of r.cells) cells.set(k, c);
    for (const k of r.core) core.add(k);
  }
  const eave = new Map<string, Dir>();
  for (const [key, [x, z]] of cells) {
    for (const d of DIRS) {
      const n: Dir = [x + d[0], z + d[1]];
      const nk = cellKey(...n);
      if (cells.has(nk)) continue;
      // the union's edge here belongs to every roof containing this cell
      if (roofs.some((r) => r.cells.has(key) && r.isEave(d))) eave.set(nk, n);
    }
  }
  if (eave.size === 0) return null;

  // doubled grid over the footprint's bounding box plus a cell all round
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of [...cells.values(), ...eave.values()]) {
    minX = Math.min(minX, x - 1);
    minZ = Math.min(minZ, z - 1);
    maxX = Math.max(maxX, x + 1);
    maxZ = Math.max(maxZ, z + 1);
  }
  const gw = 2 * (maxX - minX) + 1;
  const gd = 2 * (maxZ - minZ) + 1;
  const dist = new Int32Array(gw * gd).fill(-1);
  let queue: number[] = [];
  for (const [x, z] of eave.values()) {
    const i = 2 * (z - minZ) * gw + 2 * (x - minX);
    dist[i] = 0;
    queue.push(i);
  }
  for (let level = 0; queue.length > 0; level++) {
    const next: number[] = [];
    for (const i of queue) {
      const gx = i % gw;
      const gz = (i - gx) / gw;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const nx = gx + a;
          const nz = gz + b;
          if (nx < 0 || nz < 0 || nx >= gw || nz >= gd) continue;
          const j = nz * gw + nx;
          if (dist[j] !== -1) continue;
          dist[j] = level + 1;
          next.push(j);
        }
      }
    }
    queue = next;
  }

  const base = roofs[0].base;
  const pitch = roofs[0].pitch;
  const capRel = Math.min(...roofs.map((r) => r.cap)) - base;
  const height = (qx: number, qz: number): number | null => {
    if (!near(cells, qx, qz)) return null;
    const gx = Math.round(2 * (qx - minX));
    const gz = Math.round(2 * (qz - minZ));
    const D = dist[gz * gw + gx];
    const d = Math.max(D - 1, 0) / 2;
    return base + Math.max(0, Math.min(pitch * (d - 0.5), capRel));
  };
  return source(roofs, height, cells, core);
}

// -- placement ----------------------------------------------------------------

/** Writes one roof block in world space on its roof's layer. */
export type RoofPlacer = (
  pos: Vec,
  material: Material,
  states: Record<string, string>,
  layer: RoofLayer,
) => void;

/**
 * Places every collected roof, after the rest of the program. Each `roof`
 * operation is one surface; surfaces at the same eave height combine by the
 * highest one.
 */
export function placeRoofs(roofs: readonly Roof[], place: RoofPlacer): void {
  const sources: Source[] = [];
  const skeleton: Roof[][] = [];
  for (const r of roofs) {
    if (SKELETON.has(r.type)) skeleton.push([r]);
    else {
      sources.push(source([r], r.height, r.cells, r.core, r.type === "flat"));
    }
  }
  for (const group of skeleton) {
    const s = skeletonSource(group);
    if (s) sources.push(s);
  }
  const byBase = new Map<number, Source[]>();
  for (const s of sources) {
    const group = byBase.get(s.base);
    if (group) group.push(s);
    else byBase.set(s.base, [s]);
  }
  for (const group of byBase.values()) placeSurface(group, place);
}

type ColumnInfo =
  | { kind: "stairs"; dir: Dir; src: Source }
  | { kind: "slab"; half: "bottom" | "top"; src: Source }
  | { kind: "block"; src: Source };

function placeSurface(sources: readonly Source[], place: RoofPlacer): void {
  const F = (qx: number, qz: number): [number | null, Source | null] => {
    let best: number | null = null;
    let src: Source | null = null;
    for (const s of sources) {
      const v = s.height(qx, qz);
      if (v !== null && (best === null || v > best)) [best, src] = [v, s];
    }
    return [best, src];
  };

  const all = new Map<string, Dir>();
  for (const s of sources) for (const [k, c] of s.cells) all.set(k, c);
  const top = new Map<string, number>();
  const info = new Map<string, ColumnInfo>();
  for (const [key, [x, z]] of all) {
    const [h, src] = F(x, z);
    if (h === null || src === null) continue;
    if (src.flat) {
      top.set(key, Math.floor(h));
      info.set(key, { kind: "block", src });
      continue;
    }
    let best: number | null = null;
    let dir: Dir = DIRS[0];
    for (const d of DIRS) {
      const [v] = F(x + 0.5 * d[0], z + 0.5 * d[1]);
      if (v !== null && (best === null || v > best)) [best, dir] = [v, d];
    }
    let slope = best !== null ? (best - h) * 2 : 0;
    if (slope < 0.75) {
      // hip lines: only the diagonal rises. A stair facing one of its axes
      // becomes an outer corner in the stair-shape pass.
      for (const g of DIAGONALS) {
        const [v] = F(x + 0.5 * g[0], z + 0.5 * g[1]);
        if (v === null || (v - h) * 2 < 0.75) continue;
        const [ax] = F(x + 0.5 * g[0], z);
        const [az] = F(x, z + 0.5 * g[1]);
        if (ax !== null && az !== null) {
          slope = 1;
          dir = ax >= az ? [g[0], 0] : [0, g[1]];
          break;
        }
      }
    }
    if (slope >= 0.75) {
      top.set(key, Math.floor(h + 0.5));
      info.set(key, { kind: "stairs", dir, src });
    } else {
      let level = Math.floor(h);
      const frac = h - level;
      let half: "bottom" | "top";
      if (frac < 0.25) half = "bottom";
      else if (frac < 0.75) half = "top";
      else [level, half] = [level + 1, "bottom"];
      top.set(key, level);
      info.set(key, { kind: "slab", half, src });
    }
  }

  for (const [key, level] of top) {
    const [x, z] = all.get(key)!;
    const column = info.get(key)!;
    const { src } = column;
    const { materials, layer } = src;
    if (column.kind === "stairs") {
      place(
        [x, level, z],
        materials.stairs,
        { facing: DIR_NAME(column.dir), half: "bottom" },
        layer,
      );
    } else if (column.kind === "slab") {
      place([x, level, z], materials.slab, { type: column.half }, layer);
    } else {
      place([x, level, z], materials.block, {}, layer);
    }
    // Fill down until every side is closed: below a partial neighbour (a
    // stair or slab) its open half would expose this column, so its level
    // counts too.
    const need: number[] = [];
    for (const [a, b] of DIRS) {
      const nk = cellKey(x + a, z + b);
      const n = top.get(nk);
      if (n === undefined) continue;
      // does the neighbour's surface block show a full face to this column?
      const ni = info.get(nk)!;
      const fullFace =
        ni.kind === "block" ||
        (ni.kind === "stairs" && ni.dir[0] === -a && ni.dir[1] === -b);
      need.push(fullFace ? n : n - 1);
    }
    // the lowest level of this column left exposed is need + 1; roof edges
    // need no infill
    let low = need.length > 0 ? Math.min(...need) : level;
    if (column.kind === "slab" && column.half === "top" && low < level) {
      // a top slab's open underside must not open into the attic
      low = Math.min(low, level - 2);
    }
    if (src.solid && src.core.has(key)) low = src.base - 1;
    for (let y = Math.max(src.base, low + 1); y < level; y++) {
      place([x, y, z], materials.block, {}, layer);
    }
  }
}
