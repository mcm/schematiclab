import { describe, expect, it } from "vitest";
import { compileProgram } from "../compiler";
import { type Operations, type Program } from "../program";
import {
  type Built,
  compile,
  messages,
  registry,
  run,
} from "./compile-harness";

const xsOf = (built: Built, id: string) =>
  [...new Set(built.cells.filter((c) => c[3] === id).map((c) => c[0]))].sort(
    (a, b) => a - b,
  );

describe("box", () => {
  it("defaults to the whole parent", () => {
    const b = run([{ box: { do: [{ fill: "stone" }] } }], [3, 2, 2]);
    expect(b.cells).toHaveLength(12);
  });

  it("places a child at `at` with `size`, and '~' is the rest after `at`", () => {
    const b = run(
      [
        {
          box: { at: [1, 0, 2], size: [2, "~", "~"], do: [{ fill: "stone" }] },
        },
      ],
      [5, 2, 4],
    );
    expect(b.cells.map(([x, y, z]) => [x, y, z]).sort()).toEqual(
      [
        [1, 0, 2],
        [2, 0, 2],
        [1, 0, 3],
        [2, 0, 3],
        [1, 1, 2],
        [2, 1, 2],
        [1, 1, 3],
        [2, 1, 3],
      ].sort(),
    );
  });

  it("aligns with center/start/end, percentages and negative positions", () => {
    const one = (at: unknown[], size: unknown[]) =>
      run(
        [{ box: { at, size, do: [{ fill: "stone" }] } } as never],
        [9, 1, 1],
      ).cells.map((c) => c[0]);
    expect(one(["center", 0, 0], [3, 1, 1])).toEqual([3, 4, 5]);
    expect(one(["end", 0, 0], [2, 1, 1])).toEqual([7, 8]);
    expect(one(["start", 0, 0], [2, 1, 1])).toEqual([0, 1]);
    expect(one([-1, 0, 0], [1, 1, 1])).toEqual([8]);
    expect(one([-3, 0, 0], ["~", 1, 1])).toEqual([6, 7, 8]);
    expect(one(["50%", 0, 0], ["~", 1, 1])).toEqual([4, 5, 6, 7, 8]);
    expect(one([0, 0, 0], ["100%", 1, 1])).toHaveLength(9);
    // an aligned "~" takes the whole parent
    expect(one(["center", 0, 0], ["~", 1, 1])).toHaveLength(9);
  });

  it("keeps a rotated child's footprint at `at`, size in its own axes", () => {
    // rotate 1: a wing 7 wide (world x) and 9 deep (world z) is size [9, h, 7]
    const b = run(
      [
        {
          box: {
            at: [2, 0, 1],
            size: [9, 1, 7],
            rotate: 1,
            do: [{ fill: "stone" }],
          },
        },
      ],
      [12, 1, 12],
    );
    const xs = b.cells.map((c) => c[0]);
    const zs = b.cells.map((c) => c[2]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([2, 8]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([1, 9]);
  });

  it("turns the child's front: rotate 1 faces west, 2 north, 3 east", () => {
    const frontAt = (rotate: number) =>
      run(
        [
          {
            box: {
              size: [5, 1, 5],
              rotate,
              do: [{ faces: { front: [{ fill: "bricks" }] } }],
            },
          },
        ],
        [5, 1, 5],
      ).cells.map(([x, , z]) => [x, z]);
    expect(new Set(frontAt(0).map(([, z]) => z))).toEqual(new Set([4]));
    expect(new Set(frontAt(1).map(([x]) => x))).toEqual(new Set([0]));
    expect(new Set(frontAt(2).map(([, z]) => z))).toEqual(new Set([0]));
    expect(new Set(frontAt(3).map(([x]) => x))).toEqual(new Set([4]));
  });

  it("does nothing for an empty child", () => {
    const b = run(
      [
        { box: { at: [3, 0, 0], size: [0, 1, 1], do: [{ fill: "stone" }] } },
        { box: { at: [5, 0, 0], do: [{ fill: "stone" }] } },
      ],
      [3, 1, 1],
    );
    expect(b.cells).toEqual([]);
  });

  it("reports bad lengths at their path", () => {
    const b = compile(
      [{ box: { size: [1, 1, 1], do: [{ fill: "stone" }] } }],
      [2, 2, 2],
    );
    expect(b.errors).toEqual([]);
    const bad = compileProgram(
      {
        size: [2, 2, 2],
        build: [{ box: { at: [0, "x", 0], do: [{ fill: "stone" }] } }],
      } as unknown as Program,
      registry,
    );
    expect(messages(bad.errors)).toEqual([
      expect.stringMatching(/^build\[0\]\.box\.at\[1\]: invalid position "x"/),
    ]);
  });
});

describe("split", () => {
  // Cairn's test_split_weights_and_repeat_count
  it("shares the rest by weight", () => {
    const b = run(
      [
        {
          split: {
            axis: "x",
            parts: [
              { size: 2, do: [{ fill: "stone" }] },
              { size: "~2", do: [{ fill: "cobblestone" }] },
              { size: "~", do: [{ fill: "terracotta" }] },
            ],
          },
        },
      ],
      [11, 1, 1],
    );
    expect(Array.from({ length: 11 }, (_, x) => b.at(x, 0, 0))).toEqual([
      ...Array(2).fill("stone"),
      ...Array(6).fill("cobblestone"),
      ...Array(3).fill("terracotta"),
    ]);
  });

  it("splits y with percentages, and a part without `do` reserves space", () => {
    const b = run(
      [
        {
          split: {
            axis: "y",
            parts: [
              { size: "25%", do: [{ fill: "stone" }] },
              { size: 1 },
              { size: "~", do: [{ fill: "cobblestone" }] },
            ],
          },
        },
      ],
      [1, 8, 1],
    );
    expect(Array.from({ length: 8 }, (_, y) => b.at(0, y, 0))).toEqual([
      "stone",
      "stone",
      "air",
      ...Array(5).fill("cobblestone"),
    ]);
  });

  it("splits along the scope's own axes", () => {
    const b = run(
      [
        {
          box: {
            size: [3, 1, 2],
            rotate: 1,
            do: [
              {
                split: {
                  axis: "x",
                  parts: [{ size: 1, do: [{ fill: "stone" }] }, { size: "~" }],
                },
              },
            ],
          },
        },
      ],
      [2, 1, 3],
    );
    // the child's +x is world +z, and its footprint starts at world (0, 0)
    expect(b.cells.map(([x, , z]) => [x, z]).sort()).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("warns and cuts trailing parts when fixed sizes overflow", () => {
    const b = run(
      [
        {
          split: {
            axis: "x",
            parts: [
              { size: 3, do: [{ fill: "stone" }] },
              { size: 3, do: [{ fill: "cobblestone" }] },
              { size: "~", do: [{ fill: "terracotta" }] },
            ],
          },
        },
      ],
      [4, 1, 1],
    );
    expect(Array.from({ length: 4 }, (_, x) => b.at(x, 0, 0))).toEqual([
      "stone",
      "stone",
      "stone",
      "cobblestone",
    ]);
    expect(messages(b.warnings)).toEqual([
      "build[0].split: fixed part sizes (6) exceed the available 4; trailing parts were cut",
    ]);
  });
});

describe("repeat", () => {
  const tiles = (repeat: Record<string, unknown>, length: number) =>
    run(
      [{ repeat: { axis: "x", ...repeat, do: [{ fill: "stone" }] } } as never],
      [length, 1, 1],
    );

  it("fits ⌊(L − 2·margin + gap) / (every + gap)⌋ tiles", () => {
    for (const [L, every, gap, margin] of [
      [13, 3, 1, 0],
      [20, 2, 3, 1],
      [7, 7, 0, 0],
      [6, 7, 0, 0],
      [17, 1, 2, 3],
    ]) {
      const expected = Math.max(
        0,
        Math.floor((L - 2 * margin + gap) / (every + gap)),
      );
      const b = tiles({ every, gap, margin }, L);
      expect(b.cells).toHaveLength(expected * every);
    }
  });

  it("centres the tiles, splitting the leftover between the ends", () => {
    // 3 tiles of 2 with gap 1 use 8 of 10: 1 block each side
    expect(xsOf(tiles({ every: 2, gap: 1 }, 10), "stone")).toEqual([
      1, 2, 4, 5, 7, 8,
    ]);
  });

  it("warns when the leftover is odd", () => {
    const b = tiles({ every: 2, gap: 1 }, 9);
    expect(xsOf(b, "stone")).toEqual([0, 1, 3, 4, 6, 7]);
    expect(messages(b.warnings)).toEqual([
      "build[0].repeat: tiles cannot be exactly centred (odd leftover space 1); change 'every' or 'gap' by 1 for perfect symmetry",
    ]);
    // like Cairn, only between several tiles with gaps
    expect(tiles({ every: 2 }, 11).warnings).toEqual([]);
    expect(tiles({ every: 2, gap: 1 }, 3).warnings).toEqual([]);
  });

  it("aligns at the start or end, respecting the margin", () => {
    expect(
      xsOf(tiles({ every: 1, gap: 1, align: "start" }, 6), "stone"),
    ).toEqual([0, 2, 4]);
    expect(
      xsOf(tiles({ every: 1, gap: 1, align: "start", margin: 1 }, 7), "stone"),
    ).toEqual([1, 3, 5]);
    expect(xsOf(tiles({ every: 1, gap: 1, align: "end" }, 6), "stone")).toEqual(
      [1, 3, 5],
    );
    expect(
      xsOf(tiles({ every: 1, gap: 2, align: "end", margin: 1 }, 9), "stone"),
    ).toEqual([1, 4, 7]);
  });

  it("stretches tiles to fill the space between the margins", () => {
    const b = run(
      [
        {
          repeat: {
            axis: "x",
            every: 3,
            gap: 1,
            margin: 1,
            align: "stretch",
            pattern: [[{ fill: "stone" }], [{ fill: "cobblestone" }]],
          },
        },
      ],
      [12, 1, 1],
    );
    // 2 tiles fit (⌊(10 + 1) / 4⌋); they share 10 − 1 = 9 blocks
    expect(Array.from({ length: 12 }, (_, x) => b.at(x, 0, 0))).toEqual([
      "air",
      ...Array(5).fill("stone"),
      "air",
      ...Array(4).fill("cobblestone"),
      "air",
    ]);
  });

  it("forces a count, sizing tiles to fit when `every` is missing", () => {
    expect(xsOf(tiles({ count: 2, every: 1, gap: 2 }, 10), "stone")).toEqual([
      3, 6,
    ]);
    // ⌊(10 − 2·1) / 3⌋ = 2 blocks a tile, 8 used, 1 each side
    expect(xsOf(tiles({ count: 3, gap: 1 }, 10), "stone")).toEqual([
      1, 2, 4, 5, 7, 8,
    ]);
    expect(tiles({ count: 0, every: 1 }, 5).cells).toEqual([]);
  });

  it("cycles `pattern` and gives `first`, `last` and `ends` their tiles", () => {
    const names = (repeat: Record<string, unknown>) => {
      const b = run(
        [{ repeat: { axis: "x", every: 1, ...repeat } } as never],
        [6, 1, 1],
      );
      return Array.from({ length: 6 }, (_, x) => b.at(x, 0, 0));
    };
    const s = [{ fill: "stone" }];
    const d = [{ fill: "cobblestone" }];
    const g = [{ fill: "bricks" }];
    expect(names({ pattern: [s, d] })).toEqual([
      "stone",
      "cobblestone",
      "stone",
      "cobblestone",
      "stone",
      "cobblestone",
    ]);
    expect(names({ do: s, ends: d })).toEqual([
      "cobblestone",
      "stone",
      "stone",
      "stone",
      "stone",
      "cobblestone",
    ]);
    expect(names({ do: s, ends: d, first: g })).toEqual([
      "bricks",
      "stone",
      "stone",
      "stone",
      "stone",
      "cobblestone",
    ]);
    expect(names({ pattern: [s, d], last: g })).toEqual([
      "stone",
      "cobblestone",
      "stone",
      "cobblestone",
      "stone",
      "bricks",
    ]);
  });

  it("tiles along y and z too", () => {
    const b = run(
      [
        { repeat: { axis: "y", every: 1, gap: 1, do: [{ fill: "stone" }] } },
        {
          repeat: {
            axis: "z",
            every: 1,
            gap: 2,
            do: [{ fill: "cobblestone" }],
          },
        },
      ],
      [1, 5, 4],
    );
    expect(Array.from({ length: 5 }, (_, y) => b.at(0, y, 1))).toEqual([
      "stone",
      "air",
      "stone",
      "air",
      "stone",
    ]);
    expect(Array.from({ length: 4 }, (_, z) => b.at(0, 1, z))).toEqual([
      "cobblestone",
      "air",
      "air",
      "cobblestone",
    ]);
  });
});

describe("the bay idiom (SPEC.md section 5)", () => {
  // Cairn's test_bay_idiom_is_symmetric
  const facade: Operations = [
    { fill: "stone" },
    { repeat: { axis: "x", every: 1, gap: 3, do: [{ fill: "oak_log" }] } },
    {
      box: {
        at: [0, 1, 0],
        size: ["100%", 3, 1],
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
                    do: [{ fill: "glass_pane" }],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ];

  it("puts posts at 0, 4, 8, 12 and windows at 2, 6, 10 on a face 13 wide", () => {
    const b = run([{ faces: { front: facade } }], [13, 4, 3]);
    const posts = b.cells
      .filter(([, y, z, id]) => id === "oak_log" && y === 0 && z === 2)
      .map(([x]) => x)
      .sort((a, b) => a - b);
    expect(posts).toEqual([0, 4, 8, 12]);
    expect(xsOf(b, "glass_pane")).toEqual([2, 6, 10]);
    expect(b.warnings).toEqual([]);
  });

  it("is symmetric for every width 4k + 1", () => {
    for (const W of [9, 13, 17, 21]) {
      const b = run([{ faces: { front: facade } }], [W, 4, 3]);
      const posts = b.cells
        .filter(([, y, z, id]) => id === "oak_log" && y === 0 && z === 2)
        .map(([x]) => x)
        .sort((a, b) => a - b);
      const every4 = (from: number) =>
        Array.from(
          { length: Math.ceil((W - from) / 4) },
          (_, i) => from + 4 * i,
        );
      expect(posts).toEqual(every4(0));
      expect(xsOf(b, "glass_pane")).toEqual(every4(2));
      expect(b.warnings).toEqual([]);
    }
  });
});

describe("inset", () => {
  it("insets x and z on both sides, leaving y", () => {
    const b = run([{ inset: { by: 1, do: [{ fill: "stone" }] } }], [4, 2, 5]);
    const xs = b.cells.map((c) => c[0]);
    const ys = b.cells.map((c) => c[1]);
    const zs = b.cells.map((c) => c[2]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([1, 2]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 1]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([1, 3]);
  });

  it("insets per side; x, y and z set both ends", () => {
    const bounds = (by: Record<string, number>) => {
      const b = run(
        [{ inset: { by, do: [{ fill: "stone" }] } } as never],
        [6, 6, 6],
      );
      return [0, 1, 2].map((i) => {
        const v = b.cells.map((c) => c[i] as number);
        return [Math.min(...v), Math.max(...v)];
      });
    };
    // left −x, right +x, back −z, front +z, bottom −y, top +y
    expect(
      bounds({ left: 1, right: 2, back: 3, front: 1, bottom: 2, top: 1 }),
    ).toEqual([
      [1, 3],
      [2, 4],
      [3, 4],
    ]);
    expect(bounds({ x: 1, y: 2, z: 0 })).toEqual([
      [1, 4],
      [2, 3],
      [0, 5],
    ]);
    expect(bounds({ y: 1, top: 0 })).toEqual([
      [0, 5],
      [1, 5],
      [0, 5],
    ]);
  });

  it("follows the scope's orientation", () => {
    // in a face scope, left/right run along the wall and front/back across it
    const b = run(
      [
        {
          faces: {
            thickness: 3,
            front: [
              { inset: { by: { left: 1, back: 2 }, do: [{ fill: "stone" }] } },
            ],
          },
        },
      ],
      [4, 1, 4],
    );
    // the front face's local x is world +x, its local z (inward) world −z;
    // `back` trims local z = 0 (the outer surface)
    expect(b.cells.map(([x, , z]) => [x, z]).sort()).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
  });

  it("warns when nothing is left", () => {
    const b = run([{ inset: { by: 2, do: [{ fill: "stone" }] } }], [4, 1, 9]);
    expect(b.cells).toEqual([]);
    expect(messages(b.warnings)).toEqual([
      "build[0].inset: inset leaves nothing (scope [4,1,9])",
    ]);
  });
});

describe("faces", () => {
  // Cairn's test_front_is_plus_z_and_face_axes, with a 1×1×1 box per mark
  it("runs the front face on +z, faces' x left to right seen from outside", () => {
    const mark = (id: string): Operations => [
      { box: { at: [0, 0, 0], size: [1, 1, 1], do: [{ fill: id }] } },
    ];
    const b = run(
      [
        {
          faces: {
            front: mark("bricks"),
            back: mark("iron_block"),
            left: mark("quartz_block"),
            right: mark("hay_block"),
          },
        },
      ],
      [5, 3, 4],
    );
    expect(b.at(0, 0, 3)).toBe("bricks"); // front = z max, local x0 = west end
    expect(b.at(4, 0, 0)).toBe("iron_block"); // back seen from north: left is east
    expect(b.at(0, 0, 0)).toBe("quartz_block"); // left (x = 0) seen from west: left is north
    expect(b.at(4, 0, 3)).toBe("hay_block"); // right (x max) seen from east: left is south
  });

  it("gives faces their widths: front/back the box width, left/right its depth", () => {
    const widths: Record<string, number> = {};
    for (const face of ["front", "back", "left", "right"]) {
      const b = run(
        [{ faces: { [face]: [{ fill: "stone" }] } } as never],
        [5, 2, 3],
      );
      widths[face] = b.cells.length / 2;
    }
    expect(widths).toEqual({ front: 5, back: 5, left: 3, right: 3 });
  });

  it("runs `sides` on all four walls, corners belonging to both", () => {
    const b = run([{ faces: { sides: [{ fill: "stone" }] } }], [5, 2, 4]);
    // the ring of a 5×4 box is 14 cells a layer
    expect(b.cells).toHaveLength(28);
    expect(b.at(2, 0, 2)).toBe("air");
  });

  it("lets named faces override `sides`, then top/bottom, then edges", () => {
    const b = run(
      [
        {
          faces: {
            // written in the opposite order to show the order is fixed
            edges: [{ fill: "oak_log" }],
            top: [{ fill: "cobblestone" }],
            front: [{ fill: "bricks" }],
            sides: [{ fill: "stone" }],
          },
        },
      ],
      [4, 3, 4],
    );
    expect(b.at(1, 1, 3)).toBe("bricks"); // front over sides
    expect(b.at(1, 1, 0)).toBe("stone");
    expect(b.at(1, 2, 3)).toBe("cobblestone"); // top over front
    expect(b.at(1, 2, 1)).toBe("cobblestone");
    expect(b.at(0, 2, 3)).toBe("oak_log"); // edges over top
    for (const [x, z] of [
      [0, 0],
      [3, 0],
      [0, 3],
      [3, 3],
    ]) {
      expect([0, 1, 2].map((y) => b.at(x, y, z))).toEqual(
        Array(3).fill("oak_log"),
      );
    }
  });

  it("makes walls `thickness` deep, top and bottom too", () => {
    const b = run(
      [
        {
          faces: {
            thickness: 2,
            left: [{ fill: "stone" }],
            bottom: [{ fill: "cobblestone" }],
          },
        },
      ],
      [5, 4, 3],
    );
    expect(xsOf(b, "stone")).toEqual([0, 1]);
    expect(
      [
        ...new Set(
          b.cells.filter((c) => c[3] === "cobblestone").map((c) => c[1]),
        ),
      ].sort(),
    ).toEqual([0, 1]);
  });

  it("faces z inward in a face scope", () => {
    // a box 1 deep at the outer surface of each wall
    const b = run(
      [
        {
          faces: {
            thickness: 2,
            sides: [{ box: { size: ["~", "~", 1], do: [{ fill: "stone" }] } }],
          },
        },
      ],
      [5, 1, 5],
    );
    expect(b.at(2, 0, 0)).toBe("stone");
    expect(b.at(2, 0, 1)).toBe("air");
    expect(b.at(4, 0, 2)).toBe("stone");
    expect(b.at(3, 0, 2)).toBe("air");
  });

  it("puts a rotated box's front on its new side", () => {
    // Cairn's test_rotate_front_faces_west, by geometry (doors are SCHEM-108)
    const b = run(
      [
        {
          box: {
            size: [5, 4, 5],
            rotate: 1,
            do: [
              {
                faces: {
                  front: [
                    {
                      box: {
                        at: ["center", 0, 0],
                        size: [1, 1, 1],
                        do: [{ fill: "bricks" }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      [5, 4, 5],
    );
    expect(b.cells.map(([x, y, z, id]) => [x, y, z, id])).toEqual([
      [0, 0, 2, "bricks"],
    ]);
  });
});

describe("layers through scope operations", () => {
  // Cairn's test_priority_is_order_independent, end to end
  it("lets a higher layer win whatever the order", () => {
    const ops: Operations = [
      { box: { priority: 1, size: [1, 1, 1], do: [{ fill: "bricks" }] } },
      { box: { size: [1, 1, 1], do: [{ fill: "stone" }] } },
    ];
    expect(run(ops, [1, 1, 1]).at(0, 0, 0)).toBe("bricks");
    expect(run([...ops].reverse(), [1, 1, 1]).at(0, 0, 0)).toBe("bricks");
  });

  // Cairn's test_air_only_erases_its_own_layer_unless_carve
  it("lets air erase only its own layer unless it carves", () => {
    const base: Operations = [{ fill: "stone" }];
    const cell = (ops: Operations) => run(ops, [1, 1, 1]).at(0, 0, 0);
    expect(
      cell([...base, { box: { priority: 1, do: [{ clear: true }] } }]),
    ).toBe("stone");
    expect(
      cell([
        ...base,
        { box: { priority: 1, carve: true, do: [{ fill: "air" }] } },
      ]),
    ).toBe("air");
    expect(cell([...base, { fill: "air" }])).toBe("air");
  });

  it("inherits layers through split, repeat, inset and faces", () => {
    const b = run(
      [
        {
          split: {
            axis: "x",
            priority: 2,
            parts: [
              {
                size: "~",
                do: [
                  {
                    repeat: {
                      axis: "x",
                      every: 1,
                      do: [
                        {
                          inset: {
                            by: 0,
                            do: [{ faces: { top: [{ fill: "bricks" }] } }],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
        { fill: { material: "stone", priority: 1 } },
      ],
      [3, 1, 1],
    );
    expect(xsOf(b, "bricks")).toEqual([0, 1, 2]);
  });
});

describe("paths and errors", () => {
  it("reports errors at program paths and carries on", () => {
    const b = compile(
      [
        { box: { do: [{ fill: "diamond_blok" }] } },
        {
          repeat: {
            axis: "x",
            every: 1,
            pattern: [[{ fill: "stone" }], [{ fill: "nonsense_block_xyz" }]],
          },
        },
      ],
      [4, 1, 1],
    );
    const errors = messages(b.errors);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(
      /^build\[0\]\.box\.do\[0\]\.fill: .*diamond_blok/,
    );
    // once per tile that ran it, collapsed with a count
    expect(errors[1]).toMatch(
      /^build\[1\]\.repeat\.pattern\[1\]\[0\]\.fill: .*\(x2\)$/,
    );
    expect(b.at(0, 0, 0)).toBe("stone");
    expect(b.at(2, 0, 0)).toBe("stone");
  });

  it("uses the faces' own paths", () => {
    const b = compile(
      [
        {
          faces: {
            sides: [{ fill: "nonsense_block_xyz" }],
            edges: [{ fill: "nonsense_block_xyz" }],
          },
        },
      ],
      [3, 1, 3],
    );
    expect(messages(b.errors).map((e) => e.split(":")[0])).toEqual([
      "build[0].faces.sides[0].fill",
      "build[0].faces.edges[0].fill",
    ]);
  });

  it("stops the whole compile after too many placements", () => {
    const b = compile(
      [{ fill: "stone" }, { fill: "cobblestone" }],
      [2, 2, 2],
      {},
      { maxPlacements: 10 },
    );
    expect(messages(b.errors)).toEqual([
      "build[1].fill: too many block placements (more than 10)",
    ]);
  });

  it("drops and counts blocks outside the build", () => {
    const b = run(
      [{ faces: { thickness: 3, front: [{ fill: "stone" }] } }],
      [2, 1, 2],
    );
    expect(b.cells).toHaveLength(4);
    expect(messages(b.warnings)).toEqual([
      "2 block(s) fell outside the build size [2,1,2] and were dropped (inset the structure or enlarge 'size')",
    ]);
  });

  it("uses the palette's roles", () => {
    const b = run(
      [{ faces: { sides: [{ fill: "@wall" }], top: [{ fill: "@roof" }] } }],
      [3, 2, 3],
      { wall: "stone_bricks", roof: "spruce" },
    );
    expect(b.at(0, 0, 0)).toBe("stone_bricks");
    expect(b.at(1, 1, 1)).toBe("spruce_planks");
  });
});

describe("unvalidated input (template substitution can produce it)", () => {
  const raw = (build: unknown, size: [number, number, number] = [3, 3, 3]) =>
    messages(
      compileProgram({ size, build } as unknown as Program, registry).errors,
    );

  it("reports malformed operations at their paths", () => {
    expect(raw([{ box: { do: "fill" } }])).toEqual([
      'build[0].box.do: expected a list of operations, got "fill"',
    ]);
    expect(raw([42])).toEqual([
      'build[0]: each operation must be an object like {"fill": ...}, got 42',
    ]);
    expect(raw([{ fill: "stone", clear: true }])).toEqual([
      "build[0]: operation must have exactly one key, got 'fill', 'clear'",
    ]);
    expect(raw([{ "#": "only a comment" }])).toEqual([
      "build[0]: operation must have exactly one key, got none",
    ]);
    expect(raw([{ splt: {} }])).toEqual([
      "build[0].splt: unknown operation 'splt'",
    ]);
    expect(raw([{ when: {} }])).toEqual([
      "build[0].when: 'when' is not implemented yet",
    ]);
  });

  it("checks scope operation arguments", () => {
    expect(
      raw([
        { box: "big" },
        { box: { at: [0, 0] } },
        { box: { rotate: 1.5 } },
        { split: { axis: "w", parts: [] } },
        { split: { axis: "x", parts: [] } },
        { split: { axis: "x", parts: [{ do: [] }] } },
        { repeat: { axis: "x" } },
        { repeat: { axis: "x", every: 1, align: "middle" } },
        { repeat: { axis: "x", every: 1, gap: -1 } },
        { repeat: { axis: "x", every: 0 } },
        { inset: { by: "1" } },
        { inset: { by: { up: 1 } } },
        { inset: { by: { x: 0.5 } } },
        { faces: [] },
        { faces: { thickness: 0 } },
        { fill: { state: {} } },
        { fill: 3 },
      ]),
    ).toEqual([
      "build[0].box: expected an object with 'at', 'size', 'rotate' and 'do', got \"big\"",
      "build[1].box.at: must be a list of 3 values [x, y, z], got [0,0]",
      "build[2].box.rotate: must be an integer, got 1.5",
      'build[3].split.axis: must be "x", "y" or "z", got "w"',
      "build[4].split.parts: must be a non-empty list, got []",
      "build[5].split.parts[0]: each part needs a 'size'",
      "build[6].repeat: needs 'every' or 'count'",
      'build[7].repeat.align: must be one of "center", "start", "end", "stretch", got "middle"',
      "build[8].repeat.gap: must be an integer of at least 0, got -1",
      "build[9].repeat.every: must be an integer of at least 1, got 0",
      'build[10].inset.by: must be an integer or an object of sides, got "1"',
      "build[11].inset.by: unknown side 'up'",
      "build[12].inset.by.x: must be an integer, got 0.5",
      "build[13].faces: expected an object of face → operations, got []",
      "build[14].faces.thickness: must be an integer of at least 1, got 0",
      "build[15].fill: missing 'material'",
      "build[16].fill: expected a material or an object with 'material', got 3",
    ]);
  });

  it("stops at the nesting limit", () => {
    let ops: unknown = [{ fill: "stone" }];
    for (let i = 0; i < 70; i++) ops = [{ box: { do: ops } }];
    const errors = raw(ops);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/operations nested more than 64 deep/);
  });
});

describe("fill arguments", () => {
  it("orients local states and checks them against the version", () => {
    const b = run(
      [
        {
          box: {
            size: [1, 1, 1],
            rotate: 1,
            do: [
              {
                fill: {
                  material: "oak_stairs",
                  facing: "+z",
                  state: { half: "TOP" },
                },
              },
            ],
          },
        },
      ],
      [1, 1, 1],
    );
    const [[, block]] = [...b.log.compose()];
    expect(block.states).toEqual({ facing: "west", half: "top" });

    const bad = compile(
      [{ fill: { material: "oak_stairs", state: { half: "middle" } } }],
      [1, 1, 1],
    );
    expect(messages(bad.errors)).toEqual([
      expect.stringMatching(/^build\[0\]\.fill: /),
    ]);
  });

  it("warns about a facing that isn't a direction", () => {
    const b = compile(
      [{ fill: { material: "oak_stairs", state: { facing: "sideways" } } }],
      [1, 1, 1],
    );
    expect(messages(b.warnings)).toEqual([
      "build[0].fill: unknown facing 'sideways' ignored",
    ]);
  });

  it("applies `replace` and `only_empty`", () => {
    const b = run(
      [
        { box: { size: [2, 1, 1], do: [{ fill: "stone" }] } },
        { fill: { material: "glass", replace: "stone" } },
        { fill: { material: "cobblestone", only_empty: true } },
      ],
      [4, 1, 1],
    );
    expect(Array.from({ length: 4 }, (_, x) => b.at(x, 0, 0))).toEqual([
      "glass",
      "glass",
      "cobblestone",
      "cobblestone",
    ]);
  });
});
