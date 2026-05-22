import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { convertSchematic } from "../convert";
import { detectSchematicType } from "../schemlib/schematic-formats";
import {
  SpongeSchematicMetadata,
  SpongeSchematicV2,
  SpongeSchematicV3,
} from "../schemlib/schematic-formats/sponge";
import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/version-mapping";
import * as nbt from "../schemlib/nbt";
import { Entity } from "../schemlib/entities";

const fixturePath = (filename: string): string =>
  path.resolve(__dirname, "fixtures", filename);

const loadBytes = (filename: string): Uint8Array =>
  new Uint8Array(readFileSync(fixturePath(filename)));

describe("convertSchematic", () => {
  it("converts a Sponge v3 input to Litematic", () => {
    const input = loadBytes("one_stone_block_v3.schem");

    const result = convertSchematic({
      bytes: input,
      inputFilename: "one_stone_block_v3.schem",
      outputFormat: "Litematic",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.filename).toBe("one_stone_block_v3.litematic");
    expect(detectSchematicType(result.bytes)).toBe("Litematic");
  });

  it("converts a Litematic to Sponge v3", () => {
    const input = loadBytes("one_stone_block.litematic");

    const result = convertSchematic({
      bytes: input,
      inputFilename: "one_stone_block.litematic",
      outputFormat: "Sponge[v3]",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.filename).toBe("one_stone_block.schem");
    expect(detectSchematicType(result.bytes)).toBe("Sponge[v3]");

    // Sanity-check the round-tripped block survives.
    const reloaded = SpongeSchematicV3.schematicLoad(result.bytes);
    const blocks = reloaded.getRegion(0).getBlocks();
    expect(blocks.length).toBe(1);
    expect(blocks[0].state.Name).toBe("minecraft:stone");
  });

  it("converts a Litematic to Sponge v2", () => {
    const input = loadBytes("one_stone_block.litematic");

    const result = convertSchematic({
      bytes: input,
      inputFilename: "one_stone_block.litematic",
      outputFormat: "Sponge[v2]",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.filename).toBe("one_stone_block.schem");
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);

    // Round-trip: the output should detect as Sponge v2.
    expect(detectSchematicType(result.bytes)).toBe("Sponge[v2]");
  });

  it("returns a failure result when input cannot be detected", () => {
    const garbage = new TextEncoder().encode("not a schematic, just text");

    const result = convertSchematic({
      bytes: garbage,
      inputFilename: "garbage.bin",
      outputFormat: "Sponge[v2]",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/detect/i);
    expect(result.cause).toBeDefined();
  });

  it("stamps the requested targetVersion's data version on the output", () => {
    const input = loadBytes("one_stone_block.litematic");
    const targetVersion = "1.20.1";
    const expectedDataVersion = KNOWN_VERSIONS[targetVersion].dataVersion;

    const result = convertSchematic({
      bytes: input,
      inputFilename: "one_stone_block.litematic",
      outputFormat: "Sponge[v2]",
      targetVersion,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reloaded = SpongeSchematicV2.schematicLoad(result.bytes);
    expect(reloaded.DataVersion).toBe(expectedDataVersion);
  });

  it("derives the output filename from the input basename and target extension", () => {
    const input = loadBytes("one_stone_block.litematic");

    const result = convertSchematic({
      bytes: input,
      inputFilename: "/some/path/My Castle.litematic",
      outputFormat: "Structure",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("My Castle.nbt");
  });

  it("accepts Sponge v2 input with no Offset field (spec says it's optional)", () => {
    // Build a v2 schematic, dump it, then strip the Offset tag from the raw
    // NBT before re-reading. Real-world writers (e.g. some WorldEdit forks)
    // omit Offset when it would be [0, 0, 0].
    const v2 = new SpongeSchematicV2({
      Version: 2,
      Metadata: new SpongeSchematicMetadata(),
      Width: 1,
      Height: 1,
      Length: 1,
      Offset: [0, 0, 0],
      DataVersion: 3465,
      PaletteMax: 1,
      Palette: new Map([["minecraft:stone", 0]]),
      BlockData: [0],
    });

    const named = nbt.loadNbtFromBytes(v2.schematicDump());
    named.entries.delete("Offset");
    const strippedBytes = named.toBytes({ compress: true });

    // Should load without throwing, and Offset should default to (0,0,0).
    const reloaded = SpongeSchematicV2.schematicLoad(strippedBytes);
    expect(reloaded.Offset).toEqual([0, 0, 0]);
    expect(reloaded.getRegion(0).getBlocks().length).toBe(1);
  });

  it("v2 → Litematic → v2 round-trip preserves DataVersion and BlockEntities", () => {
    // Build a synthetic v2 schematic with two distinct block entities so we
    // can detect the historical bug where v2.getTileEntityMatrix keyed
    // everything at ORIGIN (collapsing all TEs to one via map dedup).
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:stone", 1],
      ["minecraft:furnace[facing=north,lit=false]", 2],
      ["minecraft:chest[facing=north,type=single,waterlogged=false]", 3],
    ]);
    const width = 4,
      height = 1,
      length = 4;
    const total = width * height * length;
    const blockData = new Array<number>(total).fill(0);
    // Place stone at (0,0,0), furnace at (2,0,1), chest at (3,0,3)
    blockData[0 + 0 * width + 0 * width * length] = 1;
    blockData[2 + 1 * width + 0 * width * length] = 2;
    blockData[3 + 3 * width + 0 * width * length] = 3;

    const makeTE = (id: string, x: number, y: number, z: number): Entity => {
      const c = new nbt.Compound();
      c.set("id", new nbt.StringTag(id));
      c.set("x", new nbt.Int(x));
      c.set("y", new nbt.Int(y));
      c.set("z", new nbt.Int(z));
      return new Entity(c);
    };

    const v2 = new SpongeSchematicV2({
      Version: 2,
      Metadata: new SpongeSchematicMetadata(),
      Width: width,
      Height: height,
      Length: length,
      Offset: [0, 0, 0],
      DataVersion: 3955, // 1.21.1 — used to fall back to 1.13.1 (1628) on convert
      PaletteMax: palette.size,
      Palette: palette,
      BlockData: blockData,
      BlockEntities: [
        makeTE("minecraft:furnace", 2, 0, 1),
        makeTE("minecraft:chest", 3, 0, 3),
      ],
    });

    const v2Bytes = v2.schematicDump();

    // Hop 1: v2 → Litematic
    const hop1 = convertSchematic({
      bytes: v2Bytes,
      inputFilename: "synthetic.schem",
      outputFormat: "Litematic",
    });
    expect(hop1.ok).toBe(true);
    if (!hop1.ok) return;

    // Hop 2: Litematic → v2
    const hop2 = convertSchematic({
      bytes: hop1.bytes,
      inputFilename: "synthetic.litematic",
      outputFormat: "Sponge[v2]",
    });
    expect(hop2.ok).toBe(true);
    if (!hop2.ok) return;

    const out = SpongeSchematicV2.schematicLoad(hop2.bytes);
    expect(out.DataVersion).toBe(3955);
    expect(out.BlockEntities.length).toBe(2);

    // Map TE ids to their positions. v2 reader normalizes to chunk-shape
    // (id/x/y/z) so we read those fields directly.
    const tePositions = new Map<string, [number, number, number]>();
    for (const e of out.BlockEntities) {
      const c = e.toCompound();
      const idTag = c.get("id");
      const xt = c.get("x");
      const yt = c.get("y");
      const zt = c.get("z");
      const id = idTag instanceof nbt.StringTag ? idTag.value : "";
      const x = xt instanceof nbt.Int ? xt.value : 0;
      const y = yt instanceof nbt.Int ? yt.value : 0;
      const z = zt instanceof nbt.Int ? zt.value : 0;
      tePositions.set(id, [x, y, z]);
    }
    // Stone at (0,0,0) anchors the bounding box, so litematic doesn't shift
    // anything — TE positions round-trip verbatim.
    expect(tePositions.get("minecraft:furnace")).toEqual([2, 0, 1]);
    expect(tePositions.get("minecraft:chest")).toEqual([3, 0, 3]);
  });

  it("v2 → Litematic → v2 round-trip shifts tile entity positions with the bbox collapse", () => {
    // No anchor block at the origin: bounding box collapses to the furnace
    // and chest positions, so litematic shifts both blocks and tile entities
    // toward (0,0,0). This locks in the litematic.fromSchematic TE-shift fix.
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:furnace[facing=north,lit=false]", 1],
      ["minecraft:chest[facing=north,type=single,waterlogged=false]", 2],
    ]);
    const width = 5,
      height = 2,
      length = 5;
    const total = width * height * length;
    const blockData = new Array<number>(total).fill(0);
    // Place furnace at (2,0,1) and chest at (3,1,3) in a 5×2×5 schematic with
    // origin-side air padding so bbox should be (2,0,1)→(3,1,3).
    blockData[2 + 1 * width + 0 * width * length] = 1;
    blockData[3 + 3 * width + 1 * width * length] = 2;

    const makeTE = (id: string, x: number, y: number, z: number): Entity => {
      const c = new nbt.Compound();
      c.set("id", new nbt.StringTag(id));
      c.set("x", new nbt.Int(x));
      c.set("y", new nbt.Int(y));
      c.set("z", new nbt.Int(z));
      return new Entity(c);
    };

    const v2 = new SpongeSchematicV2({
      Version: 2,
      Metadata: new SpongeSchematicMetadata(),
      Width: width,
      Height: height,
      Length: length,
      Offset: [0, 0, 0],
      DataVersion: 3955,
      PaletteMax: palette.size,
      Palette: palette,
      BlockData: blockData,
      BlockEntities: [
        makeTE("minecraft:furnace", 2, 0, 1),
        makeTE("minecraft:chest", 3, 1, 3),
      ],
    });

    const hop1 = convertSchematic({
      bytes: v2.schematicDump(),
      inputFilename: "synthetic.schem",
      outputFormat: "Litematic",
    });
    expect(hop1.ok).toBe(true);
    if (!hop1.ok) return;

    const hop2 = convertSchematic({
      bytes: hop1.bytes,
      inputFilename: "synthetic.litematic",
      outputFormat: "Sponge[v2]",
    });
    expect(hop2.ok).toBe(true);
    if (!hop2.ok) return;

    const out = SpongeSchematicV2.schematicLoad(hop2.bytes);
    // bbox was (2,0,1)→(3,1,3); collapsed size is (2, 2, 3).
    expect([out.Width, out.Height, out.Length]).toEqual([2, 2, 3]);
    expect(out.BlockEntities.length).toBe(2);

    const tePositions = new Map<string, [number, number, number]>();
    for (const e of out.BlockEntities) {
      const c = e.toCompound();
      const idTag = c.get("id");
      const xt = c.get("x");
      const yt = c.get("y");
      const zt = c.get("z");
      const id = idTag instanceof nbt.StringTag ? idTag.value : "";
      const x = xt instanceof nbt.Int ? xt.value : 0;
      const y = yt instanceof nbt.Int ? yt.value : 0;
      const z = zt instanceof nbt.Int ? zt.value : 0;
      tePositions.set(id, [x, y, z]);
    }
    // After shift by (2,0,1): furnace=(0,0,0), chest=(1,1,2).
    expect(tePositions.get("minecraft:furnace")).toEqual([0, 0, 0]);
    expect(tePositions.get("minecraft:chest")).toEqual([1, 1, 2]);
  });

  it("Sponge v2 dump emits BlockEntities in v2 wire shape (Id/Pos: IntArray)", () => {
    // Regression: toCompound() used to emit chunk-shape (id/x/y/z) directly,
    // which produced .schem files that other Sponge readers reject as
    // malformed. Verify the raw NBT after a load → dump round trip uses the
    // spec-required {Id, Pos: IntArray[3]} wire shape.
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:chest[facing=north,type=single,waterlogged=false]", 1],
    ]);
    const v2 = new SpongeSchematicV2({
      Version: 2,
      Metadata: new SpongeSchematicMetadata(),
      Width: 2,
      Height: 1,
      Length: 2,
      Offset: [0, 0, 0],
      DataVersion: 3955,
      PaletteMax: palette.size,
      Palette: palette,
      BlockData: [0, 1, 0, 0],
      BlockEntities: [
        (() => {
          const c = new nbt.Compound();
          c.set("id", new nbt.StringTag("minecraft:chest"));
          c.set("x", new nbt.Int(1));
          c.set("y", new nbt.Int(0));
          c.set("z", new nbt.Int(0));
          return new Entity(c);
        })(),
      ],
    });

    // Round trip the raw bytes so we exercise toCompound (write) → fromCompound (read).
    const bytes = v2.schematicDump();
    const named = nbt.loadNbtFromBytes(bytes);
    const beList = named.get("BlockEntities");
    expect(beList).toBeInstanceOf(nbt.NbtList);
    if (!(beList instanceof nbt.NbtList)) return;
    expect(beList.items.length).toBe(1);
    const be = beList.items[0];
    expect(be).toBeInstanceOf(nbt.Compound);
    if (!(be instanceof nbt.Compound)) return;
    // v2 wire shape: capitalized Id + Pos IntArray, no chunk-shape id/x/y/z.
    expect(be.get("Id")).toBeInstanceOf(nbt.StringTag);
    expect(be.get("Pos")).toBeInstanceOf(nbt.IntArray);
    expect(be.get("id")).toBeUndefined();
    expect(be.get("x")).toBeUndefined();
    expect(be.get("y")).toBeUndefined();
    expect(be.get("z")).toBeUndefined();
    const pos = (be.get("Pos") as nbt.IntArray).toObject() as number[];
    expect(pos).toEqual([1, 0, 0]);
  });
});
