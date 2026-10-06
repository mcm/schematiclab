import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockShape, blockShapeOfKind, type ShapeBox } from "../block-shapes";

const ASSETS = path.resolve(__dirname, "../../../../public/minecraft-assets");
const readJson = (file: string) =>
  JSON.parse(readFileSync(path.join(ASSETS, file), "utf8")) as Record<
    string,
    unknown
  >;

interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
}
interface Model {
  parent?: string;
  elements?: ModelElement[];
}
interface Apply {
  model: string;
  x?: number;
  y?: number;
}
type When = Record<string, string> | { OR: When[] } | { AND: When[] };
interface Blockstate {
  variants?: Record<string, Apply | Apply[]>;
  multipart?: { apply: Apply | Apply[]; when?: When }[];
}

const models = readJson("models.json") as Record<string, Model>;
const blockstates = readJson("blockstates.json") as Record<string, Blockstate>;

const bare = (name: string) =>
  name.replace(/^minecraft:/, "").replace(/^block\//, "");

function elementsOf(name: string): ModelElement[] {
  let model: Model | undefined = models[bare(name)];
  while (model !== undefined && model.elements === undefined) {
    model = model.parent === undefined ? undefined : models[bare(model.parent)];
  }
  return model?.elements ?? [];
}

// Cells of a 16³ grid, as "x,y,z", sampled at cell centres.
function occupancy(boxes: readonly ShapeBox[]): Set<string> {
  const cells = new Set<string>();
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          const [cx, cy, cz] = [(x + 0.5) / 16, (y + 0.5) / 16, (z + 0.5) / 16];
          if (cx > x0 && cx < x1 && cy > y0 && cy < y1 && cz > z0 && cz < z1) {
            cells.add(`${x},${y},${z}`);
          }
        }
      }
    }
  }
  return cells;
}

// The boxes of a blockstate model, rotated as the blockstate says.
function modelBoxes(apply: Apply): ShapeBox[] {
  if (apply.x !== undefined && apply.x !== 0 && apply.x !== 180) {
    throw new Error(`unsupported x rotation ${apply.x}`);
  }
  return elementsOf(apply.model).map(({ from, to }) => {
    let [x0, y0, z0, x1, y1, z1] = [...from, ...to].map((v) => v / 16);
    if (apply.x === 180) [y0, z0, y1, z1] = [1 - y1, 1 - z1, 1 - y0, 1 - z0];
    for (let i = 0; i < (apply.y ?? 0) / 90; i++) {
      [x0, z0, x1, z1] = [1 - z1, x0, 1 - z0, x1];
    }
    return [x0, y0, z0, x1, y1, z1];
  });
}

function matches(
  when: When | undefined,
  state: Record<string, string>,
): boolean {
  if (when === undefined) return true;
  if ("OR" in when && Array.isArray(when.OR)) {
    return when.OR.some((w) => matches(w, state));
  }
  if ("AND" in when && Array.isArray(when.AND)) {
    return when.AND.every((w) => matches(w, state));
  }
  return Object.entries(when as Record<string, string>).every(([k, v]) =>
    v.split("|").includes(state[k]),
  );
}

const first = (apply: Apply | Apply[]) =>
  Array.isArray(apply) ? apply[0] : apply;

// Every state of a block with the boxes of its vanilla model.
function vanillaStates(
  block: string,
  domains: Record<string, string[]> = {},
): [Record<string, string>, ShapeBox[]][] {
  const blockstate = blockstates[block];
  if (blockstate.variants !== undefined) {
    return Object.entries(blockstate.variants).map(([key, apply]) => [
      Object.fromEntries(key.split(",").map((kv) => kv.split("="))),
      modelBoxes(first(apply)),
    ]);
  }
  let states: Record<string, string>[] = [{}];
  for (const [name, values] of Object.entries(domains)) {
    states = states.flatMap((s) => values.map((v) => ({ ...s, [name]: v })));
  }
  return states.map((state) => [
    state,
    (blockstate.multipart ?? [])
      .filter((part) => matches(part.when, state))
      .flatMap((part) => modelBoxes(first(part.apply))),
  ]);
}

const CUBE: ShapeBox[] = [[0, 0, 0, 1, 1, 1]];
const sides = (values: string[]) =>
  Object.fromEntries(
    ["north", "east", "south", "west"].map((s) => [s, values]),
  );

