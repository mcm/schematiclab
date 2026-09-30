import { describe, expect, it } from "vitest";
import {
  BlockDefinition,
  BlockModel,
  Identifier,
  type Mesh,
  type Quad,
  type TextureAtlasProvider,
  type UV,
  type Vertex,
} from "deepslate";

import {
  boundaryFaceDirection,
  buildCamoMesh,
  cropPiece,
  invertTransform,
  transformBox,
  transformDirection,
  transformPoint,
} from "../mesh-crop";
import {
  DIRECTIONS,
  type Direction,
  type ShapePiece,
  type Vec3,
} from "../shape-pack";

const SIDE_UV: UV = [0.25, 0.5, 0.5, 0.75];
const TOP_UV: UV = [0, 0, 0.25, 0.25];

const ATLAS: TextureAtlasProvider = {
  getTextureAtlas: () => ({ width: 4, height: 4 }) as unknown as ImageData,
  getTextureUV: (id) => (id.toString() === "test:block/top" ? TOP_UV : SIDE_UV),
};

const FACE = (texture: string, extra: object = {}) => ({
  texture,
  cullface: undefined,
  ...extra,
});

/** A full-cube camo mesh in block units, as `BlockDefinition.getMesh` gives. */
function cubeMesh(faces: Record<string, object> = {}): Mesh {
  const model = BlockModel.fromJson({
    textures: { side: "test:block/side", top: "test:block/top" },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: FACE("#top"),
          up: FACE("#top"),
          north: FACE("#side"),
          south: FACE("#side"),
          west: FACE("#side"),
          east: FACE("#side"),
          ...faces,
        },
      },
    ],
  });
  const definition = BlockDefinition.fromJson({
    variants: { "": { model: "test:block/cube" } },
  });
  return definition.getMesh(
    Identifier.parse("test:cube"),
    {},
    ATLAS,
    { getBlockModel: () => model },
    {},
  );
}

function piece(overrides: Partial<ShapePiece> = {}): ShapePiece {
  return {
    slot: "camo",
    select: { from: [0, 0, 0], to: [16, 16, 16] },
    offset: [0, 0, 0],
    transform: [],
    cull: [],
    faces: [...DIRECTIONS],
    ops: [],
    ...overrides,
  };
}

const BOTTOM_SLAB: ShapePiece["select"] = { from: [0, 0, 0], to: [16, 8, 16] };

function bounds(quads: Quad[]): { from: Vec3; to: Vec3 } {
  const positions = quads.flatMap((q) => q.vertices().map((v) => v.pos));
  return {
    from: [
      Math.min(...positions.map((p) => p.x)),
      Math.min(...positions.map((p) => p.y)),
      Math.min(...positions.map((p) => p.z)),
    ],
    to: [
      Math.max(...positions.map((p) => p.x)),
      Math.max(...positions.map((p) => p.y)),
      Math.max(...positions.map((p) => p.z)),
    ],
  };
}

function uvRange(quad: Quad): { u: [number, number]; v: [number, number] } {
  const us = quad.vertices().map((v) => v.texture![0]);
  const vs = quad.vertices().map((v) => v.texture![1]);
  return {
    u: [Math.min(...us), Math.max(...us)],
    v: [Math.min(...vs), Math.max(...vs)],
  };
}

/** Direction a quad faces, by its normal (cropped quads may be inside the block). */
function facing(quad: Quad): Direction {
  const n = quad.normal();
  const dirs: [Direction, number][] = [
    ["east", n.x],
    ["west", -n.x],
    ["up", n.y],
    ["down", -n.y],
    ["south", n.z],
    ["north", -n.z],
  ];
  return dirs.reduce((best, d) => (d[1] > best[1] ? d : best))[0];
}

function byDirection(quads: Quad[]): Map<Direction, Quad> {
  return new Map(quads.map((q) => [facing(q), q]));
}

