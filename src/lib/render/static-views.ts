// Static renders of a schematic from several angles (the "Static renders"
// contact sheet in the Advanced Editor): four isometric views, front, side
// and top elevations, plan slices and a cutaway. Blocks are drawn as
// flat-coloured cubes, one colour per palette entry.
//
// Pure geometry: no DOM. `contact-sheet-draw.ts` paints the results on a
// canvas.

import type { ParsedSchematicProjection } from "../convert";
import { isInvisibleBlockId } from "../invisible-blocks";

/** One block of the model, in coordinates relative to the model's minimum. */
export interface Voxel {
  x: number;
  y: number;
  z: number;
  /** Index into `VoxelModel.colors`. */
  color: number;
}

export interface VoxelModel {
  /** Extent along x, y and z; [0, 0, 0] when there are no blocks. */
  size: [number, number, number];
  voxels: Voxel[];
  /** sRGB hex colours (`#rrggbb`), indexed by `Voxel.color`. */
  colors: string[];
  /** Voxel index + 1 per cell; 0 = empty. */
  cells: VoxelLookup;
}

interface VoxelLookup {
  get(x: number, y: number, z: number): number;
}

// Above this many cells the grid lookup is a Map instead of a typed array.
const MAX_DENSE_CELLS = 1 << 24;

function voxelLookup(
  size: [number, number, number],
  voxels: readonly Voxel[],
): VoxelLookup {
  const [sx, sy, sz] = size;
  const inside = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  const index = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  if (sx * sy * sz <= MAX_DENSE_CELLS) {
    const dense = new Uint32Array(sx * sy * sz);
    voxels.forEach((v, i) => (dense[index(v.x, v.y, v.z)] = i + 1));
    return {
      get: (x, y, z) => (inside(x, y, z) ? dense[index(x, y, z)] : 0),
    };
  }
  const sparse = new Map<number, number>();
  voxels.forEach((v, i) => sparse.set(index(v.x, v.y, v.z), i + 1));
  return {
    get: (x, y, z) => (inside(x, y, z) ? (sparse.get(index(x, y, z)) ?? 0) : 0),
  };
}

/**
 * The visible blocks of `projection` as one voxel model. `colorFor` gives a
 * palette entry's colour (`#rrggbb`); `colorAt` may override it per block
 * (camo blocks take their camo's colour). Later regions win where regions
 * overlap.
 */
export function buildVoxelModel(
  projection: ParsedSchematicProjection,
  colorFor: (paletteIndex: number) => string,
  colorAt?: (
    regionIndex: number,
    pos: [number, number, number],
    paletteIndex: number,
  ) => string | undefined,
): VoxelModel {
  const visible = projection.palette.map(
    (entry) => !isInvisibleBlockId(entry.blockId),
  );
  // The last placement per cell wins, even an invisible one (it clears the
  // cell); only then are invisible blocks dropped.
  const placements = new Map<
    string,
    { regionIndex: number; pos: [number, number, number]; paletteIndex: number }
  >();
  projection.regions.forEach((region, regionIndex) => {
    for (const { pos, paletteIndex } of region.blocks) {
      placements.set(pos.join(","), { regionIndex, pos, paletteIndex });
    }
  });
  const shown = [...placements.values()].filter((p) => visible[p.paletteIndex]);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of shown) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], pos[axis]);
      max[axis] = Math.max(max[axis], pos[axis]);
    }
  }
  if (min[0] === Infinity) {
    return {
      size: [0, 0, 0],
      voxels: [],
      colors: [],
      cells: voxelLookup([0, 0, 0], []),
    };
  }
  const size: [number, number, number] = [
    max[0] - min[0] + 1,
    max[1] - min[1] + 1,
    max[2] - min[2] + 1,
  ];

  const colors: string[] = [];
  const colorIndex = new Map<string, number>();
  const intern = (color: string) => {
    let i = colorIndex.get(color);
    if (i === undefined) {
      i = colors.length;
      colors.push(color);
      colorIndex.set(color, i);
    }
    return i;
  };
  const paletteColors = new Map<number, number>();
  const voxels = shown.map(({ regionIndex, pos, paletteIndex }): Voxel => {
    let color: number | undefined;
    const override = colorAt?.(regionIndex, pos, paletteIndex);
    if (override !== undefined) {
      color = intern(override);
    } else {
      color = paletteColors.get(paletteIndex);
      if (color === undefined) {
        color = intern(colorFor(paletteIndex));
        paletteColors.set(paletteIndex, color);
      }
    }
    return {
      x: pos[0] - min[0],
      y: pos[1] - min[1],
      z: pos[2] - min[2],
      color,
    };
  });
  return { size, voxels, colors, cells: voxelLookup(size, voxels) };
}

// ── Isometric views ───────────────────────────────────────────────────────

