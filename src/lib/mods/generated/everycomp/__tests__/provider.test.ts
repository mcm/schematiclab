// The Every Compat provider end to end, with hand-made Every Compat,
// Another Furniture and "Biomes O' Plenty" files for 1.21.1 (blockstates,
// models and solid-colour synthetic textures written here; nothing is copied
// from a jar) and the generated Every Compat table.

import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as modRegistry from "../../../registry";
import * as store from "../../../store";
import { generatedNeedsModsMessage } from "../../labels";
import {
  __setGeneratedVanillaLoaderForTests,
  enumerateGeneratedBlocks,
  loadGeneratedBlockFiles,
  resolveGeneratedBlock,
} from "../../registry";
import {
  __resetGeneratedTextureCacheForTests,
  loadGeneratedBlockRender,
} from "../../render";
import type { GeneratedVanillaAssets } from "../../types";
import {
  assets,
  cubeAll,
  image,
  meta,
  png,
  single,
  VERSION,
} from "./ec-test-files";

const EVERYCOMP = meta(1, "everycomp", []);
const EVERYCOMP_ASSETS = assets({
  textures: {
    // transparent where the template is recoloured
    "everycomp:block/af/planter_box_top_sides_mask": png(
      [[0, 0, 0]],
      [0, 0, 255, 255],
    ),
  },
  providerData: {
    everycomp: { lang: { "block_type.another_furniture.bench": "%s Bench" } },
  },
});

const FURNITURE = meta(
  2,
  "another_furniture",
  ["another_furniture:oak_bench", "another_furniture:oak_flower_box"],
  {
    "another_furniture:oak_bench": {
      facing: ["east", "north", "south", "west"],
    },
  },
);
const FURNITURE_ASSETS = assets({
  blockstates: {
    "another_furniture:oak_bench": {
      variants: {
        "facing=north": { model: "another_furniture:block/bench/oak" },
        "facing=east": { model: "another_furniture:block/bench/oak", y: 90 },
      },
    },
    "another_furniture:oak_flower_box": single(
      "another_furniture:block/flower_box/oak",
    ),
  },
  models: {
    "another_furniture:block/bench/oak": {
      parent: "another_furniture:block/bench/template",
      textures: {
        bench: "another_furniture:block/bench/oak",
        planks: "minecraft:block/oak_planks",
      },
    },
    "another_furniture:block/bench/template": {
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 8, 16],
          faces: { up: { texture: "#bench" }, north: { texture: "#planks" } },
        },
      ],
    },
    "another_furniture:block/flower_box/oak": {
      parent: "minecraft:block/cube_all",
      textures: { all: "another_furniture:block/flower_box/oak_top_sides" },
    },
  },
  textures: {
    "another_furniture:block/bench/oak": png([
      [120, 90, 50],
      [160, 120, 70],
      [200, 160, 100],
    ]),
    "another_furniture:block/flower_box/oak_top_sides": png([
      [120, 90, 50],
      [180, 140, 90],
    ]),
  },
});

const BOP = meta(3, "biomesoplenty", [
  "biomesoplenty:fir_planks",
  "biomesoplenty:fir_log",
]);
const BOP_ASSETS = assets({
  blockstates: {
    "biomesoplenty:fir_planks": single("biomesoplenty:block/fir_planks"),
    "biomesoplenty:fir_log": single("biomesoplenty:block/fir_log"),
  },
  models: {
    "biomesoplenty:block/fir_planks": cubeAll("biomesoplenty:block/fir_planks"),
    "biomesoplenty:block/fir_log": {
      parent: "minecraft:block/cube_column",
      textures: {
        end: "biomesoplenty:block/fir_log_top",
        side: "biomesoplenty:block/fir_log",
      },
    },
  },
  textures: {
    "biomesoplenty:block/fir_planks": png([
      [90, 100, 120],
      [130, 140, 160],
      [170, 180, 200],
    ]),
    "biomesoplenty:block/fir_log": png([[60, 60, 70]]),
    "biomesoplenty:block/fir_log_top": png([[100, 100, 110]]),
  },
});

const VANILLA: GeneratedVanillaAssets = {
  blockstate: (id) =>
    id === "minecraft:oak_planks"
      ? single("minecraft:block/oak_planks")
      : undefined,
  model: (id) =>
    ({
      "minecraft:block/cube_all": { textures: { particle: "#all" } },
      "minecraft:block/oak_planks": cubeAll("minecraft:block/oak_planks"),
    })[id],
  texture: (id) =>
    id === "minecraft:block/oak_planks"
      ? image([
          [120, 90, 50],
          [160, 120, 70],
          [200, 160, 100],
        ])
      : null,
};

const BENCH = "everycomp:af/biomesoplenty/fir_bench";
const FLOWER_BOX = "everycomp:af/biomesoplenty/fir_flower_box";

async function loadAll(withEveryCompat = true) {
  await modRegistry.addLoadedMods([
    ...(withEveryCompat ? [{ meta: EVERYCOMP, assets: EVERYCOMP_ASSETS }] : []),
    { meta: FURNITURE, assets: FURNITURE_ASSETS },
    { meta: BOP, assets: BOP_ASSETS },
  ]);
  await loadGeneratedBlockFiles(VERSION);
}

