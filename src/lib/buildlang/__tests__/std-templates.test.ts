// The standard template library (`std/`): each built-in template compiles
// in a small two-storey house, with no errors, no warnings and nothing
// floating, and program templates never shadow it. Compiled against the
// whole 1.21.4 block list.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import {
  type BlockRegistry,
  loadBlockRegistry,
} from "../../blockdata/registry";
import { type BuildResult, compileForRegistry } from "../build";
import { formatProgramError, validateProgram } from "../program";
import { STD_TEMPLATES, stdTemplate, stdTemplateNames } from "../std";
import { substituteParams } from "../templates";

const REGISTRY = path.join(
  __dirname,
  "../../blockdata/__tests__/fixtures/registry-mcmeta-1.21.4-full-blocks.json",
);
const BLOCKS_URL =
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json";
const fetch = vi.fn(async (input: RequestInfo | URL) =>
  String(input) === BLOCKS_URL
    ? new Response(readFileSync(REGISTRY, "utf8"), { status: 200 })
    : new Response("not found", { status: 404 }),
);

let registry: BlockRegistry;

beforeAll(async () => {
  clearBlockDataCache();
  registry = await loadBlockRegistry("1.21.4", { fetch });
});

const PALETTE = {
  foundation: "cobblestone",
  wall: "stone_bricks",
  post: "spruce_log",
  floor: "spruce",
  roof: "spruce",
  window: "glass_pane",
  door: "spruce",
  chimney: "bricks",
  trim: "polished_andesite",
};

const window = { use: "std:window_bay" };
const door = { use: "std:door_bay" };

/** A front face of three window bays, or window, door, window. */
function facade(withDoor: boolean) {
  return [
    { fill: "@wall" },
    {
      repeat: {
        axis: "x",
        every: 3,
        gap: 1,
        pattern: withDoor ? [[window], [door], [window]] : [[window]],
      },
    },
  ];
}

interface HouseParts {
  /** Front face of the ground and upper storeys. */
  ground?: unknown[];
  upper?: unknown[];
  /** Operations in the roof box (13 × 8 × 9, eave at its bottom). */
  roof?: unknown[];
  /** Operations in the house box (13 × 18 × 9, foundation at y = 0). */
  inside?: unknown[];
  /** Operations in the program's root scope (the house is at [3, 0, 2]). */
  outside?: unknown[];
  templates?: Record<string, unknown>;
}

/**
 * A 13 × 9 house of two storeys (foundation at y = 0, upper floor at
 * y = 5, eave at y = 10) with a gable roof, in a 19 × 18 × 15 program; its
 * front wall is at world z = 10.
 */
function house(parts: HouseParts = {}) {
  const storey = (front: unknown[]) => [
    {
      faces: {
        sides: facade(false),
        front,
        edges: [{ fill: "@post" }],
      },
    },
  ];
  return {
    size: [19, 18, 15],
    palette: PALETTE,
    ...(parts.templates ? { templates: parts.templates } : {}),
    build: [
      {
        box: {
          at: [3, 0, 2],
          size: [13, 18, 9],
          do: [
            {
              split: {
                axis: "y",
                parts: [
                  {
                    size: 1,
                    do: [
                      { fill: "@foundation" },
                      { inset: { by: 1, do: [{ fill: "@floor" }] } },
                    ],
                  },
                  { size: 4, do: storey(parts.ground ?? facade(true)) },
                  {
                    size: 1,
                    do: [
                      { faces: { sides: [{ fill: "@wall" }] } },
                      { inset: { by: 1, do: [{ fill: "@floor" }] } },
                    ],
                  },
                  { size: 4, do: storey(parts.upper ?? facade(false)) },
                  {
                    size: 8,
                    do: [
                      { roof: { type: "gable", ridge: "x" } },
                      ...(parts.roof ?? []),
                    ],
                  },
                ],
              },
            },
            ...(parts.inside ?? []),
          ],
        },
      },
      ...(parts.outside ?? []),
    ],
  };
}

