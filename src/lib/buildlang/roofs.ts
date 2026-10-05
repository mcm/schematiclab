// The roof engine (port of Cairn's `cairn/roofs.py`). Worker-safe.
//
// A `roof` operation places nothing when it runs: each of its parts is turned
// into world space and collected. Once the whole program has run, roofs are
// resolved together:
//
// - gable, hip and pyramid parts that share an eave height, pitch, material,
//   priority and gable setting merge into one surface over their union
//   footprint. For equal-pitch roofs on rectilinear plans the straight-
//   skeleton height is `pitch × (L∞ distance to the nearest eave edge)`, since
//   mitred inward offsetting of an orthogonal polygon is erosion by a square.
//   Edges beyond a gable are left out of the distance. This gives ridges,
//   hips and valleys for L, T, U and cross plans, even when the parts come
//   from separate operations in differently turned scopes;
// - every other shape (shed, gambrel, cone, dome, flat) combines with the
//   rest by highest surface, and roofs at different eave heights stay
//   independent.
//
// The surface becomes stairs, slabs and blocks from its local slope, and
// `postprocess` sets stair corner shapes afterwards.

import type { BlockRegistry } from "../blockdata/registry";
import { BuildError } from "./errors";
import {
  type Length,
  parseLength,
  resolvePosition,
  resolveSize,
} from "./lengths";
import type { Material, MaterialResolver } from "./materials";
import type { ProgramError } from "./program";
import type { Scope, Vec } from "./scope";
import type { Layer, PlacedBlock, Pos } from "./writes";

export const ROOF_TYPES = [
  "cone",
  "dome",
  "flat",
  "gable",
  "gambrel",
  "hip",
  "pyramid",
  "shed",
] as const;

export type RoofType = (typeof ROOF_TYPES)[number];

const SKELETON: ReadonlySet<string> = new Set(["gable", "hip", "pyramid"]);
const ROUND: ReadonlySet<string> = new Set(["cone", "dome"]);

type Dir = readonly [number, number];
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

function dirName([dx, dz]: Dir): string {
  if (dx === 1) return "east";
  if (dx === -1) return "west";
  return dz === 1 ? "south" : "north";
}

// World columns as one number. Roof parts reach at most a build size plus
// overhangs outside the build.
const KEY_OFFSET = 1 << 12;
const KEY_SPAN = 1 << 13;
const key = (x: number, z: number) =>
  (x + KEY_OFFSET) * KEY_SPAN + z + KEY_OFFSET;
const unkey = (k: number): [number, number] => [
  Math.floor(k / KEY_SPAN) - KEY_OFFSET,
  (k % KEY_SPAN) - KEY_OFFSET,
];

/** The block variants a roof is built from. */
interface RoofMaterials {
  stairs: Material;
  slab: Material;
  block: Material;
}

/** A roof part in world space, as `register` collects it. */
interface RoofPart {
  type: RoofType;
  pitch: number;
  /** World y of the eave. */
  base: number;
  /** World y the surface is clipped at. */
  cap: number;
  /** Columns under the roof, overhang included. */
  cells: Set<number>;
  /** Columns over the scope's footprint (no overhang). */
  core: Set<number>;
  /** Surface height at a world point, or null outside the part. */
  h(qx: number, qz: number): number | null;
  /** Whether the part's edge on the world side `dir` is an eave (not a gable end). */
  isEave(dir: Dir): boolean;
  materials: RoofMaterials;
  /** Gable infill: `"auto"`, a material, or null for none. */
  gable: Material | "auto" | null;
  solid: boolean;
  layer: Layer;
  seq: number;
  /** Merge keys: the roof's material and gable as written. */
  specKey: string;
  gableKey: string;
  path: string;
}

/** What a merged roof covers, for the sealing check. */
export interface RoofInfo {
  /** Columns over the roofed footprints (no overhang), as `[x, z]`. */
  core: [number, number][];
  /** World y of the eave. */
  base: number;
  /** The surface block's y per column. */
  top: Map<number, number>;
  /** The roof operations' program paths, joined. */
  path: string;
}

