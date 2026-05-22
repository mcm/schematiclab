// Port of schemlib/schematic_formats/litematic.py (Python) -> TypeScript.
//
// Litematic is the schematic format used by the Litematica mod. Wire format:
// gzipped NBT with a top-level Compound containing `Metadata`, `Regions`,
// `Version`, `SubVersion`, `MinecraftDataVersion`. Each region stores blocks
// as a bit-packed `LongArray` indexed against a `BlockStatePalette`.

import * as nbt from "../nbt";
import { Block, BlockPos, BlockState } from "../blocks";
import { Entity } from "../entities";
import { AbstractRegion, AbstractSchematic } from "./abstract";
import {
  MinecraftVersion,
  getVersion,
  getVersionFromDataVersion,
  posKey,
  versionsEqual,
} from "./version-mapping";

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Litematic's bit-width-per-palette-entry. Mirrors Python's
 * `LongArray.calcsize(len(palette))` — `max(ceil(log2(palette_length)), 2)`.
 *
 * For palette length 0/1, the math degenerates (`log2(0)` is `-Infinity`,
 * `log2(1) = 0`), so we always return at least 2 — that's the Minecraft spec
 * minimum.
 */
function paletteBitWidth(paletteLength: number): number {
  if (paletteLength <= 1) return 2;
  const bits = Math.ceil(Math.log2(paletteLength));
  return Math.max(bits, 2);
}

function readInt(tag: nbt.NbtTag | undefined): number {
  if (tag === undefined) return 0;
  const v = (tag as unknown as { value: number | bigint }).value;
  return typeof v === "bigint" ? Number(v) : v;
}

function readString(tag: nbt.NbtTag | undefined): string {
  if (tag instanceof nbt.StringTag) return tag.value;
  return "";
}

function readBlockPosCompound(tag: nbt.NbtTag | undefined): BlockPos {
  if (!(tag instanceof nbt.Compound)) return BlockPos.ORIGIN;
  return new BlockPos(
    readInt(tag.get("x")),
    readInt(tag.get("y")),
    readInt(tag.get("z")),
  );
}

function blockStateFromCompound(c: nbt.Compound): BlockState {
  const name = readString(c.get("Name"));
  const propsTag = c.get("Properties");
  const props: Record<string, string> = {};
  if (propsTag instanceof nbt.Compound) {
    for (const [k, v] of propsTag.entries) {
      if (v instanceof nbt.StringTag) props[k] = v.value;
    }
  }
  return new BlockState({ Name: name, Properties: props });
}

function compoundListFrom(tag: nbt.NbtTag | undefined): nbt.Compound[] {
  if (!(tag instanceof nbt.NbtList)) return [];
  const out: nbt.Compound[] = [];
  for (const item of tag.items) {
    if (item instanceof nbt.Compound) out.push(item);
  }
  return out;
}

function blockPosCompound(p: {
  x: number;
  y: number;
  z: number;
}): nbt.Compound {
  return new nbt.Compound({
    x: new nbt.Int(p.x),
    y: new nbt.Int(p.y),
    z: new nbt.Int(p.z),
  });
}

function safeGetVersionFromDataVersion(dataVersion: number): MinecraftVersion {
  try {
    return getVersionFromDataVersion(dataVersion);
  } catch {
    return getVersion("1.20.1");
  }
}

// ── LitematicRegion ───────────────────────────────────────────────────────

export interface LitematicRegionInit {
  size: BlockPos;
  blockStatePalette: BlockState[];
  blockStates: nbt.LongArray;
  position: BlockPos;
  entities?: nbt.Compound[];
  tileEntities?: nbt.Compound[];
  pendingBlockTicks?: nbt.Compound[];
  pendingFluidTicks?: nbt.Compound[];
  minecraftVersion: MinecraftVersion;
}

export class LitematicRegion extends AbstractRegion {
  readonly size: BlockPos;
  readonly blockStatePalette: BlockState[];
  readonly blockStates: nbt.LongArray;
  readonly position: BlockPos;
  readonly entities: nbt.Compound[];
  readonly tileEntities: nbt.Compound[];
  readonly pendingBlockTicks: nbt.Compound[];
  readonly pendingFluidTicks: nbt.Compound[];
  minecraftVersion: MinecraftVersion;