function build(program: unknown): BuildResult {
  const built = compileForRegistry(program, "1.21.4", registry);
  expect(built.errors.map(formatProgramError)).toEqual([]);
  expect(built.warnings.map(formatProgramError)).toEqual([]);
  return built;
}

/** World cell → block id (without `minecraft:`) and states. */
function cells(built: BuildResult) {
  const out = new Map<string, { id: string; states: Record<string, string> }>();
  for (const region of built.projection!.regions) {
    for (const { pos, paletteIndex } of region.blocks) {
      const { blockId, properties } = built.projection!.palette[paletteIndex];
      out.set(pos.map((v, a) => v + region.origin[a]).join(","), {
        id: blockId.replace(/^minecraft:/, ""),
        states: properties,
      });
    }
  }
  return out;
}

const idAt = (built: BuildResult, x: number, y: number, z: number) =>
  cells(built).get(`${x},${y},${z}`)?.id ?? "air";

/** Each template, used where it belongs in the house. */
const SCENES: Record<string, HouseParts> = {
  window_bay: {
    upper: [
      { fill: "@wall" },
      {
        repeat: {
          axis: "x",
          every: 3,
          gap: 1,
          do: [
            {
              use: {
                name: "std:window_bay",
                with: {
                  lintel: [{ fill: "@trim" }],
                  under: [{ fill: "@trim" }],
                },
              },
            },
          ],
        },
      },
    ],
  },
  door_bay: {
    ground: [
      { fill: "@wall" },
      {
        box: {
          at: ["center", 0, 0],
          size: [3, "100%", "100%"],
          do: [
            {
              use: {
                name: "std:door_bay",
                with: { lintel: [{ fill: "@trim" }] },
              },
            },
          ],
        },
      },
    ],
  },
  porch: {
    outside: [
      { box: { at: [6, 0, 11], size: [7, 5, 3], do: [{ use: "std:porch" }] } },
    ],
  },
  balcony: {
    upper: facade(true),
    outside: [
      {
        box: { at: [7, 5, 11], size: [5, 2, 2], do: [{ use: "std:balcony" }] },
      },
    ],
  },
  dormer: {
    roof: [
      {
        box: {
          at: ["center", 0, 5],
          size: [7, "~", 4],
          do: [{ use: "std:dormer" }],
        },
      },
    ],
  },
  chimney: {
    inside: [
      {
        box: {
          at: [9, 1, 2],
          size: [2, "~", 2],
          do: [{ use: "std:chimney" }],
        },
      },
    ],
  },
  staircase: {
    inside: [
      {
        box: {
          at: [1, 1, 2],
          size: [2, 5, 5],
          do: [{ use: "std:staircase" }],
        },
      },
    ],
  },
};

describe("standard templates", () => {
  it("include the documented set", () => {
    expect(stdTemplateNames()).toEqual(
      [
        "balcony",
        "chimney",
        "door_bay",
        "dormer",
        "porch",
        "staircase",
        "window_bay",
      ].map((n) => `std:${n}`),
    );
    expect(Object.keys(SCENES).sort()).toEqual(
      Object.keys(STD_TEMPLATES).sort(),
    );
  });

  it.each(Object.keys(STD_TEMPLATES))(
    "std:%s gives a default for exactly the parameters it uses",
    (name) => {
      const { params, body } = STD_TEMPLATES[name];
      const substituted = substituteParams(body, params, `std:${name}`);
      expect(substituted.errors).toEqual([]);
      expect([...substituted.used].sort()).toEqual(Object.keys(params).sort());
    },
  );

  it.each(Object.entries(SCENES))(
    "std:%s compiles in a house with no errors and nothing floating",
    (_name, scene) => {
      const built = build(house(scene));
      const analysis = built.analysis!;
      expect(analysis.outOfBounds).toBe(0);
      expect(analysis.floating).toEqual([]);
      expect(analysis.components).toBe(1);
      expect(analysis.blockedDoors).toEqual([]);
      expect(analysis.roofLeaks).toEqual([]);
      expect(built.report).not.toMatch(/FLOATING|BLOCKED DOOR|NOT SEALED/);
    },
  );

  it("are documented in SPEC.md, with every parameter", () => {
    const spec = readFileSync(path.join(__dirname, "../SPEC.md"), "utf8");
    const section = spec.slice(spec.indexOf("## 5a. Standard templates"));
    for (const [name, { params }] of Object.entries(STD_TEMPLATES)) {
      const start = section.indexOf(`**\`std:${name}\`**`);
      expect(start, name).toBeGreaterThan(0);
      const end = section.indexOf("**`std:", start + 1);
      const entry = section.slice(start, end < 0 ? undefined : end);
      for (const param of Object.keys(params)) {
        expect(entry, `${name}.${param}`).toContain(`\`${param}\``);
      }
    }
  });
});

