// The roof engine (`roofs.ts`), with the roof cases of Cairn's
// `tests/test_spec.py` ported.

import { describe, expect, it } from "vitest";
import { analyze, formatReport } from "../analyze";
import type { Operations } from "../program";
import { RoofEngine, type RoofHost } from "../roofs";
import { Scope } from "../scope";
import { messages, registry, run } from "./compile-harness";

const LAYER = { priority: -1, carve: false };

const ROOF_TYPES = [
  "gable",
  "hip",
  "pyramid",
  "shed",
  "gambrel",
  "cone",
  "dome",
  "flat",
];

/** A roof over a 9×7 footprint at [2, 0, 2] of a 13×8×11 build (Cairn). */
function roofed(roof: unknown, size: [number, number, number] = [13, 8, 11]) {
  return run(
    [{ box: { at: [2, 0, 2], size: [9, 8, 7], do: [{ roof }] } }] as Operations,
    size,
  );
}

/** Cairn's `_house`: 4-high walls (or corner posts) and a roof box above. */
function house(roof: unknown, walls = true) {
  return run(
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
                      walls
                        ? {
                            faces: {
                              sides: [{ fill: "stone_bricks" }],
                              bottom: [{ fill: "stone" }],
                            },
                          }
                        : {
                            faces: {
                              edges: [{ fill: "oak_log" }],
                              bottom: [{ fill: "stone" }],
                            },
                          },
                    ],
                  },
                  { size: "~", do: [{ roof }] },
                ],
              },
            },
          ],
        },
      },
    ] as Operations,
    [13, 12, 11],
  );
}

const sortedCells = (b: { cells: [number, number, number, string][] }) =>
  b.cells.map((c) => c.join()).sort();

