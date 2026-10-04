// End-to-end checks of the build-language epic's functional requirements
// (SCHEM-89) that the per-module tests don't already cover: a whole roofless
// inn compiled clean (Cairn's `test_examples_compile_clean`, on a program of
// our own), located and suggestive errors (`test_errors_are_located_and_
// suggestive`), sign `rotation` in rotated scopes, every written state valid
// for the target version, and seeded determinism of mixes and `choose`.
// Everything else is covered next to its code (program, scope, materials,
// writes, compiler-*, postprocess, analyze, build, mcp/build-tools).

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import { loadBlockRegistry } from "../../blockdata/registry";
import { renderProjectionPng } from "../../mcp/render";
import { compileProgram } from "../build";
import { formatProgramError } from "../program";
import { compile, run } from "./compile-harness";

const FIXTURES = path.join(__dirname, "../../blockdata/__tests__/fixtures");
const MCMETA = "https://cdn.jsdelivr.net/gh/misode/mcmeta";
const RESPONSES: Record<string, string> = {
  [`${MCMETA}@1.21.4-summary/blocks/data.min.json`]:
    "registry-mcmeta-1.21.4-blocks.json",
  [`${MCMETA}@1.20.1-summary/blocks/data.min.json`]:
    "registry-mcmeta-1.20.1-blocks.json",
  [`${MCMETA}@1.20.1-summary/registries/data.min.json`]:
    "registry-mcmeta-1.20.1-registries.json",
};
const fetch = vi.fn(async (input: RequestInfo | URL) => {
  const file = RESPONSES[String(input)];
  return file === undefined
    ? new Response("not found", { status: 404 })
    : new Response(readFileSync(path.join(FIXTURES, file), "utf8"), {
        status: 200,
      });
});
const deps = { fetch };

beforeEach(() => clearBlockDataCache());

