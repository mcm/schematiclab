// Regression coverage for the in-memory transform layer (`advanced/edit.ts`)
// using real fixture schematics and real schemlib code end-to-end. The other
// edit tests (edit.test.ts) drive the transforms with hand-built synthetic
// projections; these run the full parse → transform → serialize → re-parse
// pipeline against real bytes so we'd catch any regression in the boundary
// behaviour between schemlib, the projection layer, and the transform layer.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseSchematic,
  serializeSchematic,
  type ParsedSchematicProjection,
} from "../../convert";
import * as nbt from "../../schemlib/nbt";
import { Entity } from "../../schemlib/entities";
import {
  SpongeSchematicMetadata,
  SpongeSchematicV2,
} from "../../schemlib/schematic-formats/sponge";
import { KNOWN_VERSIONS } from "../../schemlib/schematic-formats/version-mapping";
import { applyBlockSwap, applyVersionMapping } from "../edit";

const fixturePath = (filename: string): string =>
  path.resolve(__dirname, "..", "..", "__tests__", "fixtures", filename);

const loadBytes = (filename: string): Uint8Array =>
  new Uint8Array(readFileSync(fixturePath(filename)));

function parseFixture(filename: string): ParsedSchematicProjection {
  const result = parseSchematic(loadBytes(filename));
  if (!result.ok) throw new Error(`parse failed: ${result.error}`);
  return result.schematic;
}

// Build a real (schemlib-encoded) Sponge v2 schematic from a plain palette +
// blockData layout and return the parsed projection. Uses real schemlib
// classes — SpongeSchematicV2 + parseSchematic — so the result is exactly the
// shape the editor sees in production.
function parseSyntheticSpongeV2(opts: {
  palette: Map<string, number>;
  width: number;
  height: number;
  length: number;
  blockData: number[];
  dataVersion: number;
}): ParsedSchematicProjection {
  const v2 = new SpongeSchematicV2({
    Version: 2,
    Metadata: new SpongeSchematicMetadata(),
    Width: opts.width,
    Height: opts.height,
    Length: opts.length,
    Offset: [0, 0, 0],
    DataVersion: opts.dataVersion,
    PaletteMax: opts.palette.size,
    Palette: opts.palette,
    BlockData: opts.blockData,
  });
  const bytes = v2.schematicDump();
  const result = parseSchematic(bytes);
  if (!result.ok) throw new Error(`parse failed: ${result.error}`);
  return result.schematic;
}

