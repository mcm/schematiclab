import { describe, expect, it } from "vitest";

import { BlockPos, BlockState } from "../blocks";
import * as nbt from "../nbt";
import { LitematicRegion } from "../schematic-formats/litematic";
import { getVersion } from "../schematic-formats/version-mapping";

// Palette of 5 entries → 3 bits per block, so indices straddle long
// boundaries once the region is large enough.
const PALETTE = [
  BlockState.AIR_BLOCK,
  new BlockState({ Name: "minecraft:stone", Properties: {} }),
  new BlockState({ Name: "minecraft:dirt", Properties: {} }),
  new BlockState({ Name: "minecraft:oak_planks", Properties: {} }),
  new BlockState({ Name: "minecraft:glass", Properties: {} }),
];

function makeRegion(size: BlockPos): LitematicRegion {
  const volume = Math.abs(size.x * size.y * size.z);
  const bits = 3;
  const storage = new Uint8Array(Math.ceil((volume * bits) / 64) * 8);
  const blockStates = new nbt.LongArray(storage);
  for (let i = 0; i < volume; i++) {
    blockStates.writePackedUint(i, bits, 1 + (i % 4));
  }
  return new LitematicRegion({
    size,
    blockStatePalette: PALETTE,
    blockStates,
    position: BlockPos.ORIGIN,
    minecraftVersion: getVersion("1.20.1"),
  });
}

function namesByPos(region: LitematicRegion): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, block] of region.getBlockMatrix()) {
    out[key] = block.state.Name;
  }
  return out;
}

describe("LitematicRegion.getBlockMatrix", () => {
  it("reads regions with negative sizes using absolute dimensions", () => {
    const positive = namesByPos(makeRegion(new BlockPos(7, 5, 9)));
    expect(Object.keys(positive)).toHaveLength(7 * 5 * 9);

    for (const size of [
      new BlockPos(-7, 5, -9),
      new BlockPos(-7, -5, -9),
      new BlockPos(7, 5, -9),
      new BlockPos(-7, 5, 9),
    ]) {
      expect(namesByPos(makeRegion(size))).toEqual(positive);
    }
  });
});
