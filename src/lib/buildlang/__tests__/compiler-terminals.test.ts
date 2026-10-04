// Terminal operations (Cairn `SPEC.md` "Material operations"): fill, clear,
// frame, block, door, cylinder and ellipsoid, plus `roof`, which this epic
// rejects. Ports Cairn's `test_door_faces_inward_and_has_two_halves`, the door
// half of `test_rotate_front_faces_west`, `test_replace_through_round_wall` and
// the non-cottage parts of `test_placed_block_collisions_are_reported`.

import { describe, expect, it } from "vitest";
import { buildShapeGrid } from "../../shapes/shapes";
import { compileWithRegistry } from "../compiler";
import type { Operations, Program } from "../program";
import {
  type Built,
  compile,
  messages,
  registry,
  run,
} from "./compile-harness";

/** Cells as `"x,y,z"` keys, optionally only those of one block id. */
function keys(built: Built, id?: string): Set<string> {
  return new Set(
    built.cells
      .filter((c) => id === undefined || c[3] === id)
      .map(([x, y, z]) => `${x},${y},${z}`),
  );
}

/**
 * Empty cells a 6-connected flood fill reaches from outside the grid (every
 * empty boundary cell is a seed, as if the grid were padded with air).
 */
function floodFromOutside(
  solid: Set<string>,
  [w, h, d]: [number, number, number],
): Set<string> {
  const seen = new Set<string>();
  const queue: [number, number, number][] = [];
  const visit = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return;
    const key = `${x},${y},${z}`;
    if (solid.has(key) || seen.has(key)) return;
    seen.add(key);
    queue.push([x, y, z]);
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        if (
          x === 0 ||
          y === 0 ||
          z === 0 ||
          x === w - 1 ||
          y === h - 1 ||
          z === d - 1
        ) {
          visit(x, y, z);
        }
      }
    }
  }
  while (queue.length > 0) {
    const [x, y, z] = queue.pop()!;
    visit(x + 1, y, z);
    visit(x - 1, y, z);
    visit(x, y + 1, z);
    visit(x, y - 1, z);
    visit(x, y, z + 1);
    visit(x, y, z - 1);
  }
  return seen;
}

describe("fill and clear", () => {
  it("lays a one-high run of logs along its length, a flat area upright", () => {
    const b = run(
      [
        { box: { size: [3, 1, 1], do: [{ fill: "oak_log" }] } },
        {
          box: {
            at: [0, 1, 0],
            size: [3, 1, 1],
            rotate: 1,
            do: [{ fill: "oak_log" }],
          },
        },
        { box: { at: [0, 2, 0], size: [3, 1, 3], do: [{ fill: "oak_log" }] } },
        { box: { at: [0, 3, 0], size: [1, 2, 1], do: [{ fill: "oak_log" }] } },
      ],
      [3, 5, 3],
    );
    expect(b.states(1, 0, 0)).toEqual({ axis: "x" });
    // the rotated box's local x runs along world z
    expect(b.states(0, 1, 1)).toEqual({ axis: "z" });
    expect(b.states(1, 2, 1)).toEqual({ axis: "y" });
    // a column keeps the block's default
    expect(b.states(0, 3, 0)).toEqual({});
  });

  it("keeps an axis given by the material or the operation", () => {
    const b = run(
      [
        { box: { size: [3, 1, 1], do: [{ fill: "oak_log[axis=z]" }] } },
        {
          box: {
            at: [0, 1, 0],
            size: [3, 1, 1],
            do: [{ fill: { material: "oak_log", axis: "y" } }],
          },
        },
      ],
      [3, 2, 1],
    );
    expect(b.states(0, 0, 0)).toEqual({ axis: "z" });
    expect(b.states(0, 1, 0)).toEqual({ axis: "y" });
  });

  it("notes a state the block doesn't have and ignores it", () => {
    const b = run(
      [
        {
          fill: {
            material: { mix: { oak_log: 1, stone: 1 } },
            axis: "x",
            state: { lit: "true" },
          },
        },
      ],
      [6, 1, 6],
      {},
    );
    expect(new Set(b.cells.map((c) => c[3]))).toEqual(
      new Set(["oak_log", "stone"]),
    );
    for (const [x, y, z, id] of b.cells) {
      expect(b.states(x, y, z)).toEqual(id === "oak_log" ? { axis: "x" } : {});
    }
    expect(messages(b.notes).sort()).toEqual([
      "build[0].fill: 'oak_log' has no state 'lit'; ignored",
      "build[0].fill: 'stone' has no state 'axis'; ignored",
      "build[0].fill: 'stone' has no state 'lit'; ignored",
    ]);
  });

  it("`clear` empties the scope", () => {
    const b = run(
      [
        { fill: "stone" },
        { box: { at: [1, 0, 0], size: [1, 1, 1], do: [{ clear: true }] } },
      ],
      [3, 1, 1],
    );
    expect([b.at(0, 0, 0), b.at(1, 0, 0), b.at(2, 0, 0)]).toEqual([
      "stone",
      "air",
      "stone",
    ]);
  });
});

