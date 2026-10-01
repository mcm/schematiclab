import { describe, expect, it } from "vitest";

import type { ParsedSchematicBlockEntity } from "../../convert";
import type { MinecraftVersion } from "../../schemlib/schematic-formats/version-mapping";
import {
  applyBlockSwap,
  applyVersionMapping,
  type Schematic,
  type SchematicRegion,
} from "../edit";

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

function schematic(
  palette: Array<{
    blockState: string;
    blockId: string;
    properties?: Record<string, string>;
    count: number;
  }>,
  regions: Array<{
    origin?: [number, number, number];
    size?: [number, number, number];
    blocks: Array<{ pos: [number, number, number]; paletteIndex: number }>;
    blockEntities?: ParsedSchematicBlockEntity[];
  }>,
  version: MinecraftVersion = V_1_20_1,
): Schematic {
  const builtRegions: SchematicRegion[] = regions.map((r) => ({
    origin: r.origin ?? [0, 0, 0],
    size: r.size ?? [4, 1, 1],
    blocks: r.blocks,
    blockEntities: r.blockEntities ?? [],
  }));
  const totalBlocks = builtRegions.reduce(
    (sum, region) => sum + region.blocks.length,
    0,
  );
  return {
    name: "test",
    inputFormat: "Litematic",
    minecraftVersion: version,
    totalBlocks,
    palette: palette.map((e) => ({ ...e, properties: e.properties ?? {} })),
    regions: builtRegions,
  };
}

describe("applyBlockSwap", () => {
  it("changes counts when a state is swapped to a different block id", () => {
    const before = schematic(
      [
        { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 3 },
        { blockState: "minecraft:dirt", blockId: "minecraft:dirt", count: 1 },
      ],
      [
        {
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 0 },
            { pos: [2, 0, 0], paletteIndex: 0 },
            { pos: [3, 0, 0], paletteIndex: 1 },
          ],
        },
      ],
    );

    const after = applyBlockSwap(before, "minecraft:stone", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });

    // Returned a NEW projection — input is not aliased.
    expect(after).not.toBe(before);
    expect(before.palette[0].count).toBe(3);

    // Counts have moved: stone is gone, cobblestone has stone's count.
    expect(after.palette.map((e) => [e.blockId, e.count])).toEqual([
      ["minecraft:cobblestone", 3],
      ["minecraft:dirt", 1],
    ]);
    expect(after.totalBlocks).toBe(4);

    // Every placement that pointed at stone now points at cobblestone.
    const cobbleIdx = after.palette.findIndex(
      (e) => e.blockId === "minecraft:cobblestone",
    );
    expect(after.regions[0].blocks[0].paletteIndex).toBe(cobbleIdx);
    expect(after.regions[0].blocks[1].paletteIndex).toBe(cobbleIdx);
    expect(after.regions[0].blocks[2].paletteIndex).toBe(cobbleIdx);
    expect(after.regions[0].blocks[3].paletteIndex).not.toBe(cobbleIdx);
  });

  it("applies the swap to every region", () => {
    const before = schematic(
      [{ blockState: "minecraft:stone", blockId: "minecraft:stone", count: 4 }],
      [
        {
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 0 },
          ],
        },
        {
          origin: [10, 0, 0],
          blocks: [
            { pos: [10, 0, 0], paletteIndex: 0 },
            { pos: [11, 0, 0], paletteIndex: 0 },
          ],
        },
      ],
    );
    const after = applyBlockSwap(before, "minecraft:stone", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });
    const cobbleIdx = after.palette.findIndex(
      (e) => e.blockId === "minecraft:cobblestone",
    );
    expect(cobbleIdx).toBeGreaterThanOrEqual(0);
    for (const region of after.regions) {
      for (const placement of region.blocks) {
        expect(placement.paletteIndex).toBe(cobbleIdx);
      }
    }
  });

  it("removes placements when the target is air", () => {
    const before = schematic(
      [
        { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 2 },
        { blockState: "minecraft:dirt", blockId: "minecraft:dirt", count: 1 },
      ],
      [
        {
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 0 },
            { pos: [2, 0, 0], paletteIndex: 1 },
          ],
        },
      ],
    );

    const after = applyBlockSwap(before, "minecraft:stone", {
      blockId: "minecraft:air",
      properties: {},
    });

    // Stone is gone; only dirt remains in the palette.
    expect(after.palette.map((e) => [e.blockId, e.count])).toEqual([
      ["minecraft:dirt", 1],
    ]);
    // The two stone placements were physically dropped from the region.
    expect(after.regions[0].blocks.map((b) => b.pos)).toEqual([[2, 0, 0]]);
    expect(after.totalBlocks).toBe(1);
  });

  it("keeps tile entities when the swap is to the same block id (property change)", () => {
    const blockEntity: ParsedSchematicBlockEntity = {
      pos: [0, 0, 0],
      nbt: {
        type: "compound",
        entries: { id: { type: "string", value: "minecraft:chest" } },
      },
    };
    const before = schematic(
      [
        {
          blockState: "minecraft:chest[facing=north]",
          blockId: "minecraft:chest",
          properties: { facing: "north" },
          count: 1,
        },
      ],
      [
        {
          blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
          blockEntities: [blockEntity],
        },
      ],
    );
    const after = applyBlockSwap(before, "minecraft:chest[facing=north]", {
      blockId: "minecraft:chest",
      properties: { facing: "south" },
    });
    expect(after.regions[0].blockEntities).toEqual([blockEntity]);
  });

  it("drops tile entities when the swap changes the block id", () => {
    const before = schematic(
      [
        {
          blockState: "minecraft:chest[facing=north]",
          blockId: "minecraft:chest",
          properties: { facing: "north" },
          count: 1,
        },
      ],
      [
        {
          blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
          blockEntities: [
            {
              pos: [0, 0, 0],
              nbt: {
                type: "compound",
                entries: { id: { type: "string", value: "minecraft:chest" } },
              },
            },
          ],
        },
      ],
    );
    const after = applyBlockSwap(before, "minecraft:chest[facing=north]", {
      blockId: "minecraft:stone",
      properties: {},
    });
    expect(after.regions[0].blockEntities).toEqual([]);
  });
});

