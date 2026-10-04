import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  clearBlockDataCache,
  parseMcmetaBlockRegistry,
  parseMcmetaBlocks,
} from "../../blockdata/load";
import {
  type BlockRegistry,
  createBlockRegistry,
  loadBlockRegistry,
} from "../../blockdata/registry";
import { postprocess } from "../postprocess";
import { BlockGrid, type Pos } from "../writes";
import { run } from "./compile-harness";

const FIXTURES = path.join(__dirname, "../../blockdata/__tests__/fixtures");
const fixture = (name: string) =>
  readFileSync(path.join(FIXTURES, name), "utf8");
const mcmetaUrl = (version: string, file = "blocks") =>
  `https://cdn.jsdelivr.net/gh/misode/mcmeta@${version}-summary/${file}/data.min.json`;

const ROUTES: Record<string, string> = {
  [mcmetaUrl("1.21.4")]: fixture("registry-mcmeta-1.21.4-blocks.json"),
};

const fetch = vi.fn(async (input: RequestInfo | URL) => {
  const body = ROUTES[String(input)];
  return body === undefined
    ? new Response("not found", { status: 404 })
    : new Response(body, { status: 200 });
});

// Trimmed real mcmeta summaries: 1.15.2 has boolean wall sides, 1.21.4
// none/low/tall. 1.15.2 isn't a version the app offers, so its registry is
// built from the data directly.
function registry1152(): BlockRegistry {
  const blocks = parseMcmetaBlocks(
    JSON.parse(fixture("registry-mcmeta-1.15.2-blocks.json")),
  );
  const ids = parseMcmetaBlockRegistry(
    JSON.parse(fixture("registry-mcmeta-1.15.2-registries.json")),
  );
  for (const id of ids) {
    if (!blocks.has(id)) blocks.set(id, { properties: {}, defaults: {} });
  }
  return createBlockRegistry({
    sourceVersion: "1.15.2",
    translateOnExport: false,
    blocks,
  });
}

const registries: Record<string, BlockRegistry> = {};

beforeAll(async () => {
  clearBlockDataCache();
  registries["1.15.2"] = registry1152();
  registries["1.21.4"] = await loadBlockRegistry("1.21.4", { fetch });
});

type Placement = [number, number, number, string, Record<string, string>?];

/** Post-processes the placements; returns the states at a cell. */
function processed(registry: BlockRegistry, placements: Placement[]) {
  const grid = new BlockGrid([8, 8, 8]);
  for (const [x, y, z, id, states = {}] of placements) {
    grid.set([x, y, z], { id: `minecraft:${id}`, states });
  }
  postprocess(grid, registry);
  return (x: number, y: number, z: number) => grid.get([x, y, z])?.states;
}

const sides = (states: Record<string, string> | undefined) => [
  states?.north,
  states?.east,
  states?.south,
  states?.west,
];