describe("frame", () => {
  it("fills the 12 edges with logs along each edge", () => {
    const b = run([{ frame: "oak_log" }], [3, 4, 5]);
    // 4 vertical edges of 4, 4 along x of 3 and 4 along z of 5, corners shared
    expect(b.cells).toHaveLength(4 * 4 + 4 * 1 + 4 * 3);
    expect(b.states(0, 1, 0)).toEqual({ axis: "y" });
    expect(b.states(2, 2, 4)).toEqual({ axis: "y" });
    expect(b.states(1, 0, 0)).toEqual({ axis: "x" });
    expect(b.states(1, 3, 4)).toEqual({ axis: "x" });
    expect(b.states(0, 0, 2)).toEqual({ axis: "z" });
    expect(b.states(2, 3, 1)).toEqual({ axis: "z" });
    // a corner is vertical
    expect(b.states(0, 0, 0)).toEqual({ axis: "y" });
    // faces and the middle stay empty
    expect(b.at(1, 1, 0)).toBe("air");
    expect(b.at(1, 1, 2)).toBe("air");
  });

  it("orients edges in a rotated scope", () => {
    const b = run(
      [{ box: { size: [3, 2, 1], rotate: 1, do: [{ frame: "oak_log" }] } }],
      [1, 2, 3],
    );
    // with z 1 thick every cell is on two edges: the ends stand upright and
    // the middle runs along local x, which is world z
    expect([0, 1, 2].map((z) => b.states(0, 0, z).axis)).toEqual([
      "y",
      "z",
      "y",
    ]);
  });

  it("quietly skips the edge axis for blocks without one", () => {
    const b = run([{ frame: "stone" }], [3, 3, 3]);
    expect(b.cells).toHaveLength(20);
    expect(b.notes).toEqual([]);
  });
});

