// The analysis report (port of Cairn's `cairn/metrics.py`): connectivity,
// enclosure at half-block resolution, symmetry, features, blocked doors and
// the markdown layout of Cairn's sample reports.

import { describe, expect, it } from "vitest";
import { analyze, blockMask, formatReport } from "../analyze";
import type { Operations } from "../program";
import { compile, registry, run } from "./compile-harness";

const report = (b: ReturnType<typeof compile>) =>
  formatReport(b, analyze(b, registry));

// A hollow stone box: walls, floor and (optionally) ceiling.
const shell = (top = true): Operations => [
  {
    faces: {
      sides: [{ fill: "stone" }],
      bottom: [{ fill: "stone" }],
      ...(top ? { top: [{ fill: "stone" }] } : {}),
    },
  },
];

// Mask bit for sub-cell (x, y, z) of a block, 0 = low half.
const bit = (x: number, y: number, z: number) => 1 << (x + 2 * y + 4 * z);
const mask = (id: string, states: Record<string, string> = {}) =>
  blockMask(registry, { id: `minecraft:${id}`, states });

describe("connectivity", () => {
  it("reports a floating block with its coordinates and path", () => {
    const b = run(
      [
        { box: { size: ["~", 1, "~"], do: [{ fill: "stone" }] } },
        { block: { at: [2, 2, 2], material: "cobblestone" } },
      ],
      [5, 3, 5],
    );
    const a = analyze(b, registry);
    expect(a.components).toBe(2);
    expect(a.floating).toEqual([
      {
        blocks: 1,
        example: [2, 2, 2],
        materials: ["cobblestone"],
        path: "build[1].block",
      },
    ]);
    expect(report(b)).toContain(
      "FLOATING pieces (not connected to the lowest layer): 1\n" +
        "  - 1 block(s) near [2, 2, 2] (cobblestone) (from build[1].block)",
    );
  });

  it("joins pieces that touch along an edge, but not at a corner", () => {
    const b = run(
      [
        { block: { at: [0, 0, 0], material: "stone" } },
        { block: { at: [1, 1, 0], material: "stone" } },
        { block: { at: [2, 2, 1], material: "stone" } },
      ],
      [3, 3, 2],
    );
    const a = analyze(b, registry);
    expect(a.components).toBe(2);
    expect(a.floating.map((f) => f.example)).toEqual([[2, 2, 1]]);
  });

  it("measures from the lowest layer, not y = 0", () => {
    const b = run(
      [{ box: { at: [0, 2, 0], size: [2, 1, 1], do: [{ fill: "stone" }] } }],
      [2, 4, 1],
    );
    const a = analyze(b, registry);
    expect(a.floating).toEqual([]);
    expect(a.bbox).toEqual({ min: [0, 2, 0], max: [1, 2, 0], dims: [2, 1, 1] });
  });
});

