import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  BlockDefinition,
  BlockModel,
  Identifier,
  type Cull,
  type Mesh,
  type TextureAtlasProvider,
} from "deepslate";

import { buildCamoMesh } from "../mesh-crop";
import {
  matchShapeRule,
  validateShapePack,
  type RuleSlot,
  type ShapePack,
} from "../shape-pack";

// The Copycats+ slopes and kinetic copycats in the committed pack
// (`pnpm gen:camo-shapes`), meshed from a plain full-cube camo.

const PACK: ShapePack = validateShapePack(
  JSON.parse(
    readFileSync(
      path.join(__dirname, "../../../../../public/camo-shapes/copycats.json"),
      "utf-8",
    ),
  ),
);

const ATLAS: TextureAtlasProvider = {
  getTextureAtlas: () => ({ width: 4, height: 4 }) as unknown as ImageData,
  getTextureUV: () => [0, 0, 1, 1],
};
const ALL = { texture: "#all" };

function modelMesh(elements: unknown[]): Mesh {
  const model = BlockModel.fromJson({
    textures: { all: "test:block/all" },
    elements,
  });
  return BlockDefinition.fromJson({
    variants: { "": { model: "test:block/model" } },
  }).getMesh(
    Identifier.parse("test:model"),
    {},
    ATLAS,
    { getBlockModel: () => model },
    {},
  );
}

const FACES = {
  down: ALL,
  up: ALL,
  north: ALL,
  south: ALL,
  west: ALL,
  east: ALL,
};
const CUBE = modelMesh([{ from: [0, 0, 0], to: [16, 16, 16], faces: FACES }]);

const H = ["north", "south", "west", "east"];
const HALVES = ["bottom", "top"];
const AXES = ["x", "y", "z"] as const;

/** The mesh of a state, with a full-cube camo in `slots` (every slot if omitted). */
function camoMesh(
  id: string,
  props: Record<string, string>,
  options: { slots?: string[]; ruleSlots?: RuleSlot[]; cull?: Cull } = {},
): Mesh {
  const rule = matchShapeRule(
    PACK.blocks[`copycats:${id}`],
    props,
    options.ruleSlots,
  );
  expect(rule, `${id} ${JSON.stringify(props)}`).not.toBeNull();
  return buildCamoMesh(
    rule!.pieces,
    (slot) =>
      options.slots === undefined || options.slots.includes(slot) ? CUBE : null,
    options.cull ?? {},
  );
}

/** Enclosed volume in blocks (divergence theorem), seen from `origin`. */
function enclosedVolume(mesh: Mesh, origin: [number, number, number]): number {
  let volume = 0;
  for (const quad of mesh.quads) {
    const [a, b, c, d] = quad
      .vertices()
      .map(({ pos }) => [
        pos.x - origin[0],
        pos.y - origin[1],
        pos.z - origin[2],
      ]);
    for (const [p, q, r] of [
      [a, b, c],
      [a, c, d],
    ]) {
      volume +=
        (p[0] * (q[1] * r[2] - q[2] * r[1]) -
          p[1] * (q[0] * r[2] - q[2] * r[0]) +
          p[2] * (q[0] * r[1] - q[1] * r[0])) /
        6;
    }
  }
  return volume;
}

/** The volume, checking the surface is closed (same from two origins). */
function closedVolume(mesh: Mesh): number {
  const volume = enclosedVolume(mesh, [0, 0, 0]);
  expect(enclosedVolume(mesh, [0.3, 0.5, 0.7])).toBeCloseTo(volume, 6);
  return volume;
}

/** Bounds of a mesh in model pixels, per axis [min, max]. */
function bounds(mesh: Mesh): { x: number[]; y: number[]; z: number[] } {
  const result = {
    x: [Infinity, -Infinity],
    y: [Infinity, -Infinity],
    z: [Infinity, -Infinity],
  };
  for (const quad of mesh.quads) {
    for (const { pos } of quad.vertices()) {
      for (const axis of AXES) {
        result[axis][0] = Math.min(result[axis][0], pos[axis] * 16);
        result[axis][1] = Math.max(result[axis][1], pos[axis] * 16);
      }
    }
  }
  return result;
}

