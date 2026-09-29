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

// Packs `values` the way Litematica does: `bits` per value, least
// significant bits first, spanning long boundaries, each long big-endian.
// Written independently of `LongArray.writePackedUint` so the read path is
// checked against the format rather than against our own writer.
function packLongs(values: number[], bits: number): nbt.LongArray {
  const longCount = Math.ceil((values.length * bits) / 64);
  let packed = 0n;
  values.forEach((v, i) => {
    packed |= BigInt(v) << BigInt(i * bits);
  });
  const storage = new Uint8Array(longCount * 8);
  const view = new DataView(storage.buffer);
  for (let i = 0; i < longCount; i++) {
    view.setBigUint64(i * 8, BigInt.asUintN(64, packed >> BigInt(i * 64)));
  }
  return new nbt.LongArray(storage);
}

const LETTERS: Record<string, string> = {
  S: "minecraft:stone",
  D: "minecraft:dirt",
  P: "minecraft:oak_planks",
  G: "minecraft:glass",
  C: "minecraft:cobblestone",
  A: "minecraft:sand",
  R: "minecraft:gravel",
};

// Storage index i = x + z * width + y * width * length, value (i % 7) + 1.
// Layers are y, rows are z, columns are x.
const EXPECTED_LAYERS = [
  ["SDPG", "CARS", "DPGC"],
  ["ARSD", "PGCA", "RSDP"],
];

describe("LitematicRegion.getBlockMatrix", () => {
  it("reads blocks in Litematica's x, then z, then y order", () => {
    const palette = [
      BlockState.AIR_BLOCK,
      ...Object.values(LETTERS).map(
        (Name) => new BlockState({ Name, Properties: {} }),
      ),
    ];
    // 24 values at 3 bits spans two longs; index 21 straddles the boundary.
    const values = Array.from({ length: 24 }, (_, i) => (i % 7) + 1);

    const expected: Record<string, string> = {};
    EXPECTED_LAYERS.forEach((rows, y) =>
      rows.forEach((row, z) =>
        [...row].forEach((letter, x) => {
          expected[`${x},${y},${z}`] = LETTERS[letter];
        }),
      ),
    );

    for (const size of [new BlockPos(4, 2, 3), new BlockPos(-4, -2, -3)]) {
      const region = new LitematicRegion({
        size,
        blockStatePalette: palette,
        blockStates: packLongs(values, 3),
        position: BlockPos.ORIGIN,
        minecraftVersion: getVersion("1.20.1"),
      });
      expect(namesByPos(region)).toEqual(expected);
    }
  });

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