describe("block", () => {
  it("places one block at `at`, with alignments and negative positions", () => {
    const b = run(
      [
        { block: { at: ["center", 0, -1], material: "lantern" } },
        {
          block: {
            at: [0, "end", 0],
            material: "lantern",
            state: { hanging: "true" },
          },
        },
      ],
      [5, 3, 4],
    );
    expect(b.cells).toEqual([
      [2, 0, 3, "lantern"],
      [0, 2, 0, "lantern"],
    ]);
    expect(b.states(0, 2, 0)).toEqual({ hanging: "true" });
  });

  it("turns a local facing with its scope", () => {
    const b = run(
      [
        {
          box: {
            rotate: 1,
            do: [
              {
                block: {
                  at: [0, 0, 0],
                  material: "oak_stairs",
                  facing: "+z",
                },
              },
            ],
          },
        },
      ],
      [1, 1, 1],
    );
    expect(b.states(0, 0, 0)).toEqual({ facing: "west" });
  });

  it("places both halves of a door and of a bed", () => {
    const b = run(
      [
        { block: { at: [0, 0, 0], material: "oak_door", facing: "+z" } },
        {
          block: {
            at: [1, 0, 0],
            material: "red_bed",
            facing: "+z",
          },
        },
        // a bed's facing defaults to north: the head goes to -z
        { block: { at: [2, 0, 1], material: "white_bed" } },
      ],
      [3, 2, 2],
    );
    expect(b.states(0, 0, 0)).toEqual({ facing: "south", half: "lower" });
    expect(b.states(0, 1, 0)).toEqual({ facing: "south", half: "upper" });
    expect(b.at(1, 0, 0)).toBe("red_bed");
    expect(b.states(1, 0, 0)).toEqual({ facing: "south", part: "foot" });
    expect(b.at(1, 0, 1)).toBe("red_bed");
    expect(b.states(1, 0, 1)).toEqual({ facing: "south", part: "head" });
    expect(b.states(2, 0, 1)).toEqual({ part: "foot" });
    expect(b.states(2, 0, 0)).toEqual({ part: "head" });
  });

  it("drops a half that falls outside the build and says so", () => {
    const b = compile(
      [{ block: { at: [0, 0, 0], material: "oak_door" } }],
      [1, 1, 1],
    );
    expect(b.cells).toEqual([[0, 0, 0, "oak_door"]]);
    expect(messages(b.warnings)).toEqual([
      expect.stringMatching(
        /^build\[0\]\.block: 1 block\(s\) fell outside the build size/,
      ),
    ]);
  });

  it("reports collisions with other features, except doors set into walls", () => {
    // overwritten the other way round is reported too
    let b = run(
      [{ block: { at: [0, 0, 0], material: "lantern" } }, { fill: "stone" }],
      [1, 1, 1],
    );
    expect(messages(b.warnings)).toEqual([
      expect.stringMatching(/lantern.*was overwritten/),
    ]);
    // a door set into a wall is the normal case: no warning
    b = run(
      [
        { fill: "stone" },
        { block: { at: [0, 0, 0], material: "oak_door", facing: "+z" } },
      ],
      [1, 2, 1],
    );
    expect(b.warnings).toEqual([]);
    // ...but a door eating a window pane is reported
    b = run(
      [
        {
          box: { at: [0, 1, 0], size: [1, 1, 1], do: [{ fill: "glass_pane" }] },
        },
        { block: { at: [0, 0, 0], material: "oak_door", facing: "+z" } },
      ],
      [1, 2, 1],
    );
    expect(messages(b.warnings)).toEqual([
      expect.stringMatching(/^build\[1\]\.block: .*glass_pane/),
    ]);
  });

  it("ignores writes the cell rejected (only_empty, replace)", () => {
    // a later fill that skips the lantern's cell doesn't collide with it
    let b = run(
      [
        { block: { at: [0, 0, 0], material: "lantern" } },
        { fill: { material: "stone", only_empty: true } },
        { fill: { material: "cobblestone", replace: "stone" } },
      ],
      [1, 1, 1],
    );
    expect(b.warnings).toEqual([]);
    expect(b.at(0, 0, 0)).toBe("lantern");
    // nor does a hand-placed block that only fills empty cells
    b = run(
      [
        { fill: "stone" },
        { block: { at: [0, 0, 0], material: "lantern", only_empty: true } },
      ],
      [1, 1, 1],
    );
    expect(b.warnings).toEqual([]);
    expect(b.at(0, 0, 0)).toBe("stone");
  });
});