// `QuadSlope` never flattens a face below 0.02 px, and the enhanced model's
// margin strips overlap the slope a little, so volumes are a hair over.
const VOLUME_DIGITS = 3;

describe("copycat slopes", () => {
  it("is a closed half block in every state", () => {
    for (const facing of H) {
      for (const half of HALVES) {
        const mesh = camoMesh("copycat_slope", { facing, half });
        expect(closedVolume(mesh)).toBeCloseTo(1 / 2, VOLUME_DIGITS);
      }
      const vertical = camoMesh("copycat_vertical_slope", { facing });
      expect(closedVolume(vertical)).toBeCloseTo(1 / 2, VOLUME_DIGITS);
    }
  });

  it("rises towards its facing and flips for the top half", () => {
    // Bottom slope facing north: full height on the north edge only.
    const mesh = camoMesh("copycat_slope", { facing: "north", half: "bottom" });
    const topAt = (z: number) =>
      Math.max(
        ...mesh.quads.flatMap((quad) =>
          quad
            .vertices()
            .filter(({ pos }) => Math.abs(pos.z * 16 - z) < 0.01)
            .map(({ pos }) => pos.y * 16),
        ),
      );
    expect(topAt(0)).toBeCloseTo(16, 1);
    expect(topAt(16)).toBeCloseTo(0, 1);

    const top = camoMesh("copycat_slope", { facing: "north", half: "top" });
    const bottomAt = (z: number) =>
      Math.min(
        ...top.quads.flatMap((quad) =>
          quad
            .vertices()
            .filter(({ pos }) => Math.abs(pos.z * 16 - z) < 0.01)
            .map(({ pos }) => pos.y * 16),
        ),
      );
    expect(bottomAt(0)).toBeCloseTo(0, 1);
    expect(bottomAt(16)).toBeCloseTo(16, 1);
  });

  it("gives a vertical slope its full height and a diagonal footprint", () => {
    const mesh = camoMesh("copycat_vertical_slope", { facing: "north" });
    const box = bounds(mesh);
    for (const axis of AXES) {
      expect(box[axis][0]).toBeCloseTo(0, 1);
      expect(box[axis][1]).toBeCloseTo(16, 1);
    }
  });

  it("keeps the sloped faces when the neighbour above is solid", () => {
    const props = { facing: "north", half: "bottom" };
    const open = camoMesh("copycat_slope", props).quads.length;
    expect(
      camoMesh("copycat_slope", props, { cull: { up: true } }).quads,
    ).toHaveLength(open);
    const culled = camoMesh("copycat_slope", props, { cull: { down: true } });
    expect(culled.quads.length).toBeLessThan(open);
    expect(
      culled.quads.some((quad) =>
        quad.vertices().every(({ pos }) => Math.abs(pos.y) < 1e-6),
      ),
    ).toBe(false);
  });
});