  constructor(init: LitematicRegionInit) {
    super();
    this.size = init.size;
    this.blockStatePalette = init.blockStatePalette;
    this.blockStates = init.blockStates;
    this.position = init.position;
    this.entities = init.entities ?? [];
    this.tileEntities = init.tileEntities ?? [];
    this.pendingBlockTicks = init.pendingBlockTicks ?? [];
    this.pendingFluidTicks = init.pendingFluidTicks ?? [];
    this.minecraftVersion = init.minecraftVersion;
  }

  getMinecraftVersion(): MinecraftVersion {
    return this.minecraftVersion;
  }

  getOrigin(): BlockPos {
    return BlockPos.ORIGIN;
  }

  getBlockMatrix(): Map<string, Block> {
    const width = this.size.x;
    const height = this.size.y;
    const length = this.size.z;
    const absWidth = Math.abs(width);
    const absHeight = Math.abs(height);
    const absLength = Math.abs(length);

    const palette = this.blockStatePalette;
    const bits = paletteBitWidth(palette.length);

    const blocks = new Map<string, Block>();

    for (let x = 0; x < absWidth; x++) {
      for (let y = 0; y < absHeight; y++) {
        for (let z = 0; z < absLength; z++) {
          const i = x + z * width + y * length * width;
          const stateIdx = Number(this.blockStates.readPackedUint(i, bits));
          if (stateIdx < 0 || stateIdx >= palette.length) {
            throw new Error(
              `Block state index ${stateIdx} out of range (palette size ${palette.length}) at (${x}, ${y}, ${z}), i=${i}`,
            );
          }
          const state = palette[stateIdx];
          if (state.Name === "minecraft:air") continue;
          const pos = new BlockPos(x, y, z);
          blocks.set(posKey(pos), new Block(pos, state));
        }
      }
    }

    return blocks;
  }

  getEntityMatrix(): Map<string, Entity> {
    const matrix = new Map<string, Entity>();
    for (const c of this.entities) {
      const entity = new Entity(c);
      matrix.set(posKey(entity.pos), entity);
    }
    return matrix;
  }

  getTileEntityMatrix(): Map<string, Entity> {
    const matrix = new Map<string, Entity>();
    for (const c of this.tileEntities) {
      const x = readInt(c.get("x"));
      const y = readInt(c.get("y"));
      const z = readInt(c.get("z"));
      matrix.set(`${x},${y},${z}`, new Entity(c));
    }
    return matrix;
  }

  toCompound(): nbt.Compound {
    const paletteList = new nbt.NbtList<nbt.Compound>(
      this.blockStatePalette.map((s) => s.toCompound()),
    );
    return new nbt.Compound({
      BlockStatePalette: paletteList,
      BlockStates: this.blockStates,
      Entities: new nbt.NbtList<nbt.Compound>(this.entities),
      PendingBlockTicks: new nbt.NbtList<nbt.Compound>(this.pendingBlockTicks),
      PendingFluidTicks: new nbt.NbtList<nbt.Compound>(this.pendingFluidTicks),
      Position: blockPosCompound(this.position),
      Size: blockPosCompound(this.size),
      TileEntities: new nbt.NbtList<nbt.Compound>(this.tileEntities),
    });
  }

  static fromCompound(
    c: nbt.Compound,
    minecraftVersion: MinecraftVersion,
  ): LitematicRegion {
    const paletteTag = c.get("BlockStatePalette");
    const palette: BlockState[] = [];
    if (paletteTag instanceof nbt.NbtList) {
      for (const item of paletteTag.items) {
        if (item instanceof nbt.Compound)
          palette.push(blockStateFromCompound(item));
      }
    }
    const blockStatesTag = c.get("BlockStates");
    if (!(blockStatesTag instanceof nbt.LongArray)) {
      throw new Error("LitematicRegion is missing or has invalid BlockStates");
    }

    return new LitematicRegion({
      size: readBlockPosCompound(c.get("Size")),
      blockStatePalette: palette,
      blockStates: blockStatesTag,
      position: readBlockPosCompound(c.get("Position")),
      entities: compoundListFrom(c.get("Entities")),
      tileEntities: compoundListFrom(c.get("TileEntities")),
      pendingBlockTicks: compoundListFrom(c.get("PendingBlockTicks")),
      pendingFluidTicks: compoundListFrom(c.get("PendingFluidTicks")),
      minecraftVersion,
    });
  }
}

