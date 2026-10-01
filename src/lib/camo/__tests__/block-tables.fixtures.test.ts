import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSchematic } from "../../convert";
import {
  CAMO_BLOCK_IDS,
  DOUBLE_CAMO_BLOCK_IDS,
} from "../camo-blocks.generated";
import { camoBlockProperties } from "../block-properties";
import { isCamoCapableBlockId } from "../extract";

// Camo fixtures saved by Minecraft 26.1.2 and 1.21.1 (CAMO_FIXTURES.md); the
// two older samples predate the current mod versions.
const FIXTURES = [
  "copycats_shapes.nbt",
  "copycats_slopes.nbt",
  "framed_covered_1.nbt",
  "framed_covered_2.nbt",
  "framed_covered_3.nbt",
  "framed_covered_4.nbt",
  "framed_slopes_1.nbt",
  "framed_slopes_2.nbt",
  "framed_slope_slabs_panels_1.nbt",
  "framed_slope_slabs_panels_2.nbt",
];

const fixtureBytes = (filename: string): Uint8Array =>
  new Uint8Array(
    readFileSync(path.resolve(__dirname, "../../__tests__/fixtures", filename)),
  );

describe("camo block tables against the camo fixtures", () => {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const filename of FIXTURES) {
    const parsed = parseSchematic(fixtureBytes(filename));
    if (!parsed.ok) throw new Error(parsed.error);
    const { palette, regions } = parsed.schematic;
    for (const entry of palette) {
      if (!isCamoCapableBlockId(entry.blockId)) continue;
      seen.add(entry.blockId);
      const domains = camoBlockProperties(entry.blockId);
      if (domains === undefined) {
        problems.push(`${entry.blockId}: not in the table`);
        continue;
      }
      for (const [name, value] of Object.entries(entry.properties)) {
        if (!domains[name]?.includes(value)) {
          problems.push(`${entry.blockState}: ${name}=${value} not allowed`);
        }
      }
      for (const name of Object.keys(domains)) {
        if (!Object.hasOwn(entry.properties, name)) {
          problems.push(`${entry.blockState}: missing ${name}`);
        }
      }
    }
    for (const region of regions) {
      const at = new Map(region.blocks.map((b) => [b.pos.join(","), b]));
      for (const entity of region.blockEntities) {
        const placement = at.get(entity.pos.join(","));
        if (placement === undefined) continue;
        const { blockId } = palette[placement.paletteIndex];
        if (!blockId.startsWith("framedblocks:")) continue;
        const saved = Object.hasOwn(entity.nbt.entries, "camo_two");
        const listed = DOUBLE_CAMO_BLOCK_IDS.includes(blockId);
        if (saved !== listed) {
          problems.push(`${blockId}: camo_two saved=${saved} listed=${listed}`);
        }
      }
    }
  }

  it("lists every saved state's properties and values", () => {
    expect([...new Set(problems)]).toEqual([]);
  });

  it("lists exactly the fixtures' camo blocks", () => {
    expect([...CAMO_BLOCK_IDS].sort()).toEqual([...seen].sort());
  });
});
