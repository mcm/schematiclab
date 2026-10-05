// Roof merging, `parts` and gable infill (Cairn `SPEC.md` "Roofs",
// `cairn/roofs.py`): checks L, T and cross plans, multi-part roofs and every
// `gable` value against the blocks Cairn itself produced
// (`fixtures/cairn/merged-roofs.json`).

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
    path.join(__dirname, "fixtures/cairn/merged-roofs.json"),
    "utf8",
  ),
) as { cases: Record<string, GoldenCase> };

const golden = (name: string) => {
  const { size, palette, build } = GOLDEN.cases[name].program;
  return run(build, size, palette);
};

/** Hollow walls: the sides of a box. */
const walls = (at: number[], size: number[], material = "stone_bricks") => ({
  box: { at, size, do: [{ faces: { sides: [{ fill: material }] } }] },
});

const roofBox = (at: number[], size: number[], roof: unknown, rotate = 0) => ({
  box: { at, size, rotate, do: [{ roof }] },
});

describe("roof merging: Cairn's own output", () => {
  it.each(Object.entries(GOLDEN.cases))(
    "%s compiles to the same blocks and states",
    (_name, c) => {
      const { size, palette, build } = c.program;
      const b = run(build, size, palette);
      expect(b.log.outOfBounds).toBe(0);
      expect(describeBlocks(b)).toEqual(c.blocks);
    },
  );
});

describe("roof merging", () => {
  it("builds the same blocks from separate roofs, one in a rotated scope, as from one multi-part roof", () => {
    const separate = golden("l_plan_separate");
    const parts = golden("l_plan_parts");
    expect(describeBlocks(separate)).toEqual(describeBlocks(parts));

    // a T plan: a hip main roof and a gable wing in a box turned three times
    const tWalls = [walls([2, 0, 2], [21, 4, 9]), walls([9, 0, 11], [7, 4, 8])];
    const wing = { type: "gable", material: "spruce", ridge: "x" };
    const t1 = run(
      [
        ...tWalls,
        roofBox([2, 4, 2], [21, 8, 9], { type: "hip", material: "spruce" }),
        roofBox([9, 4, 11], [8, 8, 7], wing, 3),
      ] as Operations,
      [25, 12, 21],
    );
    const t2 = run(
      [
        ...tWalls,
        roofBox([2, 4, 2], [21, 8, 17], {
          material: "spruce",
          parts: [
            { at: [0, 0], size: [21, 9], type: "hip" },
            { at: [7, 9], size: [7, 8], ridge: "z" },
          ],
        }),
      ] as Operations,
      [25, 12, 21],
    );
    expect(describeBlocks(t1)).toEqual(describeBlocks(t2));
    // the wing's ridge runs on into the main roof, past the main walls (z = 10)
    for (let z = 8; z <= 18; z++) expect(t1.at(12, 8, z)).toBe("spruce_slab");
  });

  it("forms valleys where wings meet", () => {
    const b = golden("cross_separate");
    // the two ridges cross at the centre at the same height
    const ridge = b.cells.filter(([x, , z]) => x === 10 && z === 10);
    expect(ridge.length).toBeGreaterThan(0);
    // valley stairs at the inside corners face both ridges
    expect(b.at(7, 5, 7)).toMatch(/^oak_(stairs|slab)$/);
  });

  it("combines roofs that differ in pitch by highest surface, with a note", () => {
    const b = golden("different_pitch_not_merged");
    expect(messages(b.notes)).toContain(
      "build[2].box.do[0].roof, build[3].box.do[0].roof: roofs with the same eave height but different pitch, material, gable or priority were combined by highest surface instead of merged into one roof",
    );
    const merged = golden("l_plan_separate");
    expect(messages(merged.notes).join("\n")).not.toMatch(/highest surface/);
  });

  it("doesn't merge roofs on different layers", () => {
    const roofs = (priority?: number) =>
      [
        roofBox([2, 4, 2], [15, 8, 7], { type: "gable", material: "oak" }),
        roofBox([2, 4, 9], [7, 8, 8], {
          type: "gable",
          material: "oak",
          ridge: "z",
          ...(priority === undefined ? {} : { priority }),
        }),
      ] as Operations;
    const merged = run(roofs(), [19, 12, 19]);
    const apart = run(roofs(3), [19, 12, 19]);
    expect(describeBlocks(apart)).not.toEqual(describeBlocks(merged));
    expect(messages(apart.notes).join("\n")).toMatch(/highest surface/);
  });

  it("combines a merge: false roof by highest surface, without a note", () => {
    const roofs = (merge?: boolean) =>
      [
        roofBox([2, 4, 2], [15, 8, 9], { type: "gable", material: "oak" }),
        roofBox([6, 4, 7], [7, 8, 4], {
          type: "gable",
          material: "oak",
          ridge: "z",
          ...(merge === undefined ? {} : { merge }),
        }),
      ] as Operations;
    // inside the main footprint, a merging roof adds nothing to it
    const main = run(roofs().slice(0, 1), [19, 12, 19]);
    expect(describeBlocks(run(roofs(), [19, 12, 19]))).toEqual(
      describeBlocks(main),
    );
    expect(describeBlocks(run(roofs(true), [19, 12, 19]))).toEqual(
      describeBlocks(main),
    );
    // unmerged, its ridge stands out of the front slope
    const apart = run(roofs(false), [19, 12, 19]);
    expect(messages(apart.notes)).toEqual([]);
    // the dormer's front overhang (z = 11) rises to its ridge over x = 9
    const column = (b: typeof main) =>
      b.cells.filter(([x, , z]) => x === 9 && z === 11).map(([, y]) => y);
    expect(Math.max(...column(main))).toBe(4);
    expect(Math.max(...column(apart))).toBe(8);
  });
});

