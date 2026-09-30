import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSchematic } from "../../convert";
import { extractCamoSlots, isCamoCapableBlockId } from "../extract";

// All camo fixtures (CAMO_FIXTURES.md). Each block type gets one row, and the
// last block in a row has no camo.
const FIXTURES = [
  "framed_blocks_minimal_nbt.nbt",
  "copycats_nbt.nbt",
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

interface CamoBlock {
  blockId: string;
  pos: [number, number, number];
  kinds: string[];
}

describe.each(FIXTURES)("extractCamoSlots on %s", (filename) => {
  it("empties only the last block in each row", () => {
    const parsed = parseSchematic(fixtureBytes(filename));
    if (!parsed.ok) throw new Error(parsed.error);
    const { palette, regions } = parsed.schematic;

    const blocks: CamoBlock[] = [];
    for (const region of regions) {
      const placements = new Map(
        region.blocks.map((block) => [block.pos.join(","), block]),
      );
      for (const entity of region.blockEntities) {
        const placement = placements.get(entity.pos.join(","));
        if (placement === undefined) continue;
        const entry = palette[placement.paletteIndex];
        if (!isCamoCapableBlockId(entry.blockId)) continue;
        const slots = extractCamoSlots(
          entry.blockId,
          entry.properties,
          entity.nbt,
        );
        blocks.push({
          blockId: entry.blockId,
          pos: entity.pos,
          kinds: slots.map((slot) => slot.kind),
        });
      }
    }
    expect(blocks.length).toBeGreaterThan(0);

    // A row is every cell of one block type, in placement order (z, then x);
    // a door's upper half sits in its lower half's cell.
    const cellKey = ({ pos }: CamoBlock) => `${pos[0]},${pos[2]}`;
    const byType = new Map<string, CamoBlock[]>();
    for (const block of blocks) {
      byType.set(block.blockId, [...(byType.get(block.blockId) ?? []), block]);
    }
    const problems: string[] = [];
    for (const [blockId, row] of byType) {
      row.sort((a, b) => a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0]);
      const lastCell = cellKey(row[row.length - 1]);
      for (const block of row) {
        const where = `${blockId} at ${block.pos.join(",")}`;
        if (cellKey(block) === lastCell) {
          if (
            block.kinds.length === 0 ||
            block.kinds.some((kind) => kind !== "empty")
          ) {
            problems.push(`${where}: expected only empty slots`);
          }
        } else if (!block.kinds.includes("block")) {
          problems.push(`${where}: no block slot (${block.kinds.join(",")})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