describe("applyBlockSwap on real fixtures", () => {
  it("swaps the stone palette entry of a parsed Litematic to cobblestone", () => {
    const before = parseFixture("one_stone_block.litematic");
    expect(before.palette.some((e) => e.blockId === "minecraft:stone")).toBe(
      true,
    );

    const after = applyBlockSwap(before, "minecraft:stone", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });

    expect(after).not.toBe(before);
    // Input not mutated.
    expect(before.palette.some((e) => e.blockId === "minecraft:stone")).toBe(
      true,
    );
    // Output: stone is gone, cobblestone took its place.
    expect(after.palette.some((e) => e.blockId === "minecraft:stone")).toBe(
      false,
    );
    const cobble = after.palette.find(
      (e) => e.blockId === "minecraft:cobblestone",
    );
    expect(cobble).toBeDefined();
    expect(cobble?.count).toBe(1);

    // Every placement that pointed at stone now points at cobblestone.
    const cobbleIdx = after.palette.findIndex(
      (e) => e.blockId === "minecraft:cobblestone",
    );
    const allPlacements = after.regions.flatMap((r) => r.blocks);
    expect(allPlacements).toHaveLength(1);
    expect(allPlacements[0].paletteIndex).toBe(cobbleIdx);
    expect(after.totalBlocks).toBe(1);
  });

  it("swaps the stone palette entry of a parsed Sponge v3 with the same outcome", () => {
    // Format coverage: the transform should be insensitive to which format the
    // projection came from, because it operates on the in-memory projection.
    const before = parseFixture("one_stone_block_v3.schem");
    const after = applyBlockSwap(before, "minecraft:stone", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });
    expect(after.palette.some((e) => e.blockId === "minecraft:stone")).toBe(
      false,
    );
    expect(
      after.palette.some((e) => e.blockId === "minecraft:cobblestone"),
    ).toBe(true);
  });

  it("returns the input projection unchanged when the source state is absent", () => {
    const before = parseFixture("one_stone_block.litematic");
    const after = applyBlockSwap(before, "minecraft:diamond_block", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });
    // Same reference — no work to do.
    expect(after).toBe(before);
  });

  it("removes placements when swapping the only block to air", () => {
    const before = parseFixture("one_stone_block.litematic");
    const after = applyBlockSwap(before, "minecraft:stone", {
      blockId: "minecraft:air",
      properties: {},
    });
    // Stone (and the introduced air) both pruned by the compaction step.
    expect(after.palette).toEqual([]);
    expect(after.regions.flatMap((r) => r.blocks)).toEqual([]);
    expect(after.totalBlocks).toBe(0);
  });

  it("recounts and compacts a multi-block schematic correctly", () => {
    // 4-cell row alternating stone/dirt; the projection's palette will hold
    // exactly two entries before the swap, exactly one after.
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:stone", 1],
      ["minecraft:dirt", 2],
    ]);
    const before = parseSyntheticSpongeV2({
      palette,
      width: 4,
      height: 1,
      length: 1,
      blockData: [1, 2, 1, 2],
      dataVersion: KNOWN_VERSIONS["1.20.1"].dataVersion,
    });
    expect(before.palette).toHaveLength(2);
    expect(before.totalBlocks).toBe(4);

    const after = applyBlockSwap(before, "minecraft:dirt", {
      blockId: "minecraft:stone",
      properties: {},
    });
    expect(after.palette).toHaveLength(1);
    expect(after.palette[0].blockId).toBe("minecraft:stone");
    expect(after.palette[0].count).toBe(4);
    expect(after.totalBlocks).toBe(4);
    // All placements now point at the single surviving palette entry.
    for (const region of after.regions) {
      for (const placement of region.blocks) {
        expect(placement.paletteIndex).toBe(0);
      }
    }
  });

  it("survives a parse → swap → serialize → re-parse round-trip", () => {
    // The swap result should serialize back out and re-parse to the same
    // semantic content. Use Sponge v2 as the round-trip format because it has
    // straightforward palette handling.
    const before = parseFixture("one_stone_block.litematic");
    const swapped = applyBlockSwap(before, "minecraft:stone", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });
    const serialized = serializeSchematic({
      schematic: swapped,
      inputFilename: "edited.litematic",
      outputFormat: "Sponge[v2]",
    });
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const reparsed = parseSchematic(serialized.bytes);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    expect(
      reparsed.schematic.palette.some(
        (e) => e.blockId === "minecraft:cobblestone",
      ),
    ).toBe(true);
    expect(
      reparsed.schematic.palette.some((e) => e.blockId === "minecraft:stone"),
    ).toBe(false);
    expect(reparsed.schematic.totalBlocks).toBe(1);
  });

  it("survives a parse → swap-to-air → serialize → re-parse round-trip for a multi-block schematic", () => {
    // After the swap, the cell that previously held dirt becomes air; the
    // serializer fills empty cells with air, so the round-trip should produce
    // a schematic whose visible palette is just stone (with count 2).
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:stone", 1],
      ["minecraft:dirt", 2],
    ]);
    const before = parseSyntheticSpongeV2({
      palette,
      width: 4,
      height: 1,
      length: 1,
      blockData: [1, 2, 1, 2],
      dataVersion: KNOWN_VERSIONS["1.20.1"].dataVersion,
    });

    const swapped = applyBlockSwap(before, "minecraft:dirt", {
      blockId: "minecraft:air",
      properties: {},
    });

    const serialized = serializeSchematic({
      schematic: swapped,
      inputFilename: "edited.schem",
      outputFormat: "Sponge[v2]",
    });
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const reparsed = parseSchematic(serialized.bytes);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    // parseSchematic filters air out of the visible palette/placements
    // (projectSchematic only emits visible blocks), so the post-roundtrip
    // visible palette is exactly stone × 2.
    expect(reparsed.schematic.palette).toHaveLength(1);
    expect(reparsed.schematic.palette[0].blockId).toBe("minecraft:stone");
    expect(reparsed.schematic.palette[0].count).toBe(2);
  });
});

