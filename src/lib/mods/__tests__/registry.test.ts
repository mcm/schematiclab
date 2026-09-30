import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as registry from "../registry";
import * as store from "../store";
import type { LoadedModAssets, LoadedModMeta } from "../types";

function makeMeta(
  modId: number,
  fileId: number,
  overrides: Partial<LoadedModMeta> = {},
): LoadedModMeta {
  return {
    key: `${modId}:${fileId}`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId,
    fileDisplayName: `mod-${modId}-${fileId}.jar`,
    gameVersions: ["1.20.1"],
    loader: "forge",
    namespaces: [`mod${modId}`],
    blocks: [
      {
        id: `mod${modId}:block_${fileId}`,
        displayName: `Block ${fileId}`,
        properties: { facing: ["east", "north"] },
      },
    ],
    loadedAt: fileId,
    ...overrides,
  };
}

function makeAssets(label: string): LoadedModAssets {
  return {
    blockstates: { [`${label}:thing`]: { variants: { "": { model: "x" } } } },
    models: {
      [`${label}:block/thing`]: { parent: "minecraft:block/cube_all" },
    },
    textures: {
      [`${label}:block/thing`]: new Blob([new Uint8Array([1, 2, 3])], {
        type: "image/png",
      }),
    },
    textureMeta: {},
  };
}

beforeEach(async () => {
  await store.__resetModStoreForTests();
  registry.__resetLoadedModsForTests();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mod store", () => {
  it("puts, lists and removes mods with their assets", async () => {
    const a = makeMeta(1, 10);
    const b = makeMeta(2, 20);
    await store.putLoadedMod(b, makeAssets("b"));
    await store.putLoadedMod(a, makeAssets("a"));

    expect(await store.listLoadedMods()).toEqual([a, b]);
    const assets = await store.getModAssets("2:20");
    expect(assets?.blockstates).toEqual(makeAssets("b").blockstates);
    const blob = assets?.textures["b:block/thing"];
    expect(blob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    await store.removeLoadedMod("2:20");
    expect(await store.listLoadedMods()).toEqual([a]);
    expect(await store.getModAssets("2:20")).toBeNull();
  });

  it("replaces another file of the same mod", async () => {
    await store.putLoadedMod(makeMeta(1, 10), makeAssets("old"));
    const replaced = await store.putLoadedMod(
      makeMeta(1, 11),
      makeAssets("new"),
    );

    expect(replaced).toEqual(["1:10"]);
    expect((await store.listLoadedMods()).map((m) => m.key)).toEqual(["1:11"]);
    expect(await store.getModAssets("1:10")).toBeNull();
  });
});

describe("loaded-mods registry", () => {
  it("hydrates from the store", async () => {
    await store.putLoadedMod(makeMeta(1, 10), makeAssets("a"));
    await store.__resetModStoreForTests();

    expect(registry.getSnapshot()).toEqual([]);
    await registry.hydrateLoadedMods();

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:10"]);
    expect(registry.getLoadedModBlockIds()).toEqual(new Set(["mod1:block_10"]));
    expect(registry.getModForBlockId("mod1:block_10")).toEqual({
      key: "1:10",
      modName: "Mod 1",
    });
    expect(registry.getModForBlockId("minecraft:stone")).toBeNull();
    expect(registry.getLoadedNamespaces()).toEqual(new Set(["mod1"]));
    const assets = await registry.getLoadedModAssets("1:10");
    expect(assets?.models).toEqual(makeAssets("a").models);
  });

  it("persists added mods across a reload", async () => {
    await registry.addLoadedMod(makeMeta(1, 10), makeAssets("a"));
    await registry.addLoadedMod(makeMeta(2, 20), makeAssets("b"));
    await registry.removeLoadedMod("2:20");

    await store.__resetModStoreForTests();
    registry.__resetLoadedModsForTests();
    await registry.hydrateLoadedMods();

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:10"]);
  });

  it("keeps one active file per mod", async () => {
    await registry.addLoadedMod(makeMeta(1, 10), makeAssets("old"));
    await registry.addLoadedMod(makeMeta(1, 11), makeAssets("new"));

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:11"]);
    expect(registry.getLoadedModBlockIds()).toEqual(new Set(["mod1:block_11"]));
    expect(await registry.getLoadedModAssets("1:10")).toBeNull();
    expect((await store.listLoadedMods()).map((m) => m.key)).toEqual(["1:11"]);
  });

  it("adds a batch with one notification, later files winning", async () => {
    await registry.hydrateLoadedMods();
    await registry.addLoadedMod(makeMeta(1, 10), makeAssets("old"));
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    await registry.addLoadedMods([
      { meta: makeMeta(1, 11), assets: makeAssets("a") },
      { meta: makeMeta(2, 20), assets: makeAssets("b") },
      { meta: makeMeta(2, 21), assets: makeAssets("c") },
    ]);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:11", "2:21"]);
    expect(await registry.getLoadedModAssets("2:20")).toBeNull();
    expect((await store.listLoadedMods()).map((m) => m.key).sort()).toEqual([
      "1:11",
      "2:21",
    ]);
  });

  it("notifies subscribers and changes snapshot identity only on change", async () => {
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const before = registry.getSnapshot();
    expect(registry.getSnapshot()).toBe(before);

    await registry.addLoadedMod(makeMeta(1, 10), makeAssets("a"));
    expect(listener).toHaveBeenCalledTimes(1);
    const afterAdd = registry.getSnapshot();
    expect(afterAdd).not.toBe(before);
    expect(registry.getLoadedModBlockIds()).toBe(
      registry.getLoadedModBlockIds(),
    );

    await registry.removeLoadedMod("missing:key");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).toBe(afterAdd);

    await registry.removeLoadedMod("1:10");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await registry.addLoadedMod(makeMeta(2, 20), makeAssets("b"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect mods removed while hydrating", async () => {
    await store.putLoadedMod(makeMeta(1, 10), makeAssets("a"));
    await store.putLoadedMod(makeMeta(2, 20), makeAssets("b"));

    const hydrating = registry.hydrateLoadedMods();
    await registry.removeLoadedMod("1:10");
    await hydrating;

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["2:20"]);
  });

  it("falls back to in-memory when IndexedDB is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // @ts-expect-error simulate an environment without IndexedDB
    delete globalThis.indexedDB;

    await registry.hydrateLoadedMods();
    const assets = makeAssets("a");
    await registry.addLoadedMod(makeMeta(1, 10), assets);
    await registry.addLoadedMod(makeMeta(2, 20), makeAssets("b"));
    await registry.removeLoadedMod("2:20");

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:10"]);
    expect(registry.getLoadedModBlockIds()).toEqual(new Set(["mod1:block_10"]));
    expect(await registry.getLoadedModAssets("1:10")).toBe(assets);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