function expectVec(actual: Vec3, expected: Vec3) {
  actual.forEach((n, i) => expect(n).toBeCloseTo(expected[i], 6));
}

describe("cropPiece", () => {
  it("cuts a bottom slab with 6 faces and halves the sides' V range", () => {
    const source = cubeMesh();
    const quads = cropPiece(source, piece({ select: BOTTOM_SLAB }), {});

    expect(quads).toHaveLength(6);
    const { from, to } = bounds(quads);
    expectVec(from, [0, 0, 0]);
    expectVec(to, [1, 0.5, 1]);

    const sourceFaces = byDirection(source.quads);
    const faces = byDirection(quads);
    for (const dir of ["north", "south", "west", "east"] as const) {
      const before = uvRange(sourceFaces.get(dir)!);
      const after = uvRange(faces.get(dir)!);
      expect(after.u[0]).toBeCloseTo(before.u[0], 6);
      expect(after.u[1]).toBeCloseTo(before.u[1], 6);
      expect(after.v[1] - after.v[0]).toBeCloseTo(
        (before.v[1] - before.v[0]) / 2,
        6,
      );
      // World-aligned: the slab shows the bottom half of the side texture.
      expect(after.v[1]).toBeCloseTo(before.v[1], 6);
    }
    // The top face moves down to the slab's top with its full texture.
    const up = faces.get("up")!;
    expect(up.vertices().every((v) => Math.abs(v.pos.y - 0.5) < 1e-6)).toBe(
      true,
    );
    expect(uvRange(up)).toEqual(uvRange(sourceFaces.get("up")!));
  });

  it("does not modify the source mesh", () => {
    const source = cubeMesh();
    const before = source.quads.map((q) => q.toString());
    cropPiece(source, piece({ select: BOTTOM_SLAB }), {});
    expect(source.quads.map((q) => q.toString())).toEqual(before);
  });

  it("keeps cropped UVs within the source quad's UV bounds", () => {
    const source = cubeMesh({
      north: FACE("#side", { uv: [2, 3, 14, 15], rotation: 90 }),
    });
    const quads = cropPiece(
      source,
      piece({ select: { from: [3, 5, 0], to: [11, 13, 7] } }),
      {},
    );
    const sourceFaces = byDirection(source.quads);
    for (const quad of quads) {
      const range = uvRange(sourceFaces.get(facing(quad))!);
      for (const v of quad.vertices()) {
        expect(v.texture![0]).toBeGreaterThanOrEqual(range.u[0] - 1e-9);
        expect(v.texture![0]).toBeLessThanOrEqual(range.u[1] + 1e-9);
        expect(v.texture![1]).toBeGreaterThanOrEqual(range.v[0] - 1e-9);
        expect(v.texture![1]).toBeLessThanOrEqual(range.v[1] + 1e-9);
      }
    }
  });

  it("re-interpolates UVs linearly on a rotated face", () => {
    const source = cubeMesh({ north: FACE("#side", { rotation: 90 }) });
    const north = cropPiece(
      source,
      piece({ select: { from: [0, 0, 0], to: [16, 4, 16] } }),
      {},
    ).find((q) => facing(q) === "north")!;
    // Rotated 90°, the bottom quarter of the face maps to a quarter-wide
    // strip of the sprite's U range.
    const range = uvRange(north);
    expect(range.u[1] - range.u[0]).toBeCloseTo((SIDE_UV[2] - SIDE_UV[0]) / 4);
    expect(range.v[1] - range.v[0]).toBeCloseTo(SIDE_UV[3] - SIDE_UV[1]);
  });

  it("moves the piece by its offset", () => {
    const quads = cropPiece(
      cubeMesh(),
      piece({
        select: { from: [0, 8, 0], to: [16, 16, 16] },
        offset: [0, -8, 0],
      }),
      {},
    );
    const { from, to } = bounds(quads);
    expectVec(from, [0, 0, 0]);
    expectVec(to, [1, 0.5, 1]);
  });

  it("lands a rotated piece at the expected coordinates", () => {
    // A 4px corner cube at the top north-west, turned 90° about Y: it ends
    // up at the top north-east corner.
    const quads = cropPiece(
      cubeMesh(),
      piece({
        select: { from: [0, 0, 0], to: [4, 4, 4] },
        offset: [0, 12, 0],
        transform: ["rotateY90"],
      }),
      {},
    );
    expect(quads).toHaveLength(6);
    const { from, to } = bounds(quads);
    expectVec(from, [0.75, 0.75, 0]);
    expectVec(to, [1, 1, 0.25]);
  });

  it("turns a bottom slab to face south with rotateX90 and flips it up with flipY", () => {
    const rotated = bounds(
      cropPiece(
        cubeMesh(),
        piece({ select: BOTTOM_SLAB, transform: ["rotateX90"] }),
        {},
      ),
    );
    expectVec(rotated.from, [0, 0, 0.5]);
    expectVec(rotated.to, [1, 1, 1]);

    const flipped = bounds(
      cropPiece(
        cubeMesh(),
        piece({ select: BOTTOM_SLAB, transform: ["flipY"] }),
        {},
      ),
    );
    expectVec(flipped.from, [0, 0.5, 0]);
    expectVec(flipped.to, [1, 1, 1]);
  });

  it("drops faces listed in cull when deepslate culls that side", () => {
    const slab = piece({ select: BOTTOM_SLAB, cull: ["down"] });
    const dirs = (cull: object) =>
      cropPiece(cubeMesh(), slab, cull).map(facing);

    expect(dirs({})).toContain("down");
    expect(dirs({ down: true })).not.toContain("down");
    expect(dirs({ down: true })).toHaveLength(5);
    // Sides not listed in the piece's cull are kept.
    expect(dirs({ north: true })).toHaveLength(6);
  });

  it("transforms cull directions with the piece", () => {
    const panel = piece({
      select: { from: [0, 0, 0], to: [16, 16, 4] },
      cull: ["north"],
      transform: ["rotateY90"],
    });
    const dirs = (cull: object) =>
      cropPiece(cubeMesh(), panel, cull).map(facing);

    expect(dirs({ north: true })).toHaveLength(6);
    expect(dirs({ east: true })).not.toContain("east");
  });

  it("ignores quads that aren't on the cube's boundary", () => {
    const model = BlockModel.fromJson({
      textures: { side: "test:block/side" },
      elements: [
        {
          from: [0, 0, 8],
          to: [16, 16, 8],
          faces: { north: FACE("#side"), south: FACE("#side") },
        },
      ],
    });
    const pane = model.getMesh(ATLAS, {});
    expect(pane.quads.map(boundaryFaceDirection)).toEqual([null, null]);
    expect(new Set(cubeMesh().quads.map(boundaryFaceDirection))).toEqual(
      new Set(["down", "up", "north", "south", "west", "east"]),
    );
    expect(cropPiece(pane, piece(), {})).toHaveLength(0);
  });
});

