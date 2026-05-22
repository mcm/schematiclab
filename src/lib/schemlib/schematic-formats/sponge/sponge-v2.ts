// Port of schemlib/schematic_formats/sponge/sponge_v2.py (Python) -> TypeScript.
//
// SpongeSchematicV2 is the Sponge v2 update: adds `DataVersion`, splits
// entities (`Entities` non-block) from tile entities (`BlockEntities`), and
// introduces a biome palette (which we don't read/write — schemlib's Python
// port also leaves it commented out).
//
// `BlockData` is a varint stream — each palette index is 7-bit base-128 with
// the MSB used as continuation. The upstream Python port treated it as one
// byte per block, which happens to work when every palette index fits in 7
// bits but produces scrambled output the moment a palette grows past 127
// entries.

import * as nbt from "../../nbt";
import { Block, BlockPos, BlockState } from "../../blocks";
import { Entity } from "../../entities";
import { AbstractRegion, AbstractSchematic } from "../abstract";
import {
  MinecraftVersion,
  getVersion,
  getVersionFromDataVersion,
  posKey,
} from "../version-mapping";
import { SpongeSchematicMetadata } from "./sponge-v1";
import { decodeVarintArray, encodeVarintArray } from "./sponge-v3";

// ── BlockEntity shape translation ──────────────────────────────────────────
//
// Sponge v2 stores BlockEntities flat: { Id, Pos: IntArray[3], ...extra fields
// at top level }. Downstream converters (litematic, structure NBT) use the
// Minecraft chunk-format compound { id, x, y, z, ...flat }. We translate on
// read (so cross-format consumers always see chunk-shape) and on write (so
// v2-targeted dumps emit valid v2 BlockEntity shape).