describe("enclosure", () => {
  it("finds the sealed interior of a closed box", () => {
    const a = analyze(run(shell(), [5, 5, 5]), registry);
    expect(a.enclosedAir).toBe(27);
    expect(a.enclosedSpaces).toEqual([27]);
  });

  it("finds no interior in an open box", () => {
    const b = run(shell(false), [5, 5, 5]);
    const a = analyze(b, registry);
    expect(a.enclosedAir).toBe(0);
    expect(a.enclosedSpaces).toEqual([]);
    expect(report(b)).toContain(
      "enclosed air: 0 blocks; interior spaces (>=8 blocks): NONE - the building has no sealed interior",
    );
  });

  it("counts each room and leaves out spaces under 8 blocks", () => {
    const b = run(
      [
        ...shell(),
        // a wall splits the 7×3×3 inside into 3×3×3 and 3×3×3
        {
          box: { at: [4, 0, 0], size: [1, "~", "~"], do: [{ fill: "stone" }] },
        },
      ],
      [9, 5, 5],
    );
    const a = analyze(b, registry);
    expect(a.enclosedSpaces).toEqual([27, 27]);
    expect(a.enclosedAir).toBe(54);
  });

  it("reports small sealed pockets as enclosed air only", () => {
    const a = analyze(
      run(
        [
          { fill: "stone" },
          { box: { at: [1, 1, 1], size: [1, 1, 1], do: [{ clear: true }] } },
        ],
        [3, 3, 3],
      ),
      registry,
    );
    expect(a.enclosedAir).toBe(1);
    expect(a.enclosedSpaces).toEqual([]);
  });

  it("sees air leaking over the open half of a slab", () => {
    // the top row of the walls is bottom slabs under a full ceiling
    const walls = (slab: string): Operations => [
      { faces: { sides: [{ fill: "stone" }], bottom: [{ fill: "stone" }] } },
      {
        box: {
          at: [0, 3, 0],
          size: ["~", 1, "~"],
          do: [{ faces: { sides: [{ fill: slab }] } }],
        },
      },
      { box: { at: [0, 4, 0], size: ["~", 1, "~"], do: [{ fill: "stone" }] } },
    ];
    expect(
      analyze(run(walls("stone_slab"), [5, 5, 5]), registry).enclosedSpaces,
    ).toEqual([]);
    expect(
      analyze(run(walls("stone_slab[type=double]"), [5, 5, 5]), registry)
        .enclosedSpaces,
    ).toEqual([27]);
  });

  it("treats panes and doors as sealing, fences and torches as open", () => {
    const withWindow = (material: string): Operations => [
      ...shell(),
      { box: { at: [2, 2, 0], size: [1, 1, 1], do: [{ fill: material }] } },
    ];
    for (const sealing of ["glass_pane", "glass", "oak_planks"]) {
      expect(
        analyze(run(withWindow(sealing), [5, 5, 5]), registry).enclosedSpaces,
      ).toEqual([27]);
    }
    for (const open of ["oak_fence", "torch", "white_carpet"]) {
      expect(
        analyze(run(withWindow(open), [5, 5, 5]), registry).enclosedSpaces,
      ).toEqual([]);
    }
  });

  it("skips enclosure when the bounding box is too big", () => {
    const b = run(
      [
        { block: { at: [0, 0, 0], material: "stone" } },
        { block: { at: [255, 255, 255], material: "stone" } },
      ],
      [256, 256, 256],
    );
    const a = analyze(b, registry);
    expect(a.enclosedAir).toBeNull();
    expect(a.enclosedSpaces).toEqual([]);
    expect(formatReport(b, a)).toContain(
      "enclosed air: not measured (the bounding box is too big)",
    );
  });
});

describe("blockMask", () => {
  const lower = bit(0, 0, 0) | bit(1, 0, 0) | bit(0, 0, 1) | bit(1, 0, 1);
  const upper = lower << 2;

  it("fills whole cells for full blocks, panes, doors and walls", () => {
    for (const id of ["stone", "glass_pane", "oak_door", "oak_log", "chest"]) {
      expect(mask(id)).toBe(0xff);
    }
  });

  it("leaves thin and small blocks empty", () => {
    for (const id of ["torch", "oak_fence", "white_carpet", "oak_trapdoor"]) {
      expect(mask(id)).toBe(0);
    }
    expect(mask("lantern")).toBe(0);
  });

  it("fills one half of a slab and the lower half of a bed", () => {
    expect(mask("oak_slab")).toBe(lower);
    expect(mask("oak_slab", { type: "top" })).toBe(upper);
    expect(mask("oak_slab", { type: "double" })).toBe(0xff);
    expect(mask("red_bed")).toBe(lower);
  });

  it("shapes stairs by facing, half and shape", () => {
    // facing north: the step is on the north (low z) half
    expect(mask("oak_stairs")).toBe(lower | bit(0, 1, 0) | bit(1, 1, 0));
    expect(mask("oak_stairs", { facing: "east" })).toBe(
      lower | bit(1, 1, 0) | bit(1, 1, 1),
    );
    expect(mask("oak_stairs", { facing: "south", half: "top" })).toBe(
      upper | bit(0, 0, 1) | bit(1, 0, 1),
    );
    // north's left is west, its right east
    expect(mask("oak_stairs", { shape: "outer_left" })).toBe(
      lower | bit(0, 1, 0),
    );
    expect(mask("oak_stairs", { shape: "outer_right" })).toBe(
      lower | bit(1, 1, 0),
    );
    expect(mask("oak_stairs", { shape: "inner_left" })).toBe(
      lower | bit(0, 1, 0) | bit(1, 1, 0) | bit(0, 1, 1),
    );
    expect(mask("oak_stairs", { shape: "inner_right" })).toBe(
      lower | bit(0, 1, 0) | bit(1, 1, 0) | bit(1, 1, 1),
    );
  });
});

