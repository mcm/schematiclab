// Every detectable input format must also work as an output format: each
// fixture converts to every SUPPORTED_FORMAT, the result is detected as that
// format, and it parses back to the same blocks.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SUPPORTED_FORMATS,
  convertSchematic,
  parseSchematic,
  type ParsedSchematicProjection,
  type SchematicFormatId,
} from "../convert";
import { Block, BlockPos, BlockState } from "../schemlib/blocks";
import { Entity } from "../schemlib/entities";
import * as nbt from "../schemlib/nbt";
import { detectSchematicType } from "../schemlib/schematic-formats";
import {
  BuildingGadgetsV0Schematic,
  BuildingGadgetsV1Schematic,
} from "../schemlib/schematic-formats/building-gadgets";
import {
  IntermediateRegion,
  IntermediateSchematic,
} from "../schemlib/schematic-formats/intermediate";
import { LitematicSchematic } from "../schemlib/schematic-formats/litematic";
import {
  SpongeSchematicMetadata,
  SpongeSchematicV1,
  SpongeSchematicV2,
} from "../schemlib/schematic-formats/sponge";
import {
  getVersion,
  versionsEqual,
} from "../schemlib/schematic-formats/version-mapping";

const loadBytes = (filename: string): Uint8Array =>
  new Uint8Array(readFileSync(path.resolve(__dirname, "fixtures", filename)));

const VANILLA_FIXTURES = [
  "one_stone_block.litematic",
  "one_stone_block.nbt",
  "one_stone_block_v1.schem",
  "one_stone_block_v2.schem",
  "one_stone_block_v3.schem",
  "one_stone_block_bg0.txt",
  "one_stone_block_bg1.txt",
  "one_stone_block_bg2.txt",
  "example_bg0_schematic.txt",
];

/** Non-air placements, rebased so their minimum is 0,0,0. */
function placements(
  p: ParsedSchematicProjection,
  withState: boolean,
): string[] {
  const all = p.regions.flatMap((r) =>
    r.blocks
      .filter((b) => p.palette[b.paletteIndex].blockId !== "minecraft:air")
      .map((b) => ({
        pos: b.pos,
        state: p.palette[b.paletteIndex].blockState,
      })),
  );
  const min = [0, 1, 2].map((axis) => Math.min(...all.map((b) => b.pos[axis])));
  return all
    .map(({ pos, state }) => {
      const key = pos.map((v, axis) => v - min[axis]).join(",");
      return withState ? `${key} ${state}` : key;
    })
    .sort();
}

/** Block entity ids at rebased positions (same rebase as `placements`). */
function blockEntities(p: ParsedSchematicProjection): string[] {
  const nonAir = p.regions.flatMap((r) =>
    r.blocks.filter(
      (b) => p.palette[b.paletteIndex].blockId !== "minecraft:air",
    ),
  );
  const min = [0, 1, 2].map((axis) =>
    Math.min(...nonAir.map((b) => b.pos[axis])),
  );
  return p.regions
    .flatMap((r) =>
      r.blockEntities.map((be) => {
        const id = be.nbt.entries.id;
        const key = be.pos.map((v, axis) => v - min[axis]).join(",");
        return `${key} ${id?.type === "string" ? id.value : "?"}`;
      }),
    )
    .sort();
}

function convertOk(
  bytes: Uint8Array,
  outputFormat: SchematicFormatId,
  targetVersion?: string,
): Uint8Array {
  const result = convertSchematic({
    bytes,
    inputFilename: "in.bin",
    outputFormat,
    targetVersion,
  });
  if (!result.ok) throw new Error(result.error);
  return result.bytes;
}

function parseOk(bytes: Uint8Array): ParsedSchematicProjection {
  const result = parseSchematic(bytes);
  if (!result.ok) throw new Error(result.error);
  return result.schematic;
}

