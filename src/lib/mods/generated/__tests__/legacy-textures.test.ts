import { describe, expect, it } from "vitest";

import atlasUvs from "../../../../../public/minecraft-assets/atlas-uvs.json";
import {
  __LEGACY_TEXTURE_RENAMES_FOR_TESTS,
  modernVanillaTextureId,
} from "../legacy-textures";

describe("modernVanillaTextureId", () => {
  it("renames 1.12 vanilla textures", () => {
    expect(modernVanillaTextureId("minecraft:blocks/planks_oak")).toBe(
      "minecraft:block/oak_planks",
    );
    expect(modernVanillaTextureId("minecraft:blocks/stone_slab_top")).toBe(
      "minecraft:block/smooth_stone",
    );
    expect(modernVanillaTextureId("blocks/glass_pane_top_silver")).toBe(
      "minecraft:block/light_gray_stained_glass_pane_top",
    );
    expect(modernVanillaTextureId("minecraft:blocks/iron_bars")).toBe(
      "minecraft:block/iron_bars",
    );
  });

  it("leaves other ids alone", () => {
    expect(modernVanillaTextureId("minecraft:block/stone")).toBe(
      "minecraft:block/stone",
    );
    expect(modernVanillaTextureId("chisel:blocks/planks-oak/clean")).toBe(
      "chisel:blocks/planks-oak/clean",
    );
    expect(modernVanillaTextureId("minecraft:blocks/toString")).toBe(
      "minecraft:block/toString",
    );
  });

  it("only names textures the vanilla bundle has", () => {
    const missing = Object.values(__LEGACY_TEXTURE_RENAMES_FOR_TESTS).filter(
      (name) => !Object.hasOwn(atlasUvs, `block/${name}`),
    );
    expect(missing).toEqual([]);
  });
});
