// Hand-made Unlimited Chisel Works, Chisel and Natura files for 1.12.2 (rules,
// blockstates and solid-colour synthetic textures written here; nothing is
// copied from a jar), and vanilla assets, for generated-block tests.

import type { RgbaImage } from "../../../render/block-appearance";
import { encodePng } from "../../../render/__tests__/encode-png";
import * as modRegistry from "../../registry";
import type { LoadedModAssets, LoadedModMeta } from "../../types";
import type { GeneratedVanillaAssets } from "../types";

export function solid(rgb: [number, number, number], size = 2): RgbaImage {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([...rgb, 255], i * 4);
  return { width: size, height: size, data };
}

export function png(rgb: [number, number, number]): Blob {
  const image = solid(rgb);
  return new Blob(
    [encodePng({ ...image, colorType: 6, scanlines: image.data })],
    {
      type: "image/png",
    },
  );
}

export function makeMeta(
  modId: number,
  namespace: string,
  fileId = modId * 10,
): LoadedModMeta {
  return {
    key: `${modId}:1.12.2`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId,
    fileDisplayName: `mod-${modId}.jar`,
    gameVersion: "1.12.2",
    gameVersions: ["1.12.2"],
    loader: "forge",
    namespaces: [namespace],
    blocks: [],
    loadedAt: fileId,
  };
}

export function assets(partial: Partial<LoadedModAssets>): LoadedModAssets {
  return {
    blockstates: {},
    models: {},
    textures: {},
    textureMeta: {},
    ...partial,
  };
}

export const UCW = makeMeta(1, "unlimitedchiselworks");
export const UCW_ASSETS = assets({
  providerData: {
    unlimitedchiselworks: {
      formatVersion: 1,
      files: [
        {
          path: "chisel/natura.json",
          modids: ["chisel", "natura"],
          loadLate: false,
          rules: [
            {
              from: {
                kind: "state",
                states: [
                  {
                    block: "natura:nether_planks",
                    properties: { type: "ghostwood" },
                  },
                ],
                list: false,
              },
              through: {
                kind: "block",
                block: "chisel:planks-oak",
                iterate: ["variation"],
              },
              basedUpon: {
                kind: "state",
                states: [
                  { block: "minecraft:planks", properties: { variant: "oak" } },
                ],
                list: false,
              },
              mode: "none",
              hasColor: false,
            },
          ],
        },
      ],
    },
  },
});

export const CHISEL = makeMeta(2, "chisel");
export const CHISEL_ASSETS = assets({
  blockstates: {
    "chisel:planks-oak": {
      forge_marker: 1,
      defaults: { model: "cube_all" },
      variants: {
        clean: [{ textures: { all: "chisel:blocks/planks-oak/clean" } }],
      },
    },
  },
  textures: { "chisel:blocks/planks-oak/clean": png([160, 130, 80]) },
});

export const NATURA = makeMeta(3, "natura");
export const NATURA_ASSETS = assets({
  blockstates: {
    "natura:nether_planks": {
      forge_marker: 1,
      defaults: { model: "cube_all" },
      variants: {
        type: {
          ghostwood: { textures: { all: "natura:blocks/ghostwood" } },
        },
      },
    },
  },
  textures: { "natura:blocks/ghostwood": png([200, 200, 210]) },
});

export const ID =
  "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0";
export const TEXTURE =
  "ucw_generated:ucw_ucw_natura_nether_planks_0/chisel/blocks/planks-oak/clean";

export const CUBE_ALL = {
  textures: { particle: "#all" },
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: Object.fromEntries(
        ["down", "up", "north", "south", "west", "east"].map((face) => [
          face,
          { texture: "#all", cullface: face, tintindex: 0 },
        ]),
      ),
    },
  ],
};

export const VANILLA: GeneratedVanillaAssets = {
  blockstate: (id) =>
    id === "minecraft:oak_planks"
      ? { variants: { "": { model: "minecraft:block/oak_planks" } } }
      : undefined,
  model: (id) =>
    ({
      "minecraft:block/cube_all": CUBE_ALL,
      "minecraft:block/oak_planks": {
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/oak_planks" },
      },
    })[id],
  texture: (id) =>
    id === "minecraft:block/oak_planks" ? solid([150, 120, 70]) : null,
};

export async function loadAll(natura = true) {
  await modRegistry.addLoadedMods([
    { meta: UCW, assets: UCW_ASSETS },
    { meta: CHISEL, assets: CHISEL_ASSETS },
    ...(natura ? [{ meta: NATURA, assets: NATURA_ASSETS }] : []),
  ]);
}
