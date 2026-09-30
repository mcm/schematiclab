import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_LOCAL_JAR_BYTES,
  __resetModpackLoadForTests,
  cancelModpackLoad,
  dismissModpackLoad,
  getModpackLoad,
  startModpackLoad,
  type ModpackFile,
  type ModpackLoadDeps,
} from "../load-modpack";
import type { ParsedModAssets } from "../types";

function parsed(blocks = 1): ParsedModAssets {
  return {
    namespaces: ["mod"],
    blocks: Array.from({ length: blocks }, (_, i) => ({
      id: `mod:block_${i}`,
      displayName: `Block ${i}`,
      properties: {},
    })),
    blockstates: {},
    models: {},
    textures: {},
    textureMeta: {},
    warnings: [],
  };
}

function addon(modId: number, fileId: number, name: string) {
  return {
    addonID: modId,
    name,
    fileNameOnDisk: `${name}.jar`,
    webSiteURL: `https://www.curseforge.com/minecraft/mc-mods/${name}`,
    installedFile: {
      id: fileId,
      fileName: `${name}.jar`,
      gameVersion: ["1.21.1"],
    },
  };
}

function manifest(addons: unknown[]): ModpackFile {
  return {
    path: "Pack/minecraftinstance.json",
    file: new Blob([
      JSON.stringify({
        name: "Pack",
        gameVersion: "1.21.1",
        baseModLoader: { type: 6 },
        installedAddons: addons,
      }),
    ]),
  };
}

function jar(name: string, content: number[] = [1, 2, 3]): ModpackFile {
  return {
    path: `Pack/mods/${name}.jar`,
    file: new Blob([new Uint8Array(content)]),
  };
}

function makeDeps(overrides: Partial<ModpackLoadDeps> = {}): ModpackLoadDeps {
  return {
    download: vi.fn(async () => new Uint8Array([9])),
    parse: vi.fn(async () => parsed()),
    addMany: vi.fn(async () => {}),
    mapNamespaces: vi.fn(async () => []),
    now: () => 1234,
    loadedFiles: async () => new Map<string, number>(),
    ...overrides,
  };
}

beforeEach(() => {
  __resetModpackLoadForTests();
});

