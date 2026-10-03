// Render output of generated blocks through the registry, with the UCW
// provider and hand-made mod files (rules, blockstates and solid-colour
// synthetic textures written here; nothing is copied from a jar).

import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RgbaImage } from "../../../render/block-appearance";
import { encodePng } from "../../../render/__tests__/encode-png";
import * as modRegistry from "../../registry";
import * as store from "../../store";
import type { LoadedModAssets, LoadedModMeta } from "../../types";
import {
  __resetGeneratedBlockStoreForTests,
  getGeneratedBlock,
  getGeneratedBlocksRevision,
  requestGeneratedBlocks,
  subscribeGeneratedBlocks,
} from "../block-store";
import {
  __setGeneratedVanillaLoaderForTests,
  getGeneratedBlockFiles,
} from "../registry";
import {
  __resetGeneratedTextureCacheForTests,
  generatedTextureCacheKey,
  isGeneratedBlockId,
  loadGeneratedBlockRender,
} from "../render";
import type { GeneratedVanillaAssets } from "../types";
import { UCW_PROVIDER } from "../ucw/provider";

function solid(rgb: [number, number, number], size = 2): RgbaImage {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([...rgb, 255], i * 4);
  return { width: size, height: size, data };
}

function png(rgb: [number, number, number]): Blob {
  const image = solid(rgb);
  return new Blob(
    [encodePng({ ...image, colorType: 6, scanlines: image.data })],
    {
      type: "image/png",
    },
  );
}

function makeMeta(
  modId: number,
  namespace: string,
  fileId = modId * 10,
): LoadedModMeta {
  return {
    key: `${modId}:1.12.2`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId,
    fileDisplayName: `mod-${modId}.jar`,
    gameVersion: "1.12.2",
    gameVersions: ["1.12.2"],
    loader: "forge",
    namespaces: [namespace],
    blocks: [],
    loadedAt: fileId,
  };
}

function assets(partial: Partial<LoadedModAssets>): LoadedModAssets {
  return {
    blockstates: {},
    models: {},
    textures: {},
    textureMeta: {},
    ...partial,
  };
}

const UCW = makeMeta(1, "unlimitedchiselworks");
const UCW_ASSETS = assets({
  providerData: {
    unlimitedchiselworks: {
      formatVersion: 1,
      files: [
        {
          path: "chisel/natura.json",
          modids: ["chisel", "natura"],
          loadLate: false,
          rules: [
            {
              from: {
                kind: "state",
                states: [
                  {
                    block: "natura:nether_planks",
                    properties: { type: "ghostwood" },
                  },
                ],
                list: false,
              },
              through: {
                kind: "block",
                block: "chisel:planks-oak",
                iterate: ["variation"],
              },
              basedUpon: {
                kind: "state",
                states: [
                  { block: "minecraft:planks", properties: { variant: "oak" } },
                ],
                list: false,
              },
              mode: "none",
              hasColor: false,
            },
          ],
        },
      ],
    },
  },
});

const CHISEL = makeMeta(2, "chisel");
const CHISEL_ASSETS = assets({
  blockstates: {
    "chisel:planks-oak": {
      forge_marker: 1,
      defaults: { model: "cube_all" },
      variants: {
        clean: [{ textures: { all: "chisel:blocks/planks-oak/clean" } }],
      },
    },
  },
  textures: { "chisel:blocks/planks-oak/clean": png([160, 130, 80]) },
});

const NATURA = makeMeta(3, "natura");
const NATURA_ASSETS = assets({
  blockstates: {
    "natura:nether_planks": {
      forge_marker: 1,
      defaults: { model: "cube_all" },
      variants: {
        type: {
          ghostwood: { textures: { all: "natura:blocks/ghostwood" } },
        },
      },
    },
  },
  textures: { "natura:blocks/ghostwood": png([200, 200, 210]) },
});

const ID = "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0";
const TEXTURE =
  "ucw_generated:ucw_ucw_natura_nether_planks_0/chisel/blocks/planks-oak/clean";

const CUBE_ALL = {
  textures: { particle: "#all" },
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: Object.fromEntries(
        ["down", "up", "north", "south", "west", "east"].map((face) => [
          face,
          { texture: "#all", cullface: face, tintindex: 0 },
        ]),
      ),
    },
  ],
};

const VANILLA: GeneratedVanillaAssets = {
  blockstate: (id) =>
    id === "minecraft:oak_planks"
      ? { variants: { "": { model: "minecraft:block/oak_planks" } } }
      : undefined,
  model: (id) =>
    ({
      "minecraft:block/cube_all": CUBE_ALL,
      "minecraft:block/oak_planks": {
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/oak_planks" },
      },
    })[id],
  texture: (id) =>
    id === "minecraft:block/oak_planks" ? solid([150, 120, 70]) : null,
};

beforeEach(async () => {
  await store.__resetModStoreForTests();
  modRegistry.__resetLoadedModsForTests();
  globalThis.indexedDB = new IDBFactory();
  __setGeneratedVanillaLoaderForTests(async () => VANILLA);
  __resetGeneratedTextureCacheForTests();
  __resetGeneratedBlockStoreForTests();
});

afterEach(() => {
  __setGeneratedVanillaLoaderForTests(null);
  vi.restoreAllMocks();
});

