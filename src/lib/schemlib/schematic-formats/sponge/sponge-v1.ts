// Port of schemlib/schematic_formats/sponge/sponge_v1.py (Python) -> TypeScript.
//
// SpongeSchematicV1 is the original Sponge schematic format. The on-disk
// representation is a gzipped NBT root named "Schematic" containing a
// flat-byte BlockData array indexed by a String->Int Palette compound.
//
// The Python implementation uses pydantic; here we parse the loaded NBT
// Compound by hand and store the typed fields directly. A SpongeSchematicV1
// is both an AbstractRegion and an AbstractSchematic (single region;
// getRegions() returns [this]).

import * as nbt from "../../nbt";
import { Block, BlockPos, BlockState } from "../../blocks";
import { Entity } from "../../entities";
import { AbstractRegion, AbstractSchematic } from "../abstract";
import { MinecraftVersion, getVersion, posKey } from "../version-mapping";

// ── BlockEntity shape translation ──────────────────────────────────────────
//
// v1 TileEntities are the same shape as v2 BlockEntities per spec:
// { Id, Pos: IntArray[3], ...extra fields flat at top level }. We translate
// to/from the chunk-format shape { id, x, y, z, ...flat } on the boundary so
// cross-format conversion stays consistent.

function v1TileEntityToChunkShape(c: nbt.Compound): nbt.Compound | null {
  const idTag = c.get("Id");
  const posTag = c.get("Pos");
  if (!(idTag instanceof nbt.StringTag)) return null;
  if (!(posTag instanceof nbt.IntArray)) return null;
  const posArr = posTag.toObject() as number[];
  if (posArr.length < 3) return null;
  const [x, y, z] = posArr;

  const out = new nbt.Compound();
  for (const [k, v] of c.entries) {
    if (k === "Id" || k === "Pos") continue;
    out.set(k, v);
  }
  out.set("id", new nbt.StringTag(idTag.value));
  out.set("x", new nbt.Int(x));
  out.set("y", new nbt.Int(y));
  out.set("z", new nbt.Int(z));
  return out;
}

function chunkShapeToV1TileEntity(c: nbt.Compound): nbt.Compound | null {
  const idTag = c.get("id") ?? c.get("Id");
  if (!(idTag instanceof nbt.StringTag)) return null;

  let x = 0,
    y = 0,
    z = 0;
  const xt = c.get("x");
  const yt = c.get("y");
  const zt = c.get("z");
  if (xt instanceof nbt.Int) x = xt.value;
  if (yt instanceof nbt.Int) y = yt.value;
  if (zt instanceof nbt.Int) z = zt.value;

  const out = new nbt.Compound();
  out.set("Id", new nbt.StringTag(idTag.value));
  out.set("Pos", new nbt.IntArray([x, y, z]));
  for (const [k, v] of c.entries) {
    if (k === "id" || k === "Id" || k === "x" || k === "y" || k === "z")
      continue;
    out.set(k, v);
  }
  return out;
}

// ── Metadata ──────────────────────────────────────────────────────────────

export interface SpongeSchematicMetadataInit {
  Name?: string;
  Author?: string;
  Date?: Date;
  RequiredMods?: string[];
}

export class SpongeSchematicMetadata {
  Name?: string;
  Author?: string;
  Date?: Date;
  RequiredMods?: string[];

  constructor(init: SpongeSchematicMetadataInit = {}) {
    this.Name = init.Name;
    this.Author = init.Author;
    this.Date = init.Date;
    this.RequiredMods = init.RequiredMods;
  }

  static fromCompound(compound: nbt.Compound): SpongeSchematicMetadata {
    const out = new SpongeSchematicMetadata();
    const nameTag = compound.get("Name");
    if (nameTag instanceof nbt.StringTag) out.Name = nameTag.value;
    const authorTag = compound.get("Author");
    if (authorTag instanceof nbt.StringTag) out.Author = authorTag.value;
    const dateTag = compound.get("Date");
    if (dateTag instanceof nbt.Long) {
      // Sponge stores Date as milliseconds-since-epoch Long.
      out.Date = new Date(Number(dateTag.value));
    }
    const modsTag = compound.get("RequiredMods");
    if (modsTag instanceof nbt.NbtList) {
      out.RequiredMods = [];
      for (const item of modsTag.items) {
        if (item instanceof nbt.StringTag) out.RequiredMods.push(item.value);
      }
    }
    return out;
  }

  toCompound(): nbt.Compound {
    const entries = new Map<string, nbt.NbtTag>();
    if (this.Name) entries.set("Name", new nbt.StringTag(this.Name));
    if (this.Author) entries.set("Author", new nbt.StringTag(this.Author));
    if (this.Date) {
      entries.set("Date", new nbt.Long(BigInt(this.Date.getTime())));
    }
    if (this.RequiredMods && this.RequiredMods.length > 0) {
      entries.set(
        "RequiredMods",
        new nbt.NbtList(this.RequiredMods.map((m) => new nbt.StringTag(m))),
      );
    }
    return new nbt.Compound(entries);
  }
}

