// Small crafted schematics whose headers declare regions far bigger than
// their block data, one per format family. Used to check that a load with
// `maxBlocks` stops on the declared size before decoding any blocks.

import * as nbt from "../schemlib/nbt";
import { toSnbt } from "../schemlib/snbt";
import type { AbstractRegion } from "../schemlib/schematic-formats";
import { LitematicRegion } from "../schemlib/schematic-formats/litematic";
import { StructureSchematic } from "../schemlib/schematic-formats/structure";
import {
  SpongeSchematicV1,
  SpongeSchematicV2,
  SpongeSchematicV3,
} from "../schemlib/schematic-formats/sponge";
import {
  BuildingGadgetsV0Schematic,
  BuildingGadgetsV1Schematic,
  BuildingGadgetsV2Schematic,
} from "../schemlib/schematic-formats/building-gadgets";
import { StructurizeBlueprint } from "../schemlib/schematic-formats/structurize";

export interface OversizedSchematic {
  format: string;
  bytes: Uint8Array;
  /** The blocks the header declares (air included). */
  declaredBlocks: number;
  /** The class whose `getBlockMatrix` decodes the block data. */
  region: { prototype: AbstractRegion };
  /**
   * The error the load gives without a cap, for formats that read their
   * block data while loading (the crafted data doesn't match the size). It
   * comes from the block data's decoder, so a capped load that fails with
   * `SchematicTooLargeError` instead shows the size was checked first.
   */
  uncappedError?: string;
}

const encoder = new TextEncoder();

function gzipNbt(root: nbt.Compound, name = ""): Uint8Array {
  return new nbt.Named({ [name]: root }).toBytes({ compress: true });
}

function xyz(x: number, y: number, z: number): nbt.Compound {
  return new nbt.Compound({
    x: new nbt.Int(x),
    y: new nbt.Int(y),
    z: new nbt.Int(z),
  });
}

function upperXyz(x: number, y: number, z: number): nbt.Compound {
  return new nbt.Compound({
    X: new nbt.Int(x),
    Y: new nbt.Int(y),
    Z: new nbt.Int(z),
  });
}

function stonePalette(): nbt.NbtList {
  return new nbt.NbtList([
    new nbt.Compound({ Name: new nbt.StringTag("minecraft:stone") }),
  ]);
}

function litematic(): OversizedSchematic {
  // Two regions of 1,500 × 1,000 × 1 (one with a negative size), so only
  // their sum is over 2,000,000.
  const region = (sx: number) =>
    new nbt.Compound({
      Size: xyz(sx, 1000, 1),
      Position: xyz(0, 0, 0),
      BlockStatePalette: stonePalette(),
      BlockStates: new nbt.LongArray([]),
    });
  return {
    format: "Litematic",
    bytes: gzipNbt(
      new nbt.Compound({
        Version: new nbt.Int(6),
        MinecraftDataVersion: new nbt.Int(3465),
        Metadata: new nbt.Compound({ Name: new nbt.StringTag("bomb") }),
        Regions: new nbt.Compound({ a: region(1500), b: region(-1500) }),
      }),
    ),
    declaredBlocks: 3_000_000,
    region: LitematicRegion,
  };
}

function sponge(version: 1 | 2): OversizedSchematic {
  const root = new nbt.Compound({
    Version: new nbt.Int(version),
    DataVersion: new nbt.Int(3465),
    Width: new nbt.Short(1000),
    Height: new nbt.Short(1000),
    Length: new nbt.Short(1000),
    PaletteMax: new nbt.Int(1),
    Palette: new nbt.Compound({ "minecraft:stone": new nbt.Int(0) }),
    BlockData: new nbt.ByteArray([]),
  });
  return {
    format: `Sponge[v${version}]`,
    bytes: gzipNbt(root, "Schematic"),
    declaredBlocks: 1_000_000_000,
    region: version === 1 ? SpongeSchematicV1 : SpongeSchematicV2,
    uncappedError: "BlockData has 0 bytes, which can't hold 1000000000 entries",
  };
}

function spongeV3(): OversizedSchematic {
  const inner = new nbt.Compound({
    Version: new nbt.Int(3),
    DataVersion: new nbt.Int(3465),
    // Sponge v3 sizes are unsigned shorts: -1 is 65,535.
    Width: new nbt.Short(-1),
    Height: new nbt.Short(1000),
    Length: new nbt.Short(1),
    Blocks: new nbt.Compound({
      Palette: new nbt.Compound({ "minecraft:stone": new nbt.Int(0) }),
      Data: new nbt.ByteArray([]),
    }),
  });
  return {
    format: "Sponge[v3]",
    bytes: gzipNbt(new nbt.Compound({ Schematic: inner })),
    declaredBlocks: 65_535_000,
    region: SpongeSchematicV3,
    uncappedError: "Blocks.Data has 0 bytes, which can't hold 65535000 entries",
  };
}

