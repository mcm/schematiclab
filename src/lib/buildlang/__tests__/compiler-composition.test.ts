import { describe, expect, it } from "vitest";
import { compileWithRegistry } from "../compiler";
import type { Operations, Program, Vec3 } from "../program";
import { MAX_TEMPLATE_DEPTH, substituteParams } from "../templates";
import { compile, messages, registry, run } from "./compile-harness";

/** Compiles without the static check (as a template's substituted body would arrive). */
function raw(program: Record<string, unknown>) {
  return compileWithRegistry(program as unknown as Program, registry);
}

describe("use", () => {
  it("substitutes $ keys and values (Cairn test_template_params_keys_and_values)", () => {
    const templates = { t: [{ faces: { $face: [{ fill: "$mat" }] } }] };
    const b = run(
      [{ use: { name: "t", with: { face: "front", mat: "iron_block" } } }],
      [3, 2, 3],
      {},
      { templates },
    );
    expect(new Set(b.cells.map(([, , z]) => z))).toEqual(new Set([2]));
    expect(new Set(b.cells.map(([, , , id]) => id))).toEqual(
      new Set(["iron_block"]),
    );
  });

  it("runs a template by name in the current scope", () => {
    const b = run(
      [{ box: { at: [1, 0, 1], size: [1, 1, 1], do: [{ use: "mark" }] } }],
      [3, 1, 3],
      {},
      { templates: { mark: [{ fill: "stone" }] } },
    );
    expect(b.cells).toEqual([[1, 0, 1, "stone"]]);
  });

  it("substitutes ${param} inside longer strings", () => {
    const b = run(
      [
        {
          use: {
            name: "t",
            with: { wood: "spruce", role: "trim", n: 1 },
          },
        },
      ],
      [2, 1, 1],
      { trim: "bricks" },
      {
        templates: {
          t: [
            {
              split: {
                axis: "x",
                parts: [
                  { size: "$n", do: [{ fill: "${wood}_planks" }] },
                  { size: "~", do: [{ fill: "@${role}" }] },
                ],
              },
            },
          ],
        },
      },
    );
    expect(b.at(0, 0, 0)).toBe("spruce_planks");
    expect(b.at(1, 0, 0)).toBe("bricks");
  });

  it("passes any JSON value through a whole $param, and leaves # comments alone", () => {
    const b = run(
      [
        {
          use: {
            name: "t",
            with: { size: [1, 1, 1], ops: [{ fill: "stone" }] },
          },
        },
      ],
      [3, 1, 1],
      {},
      {
        templates: {
          t: [{ "#": "$unused", box: { size: "$size", do: "$ops" } }],
        },
      },
    );
    expect(b.cells).toEqual([[0, 0, 0, "stone"]]);
  });

  it("passes parameters on through nested templates", () => {
    const b = run(
      [{ use: { name: "outer", with: { mat: "bricks" } } }],
      [1, 1, 1],
      {},
      {
        templates: {
          outer: [{ use: { name: "inner", with: { m: "$mat" } } }],
          inner: [{ fill: "$m" }],
        },
      },
    );
    expect(b.at(0, 0, 0)).toBe("bricks");
  });

  it("reports an unknown template at the use, listing the defined ones", () => {
    const b = raw({
      size: [1, 1, 1],
      templates: { a: [], b: [] },
      build: [{ use: { name: "nope" } }],
    });
    expect(messages(b.errors)).toEqual([
      "build[0].use: unknown template 'nope' (defined: a, b)",
    ]);
    // a template name passed as a parameter is only known at compile time
    const c = compile(
      [{ use: { name: "pick", with: { which: "missing" } } }],
      [1, 1, 1],
      {},
      { templates: { pick: [{ use: "$which" }] } },
    );
    expect(messages(c.errors)).toEqual([
      "templates.pick[0].use: unknown template 'missing' (defined: pick) (in a template used at build[0].use)",
    ]);
  });

  it("reports a missing parameter at the place that uses it, and doesn't run the body", () => {
    const templates = {
      t: [
        { fill: "$mat" },
        { faces: { $face: [{ fill: "stone" }] } },
        { fill: "${wood}_planks" },
      ],
    };
    const b = compile([{ use: "t" }], [2, 2, 2], {}, { templates });
    expect(messages(b.errors)).toEqual([
      `templates.t[0].fill: missing parameter 'mat' (pass it in the use's "with") (in a template used at build[0].use)`,
      `templates.t[1].faces["$face"]: missing parameter 'face' (pass it in the use's "with") (in a template used at build[0].use)`,
      `templates.t[2].fill: missing parameter 'wood' (pass it in the use's "with") (in a template used at build[0].use)`,
    ]);
    expect(b.cells).toEqual([]);
  });

  it("reports parameters of the wrong type for keys and text", () => {
    const templates = {
      t: [{ faces: { $face: [{ fill: "${mat}_planks" }] } }],
    };
    const b = compile(
      [{ use: { name: "t", with: { face: 3, mat: ["oak"] } } }],
      [2, 2, 2],
      {},
      { templates },
    );
    expect(messages(b.errors)).toEqual([
      "templates.t[0].faces[\"$face\"]: parameter 'face' is used as a key, so it must be a string, got 3 (in a template used at build[0].use)",
      'templates.t[0].faces["$face"][0].fill: parameter \'mat\' is used inside text, so it must be a string or number, got ["oak"] (in a template used at build[0].use)',
    ]);
  });

  it("checks the substituted body like the rest of the program", () => {
    const templates = { t: [{ faces: { $face: [{ fill: "stone" }] } }] };
    const b = compile(
      [{ use: { name: "t", with: { face: "frnt" } } }],
      [2, 2, 2],
      {},
      { templates },
    );
    expect(messages(b.errors)).toEqual([
      "templates.t[0].faces.frnt: unknown face 'frnt' (expected sides, front, back, left, right, top, bottom, edges or thickness) (in a template used at build[0].use)",
    ]);
    expect(b.cells).toEqual([]);
  });

  it("reports problems inside a template at its path, once per use site", () => {
    const b = compile(
      [
        {
          repeat: {
            axis: "x",
            every: 1,
            do: [{ use: { name: "t", with: { mat: "diamond_blok" } } }],
          },
        },
      ],
      [4, 1, 1],
      {},
      { templates: { t: [{ fill: "$mat" }] } },
    );
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0].path).toBe("templates.t[0].fill");
    expect(b.errors[0].message).toContain(
      "(in a template used at build[0].repeat.do[0].use) (x4)",
    );
  });

  it("warns about parameters the template doesn't use", () => {
    const b = run(
      [{ use: { name: "t", with: { mat: "stone", colour: "red" } } }],
      [1, 1, 1],
      {},
      { templates: { t: [{ fill: "$mat" }] } },
    );
    expect(messages(b.warnings)).toEqual([
      "build[0].use.with.colour: template 't' has no parameter 'colour'",
    ]);
  });

  it(`allows ${MAX_TEMPLATE_DEPTH} nested templates and rejects one more`, () => {
    const chain = (n: number) => {
      const templates: Record<string, unknown> = {};
      for (let i = 0; i < n - 1; i++)
        templates[`t${i}`] = [{ use: `t${i + 1}` }];
      templates[`t${n - 1}`] = [{ fill: "stone" }];
      return templates;
    };
    const ok = run(
      [{ use: "t0" }],
      [1, 1, 1],
      {},
      {
        templates: chain(MAX_TEMPLATE_DEPTH),
      },
    );
    expect(ok.at(0, 0, 0)).toBe("stone");
    const deep = compile(
      [{ use: "t0" }],
      [1, 1, 1],
      {},
      {
        templates: chain(MAX_TEMPLATE_DEPTH + 1),
      },
    );
    expect(messages(deep.errors)).toEqual([
      `templates.t${MAX_TEMPLATE_DEPTH - 1}[0].use: templates nested more than 32 deep (does 't${MAX_TEMPLATE_DEPTH}' use itself?) (in a template used at build[0].use)`,
    ]);
    expect(deep.cells).toEqual([]);
  });

  it("stops a template that uses itself", () => {
    const b = compile(
      [{ use: "loop" }],
      [1, 1, 1],
      {},
      {
        templates: { loop: [{ fill: "stone" }, { use: "loop" }] },
      },
    );
    expect(messages(b.errors)).toEqual([
      "templates.loop[1].use: templates nested more than 32 deep (does 'loop' use itself?) (in a template used at build[0].use)",
    ]);
    expect(b.at(0, 0, 0)).toBe("stone");
  });

  it("rejects malformed use arguments at compile time", () => {
    const b = raw({
      size: [1, 1, 1],
      templates: { t: [] },
      build: [{ use: 3 }, { use: { name: "t", with: [1] } }],
    });
    expect(messages(b.errors)).toEqual([
      'build[0].use: expected a template name or {"name": ..., "with": {...}}, got 3',
      "build[1].use.with: must be an object of parameter → value, got [1]",
    ]);
  });
});