describe("what the standard templates build", () => {
  it("window_bay: a centred window with its lintel and sill rows", () => {
    const built = build(house(SCENES.window_bay));
    // upper storey y 6–9, front wall z = 10, first bay at x 4–6
    expect(idAt(built, 5, 6, 10)).toBe("polished_andesite");
    expect(idAt(built, 5, 7, 10)).toBe("glass_pane");
    expect(idAt(built, 5, 8, 10)).toBe("glass_pane");
    expect(idAt(built, 4, 7, 10)).toBe("stone_bricks");
    expect(idAt(built, 4, 9, 10)).toBe("polished_andesite");
  });

  it("door_bay: a door with a lintel above it", () => {
    const built = build(house(SCENES.door_bay));
    expect(idAt(built, 9, 1, 10)).toBe("spruce_door");
    expect(idAt(built, 9, 2, 10)).toBe("spruce_door");
    expect(idAt(built, 8, 3, 10)).toBe("polished_andesite");
  });

  it("porch: deck, corner posts and a slab roof", () => {
    const built = build(house(SCENES.porch));
    expect(idAt(built, 6, 0, 13)).toBe("spruce_planks");
    expect(idAt(built, 6, 2, 13)).toBe("spruce_log");
    expect(idAt(built, 12, 2, 13)).toBe("spruce_log");
    expect(idAt(built, 9, 2, 13)).toBe("air");
    expect(idAt(built, 9, 4, 12)).toBe("spruce_slab");
  });

  it("balcony: a floor with a railing on its open sides", () => {
    const built = build(house(SCENES.balcony));
    expect(idAt(built, 9, 5, 12)).toBe("spruce_planks");
    expect(idAt(built, 9, 6, 12)).toBe("spruce_fence");
    expect(idAt(built, 7, 6, 11)).toBe("spruce_fence");
    expect(idAt(built, 9, 6, 11)).toBe("air");
  });

  it("dormer: a window in a gable whose roof joins the main roof, sealed", () => {
    const built = build(house(SCENES.dormer));
    // roof box from y = 10; dormer x 6–12, z 7–10, ridge at x = 9
    expect(idAt(built, 9, 10, 10)).toBe("glass_pane");
    expect(idAt(built, 9, 11, 10)).toBe("glass_pane");
    // the gable infill closes round the window, under the dormer's ridge
    expect(idAt(built, 9, 12, 10)).toBe("stone_bricks");
    expect(idAt(built, 9, 13, 10)).toBe("stone_bricks");
    expect(idAt(built, 9, 14, 11)).toBe("spruce_slab");
    expect(idAt(built, 9, 10, 11)).toBe("air");
    expect(idAt(built, 7, 12, 10)).toBe("spruce_stairs");
    // combined with the main roof on purpose, so no note about merging
    expect(built.notes).toEqual([]);
    expect(built.analysis!.roofLeaks).toEqual([]);
    expect(built.report).not.toMatch(/NOT SEALED/);
  });

  it("chimney: a column with a capped top", () => {
    const built = build(house(SCENES.chimney));
    expect(idAt(built, 12, 5, 4)).toBe("bricks");
    expect(idAt(built, 12, 16, 4)).toBe("bricks");
    expect(idAt(built, 12, 17, 4)).toBe("brick_slab");
  });

  it("staircase: one step per block, solid below, through the floor above", () => {
    const built = build(house(SCENES.staircase));
    const all = cells(built);
    // box x 4–5, y 1–5, z 4–8: bottom step at z = 8
    for (let k = 0; k < 5; k++) {
      const step = all.get(`4,${1 + k},${8 - k}`);
      expect(step?.id).toBe("spruce_stairs");
      expect(step?.states.facing).toBe("north");
      for (let y = 1; y < 1 + k; y++) {
        expect(idAt(built, 4, y, 8 - k)).toBe("spruce_planks");
      }
      // headroom cleared, the upper floor included
      expect(idAt(built, 5, 2 + k, 8 - k)).toBe("air");
    }
  });

  it("staircase: runs to 16 steps, nested in other operations", () => {
    let op: unknown = { use: "std:staircase" };
    for (let i = 0; i < 8; i++) op = { box: { do: [op] } };
    const built = build({ size: [2, 16, 16], palette: PALETTE, build: [op] });
    expect(built.analysis!.blockCount).toBe(2 * ((16 * 17) / 2));
  });
});