describe("door", () => {
  it("faces inward and has two halves (Cairn)", () => {
    const b = run(
      [{ faces: { front: [{ fill: "stone" }, { door: "oak_door" }] } }],
      [5, 4, 5],
    );
    expect(b.at(2, 0, 4)).toBe("oak_door");
    expect(b.at(2, 1, 4)).toBe("oak_door");
    expect(b.states(2, 0, 4)).toEqual({ facing: "north", half: "lower" });
    expect(b.states(2, 1, 4)).toEqual({ facing: "north", half: "upper" });
    expect(b.at(2, 2, 4)).toBe("stone");
  });

  it("faces inward on a rotated box's front (Cairn)", () => {
    const b = run(
      [
        {
          box: {
            size: [5, 4, 5],
            rotate: 1,
            do: [
              { faces: { front: [{ fill: "stone" }, { door: "oak_door" }] } },
            ],
          },
        },
      ],
      [5, 4, 5],
    );
    const lower = b.cells.filter(
      ([x, y, z, id]) =>
        id === "oak_door" && b.states(x, y, z).half === "lower",
    );
    expect(lower).toHaveLength(1);
    const [[x, y, z]] = lower;
    expect(x).toBe(0);
    expect(b.states(x, y, z).facing).toBe("east");
  });

  it("uses the @door role's door variant, `x` and `hinge`", () => {
    const b = run(
      [
        {
          faces: {
            front: [{ fill: "stone" }, { door: { x: 0, hinge: "right" } }],
            back: [{ fill: "stone" }, { door: { material: "@door" } }],
          },
        },
      ],
      [5, 4, 5],
      { door: "spruce" },
    );
    expect(b.at(0, 0, 4)).toBe("spruce_door");
    expect(b.states(0, 0, 4)).toEqual({
      facing: "north",
      half: "lower",
      hinge: "right",
    });
    // the back face's local x runs from east to west
    expect(b.at(2, 0, 0)).toBe("spruce_door");
    expect(b.states(2, 0, 0).facing).toBe("south");
  });

  it("faces +z outside a face scope and clears its opening", () => {
    const b = run(
      [
        {
          box: {
            size: [3, 3, 1],
            do: [{ fill: "stone" }, { door: "birch_door" }],
          },
        },
      ],
      [3, 3, 1],
    );
    expect(b.states(1, 0, 0)).toEqual({ facing: "south", half: "lower" });
    expect(b.at(1, 2, 0)).toBe("stone");
    expect(b.at(0, 0, 0)).toBe("stone");
  });

  it("rejects an `x` outside the scope", () => {
    const b = compile(
      [{ faces: { front: [{ door: { material: "oak_door", x: 5 } }] } }],
      [5, 4, 5],
    );
    expect(messages(b.errors)).toEqual([
      "build[0].faces.front[0].door.x: must be less than the scope's width 5, got 5",
    ]);
  });
});

describe("automatic facings in face scopes", () => {
  it("points trapdoors and wall torches out of the wall", () => {
    const b = run(
      [
        {
          faces: {
            front: [
              { block: { at: [0, 0, 0], material: "oak_trapdoor" } },
              { block: { at: [2, 0, 0], material: "wall_torch" } },
            ],
          },
        },
      ],
      [3, 1, 3],
    );
    expect(b.states(0, 0, 2).facing).toBe("south");
    expect(b.states(2, 0, 2)).toEqual({ facing: "south" });
  });
});

