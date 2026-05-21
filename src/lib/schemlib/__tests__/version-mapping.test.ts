// These tests require real Minecraft cross-version block translation
// (e.g. via PyMCTranslate or prismarine-registry), which isn't implemented
// in this port — MinecraftVersionMapper.mapBlock is a no-op stub.
// Re-enable once a real translator is wired up.

import { describe, it, expect } from "vitest";

import { Block, BlockPos, BlockState } from "../blocks";
import { MinecraftVersionMapper, posKey } from "../schematic-formats/version-mapping";

const DIRT_PATH_BLOCK = new Block(
  BlockPos.ORIGIN,
  new BlockState({ Name: "minecraft:dirt_path" }),
);
const GRASS_PATH_BLOCK = new Block(
  BlockPos.ORIGIN,
  new BlockState({ Name: "minecraft:grass_path" }),
);
const STONE_BLOCK = new Block(
  BlockPos.ORIGIN,
  new BlockState({ Name: "minecraft:stone" }),
);
const SPRUCE_SLAB = new Block(
  BlockPos.ORIGIN,
  new BlockState({ Name: "minecraft:spruce_slab", Properties: { type: "top" } }),
);
const SPRUCE_WOODEN_SLAB = new Block(
  BlockPos.ORIGIN,
  new BlockState({
    Name: "minecraft:wooden_slab",
    Properties: { half: "top", variant: "spruce" },
  }),
);

describe("MinecraftVersionMapper", () => {
  it.skip("mapping unchanged block returns the same block", () => {
    const blockMatrix = new Map<string, Block>();
    blockMatrix.set(posKey(BlockPos.ORIGIN), STONE_BLOCK);

    const sourceVersion = MinecraftVersionMapper.getVersion("1.12.2");
    const targetVersion = MinecraftVersionMapper.getVersion("1.20.1");
    const mapper = new MinecraftVersionMapper(blockMatrix, sourceVersion);

    const mapped = mapper.mapBlock(STONE_BLOCK, targetVersion);
    expect(mapped.state.equals(STONE_BLOCK.state)).toBe(true);
    expect(mapped.pos.equals(STONE_BLOCK.pos)).toBe(true);
  });

  it.skip("mapping pre-flattening block returns post-flattening block", () => {
    const blockMatrix = new Map<string, Block>();
    blockMatrix.set(posKey(BlockPos.ORIGIN), SPRUCE_WOODEN_SLAB);

    const sourceVersion = MinecraftVersionMapper.getVersion("1.12.2");
    const targetVersion = MinecraftVersionMapper.getVersion("1.13.1");
    const mapper = new MinecraftVersionMapper(blockMatrix, sourceVersion);

    const mapped = mapper.mapBlock(SPRUCE_WOODEN_SLAB, targetVersion);
    expect(mapped.state.equals(SPRUCE_SLAB.state)).toBe(true);
    expect(mapped.pos.equals(SPRUCE_SLAB.pos)).toBe(true);
  });

  it.skip("mapping renamed block returns renamed block", () => {
    const blockMatrix = new Map<string, Block>();
    blockMatrix.set(posKey(BlockPos.ORIGIN), GRASS_PATH_BLOCK);

    const sourceVersion = MinecraftVersionMapper.getVersion("1.16.2");
    const targetVersion = MinecraftVersionMapper.getVersion("1.17.1");
    const mapper = new MinecraftVersionMapper(blockMatrix, sourceVersion);

    const mapped = mapper.mapBlock(GRASS_PATH_BLOCK, targetVersion);
    expect(mapped.state.equals(DIRT_PATH_BLOCK.state)).toBe(true);
    expect(mapped.pos.equals(DIRT_PATH_BLOCK.pos)).toBe(true);
  });
});