describe("applyVersionMapping on real fixtures", () => {
  const V_1_16_5 = KNOWN_VERSIONS["1.16.5"];
  const V_1_17_1 = KNOWN_VERSIONS["1.17.1"];
  const V_1_20_1 = KNOWN_VERSIONS["1.20.1"];

  it("passes through stone unchanged across version boundaries (parsed Litematic)", () => {
    // Stone is stable across the whole diff chain — running a mapping over a
    // stone-only fixture must produce the same palette but bump the version.
    const before = parseFixture("one_stone_block.litematic");
    const after = applyVersionMapping(before, V_1_17_1);
    expect(after).not.toBe(before);
    expect(after.minecraftVersion).toEqual(V_1_17_1);
    expect(after.palette.map((e) => e.blockId)).toEqual(["minecraft:stone"]);
    expect(after.totalBlocks).toBe(1);
  });

  it("renames blocks naturally when mapping 1.16.5 → 1.17.1 over a real synthetic schematic", () => {
    // Construct a v2 with grass_path (1.16.5) + stone, parse it, then apply
    // the version mapping. Real schemlib parses the bytes; real schemlib's
    // translator runs the diff chain.
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:grass_path", 1],
      ["minecraft:stone", 2],
    ]);
    const before = parseSyntheticSpongeV2({
      palette,
      width: 3,
      height: 1,
      length: 1,
      blockData: [1, 1, 2],
      dataVersion: V_1_16_5.dataVersion,
    });
    expect(before.minecraftVersion.versionNumber).toEqual([1, 16, 5]);
    expect(
      before.palette.some((e) => e.blockId === "minecraft:grass_path"),
    ).toBe(true);

    const after = applyVersionMapping(before, V_1_17_1);
    expect(after.minecraftVersion).toEqual(V_1_17_1);
    const ids = new Set(after.palette.map((e) => e.blockId));
    expect(ids.has("minecraft:dirt_path")).toBe(true);
    expect(ids.has("minecraft:grass_path")).toBe(false);
    expect(ids.has("minecraft:stone")).toBe(true);

    // Total placement count is preserved (no deletion, just renaming).
    expect(after.totalBlocks).toBe(3);

    // grass_path's two placements both now resolve to dirt_path.
    const dirtPathIdx = after.palette.findIndex(
      (e) => e.blockId === "minecraft:dirt_path",
    );
    const dirtPathPlacements = after.regions
      .flatMap((r) => r.blocks)
      .filter((b) => b.paletteIndex === dirtPathIdx);
    expect(dirtPathPlacements).toHaveLength(2);
  });

  it("drops blocks that don't exist in the target version (cherry_planks → 1.16.5)", () => {
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:cherry_planks", 1],
      ["minecraft:stone", 2],
    ]);
    const before = parseSyntheticSpongeV2({
      palette,
      width: 3,
      height: 1,
      length: 1,
      blockData: [1, 1, 2],
      dataVersion: V_1_20_1.dataVersion,
    });

    const after = applyVersionMapping(before, V_1_16_5);
    // Cherry planks didn't exist in 1.16.5 → mapped to air → pruned by the
    // air-filter pass in applyVersionMapping. Only stone survives.
    const ids = new Set(after.palette.map((e) => e.blockId));
    expect(ids.has("minecraft:cherry_planks")).toBe(false);
    expect(ids.has("minecraft:air")).toBe(false);
    expect(ids.has("minecraft:stone")).toBe(true);
    expect(after.totalBlocks).toBe(1);
  });

  it("honours an override over the natural mapper for a real synthetic schematic", () => {
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:grass_path", 1],
    ]);
    const before = parseSyntheticSpongeV2({
      palette,
      width: 2,
      height: 1,
      length: 1,
      blockData: [1, 1],
      dataVersion: V_1_16_5.dataVersion,
    });

    const after = applyVersionMapping(before, V_1_17_1, {
      "minecraft:grass_path": {
        blockId: "minecraft:coarse_dirt",
        properties: {},
      },
    });
    const ids = new Set(after.palette.map((e) => e.blockId));
    expect(ids.has("minecraft:coarse_dirt")).toBe(true);
    // Natural target (dirt_path) is replaced, not added alongside.
    expect(ids.has("minecraft:dirt_path")).toBe(false);
    expect(after.totalBlocks).toBe(2);
  });

  it("survives a parse → version-map → serialize → re-parse round-trip", () => {
    // grass_path → dirt_path round-trip: the renamed block must survive the
    // serializer + re-parser and still be dirt_path on the way out.
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:grass_path", 1],
    ]);
    const before = parseSyntheticSpongeV2({
      palette,
      width: 2,
      height: 1,
      length: 1,
      blockData: [1, 1],
      dataVersion: V_1_16_5.dataVersion,
    });

    const mapped = applyVersionMapping(before, V_1_17_1);
    const serialized = serializeSchematic({
      schematic: mapped,
      inputFilename: "translated.schem",
      outputFormat: "Sponge[v2]",
    });
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const reparsed = parseSchematic(serialized.bytes);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(
      reparsed.schematic.palette.some(
        (e) => e.blockId === "minecraft:dirt_path",
      ),
    ).toBe(true);
    expect(
      reparsed.schematic.palette.some(
        (e) => e.blockId === "minecraft:grass_path",
      ),
    ).toBe(false);
    expect(reparsed.schematic.totalBlocks).toBe(2);
  });
});

