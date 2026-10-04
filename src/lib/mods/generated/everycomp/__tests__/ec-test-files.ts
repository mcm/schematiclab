// Hand-made 1.21.1 mod files for the Every Compat family's tests: metadata,
// solid-colour synthetic PNGs and asset records (nothing is copied from a
// jar).

import { encodePng } from "../../../../render/__tests__/encode-png";
import type { RgbaImage } from "../../../../render/block-appearance";
import type { LoadedModAssets, LoadedModMeta, ModBlock } from "../../../types";

export const VERSION = "1.21.1";

export function image(colors: [number, number, number][], size = 4): RgbaImage {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data.set([...colors[i % colors.length], 255], i * 4);
  }
  return { width: size, height: size, data };
}

export function png(
  colors: [number, number, number][],
  alpha?: number[],
): Blob {
  const img = image(colors);
  if (alpha) {
    for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i];
  }
  return new Blob([encodePng({ ...img, colorType: 6, scanlines: img.data })], {
    type: "image/png",
  });
}

export function meta(
  modId: number,
  namespace: string,
  blocks: string[],
  properties: Record<string, Record<string, string[]>> = {},
): LoadedModMeta {
  return {
    key: `${modId}:${VERSION}`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId: modId * 10,
    fileDisplayName: `mod-${modId}.jar`,
    gameVersion: VERSION,
    gameVersions: [VERSION],
    loader: "neoforge",
    namespaces: [namespace],
    blocks: blocks.map(
      (id): ModBlock => ({
        id,
        displayName: id,
        properties: properties[id] ?? {},
      }),
    ),
    loadedAt: modId * 10,
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

export const cubeAll = (texture: string) => ({
  parent: "minecraft:block/cube_all",
  textures: { all: texture },
});

export const single = (model: string) => ({ variants: { "": { model } } });
