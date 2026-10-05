// Static renders of a schematic from several angles (the "Static renders"
// contact sheet in the Advanced Editor): four isometric views, front, side
// and top elevations, plan slices and a cutaway. Blocks are drawn as
// flat-coloured cubes, one colour per palette entry; stairs, slabs, fences,
// panes, walls, doors, trapdoors and carpets as the boxes they fill
// (`block-shapes.ts`).
//
// Pure geometry: no DOM. `contact-sheet-draw.ts` paints the results on a
// canvas.

import type { ParsedSchematicProjection } from "../convert";
import { isInvisibleBlockId } from "../invisible-blocks";
import { blockShape, type BlockBox } from "./block-shapes";

/** One block of the model, in coordinates relative to the model's minimum. */
export interface Voxel {
  x: number;
  y: number;
  z: number;
  /** Index into `VoxelModel.colors`. */
  color: number;
  /** Index into `VoxelModel.shapes`; absent for a full cube. */
  shape?: number;
}

export interface VoxelModel {
  /** Extent along x, y and z; [0, 0, 0] when there are no blocks. */
  size: [number, number, number];
  voxels: Voxel[];
  /** sRGB hex colours (`#rrggbb`), indexed by `Voxel.color`. */
  colors: string[];
  /** Sub-block shapes, indexed by `Voxel.shape`. */
  shapes: BlockBox[][];
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
  // Placements are region-local; each region sits at its origin. `colorAt`
  // still gets the region-local position its block entities are keyed by.
  const placements = new Map<
    string,
    {
      regionIndex: number;
      local: [number, number, number];
      pos: [number, number, number];
      paletteIndex: number;
    }
  >();
  projection.regions.forEach((region, regionIndex) => {
    const [ox, oy, oz] = region.origin;
    for (const { pos: local, paletteIndex } of region.blocks) {
      const pos: [number, number, number] = [
        local[0] + ox,
        local[1] + oy,
        local[2] + oz,
      ];
      placements.set(pos.join(","), { regionIndex, local, pos, paletteIndex });
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
      shapes: [],
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
  const shapes: BlockBox[][] = [];
  const shapeIndex = new Map<string, number>();
  const paletteShapes = new Map<number, number | undefined>();
  const shapeOf = (paletteIndex: number) => {
    if (paletteShapes.has(paletteIndex)) return paletteShapes.get(paletteIndex);
    const { blockId, properties } = projection.palette[paletteIndex];
    const boxes = blockShape(blockId, properties);
    let index: number | undefined;
    if (boxes !== null) {
      const key = JSON.stringify(boxes);
      index = shapeIndex.get(key);
      if (index === undefined) {
        index = shapes.length;
        shapes.push(boxes);
        shapeIndex.set(key, index);
      }
    }
    paletteShapes.set(paletteIndex, index);
    return index;
  };
  const voxels = shown.map(
    ({ regionIndex, local, pos, paletteIndex }): Voxel => {
      let color: number | undefined;
      const override = colorAt?.(regionIndex, local, paletteIndex);
      if (override !== undefined) {
        color = intern(override);
      } else {
        color = paletteColors.get(paletteIndex);
        if (color === undefined) {
          color = intern(colorFor(paletteIndex));
          paletteColors.set(paletteIndex, color);
        }
      }
      const voxel: Voxel = {
        x: pos[0] - min[0],
        y: pos[1] - min[1],
        z: pos[2] - min[2],
        color,
      };
      const shape = shapeOf(paletteIndex);
      if (shape !== undefined) voxel.shape = shape;
      return voxel;
    },
  );
  return { size, voxels, colors, shapes, cells: voxelLookup(size, voxels) };
}

/** Whether a full cube sits at (x, y, z). */
function fullCubeAt(model: VoxelModel, x: number, y: number, z: number) {
  const i = model.cells.get(x, y, z);
  return i !== 0 && model.voxels[i - 1].shape === undefined;
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

/** A box in a cell's view coordinates: [u0, y0, v0, u1, y1, v1], each 0–1. */
type ViewBox = BlockBox;

const UNIT_VIEW_BOX: ViewBox = [0, 0, 0, 1, 1, 1];

/**
 * `boxes` turned into `corner`'s view coordinates and ordered back to front:
 * a box comes before every box it lies wholly behind along u, v or y (the
 * camera looks from +u, +v and +y).
 */
function orderedViewBoxes(corner: IsoCorner, boxes: readonly BlockBox[]) {
  // `toView` rotates the cell [0, 1]² onto a unit square that may start at
  // -1; shift it back to [0, 1]², as `isoView` places cells.
  const corners = [
    toView(corner, 0, 0),
    toView(corner, 1, 0),
    toView(corner, 0, 1),
    toView(corner, 1, 1),
  ];
  const offU = Math.min(...corners.map(([u]) => u));
  const offV = Math.min(...corners.map(([, v]) => v));
  const view = boxes.map(([x0, y0, z0, x1, y1, z1]): ViewBox => {
    const [ua, va] = toView(corner, x0, z0);
    const [ub, vb] = toView(corner, x1, z1);
    return [
      Math.min(ua, ub) - offU,
      y0,
      Math.min(va, vb) - offV,
      Math.max(ua, ub) - offU,
      y1,
      Math.max(va, vb) - offV,
    ];
  });
  const behind = (a: ViewBox, b: ViewBox) =>
    a[3] <= b[0] || a[4] <= b[1] || a[5] <= b[2];
  const centre = (b: ViewBox) => b[0] + b[1] + b[2] + b[3] + b[4] + b[5];
  const left = [...view];
  const ordered: ViewBox[] = [];
  while (left.length > 0) {
    // The backmost box no remaining box lies behind, nearest the back first.
    let pick = -1;
    for (let i = 0; i < left.length; i++) {
      const blocked = left.some(
        (other, j) => j !== i && behind(other, left[i]),
      );
      if (!blocked && (pick < 0 || centre(left[i]) < centre(left[pick]))) {
        pick = i;
      }
    }
    // Boxes that overlap each other have no strict order; fall back to centres.
    if (pick < 0) {
      pick = 0;
      for (let i = 1; i < left.length; i++) {
        if (centre(left[i]) < centre(left[pick])) pick = i;
      }
    }
    ordered.push(left[pick]);
    left.splice(pick, 1);
  }
  return ordered;
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
  // Only full cubes hide a neighbour's face.
  const full = (x: number, y: number, z: number) =>
    y <= maxY && fullCubeAt(model, x, y, z);
  const viewBoxes = model.shapes.map((boxes) =>
    orderedViewBoxes(corner, boxes),
  );

  const drawn: { depth: number; faces: IsoFace[] }[] = [];
  for (const voxel of model.voxels) {
    const { x, y, z } = voxel;
    if (y > maxY) continue;
    const [u, v] = toView(corner, x, z);
    const boxes =
      voxel.shape === undefined ? [UNIT_VIEW_BOX] : viewBoxes[voxel.shape];
    const faces: IsoFace[] = [];
    for (const [u0, y0, v0, u1, y1, v1] of boxes) {
      // A face on the cell's boundary is hidden by a full cube next to it.
      if (!(y1 === 1 && full(x, y + 1, z))) {
        faces.push({
          kind: "top",
          color: voxel.color,
          points: [
            project(u + u0, y + y1, v + v0),
            project(u + u1, y + y1, v + v0),
            project(u + u1, y + y1, v + v1),
            project(u + u0, y + y1, v + v1),
          ],
        });
      }
      if (!(u1 === 1 && full(x + uStep[0], y, z + uStep[1]))) {
        faces.push({
          kind: "right",
          color: voxel.color,
          points: [
            project(u + u1, y + y1, v + v0),
            project(u + u1, y + y1, v + v1),
            project(u + u1, y + y0, v + v1),
            project(u + u1, y + y0, v + v0),
          ],
        });
      }
      if (!(v1 === 1 && full(x + vStep[0], y, z + vStep[1]))) {
        faces.push({
          kind: "left",
          color: voxel.color,
          points: [
            project(u + u0, y + y1, v + v1),
            project(u + u1, y + y1, v + v1),
            project(u + u1, y + y0, v + v1),
            project(u + u0, y + y0, v + v1),
          ],
        });
      }
    }
    if (faces.length > 0) drawn.push({ depth: u + v + y, faces });
  }
  // Cells back to front; `sort` is stable, so a cell's boxes keep their order.
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
  /** Per cell, the nearest full cube's colour (-1 = none). */
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
  /**
   * Sub-block shapes in front of a cell's full cube (or of nothing), keyed
   * by cell index and listed far to near. Each fills only the part of the
   * cell its boxes cover.
   */
  partial: Map<number, OrthoPartial[]>;
}

export interface OrthoPartial {
  color: number;
  /** As `OrthoGrid.nearness`. */
  nearness: number;
  /** For plan slices: shows the layer below, drawn faded. */
  below?: boolean;
  /** Covered areas in cell-local 0–1 coordinates: [col0, row0, col1, row1]. */
  rects: [number, number, number, number][];
}

export type Elevation = "front" | "side" | "top";

function emptyGrid(width: number, height: number): OrthoGrid {
  return {
    width,
    height,
    cells: new Int32Array(width * height).fill(-1),
    nearness: new Float32Array(width * height),
    partial: new Map(),
  };
}

// A box's footprint in a view's cell, rows growing downwards.
type Footprint = (b: BlockBox) => [number, number, number, number];

const FOOTPRINTS: Record<Elevation, Footprint> = {
  front: ([x0, y0, , x1, y1]) => [x0, 1 - y1, x1, 1 - y0],
  side: ([, y0, z0, , y1, z1]) => [1 - z1, 1 - y1, 1 - z0, 1 - y0],
  top: ([x0, , z0, x1, , z1]) => [x0, z0, x1, z1],
};

function footprint(
  model: VoxelModel,
  voxel: Voxel,
  view: Elevation,
): [number, number, number, number][] {
  return model.shapes[voxel.shape!].map(FOOTPRINTS[view]);
}

function addPartial(grid: OrthoGrid, i: number, partial: OrthoPartial) {
  let list = grid.partial.get(i);
  if (list === undefined) {
    list = [];
    grid.partial.set(i, list);
  }
  list.push(partial);
}

/**
 * An elevation of `model`: "front" looks north from the south (x to the
 * right, y up), "side" looks west from the east (south on the left, y up),
 * "top" looks down with north up (x to the right, z down). Each cell shows
 * the nearest full cube along the view direction, and the sub-block shapes
 * in front of it by the area they cover.
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
  const nearness = (d: number) => (depthRange <= 1 ? 1 : d / (depthRange - 1));
  const grid = emptyGrid(width, height);
  const depth = new Int32Array(width * height).fill(-1);
  for (const voxel of model.voxels) {
    if (voxel.shape !== undefined) continue;
    const [col, row, d] = cell(voxel);
    const i = row * width + col;
    if (d > depth[i]) {
      depth[i] = d;
      grid.cells[i] = voxel.color;
    }
  }
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] >= 0) grid.nearness[i] = nearness(depth[i]);
  }
  const partials: { i: number; d: number; voxel: Voxel }[] = [];
  for (const voxel of model.voxels) {
    if (voxel.shape === undefined) continue;
    const [col, row, d] = cell(voxel);
    const i = row * width + col;
    if (d > depth[i]) partials.push({ i, d, voxel });
  }
  partials.sort((a, b) => a.d - b.d);
  for (const { i, d, voxel } of partials) {
    addPartial(grid, i, {
      color: voxel.color,
      nearness: nearness(d),
      rects: footprint(model, voxel, view),
    });
  }
  return grid;
}

/**
 * The layer at `y` seen from above (north up), with the layer below shown
 * where `y` has no full cube (`below`). Sub-block shapes fill the area they
 * cover.
 */
export function planSlice(model: VoxelModel, y: number): OrthoGrid {
  const [sx, , sz] = model.size;
  const grid = emptyGrid(sx, sz);
  grid.below = new Uint8Array(sx * sz);
  const at = new Map<number, Voxel>();
  const under = new Map<number, Voxel>();
  for (const voxel of model.voxels) {
    const i = voxel.z * sx + voxel.x;
    if (voxel.y === y) at.set(i, voxel);
    else if (voxel.y === y - 1) under.set(i, voxel);
  }
  const show = (i: number, voxel: Voxel, below: boolean) => {
    if (voxel.shape === undefined) {
      grid.cells[i] = voxel.color;
      grid.below![i] = below ? 1 : 0;
      grid.nearness[i] = 1;
    } else {
      addPartial(grid, i, {
        color: voxel.color,
        nearness: 1,
        ...(below ? { below } : {}),
        rects: footprint(model, voxel, "top"),
      });
    }
  };
  for (let i = 0; i < sx * sz; i++) {
    const top = at.get(i);
    const bottom = under.get(i);
    if (
      bottom !== undefined &&
      (top === undefined || top.shape !== undefined)
    ) {
      show(i, bottom, true);
    }
    if (top !== undefined) show(i, top, false);
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
