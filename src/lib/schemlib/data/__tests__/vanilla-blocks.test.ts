import { describe, expect, it } from "vitest";

import { KNOWN_VERSIONS } from "../../schematic-formats/known-versions";
import {
  vanillaBlocksAtAnchor,
  vanillaBlocksForVersion,
} from "../vanilla-blocks";

describe("vanillaBlocksForVersion", () => {
  it("adds blocks in the version that introduced them", () => {
    expect(
      vanillaBlocksForVersion(KNOWN_VERSIONS["1.18.2"]).has(
        "minecraft:cherry_planks",
      ),
    ).toBe(false);
    expect(
      vanillaBlocksForVersion(KNOWN_VERSIONS["1.20.1"]).has(
        "minecraft:cherry_planks",
      ),
    ).toBe(true);
    expect(
      vanillaBlocksForVersion(KNOWN_VERSIONS["1.16.5"]).has(
        "minecraft:crimson_planks",
      ),
    ).toBe(true);
    expect(
      vanillaBlocksAtAnchor("1.15.2").has("minecraft:crimson_planks"),
    ).toBe(false);
  });

  it("applies renames", () => {
    const v1_16 = vanillaBlocksForVersion(KNOWN_VERSIONS["1.16.5"]);
    const v1_17 = vanillaBlocksForVersion(KNOWN_VERSIONS["1.17.1"]);
    expect(v1_16.has("minecraft:grass_path")).toBe(true);
    expect(v1_16.has("minecraft:dirt_path")).toBe(false);
    expect(v1_17.has("minecraft:grass_path")).toBe(false);
    expect(v1_17.has("minecraft:dirt_path")).toBe(true);
  });

  it("uses the flattened legacy blocks for 1.12.2", () => {
    const blocks = vanillaBlocksAtAnchor("1.12.2");
    expect(blocks.has("minecraft:stone")).toBe(true);
    expect(blocks.has("minecraft:kelp")).toBe(false);
    expect(vanillaBlocksAtAnchor("1.13.2").has("minecraft:kelp")).toBe(true);
  });

  it("keeps staple blocks through the newest anchor", () => {
    const newest = vanillaBlocksAtAnchor("26.3");
    expect(newest.has("minecraft:stone")).toBe(true);
    expect(newest.has("minecraft:pale_oak_planks")).toBe(true);
  });
});