// ── LitematicMetadata ─────────────────────────────────────────────────────

export interface LitematicMetadata {
  Author: string;
  Description: string;
  Name: string;
  RegionCount: number;
  TimeCreated: bigint; // ms since epoch
  TimeModified: bigint;
  TotalBlocks: number;
  TotalVolume: number;
  EnclosingSize: BlockPos;
}

function metadataFromCompound(c: nbt.Compound): LitematicMetadata {
  const timeCreated = c.get("TimeCreated");
  const timeModified = c.get("TimeModified");
  return {
    Author: readString(c.get("Author")),
    Description: readString(c.get("Description")),
    Name: readString(c.get("Name")),
    RegionCount: readInt(c.get("RegionCount")),
    TimeCreated:
      timeCreated instanceof nbt.Long
        ? timeCreated.value
        : BigInt(readInt(timeCreated)),
    TimeModified:
      timeModified instanceof nbt.Long
        ? timeModified.value
        : BigInt(readInt(timeModified)),
    TotalBlocks: readInt(c.get("TotalBlocks")),
    TotalVolume: readInt(c.get("TotalVolume")),
    EnclosingSize: readBlockPosCompound(c.get("EnclosingSize")),
  };
}

function metadataToCompound(m: LitematicMetadata): nbt.Compound {
  return new nbt.Compound({
    Author: new nbt.StringTag(m.Author),
    Description: new nbt.StringTag(m.Description),
    Name: new nbt.StringTag(m.Name),
    RegionCount: new nbt.Int(m.RegionCount),
    TimeCreated: new nbt.Long(m.TimeCreated),
    TimeModified: new nbt.Long(m.TimeModified),
    TotalBlocks: new nbt.Int(m.TotalBlocks),
    TotalVolume: new nbt.Int(m.TotalVolume),
    EnclosingSize: blockPosCompound(m.EnclosingSize),
  });
}

// ── LitematicSchematic ────────────────────────────────────────────────────

export interface LitematicSchematicInit {
  metadata: LitematicMetadata;
  regions: Map<string, LitematicRegion>;
  version: number;
  subVersion?: number | null;
  minecraftDataVersion: number;
}

export class LitematicSchematic extends AbstractSchematic {
  readonly metadata: LitematicMetadata;
  readonly regions: Map<string, LitematicRegion>;
  readonly version: number;
  readonly subVersion: number | null;
  readonly minecraftDataVersion: number;

  constructor(init: LitematicSchematicInit) {
    super();
    this.metadata = init.metadata;
    this.regions = init.regions;
    this.version = init.version;
    this.subVersion = init.subVersion ?? null;
    this.minecraftDataVersion = init.minecraftDataVersion;

    // Propagate Minecraft version to each region (parity with Python's
    // `model_validator(mode="after") set_minecraft_version_on_regions`).
    const mcVersion = this.getMinecraftVersion();
    for (const region of this.regions.values()) {
      region.minecraftVersion = mcVersion;
    }
  }

  static getFormatDescription(): string {
    return "Litematica schematic (.litematic files)";
  }

  static getDefaultExtension(): string {
    return "litematic";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.20.1");
  }

  getMetadata(): Record<string, unknown> {
    return {
      Author: this.metadata.Author,
      Description: this.metadata.Description,
      Name: this.metadata.Name,
      RegionCount: this.metadata.RegionCount,
      TimeCreated: this.metadata.TimeCreated,
      TimeModified: this.metadata.TimeModified,
      TotalBlocks: this.metadata.TotalBlocks,
      TotalVolume: this.metadata.TotalVolume,
      EnclosingSize: {
        x: this.metadata.EnclosingSize.x,
        y: this.metadata.EnclosingSize.y,
        z: this.metadata.EnclosingSize.z,
      },
    };
  }

  getMinecraftVersion(): MinecraftVersion {
    return safeGetVersionFromDataVersion(this.minecraftDataVersion);
  }

  getDataVersion(): number {
    return this.minecraftDataVersion;
  }

  getName(): string {
    return this.metadata.Name || "unknown litematic schematic";
  }

