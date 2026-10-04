import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as nbt from "../schemlib/nbt";
import { toSnbt } from "../schemlib/snbt";
import {
  IntermediateSchematic,
  LitematicRegion,
  LitematicSchematic,
  StructureSchematic,
  detectSchematicType,
} from "../schemlib/schematic-formats";
import { SpongeSchematicV2 } from "../schemlib/schematic-formats/sponge";
import { StructurizeBlueprint } from "../schemlib/schematic-formats/structurize";
import {
  BuildingGadgetsV0Schematic,
  BuildingGadgetsV1Schematic,
  BuildingGadgetsV2Schematic,
} from "../schemlib/schematic-formats/building-gadgets";
import {
  SchematicTooLargeError,
  checkDeclaredVolume,
} from "../schemlib/schematic-formats/abstract";
import { parseSchematic } from "../convert";
import { oversizedSchematics } from "./oversized-schematics";

const FIXTURES = path.join(__dirname, "fixtures");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkDeclaredVolume", () => {
  it("allows exactly maxBlocks and rejects one more, summing regions", () => {
    const sizes: [number, number, number][] = [
      [10, 10, 10],
      [-10, 10, 10],
    ];
    expect(() => checkDeclaredVolume(sizes, { maxBlocks: 2000 })).not.toThrow();
    expect(() => checkDeclaredVolume(sizes, { maxBlocks: 1999 })).toThrow(
      SchematicTooLargeError,
    );
  });

  it("rejects sizes that aren't whole numbers, with or without a cap", () => {
    // NaN and Infinity × 0 would compare false against the cap.
    for (const size of [
      [NaN, 10, 10],
      [Infinity, 0, 1],
      [1.5, 1, 1],
    ] as [number, number, number][]) {
      expect(() => checkDeclaredVolume([size], { maxBlocks: 10 })).toThrow(
        "invalid size",
      );
      expect(() => checkDeclaredVolume([size], undefined)).toThrow(
        "invalid size",
      );
    }
  });

  it("does nothing without a cap", () => {
    expect(() => checkDeclaredVolume([[1e6, 1e6, 1e6]], {})).not.toThrow();
    expect(() =>
      checkDeclaredVolume([[1e6, 1e6, 1e6]], undefined),
    ).not.toThrow();
  });
});

describe("parseSchematic with maxBlocks", () => {
  for (const file of oversizedSchematics()) {
    describe(file.format, () => {
      it("is detected as that format", () => {
        expect(detectSchematicType(file.bytes)).toBe(file.format);
      });

      // Lazy formats decode in `getBlockMatrix`; formats that read their
      // block data while loading are covered by `uncappedError` below.
      it("stops on the declared size without decoding blocks", () => {
        const decode = vi.spyOn(file.region.prototype, "getBlockMatrix");
        const result = parseSchematic(file.bytes, { maxBlocks: 2_000_000 });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.cause).toBeInstanceOf(SchematicTooLargeError);
        expect(result.cause).toMatchObject({
          blocks: file.declaredBlocks,
          maxBlocks: 2_000_000,
        });
        expect(result.error).toBe(
          `This schematic declares ${file.declaredBlocks.toLocaleString("en-US")} blocks, more than the 2,000,000 allowed.`,
        );
        expect(decode).not.toHaveBeenCalled();
      });

      if (file.uncappedError !== undefined) {
        const uncappedError = file.uncappedError;
        it("reads its block data while loading when there is no cap", () => {
          const result = parseSchematic(file.bytes);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.cause).not.toBeInstanceOf(SchematicTooLargeError);
          expect(result.error).toContain(uncappedError);
        });
      }
    });
  }

  it("parses real files under the cap as before", () => {
    const bytes = new Uint8Array(
      readFileSync(path.join(FIXTURES, "one_stone_block.nbt")),
    );
    const capped = parseSchematic(bytes, { maxBlocks: 1 });
    const uncapped = parseSchematic(bytes);
    expect(capped).toEqual(uncapped);
    expect(capped.ok).toBe(true);
  });
});

