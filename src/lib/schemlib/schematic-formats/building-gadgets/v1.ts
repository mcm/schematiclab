// Port of schemlib/schematic_formats/building_gadgets/building_gadgets_v1.py
// (Python) -> TypeScript.
//
// Building Gadgets v1 is the Minecraft-1.14..1.19 template format. Wire format:
// JSON. The JSON has two top-level keys:
//   - `header`: plain JSON metadata (version, mc_version, name, author,
//     bounding_box, material_list)
//   - `body`: base64-encoded gzipped NBT compound holding the block palette
//     (`data`), packed positions (`pos`), an inner `header` and a `serializer`
//     list.
//
// A position-long packs (state << 40) | (x << 24) | (y << 16) | z.

import { Buffer } from "node:buffer";
import * as nbt from "../../nbt";
import { Block, BlockPos, BlockState } from "../../blocks";
import { Entity } from "../../entities";
import { AbstractRegion, AbstractSchematic } from "../abstract";
import {
  MinecraftVersion,
  getVersion,
  posKey,
} from "../version-mapping";

// ── Types ─────────────────────────────────────────────────────────────────

export interface BoundingBox {
  min_x: number;
  min_y: number;
  min_z: number;
  max_x: number;
  max_y: number;
  max_z: number;
}

export interface MaterialListEntry {
  item_type: string;
  count: number;
  item: Record<string, string>;
}

export interface MaterialList {
  root_type: string;
  root_entry: MaterialListEntry[];
}

export interface BuildingGadgetsV1Header {
  version: string;
  mc_version: string;
  name: string;
  author?: string;
  bounding_box: BoundingBox;
  material_list: MaterialList;
}

/**
 * One palette entry from the body's `data` list. `data` is an arbitrary NBT
 * compound (mod-specific block data); we preserve it as-is.
 */
export interface BlockData {
  data: nbt.Compound;
  state: BlockState;
  serializer: number;
}

export interface BodyBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface BodyHeader {
  author?: string;
  bounds: BodyBounds;
  name: string;
}

export interface BuildingGadgetsV1Body {
  data: BlockData[];
  pos: bigint[];
  header: BodyHeader;
  serializer: string[];
}