describe("substituteParams", () => {
  it("leaves numbers, booleans and null alone and substitutes null values", () => {
    const out = substituteParams(
      [{ a: 1, b: true, c: null, d: "$x" }],
      { x: null },
      "templates.t",
    );
    expect(out).toEqual({
      body: [{ a: 1, b: true, c: null, d: null }],
      errors: [],
      used: new Set(["x"]),
    });
  });
});

describe("choose", () => {
  it("picks one of the options (Cairn test_when_and_choose)", () => {
    const b = run(
      [
        {
          choose: {
            options: [[{ fill: "stone" }], [{ fill: "cobblestone" }]],
          },
        },
      ],
      [2, 1, 1],
    );
    expect(["stone", "cobblestone"]).toContain(b.at(0, 0, 0));
    expect(b.at(1, 0, 0)).toBe(b.at(0, 0, 0));
  });

  const tiles = (weights?: number[], seed = 0, list = false) => {
    const options = [[{ fill: "stone" }], [{ fill: "cobblestone" }]];
    const choose = list ? options : { options, ...(weights && { weights }) };
    return run(
      [{ repeat: { axis: "x", every: 1, do: [{ choose }] } }],
      [200, 1, 1],
      {},
      { seed },
    ).cells.map(([, , , id]) => id);
  };

  it("is deterministic for a program and seed, and varies with the seed", () => {
    expect(tiles(undefined, 7)).toEqual(tiles(undefined, 7));
    expect(tiles(undefined, 7)).not.toEqual(tiles(undefined, 8));
    expect(tiles(undefined, 0, true)).toEqual(tiles(undefined, 0));
  });

  it("follows the weights", () => {
    const share = (ids: string[]) =>
      ids.filter((id) => id === "stone").length / ids.length;
    expect(share(tiles([1, 0]))).toBe(1);
    expect(share(tiles([0, 1]))).toBe(0);
    const s = share(tiles([3, 1]));
    expect(s).toBeGreaterThan(0.65);
    expect(s).toBeLessThan(0.85);
    const even = share(tiles());
    expect(even).toBeGreaterThan(0.38);
    expect(even).toBeLessThan(0.62);
  });

  it("reports at the chosen option's path", () => {
    const b = compile(
      [{ choose: { options: [[{ fill: "nope_blok" }]] } }],
      [1, 1, 1],
    );
    expect(b.errors.map((e) => e.path)).toEqual([
      "build[0].choose.options[0][0].fill",
    ]);
  });

  it("rejects bad options and weights at compile time", () => {
    const b = raw({
      size: [1, 1, 1],
      build: [
        { choose: [] },
        { choose: { options: [[], []], weights: [1] } },
        { choose: { options: [[]], weights: [0] } },
      ],
    });
    expect(messages(b.errors)).toEqual([
      "build[0].choose: needs a non-empty list of options, got []",
      "build[1].choose.weights: must be a list of 2 non-negative numbers, one per option, at least one positive, got [1]",
      "build[2].choose.weights: must be a list of 1 non-negative numbers, one per option, at least one positive, got [0]",
    ]);
  });
});