/** The roof engine's view of the compiler. */
export interface RoofHost {
  readonly registry: BlockRegistry;
  readonly resolver: MaterialResolver;
  /** World-space placement with the roof's own layer and program order. */
  placeWorld(
    pos: Vec,
    material: Material,
    states: Record<string, string>,
    source: { layer: Layer; seq: number; path: string },
    onlyEmpty?: boolean,
  ): void;
  /** The block a cell composes to so far, or null for air. */
  peek(pos: Pos): PlacedBlock | null;
  note(problem: ProgramError): void;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function show(v: unknown): string {
  return JSON.stringify(v) ?? String(v);
}

// Stable JSON with sorted keys, for the merge keys.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return show(v);
}

function lengthOf(
  spec: unknown,
  path: string,
  context: "position" | "size",
): Length {
  const parsed = parseLength(spec, context);
  if (!parsed.ok) throw new BuildError(path, parsed.error);
  return parsed.length;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

/** Collects roofs during the program and places them all at the end. */
export class RoofEngine {
  private readonly parts: RoofPart[] = [];
  /** One entry per merged surface, for the sealing check. */
  readonly info: RoofInfo[] = [];

  constructor(private readonly host: RoofHost) {}

  /**
   * Collects the parts of one `roof` operation. `layer` is the roof's own:
   * one priority below its context unless it set one.
   */
  register(
    raw: unknown,
    scope: Scope,
    path: string,
    layer: Layer,
    seq: number,
  ) {
    const arg: Json =
      typeof raw === "string" ? { type: raw } : isObject(raw) ? raw : {};
    if (!isObject(raw) && typeof raw !== "string") {
      throw new BuildError(
        path,
        `expected a roof type or an object, got ${show(raw)}`,
      );
    }
    if (scope.uy[0] !== 0 || scope.uy[1] !== 1 || scope.uy[2] !== 0) {
      throw new BuildError(path, "roofs need an upright scope");
    }
    const spec = arg.material ?? "@roof";
    const [W, H, D] = scope.size;
    const cap = numberOr(arg.height, H - 1);
    const { resolver } = this.host;
    const materials: RoofMaterials = {
      stairs: resolver.resolve(spec, path, "stairs"),
      slab: resolver.resolve(spec, path, "slab"),
      block: resolver.resolve(spec, path, "block"),
    };
    const g = arg.gable ?? "auto";
    const gable =
      g === false || g === "none" || g === "off"
        ? null
        : g === "auto"
          ? "auto"
          : resolver.resolve(g, `${path}.gable`);
    const parts: unknown[] =
      Array.isArray(arg.parts) && arg.parts.length > 0 ? arg.parts : [{}];
    parts.forEach((ps, i) => {
      const pp = `${path}.parts[${i}]`;
      if (!isObject(ps))
        throw new BuildError(pp, "each part must be an object");
      const at = ps.at ?? [0, 0];
      const sz = ps.size ?? ["~", "~"];
      if (
        !Array.isArray(at) ||
        at.length !== 2 ||
        !Array.isArray(sz) ||
        sz.length !== 2
      ) {
        throw new BuildError(pp, "'at' and 'size' are [x, z] pairs");
      }
      const px = resolvePosition(
        lengthOf(at[0], `${pp}.at[0]`, "position"),
        W,
        0,
      );
      const pz = resolvePosition(
        lengthOf(at[1], `${pp}.at[1]`, "position"),
        D,
        0,
      );
      const pw = resolveSize(
        lengthOf(sz[0], `${pp}.size[0]`, "size"),
        W,
        W - px,
      );
      const pd = resolveSize(
        lengthOf(sz[1], `${pp}.size[1]`, "size"),
        D,
        D - pz,
      );
      if (pw <= 0 || pd <= 0) return;
      const merged: Json = { ...arg, ...ps };
      delete merged.parts;
      this.parts.push({
        ...makePart(merged, scope, px, pz, pw, pd, cap, pp),
        materials,
        gable,
        solid: arg.solid === true,
        layer,
        seq,
        specKey: canonical(spec),
        gableKey: canonical(arg.gable ?? "auto"),
        path,
      });
    });
  }

  /** Merges and places every collected roof. Throws `BuildError`. */
  resolve(): void {
    if (this.parts.length === 0) return;
    const groups = new Map<string, RoofPart[]>();
    const groupBases: number[] = [];
    const sources: Source[] = [];
    for (const p of this.parts) {
      if (SKELETON.has(p.type)) {
        const k = JSON.stringify([
          p.base,
          p.pitch,
          p.specKey,
          p.layer.priority,
          p.gableKey,
        ]);
        const group = groups.get(k);
        if (group) group.push(p);
        else {
          groups.set(k, [p]);
          groupBases.push(p.base);
        }
      } else {
        sources.push(new Source([p], p.h, p.cells, p.core, p.type === "flat"));
      }
    }
    for (const ps of groups.values()) {
      const s = skeletonSource(ps);
      if (s) sources.push(s);
    }
    if (groups.size > 1 && new Set(groupBases).size < groups.size) {
      this.host.note({
        path: this.parts[0].path,
        message:
          "roofs with the same eave height but different pitch/material/priority " +
          "were combined by highest surface instead of merged into one roof",
      });
    }
    // Roofs at different eave heights are independent surfaces (a tower's
    // cone overhanging a low annex must not swallow the annex roof).
    const byBase = new Map<number, Source[]>();
    for (const s of sources) {
      const list = byBase.get(s.base);
      if (list) list.push(s);
      else byBase.set(s.base, [s]);
    }
    for (const group of byBase.values()) this.placeSurface(group);
  }

  private placeSurface(sources: Source[]) {
    const host = this.host;
    const F = (qx: number, qz: number): [number | null, Source | null] => {
      let best: number | null = null;
      let src: Source | null = null;
      for (const s of sources) {
        const v = s.h(qx, qz);
        if (v !== null && (best === null || v > best)) {
          best = v;
          src = s;
        }
      }
      return [best, src];
    };

    type Info =
      | { kind: "block"; src: Source }
      | { kind: "stairs"; dir: Dir; src: Source }
      | { kind: "slab"; type: "bottom" | "top"; src: Source };
    const allCells = new Set<number>();
    for (const s of sources) for (const c of s.cells) allCells.add(c);
    const top = new Map<number, number>();
    const info = new Map<number, Info>();
    for (const c of allCells) {
      const [x, z] = unkey(c);
      const [h, src] = F(x, z);
      if (h === null || src === null) continue;
      if (src.flat) {
        top.set(c, Math.floor(h));
        info.set(c, { kind: "block", src });
        continue;
      }
      let best: number | null = null;
      let bdir: Dir = DIRS[0];
      for (const d of DIRS) {
        const [v] = F(x + 0.5 * d[0], z + 0.5 * d[1]);
        if (v !== null && (best === null || v > best)) {
          best = v;
          bdir = d;
        }
      }
      let slope = best !== null ? (best - h) * 2 : 0;
      if (slope < 0.75) {
        // hip lines: only the diagonal rises. Use a stair facing one of its
        // axes; the stair-shape pass turns it into an outer corner.
        for (const d of DIAGONALS) {
          const [v] = F(x + 0.5 * d[0], z + 0.5 * d[1]);
          if (v !== null && (v - h) * 2 >= 0.75) {
            const [ax] = F(x + 0.5 * d[0], z);
            const [az] = F(x, z + 0.5 * d[1]);
            if (ax !== null && az !== null) {
              slope = 1;
              bdir = ax >= az ? [d[0], 0] : [0, d[1]];
              break;
            }
          }
        }
      }
      if (slope >= 0.75) {
        top.set(c, Math.floor(h + 0.5));
        info.set(c, { kind: "stairs", dir: bdir, src });
      } else {
        let lvl = Math.floor(h);
        const frac = h - lvl;
        let type: "bottom" | "top";
        if (frac < 0.25) type = "bottom";
        else if (frac < 0.75) type = "top";
        else {
          lvl += 1;
          type = "bottom";
        }
        top.set(c, lvl);
        info.set(c, { kind: "slab", type, src });
      }
    }

    for (const [c, lvl] of top) {
      const [x, z] = unkey(c);
      const cell = info.get(c)!;
      const src = cell.src;
      if (cell.kind === "stairs") {
        host.placeWorld(
          [x, lvl, z],
          src.materials.stairs,
          { facing: dirName(cell.dir), half: "bottom" },
          src,
        );
      } else if (cell.kind === "slab") {
        host.placeWorld(
          [x, lvl, z],
          src.materials.slab,
          { type: cell.type },
          src,
        );
      } else {
        host.placeWorld([x, lvl, z], src.materials.block, {}, src);
      }
      // fill down to where every side is closed: below a partial neighbour
      // (stair or slab) its open half would expose this column, so include
      // its level too
      const need: number[] = [];
      for (const [a, b] of DIRS) {
        const nk = key(x + a, z + b);
        const n = top.get(nk);
        if (n === undefined) continue;
        // does the neighbour's surface block show a full face to this column?
        const ni = info.get(nk)!;
        const fullFace =
          ni.kind === "block" ||
          (ni.kind === "stairs" && ni.dir[0] === -a && ni.dir[1] === -b);
        need.push(fullFace ? n : n - 1);
      }
      // roof edges need no infill
      let low = need.length > 0 ? Math.min(...need) : lvl;
      if (cell.kind === "slab" && cell.type === "top" && low < lvl) {
        // a top slab's open underside must not open into the attic
        low = Math.min(low, lvl - 2);
      }
      if (src.solid && src.core.has(c)) low = src.base - 1;
      for (let y = Math.max(src.base, low + 1); y < lvl; y++) {
        host.placeWorld([x, y, z], src.materials.block, {}, src);
      }
    }

    // gable / perimeter infill on the outer boundary of the combined footprint
    const coreAll = new Set<number>();
    for (const s of sources) for (const c of s.core) coreAll.add(c);
    this.info.push({
      core: [...coreAll].map(unkey),
      base: Math.min(...sources.map((s) => s.base)),
      top: new Map(top),
      path: [...new Set(sources.map((s) => s.parts[0].path))].sort().join(", "),
    });
    for (const c of coreAll) {
      const lvl = top.get(c);
      if (lvl === undefined) continue;
      const [x, z] = unkey(c);
      if (DIRS.every(([a, b]) => coreAll.has(key(x + a, z + b)))) continue;
      const cell = info.get(c)!;
      const owner = cell.src;
      const candidates = [owner, ...sources.filter((s) => s !== owner)];
      const src = candidates.find((s) => s.gable !== null && s.core.has(c));
      if (src === undefined) continue;
      let material = src.gable;
      if (material === "auto") {
        material = this.wallBelow(x, src.base, z);
        // nothing to continue: an open structure stays open
        if (material === null) continue;
      }
      if (material === null) continue;
      if (cell.kind === "slab" && cell.type === "top") {
        // a top slab over a wall leaves a half-block slot; close it
        host.placeWorld(
          [x, lvl, z],
          src.materials.slab,
          { type: "double" },
          src,
        );
      }
      for (let y = src.base; y < lvl; y++) {
        host.placeWorld([x, y, z], material, {}, src, true);
      }
    }
  }

  /**
   * For gable `"auto"`: the full block under the eave in this column, to
   * continue upward (only its `axis` kept), or null when the first block
   * found isn't a full opaque one.
   */
  private wallBelow(x: number, base: number, z: number): Material | null {
    const { registry } = this.host;
    for (let y = base - 1; y > Math.max(-1, base - 4); y--) {
      const b = this.host.peek([x, y, z]);
      if (b === null) continue;
      const kind = registry.kind(b.id);
      if (kind === "block" || kind === "log" || kind === "pillar") {
        const states: Record<string, string> = {};
        if (b.states.axis !== undefined) states.axis = b.states.axis;
        return { entries: [{ weight: 1, id: b.id, states }] };
      }
      return null;
    }
    return null;
  }
}

/** Something that reports a surface height at a world point. */
class Source {
  readonly materials: RoofMaterials;
  readonly gable: Material | "auto" | null;
  readonly solid: boolean;
  readonly layer: Layer;
  readonly seq: number;
  readonly base: number;
  readonly path: string;

  constructor(
    readonly parts: RoofPart[],
    readonly h: (qx: number, qz: number) => number | null,
    readonly cells: Set<number>,
    readonly core: Set<number>,
    readonly flat = false,
  ) {
    const p0 = parts[0];
    this.materials = p0.materials;
    this.gable = p0.gable;
    this.solid = parts.some((p) => p.solid);
    this.layer = p0.layer;
    this.seq = Math.min(...parts.map((p) => p.seq));
    this.base = p0.base;
    this.path = p0.path;
  }
}

function near(cells: Set<number>, qx: number, qz: number): boolean {
  for (const cx of new Set([Math.floor(qx + 0.5), Math.ceil(qx - 0.5)])) {
    for (const cz of new Set([Math.floor(qz + 0.5), Math.ceil(qz - 0.5)])) {
      if (cells.has(key(cx, cz))) return true;
    }
  }
  return false;
}

/**
 * One merged surface for skeleton parts: `pitch × (L∞ distance to the nearest
 * eave cell, less half a block)`. Null when the union has no eave at all.
 */
function skeletonSource(parts: RoofPart[]): Source | null {
  const cells = new Set<number>();
  const core = new Set<number>();
  for (const p of parts) {
    for (const c of p.cells) cells.add(c);
    for (const c of p.core) core.add(c);
  }
  const eave = new Set<number>();
  for (const c of cells) {
    const [x, z] = unkey(c);
    for (const d of DIRS) {
      const n = key(x + d[0], z + d[1]);
      if (cells.has(n)) continue;
      // the union's edge here belongs to every part containing this cell
      if (parts.some((p) => p.cells.has(c) && p.isEave(d))) eave.add(n);
    }
  }
  if (eave.size === 0) return null;
  const base = parts[0].base;
  const pitch = parts[0].pitch;
  const capRel = Math.min(...parts.map((p) => p.cap)) - base;
  const distance = chebyshevField([...eave].map(unkey), [...cells].map(unkey));
  const h = (qx: number, qz: number) => {
    if (!near(cells, qx, qz)) return null;
    const d = Math.max(distance(qx, qz) - 0.5, 0);
    return base + Math.max(0, Math.min(pitch * (d - 0.5), capRel));
  };
  return new Source(parts, h, cells, core);
}

/**
 * The Chebyshev (L∞) distance from half-block points to the nearest of
 * `sources`, by an 8-connected breadth-first search on a grid of half blocks
 * covering `sources` and `cells` with a block of margin (Cairn takes the
 * minimum over every eave cell, which is quadratic).
 */
function chebyshevField(
  sources: [number, number][],
  cells: [number, number][],
): (qx: number, qz: number) => number {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of [...sources, ...cells]) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  // doubled coordinates, one block of margin
  const ox = 2 * (minX - 1);
  const oz = 2 * (minZ - 1);
  const w = 2 * (maxX - minX + 2) + 1;
  const d = 2 * (maxZ - minZ + 2) + 1;
  const dist = new Int32Array(w * d).fill(-1);
  const queue = new Int32Array(w * d);
  let head = 0;
  let tail = 0;
  for (const [x, z] of sources) {
    const i = (2 * z - oz) * w + (2 * x - ox);
    if (dist[i] === 0) continue;
    dist[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const ix = i % w;
    const iz = (i - ix) / w;
    for (let dz = -1; dz <= 1; dz++) {
      const nz = iz + dz;
      if (nz < 0 || nz >= d) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = ix + dx;
        if (nx < 0 || nx >= w) continue;
        const n = nz * w + nx;
        if (dist[n] !== -1) continue;
        dist[n] = dist[i] + 1;
        queue[tail++] = n;
      }
    }
  }
  return (qx, qz) => {
    const ix = Math.round(2 * qx) - ox;
    const iz = Math.round(2 * qz) - oz;
    return dist[iz * w + ix] / 2;
  };
}