export interface BuildingGadgetsV1SchematicInit {
  header: BuildingGadgetsV1Header;
  body: BuildingGadgetsV1Body;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function readString(tag: nbt.NbtTag | undefined): string {
  return tag instanceof nbt.StringTag ? tag.value : "";
}

function readInt(tag: nbt.NbtTag | undefined): number {
  if (tag === undefined) return 0;
  const v = (tag as unknown as { value: number | bigint }).value;
  return typeof v === "bigint" ? Number(v) : (v as number);
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

function decodeBody(value: unknown): BuildingGadgetsV1Body {
  if (typeof value !== "string") {
    throw new TypeError("BG v1: body must be a base64 string");
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  const named = nbt.loadNbtFromBytes(bytes);
  return bodyFromCompound(named);
}

function bodyFromCompound(c: nbt.Compound): BuildingGadgetsV1Body {
  // data: List of Compound{ data, state, serializer }
  const data: BlockData[] = [];
  const dataTag = c.get("data");
  if (dataTag instanceof nbt.NbtList) {
    for (const item of dataTag.items) {
      if (!(item instanceof nbt.Compound)) continue;
      const innerDataTag = item.get("data");
      const innerData =
        innerDataTag instanceof nbt.Compound ? innerDataTag : new nbt.Compound();
      const stateTag = item.get("state");
      const state =
        stateTag instanceof nbt.Compound
          ? blockStateFromCompound(stateTag)
          : new BlockState({ Name: "minecraft:air" });
      const serializerTag = item.get("serializer");
      const serializer =
        serializerTag instanceof nbt.Int ? serializerTag.value : 0;
      data.push({ data: innerData, state, serializer });
    }
  }

  // pos: List of Long
  const pos: bigint[] = [];
  const posTag = c.get("pos");
  if (posTag instanceof nbt.NbtList) {
    for (const item of posTag.items) {
      if (item instanceof nbt.Long) pos.push(item.value);
    }
  }

  // header: Compound
  const headerTag = c.get("header");
  let header: BodyHeader = {
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
    name: "",
  };
  if (headerTag instanceof nbt.Compound) {
    const boundsTag = headerTag.get("bounds");
    const bounds: BodyBounds = {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 0,
      maxY: 0,
      maxZ: 0,
    };
    if (boundsTag instanceof nbt.Compound) {
      bounds.minX = readInt(boundsTag.get("minX"));
      bounds.minY = readInt(boundsTag.get("minY"));
      bounds.minZ = readInt(boundsTag.get("minZ"));
      bounds.maxX = readInt(boundsTag.get("maxX"));
      bounds.maxY = readInt(boundsTag.get("maxY"));
      bounds.maxZ = readInt(boundsTag.get("maxZ"));
    }
    header = {
      author: headerTag.get("author") instanceof nbt.StringTag
        ? (headerTag.get("author") as nbt.StringTag).value
        : undefined,
      bounds,
      name: readString(headerTag.get("name")),
    };
  }

  // serializer: List of String
  const serializer: string[] = [];
  const serializerTag = c.get("serializer");
  if (serializerTag instanceof nbt.NbtList) {
    for (const item of serializerTag.items) {
      if (item instanceof nbt.StringTag) serializer.push(item.value);
    }
  }

  return { data, pos, header, serializer };
}

function headerFromJson(value: unknown): BuildingGadgetsV1Header {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("BG v1: header must be an object");
  }
  const v = value as Record<string, unknown>;
  const bboxRaw = v.bounding_box;
  if (typeof bboxRaw !== "object" || bboxRaw === null) {
    throw new TypeError("BG v1: header.bounding_box must be an object");
  }
  const bb = bboxRaw as Record<string, unknown>;
  const matRaw = v.material_list;
  let materialList: MaterialList = { root_type: "", root_entry: [] };
  if (typeof matRaw === "object" && matRaw !== null) {
    const m = matRaw as Record<string, unknown>;
    const rootEntries: MaterialListEntry[] = [];
    if (Array.isArray(m.root_entry)) {
      for (const e of m.root_entry as Array<Record<string, unknown>>) {
        rootEntries.push({
          item_type: typeof e.item_type === "string" ? e.item_type : "",
          count: typeof e.count === "number" ? e.count : 0,
          item: (typeof e.item === "object" && e.item !== null
            ? (e.item as Record<string, string>)
            : {}) as Record<string, string>,
        });
      }
    }
    materialList = {
      root_type: typeof m.root_type === "string" ? m.root_type : "",
      root_entry: rootEntries,
    };
  }
  return {
    version: typeof v.version === "string" ? v.version : "",
    mc_version: typeof v.mc_version === "string" ? v.mc_version : "",
    name: typeof v.name === "string" ? v.name : "",
    author: typeof v.author === "string" ? v.author : undefined,
    bounding_box: {
      min_x: Number(bb.min_x ?? 0),
      min_y: Number(bb.min_y ?? 0),
      min_z: Number(bb.min_z ?? 0),
      max_x: Number(bb.max_x ?? 0),
      max_y: Number(bb.max_y ?? 0),
      max_z: Number(bb.max_z ?? 0),
    },
    material_list: materialList,
  };
}

// ── Position packing ──────────────────────────────────────────────────────

/**
 * Decode a packed position-long into `(pos, stateIdx)`.
 * Layout (high to low bits):
 *   bits 40..63: state index (24 bits)
 *   bits 24..39: x (16 bits)
 *   bits 16..23: y (8 bits)
 *   bits  0..15: z (16 bits)
 */
export function parseBlockPos(v: bigint): { pos: BlockPos; state: number } {
  const x = Number((v >> 24n) & 0xffffn);
  const y = Number((v >> 16n) & 0xffn);
  const z = Number(v & 0xffffn);
  const state = Number((v >> 40n) & 0xffffffn);
  return { pos: new BlockPos(x, y, z), state };
}

/** Inverse of `parseBlockPos`. */
export function unparseBlockPos(pos: BlockPos, state: number): bigint {
  let v = (BigInt(state) & 0xffffffn) << 40n;
  v |= (BigInt(pos.x) & 0xffffn) << 24n;
  v |= (BigInt(pos.y) & 0xffn) << 16n;
  v |= BigInt(pos.z) & 0xffffn;
  return v;
}

// ── BuildingGadgetsV1Schematic ────────────────────────────────────────────

export class BuildingGadgetsV1Schematic
  extends AbstractRegion
  implements AbstractSchematic
{
  static readonly MAX_WIDTH = 65535;
  static readonly MAX_HEIGHT = 255;
  static readonly MAX_LENGTH = 65535;

  readonly header: BuildingGadgetsV1Header;
  readonly body: BuildingGadgetsV1Body;

  constructor(init: BuildingGadgetsV1SchematicInit) {
    super();
    this.header = init.header;
    this.body = init.body;
  }

  // ── Format metadata ────────────────────────────────────────────────────

  static getFormatDescription(): string {
    return "Building Gadgets (Minecraft 1.14-1.19) Template";
  }

  static getDefaultExtension(): string {
    return "txt";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.17.1");
  }

  // ── Load / dump ────────────────────────────────────────────────────────

  static schematicLoad(obj: string | Uint8Array): BuildingGadgetsV1Schematic {
    const text =
      typeof obj === "string" ? obj : new TextDecoder("utf-8").decode(obj);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError("BG v1: top-level JSON must be an object");
    }
    const obj2 = parsed as Record<string, unknown>;
    const header = headerFromJson(obj2.header);
    const body = decodeBody(obj2.body);
    return new BuildingGadgetsV1Schematic({ header, body });
  }

  /**
   * Best-effort dump back to JSON. The body is re-NBT-encoded, gzipped and
   * base64-encoded; the header is straight JSON.
   */
  schematicDump(): string {
    const dataEntries = this.body.data.map((d) =>
      new nbt.Compound({
        data: d.data,
        state: d.state.toCompound(),
        serializer: new nbt.Int(d.serializer),
      }),
    );
    const bodyCompound = new nbt.Compound({
      data: new nbt.NbtList(dataEntries),
      pos: new nbt.NbtList(this.body.pos.map((p) => new nbt.Long(p))),
      header: new nbt.Compound({
        ...(this.body.header.author !== undefined
          ? { author: new nbt.StringTag(this.body.header.author) }
          : {}),
        bounds: new nbt.Compound({
          minX: new nbt.Int(this.body.header.bounds.minX),
          minY: new nbt.Int(this.body.header.bounds.minY),
          minZ: new nbt.Int(this.body.header.bounds.minZ),
          maxX: new nbt.Int(this.body.header.bounds.maxX),
          maxY: new nbt.Int(this.body.header.bounds.maxY),
          maxZ: new nbt.Int(this.body.header.bounds.maxZ),
        }),
        name: new nbt.StringTag(this.body.header.name),
      }),
      serializer: new nbt.NbtList(
        this.body.serializer.map((s) => new nbt.StringTag(s)),
      ),
    });
    const named = new nbt.Named({ "": bodyCompound });
    const bytes = named.toBytes({ compress: true });
    const base64 = Buffer.from(bytes).toString("base64");
    return JSON.stringify({ header: this.header, body: base64 });
  }

  // ── Region API ─────────────────────────────────────────────────────────

  getBlockMatrix(): Map<string, Block> {
    const palette = this.body.data.map((d) => d.state);
    const blocks = new Map<string, Block>();
    for (const posLong of this.body.pos) {
      const { pos, state: stateIdx } = parseBlockPos(posLong);
      const state = palette[stateIdx];
      if (!state) continue;
      blocks.set(posKey(pos), new Block(pos, state));
    }
    return blocks;
  }

  getEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getTileEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getBoundingBox(): [BlockPos, BlockPos] {
    const bb = this.header.bounding_box;
    return [
      new BlockPos(bb.min_x, bb.min_y, bb.min_z),
      new BlockPos(bb.max_x, bb.max_y, bb.max_z),
    ];
  }

  getOrigin(): BlockPos {
    const bb = this.header.bounding_box;
    return new BlockPos(bb.min_x, bb.min_y, bb.min_z);
  }

  getSize(): [number, number, number] {
    const bb = this.header.bounding_box;
    return [
      bb.max_x - bb.min_x + 1,
      bb.max_y - bb.min_y + 1,
      bb.max_z - bb.min_z + 1,
    ];
  }

  // ── Schematic API ──────────────────────────────────────────────────────

  getMetadata(): Record<string, unknown> {
    return {
      author: this.header.author,
      name: this.header.name,
      serializers: this.body.serializer,
    };
  }

  getName(): string {
    return this.header.name || "unknown building gadgets v1 schematic";
  }

  getRegions(): AbstractRegion[] {
    return [this];
  }

  getRegion(idx: number): AbstractRegion {
    return this.getRegions()[idx];
  }

  getMinecraftVersion(): MinecraftVersion {
    try {
      return getVersion(this.header.mc_version);
    } catch {
      return getVersion("1.16.5");
    }
  }

  static checkSize(width: number, height: number, length: number): void {
    if (width > BuildingGadgetsV1Schematic.MAX_WIDTH) {
      throw new Error(
        `Width axis too big, ${width} > ${BuildingGadgetsV1Schematic.MAX_WIDTH}`,
      );
    }
    if (height > BuildingGadgetsV1Schematic.MAX_HEIGHT) {
      throw new Error(
        `Height axis too big, ${height} > ${BuildingGadgetsV1Schematic.MAX_HEIGHT}`,
      );
    }
    if (length > BuildingGadgetsV1Schematic.MAX_LENGTH) {
      throw new Error(
        `Length axis too big, ${length} > ${BuildingGadgetsV1Schematic.MAX_LENGTH}`,
      );
    }
  }

  static fromSchematic(
    _schematic: AbstractSchematic,
    _targetVersion: MinecraftVersion | null,
  ): BuildingGadgetsV1Schematic {
    throw new Error("not implemented");
  }
}
