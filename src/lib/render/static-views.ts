// Static renders of a schematic from several angles (the "Static renders"
// contact sheet in the Advanced Editor): four isometric views, front, side
// and top elevations, plan slices and a cutaway. Blocks are drawn as
// flat-coloured cubes, one colour per palette entry, or as the boxes of their
// shape for stairs, slabs, fences and the like (`block-shapes.ts`).
//
// Pure geometry: no DOM. `contact-sheet-draw.ts` paints the results on a
// canvas.

import type { ParsedSchematicProjection } from "../convert";
import { isInvisibleBlockId } from "../invisible-blocks";
import { blockShape, type ShapeBox } from "./block-shapes";

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
  /** Voxel index + 1 per cell; 0 = empty. */
  cells: VoxelLookup;
  /** The boxes of each sub-block shape, indexed by `Voxel.shape`. */
  shapes: (readonly ShapeBox[])[];
}

const FULL_CUBE: readonly ShapeBox[] = [[0, 0, 0, 1, 1, 1]];

function boxesOf(model: VoxelModel, voxel: Voxel): readonly ShapeBox[] {
  return voxel.shape === undefined ? FULL_CUBE : model.shapes[voxel.shape];
}

/**
 * Whether `boxes` cover the whole face of their cell on the `side` (0 = low,
 * 1 = high) of `axis` (0 = x, 1 = y, 2 = z).
 */