/** The corner the camera looks from. */
export type IsoCorner =
  | "south-east"
  | "north-east"
  | "north-west"
  | "south-west";

export const ISO_CORNERS: readonly IsoCorner[] = [
  "south-east",
  "north-east",
  "north-west",
  "south-west",
];

/** Which way a drawn face points: up, or one of the two sides facing the camera. */
export type IsoFaceKind = "top" | "right" | "left";

export interface IsoFace {
  kind: IsoFaceKind;
  color: number;
  /** Four screen-space corners, in block units (y grows downwards). */
  points: [number, number][];
}

export interface IsoView {
  faces: IsoFace[];
  /** Screen-space bounds of `faces`, in block units. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Unit screen-space direction of north (-z). */
  north: [number, number];
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

// Each corner maps world (x, z) to view (u, v) by a rotation about y, chosen
// so the camera sits towards +u and +v.
function toView(corner: IsoCorner, x: number, z: number): [number, number] {
  switch (corner) {
    case "south-east":
      return [x, z];
    case "north-east":
      return [-z, x];
    case "north-west":
      return [-x, -z];
    case "south-west":
      return [z, -x];
  }
}

function project(u: number, y: number, v: number): [number, number] {
  return [(u - v) * COS30, (u + v) * SIN30 - y];
}

export interface IsoOptions {
  /** Leave out blocks above this y (relative to the model), for a cutaway. */
  maxY?: number;
}

/**
 * The faces of an isometric view of `model` from `corner`, back to front
 * (paint them in order). Faces hidden behind a neighbouring block are left
 * out.
 */
export function isoView(
  model: VoxelModel,
  corner: IsoCorner,
  options: IsoOptions = {},
): IsoView {
  const maxY = options.maxY ?? Infinity;
  const [du, dv] = toView(corner, 1, 0);
  const [eu, ev] = toView(corner, 0, 1);
  // World step that moves +1 along u and along v.
  const uStep = du !== 0 ? [du, 0] : [0, eu];
  const vStep = dv !== 0 ? [dv, 0] : [0, ev];
  const solid = (x: number, y: number, z: number) =>
    y <= maxY && model.cells.get(x, y, z) !== 0;

  const drawn: { depth: number; faces: IsoFace[] }[] = [];
  for (const voxel of model.voxels) {
    const { x, y, z } = voxel;
    if (y > maxY) continue;
    const [u, v] = toView(corner, x, z);
    const faces: IsoFace[] = [];
    if (!solid(x, y + 1, z)) {
      faces.push({
        kind: "top",
        color: voxel.color,
        points: [
          project(u, y + 1, v),
          project(u + 1, y + 1, v),
          project(u + 1, y + 1, v + 1),
          project(u, y + 1, v + 1),
        ],
      });
    }
    if (!solid(x + uStep[0], y, z + uStep[1])) {
      faces.push({
        kind: "right",
        color: voxel.color,
        points: [
          project(u + 1, y + 1, v),
          project(u + 1, y + 1, v + 1),
          project(u + 1, y, v + 1),
          project(u + 1, y, v),
        ],
      });
    }
    if (!solid(x + vStep[0], y, z + vStep[1])) {
      faces.push({
        kind: "left",
        color: voxel.color,
        points: [
          project(u, y + 1, v + 1),
          project(u + 1, y + 1, v + 1),
          project(u + 1, y, v + 1),
          project(u, y, v + 1),
        ],
      });
    }
    if (faces.length > 0) drawn.push({ depth: u + v + y, faces });
  }
  drawn.sort((a, b) => a.depth - b.depth);
  const faces = drawn.flatMap((d) => d.faces);

  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  if (faces.length > 0) {
    bounds.minX = bounds.minY = Infinity;
    bounds.maxX = bounds.maxY = -Infinity;
    for (const face of faces) {
      for (const [px, py] of face.points) {
        bounds.minX = Math.min(bounds.minX, px);
        bounds.minY = Math.min(bounds.minY, py);
        bounds.maxX = Math.max(bounds.maxX, px);
        bounds.maxY = Math.max(bounds.maxY, py);
      }
    }
  }
  const [nu, nv] = toView(corner, 0, -1);
  const [nx, ny] = project(nu, 0, nv);
  const length = Math.hypot(nx, ny);
  return { faces, bounds, north: [nx / length, ny / length] };
}

// ── Orthographic views ────────────────────────────────────────────────────

/** A 2D grid of colour indices (-1 = empty), row 0 at the top. */
export interface OrthoGrid {
  width: number;
  height: number;
  cells: Int32Array;
  /**
   * Per cell, 0–1: how far the block is from the viewer's far side (top
   * view: its height), so drawing can shade depth. 1 = nearest.
   */
  nearness: Float32Array;
  /**
   * Per cell, for plan slices: true when the cell shows the layer below,
   * drawn faded.
   */
  below?: Uint8Array;
}

export type Elevation = "front" | "side" | "top";

function emptyGrid(width: number, height: number): OrthoGrid {
  return {
    width,
    height,
    cells: new Int32Array(width * height).fill(-1),
    nearness: new Float32Array(width * height),
  };
}

/**
 * An elevation of `model`: "front" looks north from the south (x to the
 * right, y up), "side" looks west from the east (south on the left, y up),
 * "top" looks down with north up (x to the right, z down). Each cell shows
 * the nearest block along the view direction.
 */
export function elevation(model: VoxelModel, view: Elevation): OrthoGrid {
  const [sx, sy, sz] = model.size;
  // Column and row of a voxel, and its depth (bigger = nearer the viewer).
  let width: number, height: number, depthRange: number;
  let cell: (v: Voxel) => [number, number, number];
  switch (view) {
    case "front":
      [width, height, depthRange] = [sx, sy, sz];
      cell = (v) => [v.x, sy - 1 - v.y, v.z];
      break;
    case "side":
      [width, height, depthRange] = [sz, sy, sx];
      cell = (v) => [sz - 1 - v.z, sy - 1 - v.y, v.x];
      break;
    case "top":
      [width, height, depthRange] = [sx, sz, sy];
      cell = (v) => [v.x, v.z, v.y];
      break;
  }
  const grid = emptyGrid(width, height);
  const depth = new Int32Array(width * height).fill(-1);
  for (const voxel of model.voxels) {
    const [col, row, d] = cell(voxel);
    const i = row * width + col;
    if (d > depth[i]) {
      depth[i] = d;
      grid.cells[i] = voxel.color;
    }
  }
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] >= 0) {
      grid.nearness[i] = depthRange <= 1 ? 1 : depth[i] / (depthRange - 1);
    }
  }
  return grid;
}