describe("blockShape", () => {
  it.each([
    ["oak_stairs", {}],
    ["stone_brick_stairs", {}],
    ["oak_slab", {}],
    ["oak_door", {}],
    ["iron_door", {}],
    ["oak_trapdoor", {}],
    ["iron_trapdoor", {}],
    ["white_carpet", {}],
    ["moss_carpet", {}],
    ["oak_fence", sides(["true", "false"])],
    ["nether_brick_fence", sides(["true", "false"])],
    ["glass_pane", sides(["true", "false"])],
    ["red_stained_glass_pane", sides(["true", "false"])],
    [
      "cobblestone_wall",
      { up: ["true", "false"], ...sides(["none", "low", "tall"]) },
    ],
  ] as [string, Record<string, string[]>][])(
    "matches the vanilla model of every %s state",
    (block, domains) => {
      const states = vanillaStates(block, domains);
      expect(states.length).toBeGreaterThan(0);
      for (const [state, boxes] of states) {
        const shape = blockShape(`minecraft:${block}`, state) ?? CUBE;
        expect(
          [...occupancy(shape)].sort(),
          `${block}[${JSON.stringify(state)}]`,
        ).toEqual([...occupancy(boxes)].sort());
      }
    },
  );

  it("draws a bottom stair facing north as a slab and a north step", () => {
    expect(
      blockShape("minecraft:oak_stairs", {
        facing: "north",
        half: "bottom",
        shape: "straight",
      }),
    ).toEqual([
      [0, 0, 0, 1, 0.5, 1],
      [0, 0.5, 0, 1, 1, 0.5],
    ]);
  });

  it("draws a step as the copycat step's shape-pack pieces", () => {
    const pack = JSON.parse(
      readFileSync(path.resolve(ASSETS, "../camo-shapes/create.json"), "utf8"),
    ) as {
      blocks: Record<
        string,
        {
          when: Record<string, string>;
          pieces: {
            select: { from: number[]; to: number[] };
            offset?: number[];
          }[];
        }[]
      >;
    };
    const rules = pack.blocks["create:copycat_step"];
    expect(rules).toHaveLength(8);
    for (const { when, pieces } of rules) {
      const boxes = pieces.map(({ select, offset = [0, 0, 0] }) => {
        const [x0, y0, z0] = select.from.map((v, i) => (v + offset[i]) / 16);
        const [x1, y1, z1] = select.to.map((v, i) => (v + offset[i]) / 16);
        return [x0, y0, z0, x1, y1, z1] as const;
      });
      const shape = blockShapeOfKind("step", when);
      expect(shape, JSON.stringify(when)).toBeDefined();
      expect([...occupancy(shape!)].sort(), JSON.stringify(when)).toEqual(
        [...occupancy(boxes)].sort(),
      );
    }
    expect(
      blockShapeOfKind("step", { facing: "south", half: "bottom" }),
    ).toEqual([[0, 0, 0.5, 1, 0.5, 1]]);
    expect(blockShapeOfKind("step", { facing: "south" })).toBeUndefined();
  });

  it("reads slabs, pre-1.13 slabs and double slabs", () => {
    expect(blockShape("minecraft:stone_slab", { type: "top" })).toEqual([
      [0, 0.5, 0, 1, 1, 1],
    ]);
    expect(blockShape("minecraft:stone_slab", { half: "bottom" })).toEqual([
      [0, 0, 0, 1, 0.5, 1],
    ]);
    expect(
      blockShape("minecraft:stone_slab", { type: "double" }),
    ).toBeUndefined();
    expect(blockShape("minecraft:double_stone_slab", {})).toBeUndefined();
  });

  it("draws iron bars and copper bars as panes", () => {
    const shape = blockShape("minecraft:iron_bars", {
      north: "true",
      east: "false",
      south: "false",
      west: "false",
    });
    expect(shape).toEqual([
      [7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16],
      [7 / 16, 0, 0, 9 / 16, 1, 7 / 16],
    ]);
    expect(
      blockShape("minecraft:copper_bars", { north: "false", east: "false" }),
    ).toEqual([[7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16]]);
  });

  it("connects pre-1.16 walls with `true` as low sides", () => {
    expect(
      blockShape("minecraft:cobblestone_wall", { up: "false", east: "true" }),
    ).toEqual([[0.5, 0, 5 / 16, 1, 14 / 16, 11 / 16]]);
  });

  it("keeps every other block, and shapes missing their properties, full cubes", () => {
    expect(blockShape("minecraft:stone", {})).toBeUndefined();
    expect(
      blockShape("minecraft:oak_fence_gate", { facing: "north" }),
    ).toBeUndefined();
    expect(blockShape("minecraft:oak_stairs", {})).toBeUndefined();
    expect(blockShape("minecraft:oak_door", {})).toBeUndefined();
    expect(blockShape("minecraft:oak_fence", {})).toBeUndefined();
    expect(
      blockShape("minecraft:oak_wall_sign", { facing: "north" }),
    ).toBeUndefined();
  });
});