describe("cropPiece with quad ops", () => {
  // FramedSlopeGeometry, bottom slope facing south: the north face tilts
  // into the slope and the side faces are cut to triangles.
  const SLOPE_FACE = piece({
    faces: ["north"],
    ops: [{ op: "makeVerticalSlope", topEdge: true, angle: 45 }],
  });
  const SLOPE_SIDES = piece({
    faces: ["east", "west"],
    cull: ["east", "west"],
    ops: [{ op: "cut", edge: "north", lengths: [0, 16] }],
  });

  function positions(quad: Quad): Vec3[] {
    return quad
      .vertices()
      .map((v) => [v.pos.x, v.pos.y, v.pos.z].map((n) => +n.toFixed(6) + 0))
      .sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]) as Vec3[];
  }

  function normal(quad: Quad): Vec3 {
    const n = quad.normal();
    return [n.x, n.y, n.z];
  }

  it("builds a 45° slope face with the expected vertices and normal", () => {
    const quads = cropPiece(cubeMesh(), SLOPE_FACE, {});
    expect(quads).toHaveLength(1);
    const [slope] = quads;
    expect(positions(slope)).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 0],
      [1, 1, 1],
    ]);
    expectVec(normal(slope), [0, Math.SQRT1_2, -Math.SQRT1_2]);
    slope
      .vertices()
      .forEach((v) =>
        expectVec([v.normal!.x, v.normal!.y, v.normal!.z], normal(slope)),
      );
    // FramedBlocks keeps the face's UVs: the whole texture covers the slope.
    const source = byDirection(cubeMesh().quads).get("north")!;
    expect(uvRange(slope)).toEqual(uvRange(source));
  });

  it("emits side triangles as degenerate quads with UVs inside the sprite", () => {
    const quads = cropPiece(cubeMesh(), SLOPE_SIDES, {});
    expect(quads.map(facing).sort()).toEqual(["east", "west"]);
    for (const quad of quads) {
      const same = (a: Vertex, b: Vertex) =>
        a.pos.distanceSquared(b.pos) < 1e-12;
      expect(same(quad.v3, quad.v4)).toBe(true);
      expect(
        same(quad.v1, quad.v2) ||
          same(quad.v2, quad.v3) ||
          same(quad.v1, quad.v3),
      ).toBe(false);
      for (const v of quad.vertices()) {
        expect(v.texture![0]).toBeGreaterThanOrEqual(SIDE_UV[0] - 1e-9);
        expect(v.texture![0]).toBeLessThanOrEqual(SIDE_UV[2] + 1e-9);
        expect(v.texture![1]).toBeGreaterThanOrEqual(SIDE_UV[1] - 1e-9);
        expect(v.texture![1]).toBeLessThanOrEqual(SIDE_UV[3] + 1e-9);
      }
    }
    const east = quads.find((q) => facing(q) === "east")!;
    expect(new Set(positions(east).map((p) => p.join(",")))).toEqual(
      new Set(["1,0,0", "1,0,1", "1,1,1"]),
    );
    // Block-space UVs: the top-south corner keeps the sprite's top-left
    // corner (east faces run u from south to north).
    const top = east.vertices().find((v) => v.pos.y > 0.5)!;
    expectVec([...top.texture!, 0] as Vec3, [SIDE_UV[0], SIDE_UV[1], 0]);
  });

  it("drops faces not listed in faces", () => {
    const quads = cropPiece(cubeMesh(), piece({ faces: ["up", "down"] }), {});
    expect(quads.map(facing).sort()).toEqual(["down", "up"]);
  });

  it("runs ops in the canonical frame and transforms the result", () => {
    const [slope] = cropPiece(
      cubeMesh(),
      { ...SLOPE_FACE, transform: ["rotateY90"] },
      {},
    );
    // The south-facing slope turned to face west rises towards the west.
    expectVec(normal(slope), [Math.SQRT1_2, Math.SQRT1_2, 0]);
    expect(positions(slope)).toEqual([
      [0, 1, 0],
      [0, 1, 1],
      [1, 0, 0],
      [1, 0, 1],
    ]);

    const sides = cropPiece(
      cubeMesh(),
      { ...SLOPE_SIDES, transform: ["rotateY90"] },
      {},
    );
    expect(sides.map(facing).sort()).toEqual(["north", "south"]);
  });

  it("keeps faces outward when the transform mirrors", () => {
    const [slope] = cropPiece(
      cubeMesh(),
      { ...SLOPE_FACE, transform: ["flipY"] },
      {},
    );
    expectVec(normal(slope), [0, -Math.SQRT1_2, -Math.SQRT1_2]);
    for (const quad of cropPiece(
      cubeMesh(),
      { ...SLOPE_SIDES, transform: ["flipY"] },
      {},
    )) {
      const n = normal(quad);
      expect(Math.abs(n[0])).toBeCloseTo(1);
      // Outward: east faces point +x, west faces -x.
      expect(Math.sign(n[0])).toBe(quad.v1.pos.x > 0.5 ? 1 : -1);
    }
  });

  it("drops quads that a cut removes entirely", () => {
    const quads = cropPiece(
      cubeMesh(),
      piece({
        faces: ["up"],
        ops: [
          { op: "cut", edge: "north", lengths: [4, 4] },
          { op: "cut", edge: "south", lengths: [4, 4] },
        ],
      }),
      {},
    );
    expect(quads).toHaveLength(0);
  });

  it("slopes a Copycats+ piece and keeps side textures in place with updateUV", () => {
    // CopycatSlopeModelCore.assembleTriangularSlope (not enhanced), facing
    // north: skip the north face, map the height linearly along z.
    const quads = cropPiece(
      cubeMesh(),
      piece({
        faces: ["down", "up", "south", "west", "east"],
        ops: [
          {
            op: "updateUV",
            ops: [
              {
                op: "slope",
                face: "up",
                input: "b",
                from: [0, 16],
                to: [0, 16],
              },
            ],
          },
        ],
      }),
      {},
    );
    expect(quads).toHaveLength(5);
    // QuadSlope keeps a 0.02px minimum height, so the slope is nearly 45°.
    const up = quads.find((q) => q.normal().y > 0.1)!;
    normal(up).forEach((n, i) =>
      expect(n).toBeCloseTo([0, Math.SQRT1_2, -Math.SQRT1_2][i], 3),
    );

    const east = quads.find((q) => q.normal().x > 0.9)!;
    const sprite = uvRange(byDirection(cubeMesh().quads).get("east")!);
    for (const v of east.vertices()) {
      // v runs top to bottom over the sprite: it follows the vertex height.
      const expectedV = sprite.v[1] - v.pos.y * (sprite.v[1] - sprite.v[0]);
      expect(v.texture![1]).toBeCloseTo(expectedV, 6);
    }
  });
});