function coversFace(
  boxes: readonly ShapeBox[],
  axis: number,
  side: 0 | 1,
): boolean {
  return boxes.some(
    (box) =>
      box[axis + 3 * side] === side &&
      [0, 1, 2].every(
        (other) => other === axis || (box[other] === 0 && box[other + 3] === 1),
      ),
  );
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
      cells: voxelLookup([0, 0, 0], []),
      shapes: [],
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
  // Equal shapes share one index.
  const shapes: (readonly ShapeBox[])[] = [];
  const shapeIndex = new Map<string, number>();
  const paletteShapes = new Map<number, number | undefined>();
  const shapeOf = (paletteIndex: number) => {
    if (paletteShapes.has(paletteIndex)) return paletteShapes.get(paletteIndex);
    const { blockId, properties } = projection.palette[paletteIndex];
    const boxes = blockShape(blockId, properties);
    let index: number | undefined;
    if (boxes !== undefined) {
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
  return { size, voxels, colors, cells: voxelLookup(size, voxels), shapes };
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

/** A box in view coordinates, cell-local: u0, y0, v0, u1, y1, v1. */
type ViewBox = ShapeBox;

// `box` in the view coordinates of `corner`, still within its cell.
function viewBox(corner: IsoCorner, box: ShapeBox): ViewBox {
  const [x0, y0, z0, x1, y1, z1] = box;
  const [ua, va] = toView(corner, x0 - 0.5, z0 - 0.5);
  const [ub, vb] = toView(corner, x1 - 0.5, z1 - 0.5);
  return [
    Math.min(ua, ub) + 0.5,
    y0,
    Math.min(va, vb) + 0.5,
    Math.max(ua, ub) + 0.5,
    y1,
    Math.max(va, vb) + 0.5,
  ];
}

// Whether `a` can hide part of `b` from the camera (at +u, +y, +v): some
// point of `a` is nearer than some point of `b` on every axis.
const mayOcclude = (a: ViewBox, b: ViewBox) =>
  a[3] > b[0] && a[4] > b[1] && a[5] > b[2];

/** The boxes of one cell in painting order: each after every box it may hide. */
export function paintOrder(boxes: readonly ViewBox[]): ViewBox[] {
  const rest = [...boxes];
  const ordered: ViewBox[] = [];
  while (rest.length > 0) {
    const next = rest.findIndex((a) =>
      rest.every((b) => b === a || !mayOcclude(a, b)),
    );
    // Boxes that hide each other in a cycle can't be painted correctly in
    // any order; take the first.
    ordered.push(...rest.splice(Math.max(0, next), 1));
  }
  return ordered;
}

/**
 * The faces of an isometric view of `model` from `corner`, back to front
 * (paint them in order). Blocks are drawn as their shape's boxes; faces hidden
 * behind a neighbouring block that covers them are left out.
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
  // The world axis of each step, and the side of the neighbour's cell that
  // faces back.
  const uAxis = uStep[0] !== 0 ? 0 : 2;
  const vAxis = vStep[0] !== 0 ? 0 : 2;
  const uBack = uStep[0] + uStep[1] > 0 ? 0 : 1;
  const vBack = vStep[0] + vStep[1] > 0 ? 0 : 1;

  // Per shape (-1 = full cube): its boxes in view coordinates, in painting
  // order, and which faces of its cell it covers.
  const shapeCache = new Map<
    number,
    { boxes: ViewBox[]; covers: [boolean, boolean, boolean] }
  >();
  const shapeInfo = (voxel: Voxel) => {
    const key = voxel.shape ?? -1;
    let info = shapeCache.get(key);
    if (info === undefined) {
      const boxes = boxesOf(model, voxel);
      info = {
        boxes: paintOrder(boxes.map((box) => viewBox(corner, box))),
        covers: [
          coversFace(boxes, 1, 0),
          coversFace(boxes, uAxis, uBack),
          coversFace(boxes, vAxis, vBack),
        ],
      };
      shapeCache.set(key, info);
    }
    return info;
  };
  // Whether the block at (x, y, z) covers its face number `face` of
  // `shapeInfo`'s `covers` (0 = bottom, 1 = towards -u, 2 = towards -v).
  const covered = (x: number, y: number, z: number, face: number) => {
    if (y > maxY) return false;
    const index = model.cells.get(x, y, z);
    return index !== 0 && shapeInfo(model.voxels[index - 1]).covers[face];
  };

  const drawn: { depth: number; faces: IsoFace[] }[] = [];
  for (const voxel of model.voxels) {
    const { x, y, z } = voxel;
    if (y > maxY) continue;
    const [u, v] = toView(corner, x, z);
    const coveredTop = covered(x, y + 1, z, 0);
    const coveredRight = covered(x + uStep[0], y, z + uStep[1], 1);
    const coveredLeft = covered(x + vStep[0], y, z + vStep[1], 2);
    const faces: IsoFace[] = [];
    for (const box of shapeInfo(voxel).boxes) {
      const [u0, y0, v0, u1, y1, v1] = [
        u + box[0],
        y + box[1],
        v + box[2],
        u + box[3],
        y + box[4],
        v + box[5],
      ];
      if (!(box[4] === 1 && coveredTop)) {
        faces.push({
          kind: "top",
          color: voxel.color,
          points: [
            project(u0, y1, v0),
            project(u1, y1, v0),
            project(u1, y1, v1),
            project(u0, y1, v1),
          ],
        });
      }
      if (!(box[3] === 1 && coveredRight)) {
        faces.push({
          kind: "right",
          color: voxel.color,
          points: [
            project(u1, y1, v0),
            project(u1, y1, v1),
            project(u1, y0, v1),
            project(u1, y0, v0),
          ],
        });
      }
      if (!(box[5] === 1 && coveredLeft)) {
        faces.push({
          kind: "left",
          color: voxel.color,
          points: [
            project(u0, y1, v1),
            project(u1, y1, v1),
            project(u1, y0, v1),
            project(u0, y0, v1),
          ],
        });
      }
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

/** A rectangle inside a grid cell, cell-local (0–1, y down): x0, y0, x1, y1. */
export type CellRect = readonly [number, number, number, number];

/** A layer of an `OrthoGrid`, one entry per cell, row 0 at the top. */
export interface OrthoLayer {
  /** Colour indices; -1 = empty. */
  cells: Int32Array;
  /**
   * Per cell, 0–1: how far the block is from the viewer's far side (top
   * view: its height), so drawing can shade depth. 1 = nearest.
   */
  nearness: Float32Array;
  /**
   * Per cell, -1 when the block fills the cell, else an index into
   * `OrthoGrid.shapes`: the part of the cell the block covers.
   */
  shape: Int32Array;
}

/** A 2D grid of colour indices (-1 = empty), row 0 at the top. */
export interface OrthoGrid extends OrthoLayer {
  width: number;
  height: number;
  /**
   * Per cell, for plan slices: true when the cell shows the layer below,
   * drawn faded.
   */
  below?: Uint8Array;
  /** The rectangles of each partly filled cell, indexed by `shape`. */
  shapes: (readonly CellRect[])[];
  /**
   * Drawn first, where the nearest block doesn't fill its cell: in
   * elevations the nearest block behind it that does, in plan slices the
   * layer below (drawn faded). -1 = nothing.
   */
  under: OrthoLayer;
}

export type Elevation = "front" | "side" | "top";

function emptyLayer(cells: number): OrthoLayer {
  return {
    cells: new Int32Array(cells).fill(-1),
    nearness: new Float32Array(cells),
    shape: new Int32Array(cells).fill(-1),
  };
}

function emptyGrid(width: number, height: number): OrthoGrid {
  return {
    width,
    height,
    ...emptyLayer(width * height),
    shapes: [],
    under: emptyLayer(width * height),
  };
}

// Whether `rects` cover the whole cell, sampled on a 16 × 16 grid.
function fillsCell(rects: readonly CellRect[]): boolean {
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const [cx, cy] = [(i + 0.5) / 16, (j + 0.5) / 16];
      if (
        !rects.some(
          ([x0, y0, x1, y1]) => cx > x0 && cx < x1 && cy > y0 && cy < y1,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * The grid shape (-1 = fills the cell, else an index into `grid.shapes`) of
 * each voxel, given how a box projects into a cell.
 */
function gridShapes(
  model: VoxelModel,
  grid: OrthoGrid,
  rectOf: (box: ShapeBox) => CellRect,
): (voxel: Voxel) => number {
  const cache = new Map<number, number>();
  return (voxel) => {
    if (voxel.shape === undefined) return -1;
    let index = cache.get(voxel.shape);
    if (index === undefined) {
      const rects = model.shapes[voxel.shape].map(rectOf);
      index = fillsCell(rects) ? -1 : grid.shapes.push(rects) - 1;
      cache.set(voxel.shape, index);
    }
    return index;
  };
}

// Projections of a box into a cell, for each view.
const FRONT_RECT = ([x0, y0, , x1, y1]: ShapeBox): CellRect => [
  x0,
  1 - y1,
  x1,
  1 - y0,
];
const SIDE_RECT = ([, y0, z0, , y1, z1]: ShapeBox): CellRect => [
  1 - z1,
  1 - y1,
  1 - z0,
  1 - y0,
];
const TOP_RECT = ([x0, , z0, x1, , z1]: ShapeBox): CellRect => [x0, z0, x1, z1];

/**
 * An elevation of `model`: "front" looks north from the south (x to the
 * right, y up), "side" looks west from the east (south on the left, y up),
 * "top" looks down with north up (x to the right, z down). Each cell shows
 * the nearest block along the view direction, covering the part of the cell
 * its shape does, over the nearest block that fills the cell.
 */
export function elevation(model: VoxelModel, view: Elevation): OrthoGrid {
  const [sx, sy, sz] = model.size;
  // Column and row of a voxel, and its depth (bigger = nearer the viewer).
  let width: number, height: number, depthRange: number;
  let cell: (v: Voxel) => [number, number, number];
  let rectOf: (box: ShapeBox) => CellRect;
  switch (view) {
    case "front":
      [width, height, depthRange] = [sx, sy, sz];
      cell = (v) => [v.x, sy - 1 - v.y, v.z];
      rectOf = FRONT_RECT;
      break;
    case "side":
      [width, height, depthRange] = [sz, sy, sx];
      cell = (v) => [sz - 1 - v.z, sy - 1 - v.y, v.x];
      rectOf = SIDE_RECT;
      break;
    case "top":
      [width, height, depthRange] = [sx, sz, sy];
      cell = (v) => [v.x, v.z, v.y];
      rectOf = TOP_RECT;
      break;
  }
  const grid = emptyGrid(width, height);
  const shapeOf = gridShapes(model, grid, rectOf);
  const depth = new Int32Array(width * height).fill(-1);
  const fullDepth = new Int32Array(width * height).fill(-1);
  for (const voxel of model.voxels) {
    const [col, row, d] = cell(voxel);
    const i = row * width + col;
    const shape = shapeOf(voxel);
    if (d > depth[i]) {
      depth[i] = d;
      grid.cells[i] = voxel.color;
      grid.shape[i] = shape;
    }
    if (shape === -1 && d > fullDepth[i]) {
      fullDepth[i] = d;
      grid.under.cells[i] = voxel.color;
    }
  }
  const nearness = (d: number) => (depthRange <= 1 ? 1 : d / (depthRange - 1));
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] >= 0) grid.nearness[i] = nearness(depth[i]);
    if (fullDepth[i] < 0 || fullDepth[i] === depth[i]) {
      grid.under.cells[i] = -1;
    } else {
      grid.under.nearness[i] = nearness(fullDepth[i]);
    }
  }
  return grid;
}

/**
 * The layer at `y` seen from above (north up), with the layer below shown
 * where `y` has no block (`below`), or under a block that doesn't fill its
 * cell (`under`).
 */
export function planSlice(model: VoxelModel, y: number): OrthoGrid {
  const [sx, , sz] = model.size;
  const grid = emptyGrid(sx, sz);
  grid.below = new Uint8Array(sx * sz);
  const shapeOf = gridShapes(model, grid, TOP_RECT);
  const { under } = grid;
  for (const voxel of model.voxels) {
    const i = voxel.z * sx + voxel.x;
    if (voxel.y === y) {
      grid.cells[i] = voxel.color;
      grid.nearness[i] = 1;
      grid.shape[i] = shapeOf(voxel);
    } else if (voxel.y === y - 1) {
      under.cells[i] = voxel.color;
      under.nearness[i] = 1;
      under.shape[i] = shapeOf(voxel);
    }
  }
  for (let i = 0; i < sx * sz; i++) {
    if (grid.cells[i] === -1) {
      // Only the layer below: show it in place of the layer.
      grid.cells[i] = under.cells[i];
      grid.nearness[i] = under.nearness[i];
      grid.shape[i] = under.shape[i];
      grid.below[i] = under.cells[i] === -1 ? 0 : 1;
      under.cells[i] = -1;
    } else if (grid.shape[i] === -1) {
      under.cells[i] = -1;
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
