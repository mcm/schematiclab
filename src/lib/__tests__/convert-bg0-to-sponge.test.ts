// End-to-end: a 1.12 Building Gadgets template converted to Sponge v2 at
// 1.21.4 must come out with post-flatten block names. Catches regressions in
// the convert orchestration → MinecraftVersionMapper → translator chain.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { convertSchematic } from "../convert";
import { SpongeSchematicV2 } from "../schemlib/schematic-formats/sponge";

describe("convert BG0 → Sponge v2 at 1.21.4", () => {
  it("produces post-flatten block names with no Forge artifacts", () => {
    const fp = path.resolve(__dirname, "fixtures/example_bg0_schematic.txt");
    const bytes = new Uint8Array(readFileSync(fp));

    const result = convertSchematic({
      bytes,
      inputFilename: "example_bg0_schematic.txt",
      outputFormat: "Sponge[v2]",
      targetVersion: "1.21.4",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Re-parse the produced Sponge v2 to inspect its palette.
    const out = SpongeSchematicV2.schematicLoad(result.bytes);
    const palette = out.getRegion(0).getPalette();
    const names = new Set(palette.map((s) => s.toString()));

    // No more Forge `variant=...` properties (the most common 1.12 marker).
    const stillForge = [...names].filter((n) => /\bvariant=/.test(n));
    expect(stillForge).toEqual([]);

    // No more pre-flatten composite names (planks, log, wooden_slab, etc.).
    const stillUnflattened = [...names].filter((n) =>
      /^minecraft:(planks|log|log2|leaves|leaves2|wooden_slab|stained_glass|carpet|wool|stone\[|sand\[)/.test(n),
    );
    expect(stillUnflattened).toEqual([]);

    // Spot-check known renames happened.
    if ([...names].some((n) => n.startsWith("minecraft:grass_path"))) {
      throw new Error("grass_path leaked through; expected dirt_path");
    }
    // Spruce planks should be present (the fixture has spruce_planks blocks).
    expect(names.has("minecraft:spruce_planks")).toBe(true);
  });
});
