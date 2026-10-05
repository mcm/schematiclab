// The roof engine (Cairn `SPEC.md` "Roofs", `cairn/roofs.py`) for single
// roofs. Ports Cairn's `test_roof_types_and_overhang_sides`,
// `test_chimney_beats_roof_regardless_of_order` and
// `test_pitch1_gable_needs_no_hidden_fill`, and checks every roof type and
// option against the blocks Cairn itself produced (`fixtures/cairn/single-roofs.json`).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type MaterialSpec,
  type Operations,
  validateProgram,
} from "../program";
import { compile, describeBlocks, messages, run } from "./compile-harness";

interface GoldenCase {
  program: {
    size: [number, number, number];
    palette?: Record<string, MaterialSpec>;
    build: Operations;
  };
  /** `"x,y,z id[state=value,…]"`, Cairn's ids without `minecraft:`. */
  blocks: string[];
}

const GOLDEN = JSON.parse(
  readFileSync(
    path.join(__dirname, "fixtures/cairn/single-roofs.json"),
    "utf8",
  ),
) as { cases: Record<string, GoldenCase> };

/** A 9×h×7 roof scope at [2, 0, 2] in a 13×8×11 build (Cairn's test house). */
const roofed = (roof: unknown, size: [number, number, number] = [9, 8, 7]) =>
  run(
    [{ box: { at: [2, 0, 2], size, do: [{ roof }] } }] as Operations,
    [13, 8, 11],
  );

describe("roof: Cairn's own output", () => {
  it.each(Object.entries(GOLDEN.cases))(
    "%s compiles to the same blocks and states",
    (_name, golden) => {
      const { size, palette, build } = golden.program;
      const b = run(build, size, palette);
      expect(b.log.outOfBounds).toBe(0);
      expect(describeBlocks(b)).toEqual(golden.blocks);
    },
  );
});