describe("transform helpers", () => {
  it("inverts transforms", () => {
    const ops = ["rotateY90", "flipX", "rotateZ270"] as const;
    const point: Vec3 = [1, 2, 3];
    expect(
      transformPoint(transformPoint(point, ops), invertTransform(ops)),
    ).toEqual(point);
  });

  it("rotates like blockstate variants", () => {
    expect(transformDirection("north", ["rotateY90"])).toBe("east");
    expect(transformDirection("up", ["rotateX90"])).toBe("north");
    expect(transformDirection("up", ["rotateZ90"])).toBe("east");
    expect(transformDirection("east", ["flipX"])).toBe("west");
    expect(transformDirection("north", ["rotateY90", "rotateY270"])).toBe(
      "north",
    );
  });

  it("applies ops in order about the block centre", () => {
    const box = { from: [0, 0, 0] as Vec3, to: [16, 8, 4] as Vec3 };
    expect(transformBox(box, ["rotateY90", "flipY"])).toEqual({
      from: [12, 8, 0],
      to: [16, 16, 16],
    });
  });
});

describe("buildCamoMesh", () => {
  it("takes each piece's quads from its slot's mesh", () => {
    const camo = cubeMesh();
    const mesh = buildCamoMesh(
      [
        piece({ slot: "camo", select: BOTTOM_SLAB }),
        piece({
          slot: "camo_two",
          select: { from: [0, 8, 0], to: [16, 16, 16] },
        }),
        piece({ slot: "missing", select: BOTTOM_SLAB }),
      ],
      (slot) => (slot === "missing" ? null : camo),
      {},
    );
    expect(mesh.quads).toHaveLength(12);
  });
});
