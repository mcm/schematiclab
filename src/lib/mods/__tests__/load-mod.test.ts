import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurseForgeModFile } from "../../curseforge/types";
import {
  __resetModLoadsForTests,
  describeModLoadState,
  dismissModLoad,
  getModLoads,
  startModLoad,
  type ModLoadDeps,
  type ModLoadRequest,
} from "../load-mod";
import {
  __resetLoadedModsForTests,
  addLoadedMod,
  getSnapshot,
  removeAllLoadedMods,
} from "../registry";
import type { ParsedModAssets } from "../types";

const KEY = "42:1.20.1";

const REQUEST: ModLoadRequest = {
  mod: { id: 42, name: "Create", slug: "create", logoThumbnailUrl: null },
  gameVersion: "1.20.1",
  loader: null,
};

function file(overrides: Partial<CurseForgeModFile> = {}): CurseForgeModFile {
  return {
    id: 100,
    modId: 42,
    displayName: "Create 0.5.1",
    fileName: "create-0.5.1.jar",
    fileLength: 3,
    fileDate: "2024-01-01T00:00:00Z",
    gameVersions: ["1.20.1"],
    loaders: ["forge"],
    downloadable: true,
    ...overrides,
  };
}

function parsed(overrides: Partial<ParsedModAssets> = {}): ParsedModAssets {
  return {
    namespaces: ["create"],
    blocks: [{ id: "create:casing", displayName: "Casing", properties: {} }],
    blockstates: {},
    models: {},
    textures: { "create:block/casing": new Uint8Array([1]) },
    textureMeta: {},
    templates: {},
    warnings: ["skipped bad.json"],
    appearancesComputed: true,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ModLoadDeps> = {}): ModLoadDeps {
  return {
    fetchFiles: vi.fn(async () => [
      file({ id: 1, fileDate: "2023-01-01T00:00:00Z" }),
      file({ id: 2, fileDate: "2024-06-01T00:00:00Z", downloadable: false }),
      file({ id: 3, fileDate: "2024-01-01T00:00:00Z" }),
    ]),
    download: vi.fn(async (_modId, _fileId, onProgress) => {
      onProgress({ received: 0, total: 3 });
      onProgress({ received: 3, total: 3 });
      return new Uint8Array([1, 2, 3]);
    }),
    parse: vi.fn(async () => parsed()),
    add: vi.fn(async () => true),
    mapNamespaces: vi.fn(async () => []),
    now: () => 1234,
    ...overrides,
  };
}

beforeEach(() => {
  __resetModLoadsForTests();
  vi.restoreAllMocks();
});

describe("startModLoad", () => {
  it("loads the newest downloadable file and registers it", async () => {
    const deps = makeDeps();
    await startModLoad(REQUEST, deps);

    expect(deps.fetchFiles).toHaveBeenCalledWith({
      modId: 42,
      gameVersion: "1.20.1",
      loader: null,
    });
    expect(deps.download).toHaveBeenCalledWith(42, 3, expect.any(Function));
    expect(deps.add).toHaveBeenCalledTimes(1);
    const [meta, assets] = vi.mocked(deps.add).mock.calls[0];
    expect(meta).toMatchObject({
      key: KEY,
      modId: 42,
      modName: "Create",
      fileId: 3,
      fileDisplayName: "Create 0.5.1",
      gameVersion: "1.20.1",
      gameVersions: ["1.20.1"],
      loader: "forge",
      namespaces: ["create"],
      warnings: ["skipped bad.json"],
      appearancesComputed: true,
      loadedAt: 1234,
    });
    expect(assets.textures["create:block/casing"]).toBeInstanceOf(Blob);
    expect(deps.mapNamespaces).toHaveBeenCalledWith(["create"], meta, 1234);
    expect(getModLoads().size).toBe(0);
  });

  it("drops the file when every mod is unloaded mid-load", async () => {
    __resetLoadedModsForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      download: vi.fn(async () => {
        await removeAllLoadedMods();
        return new Uint8Array([1, 2, 3]);
      }),
      add: vi.fn(addLoadedMod),
    });
    await startModLoad(REQUEST, deps);

    expect(deps.add).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toEqual([]);
    expect(deps.mapNamespaces).not.toHaveBeenCalled();
    expect(getModLoads().size).toBe(0);
    __resetLoadedModsForTests();
  });

  it("still finishes the load when namespace mapping fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      mapNamespaces: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    await startModLoad(REQUEST, deps);
    expect(deps.add).toHaveBeenCalledTimes(1);
    expect(getModLoads().size).toBe(0);
  });

  it("reports phases in order", async () => {
    const phases: string[] = [];
    const deps = makeDeps();
    const record = () => {
      const entry = getModLoads().get(KEY);
      if (entry) phases.push(describeModLoadState(entry.state));
    };
    const wrap = <T extends (...args: never[]) => unknown>(fn: T) =>
      ((...args: Parameters<T>) => {
        record();
        return fn(...args);
      }) as T;
    await startModLoad(REQUEST, {
      ...deps,
      download: wrap(deps.download),
      parse: wrap(deps.parse),
      add: wrap(deps.add),
    });
    expect(phases).toEqual(["Finding file", "Extracting", "Saving"]);
  });

  it("shows download percentage", () => {
    expect(
      describeModLoadState({ phase: "downloading", received: 42, total: 100 }),
    ).toBe("Downloading 42%");
    expect(
      describeModLoadState({
        phase: "downloading",
        received: 3 * 1024 * 1024,
        total: null,
      }),
    ).toBe("Downloading 3.0 MB");
  });

  it("errors when no file is downloadable", async () => {
    const deps = makeDeps({
      fetchFiles: vi.fn(async () => [file({ downloadable: false })]),
    });
    await startModLoad(REQUEST, deps);
    expect(getModLoads().get(KEY)?.state).toEqual({
      phase: "error",
      message: "No downloadable file for 1.20.1",
    });
    expect(deps.download).not.toHaveBeenCalled();
  });

  it.each([
    [
      "download",
      { download: vi.fn(async () => Promise.reject(new Error("too big"))) },
      "too big",
    ],
    [
      "parse",
      { parse: vi.fn(async () => Promise.reject(new Error("bad zip"))) },
      "Could not read the mod jar: bad zip",
    ],
    [
      "zero blocks",
      { parse: vi.fn(async () => parsed({ blocks: [] })) },
      "This mod file doesn't contain any blocks.",
    ],
  ])("fails on %s without persisting", async (_label, overrides, message) => {
    const deps = makeDeps(overrides as Partial<ModLoadDeps>);
    await startModLoad(REQUEST, deps);
    expect(getModLoads().get(KEY)?.state).toEqual({ phase: "error", message });
    expect(deps.add).not.toHaveBeenCalled();
    expect(deps.mapNamespaces).not.toHaveBeenCalled();
  });

  it("ignores a second add while one is running, but allows retry", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const deps = makeDeps({
      fetchFiles: vi.fn(async () => {
        await gate;
        return [];
      }),
    });
    const first = startModLoad(REQUEST, deps);
    await startModLoad(REQUEST, deps);
    expect(deps.fetchFiles).toHaveBeenCalledTimes(1);

    // A different mod can load concurrently.
    const other = startModLoad(
      { ...REQUEST, mod: { ...REQUEST.mod, id: 7 } },
      deps,
    );
    expect(deps.fetchFiles).toHaveBeenCalledTimes(2);

    // So can the same mod's file for another game version.
    const otherVersion = startModLoad(
      { ...REQUEST, gameVersion: "1.21" },
      deps,
    );
    expect(deps.fetchFiles).toHaveBeenCalledTimes(3);
    expect([...getModLoads().keys()].sort()).toEqual([
      "42:1.20.1",
      "42:1.21",
      "7:1.20.1",
    ]);

    release();
    await Promise.all([first, other, otherVersion]);
    expect(getModLoads().get(KEY)?.state.phase).toBe("error");

    await startModLoad(REQUEST, makeDeps());
    expect(getModLoads().has(KEY)).toBe(false);
  });

  it("dismisses failed loads only", async () => {
    await startModLoad(
      REQUEST,
      makeDeps({ fetchFiles: vi.fn(async () => []) }),
    );
    dismissModLoad(42, "1.20.1");
    expect(getModLoads().has(KEY)).toBe(false);
  });
});
