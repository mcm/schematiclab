import { describe, expect, it } from "vitest";

import {
  formatProgramError,
  MAX_BUILD_SIZE,
  validateProgram,
  type Program,
} from "../program";

function program(build: unknown, extra: Record<string, unknown> = {}) {
  return { size: [16, 16, 16], build, ...extra };
}

/** Every error of an invalid program, as `path: message`. */
function errors(json: unknown): string[] {
  const result = validateProgram(json);
  if (result.ok) throw new Error("program validated");
  return result.errors.map(formatProgramError);
}

function errorsOf(build: unknown, extra?: Record<string, unknown>): string[] {
  return errors(program(build, extra));
}

function expectValid(json: unknown): Program {
  const result = validateProgram(json);
  if (!result.ok) {
    throw new Error(result.errors.map(formatProgramError).join("\n"));
  }
  return result.program;
}

describe("validateProgram: the program", () => {
  it("accepts a program using every operation", () => {
    const json = {
      "#": "a cottage",
      name: "Cottage",
      size: [17, 16, 13],
      seed: 3,
      palette: {
        wall: "stone_bricks",
        roof: "spruce",
        floor: { mix: { oak_planks: 3, spruce_planks: 1 } },
        "#": "roles",
      },
      templates: {
        bay: [{ fill: "@wall" }, { block: { at: [1, 1, 0], material: "$m" } }],
      },
      build: [
        {
          "#": "body",
          box: {
            at: [1, 0, "center"],
            size: ["~", "50%", 11],
            rotate: 1,
            priority: 1,
            carve: false,
            do: [
              {
                split: {
                  axis: "y",
                  parts: [
                    { size: 1, do: [{ fill: "@floor" }] },
                    { size: "~2" },
                    { size: "~", "#": "attic" },
                  ],
                },
              },
              {
                repeat: {
                  axis: "x",
                  every: 3,
                  gap: 1,
                  margin: 0,
                  align: "stretch",
                  pattern: [[{ use: "bay" }], [{ door: "@roof:door" }]],
                  first: [],
                  last: [],
                  ends: [],
                },
              },
              { repeat: { axis: "z", count: 2, do: [{ clear: true }] } },
              { inset: { by: 1, do: [{ clear: { carve: true } }] } },
              { inset: { by: { x: 1, top: 2 }, do: [] } },
              {
                faces: {
                  sides: [{ use: { name: "bay", with: { m: "lantern" } } }],
                  front: [{ door: { material: "@roof", hinge: "left", x: 2 } }],
                  edges: [{ frame: "spruce:log" }],
                  thickness: 1,
                },
              },
              {
                fill: {
                  material: "glass",
                  replace: ["@wall", "solid"],
                  only_empty: false,
                  facing: "out",
                  axis: "x",
                  state: { waterlogged: false, power: 3, half: "top" },
                },
              },
              { cylinder: { material: "@wall", hollow: true, thickness: 1 } },
              { ellipsoid: { mix: { stone: 1, andesite: 1 } } },
              {
                block: {
                  at: [-1, "end", "50%"],
                  material: "lantern",
                  facing: "+z",
                  state: { hanging: "true" },
                },
              },
              { roof: { type: "gable", material: "@roof" } },
              { roof: "hip" },
              {
                choose: {
                  options: [[{ fill: "stone" }], []],
                  weights: [3, 1],
                },
              },
              { choose: [[{ fill: "dirt" }]] },
              {
                when: {
                  min: [5, null, null],
                  max: [null, 10, 20],
                  do: [{ fill: "stone" }],
                  else: [],
                },
              },
            ],
          },
        },
      ],
    };
    expect(expectValid(json)).toBe(json);
  });

  it("must be an object", () => {
    expect(errors([])).toEqual(["program must be a JSON object, got []"]);
    expect(errors(null)).toEqual(["program must be a JSON object, got null"]);
  });

  it("needs size and build", () => {
    expect(errors({})).toEqual([
      "size: must be [width, height, depth] as positive integers, got undefined",
      "build: missing; expected a list of operations",
    ]);
    expect(errors({ size: [4, 4, 4], build: {} })).toEqual([
      "build: expected a list of operations, got {}",
    ]);
  });

  it("checks size", () => {
    for (const size of [
      [4, 4],
      [4, 0, 4],
      [4, 4.5, 4],
      ["4", 4, 4],
    ]) {
      expect(errors({ size, build: [] })).toEqual([
        `size: must be [width, height, depth] as positive integers, got ${JSON.stringify(size)}`,
      ]);
    }
  });

  it("limits size to 256 on each axis", () => {
    expectValid({ size: [256, 256, 256], build: [] });
    expect(MAX_BUILD_SIZE).toBe(256);
    expect(errors({ size: [257, 10, 300], build: [] })).toEqual([
      "size[0]: width (x) 257 is over the limit of 256 blocks per axis",
      "size[2]: depth (z) 300 is over the limit of 256 blocks per axis",
    ]);
    expect(errors({ size: [10, 512, 10], build: [] })).toEqual([
      "size[1]: height (y) 512 is over the limit of 256 blocks per axis",
    ]);
  });

  it("checks name, seed and unknown keys", () => {
    expect(
      errors({ size: [4, 4, 4], build: [], name: 3, seed: "x", sizes: 1 }),
    ).toEqual([
      "sizes: unknown program key 'sizes' (expected name, size, seed, palette, templates, build)",
      "name: must be a string, got 3",
      'seed: must be an integer, got "x"',
    ]);
  });

  it("checks the palette", () => {
    expect(
      errorsOf([], {
        palette: {
          wall: 3,
          roof: "",
          floor: { mix: {} },
          trim: { mix: { stone: 0, andesite: "1" } },
          "odd role": { mix: [] },
          glass: { mix: { glass: 1 }, extra: 1 },
        },
      }),
    ).toEqual([
      'palette.wall: material must be a string or {"mix": {...}}, got 3',
      "palette.roof: material must not be empty",
      "palette.floor.mix: mix must not be empty",
      "palette.trim.mix.stone: weight must be a positive number, got 0",
      'palette.trim.mix.andesite: weight must be a positive number, got "1"',
      'palette["odd role"].mix: must be an object of material → weight, got []',
      "palette.glass.extra: unknown key 'extra' (expected 'mix')",
    ]);
    expect(errorsOf([], { palette: ["stone"] })).toEqual([
      'palette: must be an object of role → material, got ["stone"]',
    ]);
  });

  it("checks templates", () => {
    expect(errorsOf([], { templates: [] })).toEqual([
      "templates: must be an object of template name → operations, got []",
    ]);
    expect(errorsOf([], { templates: { bay: [{ splt: 1 }] } })).toEqual([
      "templates.bay[0]: unknown operation 'splt' (known: box, split, repeat, inset, faces, fill, clear, frame, block, door, cylinder, ellipsoid, roof, use, choose, when)",
    ]);
  });
});