describe("cylinder and ellipsoid", () => {
  it("fits the Shape Generator's grids to the scope", () => {
    const cylinder = run([{ cylinder: "stone" }], [7, 3, 5]);
    const disc = buildShapeGrid({
      shape: "cylinder",
      width: 7,
      height: 1,
      depth: 5,
    });
    expect(cylinder.cells).toHaveLength(disc.count * 3);

    const ellipsoid = run([{ ellipsoid: { mix: { stone: 1 } } }], [7, 5, 9]);
    const solid = buildShapeGrid({
      shape: "ellipsoid",
      width: 7,
      height: 5,
      depth: 9,
    });
    expect(ellipsoid.cells).toHaveLength(solid.count);
  });

  it("punches windows through a round wall with `replace` (Cairn)", () => {
    const b = run(
      [
        { cylinder: { material: "stone", hollow: true } },
        {
          box: {
            at: ["center", 0, 0],
            size: [1, 1, "100%"],
            do: [{ fill: { material: "glass", replace: "stone" } }],
          },
        },
      ],
      [9, 1, 9],
    );
    expect([...keys(b, "glass")].sort()).toEqual(["4,0,0", "4,0,8"]);
  });

  it("makes watertight hollow cylinders", () => {
    let checked = 0;
    for (const [w, d] of [
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 9],
      [9, 9],
      [10, 7],
      [13, 13],
      [16, 11],
      [21, 21],
      [24, 24],
    ] as const) {
      for (const thickness of [1, 2, 3]) {
        const size: [number, number, number] = [w, 5, d];
        // capped top and bottom so only the wall can let the outside in
        const caps: Operations = [
          { faces: { top: [{ fill: "stone" }], bottom: [{ fill: "stone" }] } },
        ];
        const hollow = run(
          [
            { cylinder: { material: "stone", hollow: true, thickness } },
            ...caps,
          ],
          size,
        );
        const solid = run([{ cylinder: "stone" }, ...caps], size);
        const wall = keys(hollow);
        const interior = [...keys(solid)].filter((k) => !wall.has(k));
        const outside = floodFromOutside(wall, size);
        for (const cell of interior) expect(outside.has(cell)).toBe(false);
        if (interior.length > 0) checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("leaves a hollow cylinder open at both ends", () => {
    const b = run(
      [{ cylinder: { material: "stone", hollow: true, thickness: 1 } }],
      [7, 3, 7],
    );
    expect(b.at(3, 0, 3)).toBe("air");
    expect(b.at(3, 2, 3)).toBe("air");
    expect(b.at(3, 1, 0)).toBe("stone");
  });

  it("makes watertight hollow ellipsoids", () => {
    for (const size of [
      [5, 5, 5],
      [9, 7, 11],
      [16, 12, 16],
    ] as [number, number, number][]) {
      const hollow = run(
        [{ ellipsoid: { material: "stone", hollow: true } }],
        size,
      );
      const solid = run([{ ellipsoid: "stone" }], size);
      const wall = keys(hollow);
      const interior = [...keys(solid)].filter((k) => !wall.has(k));
      expect(interior.length).toBeGreaterThan(0);
      const outside = floodFromOutside(wall, size);
      for (const cell of interior) expect(outside.has(cell)).toBe(false);
    }
  });

  it("caps an oversized thickness and reports oversized scopes", () => {
    const b = run(
      [{ cylinder: { material: "stone", hollow: true, thickness: 500 } }],
      [5, 1, 5],
    );
    expect(b.cells).toHaveLength(
      buildShapeGrid({ shape: "cylinder", width: 5, height: 1, depth: 5 })
        .count,
    );
    const big = compile(
      [{ box: { size: [300, 1, 1], do: [{ ellipsoid: "stone" }] } }],
      [4, 1, 1],
    );
    expect(messages(big.errors)).toEqual([
      "build[0].box.do[0].ellipsoid: scope [300,1,1] is too big for 'ellipsoid' (at most 256 per side)",
    ]);
  });
});

describe("roof", () => {
  it("is not supported yet, reported at its path", () => {
    const b = compile(
      [
        { fill: "stone" },
        {
          box: {
            do: [{ roof: "gable" }, { roof: { type: "hip", pitch: 1 } }],
          },
        },
      ],
      [3, 3, 3],
    );
    expect(messages(b.errors)).toEqual([
      "build[1].box.do[0].roof: roof is not supported yet",
      "build[1].box.do[1].roof: roof is not supported yet",
    ]);
    expect(b.cells).toHaveLength(27);
  });
});

describe("unvalidated terminal arguments", () => {
  it("reports them at their paths", () => {
    const b = compileWithRegistry(
      {
        size: [3, 3, 3],
        build: [
          { block: "lantern" },
          { block: { at: [0, 0, 0] } },
          { block: { material: "lantern", at: [0, 0] } },
          { door: 3 },
          { door: { material: "oak_door", x: -1 } },
          { cylinder: { material: "stone", thickness: 0 } },
          { frame: { facing: "+z" } },
        ],
      } as unknown as Program,
      registry,
    );
    expect(messages(b.errors)).toEqual([
      'build[0].block: expected an object like {"material": ..., "at": [x, y, z]}, got "lantern"',
      "build[1].block: missing 'material'",
      "build[2].block.at: must be a list of 3 values [x, y, z], got [0,0]",
      "build[3].door: expected a material or an object with 'material', got 3",
      "build[4].door.x: must be an integer of at least 0, got -1",
      "build[5].cylinder.thickness: must be an integer of at least 1, got 0",
      "build[6].frame: missing 'material'",
    ]);
  });
});
