// UCW model synthesis against hand-built loaded files. Blockstates, models
// and rules are hand-written in the shape of the mods' files; nothing is
// copied from a jar.

import { describe, expect, it } from "vitest";

import type { LoadedModAssets, LoadedModMeta } from "../../../types";
import type {
  GeneratedBlockFiles,
  GeneratedBlockResolved,
  GeneratedVanillaAssets,
} from "../../types";
import { chiselBlock, chiselVariant } from "../chisel";
import {
  flattenUcwVanillaState,
  ucwGeneratedTextureId,
  ucwStateTexture,
  ucwTextureSuffix,
} from "../model";
import { UCW_PROVIDER } from "../provider";
import {
  parseUcwRuleFile,
  UCW_RULES_FORMAT_VERSION,
  type UcwRuleFile,
} from "../rules";

function ruleFile(path: string, json: unknown): UcwRuleFile {
  const warnings: string[] = [];
  const file = parseUcwRuleFile(path, json, warnings);
  expect(warnings).toEqual([]);
  return file!;
}

const NATURA_RULES = ruleFile("chisel/natura.json", {
  modid: ["chisel", "natura"],
  blocks: [
    {
      from: { block: "natura:nether_planks", iterate: ["type"] },
      mode: "plank",
      through: { block: "chisel:planks-oak", iterate: ["variation"] },
      based_upon: { state: "minecraft:planks#variant=oak" },
    },
  ],
});

// Chisel 1.12-style blockstate: variants named after the variations, in an
// order unrelated to `variation`'s. `clean` is variation 0, `double` 4.
const CHISEL_ASSETS: Partial<LoadedModAssets> = {
  blockstates: {
    "chisel:planks-oak": {
      forge_marker: 1,
      defaults: { model: "cube_all" },
      variants: {
        double: [
          {
            model: "cube_column",
            textures: {
              side: "chisel:blocks/planks-oak/double-side",
              end: "chisel:blocks/planks-oak/double-top",
            },
          },
        ],
        clean: [{ textures: { all: "chisel:blocks/planks-oak/clean" } }],
        short: [
          {
            model: "chisel:cube_ctm",
            textures: { all: "chisel:blocks/planks-oak/short" },
            y: 90,
          },
        ],
      },
    },
  },
  models: {
    // Like Chisel's own CTM model: its own concrete texture plus `#all`.
    "chisel:block/cube_ctm": {
      parent: "block/cube_all",
      textures: { connected_tex: "chisel:blocks/planks-oak/short-ctm" },
    },
  },
};

const NETHER_PLANKS_TYPES = ["ghostwood", "bloodwood", "darkwood", "fusewood"];
const NATURA_ASSETS: Partial<LoadedModAssets> = {
  blockstates: {
    "natura:nether_planks": {
      forge_marker: 1,
      defaults: { model: "cube_all" },
      variants: {
        type: Object.fromEntries(
          NETHER_PLANKS_TYPES.map((type) => [
            type,
            { textures: { all: `natura:blocks/nether_planks_${type}` } },
          ]),
        ),
      },
    },
  },
};

const CUBE = {
  from: [0, 0, 0],
  to: [16, 16, 16],
  faces: Object.fromEntries(
    ["down", "up", "north", "south", "west", "east"].map((face) => [
      face,
      { texture: "#all", cullface: face },
    ]),
  ),
};

const VANILLA: GeneratedVanillaAssets = {
  blockstate: (id) =>
    id === "minecraft:oak_planks"
      ? { variants: { "": { model: "minecraft:block/oak_planks" } } }
      : undefined,
  model: (id) =>
    ({
      "minecraft:block/cube_all": {
        textures: { particle: "#all" },
        elements: [CUBE],
      },
      "minecraft:block/cube_column": { textures: { particle: "#side" } },
      "minecraft:block/oak_planks": {
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/oak_planks" },
      },
    })[id],
  texture: () => null,
};

