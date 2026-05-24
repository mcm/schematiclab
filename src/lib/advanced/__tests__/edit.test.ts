import { describe, expect, it } from "vitest";

import type { MinecraftVersion } from "../../schemlib/schematic-formats/version-mapping";
import {
  applyBlockSwap,
  applyVersionMapping,
  type Schematic,
  type SchematicRegion,
  type SchematicTileEntity,
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
    tileEntities?: SchematicTileEntity[];
  }>,
  version: MinecraftVersion = V_1_20_1,
): Schematic {
  const builtRegions: SchematicRegion[] = regions.map((r) => ({
    origin: r.origin ?? [0, 0, 0],
    size: r.size ?? [4, 1, 1],
    blocks: r.blocks,
    ...(r.tileEntities !== undefined ? { tileEntities: r.tileEntities } : {}),
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
    const tileEntity: SchematicTileEntity = {
      pos: [0, 0, 0],
      blockId: "minecraft:chest",
      data: { Items: [{ id: "minecraft:diamond", Count: 1 }] },
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
          tileEntities: [tileEntity],
        },
      ],
    );
    const after = applyBlockSwap(before, "minecraft:chest[facing=north]", {
      blockId: "minecraft:chest",
      properties: { facing: "south" },
    });
    expect(after.regions[0].tileEntities).toHaveLength(1);
    expect(after.regions[0].tileEntities?.[0]).toEqual(tileEntity);
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
          tileEntities: [
            {
              pos: [0, 0, 0],
              blockId: "minecraft:chest",
              data: { Items: [] },
            },
          ],
        },
      ],
    );
    const after = applyBlockSwap(before, "minecraft:chest[facing=north]", {
      blockId: "minecraft:stone",
      properties: {},
    });
    expect(after.regions[0].tileEntities).toEqual([]);
  });
});

describe("applyVersionMapping", () => {
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