  getRegions(): LitematicRegion[] {
    return Array.from(this.regions.values());
  }

  static schematicLoad(obj: string | Uint8Array): LitematicSchematic {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const root = nbt.loadNbtFromBytes(bytes);

    const metaTag = root.get("Metadata");
    if (!(metaTag instanceof nbt.Compound)) {
      throw new Error("Litematic schematic missing Metadata compound");
    }
    const metadata = metadataFromCompound(metaTag);

    const dataVersion = readInt(root.get("MinecraftDataVersion"));
    const minecraftVersion = safeGetVersionFromDataVersion(dataVersion);

    const regionsTag = root.get("Regions");
    if (!(regionsTag instanceof nbt.Compound)) {
      throw new Error("Litematic schematic missing Regions compound");
    }
    const regions = new Map<string, LitematicRegion>();
    for (const [name, value] of regionsTag.entries) {
      if (!(value instanceof nbt.Compound)) continue;
      regions.set(name, LitematicRegion.fromCompound(value, minecraftVersion));
    }

    const versionTag = root.get("Version");
    const subVersionTag = root.get("SubVersion");

    return new LitematicSchematic({
      metadata,
      regions,
      version: readInt(versionTag),
      subVersion: subVersionTag !== undefined ? readInt(subVersionTag) : null,
      minecraftDataVersion: dataVersion,
    });
  }

