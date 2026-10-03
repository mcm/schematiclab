import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as registry from "../registry";
import * as store from "../store";
import type {
  LoadedModAssets,
  LoadedModMeta,
  NamespaceMapping,
} from "../types";

function makeMeta(
  modId: number,
  gameVersion: string,
  overrides: Partial<LoadedModMeta> = {},
): LoadedModMeta {
  const fileId = overrides.fileId ?? modId * 10;
  return {
    key: `${modId}:${gameVersion}`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId,
    fileDisplayName: `mod-${modId}-${gameVersion}.jar`,
    gameVersion,
    gameVersions: [gameVersion],
    loader: "forge",
    namespaces: [`mod${modId}`],
    blocks: [
      {
        id: `mod${modId}:block_${gameVersion}`,
        displayName: `Block ${gameVersion}`,
        properties: { facing: ["east", "north"] },
      },
    ],
    loadedAt: fileId,
    ...overrides,
  };
}

function png(...bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

function makeAssets(label: string, texture: Blob = png(1, 2, 3)) {
  return {
    blockstates: { [`${label}:thing`]: { variants: { "": { model: "x" } } } },
    models: {
      [`${label}:block/thing`]: { parent: "minecraft:block/cube_all" },
    },
    textures: { [`${label}:block/thing`]: texture },
    textureMeta: {},
  } satisfies LoadedModAssets;
}

async function bytesOf(blob: Blob | undefined): Promise<number[]> {
  return [...new Uint8Array(await blob!.arrayBuffer())];
}

async function blobKinds(): Promise<string[]> {
  return (await store.__listBlobKeysForTests())
    .map((key) => key.split(":")[0])
    .sort();
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
    const a = makeMeta(1, "1.20.1");
    const b = makeMeta(2, "1.20.1");
    await store.putLoadedMod(b, makeAssets("b"));
    await store.putLoadedMod(a, makeAssets("a"));

    expect(await store.listLoadedMods()).toEqual([a, b]);
    const assets = await store.getModAssets("2:1.20.1");
    expect(assets?.blockstates).toEqual(makeAssets("b").blockstates);
    expect(assets?.models).toEqual(makeAssets("b").models);
    expect(await bytesOf(assets?.textures["b:block/thing"])).toEqual([1, 2, 3]);

    await store.removeLoadedMod("2:1.20.1");
    expect(await store.listLoadedMods()).toEqual([a]);
    expect(await store.getModAssets("2:1.20.1")).toBeNull();
  });

  it("replaces only the file of the same mod and game version", async () => {
    await store.putLoadedMod(makeMeta(1, "1.20.1"), makeAssets("old"));
    await store.putLoadedMod(makeMeta(1, "1.21"), makeAssets("other"));
    await store.putLoadedMod(
      makeMeta(1, "1.20.1", { fileId: 11 }),
      makeAssets("new"),
    );

    const listed = await store.listLoadedMods();
    expect(listed.map((m) => [m.key, m.fileId])).toEqual([
      ["1:1.21", 10],
      ["1:1.20.1", 11],
    ]);
    const assets = await store.getModAssets("1:1.20.1");
    expect(Object.keys(assets?.models ?? {})).toEqual(["new:block/thing"]);
  });

  it("stores identical assets of two files once", async () => {
    // Same texture bytes and the same blockstate JSON in another key order.
    await store.putLoadedMod(makeMeta(1, "1.20.1"), {
      blockstates: { "a:x": { variants: { "": { model: "m", y: 90 } } } },
      models: {},
      textures: { "a:block/x": png(7, 7, 7) },
      textureMeta: {},
    });
    await store.putLoadedMod(makeMeta(1, "1.21"), {
      blockstates: { "a:x": { variants: { "": { y: 90, model: "m" } } } },
      models: {},
      textures: { "a:block/renamed": png(7, 7, 7) },
      textureMeta: {},
    });

    expect(await blobKinds()).toEqual(["json", "png"]);
    const assets = await store.getModAssets("1:1.21");
    expect(await bytesOf(assets?.textures["a:block/renamed"])).toEqual([
      7, 7, 7,
    ]);
  });

  it("keeps shared blobs when one owner is removed", async () => {
    const shared = png(1, 1, 1);
    await store.putLoadedMod(makeMeta(1, "1.20.1"), {
      ...makeAssets("a", shared),
      textures: { "a:block/shared": shared, "a:block/own": png(2, 2, 2) },
    });
    await store.putLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b", shared));
    // Both files' blockstate and model JSON are identical too.
    expect(await blobKinds()).toEqual(["json", "json", "png", "png"]);

    await store.removeLoadedMod("1:1.20.1");
    // Mod 2's blockstate, model and the shared texture survive.
    expect(await blobKinds()).toEqual(["json", "json", "png"]);
    const assets = await store.getModAssets("2:1.20.1");
    expect(await bytesOf(assets?.textures["b:block/thing"])).toEqual([1, 1, 1]);

    await store.removeLoadedMod("2:1.20.1");
    expect(await store.__listBlobKeysForTests()).toEqual([]);
  });

  it("drops blobs only a replaced file referenced", async () => {
    await store.putLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a", png(1)));
    await store.putLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a", png(2)));

    expect(await blobKinds()).toEqual(["json", "json", "png"]);
    const assets = await store.getModAssets("1:1.20.1");
    expect(await bytesOf(assets?.textures["a:block/thing"])).toEqual([2]);
  });

  it("migrates a v2 database to deduplicated per-version records", async () => {
    const legacyMeta = (modId: number, gameVersions: string[]) => {
      const { gameVersion: _gameVersion, ...meta } = makeMeta(modId, "x", {
        key: `${modId}:${modId * 10}`,
        gameVersions,
      });
      return meta;
    };
    const mapping: NamespaceMapping = {
      namespace: "mod1",
      modId: 1,
      modName: "Mod 1",
      modSlug: "mod-1",
      logoUrl: null,
      mappedAt: 5,
    };
    const v2 = await openDB(store.MODS_DB_NAME, 2, {
      upgrade(db) {
        const mods = db.createObjectStore("mods", { keyPath: "key" });
        mods.createIndex("modId", "modId");
        db.createObjectStore("assets");
        db.createObjectStore("namespaceMappings", { keyPath: "namespace" });
      },
    });
    await v2.put("mods", legacyMeta(1, ["1.20.1", "1.20"]));
    await v2.put("mods", legacyMeta(2, ["1.21"]));
    await v2.put("assets", makeAssets("a", png(9, 9)), "1:10");
    await v2.put("assets", makeAssets("b", png(9, 9)), "2:20");
    await v2.put("namespaceMappings", mapping);
    v2.close();

    const mods = await store.listLoadedMods();
    expect(mods.map((m) => [m.key, m.gameVersion])).toEqual([
      ["1:1.20.1", "1.20.1"],
      ["2:1.21", "1.21"],
    ]);
    expect(mods[0]).toEqual({
      ...legacyMeta(1, ["1.20.1", "1.20"]),
      key: "1:1.20.1",
      gameVersion: "1.20.1",
    });
    const assets = await store.getModAssets("1:1.20.1");
    expect(assets?.blockstates).toEqual(makeAssets("a").blockstates);
    expect(assets?.models).toEqual(makeAssets("a").models);
    expect(await bytesOf(assets?.textures["a:block/thing"])).toEqual([9, 9]);
    expect(await store.getModAssets("2:1.21")).not.toBeNull();
    // Both mods' identical texture, blockstate and model are stored once.
    expect(await blobKinds()).toEqual(["json", "json", "png"]);
    expect(await store.listNamespaceMappings()).toEqual([mapping]);

    // The migrated layout survives a reopen.
    await store.__resetModStoreForTests();
    expect((await store.listLoadedMods()).map((m) => m.key)).toEqual([
      "1:1.20.1",
      "2:1.21",
    ]);
    expect(await blobKinds()).toEqual(["json", "json", "png"]);
  });
});

