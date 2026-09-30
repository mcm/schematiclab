import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractCamoSlots, isCamoCapableBlockId } from "../../../camo/extract";
import { parseSchematic } from "../../../convert";
import {
  matchShapeRule,
  validateShapePack,
  type ShapeRule,
} from "../shape-pack";

// Camo fixtures (CAMO_FIXTURES.md) whose every camo-capable placement must
// have shape data. Later stories add the rest as their shapes land.
const FIXTURES = [
  "framed_blocks_minimal_nbt.nbt",
  "framed_covered_1.nbt",
  "framed_covered_2.nbt",
  "framed_covered_3.nbt",
  "framed_covered_4.nbt",
];

// Slope-family types with no shapes yet (US-014/US-015 add them and must
// empty this list). Placements of these are skipped.
const PENDING = new Set(["framedblocks:framed_slope"]);

// The committed packs, merged by block id. Shapes are looked up by block id
// and state only, never by the fixture's DataVersion.
const PACKS = ["framedblocks.json"];

const rules = new Map<string, ShapeRule[]>();
for (const file of PACKS) {
  const pack = validateShapePack(
    JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../../../../../public/camo-shapes", file),
        "utf8",
      ),
    ),
  );
  for (const [id, blockRules] of Object.entries(pack.blocks)) {
    rules.set(id, blockRules);
  }
}

const fixtureBytes = (filename: string): Uint8Array =>
  new Uint8Array(
    readFileSync(
      path.resolve(__dirname, "../../../__tests__/fixtures", filename),
    ),
  );

describe.each(FIXTURES)("shape coverage of %s", (filename) => {
  it("resolves every camo-capable placement to pieces for each non-empty slot", () => {
    const parsed = parseSchematic(fixtureBytes(filename));
    if (!parsed.ok) throw new Error(parsed.error);
    const { palette, regions } = parsed.schematic;

    let checked = 0;
    const problems = new Set<string>();
    for (const region of regions) {
      const entities = new Map(
        region.blockEntities.map((e) => [e.pos.join(","), e.nbt]),
      );
      for (const placement of region.blocks) {
        const { blockId, blockState, properties } =
          palette[placement.paletteIndex];
        if (!isCamoCapableBlockId(blockId) || PENDING.has(blockId)) continue;
        checked++;
        const blockRules = rules.get(blockId);
        const rule = blockRules && matchShapeRule(blockRules, properties);
        if (!rule) {
          problems.add(`${blockState}: no shape`);
          continue;
        }
        const slots = extractCamoSlots(
          blockId,
          properties,
          entities.get(placement.pos.join(",")),
        );
        for (const slot of slots) {
          if (slot.kind === "empty") continue;
          if (!rule.pieces.some((piece) => piece.slot === slot.slot)) {
            problems.add(`${blockState}: no piece for slot ${slot.slot}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect([...problems]).toEqual([]);
  });
});