  static fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): LitematicSchematic {
    const sourceMetadata = schematic.getMetadata() as Record<string, unknown>;

    const regions = new Map<string, LitematicRegion>();
    let totalBlocks = 0;

    let outerP1: [number, number, number] = [0, 0, 0];
    let outerP2: [number, number, number] = [0, 0, 0];

    schematic.getRegions().forEach((region, idx) => {
      let [pos1, pos2] = region.getBoundingBox();

      let offset: BlockPos = BlockPos.ORIGIN;
      if (!pos1.equals(BlockPos.ORIGIN)) {
        offset = new BlockPos(pos1.x, pos1.y, pos1.z);
        pos2 = pos2.sub(offset);
        pos1 = BlockPos.ORIGIN;
      }

      outerP1 = [
        Math.min(outerP1[0], pos1.x, pos2.x),
        Math.min(outerP1[1], pos1.y, pos2.y),
        Math.min(outerP1[2], pos1.z, pos2.z),
      ];
      outerP2 = [
        Math.max(outerP2[0], pos1.x, pos2.x),
        Math.max(outerP2[1], pos1.y, pos2.y),
        Math.max(outerP2[2], pos1.z, pos2.z),
      ];

      const [width, height, length] = region.getSize();
      const origin = region.getOrigin();

      let blocks: Block[];
      let entities: Entity[];
      let tileEntities: Entity[];
      let palette: BlockState[];
      if (
        targetVersion !== null &&
        !versionsEqual(targetVersion, region.getMinecraftVersion())
      ) {
        blocks = region.getTranslatedBlocks(targetVersion);
        entities = region.getTranslatedEntities(targetVersion);
        tileEntities = region.getTranslatedTileEntities(targetVersion);
        palette = region.getTranslatedPalette(targetVersion);
      } else {
        blocks = region.getBlocks();
        entities = region.getEntities();
        tileEntities = region.getTileEntities();
        palette = region.getPalette();
      }

      // Ensure AIR is at a known index in the palette. If it's not present,
      // insert at position 0.
      const paletteCopy: BlockState[] = palette.slice();
      let airIdx = paletteCopy.findIndex((s) => s.equals(BlockState.AIR_BLOCK));
      if (airIdx === -1) {
        paletteCopy.unshift(BlockState.AIR_BLOCK);
        airIdx = 0;
      }

      // Lookup helper that adds to palette on miss.
      const indexOfState = (state: BlockState): number => {
        for (let i = 0; i < paletteCopy.length; i++) {
          if (paletteCopy[i].equals(state)) return i;
        }
        paletteCopy.push(state);
        return paletteCopy.length - 1;
      };

      const regionBlocks = new Map<number, number>();
      for (const block of blocks) {
        if (block.state.Name === "minecraft:air") continue;
        const relX = block.pos.x - offset.x;
        const relY = block.pos.y - offset.y;
        const relZ = block.pos.z - offset.z;
        const i = relX + relZ * width + relY * length * width;
        regionBlocks.set(i, indexOfState(block.state));
      }

      const volume = width * height * length;

      // Pack indices into a LongArray at the right bit-width.
      const bits = paletteBitWidth(paletteCopy.length);
      const longCount = Math.ceil((volume * bits) / 64);
      const storage = new Uint8Array(longCount * 8);
      const blockStates = new nbt.LongArray(storage);
      for (let i = 0; i < volume; i++) {
        const v = regionBlocks.has(i)
          ? (regionBlocks.get(i) as number)
          : airIdx;
        blockStates.writePackedUint(i, bits, v);
      }

      // Convert entity / tile-entity lists. Tile entities arrive in chunk
      // shape (id/x/y/z) but their x/y/z are in the source's coordinate space.
      // We've already shifted blocks by `offset` (the bounding-box min) to put
      // them at [0..size]; tile entities must follow the same shift or they
      // land outside the region.
      const entityCompounds: nbt.Compound[] = entities.map((e) =>
        e.toCompound(),
      );
      const tileEntityCompounds: nbt.Compound[] = tileEntities.map((e) => {
        const c = e.toCompound();
        if (offset.equals(BlockPos.ORIGIN)) return c;
        const shifted = new nbt.Compound();
        for (const [k, v] of c.entries) {
          if (k === "x" && v instanceof nbt.Int) {
            shifted.set(k, new nbt.Int(v.value - offset.x));
          } else if (k === "y" && v instanceof nbt.Int) {
            shifted.set(k, new nbt.Int(v.value - offset.y));
          } else if (k === "z" && v instanceof nbt.Int) {
            shifted.set(k, new nbt.Int(v.value - offset.z));
          } else {
            shifted.set(k, v);
          }
        }
        return shifted;
      });

      regions.set(
        `Converted Region ${idx}`,
        new LitematicRegion({
          size: new BlockPos(width, height, length),
          blockStatePalette: paletteCopy,
          blockStates,
          position: new BlockPos(origin.x, origin.y, origin.z),
          entities: entityCompounds,
          tileEntities: tileEntityCompounds,
          minecraftVersion: targetVersion ?? schematic.getMinecraftVersion(),
        }),
      );

      totalBlocks += regionBlocks.size;
    });

    const outerWidth = Math.abs(outerP2[0] - outerP1[0]) + 1;
    const outerHeight = Math.abs(outerP2[1] - outerP1[1]) + 1;
    const outerLength = Math.abs(outerP2[2] - outerP1[2]) + 1;

    const now = BigInt(Date.now());
    const sourceAuthor =
      typeof sourceMetadata.author === "string" ? sourceMetadata.author : "";
    const sourceDate =
      typeof sourceMetadata.date === "number"
        ? BigInt(sourceMetadata.date)
        : null;

    const metadata: LitematicMetadata = {
      Name: schematic.getName() || "",
      Author: sourceAuthor,
      Description: "",
      TimeCreated: sourceDate ?? now,
      TimeModified: sourceDate ?? now,
      RegionCount: regions.size,
      TotalBlocks: totalBlocks,
      TotalVolume: outerWidth * outerHeight * outerLength,
      EnclosingSize: new BlockPos(outerWidth, outerHeight, outerLength),
    };

    const minecraftDataVersion =
      targetVersion !== null
        ? targetVersion.dataVersion
        : schematic.getDataVersion();

    return new LitematicSchematic({
      metadata,
      regions,
      version: 6,
      subVersion: 1,
      minecraftDataVersion,
    });
  }

  schematicDump(): Uint8Array {
    const regionsCompound = new nbt.Compound();
    for (const [name, region] of this.regions) {
      regionsCompound.set(name, region.toCompound());
    }

    const root = new nbt.Compound({
      Metadata: metadataToCompound(this.metadata),
      Regions: regionsCompound,
      Version: new nbt.Int(this.version),
      MinecraftDataVersion: new nbt.Int(this.minecraftDataVersion),
    });
    if (this.subVersion !== null) {
      root.set("SubVersion", new nbt.Int(this.subVersion));
    }

    const named = new nbt.Named({ "": root });
    return named.toBytes({ compress: true });
  }
}