describe.each(["1.15.2", "1.21.4"])("on %s", (version) => {
  const r = () => registries[version];

  it("gives an L of stairs an inner corner", () => {
    // Stairs along two walls of a room's corner, backs to the walls.
    const at = processed(r(), [
      [0, 0, 0, "oak_stairs", { facing: "north" }],
      [1, 0, 0, "oak_stairs", { facing: "north" }],
      [2, 0, 0, "oak_stairs", { facing: "north" }],
      [0, 0, 1, "oak_stairs", { facing: "west" }],
      [0, 0, 2, "oak_stairs", { facing: "west" }],
    ]);
    expect(at(0, 0, 0)).toEqual({ facing: "north", shape: "inner_left" });
    expect(at(1, 0, 0)).toEqual({ facing: "north" });
    expect(at(2, 0, 0)).toEqual({ facing: "north" });
    expect(at(0, 0, 1)).toEqual({ facing: "west" });
    expect(at(0, 0, 2)).toEqual({ facing: "west" });

    // Mirrored, the corner turns right.
    const mirrored = processed(r(), [
      [2, 0, 0, "oak_stairs", { facing: "north" }],
      [1, 0, 0, "oak_stairs", { facing: "north" }],
      [2, 0, 1, "oak_stairs", { facing: "east" }],
    ]);
    expect(mirrored(2, 0, 0)?.shape).toBe("inner_right");
  });

  it("gives an L of stairs an outer corner", () => {
    // Backs to the inside of the L: the corner is convex.
    const at = processed(r(), [
      [0, 0, 0, "spruce_stairs", { facing: "south" }],
      [1, 0, 0, "spruce_stairs", { facing: "south" }],
      [0, 0, 1, "spruce_stairs", { facing: "east" }],
      [0, 0, 2, "spruce_stairs", { facing: "east" }],
    ]);
    expect(at(0, 0, 0)?.shape).toBe("outer_left");
    expect(at(1, 0, 0)?.shape).toBeUndefined();
    expect(at(0, 0, 1)?.shape).toBeUndefined();

    const mirrored = processed(r(), [
      [2, 0, 0, "spruce_stairs", { facing: "south" }],
      [2, 0, 1, "spruce_stairs", { facing: "west" }],
    ]);
    expect(mirrored(2, 0, 0)?.shape).toBe("outer_right");
  });

  it("joins stairs of the same half only, and keeps a set shape", () => {
    const at = processed(r(), [
      [0, 0, 0, "oak_stairs", { facing: "north" }],
      [0, 0, 1, "oak_stairs", { facing: "west", half: "top" }],
      [3, 0, 0, "oak_stairs", { facing: "north", half: "top" }],
      [3, 0, 1, "oak_stairs", { facing: "west", half: "top" }],
      [6, 0, 0, "oak_stairs", { facing: "north", shape: "outer_right" }],
      [6, 0, 1, "oak_stairs", { facing: "west" }],
    ]);
    expect(at(0, 0, 0)?.shape).toBeUndefined();
    expect(at(3, 0, 0)?.shape).toBe("inner_left");
    expect(at(6, 0, 0)?.shape).toBe("outer_right");
  });

  it("does not corner a stair whose side continues the straight run", () => {
    // Port of `canTakeShape`: the stair to the corner's west faces north
    // too, so the corner stays straight.
    const at = processed(r(), [
      [1, 0, 0, "oak_stairs", { facing: "north" }],
      [0, 0, 0, "oak_stairs", { facing: "north" }],
      [1, 0, 1, "oak_stairs", { facing: "west" }],
    ]);
    expect(at(1, 0, 0)?.shape).toBeUndefined();
  });

  it("connects a pane between two solid blocks", () => {
    const at = processed(r(), [
      [0, 0, 0, "stone"],
      [1, 0, 0, "glass_pane"],
      [2, 0, 0, "stone"],
    ]);
    expect(sides(at(1, 0, 0))).toEqual(["false", "true", "false", "true"]);
    expect(at(0, 0, 0)).toEqual({});
  });

  it("connects panes and iron bars to each other but not to leaves", () => {
    const at = processed(r(), [
      [0, 0, 0, "iron_bars"],
      [1, 0, 0, "white_stained_glass_pane"],
      [1, 0, 1, "glass"],
      [1, 0, 7, "glass_pane", { north: "true", east: "true" }],
      [1, 0, 6, "oak_leaves"],
    ]);
    expect(sides(at(0, 0, 0))).toEqual(["false", "true", "false", "false"]);
    expect(sides(at(1, 0, 0))).toEqual(["false", "false", "true", "true"]);
    // Placed side states are recomputed.
    expect(sides(at(1, 0, 7))).toEqual(["false", "false", "false", "false"]);
  });

  it("connects fences to fences, solid blocks and lined-up gates", () => {
    const at = processed(r(), [
      [1, 0, 1, "oak_fence"],
      [0, 0, 1, "spruce_fence"],
      [1, 0, 0, "stone"],
      [2, 0, 1, "oak_fence_gate", { facing: "north" }],
      [1, 0, 2, "oak_fence_gate", { facing: "north" }],
      [4, 0, 1, "oak_fence"],
      [4, 0, 2, "oak_stairs", { facing: "north" }],
      [4, 0, 0, "oak_stairs", { facing: "north" }],
    ]);
    expect(sides(at(1, 0, 1))).toEqual(["true", "true", "false", "true"]);
    // A stair's back is a full face; its front is not.
    expect(sides(at(4, 0, 1))).toEqual(["false", "false", "true", "false"]);
  });

  it("connects walls to walls, solid blocks and gates", () => {
    const wall = version === "1.15.2" ? "true" : "low";
    const none = version === "1.15.2" ? "false" : "none";
    const at = processed(r(), [
      [1, 0, 1, "cobblestone_wall"],
      [0, 0, 1, "stone_brick_wall"],
      [1, 0, 0, "oak_fence_gate", { facing: "east" }],
      [1, 0, 2, "oak_planks"],
      [2, 0, 1, "oak_fence"],
    ]);
    expect(sides(at(1, 0, 1))).toEqual([wall, none, wall, wall]);
    expect(at(1, 0, 1)?.up).toBe("true");
  });
});