describe("applyVersionMapping", () => {
  it("leaves loaded mod block ids and properties unchanged", () => {
    const before = schematic(
      [
        {
          blockState: "create:andesite_casing[axis=y]",
          blockId: "create:andesite_casing",
          properties: { axis: "y" },
          count: 2,
        },
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          count: 1,
        },
      ],
      [
        {
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 0 },
            { pos: [2, 0, 0], paletteIndex: 1 },
          ],
        },
      ],
      V_1_16_5,
    );

    const after = applyVersionMapping(
      before,
      V_1_17_1,
      {},
      {
        create: {
          kind: "target",
          blocks: { "create:andesite_casing": { axis: ["x", "y", "z"] } },
        },
      },
    );

    const modded = after.palette.find(
      (e) => e.blockId === "create:andesite_casing",
    );
    expect(modded).toEqual({
      blockState: "create:andesite_casing[axis=y]",
      blockId: "create:andesite_casing",
      properties: { axis: "y" },
      count: 2,
    });
    // Vanilla entries still translate.
    const ids = new Set(after.palette.map((e) => e.blockId));
    expect(ids.has("minecraft:dirt_path")).toBe(true);
  });

  it("keeps loaded mod blocks across the flattening instead of mapping to air", () => {
    const before = schematic(
      [
        {
          blockState: "create:andesite_casing[axis=y]",
          blockId: "create:andesite_casing",
          properties: { axis: "y" },
          count: 1,
        },
      ],
      [{ blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }] }],
      V_1_16_5,
    );
    const V_1_12_2: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 12, 2],
      dataVersion: 1343,
    };

    const withIds = applyVersionMapping(
      before,
      V_1_12_2,
      {},
      {
        create: {
          kind: "target",
          blocks: { "create:andesite_casing": { axis: ["x", "y", "z"] } },
        },
      },
    );
    expect(withIds.palette.map((e) => e.blockState)).toEqual([
      "create:andesite_casing[axis=y]",
    ]);
    expect(withIds.regions[0].blocks).toHaveLength(1);

    const withoutIds = applyVersionMapping(before, V_1_12_2);
    expect(
      withoutIds.palette.some((e) => e.blockId === "create:andesite_casing"),
    ).toBe(false);
  });

  it("renames blocks naturally via the version diff walker", () => {
    // grass_path → dirt_path is a real 1.16 → 1.17 rename in the diff chain.
    const before = schematic(
      [
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          count: 2,
        },
        {
          blockState: "minecraft:stone",
          blockId: "minecraft:stone",
          count: 1,
        },
      ],
      [
        {
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 0 },
            { pos: [2, 0, 0], paletteIndex: 1 },
          ],
        },
      ],
      V_1_16_5,
    );

    const after = applyVersionMapping(before, V_1_17_1);

    expect(after.minecraftVersion).toEqual(V_1_17_1);
    const ids = new Set(after.palette.map((e) => e.blockId));
    expect(ids.has("minecraft:dirt_path")).toBe(true);
    expect(ids.has("minecraft:grass_path")).toBe(false);
    // Stone passes through unchanged.
    expect(ids.has("minecraft:stone")).toBe(true);
  });

  it("preserves the user's overrides for blocks the mapper would have changed", () => {
    // The natural mapper turns grass_path into dirt_path across 1.16→1.17. We
    // tell it to map grass_path → coarse_dirt instead; the override must win,
    // even though dirt_path is a perfectly valid 1.17 block.
    const before = schematic(
      [
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          count: 2,
        },
        {
          blockState: "minecraft:stone",
          blockId: "minecraft:stone",
          count: 1,
        },
      ],
      [
        {
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 0 },
            { pos: [2, 0, 0], paletteIndex: 1 },
          ],
        },
      ],
      V_1_16_5,
    );

    const after = applyVersionMapping(before, V_1_17_1, {
      "minecraft:grass_path": {
        blockId: "minecraft:coarse_dirt",
        properties: {},
      },
    });

    expect(after.minecraftVersion).toEqual(V_1_17_1);
    const ids = new Set(after.palette.map((e) => e.blockId));
    // Override wins: coarse_dirt is in, dirt_path (the natural target) is not.
    expect(ids.has("minecraft:coarse_dirt")).toBe(true);
    expect(ids.has("minecraft:dirt_path")).toBe(false);
    expect(ids.has("minecraft:grass_path")).toBe(false);

    // The two grass_path placements both point at coarse_dirt now.
    const coarseIdx = after.palette.findIndex(
      (e) => e.blockId === "minecraft:coarse_dirt",
    );
    expect(coarseIdx).toBeGreaterThanOrEqual(0);
    expect(
      after.regions[0].blocks
        .filter((b) => b.pos[0] === 0 || b.pos[0] === 1)
        .every((b) => b.paletteIndex === coarseIdx),
    ).toBe(true);
  });

  it("returns a new schematic — original input is not mutated", () => {
    const before = schematic(
      [
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          count: 1,
        },
      ],
      [{ blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }] }],
      V_1_16_5,
    );
    const after = applyVersionMapping(before, V_1_17_1);
    expect(after).not.toBe(before);
    expect(before.minecraftVersion).toEqual(V_1_16_5);
    expect(before.palette[0].blockId).toBe("minecraft:grass_path");
  });
});

