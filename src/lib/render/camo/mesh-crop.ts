// Pure (DOM-free) camo mesh engine: cuts shape-pack pieces out of a camo
// block's full-cube mesh, the way FramedBlocks and Create/Copycats+ build
// their models from the camo's quads.
//
// For each piece, the select box, offset and cull faces are transformed into
// the block's frame first, then the camo's boundary face quads are clamped
// to the transformed box (UVs re-interpolated by position) and moved by the
// transformed offset. The geometry equals cropping in the canonical frame
// and then rotating/flipping the piece about the block centre, but camo
// textures stay world-aligned (a log camo's rings stay on its top face), as
// in both mods.
//
// Meshes are in block units (0..1), as returned by deepslate's
// `BlockDefinition.getMesh`; shape packs are in model pixels (0..16).

import { Mesh, Quad, Vector, Vertex, type Cull } from "deepslate";

import type {
  Box,
  Direction,
  ShapePiece,
  TransformOp,
  Vec3,
} from "./shape-pack";

const EPSILON = 1e-5;
const PIXEL = 1 / 16;

const DIRECTION_NORMALS: Record<Direction, Vec3> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

/** Linear part of each op, acting on a vector relative to the centre. */
function applyOp(op: TransformOp, [x, y, z]: Vec3): Vec3 {
  switch (op) {
    case "rotateX90":
      return [x, z, -y];
    case "rotateX180":
      return [x, -y, -z];
    case "rotateX270":
      return [x, -z, y];
    case "rotateY90":
      return [-z, y, x];
    case "rotateY180":
      return [-x, y, -z];
    case "rotateY270":
      return [z, y, -x];
    case "rotateZ90":
      return [y, -x, z];
    case "rotateZ180":
      return [-x, -y, z];
    case "rotateZ270":
      return [-y, x, z];
    case "flipX":
      return [-x, y, z];
    case "flipY":
      return [x, -y, z];
    case "flipZ":
      return [x, y, -z];
  }
}

/** Applies `ops` in order to a direction-like vector (no centre). */
export function transformVector(v: Vec3, ops: readonly TransformOp[]): Vec3 {
  return ops.reduce<Vec3>((acc, op) => applyOp(op, acc), v);
}

/** Applies `ops` in order to a point (model pixels) about (8, 8, 8). */
export function transformPoint(p: Vec3, ops: readonly TransformOp[]): Vec3 {
  const [x, y, z] = transformVector([p[0] - 8, p[1] - 8, p[2] - 8], ops);
  return [x + 8, y + 8, z + 8];
}