function fakeFiles(
  mods: Record<string, Partial<LoadedModAssets>>,
  vanilla: GeneratedVanillaAssets | null = VANILLA,
): GeneratedBlockFiles {
  const all: Record<string, Partial<LoadedModAssets>> = {
    unlimitedchiselworks: {
      providerData: {
        unlimitedchiselworks: {
          formatVersion: UCW_RULES_FORMAT_VERSION,
          files: [NATURA_RULES],
        },
      },
    },
    ...mods,
  };
  const metas = new Map<string, LoadedModMeta>();
  const assets = new Map<string, LoadedModAssets>();
  Object.entries(all).forEach(([namespace, mod], index) => {
    const meta = {
      key: `${index}:1.12.2`,
      gameVersion: "1.12.2",
      namespaces: [namespace],
      blocks: Object.keys(mod.blockstates ?? {}).map((id) => ({
        id,
        displayName: id,
        properties: {},
      })),
    } as unknown as LoadedModMeta;
    metas.set(namespace, meta);
    assets.set(meta.key, {
      blockstates: {},
      models: {},
      textures: {},
      textureMeta: {},
      ...mod,
    });
  });
  return {
    gameVersion: "1.12.2",
    files: [...metas.values()],
    fileForNamespace: (namespace) => metas.get(namespace) ?? null,
    blocks: (namespace) =>
      new Map(
        (metas.get(namespace)?.blocks ?? []).map((block) => [block.id, block]),
      ),
    assets: (file) => assets.get(file.key) ?? null,
    providerData: (namespace) =>
      assets.get(metas.get(namespace)?.key ?? "")?.providerData?.[namespace],
    vanilla,
  };
}

const ID = "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_2";
const SUFFIX = "natura_nether_planks_2";
const generated = (texture: string) =>
  `ucw_generated:ucw_ucw_${SUFFIX}/chisel/blocks/planks-oak/${texture}`;

function resolveNatura(files: GeneratedBlockFiles): GeneratedBlockResolved {
  const resolution = UCW_PROVIDER.resolve(ID, { variation: "0" }, files);
  if (resolution.kind !== "resolved") throw new Error(resolution.kind);
  return resolution;
}

describe("chisel table", () => {
  it("splits families into blocks of 16 and stops at unused slots", () => {
    expect(chiselBlock("chisel:planks-oak")?.variants).toHaveLength(15);
    expect(chiselBlock("chisel:stonebrick")).toMatchObject({
      blockstate: "chisel:stone",
      variants: expect.arrayContaining(["cracked", "layers"]),
    });
    expect(chiselBlock("chisel:stonebrick1")?.variants).toEqual([
      "mosaic",
      "ornate",
      "panel",
      "road",
      "slanted",
      "zag",
      "circularct",
      "weaver",
      "bricks-chaotic",
      "cuts",
    ]);
    expect(chiselBlock("chisel:stonebrick2")?.variants[0]).toBe("bricks-small");
    expect(chiselBlock("chisel:stonebrick3")).toBeNull();
    expect(chiselBlock("chisel:glassdyedlightgray")?.blockstate).toBe(
      "chisel:glass_stained/lightgray",
    );
    expect(chiselBlock("chisel:marble")).toBeNull();
  });

  it("maps a variation to its lower-cased variant", () => {
    expect(chiselVariant("chisel:dirt", { variation: "4" })).toEqual({
      blockstate: "chisel:dirt",
      variant: "reinforcedcobbledirt",
    });
    expect(chiselVariant("chisel:planks-oak", { variation: "15" })).toBeNull();
    expect(chiselVariant("chisel:planks-oak", {})).toBeNull();
  });
});

describe("UCW texture names", () => {
  it("follows UCWUtils.toUcwGenerated", () => {
    const suffix = ucwTextureSuffix("natura:nether_planks", 2);
    expect(suffix).toBe(SUFFIX);
    expect(
      ucwGeneratedTextureId("chisel:blocks/planks-oak/clean", suffix),
    ).toBe(generated("clean"));
    expect(ucwGeneratedTextureId("blocks/stone", "x_0")).toBe(
      "ucw_generated:ucw_ucw_x_0/minecraft/blocks/stone",
    );
  });
});

describe("flattenUcwVanillaState", () => {
  it("flattens 1.12 states through their metadata", () => {
    expect(
      flattenUcwVanillaState({
        block: "minecraft:planks",
        properties: { variant: "spruce" },
      }),
    ).toEqual({ block: "minecraft:spruce_planks", properties: {} });
    expect(
      flattenUcwVanillaState({
        block: "minecraft:stonebrick",
        properties: { variant: "stonebrick" },
      }),
    ).toEqual({ block: "minecraft:stone_bricks", properties: {} });
    expect(
      flattenUcwVanillaState({ block: "minecraft:nope", properties: {} }),
    ).toBeNull();
  });
});

