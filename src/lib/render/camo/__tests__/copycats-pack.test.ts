import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { Identifier, type Resources, type UV } from "deepslate";

import vanillaBlockstates from "../../../../../public/minecraft-assets/blockstates.json";
import vanillaModels from "../../../../../public/minecraft-assets/models.json";
import { toNbtCompoundValue } from "../../../nbt-value";
import * as nbt from "../../../schemlib/nbt";
import { fromSnbt } from "../../../schemlib/snbt";
import { MISSING_TEXTURE_ID } from "../../atlas-layout";
import {
  assembleResources,
  createVanillaBlockData,
  type VanillaBlockData,
} from "../../block-resources";
import { CamoTable, withCamoProperty } from "../camo-table";
import { validateShapePack, type ShapePack } from "../shape-pack";

// The committed Copycats+ and Create packs (`pnpm gen:camo-shapes`), rendered
// through the real resources with vanilla camos.

const UV_MAP: Record<string, UV> = {
  [MISSING_TEXTURE_ID]: [0.5, 0.5, 0.75, 0.75],
  "minecraft:block/stone": [0, 0, 0.25, 0.25],
  "create:block/copycat_base": [0.25, 0, 0.5, 0.25],
  "minecraft:block/iron_bars": [0.5, 0, 0.75, 0.25],
  "minecraft:block/oak_trapdoor": [0.75, 0, 1, 0.25],
  "minecraft:block/oak_planks": [0, 0.25, 0.25, 0.5],
  "minecraft:block/bricks": [0.25, 0.25, 0.5, 0.5],
};
const ATLAS = { width: 4, height: 4 } as unknown as ImageData;
const rect = (id: string) => JSON.stringify(UV_MAP[id]);

function readPack(file: string): ShapePack {
  return validateShapePack(
    JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../../../../../public/camo-shapes", file),
        "utf8",
      ),
    ),
  );
}

// A stand-in for Create's `copycat_panel/bars` model (the real one is a
// Create asset, which tests can't use): one plane at z 1..1.05.
const BARS_MODEL = {
  textures: { particle: "block/iron_bars", edge: "block/iron_bars" },
  elements: [
    {
      from: [0, 0, 0.95],
      to: [16, 16, 1.05],
      faces: {
        north: { uv: [0, 0, 16, 16], texture: "#edge" },
        south: { uv: [16, 0, 0, 16], texture: "#edge" },
      },
    },
  ],
};

let vanilla: VanillaBlockData;
let packs: ShapePack[];

beforeAll(() => {
  vanilla = createVanillaBlockData(
    vanillaBlockstates as Record<string, unknown>,
    vanillaModels as Record<string, unknown>,
    ["minecraft:stone", "minecraft:bricks"],
  );
  packs = [readPack("copycats.json"), readPack("create.json")];
});

function setup() {
  const table = new CamoTable();
  const { resources } = assembleResources({
    vanilla,
    mods: [
      {
        blockstates: {},
        models: { "create:block/copycat_panel/bars": BARS_MODEL },
      },
    ],
    uvMap: UV_MAP,
    atlasImage: ATLAS,
    camo: {
      loadedNamespaces: new Set(["copycats", "create"]),
      packs,
      getTable: () => table,
    },
  });
  return { resources, table };
}

function place(
  table: CamoTable,
  blockId: string,
  props: Record<string, string>,
  snbt: string,
): Record<string, string> {
  const tag = fromSnbt(snbt);
  if (!(tag instanceof nbt.Compound)) throw new Error("not a compound");
  return withCamoProperty(table, blockId, props, toNbtCompoundValue(tag));
}

/** Texture rect → bounds of the quads using it, per axis [min, max]. */
function textureBounds(
  resources: Resources,
  blockId: string,
  props: Record<string, string>,
): Map<string, { x: number[]; y: number[]; z: number[] }> {
  const name = Identifier.parse(blockId);
  const quads = resources
    .getBlockDefinition(name)!
    .getMesh(name, props, resources, resources, {}).quads;
  const bounds = new Map<string, { x: number[]; y: number[]; z: number[] }>();
  for (const quad of quads) {
    const key = JSON.stringify(uvOf(quad.vertices()));
    const entry = bounds.get(key) ?? {
      x: [Infinity, -Infinity],
      y: [Infinity, -Infinity],
      z: [Infinity, -Infinity],
    };
    for (const v of quad.vertices()) {
      for (const axis of ["x", "y", "z"] as const) {
        entry[axis][0] = Math.min(entry[axis][0], v.pos[axis]);
        entry[axis][1] = Math.max(entry[axis][1], v.pos[axis]);
      }
    }
    bounds.set(key, entry);
  }
  return bounds;
}

