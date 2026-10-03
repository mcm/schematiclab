// The generated-block provider framework, with a fake in-test provider:
// `fakegen:<ns>_<path>` is generated from `<ns>:<path>` when the `fakegen`
// file's provider data lists that source, and needs `<ns>` loaded for the
// same Minecraft version.

import "fake-indexeddb/auto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { IDBFactory } from "fake-indexeddb";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as modRegistry from "../../registry";
import * as store from "../../store";
import {
  toLoadedModAssets,
  type LoadedModAssets,
  type LoadedModMeta,
  type ParsedModAssets,
} from "../../types";
import {
  __setGeneratedBlockProvidersForTests,
  __setGeneratedVanillaLoaderForTests,
  enumerateGeneratedBlockSets,
  enumerateGeneratedBlocks,
  getEnumeratedGeneratedBlock,
  getGeneratedBlockFiles,
  getGeneratedBlockFilesRevision,
  getGeneratedBlockProvider,
  loadGeneratedBlockFiles,
  resolveGeneratedBlock,
  subscribeGeneratedBlockFiles,
} from "../registry";
import type {
  GeneratedBlockFiles,
  GeneratedBlockProvider,
  GeneratedBlockResolution,
} from "../types";

interface FakeData {
  sources: string[];
}

function generatedId(source: string): string {
  return `fakegen:${source.replace(":", "_")}`;
}

function fakeSources(files: GeneratedBlockFiles): string[] {
  const data = files.providerData("fakegen") as FakeData | undefined;
  return data?.sources ?? [];
}

const FAKE_PROVIDER: GeneratedBlockProvider = {
  namespace: "fakegen",
  modName: "Fake Generator",
  enumerate(files) {
    return fakeSources(files).flatMap((source) => {
      const block = files.blocks(source.split(":")[0]).get(source);
      if (block === undefined) return [];
      return [
        {
          id: generatedId(source),
          displayName: `Fake ${block.displayName}`,
          properties: block.properties,
        },
      ];
    });
  },
  resolve(id, properties, files) {
    const source = fakeSources(files).find((s) => generatedId(s) === id);
    if (source === undefined) return { kind: "unrecognised" };
    const ns = source.split(":")[0];
    const block = files.blocks(ns).get(source);
    if (block === undefined) {
      return {
        kind: "needs-mods",
        provider: "fakegen",
        namespaces: [ns],
        sourceBlocks: [source],
      };
    }
    const texture = `fakegen:generated/${source.replace(":", "/")}`;
    return {
      kind: "resolved",
      provider: "fakegen",
      block: {
        id,
        displayName: `Fake ${block.displayName}`,
        properties: block.properties,
      },
      blockstate: { variants: { "": { model: `${id}_model` } } },
      models: {
        [`${id}_model`]: {
          parent: "minecraft:block/cube_all",
          textures: { all: texture },
        },
      },
      textures: [
        {
          id: texture,
          sources: [source.replace(":", ":block/")],
          params: { invert: true, properties },
        },
      ],
      approximate: Object.keys(properties).length === 0,
      sourceNamespaces: [ns],
    };
  },
  generateTexture(recipe, sources) {
    const source = sources.get(recipe.sources[0]);
    if (source === undefined) return null;
    const data = source.image.data.map((v, i) => (i % 4 === 3 ? v : 255 - v));
    return { image: { ...source.image, data }, meta: source.meta };
  },
};

function makeMeta(
  modId: number,
  gameVersion: string,
  namespace: string,
  blocks: LoadedModMeta["blocks"] = [],
): LoadedModMeta {
  return {
    key: `${modId}:${gameVersion}`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId: modId * 10,
    fileDisplayName: `mod-${modId}.jar`,
    gameVersion,
    gameVersions: [gameVersion],
    loader: "forge",
    namespaces: [namespace],
    blocks,
    loadedAt: modId,
  };
}

function assets(providerData?: LoadedModAssets["providerData"]) {
  return {
    blockstates: {},
    models: {},
    textures: {},
    textureMeta: {},
    ...(providerData ? { providerData } : {}),
  } satisfies LoadedModAssets;
}

const GENERATOR = makeMeta(1, "1.12.2", "fakegen");
const GENERATED = "fakegen:stonemod_stone";
const GENERATOR_DATA = { fakegen: { sources: ["stonemod:stone"] } };
const STONE_MOD = makeMeta(2, "1.12.2", "stonemod", [
  {
    id: "stonemod:stone",
    displayName: "Stone",
    properties: { variant: ["a", "b"] },
  },
]);

beforeEach(async () => {
  await store.__resetModStoreForTests();
  modRegistry.__resetLoadedModsForTests();
  globalThis.indexedDB = new IDBFactory();
  __setGeneratedBlockProvidersForTests([FAKE_PROVIDER]);
  __setGeneratedVanillaLoaderForTests(async () => null);
});