describe("ucwStateTexture", () => {
  const files = fakeFiles({ chisel: CHISEL_ASSETS, natura: NATURA_ASSETS });

  it("reads a modded state's Forge variant textures", () => {
    expect(
      ucwStateTexture(
        { block: "natura:nether_planks", properties: { type: "darkwood" } },
        files,
      ),
    ).toBe("natura:blocks/nether_planks_darkwood");
  });

  it("reads a vanilla state's flattened model", () => {
    expect(
      ucwStateTexture(
        { block: "minecraft:planks", properties: { variant: "oak" } },
        files,
      ),
    ).toBe("minecraft:block/oak_planks");
    expect(
      ucwStateTexture(
        { block: "minecraft:planks", properties: { variant: "oak" } },
        fakeFiles({ chisel: CHISEL_ASSETS, natura: NATURA_ASSETS }, null),
      ),
    ).toBe("minecraft:missingno");
  });
});

describe("UCW_PROVIDER render output", () => {
  it("synthesizes a blockstate over every drawable through state", () => {
    const resolution = resolveNatura(
      fakeFiles({ chisel: CHISEL_ASSETS, natura: NATURA_ASSETS }),
    );
    const model = (key: string) =>
      `unlimitedchiselworks:block/ucw_generated/chisel_planks_oak_natura_nether_planks_2/${key}`;
    // Variations 0 (clean), 1 (short) and 4 (double) have variants.
    expect(resolution.blockstate).toEqual({
      variants: {
        "variation=0": { model: model("variation_0") },
        "variation=1": { model: model("variation_1"), y: 90 },
        "variation=4": { model: model("variation_4") },
      },
    });
    expect(resolution.models).toEqual({
      [model("variation_0")]: {
        parent: "minecraft:block/cube_all",
        textures: { all: generated("clean") },
      },
      // The CTM model's own texture is remapped too.
      [model("variation_1")]: {
        parent: "chisel:block/cube_ctm",
        textures: {
          connected_tex: generated("short-ctm"),
          all: generated("short"),
        },
      },
      [model("variation_4")]: {
        parent: "minecraft:block/cube_column",
        textures: {
          side: generated("double-side"),
          end: generated("double-top"),
        },
      },
    });
  });

  it("recolours every through texture with the rule's sources", () => {
    const resolution = resolveNatura(
      fakeFiles({ chisel: CHISEL_ASSETS, natura: NATURA_ASSETS }),
    );
    expect(resolution.textures.map((recipe) => recipe.id)).toEqual(
      ["clean", "double-side", "double-top", "short", "short-ctm"].map(
        generated,
      ),
    );
    // Meta 2 is darkwood in the blockstate's order; no overlay → from.
    expect(resolution.textures[0]).toEqual({
      id: generated("clean"),
      sources: [
        "chisel:blocks/planks-oak/clean",
        "natura:blocks/nether_planks_darkwood",
        "minecraft:block/oak_planks",
      ],
      params: {
        through: "chisel:blocks/planks-oak/clean",
        from: "natura:blocks/nether_planks_darkwood",
        overlay: "natura:blocks/nether_planks_darkwood",
        basedUpon: "minecraft:block/oak_planks",
        mode: "plank",
      },
    });
  });

  it("draws nothing when the through blockstate isn't there", () => {
    const resolution = resolveNatura(
      fakeFiles({ chisel: {}, natura: NATURA_ASSETS }),
    );
    expect(resolution.blockstate).toBeNull();
    expect(resolution.models).toEqual({});
    expect(resolution.textures).toEqual([]);
  });

  it("falls back to the un-recoloured Chisel block without the from mod", () => {
    const resolution = UCW_PROVIDER.resolve(
      ID,
      { variation: "4" },
      fakeFiles({ chisel: CHISEL_ASSETS }),
    );
    if (resolution.kind !== "needs-mods") throw new Error(resolution.kind);
    expect(resolution.namespaces).toEqual(["natura"]);
    expect(resolution.fallback).toEqual({
      id: "chisel:planks-oak",
      properties: { variation: "4" },
    });
    const model = `unlimitedchiselworks:block/ucw_fallback/chisel_planks_oak_natura_nether_planks_2/variation_4`;
    expect(resolution.fallbackModels?.models[model]).toEqual({
      parent: "minecraft:block/cube_column",
      textures: {
        side: "chisel:blocks/planks-oak/double-side",
        end: "chisel:blocks/planks-oak/double-top",
      },
    });
  });

  it("has no fallback without Chisel", () => {
    const resolution = UCW_PROVIDER.resolve(ID, {}, fakeFiles({}));
    if (resolution.kind !== "needs-mods") throw new Error(resolution.kind);
    expect(resolution.namespaces).toEqual(["chisel", "natura"]);
    expect(resolution).not.toHaveProperty("fallback");
    expect(resolution).not.toHaveProperty("fallbackModels");
  });
});
