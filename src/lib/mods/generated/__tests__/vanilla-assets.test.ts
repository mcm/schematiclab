import { describe, expect, it, vi } from "vitest";

import type { RgbaImage } from "../../../render/block-appearance";
import { vanillaAssetsFromBundle } from "../vanilla-assets";

// 4×6 atlas: pixel value = its index, so crops are easy to check.
function atlas(): RgbaImage {
  const width = 4;
  const height = 6;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.fill(i, i * 4, i * 4 + 4);
  return { width, height, data };
}

describe("vanillaAssetsFromBundle", () => {
  const decode = vi.fn(atlas);
  const assets = vanillaAssetsFromBundle({
    blockstates: { stone: { variants: {} } },
    models: { cube_all: { parent: "block/cube" } },
    uvs: {
      "block/stone": [1, 1, 2, 2],
      // Animated: a 2-wide strip of three frames.
      "block/lava_still": [0, 0, 2, 6],
      "block/bad": [3, 5, 2, 2],
    },
    atlas: decode,
  });

  it("looks blockstates and models up by namespaced id", () => {
    expect(assets.blockstate("minecraft:stone")).toEqual({ variants: {} });
    expect(assets.blockstate("mod:stone")).toBeUndefined();
    expect(assets.blockstate("minecraft:toString")).toBeUndefined();
    expect(assets.model("minecraft:block/cube_all")).toEqual({
      parent: "block/cube",
    });
    expect(assets.model("minecraft:item/cube_all")).toBeUndefined();
  });

  it("crops textures (first frame) out of the atlas, decoding it once", () => {
    const stone = assets.texture("minecraft:block/stone")!;
    expect([stone.width, stone.height]).toEqual([2, 2]);
    expect([...stone.data].filter((_, i) => i % 4 === 0)).toEqual([
      5, 6, 9, 10,
    ]);
    const lava = assets.texture("minecraft:block/lava_still")!;
    expect([lava.width, lava.height]).toEqual([2, 2]);
    expect(assets.texture("minecraft:block/bad")).toBeNull();
    expect(assets.texture("minecraft:block/unknown")).toBeNull();
    expect(assets.texture("mod:block/stone")).toBeNull();
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