/**
 * The layer at `y` seen from above (north up), with the layer below shown
 * where `y` has no block (`below`).
 */
export function planSlice(model: VoxelModel, y: number): OrthoGrid {
  const [sx, , sz] = model.size;
  const grid = emptyGrid(sx, sz);
  grid.below = new Uint8Array(sx * sz);
  for (const voxel of model.voxels) {
    const i = voxel.z * sx + voxel.x;
    if (voxel.y === y) {
      grid.cells[i] = voxel.color;
      grid.below[i] = 0;
      grid.nearness[i] = 1;
    } else if (voxel.y === y - 1 && grid.cells[i] === -1) {
      grid.cells[i] = voxel.color;
      grid.below[i] = 1;
      grid.nearness[i] = 1;
    }
  }
  return grid;
}

/**
 * Two layers worth a plan slice: one in the lower half of the model and one
 * in the upper half, each just above that half's "floor", the highest layer
 * holding at least 80% as many blocks as the half's densest layer (so a floor
 * wins over a slightly bigger foundation under it). Both are clamped into the
 * model; with one layer they're equal.
 */
export function defaultPlanLevels(model: VoxelModel): [number, number] {
  const sy = model.size[1];
  if (sy <= 1) return [0, 0];
  const counts = new Array<number>(sy).fill(0);
  for (const voxel of model.voxels) counts[voxel.y]++;
  const floor = (from: number, to: number) => {
    const most = Math.max(...counts.slice(from, to));
    let best = from;
    for (let y = from; y < to; y++) if (counts[y] >= 0.8 * most) best = y;
    return best;
  };
  const half = Math.ceil(sy / 2);
  const clamp = (y: number) => Math.min(sy - 1, y);
  return [clamp(floor(0, half) + 1), clamp(floor(half, sy) + 1)];
}

// ── Colours ───────────────────────────────────────────────────────────────

/** OKLab `[L, a, b]` → `#rrggbb`, clipped into the sRGB gamut. */
export function oklabToHex([L, a, b]: readonly [
  number,
  number,
  number,
]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    "#" +
    linear
      .map((c) => {
        const clipped = Math.min(1, Math.max(0, c));
        const srgb =
          clipped <= 0.0031308
            ? clipped * 12.92
            : 1.055 * clipped ** (1 / 2.4) - 0.055;
        return Math.round(srgb * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/** A stable colour for a block with no colour data, derived from its id. */
export function fallbackBlockColor(blockId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < blockId.length; i++) {
    hash = Math.imul(hash ^ blockId.charCodeAt(i), 0x01000193);
  }
  const hue = ((hash >>> 0) % 360) * (Math.PI / 180);
  return oklabToHex([0.62, 0.1 * Math.cos(hue), 0.1 * Math.sin(hue)]);
}

/** `hex` with each channel scaled by `factor` (darkening below 1). */
export function shadeHex(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(Math.min(255, ((value >> shift) & 0xff) * factor))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** `hex` mixed towards white by `amount` (0–1). */
export function fadeHex(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 0xff;
    return Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
