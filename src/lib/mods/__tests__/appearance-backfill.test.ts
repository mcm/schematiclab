import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { solidPng } from "../../render/__tests__/encode-png";
import {
  __resetAppearanceBackfillForTests,
  ensureModAppearances,
} from "../appearance-backfill";
import { computeModAppearances } from "../mod-appearance";
import type { ComputeAppearancesResult } from "../mod-jar.worker";
import * as registry from "../registry";
import * as store from "../store";
import type { LoadedModAssets, LoadedModMeta } from "../types";

const KEY = "1:1.20.1";

function legacyMeta(): LoadedModMeta {
  return {
    key: KEY,
    modId: 1,
    modName: "Mod 1",
    modSlug: "mod-1",
    logoUrl: null,
    fileId: 10,
    fileDisplayName: "mod-1.jar",
    gameVersion: "1.20.1",
    gameVersions: ["1.20.1"],
    loader: "forge",
    namespaces: ["a"],
    blocks: [
      { id: "a:red", displayName: "Red", properties: {} },
      { id: "a:broken", displayName: "Broken", properties: {} },
    ],
    loadedAt: 1,
  };
}

const ASSETS: LoadedModAssets = {
  blockstates: {
    "a:red": { variants: { "": { model: "a:block/red" } } },
    "a:broken": { variants: { "": { model: "a:block/none" } } },
  },
  models: {
    "a:block/red": {
      textures: { all: "a:block/red" },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: { up: { texture: "#all" } },
        },
      ],
    },
  },
  textures: {
    "a:block/red": new Blob([solidPng([255, 0, 0, 255])], {
      type: "image/png",
    }),
  },
  textureMeta: {},
};

function computeWith(complete: boolean) {
  return vi.fn(
    async (
      input: Parameters<typeof computeModAppearances>[0],
    ): Promise<ComputeAppearancesResult> => ({
      appearances: computeModAppearances(input),
      complete,
    }),
  );
}

beforeEach(async () => {
  await store.__resetModStoreForTests();
  registry.__resetLoadedModsForTests();
  __resetAppearanceBackfillForTests();
  globalThis.indexedDB = new IDBFactory();
  await store.putLoadedMod(legacyMeta(), ASSETS);
  await registry.hydrateLoadedMods();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureModAppearances", () => {
  it("computes appearances for a legacy file once and persists them", async () => {
    const compute = computeWith(true);

    const meta = await ensureModAppearances(KEY, { compute });

    expect(meta!.appearancesComputed).toBe(true);
    expect(meta!.blocks[0].appearance).toEqual({
      oklab: [0.628, 0.225, 0.126],
      fullCube: true,
    });
    expect(meta!.blocks[1]).not.toHaveProperty("appearance");
    expect(registry.getSnapshot()[0]).toBe(meta);
    expect((await store.listLoadedMods())[0]).toEqual(meta);

    expect(await ensureModAppearances(KEY, { compute })).toBe(meta);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute.mock.calls[0][0].textures["a:block/red"]).toBeInstanceOf(
      Uint8Array,
    );
  });

  it("shares one computation between concurrent calls", async () => {
    const compute = computeWith(true);
    const [a, b] = await Promise.all([
      ensureModAppearances(KEY, { compute }),
      ensureModAppearances(KEY, { compute }),
    ]);
    expect(a).toBe(b);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("backfills a file replaced while an earlier backfill runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const full = computeWith(true);
    const compute = vi.fn(
      async (input: Parameters<typeof computeModAppearances>[0]) => {
        if (compute.mock.calls.length === 1) await gate;
        return full(input);
      },
    );
    const first = ensureModAppearances(KEY, { compute });
    await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(1));

    await registry.addLoadedMod({ ...legacyMeta(), fileId: 11 }, ASSETS);
    const replaced = await ensureModAppearances(KEY, { compute });
    expect(compute).toHaveBeenCalledTimes(2);
    expect(replaced!.fileId).toBe(11);
    expect(replaced!.appearancesComputed).toBe(true);

    release();
    expect((await first)!.fileId).toBe(11);
    expect(registry.getSnapshot()[0]).toBe(replaced);
  });

  it("retries later when the vanilla bundle was unavailable", async () => {
    let now = 1000;
    const partial = computeWith(false);
    const meta = await ensureModAppearances(KEY, {
      compute: partial,
      now: () => now,
    });
    expect(meta!.appearancesComputed).toBe(false);
    expect(meta!.blocks[0].appearance).toBeDefined();

    // The registry update re-triggers callers; they don't recompute at once.
    const full = computeWith(true);
    now += 1000;
    expect(
      (await ensureModAppearances(KEY, { compute: full, now: () => now }))!
        .appearancesComputed,
    ).toBe(false);
    expect(full).not.toHaveBeenCalled();

    now += 60_000;
    expect(
      (await ensureModAppearances(KEY, { compute: full, now: () => now }))!
        .appearancesComputed,
    ).toBe(true);
    expect(full).toHaveBeenCalledTimes(1);
  });

  it("returns files that already have appearances without computing", async () => {
    const compute = computeWith(true);
    const done = {
      ...legacyMeta(),
      key: "2:1.20.1",
      modId: 2,
      appearancesComputed: true,
    };
    await registry.addLoadedMod(done, ASSETS);
    expect(await ensureModAppearances("2:1.20.1", { compute })).toBe(done);
    expect(await ensureModAppearances("9:1.20.1", { compute })).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it("keeps the current metadata when computing fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = registry.getSnapshot()[0];
    const compute = vi.fn(async () => {
      throw new Error("worker died");
    });
    expect(await ensureModAppearances(KEY, { compute })).toBe(before);
    expect(registry.getSnapshot()[0]).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("doesn't write back when the file was removed meanwhile", async () => {
    const compute = vi.fn(async (): Promise<ComputeAppearancesResult> => {
      await registry.removeLoadedMod(KEY);
      return { appearances: {}, complete: true };
    });
    const meta = await ensureModAppearances(KEY, { compute });
    expect(meta!.appearancesComputed).toBeUndefined();
    expect(registry.getSnapshot()).toEqual([]);
    expect(await store.listLoadedMods()).toEqual([]);
  });
});