/** The atlas rect in `UV_MAP` a quad's texture centre falls in. */
function uvOf(vertices: { texture?: number[] }[]): UV | undefined {
  const mean = (i: number) =>
    vertices.reduce((sum, v) => sum + (v.texture?.[i] ?? NaN), 0) /
    vertices.length;
  const [u, w] = [mean(0), mean(1)];
  return Object.values(UV_MAP).find(
    ([u0, v0, u1, v1]) => u > u0 && u < u1 && w > v0 && w < v1,
  );
}

const part = (material: string) =>
  `{material:${material},enableCT:1b,consumedItem:{}}`;
const STONE = `{Name:"minecraft:stone"}`;
const BASE = `{Name:"create:copycat_base"}`;

describe("copycats shape pack", () => {
  it("renders each multi-state slab part in its own half", () => {
    const { resources, table } = setup();
    const props = place(
      table,
      "copycats:copycat_slab",
      { axis: "y", type: "double" },
      `{material_data:{top:${part(STONE)},bottom:${part(BASE)}}}`,
    );
    const bounds = textureBounds(resources, "copycats:copycat_slab", props);
    expect([...bounds.keys()].sort()).toEqual(
      [rect("minecraft:block/stone"), rect("create:block/copycat_base")].sort(),
    );
    expect(bounds.get(rect("minecraft:block/stone"))!.y).toEqual([0.5, 1]);
    expect(bounds.get(rect("create:block/copycat_base"))!.y).toEqual([0, 0.5]);
  });

  it("takes a same-kind material's whole model with the copycat's properties", () => {
    const { resources, table } = setup();
    const connected = place(
      table,
      "copycats:copycat_fence",
      { north: "true", east: "false", south: "false", west: "false" },
      `{Material:{Name:"minecraft:oak_fence"}}`,
    );
    const bounds = textureBounds(
      resources,
      "copycats:copycat_fence",
      connected,
    );
    const planks = bounds.get(rect("minecraft:block/oak_planks"))!;
    // The oak fence post (6..10) plus its north arm, reaching z = 0.
    expect(planks.z[0]).toBe(0);
    expect(planks.x).toEqual([6 / 16, 10 / 16]);

    const post = place(
      table,
      "copycats:copycat_fence",
      { north: "false", east: "false", south: "false", west: "false" },
      `{Material:{Name:"minecraft:oak_fence"}}`,
    );
    expect(
      textureBounds(resources, "copycats:copycat_fence", post).get(
        rect("minecraft:block/oak_planks"),
      )!.z,
    ).toEqual([6 / 16, 10 / 16]);
  });
});

describe("create shape pack", () => {
  it("cuts a copycat panel 3 pixels thick", () => {
    const { resources, table } = setup();
    const props = place(
      table,
      "create:copycat_panel",
      { facing: "north" },
      `{Material:{Name:"minecraft:bricks"}}`,
    );
    const bounds = textureBounds(resources, "create:copycat_panel", props);
    expect([...bounds.keys()]).toEqual([rect("minecraft:block/bricks")]);
    expect(bounds.get(rect("minecraft:block/bricks"))!.z).toEqual([13 / 16, 1]);
  });

  it("renders an iron bars material with the bars model", () => {
    const { resources, table } = setup();
    const props = place(
      table,
      "create:copycat_panel",
      { facing: "south" },
      `{Material:{Name:"minecraft:iron_bars"}}`,
    );
    const bounds = textureBounds(resources, "create:copycat_panel", props);
    expect([...bounds.keys()]).toEqual([rect("minecraft:block/iron_bars")]);
    // The model's z 0.95..1.05 plane, turned to face south (y = 0).
    const z = bounds.get(rect("minecraft:block/iron_bars"))!.z;
    expect(z[0]).toBeCloseTo(0.95 / 16, 5);
    expect(z[1]).toBeCloseTo(1.05 / 16, 5);
  });

  it("renders a trapdoor material as the trapdoor itself", () => {
    const { resources, table } = setup();
    const props = place(
      table,
      "create:copycat_panel",
      { facing: "up" },
      `{Material:{Name:"minecraft:oak_trapdoor",Properties:{facing:"north",half:"bottom",open:"false"}}}`,
    );
    const bounds = textureBounds(resources, "create:copycat_panel", props);
    expect([...bounds.keys()]).toEqual([rect("minecraft:block/oak_trapdoor")]);
    expect(bounds.get(rect("minecraft:block/oak_trapdoor"))!.y).toEqual([
      0,
      3 / 16,
    ]);
  });

  it("gives each material rule a condition and a fallback rule after it", () => {
    const rules = packs[1].blocks["create:copycat_panel"];
    const conditions = rules.map((rule) => rule.material?.suffixes ?? null);
    expect(conditions.at(-1)).toBeNull();
    expect(conditions).toContainEqual(["_bars", "iron_bars"]);
    expect(conditions).toContainEqual(["trapdoor"]);
  });
});