function structure(): OversizedSchematic {
  return {
    format: "Structure",
    bytes: gzipNbt(
      new nbt.Compound({
        DataVersion: new nbt.Int(3465),
        size: new nbt.NbtList([
          new nbt.Int(1000),
          new nbt.Int(1000),
          new nbt.Int(1000),
        ]),
        palette: stonePalette(),
        blocks: new nbt.NbtList([]),
        entities: new nbt.NbtList([]),
      }),
    ),
    declaredBlocks: 1_000_000_000,
    region: StructureSchematic,
  };
}

function blueprint(): OversizedSchematic {
  return {
    format: "StructurizeBlueprint",
    bytes: gzipNbt(
      new nbt.Compound({
        version: new nbt.Byte(1),
        name: new nbt.StringTag("bomb"),
        size_x: new nbt.Short(1000),
        size_y: new nbt.Short(1000),
        size_z: new nbt.Short(1000),
        palette: stonePalette(),
        blocks: new nbt.IntArray([]),
        required_mods: new nbt.NbtList([]),
      }),
    ),
    declaredBlocks: 1_000_000_000,
    region: StructurizeBlueprint,
  };
}

function buildingGadgetsV0(): OversizedSchematic {
  const root = new nbt.Compound({
    stateIntArray: new nbt.IntArray([]),
    dim: new nbt.Int(0),
    posIntArray: new nbt.IntArray([]),
    startPos: upperXyz(0, 0, 0),
    endPos: upperXyz(999, 999, 999),
    mapIntState: new nbt.NbtList([]),
  });
  return {
    format: "BuildingGadgets[1.12]",
    bytes: encoder.encode(toSnbt(root)),
    declaredBlocks: 1_000_000_000,
    region: BuildingGadgetsV0Schematic,
  };
}

function buildingGadgetsV1(): OversizedSchematic {
  const json = {
    header: {
      version: "1",
      mc_version: "1.16.5",
      name: "bomb",
      bounding_box: {
        min_x: 0,
        min_y: 0,
        min_z: 0,
        max_x: 999,
        max_y: 999,
        max_z: 999,
      },
    },
    // Not NBT: decoding the body throws.
    body: "AAAA",
  };
  return {
    format: "BuildingGadgets[1.14.4-1.19.3]",
    bytes: encoder.encode(JSON.stringify(json)),
    declaredBlocks: 1_000_000_000,
    region: BuildingGadgetsV1Schematic,
    uncappedError: "Expected root Compound (10) but got 0",
  };
}

function buildingGadgetsV2(): OversizedSchematic {
  const spal = new nbt.Compound({
    blockstatemap: stonePalette(),
    startpos: upperXyz(0, 0, 0),
    endpos: upperXyz(999, -999, 999),
    statelist: new nbt.IntArray([]),
  });
  const json = {
    name: "bomb",
    statePosArrayList: toSnbt(spal),
    requiredItems: {},
  };
  return {
    format: "BuildingGadgets2[1.20+]",
    bytes: encoder.encode(JSON.stringify(json)),
    declaredBlocks: 1_000_000_000,
    region: BuildingGadgetsV2Schematic,
  };
}

export function oversizedSchematics(): OversizedSchematic[] {
  return [
    litematic(),
    sponge(1),
    sponge(2),
    spongeV3(),
    structure(),
    blueprint(),
    buildingGadgetsV0(),
    buildingGadgetsV1(),
    buildingGadgetsV2(),
  ];
}

/**
 * A gzip stream of `inflatedBytes` zero bytes (about 1/1000 of that in size),
 * compressed a megabyte at a time so the inflated data is never held whole.
 */
export async function gzipBomb(inflatedBytes: number): Promise<Uint8Array> {
  const { createGzip } = await import("node:zlib");
  const gzip = createGzip({ level: 9 });
  const chunks: Buffer[] = [];
  gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    gzip.on("end", resolve);
    gzip.on("error", reject);
  });
  const zeros = Buffer.alloc(1024 * 1024);
  for (let left = inflatedBytes; left > 0; left -= zeros.length) {
    const chunk = left >= zeros.length ? zeros : zeros.subarray(0, left);
    if (!gzip.write(chunk)) {
      await new Promise((resolve) => gzip.once("drain", resolve));
    }
  }
  gzip.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
