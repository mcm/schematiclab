// Render output of generated blocks through the registry, with the UCW
// provider and the hand-made mod files of `ucw-test-files.ts`.

import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as modRegistry from "../../registry";
import * as store from "../../store";
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
import { UCW_PROVIDER } from "../ucw/provider";
import {
  ID,
  NATURA_ASSETS,
  TEXTURE,
  UCW,
  UCW_ASSETS,
  VANILLA,
  loadAll,
  makeMeta,
} from "./ucw-test-files";

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
