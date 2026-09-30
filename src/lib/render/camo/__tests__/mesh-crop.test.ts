import { describe, expect, it } from "vitest";
import {
  BlockDefinition,
  BlockModel,
  Identifier,
  type Mesh,
  type Quad,
  type TextureAtlasProvider,
  type UV,
} from "deepslate";

import {
  boundaryFaceDirection,
  buildCamoMesh,
  cropPiece,
  transformBox,
  transformDirection,
} from "../mesh-crop";
import type { Direction, ShapePiece, Vec3 } from "../shape-pack";

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

describe("transform helpers", () => {
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