beforeEach(async () => {
  await store.__resetModStoreForTests();
  modRegistry.__resetLoadedModsForTests();
  globalThis.indexedDB = new IDBFactory();
  __setGeneratedVanillaLoaderForTests(async () => VANILLA);
  __resetGeneratedTextureCacheForTests();
});

afterEach(() => {
  __setGeneratedVanillaLoaderForTests(null);
});

describe("Every Compat provider", () => {
  it("enumerates the furniture of a detected wood type", async () => {
    await loadAll();
    const ids = enumerateGeneratedBlocks(VERSION).map((b) => b.id);
    expect(ids).toContain(BENCH);
    expect(ids).toContain(FLOWER_BOX);
    // vanilla woods are the supported mod's own blocks
    expect(ids).not.toContain("everycomp:af/minecraft/oak_bench");
  });

  it("resolves a block to its rewritten blockstate and models", async () => {
    await loadAll();
    const resolution = resolveGeneratedBlock(
      BENCH,
      { facing: "east" },
      VERSION,
    );
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.provider).toBe("everycomp");
    expect(resolution.block.displayName).toBe("Fir Bench");
    expect(resolution.block.properties).toEqual({
      facing: ["east", "north", "south", "west"],
    });
    expect(resolution.sourceNamespaces).toEqual([
      "another_furniture",
      "biomesoplenty",
    ]);
    expect(resolution.blockstate).toEqual({
      variants: {
        "facing=north": { model: "everycomp:block/af/biomesoplenty/bench/fir" },
        "facing=east": {
          model: "everycomp:block/af/biomesoplenty/bench/fir",
          y: 90,
        },
      },
    });
    expect(resolution.models).toEqual({
      "everycomp:block/af/biomesoplenty/bench/fir": {
        // the parent isn't copied (as in game, a template that's no oak
        // variant stays the mod's)
        parent: "another_furniture:block/bench/template",
        textures: {
          bench: "everycomp:block/af/biomesoplenty/bench/fir",
          // oak planks are swapped for the wood's own planks
          planks: "biomesoplenty:block/fir_planks",
        },
      },
    });
    expect(resolution.textures).toHaveLength(1);
    expect(resolution.textures[0]).toMatchObject({
      id: "everycomp:block/af/biomesoplenty/bench/fir",
      sources: [
        "another_furniture:block/bench/oak",
        "biomesoplenty:block/fir_planks",
      ],
    });
  });

  it("recolours the template texture with the wood's planks palette", async () => {
    await loadAll();
    const render = await loadGeneratedBlockRender([BENCH, FLOWER_BOX], VERSION);
    const bench = render.textures.get(
      "everycomp:block/af/biomesoplenty/bench/fir",
    );
    expect(bench).toBeDefined();
    // luminance ranks map onto the fir planks' colours
    const pixels = new Set<string>();
    for (let i = 0; i < bench!.image.data.length; i += 4) {
      pixels.add([...bench!.image.data.subarray(i, i + 3)].join(","));
    }
    expect([...pixels].sort()).toEqual([
      "130,140,160",
      "170,180,200",
      "90,100,120",
    ]);

    // the mask keeps the opaque mask pixels unchanged
    const box = render.textures.get(
      "everycomp:block/af/biomesoplenty/flower_box/fir_top_sides",
    );
    expect(box).toBeDefined();
    const px = (i: number) =>
      [...box!.image.data.subarray(i * 4, i * 4 + 3)].join(",");
    expect(px(2)).toBe("120,90,50");
    expect(px(0)).not.toBe("120,90,50");
    expect(render.blocks.get(BENCH)?.appearance).toBeDefined();
  });

  it("asks for Every Compat when its jar isn't loaded", async () => {
    await loadAll(false);
    const resolution = resolveGeneratedBlock(BENCH, {}, VERSION);
    expect(resolution).toMatchObject({
      kind: "needs-mods",
      provider: "everycomp",
      namespaces: ["everycomp"],
      fallback: { id: "another_furniture:oak_bench" },
    });
    if (resolution.kind === "needs-mods") {
      expect(
        generatedNeedsModsMessage(resolution, "Every Compat", VERSION),
      ).toBe(
        "Generated by Every Compat from biomesoplenty:fir — load everycomp for 1.21.1 to resolve it",
      );
    }
  });

  it("asks for the wood mod when its type isn't detected", async () => {
    await modRegistry.addLoadedMods([
      { meta: EVERYCOMP, assets: EVERYCOMP_ASSETS },
      { meta: FURNITURE, assets: FURNITURE_ASSETS },
    ]);
    await loadGeneratedBlockFiles(VERSION);
    expect(resolveGeneratedBlock(BENCH, {}, VERSION)).toMatchObject({
      kind: "needs-mods",
      namespaces: ["biomesoplenty"],
    });
  });

  it("doesn't apply to other Minecraft versions or unknown names", async () => {
    await loadAll();
    expect(resolveGeneratedBlock(BENCH, {}, "1.20.1").kind).toBe(
      "unrecognised",
    );
    expect(
      resolveGeneratedBlock("everycomp:zz/biomesoplenty/fir_bench", {}, VERSION)
        .kind,
    ).toBe("unrecognised");
  });
});