// One part's height function in world space, from its local footprint.
function makePart(
  a: Json,
  scope: Scope,
  x0: number,
  z0: number,
  W: number,
  D: number,
  cap: number,
  path: string,
): Pick<
  RoofPart,
  "type" | "pitch" | "base" | "cap" | "cells" | "core" | "h" | "isEave"
> {
  const type = a.type ?? "gable";
  if (
    typeof type !== "string" ||
    !(ROOF_TYPES as readonly string[]).includes(type)
  ) {
    throw new BuildError(
      `${path}.type`,
      `unknown roof type ${show(type)}. Use: ${ROOF_TYPES.join(", ")}`,
    );
  }
  const rtype = type as RoofType;
  const pitch = numberOr(a.pitch, 1);
  const ov = a.overhang ?? 1;
  let ol: number, or: number, ob: number, of: number;
  if (isObject(ov)) {
    const all = numberOr(ov.all, 1);
    ol = numberOr(ov.left, all);
    or = numberOr(ov.right, all);
    ob = numberOr(ov.back, all);
    of = numberOr(ov.front, all);
  } else {
    ol = or = ob = of = numberOr(ov, 1);
  }
  let ridge = a.ridge ?? "auto";
  if (ridge === "auto") ridge = W >= D ? "x" : "z";
  if (ridge !== "x" && ridge !== "z") {
    throw new BuildError(`${path}.ridge`, "must be 'x', 'z' or 'auto'");
  }

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
  const kb = numberOr(a.break, 0.5);
  const gambrel = (dd: number, span: number) => {
    const b = (span * kb) / 2;
    return dd <= b ? 2 * pitch * dd : 2 * pitch * b + 0.5 * pitch * (dd - b);
  };
  const domeH = typeof a.height === "number" ? a.height : R;
  const g: (u: number, v: number) => number = {
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
      domeH *
      Math.sqrt(Math.max(0, 1 - ((u - cx) / Rx) ** 2 - ((v - cz) / Rz) ** 2)),
    flat: () => 0,
  }[rtype];

  const [ox, oy, oz] = scope.origin;
  const { ux, uz } = scope;
  const base = oy;
  const toLocal = (qx: number, qz: number): [number, number] => {
    const ddx = qx - ox;
    const ddz = qz - oz;
    return [ddx * ux[0] + ddz * ux[2] - x0, ddx * uz[0] + ddz * uz[2] - z0];
  };
  const h = (qx: number, qz: number) => {
    const [u, v] = toLocal(qx, qz);
    if (!inside(u, v)) return null;
    return base + Math.max(0, Math.min(g(u, v), cap));
  };
  const worldCell = (u: number, v: number) => {
    const w = scope.world(u + x0, 0, v + z0);
    return key(w[0], w[2]);
  };
  const cells = new Set<number>();
  for (let u = -ol; u < W + or; u++) {
    for (let v = -ob; v < D + of; v++) {
      if (inside(u, v)) cells.add(worldCell(u, v));
    }
  }
  const core = new Set<number>();
  for (let u = 0; u < W; u++) {
    for (let v = 0; v < D; v++) {
      if (!round || inside(u, v)) core.add(worldCell(u, v));
    }
  }
  const isEave = ([wx, wz]: Dir) => {
    if (rtype === "hip" || rtype === "pyramid") return true;
    const lx = wx * ux[0] + wz * ux[2];
    const lz = wx * uz[0] + wz * uz[2];
    return ridge === "x" ? lz !== 0 : lx !== 0;
  };
  return { type: rtype, pitch, base, cap: base + cap, cells, core, h, isEave };
}
