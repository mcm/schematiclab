import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getBlockCatalog,
  isCatalogedBlockId,
  searchBlockCatalog,
} from "../block-catalog";
import * as registry from "../mods/registry";
import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/version-mapping";
import * as store from "../mods/store";
import type { LoadedModAssets, LoadedModMeta } from "../mods/types";

const EMPTY_ASSETS: LoadedModAssets = {
  blockstates: {},
  models: {},
  textures: {},
  textureMeta: {},
};

function createMod(
  blockPaths: string[],
  gameVersion = "1.20.1",
  loadedAt = 0,
): LoadedModMeta {
  return {
    key: `328085:${gameVersion}`,
    modId: 328085,
    modName: "Create",
    modSlug: "create",
    logoUrl: null,
    fileId: 4835191,
    fileDisplayName: "Create 0.5.1f",
    gameVersion,
    gameVersions: [gameVersion],
    loader: "forge",
    namespaces: ["create"],
    blocks: blockPaths.map((path) => ({
      id: `create:${path}`,
      displayName: path,
      properties: {},
    })),
    loadedAt,
  };
}

describe("block-catalog", () => {
  it("includes common vanilla block ids without property suffixes", () => {
    const catalog = getBlockCatalog();
    expect(catalog).toContain("minecraft:stone");
    expect(catalog).toContain("minecraft:spruce_planks");
    expect(catalog).toContain("minecraft:air");
    // Property-bearing entries are stripped.
    expect(catalog).not.toContain("minecraft:grass_block[snowy=false]");
    expect(catalog).toContain("minecraft:grass_block");
  });

  it("is sorted and unique", () => {
    const catalog = getBlockCatalog();
    for (let i = 1; i < catalog.length; i += 1) {
      expect(catalog[i].localeCompare(catalog[i - 1])).toBeGreaterThan(0);
    }
  });

  it("ranks prefix matches above substring matches", () => {
    const results = searchBlockCatalog("oak_pl", 10);
    expect(results[0]).toBe("minecraft:oak_planks");
  });

  it("returns substring matches when no prefix match exists", () => {
    const results = searchBlockCatalog("planks", 20);
    expect(results).toContain("minecraft:oak_planks");
    expect(results).toContain("minecraft:spruce_planks");
  });

  it("treats the bare-name shortcut (without minecraft:) as prefix", () => {
    const results = searchBlockCatalog("stone", 50);
    // stone proper should appear among the prefix hits, not lost in the tail.
    expect(results.slice(0, 5)).toContain("minecraft:stone");
  });

  it("isCatalogedBlockId returns true for known ids, false otherwise", () => {
    expect(isCatalogedBlockId("minecraft:stone")).toBe(true);
    expect(isCatalogedBlockId("modname:not_a_real_block")).toBe(false);
  });
});

describe("block-catalog with loaded mods", () => {
  beforeEach(async () => {
    await store.__resetModStoreForTests();
    registry.__resetLoadedModsForTests();
    globalThis.indexedDB = new IDBFactory();
    await registry.addLoadedMod(
      createMod([
        "andesite_casing",
        "brass_casing",
        "cogwheel",
        "polished_cut_andesite",
      ]),
      EMPTY_ASSETS,
    );
  });

  afterEach(() => {
    registry.__resetLoadedModsForTests();
  });

  it("matches a full namespaced id prefix", () => {
    expect(searchBlockCatalog("create:and", 10)).toEqual([
      "create:andesite_casing",
    ]);
  });

  it("matches a bare path prefix, after vanilla prefix matches", () => {
    const results = searchBlockCatalog("andesite", 50);
    // Expected set comes from the catalog itself, not the search output, so
    // a dropped vanilla prefix match would fail here.
    const vanillaPrefix = getBlockCatalog().filter((id) =>
      id.startsWith("minecraft:andesite"),
    );
    expect(vanillaPrefix.length).toBeGreaterThan(0);
    expect(results.slice(0, vanillaPrefix.length)).toEqual(vanillaPrefix);
    expect(results[vanillaPrefix.length]).toBe("create:andesite_casing");
    // Substring-only matches trail all prefix matches.
    expect(results.indexOf("create:polished_cut_andesite")).toBeGreaterThan(
      results.indexOf("create:andesite_casing"),
    );
    expect(results.indexOf("minecraft:polished_andesite")).toBeGreaterThan(
      results.indexOf("create:andesite_casing"),
    );
  });

  it("lists a mod's blocks for a namespace prefix", () => {
    expect(searchBlockCatalog("create:", 50)).toEqual([
      "create:andesite_casing",
      "create:brass_casing",
      "create:cogwheel",
      "create:polished_cut_andesite",
    ]);
  });

  it("matches mod ids by substring", () => {
    expect(searchBlockCatalog("wheel", 50)).toContain("create:cogwheel");
  });

  it("preserves vanilla prefix ranking", () => {
    expect(searchBlockCatalog("oak_pl", 10)[0]).toBe("minecraft:oak_planks");
  });

  it("includes mod blocks in the full catalog", () => {
    expect(getBlockCatalog()).toContain("create:cogwheel");
  });

  it("keeps the full catalog sorted and unique with mods loaded", () => {
    const catalog = getBlockCatalog();
    expect(catalog.indexOf("create:cogwheel")).toBeLessThan(
      catalog.indexOf("minecraft:stone"),
    );
    for (let i = 1; i < catalog.length; i += 1) {
      expect(catalog[i] > catalog[i - 1]).toBe(true);
    }
  });

  it("lists vanilla ids before mod ids for an empty query", () => {
    expect(searchBlockCatalog("", 5)).toEqual(
      getBlockCatalog()
        .filter((id) => id.startsWith("minecraft:"))
        .slice(0, 5),
    );
  });
});

