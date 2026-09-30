import { describe, expect, it } from "vitest";

import type { ParsedSchematicProjection } from "../../convert";
import type { MinecraftVersion } from "../../schemlib/schematic-formats/version-mapping";
import { previewVersionMapping } from "../version-mapping-preview";

// Unknown (modded) ids only warn across the 1.13 flattening boundary.
const V_1_12_2: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 12, 2],
  dataVersion: 1343,
};

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

  describe("loaded mod blocks", () => {
    const moddedPalette = [
      {
        blockState: "create:andesite_casing[axis=y]",
        blockId: "create:andesite_casing",
        properties: { axis: "y" },
        count: 4,
      },
      { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 1 },
    ];

    it("counts entries provided by a loaded mod as clean with no warnings", () => {
      const schematic = projection(moddedPalette, V_1_20_1);

      const result = previewVersionMapping(schematic, V_1_12_2, {
        create: {
          kind: "target",
          blocks: { "create:andesite_casing": { axis: ["x", "y", "z"] } },
        },
      });
      expect(result.cleanCount).toBe(2);
      expect(result.problematicCount).toBe(0);
      expect(result.problematic).toEqual([]);
    });

    it("flags the modded entry as before when loaded ids are not passed", () => {
      const schematic = projection(moddedPalette, V_1_20_1);

      const result = previewVersionMapping(schematic, V_1_12_2);
      expect(result.cleanCount).toBe(1);
      expect(result.problematicCount).toBe(1);
      expect(result.problematic[0].sourceBlockId).toBe(
        "create:andesite_casing",
      );
      expect(result.problematic[0].warnings.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("previewVersionMapping with a ModMappingContext", () => {
  const palette = [
    {
      blockState: "create:andesite_casing[axis=y]",
      blockId: "create:andesite_casing",
      properties: { axis: "y" },
      count: 4,
    },
    {
      blockState: "create:gone_block",
      blockId: "create:gone_block",
      count: 2,
    },
    { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 1 },
  ];

  it("keeps vanilla problem rows labelled vanilla", () => {
    const schematic = projection(
      [
        {
          blockState: "minecraft:cherry_planks",
          blockId: "minecraft:cherry_planks",
          count: 1,
        },
      ],
      V_1_20_1,
    );
    const result = previewVersionMapping(schematic, V_1_16_5, {});
    expect(result.problematic[0].reason).toBe("vanilla");
    expect(result.pendingCount).toBe(0);
  });

  it("target: validates block existence and flags missing blocks", () => {
    const schematic = projection(palette, V_1_20_1);
    const result = previewVersionMapping(schematic, V_1_20_1, {
      create: {
        kind: "target",
        blocks: { "create:andesite_casing": { axis: ["x", "y", "z"] } },
      },
    });
    expect(result.cleanCount).toBe(2);
    expect(result.problematic).toHaveLength(1);
    const row = result.problematic[0];
    expect(row.reason).toBe("missing-block");
    expect(row.sourceBlockId).toBe("create:gone_block");
    expect(row.proposedTargetBlockState).toBe("create:gone_block");
    expect(row.warnings.length).toBe(1);
  });

  it("target: best-effort fixes properties with an invalid-state row", () => {
    const schematic = projection(
      [
        {
          blockState: "create:belt[facing=up,part=middle,slope=flat]",
          blockId: "create:belt",
          properties: { facing: "up", part: "middle", slope: "flat" },
          count: 3,
        },
      ],
      V_1_20_1,
    );
    const result = previewVersionMapping(schematic, V_1_20_1, {
      create: {
        kind: "target",
        blocks: {
          "create:belt": {
            facing: ["east", "north", "south", "west"],
            slope: ["flat", "up"],
            casing: ["false", "true"],
          },
        },
      },
    });
    expect(result.cleanCount).toBe(0);
    const row = result.problematic[0];
    expect(row.reason).toBe("invalid-state");
    // `part` dropped, `facing` falls back to the first value, `casing` unset.
    expect(row.proposedTargetProperties).toEqual({
      facing: "east",
      slope: "flat",
    });
    expect(row.proposedTargetBlockState).toBe(
      "create:belt[facing=east,slope=flat]",
    );
    expect(row.warnings).toHaveLength(2);
  });

  it("replace: rewrites the namespace and flags rewrites that don't exist", () => {
    const schematic = projection(palette, V_1_20_1);
    const result = previewVersionMapping(schematic, V_1_20_1, {
      create: {
        kind: "replace",
        newNamespace: "createplus",
        blocks: { "createplus:andesite_casing": { axis: ["x", "y", "z"] } },
      },
    });
    expect(result.cleanCount).toBe(2);
    expect(result.problematic).toHaveLength(1);
    expect(result.problematic[0].reason).toBe("missing-block");
    expect(result.problematic[0].proposedTargetBlockId).toBe(
      "create:gone_block",
    );
  });

  it("replace: property fixes apply to the rewritten block", () => {
    const schematic = projection(palette.slice(0, 1), V_1_20_1);
    const result = previewVersionMapping(schematic, V_1_20_1, {
      create: {
        kind: "replace",
        newNamespace: "createplus",
        blocks: { "createplus:andesite_casing": {} },
      },
    });
    const row = result.problematic[0];
    expect(row.reason).toBe("invalid-state");
    expect(row.proposedTargetBlockState).toBe("createplus:andesite_casing");
  });

  it("keep and unmapped produce mod-not-available / mod-unmapped rows", () => {
    const schematic = projection(
      [
        ...palette.slice(0, 1),
        { blockState: "mekanism:ore", blockId: "mekanism:ore", count: 1 },
      ],
      V_1_20_1,
    );
    const result = previewVersionMapping(schematic, V_1_16_5, {
      create: { kind: "keep" },
      mekanism: { kind: "unmapped" },
    });
    expect(result.problematic.map((r) => r.reason)).toEqual([
      "mod-not-available",
      "mod-unmapped",
    ]);
    expect(result.problematic[0].proposedTargetBlockState).toBe(
      "create:andesite_casing[axis=y]",
    );
  });

  it("pending entries are counted separately, not clean or problematic", () => {
    const schematic = projection(palette, V_1_20_1);
    const result = previewVersionMapping(schematic, V_1_20_1, {
      create: { kind: "pending" },
    });
    expect(result.pendingCount).toBe(2);
    expect(result.cleanCount).toBe(1);
    expect(result.problematicCount).toBe(0);
  });

  it("null target leaves vanilla clean and only runs the modded pass", () => {
    const schematic = projection(
      [
        ...palette,
        {
          blockState: "minecraft:cherry_planks",
          blockId: "minecraft:cherry_planks",
          count: 1,
        },
      ],
      V_1_20_1,
    );
    const result = previewVersionMapping(schematic, null, {
      create: {
        kind: "replace",
        newNamespace: "createplus",
        blocks: {
          "createplus:andesite_casing": { axis: ["x", "y", "z"] },
          "createplus:gone_block": {},
        },
      },
    });
    expect(result.targetVersion).toBeNull();
    expect(result.cleanCount).toBe(4);
    expect(result.problematic).toEqual([]);
  });
});