// A two-storey inn at Cairn's inn size (31×20×25) without its roof: a stone
// brick plinth, framed walls with a bay rhythm of windows, a door, a floor
// between the storeys, a flat ceiling, a dividing wall with its own door,
// lanterns and a hanging sign by the door.
const BAY = [
  { fill: "@wall" },
  { repeat: { axis: "x", every: 1, gap: 3, do: [{ fill: "@post" }] } },
  {
    box: {
      at: [0, 2, 0],
      size: ["100%", 2, 1],
      do: [
        {
          repeat: {
            axis: "x",
            every: 3,
            gap: 1,
            do: [
              {
                box: {
                  at: [1, 0, 0],
                  size: [1, 2, 1],
                  do: [{ fill: { material: "@window", replace: "@wall" } }],
                },
              },
            ],
          },
        },
      ],
    },
  },
];
const INN = {
  name: "Roofless inn",
  size: [31, 20, 25],
  seed: 7,
  palette: {
    plinth: "stone_bricks",
    wall: { mix: { spruce_planks: 3, oak_planks: 1 } },
    post: "spruce:log",
    window: "glass_pane",
    floor: "oak_planks",
    door: "spruce",
  },
  templates: {
    storey: [
      { faces: { sides: [{ use: "bay" }] } },
      {
        block: { at: ["center", -1, 4], material: "lantern[hanging=true]" },
      },
    ],
    bay: BAY,
  },
  build: [
    { box: { size: ["100%", 1, "100%"], do: [{ fill: "@plinth" }] } },
    {
      box: {
        at: ["center", 1, "center"],
        size: [27, 12, 21],
        do: [
          {
            split: {
              axis: "y",
              parts: [
                { size: 5, do: [{ use: "storey" }] },
                { size: 1, do: [{ fill: "@floor" }] },
                { size: 5, do: [{ use: "storey" }] },
                { size: 1, do: [{ fill: "@floor" }] },
              ],
            },
          },
          {
            box: {
              priority: 1,
              at: ["center", 0, 0],
              size: [27, 5, 21],
              do: [{ faces: { front: [{ door: { material: "@door" } }] } }],
            },
          },
          {
            box: {
              at: [1, 0, 10],
              size: [25, 5, 1],
              do: [
                { fill: "@wall" },
                {
                  box: {
                    priority: 1,
                    at: ["center", 0, 0],
                    size: [1, 2, 1],
                    do: [
                      {
                        block: {
                          at: [0, 0, 0],
                          material: "@door:door",
                          facing: "+z",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
};

describe("a whole roofless inn (Cairn's examples compile clean)", () => {
  it("compiles with no errors into one piece, sealed rooms and open doors", async () => {
    const started = performance.now();
    const built = await compileProgram(INN, "1.21.4", deps);
    const { png } = renderProjectionPng(built.projection!, { name: "inn" });
    const elapsed = performance.now() - started;
    expect(png.length).toBeGreaterThan(0);

    expect(built.errors.map(formatProgramError)).toEqual([]);
    expect(built.analysis).not.toBeNull();
    const analysis = built.analysis!;
    expect(analysis.components).toBe(1);
    expect(analysis.floating).toEqual([]);
    expect(analysis.blockedDoors).toEqual([]);
    expect(analysis.enclosedSpaces.length).toBeGreaterThan(0);
    expect(analysis.outOfBounds).toBe(0);
    expect(analysis.features.doors).toBeGreaterThanOrEqual(2);
    expect(analysis.features.light_sources).toBe(2);
    // The bay rhythm keeps the inn left-right symmetric but for the mixed
    // wall planks.
    expect(analysis.symmetry.leftRight).toBeGreaterThan(0.85);
    expect(built.report).toContain("# Build report: Roofless inn");
    expect(built.report).toContain("## Warnings\nNone.");
    // The PRD's budget for compile_build on the inn is 5 s on the preview
    // deploy; compiling and rendering locally should be well inside it.
    expect(elapsed).toBeLessThan(5000);
  });

  it("writes only states that are valid for the target version (FR-7)", async () => {
    for (const version of ["1.21.4", "1.20.1"]) {
      clearBlockDataCache();
      const built = await compileProgram(
        { ...INN, palette: { ...INN.palette, floor: "pale_oak" } },
        version,
        deps,
      );
      expect(built.errors.map(formatProgramError)).toEqual([]);
      const registry = await loadBlockRegistry(version, deps);
      for (const { blockState } of built.projection!.palette) {
        expect(registry.validateState(blockState), blockState).toMatchObject({
          ok: true,
        });
      }
      // 1.20.1 has no pale oak: the floor falls back with a note.
      const notes = built.notes.map(formatProgramError).join("\n");
      if (version === "1.20.1") expect(notes).toMatch(/pale_oak/);
    }
  });

  it("is the same build for the same seed, and differs for another (FR-10)", async () => {
    const a = await compileProgram(INN, "1.21.4", deps);
    const b = await compileProgram(INN, "1.21.4", deps);
    expect(b.projection).toEqual(a.projection);
    expect(b.report).toEqual(a.report);
    const c = await compileProgram({ ...INN, seed: 8 }, "1.21.4", deps);
    expect(c.projection).not.toEqual(a.projection);
  });
});

describe("errors are located and suggestive (Cairn)", () => {
  it("names the program path and the closest blocks", () => {
    const b = compile(
      [{ box: { do: [{ fill: "stone_brickz_wal" }, { fill: "oak_planks" }] } }],
      [4, 4, 4],
    );
    const errors = b.errors.map(formatProgramError);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^build\[0\]\.box\.do\[0\]\.fill: /);
    expect(errors[0]).toMatch(/Did you mean: .*stone_brick_wall/);
    // The next operation still runs.
    expect(b.at(0, 0, 0)).toBe("oak_planks");
  });

  it("reports an unknown operation at its path before compiling", async () => {
    const built = await compileProgram(
      { size: [4, 4, 4], build: [{ box: { do: [{ splt: {} }] } }] },
      "1.21.4",
      deps,
    );
    expect(built.projection).toBeNull();
    expect(built.errors.map(formatProgramError)).toEqual([
      expect.stringMatching(
        /^build\[0\]\.box\.do\[0\]: unknown operation 'splt'/,
      ),
    ]);
  });
});

describe("rotated scopes (FR-6)", () => {
  it("turn a standing sign's `rotation` with the scope", () => {
    const signIn = (rotate: number) =>
      run(
        [
          {
            box: {
              size: [1, 1, 1],
              rotate,
              do: [
                { block: { at: [0, 0, 0], material: "oak_sign[rotation=0]" } },
              ],
            },
          },
        ],
        [1, 1, 1],
      ).states(0, 0, 0).rotation;
    // rotation=0 faces south; each clockwise quarter turn (seen from above)
    // adds 4.
    expect([0, 1, 2, 3].map(signIn)).toEqual(["0", "4", "8", "12"]);
  });
});

describe("the report (FR-9)", () => {
  it("lists collisions and out-of-bounds drops with their program paths", async () => {
    const built = await compileProgram(
      {
        size: [2, 2, 2],
        build: [
          { block: { at: [0, 0, 0], material: "lantern" } },
          { fill: "stone" },
          { box: { at: [1, 0, 0], size: [3, 1, 1], do: [{ fill: "bricks" }] } },
        ],
      },
      "1.21.4",
      deps,
    );
    const warnings = built.report.split("## Warnings\n")[1];
    expect(warnings).toMatch(/^- build\[0\]\.block: .*lantern.*overwritten/m);
    expect(warnings).toMatch(
      /^- build\[2\]\.box\.do\[0\]\.fill: 2 block\(s\) fell outside/m,
    );
  });
});