describe("malformed declared sizes", () => {
  const options = { maxBlocks: 2_000_000 };
  const gzip = (root: nbt.Compound) =>
    new nbt.Named({ "": root }).toBytes({ compress: true });
  const pos = (x: nbt.NbtTag, y: nbt.NbtTag, z: nbt.NbtTag) =>
    new nbt.Compound({ x, y, z });
  const upper = (x: number, y: number, z: number) =>
    new nbt.Compound({
      X: new nbt.Int(x),
      Y: new nbt.Int(y),
      Z: new nbt.Int(z),
    });

  it("Litematic: rejects a non-integer Size before decoding", () => {
    const spy = vi.spyOn(LitematicRegion.prototype, "getBlockMatrix");
    const bytes = gzip(
      new nbt.Compound({
        Version: new nbt.Int(6),
        MinecraftDataVersion: new nbt.Int(3465),
        Metadata: new nbt.Compound({}),
        Regions: new nbt.Compound({
          a: new nbt.Compound({
            Size: pos(new nbt.Double(Infinity), new nbt.Int(0), new nbt.Int(1)),
            Position: pos(new nbt.Int(0), new nbt.Int(0), new nbt.Int(0)),
            BlockStatePalette: new nbt.NbtList([]),
            BlockStates: new nbt.LongArray([]),
          }),
        }),
      }),
    );
    expect(() => LitematicSchematic.schematicLoad(bytes, options)).toThrow(
      "invalid size",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("Structure: rejects a missing, short or non-numeric size", () => {
    const root = (size?: nbt.NbtTag) =>
      new nbt.Compound({
        DataVersion: new nbt.Int(3465),
        ...(size ? { size } : {}),
        palette: new nbt.NbtList([]),
        blocks: new nbt.NbtList([]),
      });
    expect(() =>
      StructureSchematic.schematicLoad(gzip(root()), options),
    ).toThrow("no valid size");
    expect(() =>
      StructureSchematic.schematicLoad(
        gzip(root(new nbt.NbtList([new nbt.Int(1), new nbt.Int(1)]))),
        options,
      ),
    ).toThrow("no valid size");
    expect(() =>
      StructureSchematic.schematicLoad(
        gzip(
          root(
            new nbt.NbtList([
              new nbt.StringTag("a"),
              new nbt.StringTag("b"),
              new nbt.StringTag("c"),
            ]),
          ),
        ),
        options,
      ),
    ).toThrow("invalid size");
  });

  it("Building Gadgets v0/v2: reject missing or partial bounds", () => {
    const v0 = (endPos?: nbt.Compound) =>
      new TextEncoder().encode(
        toSnbt(
          new nbt.Compound({
            stateIntArray: new nbt.IntArray([]),
            posIntArray: new nbt.IntArray([]),
            startPos: upper(0, 0, 0),
            ...(endPos ? { endPos } : {}),
            mapIntState: new nbt.NbtList([]),
          }),
        ),
      );
    expect(() =>
      BuildingGadgetsV0Schematic.schematicLoad(v0(), options),
    ).toThrow("BG v0 endPos is missing or invalid");
    expect(() =>
      BuildingGadgetsV0Schematic.schematicLoad(
        v0(new nbt.Compound({ X: new nbt.Int(999), Y: new nbt.Int(999) })),
        options,
      ),
    ).toThrow("BG v0 endPos is missing or invalid");

    for (const X of [new nbt.Double(999.5), new nbt.Long(9007199254740993n)]) {
      expect(() =>
        BuildingGadgetsV0Schematic.schematicLoad(
          v0(new nbt.Compound({ X, Y: new nbt.Int(9), Z: new nbt.Int(9) })),
          options,
        ),
      ).toThrow("BG v0 endPos is missing or invalid");
    }

    const v2 = new TextEncoder().encode(
      JSON.stringify({
        name: "x",
        statePosArrayList: toSnbt(
          new nbt.Compound({
            blockstatemap: new nbt.NbtList([]),
            endpos: upper(999, 999, 999),
            statelist: new nbt.IntArray([]),
          }),
        ),
        requiredItems: {},
      }),
    );
    expect(() => BuildingGadgetsV2Schematic.schematicLoad(v2, options)).toThrow(
      "BG v2 startpos is missing or invalid",
    );
  });

  it("Building Gadgets v1: rejects a non-numeric bounding box", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        header: {
          bounding_box: {
            min_x: 0,
            min_y: 0,
            min_z: 0,
            max_x: "lots",
            max_y: 999,
            max_z: 999,
          },
        },
        body: "AAAA",
      }),
    );
    expect(() =>
      BuildingGadgetsV1Schematic.schematicLoad(bytes, options),
    ).toThrow("invalid size");
  });

  it("Structurize: rejects a missing size", () => {
    const bytes = gzip(
      new nbt.Compound({
        version: new nbt.Byte(1),
        size_x: new nbt.Short(1),
        size_y: new nbt.Short(1),
        palette: new nbt.NbtList([]),
        blocks: new nbt.IntArray([]),
      }),
    );
    expect(() => StructurizeBlueprint.schematicLoad(bytes, options)).toThrow(
      "missing `size_z`",
    );
  });

  it("Building Gadgets v1: rejects more positions than its box holds", () => {
    const body = gzip(
      new nbt.Compound({
        data: new nbt.NbtList([]),
        pos: new nbt.NbtList([new nbt.Long(0n), new nbt.Long(1n)]),
      }),
    );
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        header: {
          bounding_box: {
            min_x: 0,
            min_y: 0,
            min_z: 0,
            max_x: 0,
            max_y: 0,
            max_z: 0,
          },
        },
        body: Buffer.from(body).toString("base64"),
      }),
    );
    expect(() =>
      BuildingGadgetsV1Schematic.schematicLoad(bytes, options),
    ).toThrow("2 block positions, more than the 1");
  });

  it("Sponge: rejects block data too long for its declared size", () => {
    const sponge = (blockData: number[]) =>
      new nbt.Named({
        Schematic: new nbt.Compound({
          Version: new nbt.Int(2),
          DataVersion: new nbt.Int(3465),
          Width: new nbt.Short(2),
          Height: new nbt.Short(1),
          Length: new nbt.Short(1),
          PaletteMax: new nbt.Int(1),
          Palette: new nbt.Compound({ "minecraft:stone": new nbt.Int(0) }),
          BlockData: new nbt.ByteArray(blockData),
        }),
      }).toBytes({ compress: true });
    // Eleven bytes can't be two varints of at most five bytes each.
    expect(() =>
      SpongeSchematicV2.schematicLoad(sponge(new Array(11).fill(0)), options),
    ).toThrow("11 bytes, which can't hold 2 entries");
    // Three one-byte varints: decoding stops at the third.
    expect(() =>
      SpongeSchematicV2.schematicLoad(sponge([0, 0, 0]), options),
    ).toThrow("more than 2 entries");
    expect(
      SpongeSchematicV2.schematicLoad(sponge([0, 0]), options).getBlockMatrix()
        .size,
    ).toBe(2);
  });

  it("JSON: checks each region's declared size before reading its blocks", () => {
    const json = (size: unknown) =>
      JSON.stringify({
        metadata: {},
        name: "x",
        minecraftVersion: "1.20.1",
        regions: [
          {
            minecraftVersion: "1.20.1",
            origin: { x: 0, y: 0, z: 0 },
            size,
            blocks: [{ pos: { x: 0, y: 0, z: 0 }, state: "minecraft:stone" }],
            entities: [],
            tileEntities: [],
          },
        ],
      });
    expect(() =>
      IntermediateSchematic.schematicLoad(json([1000, 1000, 1000]), options),
    ).toThrow(SchematicTooLargeError);
    expect(() =>
      IntermediateSchematic.schematicLoad(json(null), options),
    ).toThrow("no valid size");
    expect(
      IntermediateSchematic.schematicLoad(
        json([1, 1, 1]),
        options,
      ).getRegions(),
    ).toHaveLength(1);
  });
});