describe("when", () => {
  type Bound = Vec3<number | null>;
  const program = (min?: Bound, max?: Bound): Operations => [
    {
      when: {
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max }),
        do: [{ fill: "stone" }],
        else: [{ fill: "cobblestone" }],
      },
    },
  ];

  it("branches on the scope's size (Cairn test_when_and_choose)", () => {
    expect(run(program([5, null, null]), [4, 1, 1]).at(0, 0, 0)).toBe(
      "cobblestone",
    );
    expect(run(program([5, null, null]), [5, 1, 1]).at(0, 0, 0)).toBe("stone");
  });

  it("checks min and max on every axis", () => {
    expect(
      run(program(undefined, [null, 2, null]), [3, 2, 3]).at(0, 0, 0),
    ).toBe("stone");
    expect(
      run(program(undefined, [null, 2, null]), [3, 3, 3]).at(0, 0, 0),
    ).toBe("cobblestone");
    expect(run(program([1, 1, 4], [9, 9, 9]), [3, 3, 3]).at(0, 0, 0)).toBe(
      "cobblestone",
    );
    expect(run(program([3, 3, 3], [3, 3, 3]), [3, 3, 3]).at(0, 0, 0)).toBe(
      "stone",
    );
    expect(run(program(), [3, 3, 3]).at(0, 0, 0)).toBe("stone");
  });

  it("uses the scope's own axes, and does nothing without the branch", () => {
    // a 3×1×1 box rotated a quarter turn is 3 long in its own x
    const b = run(
      [
        {
          box: {
            size: [3, 1, 1],
            rotate: 1,
            do: [{ when: { min: [3, null, null], do: [{ fill: "stone" }] } }],
          },
        },
        {
          box: {
            at: [2, 0, 0],
            size: [1, 1, 1],
            do: [{ when: { min: [2, 1, 1], do: [{ fill: "stone" }] } }],
          },
        },
      ],
      [3, 1, 3],
    );
    expect(b.cells.map(([x, , z]) => [x, z])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
  });

  it("reports at do/else paths and rejects bad bounds", () => {
    const b = compile(
      [{ when: { min: [9, null, null], else: [{ fill: "nope_blok" }] } }],
      [1, 1, 1],
    );
    expect(b.errors.map((e) => e.path)).toEqual(["build[0].when.else[0].fill"]);
    const c = raw({
      size: [1, 1, 1],
      build: [{ when: { min: [1, 2] } }, { when: "x" }],
    });
    expect(messages(c.errors)).toEqual([
      "build[0].when.min: must be [x, y, z] of integers or null, got [1,2]",
      `build[1].when: expected an object with 'min'/'max', 'do' and 'else', got "x"`,
    ]);
  });
});
