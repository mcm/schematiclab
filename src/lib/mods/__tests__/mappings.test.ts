import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetModLoadsForTests, startModLoad } from "../load-mod";
import * as mappings from "../mappings";
import type { NamespaceMapping } from "../mappings";
import * as store from "../store";
import type { LoadedModMeta } from "../types";

// Capture the store contract `useNamespaceMappings` hands to React.
const { useSyncExternalStore } = vi.hoisted(() => ({
  useSyncExternalStore: vi.fn(
    (_subscribe: (listener: () => void) => () => void, get: () => unknown) =>
      get(),
  ),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore,
}));

function mapping(
  namespace: string,
  modId: number,
  overrides: Partial<NamespaceMapping> = {},
): NamespaceMapping {
  return {
    namespace,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    mappedAt: modId,
    ...overrides,
  };
}

/** Simulate a page reload: drop in-memory state and the DB connection. */
async function reload(): Promise<void> {
  await store.__resetModStoreForTests();
  mappings.__resetNamespaceMappingsForTests();
}

beforeEach(async () => {
  await reload();
  __resetModLoadsForTests();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("namespace mappings", () => {
  it("sets, gets, lists and removes mappings", async () => {
    await mappings.hydrateNamespaceMappings();
    const before = mappings.listNamespaceMappings();
    expect(before).toEqual([]);

    await mappings.setNamespaceMapping(mapping("create", 1));
    await mappings.setNamespaceMapping(mapping("aeronautics", 2));
    // One project may own several namespaces.
    await mappings.setNamespaceMapping(mapping("flywheel", 1));

    expect(mappings.getNamespaceMapping("create")).toEqual(
      mapping("create", 1),
    );
    expect(mappings.getNamespaceMapping("missing")).toBeNull();
    const list = mappings.listNamespaceMappings();
    expect(list.map((m) => m.namespace)).toEqual([
      "aeronautics",
      "create",
      "flywheel",
    ]);
    expect(mappings.listNamespaceMappings()).toBe(list);

    await mappings.removeNamespaceMapping("aeronautics");
    expect(mappings.getNamespaceMapping("aeronautics")).toBeNull();
    expect(mappings.listNamespaceMappings().map((m) => m.namespace)).toEqual([
      "create",
      "flywheel",
    ]);
  });

  it("replaces the mapping of an already-mapped namespace", async () => {
    await mappings.setNamespaceMapping(mapping("create", 1));
    await mappings.setNamespaceMapping(mapping("create", 2));
    expect(mappings.getNamespaceMapping("create")?.modId).toBe(2);
    expect(mappings.listNamespaceMappings()).toHaveLength(1);

    await reload();
    await mappings.hydrateNamespaceMappings();
    expect(mappings.listNamespaceMappings()).toEqual([mapping("create", 2)]);
  });

  it("persists across a module reset", async () => {
    await mappings.setNamespaceMapping(mapping("create", 1));
    await mappings.setNamespaceMapping(mapping("gone", 3));
    await mappings.removeNamespaceMapping("gone");

    await reload();
    expect(mappings.listNamespaceMappings()).toEqual([]);
    await mappings.hydrateNamespaceMappings();
    expect(mappings.listNamespaceMappings()).toEqual([mapping("create", 1)]);
  });

  it("keeps session changes made while hydrating", async () => {
    await mappings.setNamespaceMapping(mapping("create", 1));
    await mappings.setNamespaceMapping(mapping("gone", 3));
    await reload();

    const hydrating = mappings.hydrateNamespaceMappings();
    await mappings.setNamespaceMapping(mapping("create", 2));
    await mappings.removeNamespaceMapping("gone");
    await hydrating;

    expect(mappings.listNamespaceMappings()).toEqual([mapping("create", 2)]);
  });

  it("changes snapshot identity only when mappings change", async () => {
    await mappings.hydrateNamespaceMappings();
    mappings.useNamespaceMappings();
    const [subscribe, get] = useSyncExternalStore.mock.lastCall!;
    const getSnapshot = get as () => mappings.NamespaceMappingsSnapshot;

    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const first = getSnapshot();
    expect(getSnapshot()).toBe(first);

    await mappings.removeNamespaceMapping("absent");
    expect(getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();

    await mappings.setNamespaceMapping(mapping("create", 1));
    expect(getSnapshot()).not.toBe(first);
    expect(getSnapshot().get("create")).toEqual(mapping("create", 1));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("works in memory with a single warning when IndexedDB is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB;

    await mappings.hydrateNamespaceMappings();
    await mappings.setNamespaceMapping(mapping("create", 1));
    await mappings.setNamespaceMapping(mapping("other", 2));
    await mappings.removeNamespaceMapping("other");

    expect(mappings.listNamespaceMappings()).toEqual([mapping("create", 1)]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("upgrades a v1 database without losing loaded mods", async () => {
    const meta: Omit<LoadedModMeta, "gameVersion"> = {
      key: "1:10",
      modId: 1,
      modName: "Create",
      modSlug: "create",
      logoUrl: null,
      fileId: 10,
      fileDisplayName: "create.jar",
      gameVersions: ["1.20.1"],
      loader: "forge",
      namespaces: ["create"],
      blocks: [{ id: "create:casing", displayName: "Casing", properties: {} }],
      warnings: [],
      loadedAt: 1,
    };
    const assets = {
      blockstates: { "create:casing": { variants: {} } },
      models: {},
      textures: {},
      textureMeta: {},
    };
    const v1 = await openDB(store.MODS_DB_NAME, 1, {
      upgrade(db) {
        const mods = db.createObjectStore("mods", { keyPath: "key" });
        mods.createIndex("modId", "modId");
        db.createObjectStore("assets");
      },
    });
    await v1.put("mods", meta);
    await v1.put("assets", assets, meta.key);
    v1.close();

    await mappings.setNamespaceMapping(mapping("create", 1));
    expect(await store.listLoadedMods()).toEqual([
      { ...meta, key: "1:1.20.1", gameVersion: "1.20.1" },
    ]);
    expect(await store.getModAssets("1:1.20.1")).toEqual(assets);
    expect(await store.listNamespaceMappings()).toEqual([mapping("create", 1)]);
  });
});

describe("auto-mapping on mod load", () => {
  const request = {
    mod: {
      id: 42,
      name: "Create",
      slug: "create",
      logoThumbnailUrl: "https://example.test/create.png",
    },
    gameVersion: "1.20.1",
    loader: null,
  };

  function deps() {
    return {
      fetchFiles: vi.fn(async () => [
        {
          id: 3,
          modId: 42,
          displayName: "Create",
          fileName: "create.jar",
          fileLength: 3,
          fileDate: "2024-01-01T00:00:00Z",
          gameVersions: ["1.20.1"],
          loaders: ["forge" as const],
          downloadable: true,
        },
      ]),
      download: vi.fn(async () => new Uint8Array([1])),
      parse: vi.fn(async () => ({
        namespaces: ["create", "flywheel", "ponder"],
        blocks: [
          { id: "create:casing", displayName: "Casing", properties: {} },
        ],
        blockstates: {},
        models: {},
        textures: {},
        textureMeta: {},
        templates: {},
        warnings: [],
      })),
      add: vi.fn(async () => {}),
      mapNamespaces: mappings.autoMapNamespaces,
      now: () => 99,
    };
  }

  it("maps unmapped namespaces without overwriting existing mappings", async () => {
    // Persisted before this session: must survive auto-mapping.
    await mappings.setNamespaceMapping(mapping("flywheel", 7));
    await reload();

    await startModLoad(request, deps());

    expect(mappings.listNamespaceMappings()).toEqual([
      {
        namespace: "create",
        modId: 42,
        modName: "Create",
        modSlug: "create",
        logoUrl: "https://example.test/create.png",
        mappedAt: 99,
      },
      mapping("flywheel", 7),
      {
        namespace: "ponder",
        modId: 42,
        modName: "Create",
        modSlug: "create",
        logoUrl: "https://example.test/create.png",
        mappedAt: 99,
      },
    ]);

    await reload();
    await mappings.hydrateNamespaceMappings();
    expect(mappings.getNamespaceMapping("ponder")?.modId).toBe(42);
    expect(mappings.getNamespaceMapping("flywheel")?.modId).toBe(7);
  });

  it("doesn't map anything when the load fails", async () => {
    await startModLoad(request, {
      ...deps(),
      add: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await mappings.hydrateNamespaceMappings();
    expect(mappings.listNamespaceMappings()).toEqual([]);
  });
});