function v2BlockEntityToChunkShape(c: nbt.Compound): nbt.Compound | null {
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

function chunkShapeToV2BlockEntity(c: nbt.Compound): nbt.Compound | null {
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

export interface SpongeSchematicV2Init {
  Version: number;
  Metadata: SpongeSchematicMetadata;
  Width: number;
  Height: number;
  Length: number;
  Offset: [number, number, number];
  DataVersion: number;
  PaletteMax: number;
  Palette: Map<string, number>;
  /** Palette indices in linear order (varint-decoded on read). */
  BlockData: number[];
  BlockEntities?: Entity[];
  Entities?: Entity[];
  BiomePaletteMax?: number;
  BiomePalette?: Map<string, number>;
}

export class SpongeSchematicV2
  extends AbstractRegion
  implements AbstractSchematic
{
  Version: number;
  Metadata: SpongeSchematicMetadata;
  Width: number;
  Height: number;
  Length: number;
  Offset: [number, number, number];
  DataVersion: number;
  PaletteMax: number;
  Palette: Map<string, number>;
  BlockData: number[];
  BlockEntities: Entity[];
  Entities: Entity[];
  BiomePaletteMax: number;
  BiomePalette: Map<string, number>;

  constructor(init: SpongeSchematicV2Init) {
    super();
    this.Version = init.Version;
    this.Metadata = init.Metadata;
    this.Width = init.Width;
    this.Height = init.Height;
    this.Length = init.Length;
    this.Offset = init.Offset;
    this.DataVersion = init.DataVersion;
    this.PaletteMax = init.PaletteMax;
    this.Palette = init.Palette;
    this.BlockData = init.BlockData;
    this.BlockEntities = init.BlockEntities ?? [];
    this.Entities = init.Entities ?? [];
    this.BiomePaletteMax = init.BiomePaletteMax ?? 0;
    this.BiomePalette = init.BiomePalette ?? new Map();
  }

  // ── Format metadata ────────────────────────────────────────────────────

  static getFormatDescription(): string {
    return "Sponge v2 (.schem files)";
  }

  static getDefaultExtension(): string {
    return "schem";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.13.1");
  }

  // ── Load / dump ────────────────────────────────────────────────────────

  static schematicLoad(obj: string | Uint8Array): SpongeSchematicV2 {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const named = nbt.loadNbtFromBytes(bytes);
    return SpongeSchematicV2.fromCompound(named);
  }

  static fromCompound(compound: nbt.Compound): SpongeSchematicV2 {
    const versionTag = compound.get("Version");
    if (!(versionTag instanceof nbt.Int)) {
      throw new TypeError("Sponge v2: missing/invalid Version tag");
    }
    const widthTag = compound.get("Width");
    const heightTag = compound.get("Height");
    const lengthTag = compound.get("Length");
    if (
      !(widthTag instanceof nbt.Short) ||
      !(heightTag instanceof nbt.Short) ||
      !(lengthTag instanceof nbt.Short)
    ) {
      throw new TypeError("Sponge v2: Width/Height/Length must be Short");
    }
    // Offset is optional per spec; default to [0, 0, 0] when missing.
    let offsetArr: [number, number, number] = [0, 0, 0];
    const offsetTag = compound.get("Offset");
    if (offsetTag !== undefined) {
      if (!(offsetTag instanceof nbt.IntArray)) {
        throw new TypeError("Sponge v2: Offset must be IntArray");
      }
      const arr = offsetTag.toObject() as number[];
      if (arr.length < 3) {
        throw new TypeError("Sponge v2: Offset must have 3 elements");
      }
      offsetArr = [arr[0], arr[1], arr[2]];
    }
    const dataVersionTag = compound.get("DataVersion");
    if (!(dataVersionTag instanceof nbt.Int)) {
      throw new TypeError("Sponge v2: missing DataVersion");
    }
    const paletteMaxTag = compound.get("PaletteMax");
    if (!(paletteMaxTag instanceof nbt.Int)) {
      throw new TypeError("Sponge v2: missing PaletteMax");
    }

    const paletteTag = compound.get("Palette");
    if (!(paletteTag instanceof nbt.Compound)) {
      throw new TypeError("Sponge v2: Palette must be Compound");
    }
    const palette = new Map<string, number>();
    for (const [k, v] of paletteTag) {
      if (!(v instanceof nbt.Int)) {
        throw new TypeError(`Sponge v2: Palette[${k}] must be Int`);
      }
      palette.set(k, v.value);
    }

    const blockDataTag = compound.get("BlockData");
    if (!(blockDataTag instanceof nbt.ByteArray)) {
      throw new TypeError("Sponge v2: BlockData must be ByteArray");
    }
    const blockData = decodeVarintArray(blockDataTag.toObject() as number[]);
    const expectedBlocks = widthTag.value * heightTag.value * lengthTag.value;
    if (blockData.length !== expectedBlocks) {
      throw new Error(
        `Sponge v2: BlockData decoded to ${blockData.length} entries, expected ${expectedBlocks}`,
      );
    }

    const blockEntities: Entity[] = [];
    const blockEntitiesTag = compound.get("BlockEntities");
    if (blockEntitiesTag instanceof nbt.NbtList) {
      for (const item of blockEntitiesTag.items) {
        if (!(item instanceof nbt.Compound)) continue;
        const chunkShape = v2BlockEntityToChunkShape(item);
        // Fall back to raw compound if translation fails (e.g. third-party
        // writers that don't follow the v2 spec). Better to surface a
        // half-shaped TE than to drop it silently.
        blockEntities.push(new Entity(chunkShape ?? item));
      }
    }

    const entities: Entity[] = [];
    const entitiesTag = compound.get("Entities");
    if (entitiesTag instanceof nbt.NbtList) {
      for (const item of entitiesTag.items) {
        if (item instanceof nbt.Compound) {
          entities.push(new Entity(item));
        }
      }
    }

    let biomePaletteMax = 0;
    const biomePaletteMaxTag = compound.get("BiomePaletteMax");
    if (biomePaletteMaxTag instanceof nbt.Int) {
      biomePaletteMax = biomePaletteMaxTag.value;
    }
    const biomePalette = new Map<string, number>();
    const biomePaletteTag = compound.get("BiomePalette");
    if (biomePaletteTag instanceof nbt.Compound) {
      for (const [k, v] of biomePaletteTag) {
        if (v instanceof nbt.Int) biomePalette.set(k, v.value);
      }
    }

    const metadataTag = compound.get("Metadata");
    const metadata =
      metadataTag instanceof nbt.Compound
        ? SpongeSchematicMetadata.fromCompound(metadataTag)
        : new SpongeSchematicMetadata();

    return new SpongeSchematicV2({
      Version: versionTag.value,
      Metadata: metadata,
      Width: widthTag.value,
      Height: heightTag.value,
      Length: lengthTag.value,
      Offset: [offsetArr[0], offsetArr[1], offsetArr[2]],
      DataVersion: dataVersionTag.value,
      PaletteMax: paletteMaxTag.value,
      Palette: palette,
      BlockData: blockData,
      BlockEntities: blockEntities,
      Entities: entities,
      BiomePaletteMax: biomePaletteMax,
      BiomePalette: biomePalette,
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
    entries.set("DataVersion", new nbt.Int(this.DataVersion));
    entries.set("PaletteMax", new nbt.Int(this.PaletteMax));

    const paletteEntries = new Map<string, nbt.NbtTag>();
    for (const [k, v] of this.Palette) {
      paletteEntries.set(k, new nbt.Int(v));
    }
    entries.set("Palette", new nbt.Compound(paletteEntries));

    entries.set(
      "BlockData",
      new nbt.ByteArray(encodeVarintArray(this.BlockData)),
    );

    // Always emit BlockEntities and Entities (even when empty). The spec says
    // they're optional, but in practice some Sponge readers (incl. the
    // reference implementation) bail with "Missing tag BlockEntities" when the
    // tag is absent. Empty NBT lists are cheap.
    //
    // BlockEntities are stored internally as chunk-shape (id/x/y/z) per the
    // read-side normalization in fromCompound. Translate back to v2 wire shape
    // (Id/Pos: IntArray + flat extras) on write so the output is spec-valid.
    const blockEntityCompounds: nbt.Compound[] = [];
    for (const e of this.BlockEntities) {
      const c = e.toCompound();
      const v2 = chunkShapeToV2BlockEntity(c);
      // Fall back to the raw compound if translation fails (e.g. third-party
      // input that didn't follow chunk-shape conventions). Better to surface
      // a half-shaped TE than to drop it silently.
      blockEntityCompounds.push(v2 ?? c);
    }
    entries.set("BlockEntities", new nbt.NbtList(blockEntityCompounds));
    entries.set(
      "Entities",
      new nbt.NbtList(this.Entities.map((e) => e.toCompound())),
    );

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
      const stateIdx = this.BlockData[i];
      let idx = i;
      const x = (idx % this.Width) - this.Offset[0];
      idx = (idx - (idx % this.Width)) / this.Width;
      const z = (idx % this.Length) - this.Offset[1];
      const y = (idx - (idx % this.Length)) / this.Length - this.Offset[2];

      const state = palette.get(stateIdx);
      if (!state) continue;
      if (state.Name === "minecraft:air") continue;

      const pos = new BlockPos(x, y, z);
      blocks.set(posKey(pos), new Block(pos, state));
    }
    return blocks;
  }

  getEntityMatrix(): Map<string, Entity> {
    const out = new Map<string, Entity>();
    for (const e of this.Entities) out.set(posKey(e.pos), e);
    return out;
  }

  getTileEntityMatrix(): Map<string, Entity> {
    // BlockEntities are stored in chunk-shape (id/x/y/z) after read-time
    // translation, so we can key by x/y/z directly. The previous version went
    // through Entity.blockPos, which assumes Pos: NbtList<Double> (entity
    // format), so every TE collapsed to (0,0,0) and only one survived the map.
    const out = new Map<string, Entity>();
    for (const e of this.BlockEntities) {
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
    try {
      return getVersionFromDataVersion(this.DataVersion);
    } catch {
      return getVersion("1.13.1");
    }
  }

  getDataVersion(): number {
    return this.DataVersion;
  }

  static checkSize(_width: number, _height: number, _length: number): void {
    // No explicit size limit beyond NBT Short range.
  }

  // ── Cross-format conversion ────────────────────────────────────────────

  static fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): SpongeSchematicV2 {
    if (schematic.getRegions().length > 1) {
      throw new Error(
        `Too many regions in source schematic (${schematic.getRegions().length})`,
      );
    }

    const region = schematic.getRegion(0);

    let sourcePalette: BlockState[];
    let sourceBlocks: Block[];
    let sourceTileEntities: Entity[];
    let outputDataVersion: number;
    if (targetVersion) {
      outputDataVersion = targetVersion.dataVersion;
      sourcePalette = region.getTranslatedPalette(targetVersion);
      sourceBlocks = region.getTranslatedBlocks(targetVersion);
      sourceTileEntities = region.getTranslatedTileEntities(targetVersion);
    } else {
      // Use the source's raw DataVersion (not getMinecraftVersion().dataVersion,
      // which collapses unknown versions to the KNOWN_VERSIONS fallback —
      // that's how 1.21.x DataVersions used to get stamped as 1.13.1 on the
      // way out).
      outputDataVersion = schematic.getDataVersion();
      sourcePalette = region.getPalette();
      sourceBlocks = region.getBlocks();
      sourceTileEntities = region.getTileEntities();
    }

    const [width, height, length] = region.getSize();
    const [pos1] = region.getBoundingBox();

    const requiredMods: string[] = [];

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
    const blockData = new Array<number>(total);
    for (let i = 0; i < total; i++) {
      blockData[i] = blocks.has(i) ? blocks.get(i)! : airBlock;
    }

    const palette = new Map<string, number>();
    for (let i = 0; i < sourcePalette.length; i++) {
      palette.set(sourcePalette[i].toString(), i);
    }

    // Tile entities from cross-format sources are already in chunk-shape
    // (id/x/y/z + flat extras), which is also what fromCompound stores
    // internally after read-side normalization. Keep them in that shape so the
    // internal representation is consistent — toCompound handles translation
    // to v2 wire shape (Id/Pos: IntArray) on dump.
    const blockEntities: Entity[] = [...sourceTileEntities];

    return new SpongeSchematicV2({
      Version: 2,
      Metadata: meta,
      Width: width,
      Height: height,
      Length: length,
      Offset: [pos1.x, pos1.y, pos1.z],
      DataVersion: outputDataVersion,
      PaletteMax: sourcePalette.length,
      Palette: palette,
      BlockData: blockData,
      BlockEntities: blockEntities,
    });
  }
}
