// The standard template library (`use: "std:<name>"`).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileForRegistry } from "../build";
import { formatProgramError, validateProgram } from "../program";
import { STD_TEMPLATES, stdTemplateNames } from "../std";
import { compile, messages, registry, run } from "./compile-harness";

const PALETTE = {
  wall: "stone_bricks",
  window: "glass_pane",
  door: "spruce",
};

// A one-storey house on a foundation, `faces` given its walls' operations.
function house(
  faces: Record<string, unknown>,
  size: [number, number, number] = [9, 6, 9],
) {
  return {
    box: {
      size: [size[0], 5, size[2]],
      do: [
        {
          split: {
            axis: "y",
            parts: [
              { size: 1, do: [{ fill: "@wall" }] },
              { size: "~", do: [{ faces }] },
            ],
          },
        },
      ],
    },
  };
}

// Each standard template in a scope where it stands on the ground or
// against a wall.
const SCENES: Record<
  string,
  { size: [number, number, number]; build: unknown[] }
> = {
  window_bay: {
    size: [9, 5, 9],
    build: [house({ sides: [{ use: "std:window_bay" }] })],
  },
  door_bay: {
    size: [9, 5, 9],
    build: [
      house({
        sides: [{ fill: "@wall" }],
        front: [{ use: "std:door_bay" }],
      }),
    ],
  },
  porch: {
    size: [9, 5, 12],
    build: [
      house({ sides: [{ fill: "@wall" }], front: [{ use: "std:door_bay" }] }),
      { box: { at: [1, 0, 9], size: [7, 4, 3], do: [{ use: "std:porch" }] } },
    ],
  },
  dormer: {
    size: [5, 5, 5],
    build: [
      { box: { size: ["~", 1, "~"], do: [{ fill: "@wall" }] } },
      { box: { at: [1, 1, 1], size: [3, 4, 3], do: [{ use: "std:dormer" }] } },
    ],
  },
  chimney: {
    size: [3, 6, 3],
    build: [{ use: "std:chimney" }],
  },
  staircase: {
    size: [3, 5, 6],
    build: [{ use: "std:staircase" }],
  },
  balcony: {
    size: [7, 6, 4],
    build: [
      { box: { size: ["~", "~", 1], do: [{ fill: "@wall" }] } },
      { box: { at: [1, 3, 1], size: [5, 2, 3], do: [{ use: "std:balcony" }] } },
    ],
  },
};

describe("standard templates", () => {
  it("has every template the epic asks for", () => {
    expect(stdTemplateNames()).toEqual(
      expect.arrayContaining(
        [
          "window_bay",
          "door_bay",
          "porch",
          "dormer",
          "chimney",
          "staircase",
          "balcony",
        ].map((n) => `std:${n}`),
      ),
    );
    expect(Object.keys(SCENES).sort()).toEqual(
      Object.keys(STD_TEMPLATES).sort(),
    );
  });

  for (const [name, scene] of Object.entries(SCENES)) {
    it(`compiles std:${name} with no errors and no floating pieces`, () => {
      const built = compileForRegistry(
        { name, size: scene.size, palette: PALETTE, build: scene.build },
        "1.21.4",
        registry,
      );
      expect(built.errors.map(formatProgramError)).toEqual([]);
      expect(built.analysis!.floatingCount).toBe(0);
      expect(built.projection!.totalBlocks).toBeGreaterThan(0);
    });
  }

  it("puts a window in a wall", () => {
    const built = run([{ use: "std:window_bay" }], [3, 4, 1], PALETTE);
    expect(built.at(1, 1, 0)).toBe("glass_pane");
    expect(built.at(1, 2, 0)).toBe("glass_pane");
    expect(built.at(1, 3, 0)).toBe("stone_bricks");
    expect(built.at(0, 1, 0)).toBe("stone_bricks");
  });

  it("takes parameters, with defaults for the rest", () => {
    const built = run(
      [
        {
          use: {
            name: "std:window_bay",
            with: { width: 3, glass: "glass", sill: 0 },
          },
        },
      ],
      [5, 4, 1],
      PALETTE,
    );
    expect(built.at(1, 0, 0)).toBe("glass");
    expect(built.at(3, 1, 0)).toBe("glass");
    expect(built.at(2, 2, 0)).toBe("stone_bricks");
  });

  it("warns about a parameter the template doesn't have", () => {
    const built = compile(
      [{ use: { name: "std:chimney", with: { colour: "red" } } }],
      [3, 3, 3],
      PALETTE,
    );
    expect(messages(built.warnings)).toContainEqual(
      expect.stringContaining(
        "template 'std:chimney' has no parameter 'colour' (parameters: material)",
      ),
    );
  });

  it("climbs a staircase towards the back on a solid wedge", () => {
    const built = run([{ use: "std:staircase" }], [1, 3, 3], PALETTE);
    expect(built.at(0, 0, 2)).toBe("stone_brick_stairs");
    expect(built.states(0, 0, 2).facing).toBe("north");
    expect(built.at(0, 1, 1)).toBe("stone_brick_stairs");
    expect(built.at(0, 2, 0)).toBe("stone_brick_stairs");
    expect(built.at(0, 0, 1)).toBe("stone_bricks");
    expect(built.at(0, 1, 0)).toBe("stone_bricks");
    expect(built.at(0, 2, 1)).toBe("air");
  });

  it("opens a chimney's flue", () => {
    const built = run([{ use: "std:chimney" }], [3, 4, 3], PALETTE);
    expect(built.at(1, 3, 1)).toBe("air");
    expect(built.at(1, 2, 1)).toBe("air");
    expect(built.at(1, 1, 1)).toBe("bricks");
    expect(built.at(0, 3, 1)).toBe("bricks");
  });

  it("isn't replaced by a program template of the same name", () => {
    const templates = { window_bay: [{ fill: "bricks" }] };
    const std = run([{ use: "std:window_bay" }], [3, 4, 1], PALETTE, {
      templates,
    });
    expect(std.at(1, 1, 0)).toBe("glass_pane");
    expect(std.at(0, 0, 0)).toBe("stone_bricks");
    const own = run([{ use: "window_bay" }], [3, 4, 1], PALETTE, {
      templates,
    });
    expect(own.at(1, 1, 0)).toBe("bricks");
  });

  it("rejects unknown standard templates and reserved program names", () => {
    const unknown = validateProgram({
      size: [3, 3, 3],
      build: [{ use: "std:castle" }],
    });
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.errors.map(formatProgramError)).toEqual([
      expect.stringContaining("unknown standard template 'std:castle'"),
    ]);
    const reserved = validateProgram({
      size: [3, 3, 3],
      templates: { "std:porch": [{ fill: "stone" }] },
      build: [],
    });
    expect(!reserved.ok && reserved.errors.map(formatProgramError)).toEqual([
      expect.stringContaining("reserved for the standard templates"),
    ]);
  });

  it("documents every template and parameter in SPEC.md", () => {
    const spec = readFileSync(path.join(__dirname, "../SPEC.md"), "utf8");
    for (const [name, template] of Object.entries(STD_TEMPLATES)) {
      const row = spec
        .split("\n")
        .find((line) => line.startsWith(`| \`std:${name}\``));
      expect(row, `std:${name}`).toBeDefined();
      for (const param of Object.keys(template.params)) {
        expect(row, `std:${name} ${param}`).toContain(`\`${param}\``);
      }
    }
  });
});