describe("copycat slope layers", () => {
  it("fills layers / 8 of the block at every layer count, both halves", () => {
    for (let layers = 1; layers <= 8; layers++) {
      for (const facing of H) {
        for (const half of HALVES) {
          const props = { facing, half, layers: String(layers) };
          const mesh = camoMesh("copycat_slope_layer", props);
          expect(closedVolume(mesh), JSON.stringify(props)).toBeCloseTo(
            layers / 8,
            VOLUME_DIGITS,
          );
        }
      }
    }
  });

  it("builds every layer count from the enhanced model's margin pieces", () => {
    const rules = PACK.blocks["copycats:copycat_slope_layer"];
    for (let layers = 1; layers <= 8; layers++) {
      const rule = matchShapeRule(rules, {
        facing: "north",
        half: "bottom",
        layers: String(layers),
      });
      // The plain model is one piece; the enhanced one adds margin pieces.
      expect(rule!.pieces.length, `layers=${layers}`).toBeGreaterThanOrEqual(7);
      // Its four strips along the slope are rotated onto it (at 8 layers the
      // slope is flat and the rotation 0°).
      const rotated = rule!.pieces.filter((piece) =>
        piece.ops.some((op) => op.op === "rotate"),
      );
      expect(rotated, `layers=${layers}`).toHaveLength(layers === 8 ? 0 : 4);
    }
  });

  it("is 4 px high per layer up to 4 layers, then raises its low edge", () => {
    for (let layers = 1; layers <= 8; layers++) {
      const mesh = camoMesh("copycat_slope_layer", {
        facing: "north",
        half: "bottom",
        layers: String(layers),
      });
      const box = bounds(mesh);
      expect(box.y[1]).toBeCloseTo(Math.min(layers * 4, 16), 1);
      const lowEdge = Math.max(
        ...mesh.quads.flatMap((quad) =>
          quad
            .vertices()
            .filter(({ pos }) => Math.abs(pos.z - 1) < 1e-4)
            .map(({ pos }) => pos.y * 16),
        ),
      );
      expect(lowEdge).toBeCloseTo(Math.max(0, (layers - 4) * 4), 1);
    }
  });
});

describe("kinetic copycats (static)", () => {
  const along = (axis: string, a: number[], b: number[]) =>
    Object.fromEntries(AXES.map((n) => [n, n === axis ? a : b]));

  it("renders the shaft 4 px thick along its axis", () => {
    for (const axis of AXES) {
      const box = bounds(camoMesh("copycat_shaft", { axis }));
      expect(box).toEqual(along(axis, [0, 16], [6, 10]));
    }
  });

  it("renders both parts of the cogwheels on every axis", () => {
    for (const axis of AXES) {
      for (const [id, radius] of [
        ["copycat_cogwheel", 9],
        ["copycat_large_cogwheel", 15],
      ] as const) {
        const shaft = bounds(camoMesh(id, { axis }, { slots: ["shaft"] }));
        expect(shaft).toEqual(along(axis, [0, 16], [6, 10]));
        const cog = bounds(camoMesh(id, { axis }, { slots: ["cogwheel"] }));
        for (const n of AXES) {
          if (n === axis) {
            expect(cog[n][0]).toBeGreaterThan(5);
            expect(cog[n][1]).toBeLessThan(11);
          } else {
            expect(cog[n][0]).toBeCloseTo(8 - radius, 1);
            expect(cog[n][1]).toBeCloseTo(8 + radius, 1);
          }
        }
      }
    }
  });

  it("renders a cogwheel material as itself, without its shaft", () => {
    const slots: RuleSlot[] = [
      {
        slot: "cogwheel",
        kind: "block",
        state: { name: "create:cogwheel", properties: { axis: "y" } },
      },
    ];
    for (const axis of AXES) {
      const rule = matchShapeRule(
        PACK.blocks["copycats:copycat_cogwheel"],
        { axis },
        slots,
      );
      const cog = rule!.pieces.filter((piece) => piece.slot === "cogwheel");
      expect(cog).toEqual([
        expect.objectContaining({
          whole: true,
          copyProperties: true,
          keepInside: { axis, min: 0.16, max: 15.84 },
        }),
      ]);
    }

    // A stand-in cogwheel: a disc and a shaft through it, both along y.
    const cogwheel = modelMesh([
      { from: [2, 6, 2], to: [14, 10, 14], faces: FACES },
      { from: [6, 0, 6], to: [10, 16, 10], faces: FACES },
    ]);
    const rule = matchShapeRule(
      PACK.blocks["copycats:copycat_cogwheel"],
      { axis: "y" },
      slots,
    );
    const mesh = buildCamoMesh(
      rule!.pieces.filter((piece) => piece.slot === "cogwheel"),
      () => cogwheel,
      {},
    );
    expect(mesh.quads).toHaveLength(6);
    expect(bounds(mesh).y).toEqual([6, 10]);
  });
});