describe("roof parts", () => {
  it("overrides type, ridge, pitch and overhang per part", () => {
    const b = golden("l_hip_pyramid_pitch_override");
    expect(b.cells.length).toBeGreaterThan(0);
    const steep = run(
      [
        roofBox([0, 0, 0], [16, 12, 7], {
          type: "gable",
          material: "oak",
          overhang: 0,
          parts: [
            { at: [0, 0], size: [8, "~"] },
            { at: [8, 0], size: ["~", "~"], pitch: 2, ridge: "z", overhang: 1 },
          ],
        }),
      ] as Operations,
      [17, 12, 7],
    );
    const top = (x0: number, x1: number) =>
      Math.max(
        ...steep.cells.filter(([x]) => x >= x0 && x < x1).map(([, y]) => y),
      );
    // pitch 1 over 7 blocks reaches 3; pitch 2 over 8 + 2 blocks reaches 9
    expect(top(0, 7)).toBe(3);
    expect(top(9, 17)).toBeGreaterThan(6);
    // the second part's overhang reaches x = 16; the first part has none
    expect(Math.max(...steep.cells.map(([x]) => x))).toBe(16);
    expect(Math.min(...steep.cells.map(([x]) => x))).toBe(0);
  });

  it("takes aligned and percentage parts and skips empty ones", () => {
    const b = run(
      [
        roofBox([0, 0, 0], [12, 8, 12], {
          type: "pyramid",
          material: "oak",
          overhang: 0,
          parts: [
            { at: ["center", "center"], size: [4, "50%"] },
            { at: [0, 0], size: [0, 4] },
          ],
        }),
      ] as Operations,
      [12, 8, 12],
    );
    const xs = b.cells.map(([x]) => x);
    const zs = b.cells.map(([, , z]) => z);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([4, 7]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([3, 8]);
  });
});

describe("gable infill", () => {
  // walls x 2–10, z 2–8, y 0–3; the gable ends are x = 2 and x = 10
  it('continues the wall below with "auto" (the default)', () => {
    const b = golden("gable_auto_walls");
    expect(b.at(2, 4, 5)).toBe("stone_bricks");
    expect(b.at(10, 6, 5)).toBe("stone_bricks");
    // eave sides close the gap up to the roof, nothing goes inside
    expect(b.at(6, 4, 5)).toBe("air");
    const logs = golden("gable_auto_logs");
    expect(logs.at(2, 4, 5)).toBe("spruce_log");
  });

  it("uses a given material, and leaves the gap open with false", () => {
    const b = golden("gable_material");
    expect(b.at(2, 4, 5)).toBe("stone_bricks");
    expect(b.at(2, 3, 5)).toBe("oak_planks");
    const open = golden("gable_false");
    expect(open.at(2, 4, 5)).toBe("air");
    for (const g of [false, null, "none", "off"]) {
      const b2 = run(
        [
          walls([2, 0, 2], [9, 4, 7]),
          roofBox([2, 4, 2], [9, 6, 7], {
            type: "gable",
            material: "oak",
            gable: g,
          }),
        ] as Operations,
        [13, 10, 11],
      );
      expect(describeBlocks(b2), String(g)).toEqual(describeBlocks(open));
    }
  });

  it('leaves open structures and see-through walls open with "auto"', () => {
    const posts = golden("gable_auto_open_posts");
    // a corner post runs up into the roof, the open side stays open
    expect(posts.at(2, 4, 2)).toBe("oak_log");
    expect(posts.at(2, 4, 5)).toBe("air");
    expect(golden("gable_glass_wall_stays_open").at(2, 4, 5)).toBe("air");
  });

  it("closes the half-block slot under a top slab over a wall", () => {
    const b = golden("gable_half_pitch_top_slab");
    const doubles = b.cells.filter(
      ([x, y, z, id]) =>
        id === "oak_slab" && b.states(x, y, z).type === "double",
    );
    expect(doubles.length).toBeGreaterThan(0);
  });
});

describe("chimneys and roofs", () => {
  it("lets a chimney written before or after a merged, infilled roof win over it", () => {
    const before = golden("chimney_gable_before");
    const after = golden("chimney_gable_after");
    expect(describeBlocks(before)).toEqual(describeBlocks(after));
    for (let y = 0; y < 12; y++) expect(after.at(2, y, 4)).toBe("bricks");
    // the roof and its gable are still there around it
    expect(after.at(2, 4, 5)).toBe("stone_bricks");
  });
});

describe("roof part and gable errors", () => {
  it("validates parts and gable", () => {
    const result = validateProgram({
      size: [5, 5, 5],
      build: [
        {
          roof: {
            gable: true,
            parts: [
              1,
              { at: [0], size: [1, "x"], material: "oak" },
              { type: "spire", pitch: -1, overhang: { up: 1 } },
            ],
          },
        },
        { roof: { gable: "auto", parts: [] } },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([
      'build[0].roof.gable: must be "auto", a material or false, got true',
      "build[0].roof.parts[0]: expected an object with 'at' and 'size', got 1",
      "build[0].roof.parts[1].material: unknown key 'material' (expected 'at', 'size', 'type', 'pitch', 'overhang', 'ridge', 'break')",
      "build[0].roof.parts[1].at: must be a list of 2 values [x, z], got [0]",
      expect.stringMatching(/^build\[0\]\.roof\.parts\[1\]\.size\[1\]: /),
      'build[0].roof.parts[2].type: must be one of "gable", "hip", "pyramid", "shed", "gambrel", "cone", "dome", "flat", got "spire"',
      "build[0].roof.parts[2].pitch: must be at least 0, got -1",
      "build[0].roof.parts[2].overhang.up: unknown key 'up' (expected 'all', 'left', 'right', 'back', 'front')",
      "build[1].roof.parts: must be a non-empty list, got []",
    ]);
  });

  it("reports an unknown gable material at compile time", () => {
    const b = compile([{ roof: { gable: "@nope" } }] as Operations, [5, 5, 5], {
      roof: "oak",
    });
    expect(messages(b.errors).join("\n")).toMatch(/^build\[0\]\.roof\.gable: /);
  });
});