export function transformBox(box: Box, ops: readonly TransformOp[]): Box {
  const a = transformPoint(box.from, ops);
  const b = transformPoint(box.to, ops);
  return {
    from: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    to: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

export function transformDirection(
  dir: Direction,
  ops: readonly TransformOp[],
): Direction {
  const [x, y, z] = transformVector(DIRECTION_NORMALS[dir], ops);
  const found = (Object.keys(DIRECTION_NORMALS) as Direction[]).find((d) => {
    const n = DIRECTION_NORMALS[d];
    return n[0] === x && n[1] === y && n[2] === z;
  });
  // Unreachable: 90° rotations and flips map axis directions to themselves.
  if (found === undefined) throw new Error(`Bad transform of ${dir}`);
  return found;
}

/**
 * Direction a quad faces if it lies on that face of the unit cube, else
 * `null`. Only these boundary quads are used as camo faces (interior quads,
 * such as a pane's centre, can't be cropped meaningfully).
 */
export function boundaryFaceDirection(quad: Quad): Direction | null {
  const [p1, p2, p3] = [quad.v1.pos, quad.v2.pos, quad.v3.pos];
  let normal = p2.sub(p1).cross(p3.sub(p1));
  if (normal.lengthSquared() < EPSILON * EPSILON) {
    normal = p3.sub(p1).cross(quad.v4.pos.sub(p1));
  }
  const length = normal.length();
  if (length < EPSILON) return null;
  const n = normal.scale(1 / length);
  for (const dir of Object.keys(DIRECTION_NORMALS) as Direction[]) {
    const [nx, ny, nz] = DIRECTION_NORMALS[dir];
    if (Math.abs(n.x - nx) + Math.abs(n.y - ny) + Math.abs(n.z - nz) > 1e-3) {
      continue;
    }
    const axis = nx !== 0 ? "x" : ny !== 0 ? "y" : "z";
    const plane = nx + ny + nz > 0 ? 1 : 0;
    const onPlane = quad
      .vertices()
      .every((v) => Math.abs(v.pos[axis] - plane) < EPSILON);
    return onPlane ? dir : null;
  }
  return null;
}

/**
 * Affine map from position to UV for a planar quad, fitted to v1, v2 and v4
 * (v3 when v4 duplicates it). `null` for degenerate quads.
 */
function uvMapper(quad: Quad): ((p: Vector) => [number, number]) | null {
  const { v1, v2 } = quad;
  const v4 =
    quad.v4.pos.distanceSquared(quad.v3.pos) < EPSILON * EPSILON
      ? quad.v3
      : quad.v4;
  if (!v1.texture || !v2.texture || !v4.texture) return null;
  const e1 = v2.pos.sub(v1.pos);
  const e2 = v4.pos.sub(v1.pos);
  // Solve p - v1 = s·e1 + t·e2 in the quad's plane (normal equations).
  const a = e1.dot(e1);
  const b = e1.dot(e2);
  const c = e2.dot(e2);
  const det = a * c - b * b;
  if (Math.abs(det) < EPSILON * EPSILON) return null;
  const [u1, w1] = v1.texture;
  const [u2, w2] = v2.texture;
  const [u4, w4] = v4.texture;
  return (p) => {
    const d = p.sub(v1.pos);
    const d1 = d.dot(e1);
    const d2 = d.dot(e2);
    const s = (c * d1 - b * d2) / det;
    const t = (a * d2 - b * d1) / det;
    return [
      u1 + s * (u2 - u1) + t * (u4 - u1),
      w1 + s * (w2 - w1) + t * (w4 - w1),
    ];
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Crops one quad to `box` (block units) and moves it by `offset`, or
 * returns `null` if nothing of it is left.
 */
function cropQuad(quad: Quad, box: Box, offset: Vector): Quad | null {
  const toUv = uvMapper(quad);
  if (toUv === null) return null;
  const vertices = quad.vertices().map((v) => {
    const pos = new Vector(
      clamp(v.pos.x, box.from[0], box.to[0]),
      clamp(v.pos.y, box.from[1], box.to[1]),
      clamp(v.pos.z, box.from[2], box.to[2]),
    );
    let texture = toUv(pos);
    const limit = v.textureLimit;
    if (limit !== undefined) {
      texture = [
        clamp(texture[0], limit[0], limit[2]),
        clamp(texture[1], limit[1], limit[3]),
      ];
    }
    return new Vertex(
      pos.add(offset),
      v.color,
      texture,
      limit,
      v.normal,
      v.blockPos,
    );
  });
  const cropped = new Quad(vertices[0], vertices[1], vertices[2], vertices[3]);
  const [p1, p2, p3, p4] = vertices.map((v) => v.pos);
  const area =
    p2.sub(p1).cross(p3.sub(p1)).length() +
    p3.sub(p1).cross(p4.sub(p1)).length();
  return area < EPSILON * EPSILON ? null : cropped;
}

/**
 * The quads of `piece` cut from `source` (a camo's full-cube mesh, block
 * units). Faces listed in `piece.cull` are dropped when `cull` (deepslate's
 * neighbour culling, block frame) is set for their transformed direction.
 * `source` is not modified.
 */
export function cropPiece(source: Mesh, piece: ShapePiece, cull: Cull): Quad[] {
  const pixels = transformBox(piece.select, piece.transform);
  const box: Box = {
    from: [
      pixels.from[0] * PIXEL,
      pixels.from[1] * PIXEL,
      pixels.from[2] * PIXEL,
    ],
    to: [pixels.to[0] * PIXEL, pixels.to[1] * PIXEL, pixels.to[2] * PIXEL],
  };
  const [ox, oy, oz] = transformVector(piece.offset, piece.transform);
  const offset = new Vector(ox * PIXEL, oy * PIXEL, oz * PIXEL);
  const culled = new Set(
    piece.cull
      .map((dir) => transformDirection(dir, piece.transform))
      .filter((dir) => cull[dir as keyof Cull] === true),
  );

  const quads: Quad[] = [];
  for (const quad of source.quads) {
    const dir = boundaryFaceDirection(quad);
    if (dir === null || culled.has(dir)) continue;
    const cropped = cropQuad(quad, box, offset);
    if (cropped !== null) quads.push(cropped);
  }
  return quads;
}

/**
 * Builds a camo block's mesh from its matched pieces. `slotMesh` returns
 * the full-cube mesh for a camo slot (the camo block, or the empty-frame
 * look); pieces whose slot has no mesh are skipped.
 */
export function buildCamoMesh(
  pieces: readonly ShapePiece[],
  slotMesh: (slot: string) => Mesh | null,
  cull: Cull,
): Mesh {
  const meshes = new Map<string, Mesh | null>();
  const quads: Quad[] = [];
  for (const piece of pieces) {
    let source = meshes.get(piece.slot);
    if (source === undefined) {
      source = slotMesh(piece.slot);
      meshes.set(piece.slot, source);
    }
    if (source !== null) quads.push(...cropPiece(source, piece, cull));
  }
  return new Mesh(quads);
}
