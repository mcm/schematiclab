// Stone Zone and Gems Realm through the shared Every Compat engine, with
// hand-made Twigs, Rechiseled and stone/metal mod files for 1.21.1 and the
// generated tables.

import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as modRegistry from "../../../registry";
import * as store from "../../../store";
import {
  __setGeneratedVanillaLoaderForTests,
  enumerateGeneratedBlocks,
  loadGeneratedBlockFiles,
  resolveGeneratedBlock,
} from "../../registry";
import {
  __resetGeneratedTextureCacheForTests,
  loadGeneratedBlockRender,
} from "../../render";
import type { GeneratedVanillaAssets } from "../../types";
import { assets, cubeAll, meta, png, single, VERSION } from "./ec-test-files";

const VANILLA: GeneratedVanillaAssets = {
  blockstate: () => undefined,
  model: (id) =>
    id === "minecraft:block/cube_all"
      ? {
          elements: [
            {
              from: [0, 0, 0],
              to: [16, 16, 16],
              faces: { up: { texture: "#all" } },
            },
          ],
        }
      : undefined,
  texture: () => null,
};

beforeEach(async () => {
  await store.__resetModStoreForTests();
  modRegistry.__resetLoadedModsForTests();
  globalThis.indexedDB = new IDBFactory();
  __setGeneratedVanillaLoaderForTests(async () => VANILLA);
  __resetGeneratedTextureCacheForTests();
});

afterEach(() => {
  __setGeneratedVanillaLoaderForTests(null);
});

describe("Stone Zone", () => {
  const COLUMN = "stonezone:tw/rockmod/jade_column";

  async function load() {
    await modRegistry.addLoadedMods([
      { meta: meta(1, "stonezone", []), assets: assets({}) },
      {
        meta: meta(2, "twigs", ["twigs:stone_column"]),
        assets: assets({
          blockstates: {
            "twigs:stone_column": single("twigs:block/stone_column"),
          },
          models: {
            "twigs:block/stone_column": {
              parent: "minecraft:block/cube_all",
              textures: { all: "twigs:block/stone_column" },
            },
          },
          textures: {
            "twigs:block/stone_column": png([
              [100, 100, 100],
              [140, 140, 140],
            ]),
          },
        }),
      },
      {
        meta: meta(3, "rockmod", ["rockmod:jade", "rockmod:jade_bricks"]),
        assets: assets({
          blockstates: {
            "rockmod:jade": single("rockmod:block/jade"),
            "rockmod:jade_bricks": single("rockmod:block/jade_bricks"),
          },
          models: {
            "rockmod:block/jade": cubeAll("rockmod:block/jade"),
            "rockmod:block/jade_bricks": cubeAll("rockmod:block/jade_bricks"),
          },
          textures: {
            "rockmod:block/jade": png([
              // Twigs' palette drops the two lightest colours
              [30, 100, 70],
              [40, 120, 80],
              [50, 140, 95],
              [60, 160, 110],
              [70, 180, 125],
            ]),
            "rockmod:block/jade_bricks": png([[50, 140, 90]]),
          },
        }),
      },
    ]);
    await loadGeneratedBlockFiles(VERSION);
  }

  it("generates Twigs columns for a detected stone type", async () => {
    await load();
    expect(enumerateGeneratedBlocks(VERSION).map((b) => b.id)).toContain(
      COLUMN,
    );
    const resolution = resolveGeneratedBlock(COLUMN, {}, VERSION);
    expect(resolution).toMatchObject({
      kind: "resolved",
      provider: "stonezone",
      blockstate: {
        variants: { "": { model: "stonezone:block/tw/rockmod/jade_column" } },
      },
      models: {
        "stonezone:block/tw/rockmod/jade_column": {
          parent: "minecraft:block/cube_all",
          textures: { all: "stonezone:block/tw/rockmod/jade_column" },
        },
      },
    });
    if (resolution.kind !== "resolved") return;
    expect(resolution.textures[0]).toMatchObject({
      id: "stonezone:block/tw/rockmod/jade_column",
      sources: ["twigs:block/stone_column", "rockmod:block/jade"],
    });
    const render = await loadGeneratedBlockRender([COLUMN], VERSION);
    expect(
      render.textures.get("stonezone:block/tw/rockmod/jade_column"),
    ).toBeDefined();
  });
});

describe("Gems Realm", () => {
  const BORDERED = "gemsrealm:rcd/metalmod/tin_block_bordered";

  async function load() {
    await modRegistry.addLoadedMods([
      { meta: meta(1, "gemsrealm", []), assets: assets({}) },
      {
        meta: meta(2, "rechiseled", ["rechiseled:iron_block_bordered"]),
        assets: assets({
          blockstates: {
            "rechiseled:iron_block_bordered": single(
              "rechiseled:block/iron_block_bordered",
            ),
          },
          models: {
            "rechiseled:block/iron_block_bordered": cubeAll(
              "rechiseled:block/iron_block_bordered",
            ),
          },
          textures: {
            "rechiseled:block/iron_block_bordered": png([
              [180, 180, 180],
              [220, 220, 220],
            ]),
          },
        }),
      },
      {
        meta: meta(3, "metalmod", ["metalmod:tin_block"]),
        assets: assets({
          blockstates: {
            "metalmod:tin_block": single("metalmod:block/tin_block"),
          },
          models: {
            "metalmod:block/tin_block": cubeAll("metalmod:block/tin_block"),
          },
          textures: {
            "metalmod:block/tin_block": png([
              [150, 160, 170],
              [190, 200, 210],
            ]),
          },
          items: ["metalmod:tin_ingot"],
        }),
      },
    ]);
    await loadGeneratedBlockFiles(VERSION);
  }

  it("generates Rechiseled blocks for a detected metal type", async () => {
    await load();
    expect(enumerateGeneratedBlocks(VERSION).map((b) => b.id)).toContain(
      BORDERED,
    );
    const resolution = resolveGeneratedBlock(BORDERED, {}, VERSION);
    expect(resolution).toMatchObject({
      kind: "resolved",
      provider: "gemsrealm",
      sourceNamespaces: ["metalmod", "rechiseled"],
    });
    if (resolution.kind !== "resolved") return;
    expect(resolution.textures[0]).toMatchObject({
      id: "gemsrealm:block/rcd/metalmod/tin_block_bordered",
      sources: [
        "rechiseled:block/iron_block_bordered",
        "metalmod:block/tin_block",
      ],
    });
  });

  it("needs the metal mod's items to detect the type", async () => {
    await modRegistry.addLoadedMods([
      { meta: meta(1, "gemsrealm", []), assets: assets({}) },
      {
        meta: meta(3, "metalmod", ["metalmod:tin_block"]),
        assets: assets({}),
      },
    ]);
    await loadGeneratedBlockFiles(VERSION);
    expect(resolveGeneratedBlock(BORDERED, {}, VERSION)).toMatchObject({
      kind: "needs-mods",
      namespaces: ["rechiseled"],
    });
  });
});