describe("version differences", () => {
  it("joins panes and walls from 1.16 only", () => {
    const placements: Placement[] = [
      [0, 0, 0, "glass_pane"],
      [1, 0, 0, "cobblestone_wall"],
    ];
    const old = processed(registries["1.15.2"], placements);
    expect(old(0, 0, 0)?.east).toBe("false");
    expect(old(1, 0, 0)?.west).toBe("false");
    const now = processed(registries["1.21.4"], placements);
    expect(now(0, 0, 0)?.east).toBe("true");
    expect(now(1, 0, 0)?.west).toBe("low");
  });

  it("keeps a nether brick fence apart from wooden ones", () => {
    const at = processed(registries["1.15.2"], [
      [0, 0, 0, "oak_fence"],
      [1, 0, 0, "nether_brick_fence"],
      [2, 0, 0, "nether_brick_fence"],
    ]);
    expect(at(0, 0, 0)?.east).toBe("false");
    expect(sides(at(1, 0, 0))).toEqual(["false", "true", "false", "false"]);
  });

  it("raises a straight 1.15.2 wall's post only under a block", () => {
    const at = processed(registries["1.15.2"], [
      [0, 0, 0, "stone"],
      [1, 0, 0, "cobblestone_wall"],
      [2, 0, 0, "cobblestone_wall"],
      [3, 0, 0, "stone"],
      [2, 1, 0, "torch"],
    ]);
    expect(at(1, 0, 0)).toMatchObject({ east: "true", west: "true" });
    expect(at(1, 0, 0)?.up).toBe("false");
    expect(at(2, 0, 0)?.up).toBe("true");
  });

  it("makes 1.21.4 wall sides tall under a covering block", () => {
    const at = processed(registries["1.21.4"], [
      [0, 0, 0, "stone"],
      [1, 0, 0, "cobblestone_wall"],
      [2, 0, 0, "cobblestone_wall"],
      [3, 0, 0, "cobblestone_wall"],
      [4, 0, 0, "stone"],
      [2, 1, 0, "stone"],
      [3, 1, 0, "torch"],
      [5, 0, 0, "cobblestone_wall"],
      [5, 1, 0, "cobblestone_wall"],
      [5, 2, 0, "cobblestone_wall"],
      [6, 2, 0, "stone"],
    ]);
    expect(at(1, 0, 0)).toMatchObject({
      east: "low",
      west: "low",
      up: "false",
    });
    // A full block above: tall sides, no post.
    expect(at(2, 0, 0)).toMatchObject({
      east: "tall",
      west: "tall",
      up: "false",
    });
    // A torch above raises the post (`#wall_post_override`).
    expect(at(3, 0, 0)).toMatchObject({ east: "low", west: "low", up: "true" });
    // A lone wall has a post; the walls under it keep theirs.
    expect(at(5, 2, 0)).toMatchObject({ east: "low", up: "true" });
    expect(at(5, 1, 0)).toMatchObject({ east: "none", up: "true" });
    expect(at(5, 0, 0)?.up).toBe("true");
  });

  it("writes only the properties the version's block has", () => {
    const base = registries["1.21.4"];
    // A registry whose glass pane has no `west` and whose stairs have no
    // `shape`.
    const trimmed: BlockRegistry = {
      ...base,
      properties(id) {
        const props = base.properties(id);
        if (!props) return props;
        const { west: _west, shape: _shape, ...rest } = props;
        return id === "minecraft:glass_pane" || id === "minecraft:oak_stairs"
          ? rest
          : props;
      },
    };
    const at = processed(trimmed, [
      [0, 0, 0, "stone"],
      [1, 0, 0, "glass_pane"],
      [2, 0, 0, "stone"],
      [4, 0, 0, "oak_stairs", { facing: "north" }],
      [4, 0, 1, "oak_stairs", { facing: "west" }],
    ]);
    expect(at(1, 0, 0)).toEqual({
      north: "false",
      east: "true",
      south: "false",
    });
    expect(at(4, 0, 0)).toEqual({ facing: "north" });
  });
});

describe("compiled builds", () => {
  it("sets stair shapes and pane connections in the compile result", () => {
    const b = run(
      [
        {
          box: {
            size: [3, 1, 1],
            do: [{ fill: { material: "oak_stairs", facing: "-z" } }],
          },
        },
        {
          box: {
            at: [0, 0, 1],
            size: [1, 1, 2],
            do: [{ fill: { material: "oak_stairs", facing: "-x" } }],
          },
        },
        {
          box: {
            at: [0, 2, 0],
            size: [3, 1, 1],
            do: [
              { fill: "stone" },
              { block: { material: "glass_pane", at: [1, 0, 0] } },
            ],
          },
        },
      ],
      [3, 3, 3],
    );
    expect(b.states(0, 0, 0)).toMatchObject({ shape: "inner_left" });
    expect(b.states(1, 0, 0).shape).toBeUndefined();
    expect(b.states(1, 2, 0)).toMatchObject({
      east: "true",
      west: "true",
      north: "false",
      south: "false",
    });
    expect(b.blocks.count).toBe(8);
    // The write log keeps the blocks as placed.
    const pos: Pos = [0, 0, 0];
    expect(b.log.peek(pos)?.states.shape).toBeUndefined();
  });
});