describe("validateProgram: operations", () => {
  it("reports errors at their program path", () => {
    const build = [
      { fill: "stone" },
      { clear: true },
      {
        box: {
          do: [
            {
              split: {
                axis: "y",
                parts: [{ size: 1 }, { size: "~x" }],
              },
            },
          ],
        },
      },
    ];
    expect(errorsOf(build)).toEqual([
      'build[2].box.do[0].split.parts[1].size: invalid size "~x" (use a non-negative integer, "N%", "~" or a weighted "~N")',
    ]);
  });

  it("reports every error, not just the first", () => {
    expect(
      errorsOf([
        { box: { do: [{ fill: "diamond_block" }, { splt: {} }] } },
        { fill: 4 },
      ]),
    ).toEqual([
      "build[0].box.do[1]: unknown operation 'splt' (known: box, split, repeat, inset, faces, fill, clear, frame, block, door, cylinder, ellipsoid, roof, use, choose, when)",
      "build[1].fill: expected a material or an object with 'material', got 4",
    ]);
  });

  it("needs exactly one key besides comments", () => {
    expect(
      errorsOf([
        { fill: "stone", clear: true },
        { "#": "nothing" },
        {},
        "fill",
        { "#": "a comment", "#2": "another", fill: "stone" },
      ]),
    ).toEqual([
      "build[0]: operation must have exactly one key (besides '#' comments), got 'fill', 'clear'",
      'build[1]: operation has no key; expected exactly one, like {"fill": ...}',
      'build[2]: operation has no key; expected exactly one, like {"fill": ...}',
      'build[3]: each operation must be an object like {"fill": ...}, got "fill"',
    ]);
  });

  it("ignores comment keys anywhere", () => {
    expectValid(
      program([
        {
          "#": "chimney",
          box: {
            "#": "flue",
            at: [1, 1, 1],
            size: [2, 2, 2],
            do: [
              {
                split: {
                  "#": "parts",
                  axis: "x",
                  parts: [{ "#": "p", size: 1 }],
                },
              },
              { faces: { "#": "f", sides: [] } },
              { inset: { by: { "#": "b", x: 1 }, do: [] } },
              {
                fill: {
                  "#": "m",
                  material: { "#": "x", mix: { "#": 1, a: 1 } },
                },
              },
              { block: { "#": "x", material: "a", state: { "#": [] } } },
            ],
          },
        },
      ]),
    );
  });

  it("checks priority and carve on any argument object", () => {
    expect(
      errorsOf([
        { box: { priority: 1.5, carve: "yes", do: [] } },
        { fill: { material: "stone", priority: "high" } },
        { clear: { carve: 1 } },
      ]),
    ).toEqual([
      "build[0].box.priority: must be an integer, got 1.5",
      'build[0].box.carve: must be true or false, got "yes"',
      'build[1].fill.priority: must be an integer, got "high"',
      "build[2].clear.carve: must be true or false, got 1",
    ]);
  });

  it("rejects unknown argument keys", () => {
    expect(errorsOf([{ box: { sizes: [1, 1, 1] } }])).toEqual([
      "build[0].box.sizes: unknown key 'sizes' (expected 'at', 'size', 'rotate', 'do', 'priority', 'carve')",
    ]);
  });

  it("checks nested operation lists", () => {
    expect(errorsOf([{ box: { do: { fill: "stone" } } }])).toEqual([
      'build[0].box.do: expected a list of operations, got {"fill":"stone"}',
    ]);
  });

  it("limits nesting depth", () => {
    let ops: unknown = [];
    for (let i = 0; i < 70; i++) ops = [{ box: { do: ops } }];
    const result = validateProgram(program(ops));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe(
        "operations nested more than 64 deep",
      );
    }
  });
});