describe("startModpackLoad", () => {
  it("registers every local jar in one batch with the manifest's CurseForge ids", async () => {
    const deps = makeDeps();
    await startModpackLoad(
      [
        manifest([addon(1, 10, "alpha"), addon(2, 20, "beta")]),
        jar("alpha"),
        jar("beta"),
      ],
      deps,
    );

    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.parse).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(deps.addMany).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(deps.addMany).mock.calls[0][0];
    expect(batch.map(({ meta }) => meta.key)).toEqual(["1:1.21.1", "2:1.21.1"]);
    expect(batch[0].meta).toMatchObject({
      key: "1:1.21.1",
      modId: 1,
      fileId: 10,
      modName: "alpha",
      modSlug: "alpha",
      fileDisplayName: "alpha.jar",
      gameVersion: "1.21.1",
      gameVersions: ["1.21.1"],
      loader: "neoforge",
      loadedAt: 1234,
    });
    // Each registered file's namespaces are auto-mapped to its mod.
    expect(deps.mapNamespaces).toHaveBeenCalledTimes(2);
    expect(deps.mapNamespaces).toHaveBeenCalledWith(
      batch[0].meta.namespaces,
      batch[0].meta,
      1234,
    );
    expect(getModpackLoad()).toEqual({
      status: "done",
      packName: "Pack",
      total: 2,
      processed: 2,
      current: null,
      download: null,
      loaded: 2,
      alreadyLoaded: 0,
      noBlocks: 0,
      failures: [],
    });
  });

  it("downloads jars missing from mods/ from CurseForge", async () => {
    const deps = makeDeps();
    await startModpackLoad([manifest([addon(1, 10, "alpha")])], deps);

    expect(deps.download).toHaveBeenCalledWith(
      1,
      10,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(deps.parse).toHaveBeenCalledWith(new Uint8Array([9]));
    expect(getModpackLoad()).toMatchObject({ status: "done", loaded: 1 });
  });

  it("reports download progress for a missing jar", async () => {
    const seen: unknown[] = [];
    const deps = makeDeps({
      download: vi.fn(async (_modId, _fileId, onProgress) => {
        onProgress({ received: 0, total: 4 });
        onProgress({ received: 0, total: 4 }); // same percent: no update
        seen.push(getModpackLoad());
        onProgress({ received: 2, total: 4 });
        seen.push(getModpackLoad());
        return new Uint8Array([9]);
      }),
    });
    await startModpackLoad([manifest([addon(1, 10, "alpha")])], deps);

    expect(seen).toMatchObject([
      {
        status: "running",
        current: "alpha",
        download: { received: 0, total: 4 },
      },
      {
        status: "running",
        current: "alpha",
        download: { received: 2, total: 4 },
      },
    ]);
    expect(getModpackLoad()).toMatchObject({ status: "done", download: null });
  });

  it("counts blockless and already-loaded mods and collects failures", async () => {
    const deps = makeDeps({
      loadedFiles: async () => new Map([["1:1.21.1", 10]]),
      parse: vi
        .fn()
        .mockResolvedValueOnce(parsed(0))
        .mockRejectedValueOnce(new Error("bad zip")),
      download: vi.fn(async () => {
        throw new Error(
          "CurseForge integration is not configured on this server.",
        );
      }),
    });
    await startModpackLoad(
      [
        manifest([
          addon(1, 10, "a-loaded"),
          addon(2, 20, "b-empty"),
          addon(3, 30, "c-broken"),
          addon(4, 40, "d-missing"),
        ]),
        jar("a-loaded"),
        jar("b-empty"),
        jar("c-broken"),
      ],
      deps,
    );

    expect(deps.addMany).not.toHaveBeenCalled();
    expect(getModpackLoad()).toMatchObject({
      status: "done",
      processed: 4,
      loaded: 0,
      alreadyLoaded: 1,
      noBlocks: 1,
      failures: [
        { modName: "c-broken", message: "Could not read the mod jar: bad zip" },
        {
          modName: "d-missing",
          message: "CurseForge integration is not configured on this server.",
        },
      ],
    });
  });

  it("skips oversized local jars without reading them", async () => {
    const huge = {
      path: "Pack/mods/big.jar",
      file: { size: MAX_LOCAL_JAR_BYTES + 1 } as Blob,
    };
    const deps = makeDeps();
    await startModpackLoad([manifest([addon(1, 10, "big")]), huge], deps);

    expect(deps.parse).not.toHaveBeenCalled();
    expect(getModpackLoad()).toMatchObject({
      failures: [
        { modName: "big", message: expect.stringMatching(/larger than/) },
      ],
    });
  });

  it("stops after the current mod when cancelled", async () => {
    const deps = makeDeps({
      parse: vi.fn(async () => {
        cancelModpackLoad();
        return parsed();
      }),
    });
    await startModpackLoad(
      [manifest([addon(1, 10, "a"), addon(2, 20, "b")]), jar("a"), jar("b")],
      deps,
    );

    expect(deps.parse).toHaveBeenCalledTimes(1);
    // What was parsed before cancelling is still registered.
    expect(
      vi.mocked(deps.addMany).mock.calls[0][0].map(({ meta }) => meta.key),
    ).toEqual(["1:1.21.1"]);
    expect(getModpackLoad()).toMatchObject({
      status: "cancelled",
      processed: 1,
      loaded: 1,
    });
  });

  it("shows a saving state, then reports a failed batch save per mod", async () => {
    let during: unknown = null;
    const deps = makeDeps({
      addMany: vi.fn(async () => {
        during = getModpackLoad();
        throw new Error("quota exceeded");
      }),
    });
    await startModpackLoad(
      [manifest([addon(1, 10, "a"), addon(2, 20, "b")]), jar("a"), jar("b")],
      deps,
    );

    expect(during).toMatchObject({ status: "saving", loaded: 2 });
    expect(getModpackLoad()).toMatchObject({
      status: "done",
      loaded: 0,
      failures: [
        { modName: "a", message: "quota exceeded" },
        { modName: "b", message: "quota exceeded" },
      ],
    });
  });

  it("recovers when the loaded mods can't be read", async () => {
    const files = [manifest([addon(1, 10, "a")]), jar("a")];
    await startModpackLoad(
      files,
      makeDeps({
        loadedFiles: async () => {
          throw new Error("storage blocked");
        },
      }),
    );
    expect(getModpackLoad()).toEqual({
      status: "error",
      message: "storage blocked",
    });

    // Not stuck: a new load can start.
    await startModpackLoad(files, makeDeps());
    expect(getModpackLoad()).toMatchObject({ status: "done", loaded: 1 });
  });

  it("reports a missing or invalid manifest", async () => {
    await startModpackLoad([jar("a")], makeDeps());
    expect(getModpackLoad()).toMatchObject({
      status: "error",
      message: expect.stringMatching(/No minecraftinstance\.json/),
    });

    dismissModpackLoad();
    expect(getModpackLoad()).toBeNull();

    await startModpackLoad(
      [{ path: "Pack/minecraftinstance.json", file: new Blob(["{"]) }],
      makeDeps(),
    );
    expect(getModpackLoad()).toMatchObject({
      status: "error",
      message: "minecraftinstance.json isn't valid JSON.",
    });
  });

  it("ignores a second load while one is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const deps = makeDeps({
      parse: vi.fn(async () => {
        await gate;
        return parsed();
      }),
    });
    const files = [manifest([addon(1, 10, "a")]), jar("a")];
    const first = startModpackLoad(files, deps);
    await vi.waitFor(() => expect(deps.parse).toHaveBeenCalled());

    await startModpackLoad(files, deps);
    dismissModpackLoad(); // no-op while running
    expect(getModpackLoad()).toMatchObject({ status: "running", current: "a" });

    release();
    await first;
    expect(deps.parse).toHaveBeenCalledTimes(1);
  });
});
