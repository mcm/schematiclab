import { describe, expect, it } from "vitest";

import {
  applyQuadOps,
  quadUvMapper,
  toVanillaOrder,
  type OpQuad,
  type OpVertex,
} from "../quad-ops";
import type { Direction, QuadOp, Vec3 } from "../shape-pack";

/**
 * A full block face with UVs in block space: u follows the face's first
 * in-plane axis and v its second, so tests can read UVs as positions.
 */
function face(dir: Direction): OpQuad {
  const axis = { down: 1, up: 1, north: 2, south: 2, west: 0, east: 0 }[dir];
  const plane = ["up", "south", "east"].includes(dir) ? 1 : 0;
  const [a, b] = [0, 1, 2].filter((i) => i !== axis);
  const vertices: OpVertex[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([s, t]) => {
    const pos: Vec3 = [0, 0, 0];
    pos[axis] = plane;
    pos[a] = s;
    pos[b] = t;
    return { pos, uv: [s, t] };
  });
  return toVanillaOrder(dir, vertices);
}

function run(dir: Direction, ops: QuadOp[]): OpQuad | null {
  const quad = face(dir);
  return applyQuadOps(quad, ops) ? quad : null;
}

function positions(quad: OpQuad): Vec3[] {
  return quad.vertices.map(
    (v) => v.pos.map((n) => Math.round(n * 1e6) / 1e6 + 0) as Vec3,
  );
}

function distinct(quad: OpQuad): Vec3[] {
  const seen = new Map<string, Vec3>();
  for (const p of positions(quad)) seen.set(p.join(","), p);
  return [...seen.values()];
}

function sorted(points: Vec3[]): Vec3[] {
  return [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
}

describe("toVanillaOrder", () => {
  it("orders vertices like vanilla FaceBakery", () => {
    expect(positions(face("up"))).toEqual([
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ]);
    expect(positions(face("north"))).toEqual([
      [1, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
    ]);
  });
});

describe("FramedBlocks cuts", () => {
  it("cuts an up face to a box with cutTopBottom and re-derives UVs", () => {
    const quad = run("up", [
      { op: "cutTopBottom", from: [4, 0], to: [12, 8] },
    ])!;
    expect(sorted(positions(quad))).toEqual([
      [0.25, 1, 0],
      [0.25, 1, 0.5],
      [0.75, 1, 0],
      [0.75, 1, 0.5],
    ]);
    // Block-space UVs: u follows x, v follows z.
    for (const v of quad.vertices) expect(v.uv).toEqual([v.pos[0], v.pos[2]]);
  });

  it("cuts a side face diagonally like a slope's side triangle", () => {
    // FramedSlopeGeometry, facing south: side quads get cut(NORTH, 0, 1),
    // which pulls the top corner of the north edge to the south edge.
    const quad = run("east", [{ op: "cut", edge: "north", lengths: [0, 16] }])!;
    expect(sorted(distinct(quad))).toEqual([
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 1],
    ]);
  });

  it("gives lengthOne to the corner clockwise from the edge on up faces", () => {
    // Cutting the north edge: clockwise from north is east.
    const quad = run("up", [{ op: "cut", edge: "north", lengths: [16, 0] }])!;
    expect(sorted(distinct(quad))).toEqual([
      [0, 1, 1],
      [1, 1, 0],
      [1, 1, 1],
    ]);
  });

  it("fails when the cut would remove the whole quad", () => {
    // A top quad cut to 4px from the south, then cut to 4px from the north.
    expect(
      run("up", [
        { op: "cut", edge: "north", lengths: [4, 4] },
        { op: "cut", edge: "south", lengths: [4, 4] },
      ]),
    ).toBeNull();
  });

  it("cuts a centred small triangle pointing up", () => {
    const quad = run("north", [{ op: "cutSmallTriangle", edge: "up" }])!;
    expect(sorted(distinct(quad))).toEqual([
      [0, 0, 0],
      [0.5, 0.5, 0],
      [1, 0, 0],
    ]);
  });

  it("cuts with cutSide rectangles and edge lengths", () => {
    const rect = run("south", [{ op: "cutSide", from: [0, 8], to: [8, 16] }])!;
    expect(sorted(positions(rect))).toEqual([
      [0, 0.5, 1],
      [0, 1, 1],
      [0.5, 0.5, 1],
      [0.5, 1, 1],
    ]);
    // lengthCW is the right corner seen from outside (east on a south face).
    const edge = run("south", [
      { op: "cutSide", edge: "up", lengthCW: 16, lengthCCW: 0 },
    ])!;
    expect(sorted(distinct(edge))).toEqual([
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
  });
});

describe("FramedBlocks slopes and rotations", () => {
  it("tilts a north face into a 45° slope with makeVerticalSlope", () => {
    const quad = run("north", [
      { op: "makeVerticalSlope", topEdge: true, angle: 45 },
    ])!;
    expect(sorted(positions(quad))).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 0],
      [1, 1, 1],
    ]);
    // UVs are untouched: the whole texture stretches over the slope.
    expect(quad.vertices.map((v) => v.uv)).toEqual(
      face("north").vertices.map((v) => v.uv),
    );
  });

  it("tilts an up face down towards an edge", () => {
    const quad = run("up", [
      { op: "makeVerticalSlope", edge: "south", angle: 45 },
    ])!;
    expect(sorted(positions(quad))).toEqual([
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 1],
      [1, 1, 0],
    ]);
  });

  it("swings a side face to the diagonal with makeHorizontalSlope", () => {
    const quad = run("north", [
      { op: "makeHorizontalSlope", rightEdge: false, angle: 45 },
    ])!;
    expect(sorted(distinct(quad))).toEqual([
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 0],
      [1, 1, 0],
    ]);
  });

  it("rotates by arbitrary angles about an origin", () => {
    const quad = run("down", [
      {
        op: "rotate",
        axis: "y",
        origin: [0, 0, 0],
        angle: 90,
        rescale: false,
        scaleMult: [1, 1, 1],
      },
    ])!;
    // Right-handed: +90° about Y takes +x to -z.
    expect(sorted(positions(quad))).toEqual([
      [0, 0, -1],
      [0, 0, 0],
      [1, 0, -1],
      [1, 0, 0],
    ]);
    const tilted = run("down", [
      {
        op: "rotate",
        axis: "x",
        origin: [0, 0, 0],
        angle: 30,
        rescale: false,
        scaleMult: [1, 1, 1],
      },
    ])!;
    // +30° about X turns +z towards -y.
    const far = tilted.vertices.find((v) => v.pos[0] === 0 && v.pos[2] > 0.5)!;
    expect(far.pos[1]).toBeCloseTo(-Math.sin(Math.PI / 6));
    expect(far.pos[2]).toBeCloseTo(Math.cos(Math.PI / 6));
  });

  it("moves quads with offset, setPosition and scaleFace", () => {
    expect(
      distinct(
        run("up", [{ op: "offset", direction: "down", amount: 4 }])!,
      ).map((p) => p[1]),
    ).toEqual([0.75, 0.75, 0.75, 0.75]);
    expect(
      distinct(run("west", [{ op: "setPosition", position: 4 }])!).map(
        (p) => p[0],
      ),
    ).toEqual([0.75, 0.75, 0.75, 0.75]);
    expect(
      sorted(
        positions(
          run("up", [{ op: "scaleFace", factor: 0.5, origin: [8, 16, 8] }])!,
        ),
      ),
    ).toEqual([
      [0.25, 1, 0.25],
      [0.25, 1, 0.75],
      [0.75, 1, 0.25],
      [0.75, 1, 0.75],
    ]);
  });

  it("sets per-corner positions with setPosition(float[4])", () => {
    const quad = run("up", [{ op: "setPosition", positions: [16, 16, 0, 0] }])!;
    // Up faces interpolate x then z; corners 0/1 are at x = 0.
    for (const v of quad.vertices) expect(v.pos[1]).toBeCloseTo(1 - v.pos[0]);
  });

  it("cuts and tilts prism triangles", () => {
    const side = run("north", [
      { op: "cutPrismTriangle", up: true, back: false },
    ])!;
    expect(distinct(side)).toHaveLength(3);
    const top = run("up", [
      { op: "cutPrismTriangle", edge: "north", back: true },
    ])!;
    expect(distinct(top)).toHaveLength(3);
    for (const quad of [side, top]) {
      for (const p of positions(quad)) {
        for (const n of p) {
          expect(n).toBeGreaterThanOrEqual(-1e-6);
          expect(n).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    }
  });
});