afterEach(() => {
  __setGeneratedBlockProvidersForTests(null);
  __setGeneratedVanillaLoaderForTests(null);
  vi.restoreAllMocks();
});

describe("generated block providers", () => {
  it("looks providers up by namespace", () => {
    expect(getGeneratedBlockProvider("fakegen")).toBe(FAKE_PROVIDER);
    expect(getGeneratedBlockProvider("stonemod")).toBeNull();
  });

  it("is unrecognised outside provider namespaces", () => {
    expect(resolveGeneratedBlock("stonemod:stone", {}, "1.12.2")).toEqual({
      kind: "unrecognised",
    });
    expect(resolveGeneratedBlock("stone", {}, "1.12.2")).toEqual({
      kind: "unrecognised",
    });
  });

  it("is unrecognised when the provider doesn't know the block", async () => {
    await modRegistry.addLoadedMod(GENERATOR, assets(GENERATOR_DATA));
    expect(resolveGeneratedBlock("fakegen:other_thing", {}, "1.12.2")).toEqual({
      kind: "unrecognised",
    });
  });

  it("needs the source mod when only the generator is loaded", async () => {
    await modRegistry.addLoadedMod(GENERATOR, assets(GENERATOR_DATA));
    expect(
      resolveGeneratedBlock("fakegen:stonemod_stone", {}, "1.12.2"),
    ).toEqual({
      kind: "needs-mods",
      provider: "fakegen",
      namespaces: ["stonemod"],
      sourceBlocks: ["stonemod:stone"],
    } satisfies GeneratedBlockResolution);
  });

  it("resolves once the source mod is loaded for the same version", async () => {
    await modRegistry.addLoadedMods([
      { meta: GENERATOR, assets: assets(GENERATOR_DATA) },
      {
        meta: makeMeta(2, "1.20.1", "stonemod", STONE_MOD.blocks),
        assets: assets(),
      },
    ]);
    expect(
      resolveGeneratedBlock("fakegen:stonemod_stone", {}, "1.12.2").kind,
    ).toBe("needs-mods");

    await modRegistry.addLoadedMod(STONE_MOD, assets());
    const resolution = resolveGeneratedBlock(
      "fakegen:stonemod_stone",
      { variant: "b" },
      "1.12.2",
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      provider: "fakegen",
      block: { id: "fakegen:stonemod_stone", displayName: "Fake Stone" },
      approximate: false,
      sourceNamespaces: ["stonemod"],
    });
    expect(enumerateGeneratedBlocks("1.12.2").map((b) => b.id)).toEqual([
      "fakegen:stonemod_stone",
    ]);
    expect(enumerateGeneratedBlocks("1.20.1")).toEqual([]);
  });

  it("sees no provider data for a version without the generator", async () => {
    await modRegistry.addLoadedMod(GENERATOR, assets(GENERATOR_DATA));
    expect(getGeneratedBlockFiles("1.20.1").providerData("fakegen")).toBe(
      undefined,
    );
    expect(
      resolveGeneratedBlock("fakegen:stonemod_stone", {}, "1.20.1").kind,
    ).toBe("unrecognised");
  });

  it("reads persisted assets after a reload", async () => {
    await modRegistry.addLoadedMods([
      { meta: GENERATOR, assets: assets(GENERATOR_DATA) },
      { meta: STONE_MOD, assets: assets() },
    ]);
    modRegistry.__resetLoadedModsForTests();
    await modRegistry.hydrateLoadedMods();

    // Metadata is back, assets aren't in memory yet.
    expect(getGeneratedBlockFiles("1.12.2").providerData("fakegen")).toBe(
      undefined,
    );
    const files = await loadGeneratedBlockFiles("1.12.2");
    expect(files.providerData("fakegen")).toEqual(GENERATOR_DATA.fakegen);
    expect(files.fileForNamespace("stonemod")?.key).toBe(STONE_MOD.key);
    expect(
      resolveGeneratedBlock("fakegen:stonemod_stone", {}, "1.12.2").kind,
    ).toBe("resolved");
  });

  it("re-enumerates and notifies once persisted assets are read", async () => {
    await modRegistry.addLoadedMods([
      { meta: GENERATOR, assets: assets(GENERATOR_DATA) },
      { meta: STONE_MOD, assets: assets() },
    ]);
    modRegistry.__resetLoadedModsForTests();
    await modRegistry.hydrateLoadedMods();
    expect(enumerateGeneratedBlockSets("1.12.2")).toEqual([]);
    expect(getEnumeratedGeneratedBlock(GENERATED, "1.12.2")).toBeNull();

    const listener = vi.fn();
    const unsubscribe = subscribeGeneratedBlockFiles(listener);
    const revision = getGeneratedBlockFilesRevision();
    await loadGeneratedBlockFiles("1.12.2");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getGeneratedBlockFilesRevision()).not.toBe(revision);
    const sets = enumerateGeneratedBlockSets("1.12.2");
    expect(sets).toHaveLength(1);
    expect(sets[0].provider).toBe(FAKE_PROVIDER);
    expect(sets[0].file?.key).toBe(GENERATOR.key);
    expect(sets[0].blocks.map((b) => b.id)).toEqual([GENERATED]);
    // Cached until something changes.
    expect(enumerateGeneratedBlockSets("1.12.2")).toBe(sets);
    expect(getEnumeratedGeneratedBlock(GENERATED, "1.12.2")).toEqual({
      provider: FAKE_PROVIDER,
      block: sets[0].blocks[0],
    });
    expect(getEnumeratedGeneratedBlock(GENERATED, "1.20.1")).toBeNull();

    // Nothing new to read: no notification.
    await loadGeneratedBlockFiles("1.12.2");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("loads the vanilla assets once", async () => {
    const vanilla = {
      blockstate: () => undefined,
      model: () => undefined,
      texture: () => null,
    };
    const loader = vi.fn(async () => vanilla);
    __setGeneratedVanillaLoaderForTests(loader);
    expect(getGeneratedBlockFiles("1.12.2").vanilla).toBeNull();
    expect((await loadGeneratedBlockFiles("1.12.2")).vanilla).toBe(vanilla);
    expect((await loadGeneratedBlockFiles("1.20.1")).vanilla).toBe(vanilla);
    expect(getGeneratedBlockFiles("1.12.2").vanilla).toBe(vanilla);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("generates textures from decoded sources", () => {
    const resolution = (() => {
      const files = getGeneratedBlockFiles("1.12.2");
      return FAKE_PROVIDER.resolve(
        "fakegen:stonemod_stone",
        {},
        {
          ...files,
          blocks: () => new Map([["stonemod:stone", STONE_MOD.blocks[0]]]),
          providerData: () => GENERATOR_DATA.fakegen,
        },
      );
    })();
    if (resolution.kind !== "resolved") throw new Error(resolution.kind);
    const [recipe] = resolution.textures;
    const image = {
      width: 1,
      height: 1,
      data: new Uint8Array([10, 20, 30, 200]),
    };
    expect(
      FAKE_PROVIDER.generateTexture(
        recipe,
        new Map([[recipe.sources[0], { image }]]),
      )?.image.data,
    ).toEqual(new Uint8Array([245, 235, 225, 200]));
    expect(FAKE_PROVIDER.generateTexture(recipe, new Map())).toBeNull();
  });
});

describe("provider data", () => {
  it("passes non-empty parser output into the persisted assets", () => {
    const parsed: ParsedModAssets = {
      namespaces: ["fakegen"],
      blocks: [],
      blockstates: {},
      models: {},
      textures: {},
      textureMeta: {},
      templates: {},
      warnings: [],
    };
    expect(toLoadedModAssets(parsed)).not.toHaveProperty("providerData");
    expect(
      toLoadedModAssets({ ...parsed, providerData: {} }),
    ).not.toHaveProperty("providerData");
    expect(
      toLoadedModAssets({ ...parsed, providerData: GENERATOR_DATA })
        .providerData,
    ).toEqual(GENERATOR_DATA);
  });

  it("round-trips through the store", async () => {
    await store.putLoadedMod(GENERATOR, assets(GENERATOR_DATA));
    await store.putLoadedMod(STONE_MOD, assets());
    await store.__resetModStoreForTests();

    expect((await store.getModAssets(GENERATOR.key))?.providerData).toEqual(
      GENERATOR_DATA,
    );
    expect(await store.getModAssets(STONE_MOD.key)).not.toHaveProperty(
      "providerData",
    );
  });
});

describe("worker safety", () => {
  const DIR = path.resolve(__dirname, "..");
  const ALLOWED_RENDER = path.resolve(DIR, "../../render/block-appearance");

  /** Non-test `.ts` files under `dir`, recursively. */
  function sourcesIn(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        return name === "__tests__" ? [] : sourcesIn(full);
      }
      return name.endsWith(".ts") ? [full] : [];
    });
  }

  it("imports nothing from src/lib/render/ but pure helpers", () => {
    const sources = sourcesIn(DIR);
    expect(sources.length).toBeGreaterThan(0);
    for (const full of sources) {
      const file = path.relative(DIR, full);
      const source = readFileSync(full, "utf8");
      const specs = ts
        .preProcessFile(source, true, true)
        .importedFiles.map((ref) => ref.fileName);
      for (const spec of specs) {
        if (spec.includes("render/")) {
          const target = path.resolve(path.dirname(full), spec);
          expect(target, `${file}: ${spec}`).toBe(ALLOWED_RENDER);
        }
      }
      expect(source, file).not.toMatch(/\b(document|window)\./);
    }
  });
});
