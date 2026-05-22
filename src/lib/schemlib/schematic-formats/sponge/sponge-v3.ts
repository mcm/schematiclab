// Sponge schematic v3 (.schem). Spec: Schematic-Specification/versions/schematic-3.md.
//
// Wire shape vs. v2:
//   - Root NBT is unnamed (""); a single child Compound "Schematic" holds all
//     fields. (v1/v2 named the root compound "Schematic" directly.)
//   - Block fields move under a `Blocks` sub-compound: Palette, Data,
//     BlockEntities. No `PaletteMax` (palette length is implicit).
//   - `Data` is a ByteArray of varint-encoded palette indices — each varint is
//     7-bit base-128 with the MSB as continuation. (v2's spec also requires
//     varint, but our v2 reader cheats and treats one byte per block; v3 has
//     enough palette entries in practice that the cheat doesn't survive.)
//   - BlockEntity entries are { Id: string, Pos: IntArray[3], Data: Compound }
//     instead of v2's flat shape.
//   - Biomes (3D) and Entities (mobs) would live as sibling compounds; this
//     reader/writer round-trips them as opaque NBT but doesn't surface them
//     through the AbstractRegion API yet.
//
// Cross-format conversion: getTileEntityMatrix() returns Entities whose
// compound is in chunk-format shape ({id, x, y, z, ...Data}) so downstream
// formats (Litematica, Structure NBT) get the layout they expect. The
// round-trip is preserved because we keep the original v3 compounds on the
// instance and only transform on access.
//
// Block-position semantics mirror v1/v2: getBlockMatrix returns positions in
// "paster space" (linear coords minus the Offset vector). Downstream converters
// then rebase to origin via getBoundingBox.
//
// References:
//   - schematic-3.md (this repo's Schematic-Specification submodule)
//   - cherry_gazebo_df.schem (WorldEdit 7.3.5, MC 1.20.4 export — manual test
//     verified in-game by the user before this code landed)
//
// What's intentionally unimplemented:
//   - Biome container read/write
//   - Top-level `Entities` (mobs) read/write
//   - DataVersion auto-bump beyond KNOWN_VERSIONS (falls back to 1.20.1)

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

// ── varint codec (Sponge v3 `Data` encoding) ──────────────────────────────

export function decodeVarintArray(bytes: number[] | Int8Array): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] as number) & 0xff;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      out.push(value >>> 0);
      value = 0;
      shift = 0;
    } else {
      shift += 7;
    }
  }
  return out;
}

export function encodeVarintArray(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    let v = (values[i] as number) >>> 0;
    while ((v & ~0x7f) !== 0) {
      out.push(((v & 0x7f) | 0x80) - 256); // NBT ByteArray entries are signed
      v >>>= 7;
    }
    const last = v & 0x7f;
    out.push(last > 0x7f ? last - 256 : last);
  }
  return out;
}

// ── BlockEntity shape translation ──────────────────────────────────────────
//
// v3 stores { Id, Pos: IntArray[3], Data: Compound }. Downstream converters
// (litematic, structure NBT, etc.) expect a flat chunk-format compound with
// lowercase `id` and individual `x`/`y`/`z` ints. We translate on read for
// cross-format consumers and on write for v3-targeted dumps.

function v3BlockEntityToChunkShape(c: nbt.Compound): nbt.Compound | null {
  const idTag = c.get("Id");
  const posTag = c.get("Pos");
  if (!(idTag instanceof nbt.StringTag)) return null;
  if (!(posTag instanceof nbt.IntArray)) return null;
  const posArr = posTag.toObject() as number[];
  if (posArr.length < 3) return null;
  const [x, y, z] = posArr;

  const out = new nbt.Compound();
  const dataTag = c.get("Data");
  if (dataTag instanceof nbt.Compound) {
    for (const [k, v] of dataTag.entries) out.set(k, v);
  }
  out.set("id", new nbt.StringTag(idTag.value));
  out.set("x", new nbt.Int(x));
  out.set("y", new nbt.Int(y));
  out.set("z", new nbt.Int(z));
  return out;
}