describe("validateProgram: scope operations", () => {
  it("checks box", () => {
    expect(
      errorsOf([
        { box: [] },
        { box: { at: [0, 0], size: "~" } },
        {
          box: {
            at: [0, "~", "left"],
            size: [-1, "~2", "center"],
            rotate: 1.5,
          },
        },
      ]),
    ).toEqual([
      "build[0].box: expected an object with 'at', 'size', 'rotate' and 'do', got []",
      "build[1].box.at: must be a list of 3 values [x, y, z], got [0,0]",
      'build[1].box.size: must be a list of 3 values [x, y, z], got "~"',
      'build[2].box.at[1]: invalid position "~" (use an integer (negative counts from the far end), "N%", "center", "start" or "end")',
      'build[2].box.at[2]: invalid position "left" (use an integer (negative counts from the far end), "N%", "center", "start" or "end")',
      "build[2].box.size[0]: size -1 must not be negative",
      'build[2].box.size[1]: weighted size "~2" is only allowed for split parts; use "~"',
      'build[2].box.size[2]: invalid size "center" (use a non-negative integer, "N%" or "~")',
      "build[2].box.rotate: must be an integer, got 1.5",
    ]);
  });

  it("checks split", () => {
    expect(
      errorsOf([
        { split: {} },
        { split: { axis: "w", parts: [] } },
        { split: { axis: "x", parts: [3, { do: [] }, { size: 1, do: 2 }] } },
      ]),
    ).toEqual([
      "build[0].split: needs 'axis'",
      "build[0].split: needs 'parts'",
      'build[1].split.axis: must be one of "x", "y", "z", got "w"',
      "build[1].split.parts: must be a non-empty list, got []",
      "build[2].split.parts[0]: expected an object with 'size' and 'do', got 3",
      "build[2].split.parts[1]: each part needs a 'size'",
      "build[2].split.parts[2].do: expected a list of operations, got 2",
    ]);
  });

  it("checks repeat", () => {
    expect(
      errorsOf([
        { repeat: { axis: "x" } },
        {
          repeat: {
            axis: "y",
            every: 0,
            gap: -1,
            count: -2,
            margin: 1.5,
            align: "middle",
          },
        },
        { repeat: { axis: "x", every: 3, pattern: [] } },
        { repeat: { axis: "x", every: 3, pattern: [[], {}], first: 1 } },
      ]),
    ).toEqual([
      "build[0].repeat: needs 'every' or 'count'",
      "build[1].repeat.every: must be at least 1, got 0",
      "build[1].repeat.count: must be at least 0, got -2",
      "build[1].repeat.gap: must be at least 0, got -1",
      "build[1].repeat.margin: must be an integer, got 1.5",
      'build[1].repeat.align: must be one of "center", "start", "end", "stretch", got "middle"',
      "build[2].repeat.pattern: must be a non-empty list of operation lists, got []",
      "build[3].repeat.first: expected a list of operations, got 1",
      "build[3].repeat.pattern[1]: expected a list of operations, got {}",
    ]);
  });

  it("checks inset", () => {
    expect(
      errorsOf([
        { inset: {} },
        { inset: { by: "1" } },
        { inset: { by: { x: 1, up: 2, top: "2" } } },
        { inset: { by: -1 } },
        { inset: { by: { left: -2 } } },
      ]),
    ).toEqual([
      "build[0].inset: needs 'by'",
      'build[1].inset.by: must be an integer or an object of sides, got "1"',
      "build[2].inset.by: unknown side 'up' (expected x, y, z, left, right, front, back, top, bottom)",
      'build[2].inset.by.top: must be an integer, got "2"',
      "build[3].inset.by: must be at least 0, got -1",
      "build[4].inset.by.left: must be at least 0, got -2",
    ]);
  });

  it("checks faces", () => {
    expect(
      errorsOf([
        { faces: { roof: [], sides: {}, thickness: 0 } },
        { faces: "sides" },
      ]),
    ).toEqual([
      "build[0].faces.roof: unknown face 'roof' (expected sides, front, back, left, right, top, bottom, edges or thickness)",
      "build[0].faces.sides: expected a list of operations, got {}",
      "build[0].faces.thickness: must be at least 1, got 0",
      'build[1].faces: expected an object of face → operations, got "sides"',
    ]);
  });
});

