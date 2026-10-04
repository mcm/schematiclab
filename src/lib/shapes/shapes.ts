// Voxel geometry for the Shape Generator. Pure and worker-safe: a shape and
// its dimensions become a W×H×D occupancy grid, sampled at voxel centres.
// Width runs along X, height along Y and depth along Z.

export const SHAPE_KINDS = [
  "cuboid",
  "ellipsoid",
  "dome",
  "cylinder",
  "cone",
  "pyramid",
] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

export type ShapeAxis = "x" | "y" | "z";

export interface ShapeDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface ShapeOptions extends ShapeDimensions {
  shape: ShapeKind;
  /** Cylinder only: the axis its circular faces are perpendicular to. */
  axis?: ShapeAxis;
  /** Keep only a shell `thickness` blocks thick. */
  hollow?: boolean;
  thickness?: number;
}

/** Occupancy grid; index with `voxelIndex`. */
export interface VoxelGrid {
  size: [number, number, number];
  filled: Uint8Array;
  count: number;
}

export const MAX_DIMENSION = 256;

export function voxelIndex(
  size: readonly [number, number, number],
  x: number,
  y: number,
  z: number,
): number {
  return (y * size[2] + z) * size[0] + x;
}

// Offset of voxel `i`'s centre from the middle of an axis `n` long,
// normalised so the axis ends are at ±1.
function centred(i: number, n: number): number {
  return (i + 0.5 - n / 2) / (n / 2);
}

function inEllipse(u: number, v: number, scale: number): boolean {
  if (scale <= 0) return false;
  return (u / scale) ** 2 + (v / scale) ** 2 <= 1;
}

// Whether the voxel at (x, y, z) lies inside the solid shape.
function insideFn(
  options: ShapeOptions,
): (x: number, y: number, z: number) => boolean {
  const { width: w, height: h, depth: d } = options;
  switch (options.shape) {
    case "cuboid":
      return () => true;
    case "ellipsoid":
      return (x, y, z) =>
        centred(x, w) ** 2 + centred(y, h) ** 2 + centred(z, d) ** 2 <= 1;
    case "dome":
      // The lower half of the ellipsoid is cut off: y measures up from the
      // flat base.
      return (x, y, z) =>
        centred(x, w) ** 2 + ((y + 0.5) / h) ** 2 + centred(z, d) ** 2 <= 1;
    case "cylinder": {
      const axis = options.axis ?? "y";
      if (axis === "x")
        return (_x, y, z) => inEllipse(centred(y, h), centred(z, d), 1);
      if (axis === "z")
        return (x, y) => inEllipse(centred(x, w), centred(y, h), 1);
      return (x, _y, z) => inEllipse(centred(x, w), centred(z, d), 1);
    }
    case "cone":
      // The base fills the bottom layer; each layer up shrinks evenly.
      return (x, y, z) => inEllipse(centred(x, w), centred(z, d), (h - y) / h);
    case "pyramid":
      return (x, y, z) => {
        const scale = (h - y) / h;
        return (
          Math.abs(centred(x, w)) <= scale && Math.abs(centred(z, d)) <= scale
        );
      };
  }
}

// The middle one or two indices of an axis `n` long.
function middle(n: number): number[] {
  return n % 2 === 1 ? [(n - 1) / 2] : [n / 2 - 1, n / 2];
}

function solidGrid(options: ShapeOptions): Uint8Array {
  const size: [number, number, number] = [
    options.width,
    options.height,
    options.depth,
  ];
  const [w, h, d] = size;
  const filled = new Uint8Array(w * h * d);
  const inside = insideFn(options);
  for (let y = 0; y < h; y++) {
    let layerCount = 0;
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if (inside(x, y, z)) {
          filled[voxelIndex(size, x, y, z)] = 1;
          layerCount++;
        }
      }
    }
    // A tapering shape's top layers can be narrower than one block. Keep the
    // middle block(s) so the shape still reaches its full height.
    if (
      layerCount === 0 &&
      (options.shape === "cone" || options.shape === "pyramid")
    ) {
      for (const z of middle(d)) {
        for (const x of middle(w)) filled[voxelIndex(size, x, y, z)] = 1;
      }
    }
  }
  return filled;
}

// Solid voxels within `thickness` steps (6-connected) of the outside. The
// grid's boundary counts as outside, so every face of the shape is closed.
function shell(
  size: [number, number, number],
  solid: Uint8Array,
  thickness: number,
): Uint8Array {
  const [w, h, d] = size;
  let core = solid;
  for (let step = 0; step < thickness; step++) {
    const next = new Uint8Array(core.length);
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
          const i = voxelIndex(size, x, y, z);
          if (!core[i]) continue;
          const interior =
            x > 0 &&
            x < w - 1 &&
            y > 0 &&
            y < h - 1 &&
            z > 0 &&
            z < d - 1 &&
            core[i - 1] &&
            core[i + 1] &&
            core[i - w] &&
            core[i + w] &&
            core[i - w * d] &&
            core[i + w * d];
          if (interior) next[i] = 1;
        }
      }
    }
    core = next;
  }
  const result = new Uint8Array(solid.length);
  for (let i = 0; i < solid.length; i++) {
    if (solid[i] && !core[i]) result[i] = 1;
  }
  return result;
}

function checkDimension(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
    throw new Error(
      `${name} must be a whole number from 1 to ${MAX_DIMENSION}, got ${value}`,
    );
  }
}

/** The shape's occupancy grid. Throws on out-of-range dimensions. */
export function buildShapeGrid(options: ShapeOptions): VoxelGrid {
  checkDimension("Width", options.width);
  checkDimension("Height", options.height);
  checkDimension("Depth", options.depth);
  const size: [number, number, number] = [
    options.width,
    options.height,
    options.depth,
  ];
  let filled = solidGrid(options);
  if (options.hollow) {
    const thickness = options.thickness ?? 1;
    if (!Number.isInteger(thickness) || thickness < 1) {
      throw new Error(
        `Wall thickness must be a whole number of at least 1, got ${thickness}`,
      );
    }
    filled = shell(size, filled, thickness);
  }
  let count = 0;
  for (const v of filled) count += v;
  return { size, filled, count };
}