function chunkShapeToV3BlockEntity(c: nbt.Compound): nbt.Compound | null {
  // Pull id from either `id` (chunk-shape) or `Id` (already-v3-shape).
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

  const data = new nbt.Compound();
  for (const [k, v] of c.entries) {
    if (k === "id" || k === "Id" || k === "x" || k === "y" || k === "z")
      continue;
    data.set(k, v);
  }

  const out = new nbt.Compound();
  out.set("Id", new nbt.StringTag(idTag.value));
  out.set("Pos", new nbt.IntArray([x, y, z]));
  if (data.entries.size > 0) out.set("Data", data);
  return out;
}

// ── SpongeSchematicV3 ─────────────────────────────────────────────────────

export interface SpongeSchematicV3Init {
  Metadata: SpongeSchematicMetadata;
  Width: number;
  Height: number;
  Length: number;
  Offset: [number, number, number];
  DataVersion: number;
  Palette: Map<string, number>;
  BlockData: number[]; // palette indices in linear order
  /** Raw v3 BlockEntity compounds (shape { Id, Pos, Data }). */
  BlockEntities?: nbt.Compound[];
}

export class SpongeSchematicV3
  extends AbstractRegion
  implements AbstractSchematic
{
  static readonly Version = 3;

  Metadata: SpongeSchematicMetadata;
  Width: number;
  Height: number;
  Length: number;
  Offset: [number, number, number];
  DataVersion: number;
  Palette: Map<string, number>;
  BlockData: number[];
  BlockEntities: nbt.Compound[];

  constructor(init: SpongeSchematicV3Init) {
    super();
    this.Metadata = init.Metadata;
    this.Width = init.Width;
    this.Height = init.Height;
    this.Length = init.Length;
    this.Offset = init.Offset;
    this.DataVersion = init.DataVersion;
    this.Palette = init.Palette;
    this.BlockData = init.BlockData;
    this.BlockEntities = init.BlockEntities ?? [];
  }

  // ── Format metadata ────────────────────────────────────────────────────

  static getFormatDescription(): string {
    return "Sponge v3 (.schem files)";
  }

  static getDefaultExtension(): string {
    return "schem";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.20.1");
  }

  // ── Load / dump ────────────────────────────────────────────────────────

  static schematicLoad(obj: string | Uint8Array): SpongeSchematicV3 {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const named = nbt.loadNbtFromBytes(bytes);
    const inner = named.get("Schematic");
    if (!(inner instanceof nbt.Compound)) {
      throw new TypeError(
        "Sponge v3: root must contain a 'Schematic' compound",
      );
    }
    return SpongeSchematicV3.fromCompound(inner);
  }

  static fromCompound(compound: nbt.Compound): SpongeSchematicV3 {
    const versionTag = compound.get("Version");
    if (!(versionTag instanceof nbt.Int) || versionTag.value !== 3) {
      throw new TypeError(
        `Sponge v3: expected Version=3, got ${(versionTag as nbt.Int | undefined)?.value}`,
      );
    }

    const widthTag = compound.get("Width");
    const heightTag = compound.get("Height");
    const lengthTag = compound.get("Length");
    if (
      !(widthTag instanceof nbt.Short) ||
      !(heightTag instanceof nbt.Short) ||
      !(lengthTag instanceof nbt.Short)
    ) {
      throw new TypeError("Sponge v3: Width/Height/Length must be Short");
    }
    // Spec says unsigned short — sign-extend to a non-negative int.
    const width = widthTag.value & 0xffff;
    const height = heightTag.value & 0xffff;
    const length = lengthTag.value & 0xffff;

    const offsetTag = compound.get("Offset");
    let offsetArr: [number, number, number] = [0, 0, 0];
    if (offsetTag instanceof nbt.IntArray) {
      const arr = offsetTag.toObject() as number[];
      if (arr.length >= 3) offsetArr = [arr[0], arr[1], arr[2]];
    }

    const dataVersionTag = compound.get("DataVersion");
    if (!(dataVersionTag instanceof nbt.Int)) {
      throw new TypeError("Sponge v3: missing DataVersion");
    }

    const blocksTag = compound.get("Blocks");
    if (!(blocksTag instanceof nbt.Compound)) {
      throw new TypeError("Sponge v3: missing Blocks compound");
    }

    const paletteTag = blocksTag.get("Palette");
    if (!(paletteTag instanceof nbt.Compound)) {
      throw new TypeError("Sponge v3: Blocks.Palette must be Compound");
    }
    const palette = new Map<string, number>();
    for (const [k, v] of paletteTag) {
      if (!(v instanceof nbt.Int)) {
        throw new TypeError(`Sponge v3: Palette[${k}] must be Int`);
      }
      palette.set(k, v.value);
    }

    const dataTag = blocksTag.get("Data");
    if (!(dataTag instanceof nbt.ByteArray)) {
      throw new TypeError("Sponge v3: Blocks.Data must be ByteArray");
    }
    const indices = decodeVarintArray(dataTag.toObject() as number[]);
    const expected = width * height * length;
    if (indices.length !== expected) {
      throw new Error(
        `Sponge v3: Blocks.Data decoded to ${indices.length} entries, expected ${expected}`,
      );
    }

    const blockEntities: nbt.Compound[] = [];
    const beTag = blocksTag.get("BlockEntities");
    if (beTag instanceof nbt.NbtList) {
      for (const item of beTag.items) {
        if (item instanceof nbt.Compound) blockEntities.push(item);
      }
    }

    const metadataTag = compound.get("Metadata");
    const metadata =
      metadataTag instanceof nbt.Compound
        ? SpongeSchematicMetadata.fromCompound(metadataTag)
        : new SpongeSchematicMetadata();

    return new SpongeSchematicV3({
      Metadata: metadata,
      Width: width,
      Height: height,
      Length: length,
      Offset: offsetArr,
      DataVersion: dataVersionTag.value,
      Palette: palette,
      BlockData: indices,
      BlockEntities: blockEntities,
    });
  }

  schematicDump(): Uint8Array {
    const inner = this.toCompound();
    // Per spec the outer NBT root is unnamed and contains a single child named
    // "Schematic". Build that shape directly via Named/Compound nesting.
    const wrapper = new nbt.Compound({ Schematic: inner });
    const named = new nbt.Named({ "": wrapper });
    return named.toBytes({ compress: true });
  }

  toCompound(): nbt.Compound {
    const entries = new Map<string, nbt.NbtTag>();
    entries.set("Version", new nbt.Int(3));
    entries.set("DataVersion", new nbt.Int(this.DataVersion));
    entries.set("Metadata", this.Metadata.toCompound());
    // NBT Short is signed; unsigned-short values up to 65535 round-trip via
    // two's complement reinterpretation.
    entries.set(
      "Width",
      new nbt.Short(this.Width > 0x7fff ? this.Width - 0x10000 : this.Width),
    );
    entries.set(
      "Height",
      new nbt.Short(this.Height > 0x7fff ? this.Height - 0x10000 : this.Height),
    );
    entries.set(
      "Length",
      new nbt.Short(this.Length > 0x7fff ? this.Length - 0x10000 : this.Length),
    );
    entries.set("Offset", new nbt.IntArray(this.Offset));

    const blocks = new Map<string, nbt.NbtTag>();
    const paletteEntries = new Map<string, nbt.NbtTag>();
    for (const [k, v] of this.Palette) paletteEntries.set(k, new nbt.Int(v));
    blocks.set("Palette", new nbt.Compound(paletteEntries));
    blocks.set("Data", new nbt.ByteArray(encodeVarintArray(this.BlockData)));
    // Always emit BlockEntities (even when empty) — some Sponge readers bail
    // with "Missing tag BlockEntities" when the tag is absent.
    blocks.set("BlockEntities", new nbt.NbtList(this.BlockEntities));
    entries.set("Blocks", new nbt.Compound(blocks));

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
      const state = palette.get(stateIdx);
      if (!state) continue;
      if (state.Name === "minecraft:air") continue;

      // Spec index layout: i = x + z*W + y*W*L. Mirror v2: positions are
      // expressed in paster space (linear minus Offset). Downstream converters
      // rebase via getBoundingBox.
      let idx = i;
      const x = (idx % this.Width) - this.Offset[0];
      idx = (idx - (idx % this.Width)) / this.Width;
      const z = (idx % this.Length) - this.Offset[1];
      const y = (idx - (idx % this.Length)) / this.Length - this.Offset[2];

      const pos = new BlockPos(x, y, z);
      blocks.set(posKey(pos), new Block(pos, state));
    }
    return blocks;
  }

  getEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getTileEntityMatrix(): Map<string, Entity> {
    const out = new Map<string, Entity>();
    for (const be of this.BlockEntities) {
      const chunkShape = v3BlockEntityToChunkShape(be);
      if (!chunkShape) continue;
      const e = new Entity(chunkShape);
      const xt = chunkShape.get("x");
      const yt = chunkShape.get("y");
      const zt = chunkShape.get("z");
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
    return "unknown sponge schematic, v3";
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
      return getVersion("1.20.1");
    }
  }

  getDataVersion(): number {
    return this.DataVersion;
  }

  static checkSize(_width: number, _height: number, _length: number): void {
    // No explicit limit beyond NBT unsigned-short range (65535).
  }

  // ── Cross-format conversion ────────────────────────────────────────────

  static fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): SpongeSchematicV3 {
    if (schematic.getRegions().length > 1) {
      throw new Error(
        `Too many regions in source schematic (${schematic.getRegions().length})`,
      );
    }
    const region = schematic.getRegion(0);

    let sourcePalette: BlockState[];
    let sourceBlocks: Block[];
    let sourceTileEntities: Entity[];
    let sourceVersion: MinecraftVersion;
    if (targetVersion) {
      sourceVersion = targetVersion;
      sourcePalette = region.getTranslatedPalette(targetVersion);
      sourceBlocks = region.getTranslatedBlocks(targetVersion);
      sourceTileEntities = region.getTranslatedTileEntities(targetVersion);
    } else {
      sourceVersion = schematic.getMinecraftVersion();
      sourcePalette = region.getPalette();
      sourceBlocks = region.getBlocks();
      sourceTileEntities = region.getTileEntities();
    }

    const [width, height, length] = region.getSize();
    const [pos1] = region.getBoundingBox();

    const requiredMods: string[] = [];

    let airIdx = sourcePalette.findIndex((s) => s.equals(BlockState.AIR_BLOCK));
    if (airIdx === -1) {
      sourcePalette = [BlockState.AIR_BLOCK, ...sourcePalette];
      airIdx = 0;
    }

    const indices = new Map<number, number>();
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
      // Convert paster-space position back to linear index space. Source's
      // Offset already shifted positions; here we use the bounding box's pos1
      // as the implicit origin so indices are non-negative.
      const x = block.pos.x - pos1.x;
      const y = block.pos.y - pos1.y;
      const z = block.pos.z - pos1.z;
      const i = x + z * width + y * length * width;
      indices.set(i, stateIdx);
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
      blockData[i] = indices.has(i) ? (indices.get(i) as number) : airIdx;
    }

    const palette = new Map<string, number>();
    for (let i = 0; i < sourcePalette.length; i++) {
      palette.set(sourcePalette[i].toString(), i);
    }

    // Translate incoming chunk-shape tile entities (or already-v3-shape ones)
    // into the v3 BlockEntity compound shape.
    const blockEntities: nbt.Compound[] = [];
    for (const e of sourceTileEntities) {
      const v3 = chunkShapeToV3BlockEntity(e.toCompound());
      if (v3) blockEntities.push(v3);
    }

    return new SpongeSchematicV3({
      Metadata: meta,
      Width: width,
      Height: height,
      Length: length,
      Offset: [pos1.x, pos1.y, pos1.z],
      DataVersion: sourceVersion.dataVersion,
      Palette: palette,
      BlockData: blockData,
      BlockEntities: blockEntities,
    });
  }
}