describe("std: names", () => {
  it("a program template named window_bay does not replace std:window_bay", () => {
    const built = build(
      house({
        templates: { window_bay: [{ fill: "gold_block" }] },
        ground: [
          { fill: "@wall" },
          {
            repeat: {
              axis: "x",
              every: 3,
              gap: 1,
              pattern: [
                [{ use: "window_bay" }],
                [{ use: "std:window_bay" }],
                [{ use: "window_bay" }],
              ],
            },
          },
        ],
      }),
    );
    // ground storey y 1–4, bays at x 4–6, 8–10, 12–14 of the front wall
    expect(idAt(built, 4, 1, 10)).toBe("gold_block");
    expect(idAt(built, 9, 2, 10)).toBe("glass_pane");
    expect(idAt(built, 8, 2, 10)).toBe("stone_bricks");
    expect(idAt(built, 14, 4, 10)).toBe("gold_block");
  });

  it("passes parameters over the defaults, and warns about unknown ones", () => {
    const built = compileForRegistry(
      {
        size: [3, 4, 1],
        palette: PALETTE,
        build: [
          { fill: "@wall" },
          {
            use: {
              name: "std:window_bay",
              with: { glass: "tinted_glass", height: 3, color: "red" },
            },
          },
        ],
      },
      "1.21.4",
      registry,
    );
    expect(built.errors).toEqual([]);
    expect(built.warnings.map(formatProgramError)).toEqual([
      "build[1].use.with.color: template 'std:window_bay' has no parameter 'color'",
    ]);
    const ids = [1, 2, 3].map((y) => idAt(built, 1, y, 0));
    expect(ids).toEqual(["tinted_glass", "tinted_glass", "tinted_glass"]);
  });

  it("reports problems inside a built-in template at its std: path", () => {
    const built = compileForRegistry(
      { size: [3, 4, 1], build: [{ use: "std:window_bay" }] },
      "1.21.4",
      registry,
    );
    expect(built.errors.map(formatProgramError)).toEqual([
      expect.stringMatching(
        /^std:window_bay\[0\]\.split\.parts\[1\].*palette has no role '@window'.*\(in a template used at build\[0\]\.use\)$/,
      ),
    ]);
  });

  it("rejects unknown built-in templates and std: program templates", () => {
    const result = validateProgram({
      size: [3, 3, 3],
      templates: { "std:porch": [] },
      build: [{ use: "std:gazebo" }, { use: "porch" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(formatProgramError)).toEqual([
      `templates["std:porch"]: template names can't start with 'std:', which names the built-in templates`,
      `build[0].use: unknown built-in template 'std:gazebo' (built-in: ${stdTemplateNames().join(", ")})`,
      "build[1].use: unknown template 'porch' (defined: none; the built-in one is 'std:porch')",
    ]);
    expect(stdTemplate("std:gazebo")).toBeUndefined();
    expect(stdTemplate("porch")).toBeUndefined();
    expect(stdTemplate("std:porch")).toBe(STD_TEMPLATES.porch);
  });
});