describe("loaded-mods registry", () => {
  it("hydrates from the store", async () => {
    await store.putLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    await store.__resetModStoreForTests();

    expect(registry.getSnapshot()).toEqual([]);
    await registry.hydrateLoadedMods();

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:1.20.1"]);
    expect(registry.getLoadedModBlockIds()).toEqual(
      new Set(["mod1:block_1.20.1"]),
    );
    expect(registry.getModForBlockId("mod1:block_1.20.1")).toEqual({
      key: "1:1.20.1",
      modName: "Mod 1",
    });
    expect(registry.getModForBlockId("minecraft:stone")).toBeNull();
    expect(registry.getLoadedNamespaces()).toEqual(new Set(["mod1"]));
    const assets = await registry.getLoadedModAssets("1:1.20.1");
    expect(assets?.models).toEqual(makeAssets("a").models);
  });

  it("persists added mods across a reload", async () => {
    await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    await registry.addLoadedMod(makeMeta(1, "1.21"), makeAssets("a"));
    await registry.addLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));
    await registry.removeLoadedMod("2:1.20.1");

    await store.__resetModStoreForTests();
    registry.__resetLoadedModsForTests();
    await registry.hydrateLoadedMods();

    expect(registry.getSnapshot().map((m) => m.key)).toEqual([
      "1:1.20.1",
      "1:1.21",
    ]);
  });

  it("keeps one file per mod and game version", async () => {
    await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("old"));
    await registry.addLoadedMod(makeMeta(1, "1.21"), makeAssets("next"));
    const replacement = makeMeta(1, "1.20.1", { fileId: 11 });
    await registry.addLoadedMod(replacement, makeAssets("new"));

    expect(registry.getSnapshot().map((m) => [m.key, m.fileId])).toEqual([
      ["1:1.21", 10],
      ["1:1.20.1", 11],
    ]);
    expect(registry.getLoadedModFile(1, "1.20.1")).toBe(replacement);
    expect(registry.getLoadedModFile(1, "1.21")?.fileId).toBe(10);
    expect(registry.getLoadedModFile(1, "1.19.2")).toBeNull();
    const assets = await registry.getLoadedModAssets("1:1.20.1");
    expect(Object.keys(assets?.models ?? {})).toEqual(["new:block/thing"]);
    expect((await store.listLoadedMods()).map((m) => m.key).sort()).toEqual([
      "1:1.20.1",
      "1:1.21",
    ]);

    await registry.removeLoadedMod("1:1.21");
    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:1.20.1"]);
  });

  it("looks up a namespace's blocks for one game version", async () => {
    await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    await registry.addLoadedMod(
      makeMeta(1, "1.21", {
        blocks: [
          { id: "mod1:new_block", displayName: "New", properties: {} },
          { id: "extra:thing", displayName: "Thing", properties: {} },
        ],
      }),
      makeAssets("a"),
    );

    const blocks = registry.getModBlocksForVersion("mod1", "1.21");
    expect([...blocks.keys()]).toEqual(["mod1:new_block"]);
    expect(blocks.get("mod1:new_block")?.displayName).toBe("New");
    expect(registry.getModBlocksForVersion("mod1", "1.21")).toBe(blocks);
    expect([
      ...registry.getModBlocksForVersion("mod1", "1.20.1").keys(),
    ]).toEqual(["mod1:block_1.20.1"]);
    expect(registry.getModBlocksForVersion("mod1", "1.19.2").size).toBe(0);
  });

  it("picks one preview file per mod", async () => {
    const a120 = makeMeta(1, "1.20.1", { loadedAt: 1 });
    const a121 = makeMeta(1, "1.21", { loadedAt: 3 });
    const b120 = makeMeta(2, "1.20.1", { loadedAt: 2 });
    await registry.addLoadedMod(a120, makeAssets("a"));
    await registry.addLoadedMod(b120, makeAssets("b"));
    await registry.addLoadedMod(a121, makeAssets("a"));

    // The source-version file when loaded…
    expect(registry.getPreviewModFiles("1.20.1")).toEqual([a120, b120]);
    expect(registry.getPreviewModFiles("1.21")).toEqual([b120, a121]);
    // …else the most recently loaded file.
    expect(registry.getPreviewModFiles("1.19.2")).toEqual([b120, a121]);
    expect(registry.getPreviewModFiles(null)).toEqual([b120, a121]);
    expect(registry.getPreviewModFiles("1.20.1")).toBe(
      registry.getPreviewModFiles("1.20.1"),
    );
  });

  it("looks up a block shared by two files of a mod by version", async () => {
    const shared = (displayName: string, facing: string[]) => ({
      id: "mod1:shared",
      displayName,
      properties: { facing },
    });
    // Target file loaded first, source file last: the version-agnostic
    // lookup returns the source file, whatever version is asked about.
    const target = makeMeta(1, "1.21", {
      loadedAt: 1,
      blocks: [
        shared("Shared (1.21)", ["north", "south", "up"]),
        { id: "mod1:only_new", displayName: "Only new", properties: {} },
      ],
    });
    const source = makeMeta(1, "1.20.1", {
      loadedAt: 2,
      blocks: [shared("Shared (1.20.1)", ["north", "south"])],
    });
    await registry.addLoadedMod(target, makeAssets("a"));
    await registry.addLoadedMod(source, makeAssets("a"));

    // No version: unchanged, last file in the snapshot wins.
    expect(registry.getLoadedModBlock("mod1:shared")?.displayName).toBe(
      "Shared (1.20.1)",
    );
    expect(registry.getModForBlockId("mod1:shared")?.key).toBe(source.key);
    expect(registry.getLoadedModBlock("mod1:shared", null)?.displayName).toBe(
      "Shared (1.20.1)",
    );

    // The file for the requested version wins.
    expect(registry.getLoadedModBlock("mod1:shared", "1.21")).toEqual(
      shared("Shared (1.21)", ["north", "south", "up"]),
    );
    expect(registry.getModForBlockId("mod1:shared", "1.21")?.key).toBe(
      target.key,
    );
    expect(
      registry.getLoadedModBlock("mod1:shared", "1.20.1")?.properties,
    ).toEqual({ facing: ["north", "south"] });
    expect(registry.getModForBlockId("mod1:shared", "1.20.1")?.key).toBe(
      source.key,
    );

    // A version with no file of the mod: the most recently loaded file.
    expect(
      registry.getLoadedModBlock("mod1:shared", "1.19.2")?.displayName,
    ).toBe("Shared (1.20.1)");

    // Blocks only another version's file provides still resolve.
    expect(registry.getModForBlockId("mod1:only_new", "1.20.1")?.key).toBe(
      target.key,
    );
    expect(registry.getLoadedModBlock("minecraft:stone", "1.21")).toBeNull();

    // Re-loading the target file makes it the most recent one.
    const reloaded = { ...target, loadedAt: 3 };
    await registry.addLoadedMod(reloaded, makeAssets("a"));
    expect(
      registry.getLoadedModBlock("mod1:shared", "1.19.2")?.displayName,
    ).toBe("Shared (1.21)");
    expect(
      registry.getLoadedModBlock("mod1:shared", "1.20.1")?.displayName,
    ).toBe("Shared (1.20.1)");
  });

  it("adds a batch with one notification, later files winning per slot", async () => {
    await registry.hydrateLoadedMods();
    await registry.addLoadedMod(
      makeMeta(1, "1.20.1", { fileId: 10 }),
      makeAssets("old"),
    );
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    await registry.addLoadedMods([
      { meta: makeMeta(1, "1.20.1", { fileId: 11 }), assets: makeAssets("a") },
      { meta: makeMeta(2, "1.20.1", { fileId: 20 }), assets: makeAssets("b") },
      { meta: makeMeta(2, "1.20.1", { fileId: 21 }), assets: makeAssets("c") },
      { meta: makeMeta(2, "1.21", { fileId: 22 }), assets: makeAssets("d") },
    ]);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().map((m) => [m.key, m.fileId])).toEqual([
      ["1:1.20.1", 11],
      ["2:1.20.1", 21],
      ["2:1.21", 22],
    ]);
    expect((await registry.getLoadedModAssets("2:1.20.1"))?.models).toEqual(
      makeAssets("c").models,
    );
    expect((await store.getModAssets("2:1.20.1"))?.models).toEqual(
      makeAssets("c").models,
    );
    expect((await store.listLoadedMods()).map((m) => m.key).sort()).toEqual([
      "1:1.20.1",
      "2:1.20.1",
      "2:1.21",
    ]);
  });

  it("notifies subscribers and changes snapshot identity only on change", async () => {
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const before = registry.getSnapshot();
    expect(registry.getSnapshot()).toBe(before);

    await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    expect(listener).toHaveBeenCalledTimes(1);
    const afterAdd = registry.getSnapshot();
    expect(afterAdd).not.toBe(before);
    expect(registry.getLoadedModBlockIds()).toBe(
      registry.getLoadedModBlockIds(),
    );

    await registry.removeLoadedMod("missing:key");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).toBe(afterAdd);

    await registry.removeLoadedMod("1:1.20.1");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await registry.addLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("updates a loaded file's metadata in place and persists it", async () => {
    await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    await registry.addLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));
    const updated = makeMeta(1, "1.20.1", { appearancesComputed: true });

    await registry.updateLoadedModMeta(updated);

    expect(registry.getSnapshot()[0]).toBe(updated);
    expect(registry.getSnapshot().map((m) => m.key)).toEqual([
      "1:1.20.1",
      "2:1.20.1",
    ]);
    const stored = await store.listLoadedMods();
    expect(stored.find((m) => m.key === "1:1.20.1")).toEqual(updated);
    // Assets are kept.
    expect(await store.getModAssets("1:1.20.1")).not.toBeNull();
  });

  it("ignores metadata updates for files that are no longer loaded", async () => {
    await registry.hydrateLoadedMods();
    const before = registry.getSnapshot();
    await registry.updateLoadedModMeta(makeMeta(1, "1.20.1"));
    await store.updateLoadedModMeta(makeMeta(1, "1.20.1"));

    expect(registry.getSnapshot()).toBe(before);
    expect(await store.listLoadedMods()).toEqual([]);
  });

  it("does not resurrect mods removed while hydrating", async () => {
    await store.putLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    await store.putLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));

    const hydrating = registry.hydrateLoadedMods();
    await registry.removeLoadedMod("1:1.20.1");
    await hydrating;

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["2:1.20.1"]);
  });

  it("unloads every file and its blobs, keeping namespace mappings", async () => {
    const mapping: NamespaceMapping = {
      namespace: "mod1",
      modId: 1,
      modName: "Mod 1",
      modSlug: "mod-1",
      logoUrl: null,
      mappedAt: 1,
    };
    await store.putNamespaceMapping(mapping);
    await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    await registry.addLoadedMod(makeMeta(1, "1.21"), makeAssets("a"));
    await registry.addLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));
    const listener = vi.fn();
    registry.subscribe(listener);

    await registry.removeAllLoadedMods();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).toEqual([]);
    expect(registry.getLoadedNamespaces()).toEqual(new Set());
    expect(await registry.getLoadedModAssets("1:1.20.1")).toBeNull();
    expect(await store.listLoadedMods()).toEqual([]);
    expect(await store.getModAssets("2:1.20.1")).toBeNull();
    expect(await store.__listBlobKeysForTests()).toEqual([]);
    expect(await store.listNamespaceMappings()).toEqual([mapping]);

    await registry.addLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));
    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["2:1.20.1"]);
  });

  it("does not resurrect mods unloaded all at once while hydrating", async () => {
    await store.putLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"));
    await store.putLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));

    const hydrating = registry.hydrateLoadedMods();
    await registry.removeAllLoadedMods();
    await hydrating;

    expect(registry.getSnapshot()).toEqual([]);
    expect(await store.listLoadedMods()).toEqual([]);
  });

  it("drops a load that started before every mod was unloaded", async () => {
    const generation = registry.getUnloadGeneration();
    await registry.removeAllLoadedMods();

    expect(
      await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"), {
        generation,
      }),
    ).toBe(false);
    expect(registry.getSnapshot()).toEqual([]);
    expect(await store.listLoadedMods()).toEqual([]);

    expect(
      await registry.addLoadedMod(makeMeta(1, "1.20.1"), makeAssets("a"), {
        generation: registry.getUnloadGeneration(),
      }),
    ).toBe(true);
    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:1.20.1"]);
  });

  it("falls back to in-memory when IndexedDB is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // @ts-expect-error simulate an environment without IndexedDB
    delete globalThis.indexedDB;

    await registry.hydrateLoadedMods();
    const assets = makeAssets("a");
    await registry.addLoadedMod(makeMeta(1, "1.20.1"), assets);
    await registry.addLoadedMod(makeMeta(2, "1.20.1"), makeAssets("b"));
    await registry.removeLoadedMod("2:1.20.1");

    expect(registry.getSnapshot().map((m) => m.key)).toEqual(["1:1.20.1"]);
    expect(registry.getLoadedModBlockIds()).toEqual(
      new Set(["mod1:block_1.20.1"]),
    );
    expect(await registry.getLoadedModAssets("1:1.20.1")).toBe(assets);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