describe("doors", () => {
  it("reports a door blocked by a wall", () => {
    const b = run(
      [
        { faces: { front: [{ fill: "stone" }, { door: "oak_door" }] } },
        // an inner wall right behind the front wall
        { box: { at: [0, 0, 3], size: ["~", 3, 1], do: [{ fill: "stone" }] } },
      ],
      [5, 3, 5],
    );
    const a = analyze(b, registry);
    expect(a.features.doors).toBe(1);
    expect(a.blockedDoors).toEqual([
      {
        door: [2, 0, 4],
        doorPath: "build[0].faces.front[1].door",
        side: [2, 0, 3],
        by: "stone",
        at: [2, 0, 3],
        byPath: "build[1].box.do[0].fill",
      },
    ]);
    expect(report(b)).toContain(
      "BLOCKED DOOR at [2, 0, 4] (from build[0].faces.front[1].door): stone at [2, 0, 3] (from build[1].box.do[0].fill) stops a player walking through",
    );
  });

  it("reports a block at head height and leaves clear doors alone", () => {
    const blocked = run(
      [
        { block: { at: [0, 0, 0], material: "oak_door", facing: "+z" } },
        { block: { at: [0, 1, 1], material: "glass" } },
      ],
      [1, 2, 2],
    );
    expect(analyze(blocked, registry).blockedDoors).toEqual([
      expect.objectContaining({ side: [0, 0, 1], at: [0, 1, 1], by: "glass" }),
    ]);
    const clear = run(
      [
        { block: { at: [0, 0, 1], material: "oak_door", facing: "+z" } },
        { block: { at: [0, 0, 0], material: "torch" } },
        { block: { at: [0, 0, 2], material: "oak_slab" } },
      ],
      [1, 2, 3],
    );
    expect(analyze(clear, registry).blockedDoors).toEqual([]);
  });
});