// ── SpongeSchematicV1 ─────────────────────────────────────────────────────

export interface SpongeSchematicV1Init {
  Version: number;
  Metadata: SpongeSchematicMetadata;
  Width: number;
  Height: number;
  Length: number;
  Offset: [number, number, number];
  PaletteMax: number;
  Palette: Map<string, number>;
  BlockData: Uint8Array;
  TileEntities?: Entity[];
}

export class SpongeSchematicV1
  extends AbstractRegion
  implements AbstractSchematic
{
  Version: number;
  Metadata: SpongeSchematicMetadata;
  Width: number;
  Height: number;
  Length: number;
  Offset: [number, number, number];
  PaletteMax: number;
  Palette: Map<string, number>;
  BlockData: Uint8Array;
  TileEntities: Entity[];

  constructor(init: SpongeSchematicV1Init) {
    super();
    this.Version = init.Version;
    this.Metadata = init.Metadata;
    this.Width = init.Width;
    this.Height = init.Height;
    this.Length = init.Length;
    this.Offset = init.Offset;
    this.PaletteMax = init.PaletteMax;
    this.Palette = init.Palette;
    this.BlockData = init.BlockData;
    this.TileEntities = init.TileEntities ?? [];
  }

  // ── Format metadata ────────────────────────────────────────────────────

  static getFormatDescription(): string {
    return "Sponge v1 (.schem files)";
  }

  static getDefaultExtension(): string {
    return "schem";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.13.1");
  }

  // ── Load / dump ────────────────────────────────────────────────────────

  static schematicLoad(obj: string | Uint8Array): SpongeSchematicV1 {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const named = nbt.loadNbtFromBytes(bytes);
    return SpongeSchematicV1.fromCompound(named);
  }

  static fromCompound(compound: nbt.Compound): SpongeSchematicV1 {
    const versionTag = compound.get("Version");
    if (!(versionTag instanceof nbt.Int)) {
      throw new TypeError("Sponge v1: missing/invalid Version tag");
    }
    const widthTag = compound.get("Width");
    const heightTag = compound.get("Height");
    const lengthTag = compound.get("Length");
    if (
      !(widthTag instanceof nbt.Short) ||
      !(heightTag instanceof nbt.Short) ||
      !(lengthTag instanceof nbt.Short)
    ) {
      throw new TypeError("Sponge v1: Width/Height/Length must be Short");
    }
    // Offset is optional per spec; default to [0, 0, 0] when missing.
    let offsetArr: [number, number, number] = [0, 0, 0];
    const offsetTag = compound.get("Offset");
    if (offsetTag !== undefined) {
      if (!(offsetTag instanceof nbt.IntArray)) {
        throw new TypeError("Sponge v1: Offset must be IntArray");
      }
      const arr = offsetTag.toObject() as number[];
      if (arr.length < 3) {
        throw new TypeError("Sponge v1: Offset must have 3 elements");
      }
      offsetArr = [arr[0], arr[1], arr[2]];
    }

    const paletteMaxTag = compound.get("PaletteMax");
    if (!(paletteMaxTag instanceof nbt.Int)) {
      throw new TypeError("Sponge v1: missing PaletteMax");
    }

    const paletteTag = compound.get("Palette");
    if (!(paletteTag instanceof nbt.Compound)) {
      throw new TypeError("Sponge v1: Palette must be Compound");
    }
    const palette = new Map<string, number>();
    for (const [k, v] of paletteTag) {
      if (!(v instanceof nbt.Int)) {
        throw new TypeError(`Sponge v1: Palette[${k}] must be Int`);
      }
      palette.set(k, v.value);
    }

    const blockDataTag = compound.get("BlockData");
    if (!(blockDataTag instanceof nbt.ByteArray)) {
      throw new TypeError("Sponge v1: BlockData must be ByteArray");
    }
    // Expose as a Uint8Array view. ByteArray.toObject() returns signed bytes;
    // we want the raw unsigned-byte view since `block & 0xFF` is what indexes
    // the palette.
    const blockDataNumbers = blockDataTag.toObject() as number[];
    const blockData = new Uint8Array(blockDataNumbers.length);
    for (let i = 0; i < blockDataNumbers.length; i++) {
      blockData[i] = blockDataNumbers[i] & 0xff;
    }

    const tileEntities: Entity[] = [];
    const tileEntitiesTag = compound.get("TileEntities");
    if (tileEntitiesTag instanceof nbt.NbtList) {
      for (const item of tileEntitiesTag.items) {
        if (!(item instanceof nbt.Compound)) continue;
        const chunkShape = v1TileEntityToChunkShape(item);
        tileEntities.push(new Entity(chunkShape ?? item));
      }
    }

    const metadataTag = compound.get("Metadata");
    const metadata =
      metadataTag instanceof nbt.Compound
        ? SpongeSchematicMetadata.fromCompound(metadataTag)
        : new SpongeSchematicMetadata();

    return new SpongeSchematicV1({
      Version: versionTag.value,
      Metadata: metadata,
      Width: widthTag.value,
      Height: heightTag.value,
      Length: lengthTag.value,
      Offset: [offsetArr[0], offsetArr[1], offsetArr[2]],
      PaletteMax: paletteMaxTag.value,
      Palette: palette,
      BlockData: blockData,
      TileEntities: tileEntities,
    });
  }

  schematicDump(): Uint8Array {
    const root = this.toCompound();
    const named = new nbt.Named({ Schematic: root });
    return named.toBytes({ compress: true });
  }

  toCompound(): nbt.Compound {
    const entries = new Map<string, nbt.NbtTag>();
    entries.set("Version", new nbt.Int(this.Version));
    entries.set("Metadata", this.Metadata.toCompound());
    entries.set("Width", new nbt.Short(this.Width));
    entries.set("Height", new nbt.Short(this.Height));
    entries.set("Length", new nbt.Short(this.Length));
    entries.set("Offset", new nbt.IntArray(this.Offset));
    entries.set("PaletteMax", new nbt.Int(this.PaletteMax));

    const paletteEntries = new Map<string, nbt.NbtTag>();
    for (const [k, v] of this.Palette) {
      paletteEntries.set(k, new nbt.Int(v));
    }
    entries.set("Palette", new nbt.Compound(paletteEntries));

    // BlockData stored as signed bytes per Sponge spec.
    const blockBytes: number[] = new Array(this.BlockData.length);
    for (let i = 0; i < this.BlockData.length; i++) {
      const b = this.BlockData[i];
      blockBytes[i] = b > 127 ? b - 256 : b;
    }
    entries.set("BlockData", new nbt.ByteArray(blockBytes));

    // TileEntities are stored in chunk-shape internally; translate back to v1
    // wire shape on the way out. Always emit the tag (even when empty) since
    // some Sponge readers bail with "Missing tag TileEntities" when it's
    // absent.
    const tileEntityItems: nbt.Compound[] = [];
    for (const e of this.TileEntities) {
      const v1 = chunkShapeToV1TileEntity(e.toCompound());
      if (v1) tileEntityItems.push(v1);
    }
    entries.set("TileEntities", new nbt.NbtList(tileEntityItems));

    return new nbt.Compound(entries);
  }

  // ── Region API ─────────────────────────────────────────────────────────

  private getPaletteMap(): Map<number, BlockState> {
    const out = new Map<number, BlockState>();
    for (const [k, v] of this.Palette) {
      out.set(v, BlockState.fromString(k));
    }
    return out;
  }

  getPalette(): BlockState[] {
    return [...this.getPaletteMap().values()];
  }

  getBlockMatrix(): Map<string, Block> {
    const palette = this.getPaletteMap();
    const blocks = new Map<string, Block>();

    for (let i = 0; i < this.BlockData.length; i++) {
      const raw = this.BlockData[i];
      // Replicates Python: x = (i % Width) - Offset[0]; i //= Width; z = (i %
      // Length) - Offset[1]; y = (i // Length) - Offset[2].
      let idx = i;
      const x = (idx % this.Width) - this.Offset[0];
      idx = (idx - (idx % this.Width)) / this.Width;
      const z = (idx % this.Length) - this.Offset[1];
      const y = (idx - (idx % this.Length)) / this.Length - this.Offset[2];

      const stateIdx = raw & 0xff;
      const state = palette.get(stateIdx);
      if (!state) continue;

      const pos = new BlockPos(x, y, z);
      blocks.set(posKey(pos), new Block(pos, state));
    }
    return blocks;
  }

  getEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getTileEntityMatrix(): Map<string, Entity> {
    // TileEntities are stored in chunk-shape internally; key by x/y/z. The
    // previous version went through Entity.blockPos, which assumes Pos:
    // NbtList<Double> (entity format), so every TE collapsed to (0,0,0).
    const out = new Map<string, Entity>();
    for (const e of this.TileEntities) {
      const c = e.toCompound();
      const xt = c.get("x");
      const yt = c.get("y");
      const zt = c.get("z");
      const x = xt instanceof nbt.Int ? xt.value : 0;
      const y = yt instanceof nbt.Int ? yt.value : 0;
      const z = zt instanceof nbt.Int ? zt.value : 0;
      out.set(`${x},${y},${z}`, e);
    }
    return out;
  }

  getOrigin(): BlockPos {
    return BlockPos.ORIGIN;
  }

  getSize(): [number, number, number] {
    return [this.Width, this.Height, this.Length];
  }

  // ── Schematic API ──────────────────────────────────────────────────────

  getMetadata(): Record<string, unknown> {
    return {
      author: this.Metadata.Author,
      date: this.Metadata.Date ?? new Date(),
    };
  }

  getName(): string {
    if (this.Metadata.Name) return this.Metadata.Name;
    return `unknown sponge schematic, v${this.Version}`;
  }

  getRegions(): AbstractRegion[] {
    return [this];
  }

  getRegion(idx: number): AbstractRegion {
    return this.getRegions()[idx];
  }

  getMinecraftVersion(): MinecraftVersion {
    // The on-disk format has no DataVersion in v1; Python hard-codes 1.13.2,
    // but our known-versions table only has 1.13.1. Either is a guess.
    return getVersion("1.13.1");
  }

  getDataVersion(): number {
    return this.getMinecraftVersion().dataVersion;
  }

  static checkSize(_width: number, _height: number, _length: number): void {
    // Sponge v1 imposes no explicit size limit beyond NBT Short range.
  }

  // ── Cross-format conversion ────────────────────────────────────────────

  static fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): SpongeSchematicV1 {
    if (schematic.getRegions().length > 1) {
      throw new Error(
        `Too many regions in source schematic (${schematic.getRegions().length})`,
      );
    }

    const region = schematic.getRegion(0);

    let sourcePalette: BlockState[];
    let sourceBlocks: Block[];
    let sourceTileEntities: Entity[];
    if (targetVersion) {
      sourcePalette = region.getTranslatedPalette(targetVersion);
      sourceBlocks = region.getTranslatedBlocks(targetVersion);
      sourceTileEntities = region.getTranslatedTileEntities(targetVersion);
    } else {
      sourcePalette = region.getPalette();
      sourceBlocks = region.getBlocks();
      sourceTileEntities = region.getTileEntities();
    }

    const [width, height, length] = region.getSize();
    const [pos1] = region.getBoundingBox();

    const requiredMods: string[] = [];

    // Ensure AIR_BLOCK is in the palette so we can fill empty cells.
    let airBlock: number;
    const airIdx = sourcePalette.findIndex((s) =>
      s.equals(BlockState.AIR_BLOCK),
    );
    if (airIdx !== -1) {
      airBlock = airIdx;
    } else {
      airBlock = 0;
      sourcePalette = [BlockState.AIR_BLOCK, ...sourcePalette];
    }

    const blocks = new Map<number, number>();
    for (const block of sourceBlocks) {
      const colon = block.state.Name.indexOf(":");
      const modId =
        colon === -1 ? block.state.Name : block.state.Name.slice(0, colon);
      if (modId !== "minecraft" && !requiredMods.includes(modId)) {
        requiredMods.push(modId);
      }
      let stateIdx = sourcePalette.findIndex((s) => s.equals(block.state));
      if (stateIdx === -1) {
        sourcePalette.push(block.state);
        stateIdx = sourcePalette.length - 1;
      }
      const i =
        block.pos.x + block.pos.z * width + block.pos.y * length * width;
      blocks.set(i, stateIdx);
    }

    const meta = new SpongeSchematicMetadata();
    const name = schematic.getName();
    if (name) meta.Name = name;
    const srcMeta = schematic.getMetadata();
    const author = srcMeta.author;
    if (typeof author === "string") meta.Author = author;
    const date = srcMeta.date;
    if (date instanceof Date) meta.Date = date;
    else if (typeof date === "number") meta.Date = new Date(date);
    if (requiredMods.length > 0) meta.RequiredMods = requiredMods;

    const total = width * height * length;
    const blockData = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      blockData[i] = (blocks.has(i) ? blocks.get(i)! : airBlock) & 0xff;
    }

    const palette = new Map<string, number>();
    for (let i = 0; i < sourcePalette.length; i++) {
      palette.set(sourcePalette[i].toString(), i);
    }

    // Translate chunk-shape tile entities into Sponge v1 TileEntity shape.
    // Internally we stored them in chunk-shape after parsing; format-shape
    // serialization happens on dump via chunkShapeToV1TileEntity in
    // toCompound. Here we keep the chunk-shape Entities so they go through
    // the same path on output.
    const tileEntities: Entity[] = [];
    for (const e of sourceTileEntities) {
      tileEntities.push(e);
    }

    return new SpongeSchematicV1({
      Version: 1,
      Metadata: meta,
      Width: width,
      Height: height,
      Length: length,
      Offset: [pos1.x, pos1.y, pos1.z],
      PaletteMax: sourcePalette.length,
      Palette: palette,
      BlockData: blockData,
      TileEntities: tileEntities,
    });
  }
}
