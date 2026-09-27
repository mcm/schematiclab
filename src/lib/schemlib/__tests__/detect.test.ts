import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as nbt from "../nbt";
import { detectSchematicType } from "../schematic-formats/detect";

const FIXTURES = path.join(__dirname, "../../__tests__/fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

/** Gzipped NBT whose root compound is named `rootName`. */
function nbtBytes(rootName: string, fields: Record<string, nbt.NbtTag>) {
  const root = new nbt.Compound();
  for (const [key, tag] of Object.entries(fields)) root.set(key, tag);
  return new nbt.Named({ [rootName]: root }).toBytes({ compress: true });
}

describe("detectSchematicType", () => {
  it.each([
    ["one_stone_block.litematic", "Litematic"],
    ["one_stone_block.nbt", "Structure"],
    ["one_stone_block_bg0.txt", "BuildingGadgets[1.12]"],
    ["example_bg0_schematic.txt", "BuildingGadgets[1.12]"],
    ["one_stone_block_bg1.txt", "BuildingGadgets[1.14.4-1.19.3]"],
    ["one_stone_block_bg2.txt", "BuildingGadgets2[1.20+]"],
    // v1/v2 fixtures have an unnamed root compound.
    ["one_stone_block_v1.schem", "Sponge[v1]"],
    ["one_stone_block_v2.schem", "Sponge[v2]"],
    ["one_stone_block_v3.schem", "Sponge[v3]"],
  ])("detects %s as %s", (name, expected) => {
    expect(detectSchematicType(fixture(name))).toBe(expected);
  });

  it("detects Sponge v2 with a root named Schematic", () => {
    const bytes = nbtBytes("Schematic", {
      Version: new nbt.Int(2),
      BlockData: new nbt.ByteArray([0]),
    });
    expect(detectSchematicType(bytes)).toBe("Sponge[v2]");
  });

  it("does not mistake a legacy MCEdit schematic for Sponge", () => {
    const bytes = nbtBytes("Schematic", {
      Blocks: new nbt.ByteArray([1]),
      Data: new nbt.ByteArray([0]),
      Materials: new nbt.StringTag("Alpha"),
    });
    expect(() => detectSchematicType(bytes)).toThrow(
      "Unrecognized schematic format",
    );
  });
});