describe("roof", () => {
  it("builds every type inside the build (Cairn)", () => {
    for (const type of ROOF_TYPES) {
      const b = roofed({ type, material: "oak" });
      expect(b.cells.length, type).toBeGreaterThan(0);
      expect(b.log.outOfBounds, type).toBe(0);
    }
  });

  it("takes a type on its own", () => {
    expect(
      sortedCells(
        run(
          [
            {
              box: { at: [2, 0, 2], size: [9, 8, 7], do: [{ roof: "hip" }] },
            },
          ],
          [13, 8, 11],
          { roof: "oak" },
        ),
      ),
    ).toEqual(sortedCells(roofed({ type: "hip", material: "oak" })));
  });

  it("overhangs per side (Cairn)", () => {
    const b = roofed({
      type: "gable",
      material: "oak",
      overhang: { all: 1, left: 0 },
    });
    const xs = b.cells.map(([x]) => x);
    expect(Math.min(...xs)).toBe(2);
    expect(Math.max(...xs)).toBe(11);
  });

  it("sits its eave on the scope's floor and climbs in stairs to the ridge", () => {
    const b = roofed({ type: "gable", material: "oak", overhang: 0 });
    // ridge along x (the longer side); the slopes rise from z = 2 and z = 8
    expect(b.at(5, 0, 2)).toBe("oak_stairs");
    expect(b.states(5, 0, 2)).toMatchObject({
      facing: "south",
      half: "bottom",
    });
    expect(b.at(5, 0, 8)).toBe("oak_stairs");
    expect(b.states(5, 0, 8)).toMatchObject({ facing: "north" });
    expect(b.at(5, 1, 3)).toBe("oak_stairs");
    expect(b.at(5, 2, 4)).toBe("oak_stairs");
    expect(b.at(5, 3, 5)).toBe("oak_slab");
    expect(b.states(5, 3, 5)).toMatchObject({ type: "bottom" });
    // the ridge runs along x
    expect(b.at(2, 3, 5)).toBe("oak_slab");
    expect(b.at(10, 3, 5)).toBe("oak_slab");
    expect(Math.max(...b.cells.map(([, y]) => y))).toBe(3);
  });

  it("turns a gentle pitch into slabs", () => {
    const b = roofed({ type: "gable", material: "oak", pitch: 0.5 });
    const ids = new Set(b.cells.map(([, , , id]) => id));
    expect(ids.has("oak_slab")).toBe(true);
    expect(ids.has("oak_stairs")).toBe(false);
  });

  it("follows the ridge it is given", () => {
    const b = roofed({
      type: "gable",
      material: "oak",
      ridge: "z",
      overhang: 0,
    });
    expect(b.states(2, 0, 5)).toMatchObject({ facing: "east" });
    expect(b.states(10, 0, 5)).toMatchObject({ facing: "west" });
  });

  it("is clipped at the scope's height and at `height`", () => {
    const low = run(
      [
        {
          box: {
            at: [2, 0, 2],
            size: [9, 2, 7],
            do: [{ roof: { type: "pyramid", material: "oak" } }],
          },
        },
      ],
      [13, 8, 11],
    );
    expect(Math.max(...low.cells.map(([, y]) => y))).toBe(1);
    const capped = roofed({ type: "hip", material: "oak", height: 2 });
    expect(Math.max(...capped.cells.map(([, y]) => y))).toBe(2);
  });

  it("lays a flat roof of blocks on the eave", () => {
    const b = roofed({ type: "flat", material: "oak", overhang: 0 });
    expect(b.cells).toHaveLength(63);
    expect(new Set(b.cells.map(([, y, , id]) => `${y} ${id}`))).toEqual(
      new Set(["0 oak_planks"]),
    );
  });

  it("raises a dome to its height", () => {
    const b = roofed({ type: "dome", material: "oak", height: 5 });
    expect(Math.max(...b.cells.map(([, y]) => y))).toBe(5);
  });

  it("fills the attic when solid", () => {
    const hollow = roofed({ type: "gable", material: "oak", overhang: 0 });
    const solid = roofed({
      type: "gable",
      material: "oak",
      overhang: 0,
      solid: true,
    });
    expect(hollow.at(6, 0, 5)).toBe("air");
    expect(solid.at(6, 0, 5)).toBe("oak_planks");
    expect(solid.at(6, 2, 5)).toBe("oak_planks");
  });

  it("bends a gambrel at its break", () => {
    const steep = roofed({ type: "gambrel", material: "oak", break: 0.9 });
    const shallow = roofed({ type: "gambrel", material: "oak", break: 0.1 });
    const top = (b: typeof steep) => Math.max(...b.cells.map(([, y]) => y));
    expect(top(steep)).toBeGreaterThan(top(shallow));
  });

  it("needs an upright scope", () => {
    const engine = new RoofEngine({} as RoofHost);
    const sideways = new Scope(
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      [0, -1, 0],
      [3, 3, 3],
    );
    expect(() =>
      engine.register("gable", sideways, "build[0].roof", LAYER, 1),
    ).toThrow("roofs need an upright scope");
  });

  it("falls back to full blocks for a material without stairs or slabs", () => {
    const b = run([{ roof: { type: "gable", material: "glass" } }], [5, 5, 5]);
    expect(messages(b.notes)).toContain(
      "build[0].roof: 'glass' has no stairs; used full block minecraft:glass",
    );
    expect(new Set(b.cells.map(([, , , id]) => id))).toEqual(
      new Set(["glass"]),
    );
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

  it("lets a chimney win whichever is written first (Cairn)", () => {
    for (const ops of [
      [chimney, roof()],
      [roof(), chimney],
    ]) {
      const b = run(ops as Operations, [9, 10, 9]);
      for (let y = 0; y < 10; y++) expect(b.at(3, y, 3)).toBe("bricks");
    }
  });

  it("can still be raised over it with an explicit priority (Cairn)", () => {
    const b = run([chimney, roof({ priority: 5 })] as Operations, [9, 10, 9]);
    const column = Array.from({ length: 10 }, (_, y) => b.at(3, y, 3));
    expect(column.some((id) => id.startsWith("oak"))).toBe(true);
  });
});

describe("roof merging", () => {
  it("merges separate roofs exactly like parts, even in a rotated scope (Cairn)", () => {
    const parts = run(
      [
        {
          box: {
            at: [0, 4, 0],
            size: ["100%", "~", "100%"],
            do: [
              {
                roof: {
                  material: "oak",
                  parts: [
                    { at: [1, 1], size: [13, 7], type: "hip" },
                    { at: [7, 7], size: [7, 9], type: "gable", ridge: "z" },
                  ],
                },
              },
            ],
          },
        },
      ],
      [15, 12, 17],
    );
    const separate = run(
      [
        {
          box: {
            at: [1, 4, 1],
            size: [13, 8, 7],
            do: [{ roof: { type: "hip", material: "oak" } }],
          },
        },
        {
          box: {
            at: [7, 4, 7],
            size: [9, 8, 7],
            rotate: 1,
            do: [{ roof: { type: "gable", ridge: "x", material: "oak" } }],
          },
        },
      ],
      [15, 12, 17],
    );
    const states = (b: typeof parts) =>
      b.cells
        .map(
          ([x, y, z, id]) =>
            `${x},${y},${z} ${id} ${JSON.stringify(b.states(x, y, z))}`,
        )
        .sort();
    expect(states(separate)).toEqual(states(parts));
    // the wing's ridge runs into the main roof: a valley of inner corners
    const shapes = new Set(
      parts.cells
        .filter(([, , , id]) => id === "oak_stairs")
        .map(([x, y, z]) => parts.states(x, y, z).shape),
    );
    expect([...shapes].some((s) => s?.startsWith("inner"))).toBe(true);
    expect([...shapes].some((s) => s?.startsWith("outer"))).toBe(true);
  });

  it("has no cliffs where wings meet", () => {
    const b = run(
      [
        {
          box: {
            at: [1, 0, 1],
            size: [13, 8, 7],
            do: [{ roof: { type: "gable", material: "oak" } }],
          },
        },
        {
          box: {
            at: [4, 0, 4],
            size: [7, 8, 11],
            do: [{ roof: { type: "gable", material: "oak" } }],
          },
        },
      ],
      [15, 8, 17],
    );
    const top = new Map<string, number>();
    for (const [x, y, z] of b.cells) {
      top.set(`${x},${z}`, Math.max(top.get(`${x},${z}`) ?? -1, y));
    }
    for (const [k, y] of top) {
      const [x, z] = k.split(",").map(Number);
      for (const n of [`${x + 1},${z}`, `${x},${z + 1}`]) {
        const ny = top.get(n);
        if (ny !== undefined)
          expect(Math.abs(ny - y), `${k} → ${n}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("combines other shapes by highest surface", () => {
    const b = run(
      [
        {
          box: {
            at: [0, 0, 0],
            size: [9, 8, 9],
            do: [{ roof: { type: "flat", material: "oak", overhang: 0 } }],
          },
        },
        {
          box: {
            at: [0, 0, 0],
            size: [9, 8, 9],
            do: [{ roof: { type: "cone", material: "oak", overhang: 0 } }],
          },
        },
      ],
      [9, 8, 9],
    );
    // the cone rises over the flat roof; the flat roof shows at the corners
    expect(b.at(0, 0, 0)).toBe("oak_planks");
    expect(Math.max(...b.cells.map(([, y]) => y))).toBeGreaterThan(1);
  });

  it("notes roofs at one height that can't merge", () => {
    const b = run(
      [
        {
          box: {
            size: [5, 8, 5],
            do: [{ roof: { type: "gable", material: "oak" } }],
          },
        },
        {
          box: {
            at: [5, 0, 0],
            size: [5, 8, 5],
            do: [{ roof: { type: "gable", material: "oak", pitch: 0.5 } }],
          },
        },
      ],
      [10, 8, 5],
    );
    expect(messages(b.notes)).toContain(
      "build[0].box.do[0].roof: roofs with the same eave height but different pitch/material/priority were combined by highest surface instead of merged into one roof",
    );
  });

  it("keeps roofs at different heights independent", () => {
    // a tall tower's cone overhangs a low annex; the annex roof stays low
    const b = run(
      [
        {
          box: {
            at: [0, 6, 0],
            size: [7, 8, 7],
            do: [{ roof: { type: "cone", material: "oak", overhang: 2 } }],
          },
        },
        {
          box: {
            at: [7, 2, 1],
            size: [6, 6, 5],
            do: [{ roof: { type: "gable", material: "spruce" } }],
          },
        },
      ],
      [13, 14, 7],
    );
    const annex = b.cells.filter(([, , , id]) => id.startsWith("spruce"));
    expect(annex.length).toBeGreaterThan(0);
    expect(Math.max(...annex.map(([, y]) => y))).toBeLessThanOrEqual(5);
  });
});

describe("gable infill", () => {
  it("continues the wall below with 'auto' (Cairn)", () => {
    const b = house({ type: "gable", material: "spruce", overhang: 1 });
    expect(b.cells.some(([, y, , id]) => id === "stone_bricks" && y >= 4)).toBe(
      true,
    );
  });

  it("leaves pavilions open with 'auto' (Cairn)", () => {
    const b = house({ type: "gable", material: "spruce", overhang: 1 }, false);
    const raised = new Set(
      b.cells
        .filter(([, y, , id]) => id === "oak_log" && y >= 4)
        .map(([x, , z]) => `${x},${z}`),
    );
    for (const cell of raised) {
      expect(["2,2", "10,2", "2,8", "10,8"]).toContain(cell);
    }
    expect(b.cells.some(([, , , id]) => id === "stone_bricks")).toBe(false);
  });

  it("uses a material when given one, and nothing with false", () => {
    const filled = house({
      type: "gable",
      material: "spruce",
      overhang: 1,
      gable: "bricks",
    });
    // the gable ends (x = 2 and x = 10) are closed in bricks above the walls
    expect(filled.at(2, 5, 5)).toBe("bricks");
    expect(filled.at(10, 5, 5)).toBe("bricks");
    const open = house({
      type: "gable",
      material: "spruce",
      overhang: 1,
      gable: false,
    });
    expect(open.at(2, 5, 5)).toBe("air");
    expect(open.cells.some(([, , , id]) => id === "bricks")).toBe(false);
  });

  it("needs no hidden fill under a pitch-1 gable (Cairn)", () => {
    const b = house({
      type: "gable",
      material: "spruce",
      overhang: 1,
      gable: false,
    });
    expect(b.cells.filter(([, , , id]) => id === "spruce_planks")).toEqual([]);
  });
});

describe("roof sealing", () => {
  const leaks = (b: ReturnType<typeof run>) => analyze(b, registry).roofLeaks;

  // `house` puts the eave one block above the 4-high walls (y = 4), so the
  // eave layer is the gap between the wall tops and the roof.
  it("reports a roof whose gap to the walls is left open (Cairn)", () => {
    const b = house({
      type: "gable",
      material: "spruce",
      overhang: 1,
      gable: false,
    });
    const path = "build[0].box.do[0].split.parts[1].do[0].roof";
    expect(leaks(b)).toEqual([
      {
        roof: path,
        columns: 63,
        examples: [
          [2, 4, 2],
          [2, 4, 3],
          [2, 4, 4],
          [2, 4, 5],
        ],
        eaveY: 4,
      },
    ]);
    expect(formatReport(b, analyze(b, registry))).toContain(
      `ROOF NOT SEALED (${path}): outside air gets under the roof in 63 column(s), ` +
        "e.g. at [[2, 4, 2], [2, 4, 3], [2, 4, 4], [2, 4, 5]]. Usually a gap between " +
        "the wall tops and the roof (eave y=4); set the roof's 'gable' infill, or " +
        "lower the roof onto the walls",
    );
  });

  it("finds it sealed with 'auto' gables (Cairn)", () => {
    const b = house({ type: "gable", material: "spruce", overhang: 1 });
    expect(leaks(b)).toEqual([]);
    expect(formatReport(b, analyze(b, registry))).not.toContain(
      "ROOF NOT SEALED",
    );
  });

  it("finds a shallow shed roof over walls sealed (Cairn)", () => {
    const b = house({
      type: "shed",
      ridge: "z",
      material: "spruce",
      pitch: 0.5,
      overhang: 1,
    });
    expect(leaks(b)).toEqual([]);
  });

  it("finds a hip roof over walls sealed", () => {
    const b = house({ type: "hip", material: "spruce", overhang: 1 });
    expect(leaks(b)).toEqual([]);
    expect(analyze(b, registry).enclosedSpaces).toHaveLength(1);
  });
});
