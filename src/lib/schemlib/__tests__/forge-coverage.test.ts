// Regression check: every Forge BlockState in the example_bg0_schematic.txt
// fixture must have a hit in FORGE_1_12_FLATTEN that resolves through
// FLATTEN_TABLE. If a future change drops coverage we want to know.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { BuildingGadgetsV0Schematic } from "../schematic-formats/building-gadgets";
import { FORGE_1_12_FLATTEN } from "../data/forge-1.12-flatten.generated";
import { FLATTEN_TABLE } from "../data/block-translations.generated";

describe("forge 1.12 flatten coverage", () => {
  it("covers every BG0 fixture palette state", () => {
    const fp = path.resolve(
      __dirname,
      "../../__tests__/fixtures/example_bg0_schematic.txt",
    );
    const s = BuildingGadgetsV0Schematic.schematicLoad(
      new Uint8Array(readFileSync(fp)),
    );
    const palette = new Set<string>();
    for (const b of s.getBlocks()) palette.add(b.state.toString());

    const missing: string[] = [];
    const noFlatten: string[] = [];
    for (const key of palette) {
      const idMeta = FORGE_1_12_FLATTEN[key];
      if (!idMeta) missing.push(key);
      else if (!FLATTEN_TABLE[idMeta]) noFlatten.push(`${key} → ${idMeta}`);
    }
    expect(missing).toEqual([]);
    expect(noFlatten).toEqual([]);
  });
});