function chunkTileEntity(id: string, x: number, y: number, z: number): Entity {
  return new Entity(
    new nbt.Compound({
      id: new nbt.StringTag(id),
      x: new nbt.Int(x),
      y: new nbt.Int(y),
      z: new nbt.Int(z),
    }),
  );
}

describe("every input format is an output format", () => {
  const cases = VANILLA_FIXTURES.flatMap((fixture) =>
    SUPPORTED_FORMATS.map((format) => [fixture, format] as const),
  );

  it.each(cases)("%s → %s", (fixture, format) => {
    const source = parseOk(loadBytes(fixture));
    const out = convertOk(loadBytes(fixture), format);

    expect(detectSchematicType(out)).toBe(format);
    const parsed = parseOk(out);
    expect(parsed.inputFormat).toBe(format);

    // States only compare when the output kept the source's version (Sponge
    // v1 has no DataVersion; Building Gadgets formats pin their own range).
    const sameVersion = versionsEqual(
      parsed.minecraftVersion,
      source.minecraftVersion,
    );
    expect(placements(parsed, sameVersion)).toEqual(
      placements(source, sameVersion),
    );
  });
});

describe("block entities survive every format that stores them", () => {
  const formats: SchematicFormatId[] = [
    "Litematic",
    "Sponge[v1]",
    "Sponge[v2]",
    "Sponge[v3]",
    "Structure",
    "StructurizeBlueprint",
    "JSON",
  ];

  it.each(formats)("framed_covered_1.nbt → %s", (format) => {
    const input = loadBytes("framed_covered_1.nbt");
    const source = parseOk(input);
    const parsed = parseOk(convertOk(input, format));
    expect(blockEntities(source).length).toBeGreaterThan(0);
    expect(blockEntities(parsed)).toEqual(blockEntities(source));
  });
});

describe("Sponge Offset", () => {
  it("keeps block entities on their blocks when Offset is non-zero", () => {
    const palette = new Map<string, number>([
      ["minecraft:air", 0],
      ["minecraft:stone", 1],
      ["minecraft:chest[facing=north,type=single,waterlogged=false]", 2],
    ]);
    const [width, height, length] = [3, 2, 4];
    const blockData = new Array<number>(width * height * length).fill(0);
    const index = (x: number, y: number, z: number): number =>
      x + z * width + y * width * length;
    blockData[index(0, 0, 0)] = 1;
    blockData[index(2, 1, 3)] = 2;
    const input = new SpongeSchematicV2({
      Version: 2,
      Metadata: new SpongeSchematicMetadata(),
      Width: width,
      Height: height,
      Length: length,
      Offset: [10, -20, 30],
      DataVersion: getVersion("1.20.1").dataVersion,
      PaletteMax: palette.size,
      Palette: palette,
      BlockData: blockData,
      // Block entity `Pos` is in BlockData's index space.
      BlockEntities: [chunkTileEntity("minecraft:chest", 2, 1, 3)],
    }).schematicDump();

    for (const format of SUPPORTED_FORMATS) {
      if (format.startsWith("BuildingGadgets")) continue;
      const parsed = parseOk(convertOk(input, format));
      expect(placements(parsed, false)).toEqual(["0,0,0", "2,1,3"]);
      expect(blockEntities(parsed)).toEqual(["2,1,3 minecraft:chest"]);
    }
  });
});

describe("Sponge v1 BlockData", () => {
  it("varint-encodes palette indices past 127", () => {
    const blocks = Array.from(
      { length: 200 },
      (_, i) =>
        new Block(
          new BlockPos(i, 0, 0),
          new BlockState({ Name: `test:block_${i}` }),
        ),
    );
    const version = getVersion("1.20.1");
    const source = new IntermediateSchematic(
      {},
      "wide palette",
      [new IntermediateRegion(version, BlockPos.ORIGIN, [200, 1, 1], blocks)],
      version,
    );
    const v1 = SpongeSchematicV1.fromSchematic(source, null);
    const reloaded = SpongeSchematicV1.schematicLoad(v1.schematicDump());
    const names = [...reloaded.getBlockMatrix().values()]
      .sort((a, b) => a.pos.x - b.pos.x)
      .map((b) => `${b.pos.x} ${b.state.Name}`);
    expect(names).toEqual(blocks.map((b) => `${b.pos.x} ${b.state.Name}`));
  });
});

