// Per-quad operations for non-axis-aligned camo shapes: ports of
// FramedBlocks `Modifiers` (api/model/quad/Modifiers.java and
// ModifierConfigs.java) and Copycats+ `QuadTransform`s
// (foundation/copycat/model/assembly/quad/*.java).
//
// Ops work on an `OpQuad` in block units (0..1) whose vertices are in
// vanilla `FaceBakery` order for its direction, because the FramedBlocks
// cuts address vertices by index. Shape-pack values in model pixels are
// divided by 16 here. Pure: no DOM, no deepslate.

import type {
  Axis,
  Direction,
  HorizontalDirection,
  QuadOp,
  Vec3,
} from "./shape-pack";

export type Uv = [number, number];

export interface OpVertex {
  /** Block units. */
  pos: Vec3;
  uv: Uv;
}

export interface OpQuad {
  /** Face the quad was cut from; ops never change it, as in both mods. */
  dir: Direction;
  vertices: [OpVertex, OpVertex, OpVertex, OpVertex];
}

const EPSILON = 1e-5;
const PIXEL = 1 / 16;

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

const DIRECTION_AXIS: Record<Direction, Axis> = {
  down: "y",
  up: "y",
  north: "z",
  south: "z",
  west: "x",
  east: "x",
};

/** Minecraft `Direction.ordinal()`, used to index the mods' lookup tables. */
const ORDINAL: Record<Direction, number> = {
  down: 0,
  up: 1,
  north: 2,
  south: 3,
  west: 4,
  east: 5,
};

function isPositive(dir: Direction): boolean {
  return dir === "up" || dir === "south" || dir === "east";
}

function isY(dir: Direction): boolean {
  return dir === "up" || dir === "down";
}

const CLOCKWISE: Record<HorizontalDirection, HorizontalDirection> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};

const COUNTER_CLOCKWISE: Record<HorizontalDirection, HorizontalDirection> = {
  north: "west",
  west: "south",
  south: "east",
  east: "north",
};

/** `Direction.getClockWise()` (around Y); `null` for up/down, where Minecraft throws. */
function clockWise(dir: Direction): HorizontalDirection | null {
  return isY(dir) ? null : CLOCKWISE[dir as HorizontalDirection];
}

function counterClockWise(dir: Direction): HorizontalDirection | null {
  return isY(dir) ? null : COUNTER_CLOCKWISE[dir as HorizontalDirection];
}

function equal(a: number, b: number): boolean {
  return Math.abs(b - a) < EPSILON;
}

function lerp(delta: number, start: number, end: number): number {
  return start + delta * (end - start);
}

/**
 * Corners of a face in vanilla `FaceBakery` vertex order, as 0 (min) / 1
 * (max) per axis. The FramedBlocks cut tables below index into this order.
 */
const FACE_CORNERS: Record<Direction, [Vec3, Vec3, Vec3, Vec3]> = {
  down: [
    [0, 0, 1],
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
  ],
  up: [
    [0, 1, 0],
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
  ],
  north: [
    [1, 1, 0],
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
  ],
  south: [
    [0, 1, 1],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
  ],
  west: [
    [0, 1, 0],
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
  ],
  east: [
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 0],
  ],
};

/**
 * Reorders an axis-aligned rectangle's vertices into vanilla order for
 * `dir` (which also gives the outward winding). Vertices are matched to
 * the corners of their bounding box on the face plane.
 */