describe("isCatalogedBlockId and registry changes", () => {
  beforeEach(async () => {
    await store.__resetModStoreForTests();
    registry.__resetLoadedModsForTests();
    globalThis.indexedDB = new IDBFactory();
  });

  it("reflects mods being added and removed without reload", async () => {
    expect(isCatalogedBlockId("create:cogwheel")).toBe(false);
    expect(searchBlockCatalog("cogwheel", 10)).toEqual([]);

    const mod = createMod(["cogwheel"]);
    await registry.addLoadedMod(mod, EMPTY_ASSETS);
    expect(isCatalogedBlockId("create:cogwheel")).toBe(true);
    expect(searchBlockCatalog("cogwheel", 10)).toEqual(["create:cogwheel"]);

    await registry.removeLoadedMod(mod.key);
    expect(isCatalogedBlockId("create:cogwheel")).toBe(false);
    expect(searchBlockCatalog("cogwheel", 10)).toEqual([]);
  });
});

describe("block-catalog scoped to a version", () => {
  const scopeFor = (versionId: string) => ({
    version: KNOWN_VERSIONS[versionId],
    versionId,
  });

  beforeEach(async () => {
    await store.__resetModStoreForTests();
    registry.__resetLoadedModsForTests();
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    registry.__resetLoadedModsForTests();
  });

  it("only lists vanilla blocks that exist in the version", () => {
    expect(searchBlockCatalog("cherry_pl", 10)).toContain(
      "minecraft:cherry_planks",
    );
    expect(searchBlockCatalog("cherry_pl", 10, scopeFor("1.18.2"))).toEqual([]);
    expect(searchBlockCatalog("cherry_pl", 10, scopeFor("1.20.1"))).toEqual([
      "minecraft:cherry_planks",
    ]);
    expect(searchBlockCatalog("pale_oak", 50, scopeFor("1.20.1"))).toEqual([]);
  });

  it("drops blocks renamed away before the version", () => {
    // grass → short_grass in 1.20.3.
    const old = searchBlockCatalog("grass", 50, scopeFor("1.20.1"));
    expect(old).toContain("minecraft:grass");
    expect(old).not.toContain("minecraft:short_grass");
    const current = searchBlockCatalog("grass", 50, scopeFor("1.21.1"));
    expect(current).toContain("minecraft:short_grass");
    expect(current).not.toContain("minecraft:grass");
  });

  it("only lists blocks of the mod's file for the version", async () => {
    await registry.addLoadedMod(
      createMod(["cogwheel"], "1.20.1", 1),
      EMPTY_ASSETS,
    );
    await registry.addLoadedMod(
      createMod(["cogwheel", "new_gear"], "1.21.1", 2),
      EMPTY_ASSETS,
    );
    expect(searchBlockCatalog("create:", 10, scopeFor("1.20.1"))).toEqual([
      "create:cogwheel",
    ]);
    expect(searchBlockCatalog("create:", 10, scopeFor("1.21.1"))).toEqual([
      "create:cogwheel",
      "create:new_gear",
    ]);
    expect(isCatalogedBlockId("create:new_gear", scopeFor("1.20.1"))).toBe(
      false,
    );
    expect(isCatalogedBlockId("create:new_gear", scopeFor("1.21.1"))).toBe(
      true,
    );
  });

  it("isCatalogedBlockId checks the version's vanilla blocks", () => {
    expect(
      isCatalogedBlockId("minecraft:cherry_planks", scopeFor("1.18.2")),
    ).toBe(false);
    expect(
      isCatalogedBlockId("minecraft:cherry_planks", scopeFor("1.20.1")),
    ).toBe(true);
  });
});