describe("multi-region sources", () => {
  // Two Litematic regions at different positions. Single-region formats
  // merge them at their positions instead of refusing.
  const version = getVersion("1.20.1");
  const CHEST = "minecraft:chest[facing=north,type=single,waterlogged=false]";
  const region = (
    origin: [number, number, number],
    state: string,
  ): IntermediateRegion =>
    new IntermediateRegion(
      version,
      new BlockPos(...origin),
      [2, 1, 1],
      [
        new Block(BlockPos.ORIGIN, BlockState.fromString(state)),
        new Block(
          new BlockPos(1, 0, 0),
          new BlockState({ Name: "minecraft:stone" }),
        ),
      ],
      [],
      [chunkTileEntity("minecraft:chest", 0, 0, 0)],
    );
  const litematic = LitematicSchematic.fromSchematic(
    new IntermediateSchematic(
      {},
      "two regions",
      [region([0, 0, 0], CHEST), region([5, 2, -3], CHEST)],
      version,
    ),
    null,
  ).schematicDump();

  it("keeps each Litematic region's position", () => {
    const parsed = parseOk(litematic);
    expect(parsed.regions.map((r) => r.origin)).toEqual([
      [0, 0, 0],
      [5, 2, -3],
    ]);
  });

  it.each(SUPPORTED_FORMATS.filter((f) => f !== "Litematic" && f !== "JSON"))(
    "merges them for %s",
    (format) => {
      const parsed = parseOk(convertOk(litematic, format));
      expect(placements(parsed, false)).toEqual(
        ["0,0,3", "1,0,3", "5,2,0", "6,2,0"].sort(),
      );
      if (!format.startsWith("BuildingGadgets")) {
        expect(blockEntities(parsed)).toEqual([
          "0,0,3 minecraft:chest",
          "5,2,0 minecraft:chest",
        ]);
      }
    },
  );
});

describe("Building Gadgets versions", () => {
  it("writes 1.12 templates with Forge state names", () => {
    const out = convertOk(
      loadBytes("one_stone_block_v3.schem"),
      "BuildingGadgets[1.12]",
    );
    const template = BuildingGadgetsV0Schematic.schematicLoad(out);
    expect(template.mapIntState.map((m) => m.mapState.toString())).toEqual([
      "minecraft:stone[variant=stone]",
    ]);
    expect(template.mapIntState.map((m) => m.mapSlot)).toEqual([1]);
  });

  it("moves a newer source into the 1.14.4–1.19.3 range", () => {
    const out = convertOk(
      loadBytes("one_stone_block_v3.schem"),
      "BuildingGadgets[1.14.4-1.19.3]",
    );
    const template = BuildingGadgetsV1Schematic.schematicLoad(out);
    expect(template.header.mc_version).toBe("1.18.2");
    expect(template.getName()).toBe("One Stone Block");
  });

  it.each([
    ["BuildingGadgets[1.12]", "1.20.1", "Minecraft 1.12.2, not 1.20.1"],
    [
      "BuildingGadgets[1.14.4-1.19.3]",
      "1.12.2",
      "Minecraft 1.14.4 to 1.19.3, not 1.12.2",
    ],
    [
      "BuildingGadgets2[1.20+]",
      "1.16.5",
      "Minecraft 1.20 or newer, not 1.16.5",
    ],
  ] as const)("rejects a %s target of %s", (format, target, message) => {
    const result = convertSchematic({
      bytes: loadBytes("one_stone_block_v3.schem"),
      inputFilename: "in.schem",
      outputFormat: format,
      targetVersion: target,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});