async function loadAll(natura = true) {
  await modRegistry.addLoadedMods([
    { meta: UCW, assets: UCW_ASSETS },
    { meta: CHISEL, assets: CHISEL_ASSETS },
    ...(natura ? [{ meta: NATURA, assets: NATURA_ASSETS }] : []),
  ]);
}

describe("isGeneratedBlockId", () => {
  it("is true in provider namespaces only", () => {
    expect(isGeneratedBlockId(ID)).toBe(true);
    expect(isGeneratedBlockId("chisel:planks-oak")).toBe(false);
    expect(isGeneratedBlockId("stone")).toBe(false);
  });
});

describe("generatedTextureCacheKey", () => {
  const recipe = {
    id: "x:generated/a",
    sources: ["a:b", "minecraft:block/c"],
    params: { mode: "none", through: "a:b" },
  };

  it("ignores the recipe id and param order", () => {
    const version = (id: string) => (id === "a:b" ? "file-1" : "vanilla");
    expect(generatedTextureCacheKey("p", recipe, version)).toBe(
      generatedTextureCacheKey(
        "p",
        { ...recipe, id: "x:other", params: { through: "a:b", mode: "none" } },
        version,
      ),
    );
  });

  it("changes with the provider, params and source files", () => {
    const key = generatedTextureCacheKey("p", recipe, () => "file-1");
    expect(generatedTextureCacheKey("q", recipe, () => "file-1")).not.toBe(key);
    expect(
      generatedTextureCacheKey(
        "p",
        { ...recipe, params: { mode: "blend", through: "a:b" } },
        () => "file-1",
      ),
    ).not.toBe(key);
    expect(generatedTextureCacheKey("p", recipe, () => "file-2")).not.toBe(key);
  });
});

describe("loadGeneratedBlockRender", () => {
  it("returns recoloured models, textures and an appearance", async () => {
    await loadAll();
    const render = await loadGeneratedBlockRender(
      [ID, ID, "minecraft:stone", "chisel:planks-oak"],
      "1.12.2",
    );
    expect(Object.keys(render.blockstates)).toEqual([ID]);
    expect(Object.values(render.models)).toEqual([
      { parent: "minecraft:block/cube_all", textures: { all: TEXTURE } },
    ]);
    expect([...render.textures.keys()]).toEqual([TEXTURE]);
    const texture = render.textures.get(TEXTURE)!;
    expect([texture.image.width, texture.image.height]).toEqual([2, 2]);
    // Recoloured towards the ghostwood planks: lighter than the oak through.
    expect(texture.image.data[0]).toBeGreaterThan(160);

    const block = render.blocks.get(ID)!;
    expect(block.displayName).toBe("Nether Planks (Planks Oak)");
    expect(block.appearance?.fullCube).toBe(true);
    // Untinted: a light grey, not foliage green.
    const [L, a, b] = block.appearance!.oklab;
    expect(L).toBeGreaterThan(0.8);
    expect(Math.abs(a)).toBeLessThan(0.03);
    expect(Math.abs(b)).toBeLessThan(0.05);
  });

  it("reuses generated textures across loads", async () => {
    await loadAll();
    const spy = vi.spyOn(UCW_PROVIDER, "generateTexture");
    const first = await loadGeneratedBlockRender([ID], "1.12.2");
    const second = await loadGeneratedBlockRender(
      [ID, "minecraft:stone"],
      "1.12.2",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.textures.get(TEXTURE)).toBe(first.textures.get(TEXTURE));

    // Replacing the from mod's file regenerates.
    await modRegistry.addLoadedMod(makeMeta(3, "natura", 31), NATURA_ASSETS);
    await loadGeneratedBlockRender([ID], "1.12.2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("draws the un-recoloured through block without the from mod", async () => {
    await loadAll(false);
    const render = await loadGeneratedBlockRender([ID], "1.12.2");
    expect(Object.values(render.models)).toEqual([
      {
        parent: "minecraft:block/cube_all",
        textures: { all: "chisel:blocks/planks-oak/clean" },
      },
    ]);
    expect(render.textures.size).toBe(0);
    expect(render.blocks.size).toBe(0);
  });

  it("leaves blocks out when nothing can be drawn", async () => {
    await modRegistry.addLoadedMod(UCW, UCW_ASSETS);
    const render = await loadGeneratedBlockRender([ID], "1.12.2");
    expect(render.blockstates).toEqual({});
    expect(getGeneratedBlockFiles("1.12.2").vanilla).toBe(VANILLA);
  });
});

describe("generated block store", () => {
  it("loads blocks in the background and notifies", async () => {
    await loadAll();
    const listener = vi.fn();
    const unsubscribe = subscribeGeneratedBlocks(listener);
    const revision = getGeneratedBlocksRevision();
    requestGeneratedBlocks(["minecraft:stone", ID], "1.12.2");
    expect(getGeneratedBlock(ID, "1.12.2")).toBeUndefined();
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(getGeneratedBlocksRevision()).toBe(revision + 1);
    expect(getGeneratedBlock(ID, "1.12.2")?.appearance).toBeDefined();
    expect(getGeneratedBlock(ID, "1.20.1")).toBeUndefined();

    // The same request for the same registry doesn't load again.
    requestGeneratedBlocks([ID], "1.12.2");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