export function toVanillaOrder(dir: Direction, vertices: OpVertex[]): OpQuad {
  const min = [0, 1, 2].map((i) => Math.min(...vertices.map((v) => v.pos[i])));
  const max = [0, 1, 2].map((i) => Math.max(...vertices.map((v) => v.pos[i])));
  const remaining = [...vertices];
  const ordered = FACE_CORNERS[dir].map((corner) => {
    const target = corner.map((c, i) => (c === 0 ? min[i] : max[i]));
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((v, i) => {
      const d = v.pos.reduce(
        (sum, p, axis) => sum + (p - target[axis]) ** 2,
        0,
      );
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return remaining.splice(best, 1)[0];
  });
  return { dir, vertices: ordered as OpQuad["vertices"] };
}

// ---------------------------------------------------------------------------
// UV mapping

type Vec = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Affine map from a position (projected onto the quad's plane) to UV,
 * fitted to three non-collinear vertices, so it also works on triangles.
 * `null` if the quad has collapsed to a line or point.
 */
export function quadUvMapper(quad: OpQuad): ((p: Vec3) => Uv) | null {
  const vs = quad.vertices;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 4; k++) {
        const base = vs[i];
        const e1 = sub(vs[j].pos, base.pos);
        const e2 = sub(vs[k].pos, base.pos);
        const area = cross(e1, e2);
        if (dot(area, area) < EPSILON * EPSILON) continue;
        // Solve p - base = s·e1 + t·e2 in the plane (normal equations).
        const a = dot(e1, e1);
        const b = dot(e1, e2);
        const c = dot(e2, e2);
        const det = a * c - b * b;
        const [u0, w0] = base.uv;
        const [u1, w1] = vs[j].uv;
        const [u2, w2] = vs[k].uv;
        return (p) => {
          const d = sub(p, base.pos);
          const d1 = dot(d, e1);
          const d2 = dot(d, e2);
          const s = (c * d1 - b * d2) / det;
          const t = (a * d2 - b * d1) / det;
          return [
            u0 + s * (u1 - u0) + t * (u2 - u0),
            w0 + s * (w1 - w0) + t * (w2 - w0),
          ];
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// FramedBlocks cuts (Modifiers.cut and ModifierConfigs)

type VertPair = [number, number];

/** `ModifierConfigs.getCutEdgeVertPair`: the vertices a cut moves. */
const CUT_EDGE_VERTS: Record<
  Direction,
  Partial<Record<Direction, VertPair>>
> = {
  down: { north: [1, 2], south: [0, 3], west: [1, 0], east: [2, 3] },
  up: { north: [0, 3], south: [1, 2], west: [1, 0], east: [2, 3] },
  north: { down: [1, 2], up: [0, 3], west: [3, 2], east: [0, 1] },
  south: { down: [1, 2], up: [0, 3], west: [0, 1], east: [3, 2] },
  west: { down: [1, 2], up: [0, 3], north: [0, 1], south: [3, 2] },
  east: { down: [1, 2], up: [0, 3], north: [3, 2], south: [0, 1] },
};

/** `ModifierConfigs.getCheckEdgeVertPair`: the opposite edge's vertices. */
const CHECK_EDGE_VERTS: Record<
  Direction,
  Partial<Record<Direction, VertPair>>
> = {
  down: { north: [0, 3], south: [1, 2], west: [2, 3], east: [1, 0] },
  up: { north: [1, 2], south: [0, 3], west: [2, 3], east: [1, 0] },
  north: { down: [0, 3], up: [1, 2], west: [0, 1], east: [3, 2] },
  south: { down: [0, 3], up: [1, 2], west: [3, 2], east: [0, 1] },
  west: { down: [0, 3], up: [1, 2], north: [3, 2], south: [0, 1] },
  east: { down: [0, 3], up: [1, 2], north: [0, 1], south: [3, 2] },
};

function invertParallelEdge(quadDir: Direction, cutEdge: Direction): boolean {
  if (isY(quadDir)) {
    return (cutEdge === "north" || cutEdge === "south") && quadDir === "up";
  }
  if (isY(cutEdge)) return isPositive(clockWise(quadDir)!);
  return true;
}

function swapCornerLengths(quadDir: Direction, cutEdge: Direction): boolean {
  if (!isY(quadDir)) return false;
  switch (cutEdge) {
    case "north":
      return quadDir === "down";
    case "south":
      return quadDir === "up";
    case "east":
      return true;
    default:
      return false;
  }
}

/**
 * `Modifiers.cut(quad, cutEdge, lengthOne, lengthTwo)` (block units): moves
 * the edge towards `cutEdge` so its corners are `lengthOne`/`lengthTwo` from
 * the opposite block bound, interpolating along the edge. For up/down quads
 * `lengthOne` is the corner clockwise from the edge (seen from above); for
 * an up/down edge on a side quad it is the corner clockwise from the quad's
 * direction; otherwise it is the top corner. Returns `false` (quad left
 * unchanged) if the cut would remove the whole quad. Moved vertices get
 * their UV from their new position.
 */
function cut(
  quad: OpQuad,
  cutEdge: Direction,
  lengthOne: number,
  lengthTwo: number,
): boolean {
  const quadDir = quad.dir;
  const cutPair = CUT_EDGE_VERTS[quadDir][cutEdge];
  const checkPair = CHECK_EDGE_VERTS[quadDir][cutEdge];
  // Unsupported in FramedBlocks too (it throws): cut edge on the quad's axis.
  if (cutPair === undefined || checkPair === undefined) return false;

  const forward = AXIS_INDEX[DIRECTION_AXIS[cutEdge]];
  const parallel = 3 - forward - AXIS_INDEX[DIRECTION_AXIS[quadDir]];
  const positive = isPositive(cutEdge);
  const invert = invertParallelEdge(quadDir, cutEdge);
  if (swapCornerLengths(quadDir, cutEdge)) {
    [lengthOne, lengthTwo] = [lengthTwo, lengthOne];
  }
  const vs = quad.vertices;
  const target = (index: number) => {
    const p = vs[index].pos[parallel];
    return lerp(
      invert ? 1 - p : p,
      positive ? lengthOne : 1 - lengthOne,
      positive ? lengthTwo : 1 - lengthTwo,
    );
  };
  const targetOne = target(cutPair[0]);
  const targetTwo = target(cutPair[1]);

  const beyond = (value: number, t: number) =>
    !equal(value, t) && (positive ? value > t : value < t);
  if (
    beyond(vs[checkPair[0]].pos[forward], targetOne) ||
    beyond(vs[checkPair[1]].pos[forward], targetTwo)
  ) {
    return false;
  }

  const toUv = quadUvMapper(quad);
  const move = (index: number, t: number) => {
    const pos = vs[index].pos;
    const dest = positive
      ? Math.min(pos[forward], t)
      : Math.max(pos[forward], t);
    if (equal(pos[forward], dest)) return;
    const moved: Vec3 = [...pos];
    moved[forward] = dest;
    vs[index] = { pos: moved, uv: toUv ? toUv(moved) : vs[index].uv };
  };
  move(cutPair[0], targetOne);
  move(cutPair[1], targetTwo);
  return true;
}

function offsetQuad(quad: OpQuad, dir: Direction, amount: number): void {
  const axis = AXIS_INDEX[DIRECTION_AXIS[dir]];
  const value = isPositive(dir) ? amount : -amount;
  for (const v of quad.vertices) v.pos[axis] += value;
}

function cutTopBottom(
  quad: OpQuad,
  [minX, minZ]: [number, number],
  [maxX, maxZ]: [number, number],
): boolean {
  if (!isY(quad.dir)) return false;
  return (
    cut(quad, "west", 1 - minX, 1 - minX) &&
    cut(quad, "east", maxX, maxX) &&
    cut(quad, "north", 1 - minZ, 1 - minZ) &&
    cut(quad, "south", maxZ, maxZ)
  );
}

function cutSideRect(
  quad: OpQuad,
  [minXZ, minY]: [number, number],
  [maxXZ, maxY]: [number, number],
): boolean {
  const cw = clockWise(quad.dir);
  const ccw = counterClockWise(quad.dir);
  if (cw === null || ccw === null) return false;
  const rightPositive = isPositive(cw);
  const leftXZ = rightPositive ? 1 - minXZ : maxXZ;
  const rightXZ = rightPositive ? maxXZ : 1 - minXZ;
  return (
    cut(quad, cw, rightXZ, rightXZ) &&
    cut(quad, ccw, leftXZ, leftXZ) &&
    cut(quad, "down", 1 - minY, 1 - minY) &&
    cut(quad, "up", maxY, maxY)
  );
}

function cutSideEdge(
  quad: OpQuad,
  cutDir: Direction,
  lengthCW: number,
  lengthCCW: number,
): boolean {
  const cw = clockWise(quad.dir);
  if (cw === null || DIRECTION_AXIS[cutDir] === DIRECTION_AXIS[quad.dir]) {
    return false;
  }
  if (isY(cutDir)) {
    const down = cutDir === "down";
    return cut(
      quad,
      cutDir,
      down ? lengthCW : lengthCCW,
      down ? lengthCCW : lengthCW,
    );
  }
  const right = cutDir === cw;
  return cut(
    quad,
    cutDir,
    right ? lengthCW : lengthCCW,
    right ? lengthCCW : lengthCW,
  );
}

function cutCopycat(
  quad: OpQuad,
  cutDir: Direction,
  offNeg: number,
  offPos: number,
): boolean {
  const ceil = offNeg > offPos !== isPositive(cutDir);
  const halfLen = ((1 - offNeg - offPos) / 2) * 16;
  const cutLen = (ceil ? Math.ceil(halfLen) : Math.floor(halfLen)) / 16;
  const offset = isPositive(cutDir) ? offNeg : offPos;
  if (!cut(quad, cutDir, cutLen, cutLen)) return false;
  offsetQuad(quad, cutDir, offset);
  return true;
}

// ---------------------------------------------------------------------------
// FramedBlocks rotations and slopes

const PRISM_TILT_ANGLE = (Math.atan(0.5) * 180) / Math.PI;
/** `Modifiers.PRISM_DIR_TO_ORIGIN_VECS`, indexed by horizontal ordinal (+4 for top). */
const PRISM_ORIGINS: Vec3[] = [
  [1, 0, 0],
  [0, 0, 1],
  [0, 0, 0],
  [1, 0, 1],
  [1, 1, 0],
  [0, 1, 1],
  [0, 1, 0],
  [1, 1, 1],
];
const HORIZONTAL_ORIGINS: Vec3[] = [
  [0, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
  [1, 0, 0],
];
const VERTICAL_ORIGINS: Vec3[] = [
  [0, 1, 0],
  [0, 1, 1],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 0],
  [0, 0, 1],
  [0, 0, 0],
  [1, 0, 0],
];
const CENTER: Vec3 = [0.5, 0.5, 0.5];
const TOP_CENTER: Vec3 = [0.5, 1, 0.5];
const BOTTOM_CENTER: Vec3 = [0.5, 0, 0.5];

/** Right-handed rotation of `v` about `axis` by `degrees`. */
function rotateVector([x, y, z]: Vec3, axis: Axis, degrees: number): Vec3 {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  switch (axis) {
    case "x":
      return [x, y * cos - z * sin, y * sin + z * cos];
    case "y":
      return [x * cos + z * sin, y, -x * sin + z * cos];
    case "z":
      return [x * cos - y * sin, x * sin + y * cos, z];
  }
}

/**
 * `Modifiers.rotate`: optionally stretches the quad perpendicular to `axis`
 * by `1 / cos(angle) - 1` (times `|scaleMult|`), so a face rotated to a
 * diagonal still spans the block, then rotates it about `origin`.
 */
function rotateQuad(
  quad: OpQuad,
  axis: Axis,
  origin: Vec3,
  angle: number,
  rescale: boolean,
  scaleMult: Vec3 = [1, 1, 1],
): void {
  let scale: Vec3 = [1, 1, 1];
  if (rescale) {
    const abs = Math.abs(angle);
    const scaleAngle = abs > 45 ? 90 - abs : abs;
    const factor = 1 / Math.cos((scaleAngle * Math.PI) / 180) - 1;
    scale = [0, 1, 2].map((i) =>
      i === AXIS_INDEX[axis] ? 1 : 1 + factor * Math.abs(scaleMult[i]),
    ) as Vec3;
  }
  for (const v of quad.vertices) {
    const relative = sub(v.pos, origin).map((c, i) => c * scale[i]) as Vec3;
    const rotated = rotateVector(relative, axis, angle);
    v.pos = [
      rotated[0] + origin[0],
      rotated[1] + origin[1],
      rotated[2] + origin[2],
    ];
  }
}

function cutPrismTriangleSide(
  quad: OpQuad,
  up: boolean,
  back: boolean,
): boolean {
  const cw = clockWise(quad.dir);
  const ccw = counterClockWise(quad.dir);
  if (cw === null || ccw === null) return false;
  const leftCut = cut(quad, ccw, up ? 0.5 : 1, up ? 1 : 0.5);
  const rightCut = cut(quad, cw, up ? 0.5 : 1, up ? 1 : 0.5);
  if (!leftCut && !rightCut) return false;

  const northeast = quad.dir === "north" || quad.dir === "east";
  const origin = PRISM_ORIGINS[ORDINAL[quad.dir] - 2 + (up ? 0 : 4)];
  let angle = back ? PRISM_TILT_ANGLE : -PRISM_TILT_ANGLE;
  if (northeast !== up) angle *= -1;
  rotateQuad(quad, DIRECTION_AXIS[cw], origin, angle, true);
  rotateQuad(quad, "y", origin, 45, true);
  return true;
}

function cutPrismTriangleTopBottom(
  quad: OpQuad,
  cutDir: HorizontalDirection,
  back: boolean,
): boolean {
  if (!isY(quad.dir)) return false;
  const leftCut = cut(quad, COUNTER_CLOCKWISE[cutDir], 0.5, 1);
  const rightCut = cut(quad, CLOCKWISE[cutDir], 1, 0.5);
  if (!leftCut && !rightCut) return false;

  const up = quad.dir === "up";
  const southwest = cutDir === "south" || cutDir === "west";
  let origin: Vec3;
  if (back) {
    origin = PRISM_ORIGINS[ORDINAL[cutDir] - 2 + (!up ? 0 : 4)];
  } else {
    offsetQuad(quad, cutDir, 0.5);
    origin = up ? TOP_CENTER : BOTTOM_CENTER;
  }
  let angle = up ? PRISM_TILT_ANGLE : -PRISM_TILT_ANGLE;
  angle = (up ? 90 : -90) - angle;
  if (southwest === back) angle *= -1;
  rotateQuad(quad, DIRECTION_AXIS[CLOCKWISE[cutDir]], origin, angle, true);
  rotateQuad(quad, "y", CENTER, 45, true);
  return true;
}

function cutSmallTriangle(quad: OpQuad, cutDir: Direction): boolean {
  const quadDir = quad.dir;
  if (DIRECTION_AXIS[quadDir] === DIRECTION_AXIS[cutDir]) return false;
  if (!cut(quad, cutDir, 0.5, 0.5)) return false;

  let left: boolean;
  let right: boolean;
  if (isY(cutDir)) {
    const up = cutDir === "up";
    left = cut(quad, counterClockWise(quadDir)!, up ? 0 : 1, up ? 1 : 0);
    right = cut(quad, clockWise(quadDir)!, up ? 0 : 1, up ? 1 : 0);
  } else if (isY(quadDir)) {
    left = cut(quad, counterClockWise(cutDir)!, 0, 1);
    right = cut(quad, clockWise(cutDir)!, 1, 0);
  } else {
    const cutRight = cutDir === clockWise(quadDir);
    left = cut(quad, "up", cutRight ? 0 : 1, cutRight ? 1 : 0);
    right = cut(quad, "down", cutRight ? 0 : 1, cutRight ? 1 : 0);
  }
  return left || right;
}

function makeHorizontalSlope(
  quad: OpQuad,
  rightEdge: boolean,
  angle: number,
): boolean {
  if (isY(quad.dir)) return false;
  let dir = quad.dir as HorizontalDirection;
  if (!rightEdge) dir = CLOCKWISE[dir];
  rotateQuad(
    quad,
    "y",
    HORIZONTAL_ORIGINS[ORDINAL[dir] - 2],
    rightEdge ? -angle : angle,
    true,
    [1, 0, 1],
  );
  return true;
}

function makeVerticalSlopeSide(
  quad: OpQuad,
  topEdge: boolean,
  angle: number,
): boolean {
  const cw = clockWise(quad.dir);
  if (cw === null) return false;
  const origin = VERTICAL_ORIGINS[ORDINAL[quad.dir] - 2 + (topEdge ? 4 : 0)];
  const rotAngle = isPositive(cw) !== topEdge ? -angle : angle;
  const scaleMult: Vec3 =
    DIRECTION_AXIS[quad.dir] === "x" ? [1, 1, 0] : [0, 1, 1];
  rotateQuad(quad, DIRECTION_AXIS[cw], origin, rotAngle, true, scaleMult);
  return true;
}

function makeVerticalSlopeTopBottom(
  quad: OpQuad,
  edge: HorizontalDirection,
  angle: number,
): boolean {
  if (!isY(quad.dir)) return false;
  const top = quad.dir === "up";
  const cw = CLOCKWISE[edge];
  const opposite = CLOCKWISE[cw];
  const origin = VERTICAL_ORIGINS[ORDINAL[opposite] - 2 + (top ? 0 : 4)];
  const rotAngle = isPositive(cw) !== top ? angle : -angle;
  const scaleMult: Vec3 = DIRECTION_AXIS[edge] === "x" ? [1, 1, 0] : [0, 1, 1];
  rotateQuad(quad, DIRECTION_AXIS[cw], origin, rotAngle, true, scaleMult);
  return true;
}

function scaleFace(quad: OpQuad, factor: number, origin: Vec3): void {
  const normalAxis = AXIS_INDEX[DIRECTION_AXIS[quad.dir]];
  for (const v of quad.vertices) {
    v.pos = v.pos.map((c, i) =>
      i === normalAxis ? origin[i] : (c - origin[i]) * factor + origin[i],
    ) as Vec3;
  }
}

function setPosition(quad: OpQuad, target: number): void {
  const axis = AXIS_INDEX[DIRECTION_AXIS[quad.dir]];
  const value = isPositive(quad.dir) ? target : 1 - target;
  for (const v of quad.vertices) v.pos[axis] = value;
}

/** `Modifiers.setPosition(float[4])`: per-corner targets, bilinearly interpolated. */
function setPositions(
  quad: OpQuad,
  targets: [number, number, number, number],
): void {
  const dir = quad.dir;
  const axis = AXIS_INDEX[DIRECTION_AXIS[dir]];
  const positive = isPositive(dir);
  const y = isY(dir);
  const ccwDir: Direction = y ? dir : counterClockWise(dir)!;
  const ccwPositive = isPositive(ccwDir);
  const lerpX = y ? 0 : AXIS_INDEX[DIRECTION_AXIS[ccwDir]];
  const lerpZ = y ? 2 : 1;
  const invX = !y && !ccwPositive;
  const invZ = !y || !ccwPositive;
  for (const v of quad.vertices) {
    const x0 = invX ? 1 - v.pos[lerpX] : v.pos[lerpX];
    const z0 = invZ ? 1 - v.pos[lerpZ] : v.pos[lerpZ];
    const target = lerp(
      z0,
      lerp(x0, targets[0], targets[3]),
      lerp(x0, targets[1], targets[2]),
    );
    v.pos[axis] = positive ? target : 1 - target;
  }
}

// ---------------------------------------------------------------------------
// Copycats+ transforms

/** Smallest height factor `QuadSlope` allows, so UVs keep their precision. */
const SLOPE_EPSILON = 0.02 / 16;

/** `QuadSlope` with a linear `QuadSlope.map` function (pixels). */
function slope(
  quad: OpQuad,
  face: Direction,
  input: "a" | "b",
  [fromStart, fromEnd]: [number, number],
  [toStart, toEnd]: [number, number],
): void {
  const axis = AXIS_INDEX[DIRECTION_AXIS[face]];
  const [a, b] = [0, 1, 2].filter((i) => i !== axis);
  for (const v of quad.vertices) {
    const value = v.pos[input === "a" ? a : b] * 16;
    let output =
      (toStart +
        ((value - fromStart) / (fromEnd - fromStart)) * (toEnd - toStart)) /
      16;
    if (Math.abs(output) < SLOPE_EPSILON) output = SLOPE_EPSILON;
    v.pos[axis] = isPositive(face)
      ? v.pos[axis] * output
      : 1 - output * (1 - v.pos[axis]);
  }
}

/**
 * `QuadUVUpdate`: runs `ops`, then shifts each moved vertex's UV by its
 * displacement within the quad's original plane, so the texture stays put
 * instead of stretching with the vertices.
 */
function updateUV(quad: OpQuad, ops: readonly QuadOp[]): boolean {
  const before = quad.vertices.map((v) => [...v.pos] as Vec3);
  const toUv = quadUvMapper(quad);
  if (!applyQuadOps(quad, ops)) return false;
  if (toUv === null) return true;
  quad.vertices.forEach((v, i) => {
    const from = toUv(before[i]);
    const to = toUv(v.pos);
    v.uv = [v.uv[0] + to[0] - from[0], v.uv[1] + to[1] - from[1]];
  });
  return true;
}

// ---------------------------------------------------------------------------

const px = (n: number) => n * PIXEL;
const pxPair = ([a, b]: [number, number]): [number, number] => [px(a), px(b)];
const pxVec = ([x, y, z]: Vec3): Vec3 => [px(x), px(y), px(z)];

function applyQuadOp(quad: OpQuad, op: QuadOp): boolean {
  switch (op.op) {
    case "cut":
      return cut(quad, op.edge, px(op.lengths[0]), px(op.lengths[1]));
    case "cutTopBottom":
      return cutTopBottom(quad, pxPair(op.from), pxPair(op.to));
    case "cutSide":
      return "edge" in op
        ? cutSideEdge(quad, op.edge, px(op.lengthCW), px(op.lengthCCW))
        : cutSideRect(quad, pxPair(op.from), pxPair(op.to));
    case "cutCopycat":
      return cutCopycat(quad, op.edge, px(op.offsets[0]), px(op.offsets[1]));
    case "cutPrismTriangle":
      return "edge" in op
        ? cutPrismTriangleTopBottom(quad, op.edge, op.back)
        : cutPrismTriangleSide(quad, op.up, op.back);
    case "cutSmallTriangle":
      return cutSmallTriangle(quad, op.edge);
    case "makeHorizontalSlope":
      return makeHorizontalSlope(quad, op.rightEdge, op.angle);
    case "makeVerticalSlope":
      return "edge" in op
        ? makeVerticalSlopeTopBottom(quad, op.edge, op.angle)
        : makeVerticalSlopeSide(quad, op.topEdge, op.angle);
    case "rotate":
      rotateQuad(
        quad,
        op.axis,
        pxVec(op.origin),
        op.angle,
        op.rescale,
        op.scaleMult,
      );
      return true;
    case "scaleFace":
      scaleFace(quad, op.factor, pxVec(op.origin));
      return true;
    case "setPosition":
      if ("positions" in op) {
        setPositions(quad, op.positions.map(px) as typeof op.positions);
      } else {
        setPosition(quad, px(op.position));
      }
      return true;
    case "offset":
      offsetQuad(quad, op.direction, px(op.amount));
      return true;
    case "translate": {
      const by = pxVec(op.by);
      for (const v of quad.vertices) {
        v.pos = [v.pos[0] + by[0], v.pos[1] + by[1], v.pos[2] + by[2]];
      }
      return true;
    }
    case "scale": {
      const pivot = pxVec(op.pivot);
      for (const v of quad.vertices) {
        v.pos = v.pos.map(
          (c, i) => (c - pivot[i]) * op.factors[i] + pivot[i],
        ) as Vec3;
      }
      return true;
    }
    case "slope":
      slope(quad, op.face, op.input, op.from, op.to);
      return true;
    case "updateUV":
      return updateUV(quad, op.ops);
  }
}

/**
 * Applies `ops` to `quad` in place, in order. Returns `false` as soon as
 * one fails; the quad must then be dropped.
 */
export function applyQuadOps(quad: OpQuad, ops: readonly QuadOp[]): boolean {
  return ops.every((op) => applyQuadOp(quad, op));
}