describe("Copycats+ transforms", () => {
  it("slopes vertices with a linear QuadSlope map", () => {
    const quad = run("east", [
      { op: "slope", face: "up", input: "b", from: [0, 16], to: [0, 16] },
    ])!;
    // Height scales with z: the top edge drops to (almost) 0 at the north.
    const top = quad.vertices.filter((v) => v.pos[2] === 0);
    expect(Math.max(...top.map((v) => v.pos[1]))).toBeCloseTo(0.02 / 16, 9);
    // Without updateUV the UVs stay put and the texture squashes.
    expect(quad.vertices.map((v) => v.uv)).toEqual(
      face("east").vertices.map((v) => v.uv),
    );
  });

  it("keeps the texture in place with updateUV", () => {
    const quad = run("east", [
      {
        op: "updateUV",
        ops: [
          { op: "slope", face: "up", input: "b", from: [0, 16], to: [0, 16] },
        ],
      },
    ])!;
    for (const v of quad.vertices) {
      expect(v.uv[0]).toBeCloseTo(v.pos[1], 6);
      expect(v.uv[1]).toBeCloseTo(v.pos[2], 6);
    }
  });

  it("translates and scales about a pivot", () => {
    const quad = run("up", [
      { op: "translate", by: [0, -8, 0] },
      { op: "scale", pivot: [16, 0, 16], factors: [0.5, 1, 1] },
    ])!;
    expect(sorted(positions(quad))).toEqual([
      [0.5, 0.5, 0],
      [0.5, 0.5, 1],
      [1, 0.5, 0],
      [1, 0.5, 1],
    ]);
  });
});

describe("quadUvMapper", () => {
  it("maps positions on triangles", () => {
    const quad = run("up", [{ op: "cut", edge: "north", lengths: [16, 0] }])!;
    const toUv = quadUvMapper(quad)!;
    expect(toUv([0.25, 1, 0.75])[0]).toBeCloseTo(0.25);
    expect(toUv([0.25, 1, 0.75])[1]).toBeCloseTo(0.75);
  });
});