describe("tile-entity compatibility on a real synthetic schematic", () => {
  // Build a v2 with a chest, parse it via real schemlib, then drive the
  // edit-layer transform. Parser doesn't currently populate the projection's
  // `tileEntities` field, so we attach a TE manually after parsing — this
  // mirrors what a future parser change would do and locks in the
  // compatibility contract documented in `edit.ts`.
  function makeChestTE(x: number, y: number, z: number): Entity {
    const c = new nbt.Compound();
    c.set("id", new nbt.StringTag("minecraft:chest"));
    c.set("x", new nbt.Int(x));
    c.set("y", new nbt.Int(y));
    c.set("z", new nbt.Int(z));
    return new Entity(c);
  }

  function parsedChestSchematic(): ParsedSchematicProjection {
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:chest[facing=north,type=single,waterlogged=false]", 1],
    ]);
    const v2 = new SpongeSchematicV2({
      Version: 2,
      Metadata: new SpongeSchematicMetadata(),
      Width: 1,
      Height: 1,
      Length: 1,
      Offset: [0, 0, 0],
      DataVersion: KNOWN_VERSIONS["1.20.1"].dataVersion,
      PaletteMax: palette.size,
      Palette: palette,
      BlockData: [1],
      BlockEntities: [makeChestTE(0, 0, 0)],
    });
    const result = parseSchematic(v2.schematicDump());
    if (!result.ok) throw new Error(result.error);
    return result.schematic;
  }

  it("preserves tile entities across a property-only swap (same block id)", () => {
    const parsed = parsedChestSchematic();
    // Locate the chest's region and attach a TE record (parser doesn't yet
    // expose tileEntities on the projection — the transform contract is
    // tested here against the schema declared by `Schematic`).
    const projection = {
      ...parsed,
      regions: parsed.regions.map((r) => ({
        ...r,
        tileEntities: [
          {
            pos: [0, 0, 0] as [number, number, number],
            blockId: "minecraft:chest",
            data: { Items: [] as unknown[] },
          },
        ],
      })),
    };

    const sourceState = parsed.palette.find(
      (e) => e.blockId === "minecraft:chest",
    )?.blockState;
    expect(sourceState).toBeDefined();
    if (!sourceState) return;

    const after = applyBlockSwap(projection, sourceState, {
      blockId: "minecraft:chest",
      properties: { facing: "south", type: "single", waterlogged: "false" },
    });
    expect(after.regions[0].tileEntities).toHaveLength(1);
    expect(after.regions[0].tileEntities?.[0].blockId).toBe("minecraft:chest");
  });

  it("drops tile entities when the swap changes the block id", () => {
    const parsed = parsedChestSchematic();
    const projection = {
      ...parsed,
      regions: parsed.regions.map((r) => ({
        ...r,
        tileEntities: [
          {
            pos: [0, 0, 0] as [number, number, number],
            blockId: "minecraft:chest",
            data: { Items: [] as unknown[] },
          },
        ],
      })),
    };

    const sourceState = parsed.palette.find(
      (e) => e.blockId === "minecraft:chest",
    )?.blockState;
    expect(sourceState).toBeDefined();
    if (!sourceState) return;

    const after = applyBlockSwap(projection, sourceState, {
      blockId: "minecraft:stone",
      properties: {},
    });
    expect(after.regions[0].tileEntities).toEqual([]);
  });
});