describe("validateProgram: material operations", () => {
  it("checks fill and frame", () => {
    expect(
      errorsOf([
        { fill: {} },
        {
          fill: {
            material: "stone",
            replace: [],
            only_empty: "no",
            facing: "sideways",
            axis: "w",
            half: 1,
            state: { lit: null },
            hollow: true,
          },
        },
        { frame: { mix: "stone" } },
        { fill: { material: "glass", replace: [3] } },
        { fill: { material: "glass", state: [] } },
      ]),
    ).toEqual([
      "build[0].fill: missing 'material'",
      "build[1].fill.hollow: unknown key 'hollow' (expected 'material', 'replace', 'only_empty', 'facing', 'axis', 'half', 'state', 'priority', 'carve')",
      "build[1].fill.replace: must not be an empty list",
      'build[1].fill.only_empty: must be true or false, got "no"',
      'build[1].fill.facing: must be one of "+x", "-x", "+z", "-z", "up", "down", "in", "out", "left", "right", "front", "back", "north", "south", "east", "west", got "sideways"',
      'build[1].fill.axis: must be one of "x", "y", "z", got "w"',
      "build[1].fill.half: must be a string, got 1",
      "build[1].fill.state.lit: state value must be a string, number or boolean, got null",
      'build[2].frame.mix: must be an object of material → weight, got "stone"',
      'build[3].fill.replace[0]: material must be a string or {"mix": {...}}, got 3',
      "build[4].fill.state: must be an object of state → value, got []",
    ]);
  });

  it("checks clear", () => {
    expect(
      errorsOf([{ clear: false }, { clear: { material: "air" } }]),
    ).toEqual([
      "build[0].clear: expected true or an object with 'priority'/'carve', got false",
      "build[1].clear.material: unknown key 'material' (expected 'priority', 'carve')",
    ]);
  });

  it("checks block", () => {
    expect(
      errorsOf([{ block: "lantern" }, { block: { at: [0, 0, "~"] } }]),
    ).toEqual([
      'build[0].block: expected an object like {"material": ..., "at": [x, y, z]}, got "lantern"',
      "build[1].block: missing 'material'",
      'build[1].block.at[2]: invalid position "~" (use an integer (negative counts from the far end), "N%", "center", "start" or "end")',
    ]);
  });

  it("checks door", () => {
    expectValid(program([{ door: {} }, { door: "@door:door" }]));
    expect(
      errorsOf([
        { door: { x: -1, hinge: "middle", material: 2 } },
        { door: 1 },
      ]),
    ).toEqual([
      'build[0].door.material: material must be a string or {"mix": {...}}, got 2',
      "build[0].door.x: must be at least 0, got -1",
      'build[0].door.hinge: must be one of "left", "right", got "middle"',
      "build[1].door: expected a material or an object with 'material', got 1",
    ]);
  });

  it("checks cylinder and ellipsoid", () => {
    expect(
      errorsOf([
        { cylinder: { material: "stone", hollow: 1, thickness: 0 } },
        { ellipsoid: [] },
      ]),
    ).toEqual([
      "build[0].cylinder.hollow: must be true or false, got 1",
      "build[0].cylinder.thickness: must be at least 1, got 0",
      "build[1].ellipsoid: expected a material or an object with 'material', got []",
    ]);
  });

  it("checks roofs (the rest is in roofs.test.ts)", () => {
    expectValid(
      program([
        { roof: "cone" },
        {
          roof: {
            type: "gable",
            material: "@roof",
            pitch: 0.5,
            overhang: { all: 1, left: 0 },
            ridge: "auto",
            gable: false,
            height: 4,
            solid: true,
            break: 0.25,
            priority: 2,
          },
        },
      ]),
    );
    expect(
      errorsOf([{ roof: 1 }, { roof: { type: "gable", anything: 1 } }]),
    ).toEqual([
      "build[0].roof: expected a roof type or an object, got 1",
      "build[1].roof.anything: unknown key 'anything' (expected 'type', 'material', 'pitch', 'overhang', 'ridge', 'gable', 'height', 'solid', 'break', 'priority', 'carve')",
    ]);
  });
});