describe("applyVersionMapping with a ModMappingContext", () => {
  const V_1_12_2: MinecraftVersion = {
    platform: "java",
    versionNumber: [1, 12, 2],
    dataVersion: 1343,
  };

  function moddedSchematic(version: MinecraftVersion = V_1_16_5): Schematic {
    return schematic(
      [
        {
          blockState: "create:andesite_casing[axis=y]",
          blockId: "create:andesite_casing",
          properties: { axis: "y" },
          count: 1,
        },
        {
          blockState: "create:belt[facing=up,part=middle]",
          blockId: "create:belt",
          properties: { facing: "up", part: "middle" },
          count: 1,
        },
        {
          blockState: "create:gone_block",
          blockId: "create:gone_block",
          count: 1,
        },
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          count: 1,
        },
      ],
      [
        {
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 1 },
            { pos: [2, 0, 0], paletteIndex: 2 },
            { pos: [3, 0, 0], paletteIndex: 3 },
          ],
        },
      ],
      version,
    );
  }

  const replaceContext = {
    create: {
      kind: "replace" as const,
      newNamespace: "createplus",
      blocks: {
        "createplus:andesite_casing": { axis: ["x", "y", "z"] },
        "createplus:belt": { facing: ["east", "north"] },
      },
      // The old mod's file, showing `part` and `facing=up` mattered.
      sourceBlocks: {
        "create:belt": {
          facing: ["east", "north", "up"],
          part: ["end", "middle", "start"],
        },
      },
    },
  };

  function states(s: Schematic): string[] {
    return s.palette.map((e) => e.blockState).sort();
  }

  it("applies replacement rewrites and best-effort states", () => {
    const after = applyVersionMapping(
      moddedSchematic(),
      V_1_17_1,
      {},
      replaceContext,
    );
    expect(states(after)).toEqual([
      "create:gone_block",
      "createplus:andesite_casing[axis=y]",
      "createplus:belt[facing=east]",
      "minecraft:dirt_path",
    ]);
    expect(after.minecraftVersion).toEqual(V_1_17_1);
  });

  it("with a null target leaves vanilla and minecraftVersion untouched", () => {
    const before = moddedSchematic();
    const after = applyVersionMapping(before, null, {}, replaceContext);
    expect(states(after)).toEqual([
      "create:gone_block",
      "createplus:andesite_casing[axis=y]",
      "createplus:belt[facing=east]",
      "minecraft:grass_path",
    ]);
    expect(after.minecraftVersion).toBe(before.minecraftVersion);
  });

  it("user overrides win over modded resolution", () => {
    const after = applyVersionMapping(
      moddedSchematic(),
      null,
      {
        "create:gone_block": { blockId: "minecraft:stone", properties: {} },
        "create:belt[facing=up,part=middle]": {
          blockId: "createplus:belt",
          properties: { facing: "north" },
        },
      },
      replaceContext,
    );
    expect(states(after)).toEqual([
      "createplus:andesite_casing[axis=y]",
      "createplus:belt[facing=north]",
      "minecraft:grass_path",
      "minecraft:stone",
    ]);
  });

  it("target validates in place; keep, unmapped and pending pass through", () => {
    for (const mapping of [
      { kind: "keep" as const },
      { kind: "unmapped" as const },
      { kind: "pending" as const },
    ]) {
      // Across the flattening an untranslated modded id would become air.
      const after = applyVersionMapping(
        moddedSchematic(),
        V_1_12_2,
        {},
        {
          create: mapping,
        },
      );
      expect(
        after.palette.filter((e) => e.blockId.startsWith("create:")),
      ).toHaveLength(3);
    }

    const after = applyVersionMapping(
      moddedSchematic(),
      null,
      {},
      {
        create: {
          kind: "target",
          blocks: { "create:belt": { facing: ["east"], part: ["middle"] } },
        },
      },
    );
    expect(states(after)).toEqual([
      "create:andesite_casing[axis=y]",
      "create:belt[facing=east,part=middle]",
      "create:gone_block",
      "minecraft:grass_path",
    ]);
  });
});