describe("symmetry, features and materials", () => {
  it("scores left-right and front-back mirror symmetry", () => {
    const b = run(
      [
        { box: { size: ["~", 1, 1], do: [{ fill: "stone" }] } },
        { block: { at: [0, 1, 0], material: "stone" } },
      ],
      [5, 2, 1],
    );
    const a = analyze(b, registry);
    expect(a.symmetry).toEqual({ leftRight: 0.833, frontBack: 1 });
    expect(report(b)).toContain(
      "mirror symmetry: left-right 83%, front-back 100%",
    );
  });

  it("counts doors, windows, stairs, slabs and lights", () => {
    const b = run(
      [
        { block: { at: [0, 0, 0], material: "oak_door", facing: "+z" } },
        { block: { at: [1, 0, 0], material: "glass_pane" } },
        { block: { at: [2, 0, 0], material: "white_stained_glass" } },
        { block: { at: [3, 0, 0], material: "oak_stairs" } },
        { block: { at: [4, 0, 0], material: "oak_slab" } },
        { block: { at: [5, 0, 0], material: "torch" } },
        { block: { at: [6, 0, 0], material: "lantern" } },
        { block: { at: [7, 0, 0], material: "sea_lantern" } },
      ],
      [8, 2, 1],
    );
    const a = analyze(b, registry);
    expect(a.features).toEqual({
      doors: 1,
      window_blocks: 2,
      stairs: 1,
      slabs: 1,
      light_sources: 3,
    });
    expect(report(b)).toContain(
      "## Features\ndoors: 1, window_blocks: 2, stairs: 1, slabs: 1, light_sources: 3",
    );
  });

  it("lists the most used materials, ties by name", () => {
    const b = run(
      [
        { box: { size: ["~", 1, 1], do: [{ fill: "stone" }] } },
        { block: { at: [0, 1, 0], material: "cobblestone" } },
        { block: { at: [1, 1, 0], material: "bricks" } },
      ],
      [4, 2, 1],
    );
    expect(analyze(b, registry).materials).toEqual([
      ["stone", 4],
      ["bricks", 1],
      ["cobblestone", 1],
    ]);
    expect(report(b)).toContain(
      "## Materials (top)\nstone x4, bricks x1, cobblestone x1",
    );
  });
});

describe("formatReport", () => {
  it("lays out a clean build like Cairn's sample reports", () => {
    const b = run(shell(), [5, 5, 5]);
    expect(report({ ...b, name: "Box" })).toBe(
      [
        "# Build report: Box",
        "size (bounds) [5, 5, 5]  blocks placed 98",
        "",
        "## Errors (fix these first)",
        "None.",
        "",
        "## Warnings",
        "None.",
        "",
        "## Geometry",
        "occupied bbox [0, 0, 0]..[4, 4, 4] (dims [5, 5, 5])",
        "connected pieces: 1",
        "enclosed air: 27 blocks; interior spaces (>=8 blocks): [27]",
        "mirror symmetry: left-right 100%, front-back 100%",
        "",
        "## Features",
        "doors: 0, window_blocks: 0, stairs: 0, slabs: 0, light_sources: 0",
        "",
        "## Materials (top)",
        "stone x98",
        "",
      ].join("\n"),
    );
  });

  it("lists errors, warnings and notes with their program paths", () => {
    const b = compile(
      [
        { fill: "Glass Panes" },
        { box: { size: [1, 1, 1], do: [{ fill: "no_such_block_at_all" }] } },
        { faces: { thickness: 3, front: [{ fill: "stone" }] } },
      ],
      [2, 1, 2],
    );
    const text = report(b);
    expect(text).toMatch(
      /## Errors \(fix these first\)\n- build\[1\]\.box\.do\[0\]\.fill: /,
    );
    expect(text).toContain(
      "## Warnings\n- build[2].faces.front[0].fill: 2 block(s) fell outside the build size [2,1,2]",
    );
    expect(text).toMatch(/## Auto-repairs \/ notes\n- build\[0\]\.fill: /);
    expect(text).toContain("blocks dropped out of bounds: 2 (see Warnings)");
    expect(analyze(b, registry).outOfBounds).toBe(2);
  });

  it("caps the notes at 20", () => {
    const b = run(shell(), [5, 5, 5]);
    const notes = Array.from({ length: 23 }, (_, i) => ({
      path: `build[${i}].fill`,
      message: "repaired",
    }));
    const text = report({ ...b, notes });
    expect(text).toContain("- build[19].fill: repaired\n- … and 3 more\n");
    expect(text).not.toContain("build[20]");
  });

  it("says when the build is empty", () => {
    const b = run([], [3, 3, 3]);
    const a = analyze(b, registry);
    expect(a.bbox).toBeNull();
    expect(a.components).toBe(0);
    const text = formatReport(b, a);
    expect(text).toContain("# Build report: untitled\n");
    expect(text).toContain("## Geometry\nThe build is EMPTY.\n");
    expect(text).toContain("## Materials (top)\nNone.\n");
  });
});