describe("roof types and options", () => {
  it("builds every type inside the build (test_roof_types_and_overhang_sides)", () => {
    for (const type of [
      "gable",
      "hip",
      "pyramid",
      "shed",
      "gambrel",
      "cone",
      "dome",
      "flat",
    ]) {
      const b = roofed({ type, material: "oak" });
      expect(b.cells.length, type).toBeGreaterThan(0);
      expect(b.log.outOfBounds, type).toBe(0);
    }
    const b = roofed({
      type: "gable",
      material: "oak",
      overhang: { all: 1, left: 0 },
    });
    const xs = b.cells.map(([x]) => x);
    expect(Math.min(...xs)).toBe(2);
    expect(Math.max(...xs)).toBe(11);
  });

  it("takes a bare type, @roof by default and string or per-side overhangs", () => {
    const b = run(
      [{ box: { at: [2, 0, 2], size: [9, 8, 7], do: [{ roof: "hip" }] } }],
      [13, 8, 11],
      { roof: "spruce" },
    );
    expect(new Set(b.cells.map(([, , , id]) => id))).toEqual(
      new Set(["spruce_stairs", "spruce_slab"]),
    );
    const flush = roofed({ type: "hip", material: "oak", overhang: 0 });
    const xs = flush.cells.map(([x]) => x);
    const zs = flush.cells.map(([, , z]) => z);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([2, 10]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([2, 8]);
    const sides = roofed({
      type: "hip",
      material: "oak",
      overhang: { all: 0, back: 2, right: 1 },
    });
    expect(Math.min(...sides.cells.map(([, , z]) => z))).toBe(0);
    expect(Math.max(...sides.cells.map(([, , z]) => z))).toBe(8);
    expect(Math.max(...sides.cells.map(([x]) => x))).toBe(11);
  });

  it("puts the eave at the scope's y = 0 and clips at the scope height", () => {
    const b = run(
      [
        {
          box: {
            at: [2, 3, 2],
            size: [9, 3, 7],
            do: [{ roof: { type: "gable", material: "oak", overhang: 0 } }],
          },
        },
      ],
      [13, 10, 11],
    );
    const ys = b.cells.map(([, y]) => y);
    expect(Math.min(...ys)).toBe(3);
    // the scope's top row is y = 5: a pitch-1 gable over 7 would reach 6
    expect(Math.max(...ys)).toBe(5);
    expect(b.at(5, 5, 5)).toBe("oak_slab");
    // `height` clips lower still
    const low = roofed({ type: "pyramid", material: "oak", height: 1 });
    expect(Math.max(...low.cells.map(([, y]) => y))).toBe(1);
  });

  it("chooses stairs on a pitch-1 slope, facing the ridge so the steps face down-slope", () => {
    const b = roofed({ type: "gable", material: "oak", overhang: 0 });
    // ridge along x (the longer side) at z = 5; eaves at z = 2 and z = 8
    expect(b.at(6, 0, 2)).toBe("oak_stairs");
    expect(b.states(6, 0, 2)).toMatchObject({
      facing: "south",
      half: "bottom",
    });
    expect(b.at(6, 2, 4)).toBe("oak_stairs");
    expect(b.states(6, 2, 4).facing).toBe("south");
    expect(b.states(6, 0, 8).facing).toBe("north");
    expect(b.at(6, 3, 5)).toBe("oak_slab");
    const ridgeZ = roofed({
      type: "gable",
      material: "oak",
      overhang: 0,
      ridge: "z",
    });
    expect(ridgeZ.states(2, 0, 5).facing).toBe("east");
    expect(ridgeZ.states(10, 0, 5).facing).toBe("west");
  });

  it("chooses slabs on a gentle slope and full blocks on a flat roof", () => {
    const gentle = roofed({ type: "shed", material: "oak", pitch: 0.5 });
    const ids = new Set(gentle.cells.map(([, , , id]) => id));
    expect(ids.has("oak_slab")).toBe(true);
    expect(ids.has("oak_stairs")).toBe(false);
    const halves = new Set(
      gentle.cells
        .filter(([, , , id]) => id === "oak_slab")
        .map(([x, y, z]) => gentle.states(x, y, z).type),
    );
    expect(halves).toEqual(new Set(["bottom", "top"]));
    const flat = roofed({ type: "flat", material: "oak" });
    expect(new Set(flat.cells.map(([, , , id]) => id))).toEqual(
      new Set(["oak_planks"]),
    );
    expect(new Set(flat.cells.map(([, y]) => y))).toEqual(new Set([0]));
  });

  it("fills the attic of a solid roof", () => {
    const hollow = roofed({ type: "hip", material: "oak" });
    const solid = roofed({ type: "hip", material: "oak", solid: true });
    expect(hollow.at(6, 1, 5)).toBe("air");
    expect(solid.at(6, 1, 5)).toBe("oak_planks");
    expect(solid.at(6, 0, 5)).toBe("oak_planks");
  });

  it("needs no hidden fill under a pitch-1 gable (test_pitch1_gable_needs_no_hidden_fill)", () => {
    const b = run(
      [
        {
          box: {
            at: [2, 0, 2],
            size: [9, 12, 7],
            do: [
              {
                split: {
                  axis: "y",
                  parts: [
                    {
                      size: 4,
                      do: [
                        {
                          faces: {
                            sides: [{ fill: "stone_bricks" }],
                            bottom: [{ fill: "stone" }],
                          },
                        },
                      ],
                    },
                    {
                      size: "~",
                      do: [
                        {
                          roof: {
                            type: "gable",
                            material: "spruce",
                            overhang: 1,
                            gable: false,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      [13, 12, 11],
    );
    expect(b.cells.filter(([, , , id]) => id === "spruce_planks")).toEqual([]);
    expect(
      b.cells.some(([, y, , id]) => id === "spruce_stairs" && y === 4),
    ).toBe(true);
  });
});

describe("roof layers", () => {
  const chimney = {
    box: { at: [3, 0, 3], size: [1, 10, 1], do: [{ fill: "bricks" }] },
  };
  const roof = (extra: Record<string, unknown> = {}) => ({
    box: {
      at: [0, 2, 0],
      size: ["100%", "~", "100%"],
      do: [{ roof: { type: "gable", material: "oak", overhang: 0, ...extra } }],
    },
  });

  it("lets a chimney win whatever the order (test_chimney_beats_roof_regardless_of_order)", () => {
    for (const ops of [
      [chimney, roof()],
      [roof(), chimney],
    ]) {
      const b = run(ops as Operations, [9, 10, 9]);
      for (let y = 0; y < 10; y++) expect(b.at(3, y, 3)).toBe("bricks");
    }
    // an explicit priority can still put the roof on top
    const b = run([chimney, roof({ priority: 5 })] as Operations, [9, 10, 9]);
    expect(
      Array.from({ length: 10 }, (_, y) => b.at(3, y, 3)).some((id) =>
        id.startsWith("oak"),
      ),
    ).toBe(true);
  });

  it("sits one layer below its context and keeps its context's carve", () => {
    const b = run(
      [
        {
          box: {
            priority: 3,
            do: [
              { roof: { type: "flat", material: "oak" } },
              {
                box: {
                  priority: 2,
                  size: [1, 1, 1],
                  do: [{ fill: "stone" }],
                },
              },
            ],
          },
        },
      ],
      [3, 2, 3],
    );
    expect(b.at(0, 0, 0)).toBe("stone");
    const [write] = b.log.writesAt([1, 0, 1]);
    expect(write).toMatchObject({
      priority: 2,
      carve: false,
      path: "build[0].box.do[0].roof",
    });
  });
});

describe("roof errors", () => {
  it("validates its arguments", () => {
    const result = validateProgram({
      size: [5, 5, 5],
      build: [
        { roof: "spire" },
        {
          roof: {
            type: "mansard",
            pitch: -1,
            overhang: { all: 1, top: 2, left: 0.5 },
            ridge: "y",
            height: "tall",
            solid: "yes",
            break: 2,
            shape: "round",
          },
        },
        { roof: { overhang: -1, material: "" } },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([
      'build[0].roof: must be one of "gable", "hip", "pyramid", "shed", "gambrel", "cone", "dome", "flat", got "spire"',
      "build[1].roof.shape: unknown key 'shape' (expected 'type', 'material', 'pitch', 'overhang', 'ridge', 'gable', 'height', 'solid', 'break', 'parts', 'priority', 'carve')",
      'build[1].roof.type: must be one of "gable", "hip", "pyramid", "shed", "gambrel", "cone", "dome", "flat", got "mansard"',
      "build[1].roof.pitch: must be at least 0, got -1",
      'build[1].roof.height: must be a number, got "tall"',
      "build[1].roof.break: must be between 0 and 1, got 2",
      'build[1].roof.ridge: must be one of "x", "z", "auto", got "y"',
      'build[1].roof.solid: must be true or false, got "yes"',
      "build[1].roof.overhang.top: unknown key 'top' (expected 'all', 'left', 'right', 'back', 'front')",
      "build[1].roof.overhang.left: must be an integer, got 0.5",
      "build[2].roof.material: material must not be empty",
      "build[2].roof.overhang: must be at least 0, got -1",
    ]);
  });

  it("reports compile-time problems at the roof's path and builds the rest", () => {
    const b = compile(
      [
        { fill: "stone" },
        {
          use: { name: "cap", with: { kind: "spire" } },
        },
        { roof: { type: "hip", material: "diamond_blok" } },
      ],
      [3, 3, 3],
      {},
      { templates: { cap: [{ roof: { type: "$kind" } }] } },
    );
    expect(messages(b.errors)).toEqual([
      'templates.cap[0].roof.type: must be one of "gable", "hip", "pyramid", "shed", "gambrel", "cone", "dome", "flat", got "spire" (in a template used at build[1].use)',
      expect.stringMatching(
        /^build\[2\]\.roof\.material: unknown block\/material 'diamond_blok'/,
      ),
    ]);
    expect(b.cells).toHaveLength(27);
  });
});

describe("roof performance", () => {
  it("roofs a 256×256 footprint quickly", () => {
    const start = Date.now();
    const b = run(
      [{ roof: { type: "hip", material: "oak", overhang: 0 } }],
      [256, 40, 256],
    );
    expect(b.cells.length).toBeGreaterThanOrEqual(256 * 256);
    expect(Date.now() - start).toBeLessThan(20_000);
  }, 30_000);
});
