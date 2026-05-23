import { describe, expect, it } from "vitest";

import type { ParsedSchematicProjection } from "../convert";
import { swapBlockState } from "../swap-projection";

function projection(
  palette: Array<{
    blockState: string;
    blockId: string;
    properties?: Record<string, string>;
    count: number;
  }>,
  blocks: Array<{ pos: [number, number, number]; paletteIndex: number }>,
): ParsedSchematicProjection {
  return {
    name: "test",
    inputFormat: "Litematic",
    minecraftVersion: {
      platform: "java",
      versionNumber: [1, 20, 1],
      dataVersion: 3463,
    },
    totalBlocks: blocks.length,
    palette: palette.map((e) => ({ ...e, properties: e.properties ?? {} })),
    regions: [{ origin: [0, 0, 0], size: [4, 1, 1], blocks }],
  };
}

describe("swapBlockState", () => {
  it("redirects all matching placements to the target", () => {
    const p = projection(
      [
        { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 3 },
        { blockState: "minecraft:dirt", blockId: "minecraft:dirt", count: 1 },
      ],
      [
        { pos: [0, 0, 0], paletteIndex: 0 },
        { pos: [1, 0, 0], paletteIndex: 0 },
        { pos: [2, 0, 0], paletteIndex: 0 },
        { pos: [3, 0, 0], paletteIndex: 1 },
      ],
    );
    const next = swapBlockState(p, "minecraft:stone", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });
    expect(next.totalBlocks).toBe(4);
    // Cobblestone replaces stone, sorted by count desc.
    expect(next.palette.map((e) => [e.blockId, e.count])).toEqual([
      ["minecraft:cobblestone", 3],
      ["minecraft:dirt", 1],
    ]);
    // Positions are preserved.
    const positions = next.regions[0].blocks.map((b) => b.pos);
    expect(positions).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
    // Indexes resolve correctly.
    const cobbleIdx = next.palette.findIndex(
      (e) => e.blockId === "minecraft:cobblestone",
    );
    expect(next.regions[0].blocks[0].paletteIndex).toBe(cobbleIdx);
    expect(next.regions[0].blocks[3].paletteIndex).not.toBe(cobbleIdx);
  });

  it("merges into an existing target entry when one exists", () => {
    const p = projection(
      [
        { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 1 },
        { blockState: "minecraft:dirt", blockId: "minecraft:dirt", count: 2 },
      ],
      [
        { pos: [0, 0, 0], paletteIndex: 0 },
        { pos: [1, 0, 0], paletteIndex: 1 },
        { pos: [2, 0, 0], paletteIndex: 1 },
      ],
    );
    const next = swapBlockState(p, "minecraft:stone", {
      blockId: "minecraft:dirt",
      properties: {},
    });
    expect(next.palette).toEqual([
      expect.objectContaining({ blockId: "minecraft:dirt", count: 3 }),
    ]);
  });

  it("deletes placements when target is air", () => {
    const p = projection(
      [
        { blockState: "minecraft:stone", blockId: "minecraft:stone", count: 2 },
        { blockState: "minecraft:dirt", blockId: "minecraft:dirt", count: 1 },
      ],
      [
        { pos: [0, 0, 0], paletteIndex: 0 },
        { pos: [1, 0, 0], paletteIndex: 0 },
        { pos: [2, 0, 0], paletteIndex: 1 },
      ],
    );
    const next = swapBlockState(p, "minecraft:stone", {
      blockId: "minecraft:air",
      properties: {},
    });
    // Stone goes away entirely, only dirt remains.
    expect(next.palette).toEqual([
      expect.objectContaining({ blockId: "minecraft:dirt", count: 1 }),
    ]);
    expect(next.totalBlocks).toBe(1);
    expect(next.regions[0].blocks).toHaveLength(1);
  });

  it("returns the same projection when source isn't in the palette", () => {
    const p = projection(
      [{ blockState: "minecraft:stone", blockId: "minecraft:stone", count: 1 }],
      [{ pos: [0, 0, 0], paletteIndex: 0 }],
    );
    const next = swapBlockState(p, "minecraft:nonexistent", {
      blockId: "minecraft:dirt",
      properties: {},
    });
    expect(next).toBe(p);
  });

  it("treats a swap to the same state as a no-op", () => {
    const p = projection(
      [{ blockState: "minecraft:stone", blockId: "minecraft:stone", count: 1 }],
      [{ pos: [0, 0, 0], paletteIndex: 0 }],
    );
    const next = swapBlockState(p, "minecraft:stone", {
      blockId: "minecraft:stone",
      properties: {},
    });
    expect(next).toBe(p);
  });

  it("preserves the target's property suffix when present", () => {
    const p = projection(
      [
        {
          blockState: "minecraft:oak_planks",
          blockId: "minecraft:oak_planks",
          count: 1,
        },
      ],
      [{ pos: [0, 0, 0], paletteIndex: 0 }],
    );
    const next = swapBlockState(p, "minecraft:oak_planks", {
      blockId: "minecraft:oak_stairs",
      properties: { facing: "north", half: "bottom" },
    });
    expect(next.palette).toEqual([
      expect.objectContaining({
        blockId: "minecraft:oak_stairs",
        blockState: "minecraft:oak_stairs[facing=north,half=bottom]",
        properties: { facing: "north", half: "bottom" },
        count: 1,
      }),
    ]);
  });
});
