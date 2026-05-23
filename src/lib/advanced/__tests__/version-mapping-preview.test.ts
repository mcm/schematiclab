import { describe, expect, it } from "vitest";

import type { ParsedSchematicProjection } from "../../convert";
import type { MinecraftVersion } from "../../schemlib/schematic-formats/version-mapping";
import { previewVersionMapping } from "../version-mapping-preview";

const V_1_16_5: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 16, 5],
  dataVersion: 2586,
};

const V_1_17_1: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 17, 1],
  dataVersion: 2730,
};

const V_1_20_1: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 20, 1],
  dataVersion: 3463,
};

function projection(
  palette: Array<{
    blockState: string;
    blockId: string;
    properties?: Record<string, string>;
    count: number;
  }>,
  version: MinecraftVersion = V_1_16_5,
): ParsedSchematicProjection {
  return {
    name: "test",
    inputFormat: "Litematic",
    minecraftVersion: version,
    totalBlocks: palette.reduce((sum, e) => sum + e.count, 0),
    palette: palette.map((e) => ({
      ...e,
      properties: e.properties ?? {},
    })),
    regions: [
      {
        origin: [0, 0, 0],
        size: [1, 1, 1],
        blocks: [],
      },
    ],
  };
}

describe("previewVersionMapping", () => {
  it("reports every entry as clean when source and target versions match", () => {
    const schematic = projection(
      [
        { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 5 },
        { blockState: "minecraft:dirt", blockId: "minecraft:dirt", count: 3 },
      ],
      V_1_16_5,
    );

    const result = previewVersionMapping(schematic, V_1_16_5);
    expect(result.cleanCount).toBe(2);
    expect(result.problematicCount).toBe(0);
    expect(result.problematic).toEqual([]);
    expect(result.targetVersion).toBe(V_1_16_5);
  });

  it("treats a 1.16 → 1.17 rename of grass_path → dirt_path as clean", () => {
    const schematic = projection(
      [
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          count: 4,
        },
      ],
      V_1_16_5,
    );

    const result = previewVersionMapping(schematic, V_1_17_1);
    expect(result.cleanCount).toBe(1);
    expect(result.problematicCount).toBe(0);
  });

  it("flags a 1.20-only block as problematic when mapping to 1.16.5", () => {
    const schematic = projection(
      [
        { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 1 },
        {
          blockState: "minecraft:cherry_planks",
          blockId: "minecraft:cherry_planks",
          count: 2,
        },
      ],
      V_1_20_1,
    );

    const result = previewVersionMapping(schematic, V_1_16_5);
    expect(result.cleanCount).toBe(1);
    expect(result.problematicCount).toBe(1);

    const row = result.problematic[0];
    expect(row.sourceBlockId).toBe("minecraft:cherry_planks");
    expect(row.sourceCount).toBe(2);
    expect(row.warnings.length).toBeGreaterThanOrEqual(1);
    // The translator falls back to air for blocks that didn't exist in the
    // target version.
    expect(row.proposedTargetBlockId).toBe("minecraft:air");
  });

  it("preserves the source palette ordering of problematic rows", () => {
    const schematic = projection(
      [
        {
          blockState: "minecraft:cherry_planks",
          blockId: "minecraft:cherry_planks",
          count: 1,
        },
        {
          blockState: "minecraft:bamboo_planks",
          blockId: "minecraft:bamboo_planks",
          count: 1,
        },
      ],
      V_1_20_1,
    );

    const result = previewVersionMapping(schematic, V_1_16_5);
    expect(result.problematicCount).toBe(2);
    expect(result.problematic[0].sourceBlockId).toBe("minecraft:cherry_planks");
    expect(result.problematic[1].sourceBlockId).toBe("minecraft:bamboo_planks");
  });
});