describe("validateProgram: composition", () => {
  const templates = { bay: [{ fill: "@wall" }] };

  it("checks use", () => {
    expect(
      errorsOf(
        [
          { use: "door_bay" },
          { use: { with: {} } },
          { use: { name: "bay", with: [] } },
          { use: 3 },
        ],
        { templates },
      ),
    ).toEqual([
      "build[0].use: unknown template 'door_bay' (defined: bay)",
      "build[1].use: missing 'name'",
      "build[2].use.with: must be an object of parameter → value, got []",
      'build[3].use: expected a template name or {"name": ..., "with": {...}}, got 3',
    ]);
    expect(errorsOf([{ use: "bay" }])).toEqual([
      "build[0].use: unknown template 'bay' (defined: none)",
    ]);
  });

  it("checks choose", () => {
    expect(
      errorsOf([
        { choose: [] },
        { choose: { options: [[], {}], weights: [1] } },
        { choose: { options: [[], []], weights: [-1, "2"] } },
        { choose: { options: [[]], weights: [0] } },
      ]),
    ).toEqual([
      "build[0].choose: needs a non-empty list of options, got []",
      "build[1].choose.options[1]: expected a list of operations, got {}",
      "build[1].choose.weights: must be a list of 2 numbers, one per option, got [1]",
      "build[2].choose.weights[0]: must be a non-negative number, got -1",
      'build[2].choose.weights[1]: must be a non-negative number, got "2"',
      "build[3].choose.weights: at least one weight must be positive",
    ]);
  });

  it("checks when", () => {
    expect(
      errorsOf([{ when: { min: [5, null], max: [null, -1, "a"], else: 1 } }]),
    ).toEqual([
      "build[0].when.min: must be a list of 3 values [x, y, z], got [5,null]",
      "build[0].when.max[1]: must be at least 0, got -1",
      'build[0].when.max[2]: must be an integer, got "a"',
      "build[0].when.else: expected a list of operations, got 1",
    ]);
  });

  it("accepts parameters anywhere in template bodies", () => {
    expectValid(
      program([{ use: { name: "t", with: { face: "front", mat: "gold" } } }], {
        templates: {
          t: [
            { faces: { $face: [{ fill: "$mat" }], thickness: "$t" } },
            { box: { at: ["$x", 0, 0], size: "$size", do: "$body" } },
            { split: { axis: "$axis", parts: [{ size: "$w" }, "$part"] } },
            { fill: { material: "${wood}_planks", state: { facing: "$f" } } },
            { use: "$inner" },
            { $op: { anything: true } },
            "$op",
          ],
        },
      }),
    );
  });

  it("checks template bodies outside parameters", () => {
    expect(
      errorsOf([], {
        templates: { t: [{ box: { at: ["$x", "~", 0] } }] },
      }),
    ).toEqual([
      'templates.t[0].box.at[1]: invalid position "~" (use an integer (negative counts from the far end), "N%", "center", "start" or "end")',
    ]);
  });

  it("treats $ literally outside templates", () => {
    expect(errorsOf([{ box: { at: ["$x", 0, 0] } }])).toEqual([
      'build[0].box.at[0]: invalid position "$x" (use an integer (negative counts from the far end), "N%", "center", "start" or "end")',
    ]);
  });
});
