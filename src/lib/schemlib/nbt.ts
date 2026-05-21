// Port of schemlib/nbt.py (Python) -> TypeScript.
//
// NBT (Named Binary Tag) is Minecraft's binary serialization format.
// Tag wire format: all numbers are big-endian. A Compound is a sequence of
// (tag_type_id: int8, name: String, payload) until tag_type_id == 0 (TAG_End).
// A "Named" tag wraps a single (name, Compound) at the root of an NBT file.

import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

// ── Tag type IDs ───────────────────────────────────────────────────────────

export const TagId = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const;

// ── Binary reader / writer ────────────────────────────────────────────────

export class BinaryReader {
  readonly view: DataView;
  pos = 0;

  constructor(public readonly buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  get eof(): boolean {
    return this.pos >= this.buffer.length;
  }

  readInt8(): number {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUint8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  readInt16(): number {
    const v = this.view.getInt16(this.pos, false);
    this.pos += 2;
    return v;
  }

  readUint16(): number {
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }

  readInt32(): number {
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readInt64(): bigint {
    const v = this.view.getBigInt64(this.pos, false);
    this.pos += 8;
    return v;
  }

  readUint64(): bigint {
    const v = this.view.getBigUint64(this.pos, false);
    this.pos += 8;
    return v;
  }

  readFloat32(): number {
    const v = this.view.getFloat32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readFloat64(): number {
    const v = this.view.getFloat64(this.pos, false);
    this.pos += 8;
    return v;
  }

  readBytes(length: number): Uint8Array {
    const slice = this.buffer.slice(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }
}

export class BinaryWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  private push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  writeInt8(value: number): this {
    const buf = new Uint8Array(1);
    new DataView(buf.buffer).setInt8(0, value);
    this.push(buf);
    return this;
  }

  writeUint8(value: number): this {
    const buf = new Uint8Array(1);
    new DataView(buf.buffer).setUint8(0, value);
    this.push(buf);
    return this;
  }

  writeInt16(value: number): this {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setInt16(0, value, false);
    this.push(buf);
    return this;
  }

  writeUint16(value: number): this {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, false);
    this.push(buf);
    return this;
  }

  writeInt32(value: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setInt32(0, value, false);
    this.push(buf);
    return this;
  }

  writeUint32(value: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, false);
    this.push(buf);
    return this;
  }

  writeInt64(value: bigint): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigInt64(0, value, false);
    this.push(buf);
    return this;
  }

  writeUint64(value: bigint): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, value, false);
    this.push(buf);
    return this;
  }

  writeFloat32(value: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setFloat32(0, value, false);
    this.push(buf);
    return this;
  }

  writeFloat64(value: number): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, value, false);
    this.push(buf);
    return this;
  }

  writeBytes(bytes: Uint8Array): this {
    this.push(bytes);
    return this;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

// ── Tag base class + registry ─────────────────────────────────────────────

export type AnyNBT =
  | Byte
  | Short
  | Int
  | Long
  | Float
  | Double
  | ByteArray
  | StringTag
  | NbtList<NbtTag>
  | Compound<NbtTag>
  | IntArray
  | LongArray
  | Named;

export type ArrayTag = ByteArray | IntArray | LongArray;

export abstract class NbtTag {
  static readonly tagTypeId: number;
  abstract toObject(): unknown;
  abstract toBytes(): Uint8Array;
  abstract equals(other: unknown): boolean;
  abstract toString(): string;

  static fromBytes(bytes: Uint8Array): NbtTag {
    return (this as unknown as {
      fromReader(r: BinaryReader): NbtTag;
    }).fromReader(new BinaryReader(bytes));
  }

  static fromReader(_reader: BinaryReader): NbtTag {
    throw new Error("not implemented");
  }
}

// The registry stores tag classes. We use a structural type rather than
// `typeof NbtTag` because concrete tag classes (e.g. `Byte(value)`) have
// non-zero-arg constructors that don't satisfy `abstract new () => NbtTag`.
// What we actually need from a registered class is `fromReader` + `tagTypeId`.
export type TagClass = (new (...args: any[]) => NbtTag) & {
  fromReader(reader: BinaryReader): NbtTag;
  tagTypeId?: number;
};

const tagTypeRegistry = new Map<number, TagClass>();

export function registerTagType<T extends TagClass>(id: number, tag: T, opts: { overwrite?: boolean } = {}): T {
  if (tagTypeRegistry.has(id) && !opts.overwrite) {
    throw new Error(`${tagTypeRegistry.get(id)!.name} already registered for id ${id}`);
  }
  tagTypeRegistry.set(id, tag);
  Object.defineProperty(tag, "tagTypeId", { value: id, writable: false, configurable: true });
  return tag;
}

export function getTagType(id: number): TagClass | undefined {
  return tagTypeRegistry.get(id);
}

// Expose for tests
export const _tagTypeRegistry = tagTypeRegistry;

// ── Number-backed tags ────────────────────────────────────────────────────

abstract class _NumberTag extends NbtTag {
  constructor(public readonly value: number) {
    super();
  }
  toObject(): number {
    return this.value;
  }
  toString(): string {
    return `${this.constructor.name}(${this.value})`;
  }
  equals(other: unknown): boolean {
    if (other instanceof _NumberTag) return this.value === other.value;
    return this.value === other;
  }
}

export class Byte extends _NumberTag {
  toBytes(): Uint8Array {
    return new BinaryWriter().writeInt8(this.value).toBytes();
  }
  static fromReader(reader: BinaryReader): Byte {
    return new Byte(reader.readInt8());
  }
}
registerTagType(TagId.Byte, Byte);

export class Short extends _NumberTag {
  toBytes(): Uint8Array {
    return new BinaryWriter().writeInt16(this.value).toBytes();
  }
  static fromReader(reader: BinaryReader): Short {
    return new Short(reader.readInt16());
  }
}
registerTagType(TagId.Short, Short);

export class Int extends _NumberTag {
  toBytes(): Uint8Array {
    return new BinaryWriter().writeInt32(this.value).toBytes();
  }
  static fromReader(reader: BinaryReader): Int {
    return new Int(reader.readInt32());
  }
}
registerTagType(TagId.Int, Int);

// Long uses bigint internally to preserve full 64-bit range. The constructor
// accepts number or bigint for convenience.
export class Long extends NbtTag {
  readonly value: bigint;
  constructor(value: bigint | number) {
    super();
    this.value = typeof value === "bigint" ? value : BigInt(value);
  }
  toObject(): bigint {
    return this.value;
  }
  toString(): string {
    return `Long(${this.value})`;
  }
  equals(other: unknown): boolean {
    if (other instanceof Long) return this.value === other.value;
    if (typeof other === "bigint") return this.value === other;
    if (typeof other === "number") return this.value === BigInt(other);
    return false;
  }
  toBytes(): Uint8Array {
    return new BinaryWriter().writeInt64(this.value).toBytes();
  }
  static fromReader(reader: BinaryReader): Long {
    return new Long(reader.readInt64());
  }
}
registerTagType(TagId.Long, Long);

export class Float extends _NumberTag {
  toBytes(): Uint8Array {
    return new BinaryWriter().writeFloat32(this.value).toBytes();
  }
  static fromReader(reader: BinaryReader): Float {
    return new Float(reader.readFloat32());
  }
}
registerTagType(TagId.Float, Float);

export class Double extends _NumberTag {
  toBytes(): Uint8Array {
    return new BinaryWriter().writeFloat64(this.value).toBytes();
  }
  static fromReader(reader: BinaryReader): Double {
    return new Double(reader.readFloat64());
  }
}
registerTagType(TagId.Double, Double);

// ── String tag ────────────────────────────────────────────────────────────

// Exported as `StringTag` and re-exported as `String` so callers can do
// `nbt.String(...)`. We can't actually name it `String` because that
// shadows the global.
export class StringTag extends NbtTag {
  constructor(public readonly value: string) {
    super();
  }
  toObject(): string {
    return this.value;
  }
  toString(): string {
    return `String(${JSON.stringify(this.value)})`;
  }
  get length(): number {
    return this.value.length;
  }
  equals(other: unknown): boolean {
    if (other instanceof StringTag) return this.value === other.value;
    return this.value === other;
  }
  toBytes(): Uint8Array {
    const enc = new TextEncoder().encode(this.value);
    return new BinaryWriter().writeUint16(enc.length).writeBytes(enc).toBytes();
  }
  static fromReader(reader: BinaryReader): StringTag {
    const length = reader.readUint16();
    const bytes = reader.readBytes(length);
    return new StringTag(new TextDecoder("utf-8").decode(bytes));
  }
}
registerTagType(TagId.String, StringTag);
export { StringTag as String };

// ── Array tags ────────────────────────────────────────────────────────────
//
// Bit-packing note: in litematic schematics the LongArray holds packed
// fixed-width integers (e.g. 9 bits per block index packed across the 64-bit
// longs). The `view(width)` accessor lets you read/write at that virtual
// width while the underlying storage stays as longs.

abstract class _ArrayTag extends NbtTag {
  abstract readonly elementBits: number;
  // Underlying storage holds 64-bit chunks for LongArray, 32-bit for IntArray,
  // 8-bit for ByteArray. We expose typed-array views over the underlying bytes.

  protected readonly storage: Uint8Array;

  constructor(values: Iterable<number | bigint> | Uint8Array) {
    super();
    if (values instanceof Uint8Array) {
      this.storage = values;
    } else {
      this.storage = this.packValues(Array.from(values));
    }
  }

  protected abstract packValues(values: Array<number | bigint>): Uint8Array;
  protected abstract unpackValues(): Array<number | bigint>;

  get length(): number {
    return this.storage.length / (this.elementBits / 8);
  }

  toObject(): Array<number | bigint> {
    return this.unpackValues();
  }

  equals(other: unknown): boolean {
    if (!(other instanceof _ArrayTag) && !Array.isArray(other)) return false;
    const ours = this.unpackValues();
    const theirs = other instanceof _ArrayTag ? other.unpackValues() : (other as Array<number | bigint>);
    if (ours.length !== theirs.length) return false;
    for (let i = 0; i < ours.length; i++) {
      const a = ours[i];
      const b = theirs[i];
      const aN = typeof a === "bigint" ? a : BigInt(a);
      const bN = typeof b === "bigint" ? b : BigInt(b);
      if (aN !== bN) return false;
    }
    return true;
  }

  toString(): string {
    const values = this.unpackValues();
    return `${this.constructor.name}([${values.join(", ")}])`;
  }

  toBytes(): Uint8Array {
    const elementByteLength = this.elementBits / 8;
    const count = this.storage.length / elementByteLength;
    return new BinaryWriter()
      .writeUint32(count)
      .writeBytes(this.storage)
      .toBytes();
  }

  /**
   * Returns a bit-packed view over the underlying storage. Used by formats
   * like litematic that store block indices packed at non-byte widths inside
   * a LongArray. Returns the value at virtual index `idx` interpreted as a
   * `virtualBits`-wide unsigned integer.
   */
  readPackedUint(idx: number, virtualBits: number): bigint {
    const elementBits = BigInt(this.elementBits);
    const vBits = BigInt(virtualBits);
    const startOffset = BigInt(idx) * vBits;
    const startStorageIdx = Number(startOffset / elementBits);
    const endStorageIdx = Number(((BigInt(idx) + 1n) * vBits - 1n) / elementBits);
    const startBitOffset = startOffset % elementBits;
    const mask = (1n << vBits) - 1n;

    const elementAt = (i: number): bigint => this.elementAtIndex(i);

    if (startStorageIdx === endStorageIdx) {
      return (elementAt(startStorageIdx) >> startBitOffset) & mask;
    }
    const endOffset = elementBits - startBitOffset;
    return ((elementAt(startStorageIdx) >> startBitOffset) | (elementAt(endStorageIdx) << endOffset)) & mask;
  }

  writePackedUint(idx: number, virtualBits: number, value: bigint | number): void {
    const elementBits = BigInt(this.elementBits);
    const vBits = BigInt(virtualBits);
    const startOffset = BigInt(idx) * vBits;
    const startStorageIdx = Number(startOffset / elementBits);
    const endStorageIdx = Number(((BigInt(idx) + 1n) * vBits - 1n) / elementBits);
    const startBitOffset = startOffset % elementBits;
    const mask = (1n << vBits) - 1n;
    const elementMask = (1n << elementBits) - 1n;
    const v = (typeof value === "bigint" ? value : BigInt(value)) & mask;

    const startVal = this.elementAtIndex(startStorageIdx);
    const zeroed = startVal & ~(mask << startBitOffset);
    this.setElementAtIndex(startStorageIdx, (zeroed | (v << startBitOffset)) & elementMask);

    if (startStorageIdx !== endStorageIdx) {
      const endVal = this.elementAtIndex(endStorageIdx);
      const endOffset = elementBits - startBitOffset;
      const shiftBack = vBits - endOffset;
      const cleared = (endVal >> shiftBack) << shiftBack;
      const inserted = (v >> endOffset) & elementMask;
      this.setElementAtIndex(endStorageIdx, (cleared | inserted) & elementMask);
    }
  }

  protected abstract elementAtIndex(i: number): bigint;
  protected abstract setElementAtIndex(i: number, value: bigint): void;
}

export class ByteArray extends _ArrayTag {
  readonly elementBits = 8;

  protected packValues(values: Array<number | bigint>): Uint8Array {
    const out = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      out[i] = typeof v === "bigint" ? Number(BigInt.asIntN(8, v)) & 0xff : v & 0xff;
    }
    return out;
  }

  protected unpackValues(): number[] {
    const out: number[] = new Array(this.storage.length);
    for (let i = 0; i < this.storage.length; i++) {
      out[i] = this.storage[i];
    }
    return out;
  }

  protected elementAtIndex(i: number): bigint {
    return BigInt(this.storage[i]);
  }
  protected setElementAtIndex(i: number, value: bigint): void {
    this.storage[i] = Number(value & 0xffn);
  }

  static fromReader(reader: BinaryReader): ByteArray {
    const length = reader.readUint32();
    return new ByteArray(reader.readBytes(length));
  }
}
registerTagType(TagId.ByteArray, ByteArray);

export class IntArray extends _ArrayTag {
  readonly elementBits = 32;

  protected packValues(values: Array<number | bigint>): Uint8Array {
    const out = new Uint8Array(values.length * 4);
    const view = new DataView(out.buffer);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      view.setInt32(i * 4, typeof v === "bigint" ? Number(BigInt.asIntN(32, v)) : v, false);
    }
    return out;
  }

  protected unpackValues(): number[] {
    const view = new DataView(this.storage.buffer, this.storage.byteOffset, this.storage.byteLength);
    const out: number[] = new Array(this.storage.length / 4);
    for (let i = 0; i < out.length; i++) {
      out[i] = view.getInt32(i * 4, false);
    }
    return out;
  }

  protected elementAtIndex(i: number): bigint {
    const view = new DataView(this.storage.buffer, this.storage.byteOffset, this.storage.byteLength);
    return BigInt.asUintN(32, BigInt(view.getInt32(i * 4, false)));
  }
  protected setElementAtIndex(i: number, value: bigint): void {
    const view = new DataView(this.storage.buffer, this.storage.byteOffset, this.storage.byteLength);
    view.setInt32(i * 4, Number(BigInt.asIntN(32, value)), false);
  }

  static fromReader(reader: BinaryReader): IntArray {
    const length = reader.readUint32();
    return new IntArray(reader.readBytes(length * 4));
  }
}
registerTagType(TagId.IntArray, IntArray);

export class LongArray extends _ArrayTag {
  readonly elementBits = 64;

  protected packValues(values: Array<number | bigint>): Uint8Array {
    const out = new Uint8Array(values.length * 8);
    const view = new DataView(out.buffer);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      view.setBigInt64(i * 8, typeof v === "bigint" ? v : BigInt(v), false);
    }
    return out;
  }

  protected unpackValues(): bigint[] {
    const view = new DataView(this.storage.buffer, this.storage.byteOffset, this.storage.byteLength);
    const out: bigint[] = new Array(this.storage.length / 8);
    for (let i = 0; i < out.length; i++) {
      out[i] = view.getBigInt64(i * 8, false);
    }
    return out;
  }

  protected elementAtIndex(i: number): bigint {
    const view = new DataView(this.storage.buffer, this.storage.byteOffset, this.storage.byteLength);
    return view.getBigUint64(i * 8, false);
  }
  protected setElementAtIndex(i: number, value: bigint): void {
    const view = new DataView(this.storage.buffer, this.storage.byteOffset, this.storage.byteLength);
    view.setBigUint64(i * 8, BigInt.asUintN(64, value), false);
  }

  static fromReader(reader: BinaryReader): LongArray {
    const length = reader.readUint32();
    return new LongArray(reader.readBytes(length * 8));
  }
}
registerTagType(TagId.LongArray, LongArray);

// ── List tag ──────────────────────────────────────────────────────────────

export class NbtList<T extends NbtTag = NbtTag> extends NbtTag {
  readonly items: T[];

  constructor(items: Iterable<T> = []) {
    super();
    this.items = Array.from(items);
  }

  get length(): number {
    return this.items.length;
  }

  at(idx: number): T | undefined {
    return this.items[idx];
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }

  toObject(): unknown[] {
    return this.items.map((item) => item.toObject());
  }

  toString(): string {
    return `List([${this.items.map((i) => i.toString()).join(", ")}])`;
  }

  equals(other: unknown): boolean {
    if (other instanceof NbtList) {
      if (this.items.length !== other.items.length) return false;
      for (let i = 0; i < this.items.length; i++) {
        if (!this.items[i].equals(other.items[i])) return false;
      }
      return true;
    }
    if (Array.isArray(other)) {
      if (this.items.length !== other.length) return false;
      for (let i = 0; i < this.items.length; i++) {
        if (!this.items[i].equals(other[i])) return false;
      }
      return true;
    }
    return false;
  }

  toBytes(): Uint8Array {
    const itemTagTypeId =
      this.items.length > 0
        ? ((this.items[0].constructor as unknown as { tagTypeId: number }).tagTypeId ?? 0)
        : 0;
    const w = new BinaryWriter()
      .writeInt8(itemTagTypeId)
      .writeInt32(this.items.length);
    for (const item of this.items) {
      w.writeBytes(item.toBytes());
    }
    return w.toBytes();
  }

  static fromReader(reader: BinaryReader): NbtList {
    const itemTagTypeId = reader.readInt8();
    const length = reader.readInt32();
    if (itemTagTypeId === 0) return new NbtList([]);
    const itemTagType = tagTypeRegistry.get(itemTagTypeId);
    if (!itemTagType) {
      throw new Error(`No tag class registered for id ${itemTagTypeId}`);
    }
    const items: NbtTag[] = [];
    for (let i = 0; i < length; i++) {
      items.push(itemTagType.fromReader(reader));
    }
    return new NbtList(items);
  }
}
registerTagType(TagId.List, NbtList);
export { NbtList as List };

// ── Compound tag ──────────────────────────────────────────────────────────

export type CompoundEntries<T extends NbtTag = NbtTag> = Record<string, T> | Map<string, T> | Iterable<[string, T]>;

export class Compound<T extends NbtTag = NbtTag> extends NbtTag {
  readonly entries: Map<string, T>;

  constructor(entries: CompoundEntries<T> = {}) {
    super();
    if (entries instanceof Map) {
      this.entries = new Map(entries);
    } else if (Symbol.iterator in (entries as object)) {
      this.entries = new Map(entries as Iterable<[string, T]>);
    } else {
      this.entries = new Map(Object.entries(entries as Record<string, T>));
    }
  }

  get(key: string): T | undefined {
    return this.entries.get(key);
  }
  set(key: string, value: T): this {
    this.entries.set(key, value);
    return this;
  }
  has(key: string): boolean {
    return this.entries.has(key);
  }
  delete(key: string): boolean {
    return this.entries.delete(key);
  }
  keys(): IterableIterator<string> {
    return this.entries.keys();
  }
  values(): IterableIterator<T> {
    return this.entries.values();
  }
  [Symbol.iterator](): Iterator<[string, T]> {
    return this.entries.entries();
  }
  get size(): number {
    return this.entries.size;
  }

  toObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this.entries) {
      obj[k] = v instanceof NbtTag ? v.toObject() : v;
    }
    return obj;
  }

  toString(): string {
    const parts = Array.from(this.entries.entries()).map(
      ([k, v]) => `${JSON.stringify(k)}: ${v.toString()}`,
    );
    return `Compound({${parts.join(", ")}})`;
  }

  equals(other: unknown): boolean {
    if (other instanceof Compound) {
      if (this.entries.size !== other.entries.size) return false;
      for (const [k, v] of this.entries) {
        const otherVal = other.entries.get(k);
        if (otherVal === undefined && !other.entries.has(k)) return false;
        if (!v.equals(otherVal)) return false;
      }
      return true;
    }
    return false;
  }

  toBytes(): Uint8Array {
    const w = new BinaryWriter();
    for (const [key, value] of this.entries) {
      const tagTypeId = (value.constructor as unknown as { tagTypeId: number }).tagTypeId;
      w.writeInt8(tagTypeId)
        .writeBytes(new StringTag(key).toBytes())
        .writeBytes(value.toBytes());
    }
    w.writeInt8(0);
    return w.toBytes();
  }

  static fromReader(reader: BinaryReader): Compound {
    const entries = new Map<string, NbtTag>();
    while (!reader.eof) {
      const tagTypeId = reader.readInt8();
      if (tagTypeId === 0) break;
      const tagType = tagTypeRegistry.get(tagTypeId);
      if (!tagType) {
        throw new Error(`No tag class registered for id ${tagTypeId}`);
      }
      const key = (StringTag.fromReader(reader) as StringTag).value;
      entries.set(key, tagType.fromReader(reader));
    }
    return new Compound(entries);
  }
}
registerTagType(TagId.Compound, Compound);

// ── Named tag (top-level NBT root) ────────────────────────────────────────

export class Named extends Compound {
  readonly name: string;

  constructor(initial: Record<string, NbtTag | Record<string, NbtTag>> | Map<string, NbtTag | Record<string, NbtTag>> | Iterable<[string, NbtTag | Record<string, NbtTag>]>) {
    // initial is { name: Compound | Record<string, NbtTag> } with exactly one key
    let entries: [string, NbtTag | Record<string, NbtTag>][];
    if (initial instanceof Map) {
      entries = Array.from(initial.entries());
    } else if (Symbol.iterator in (initial as object)) {
      entries = Array.from(initial as Iterable<[string, NbtTag | Record<string, NbtTag>]>);
    } else {
      entries = Object.entries(initial as Record<string, NbtTag | Record<string, NbtTag>>);
    }

    if (entries.length !== 1) {
      throw new Error(
        `Named tag can only have one key, but got ${entries.length}`,
      );
    }

    const [name, payload] = entries[0];
    const compound = payload instanceof Compound ? payload : new Compound(payload as Record<string, NbtTag>);
    super(compound.entries);
    this.name = name;
  }

  toObject(): Record<string, unknown> {
    return { [this.name]: super.toObject() };
  }

  toString(): string {
    return `Named({${JSON.stringify(this.name)}: ${Compound.prototype.toString.call(this)}})`;
  }

  equals(other: unknown): boolean {
    if (!(other instanceof Named)) return false;
    if (this.name !== other.name) return false;
    return super.equals(other);
  }

  toBytes(opts: { compress?: boolean } = {}): Uint8Array {
    const w = new BinaryWriter()
      .writeUint8(TagId.Compound)
      .writeBytes(new StringTag(this.name).toBytes())
      .writeBytes(super.toBytes());
    const bytes = w.toBytes();
    if (opts.compress) {
      return new Uint8Array(gzipSync(bytes, { level: 9 }));
    }
    return bytes;
  }

  static fromReader(reader: BinaryReader): Named {
    const rootTagTypeId = reader.readInt8();
    if (rootTagTypeId !== TagId.Compound) {
      throw new Error(`Expected root Compound (10) but got ${rootTagTypeId}`);
    }
    const name = (StringTag.fromReader(reader) as StringTag).value;
    const compound = Compound.fromReader(reader) as Compound;
    return new Named({ [name]: compound });
  }
}

// ── File loading ──────────────────────────────────────────────────────────

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export function loadNbtFromBytes(bytes: Uint8Array): Named {
  let data = bytes;
  if (data.length >= 2 && data[0] === GZIP_MAGIC_0 && data[1] === GZIP_MAGIC_1) {
    data = new Uint8Array(gunzipSync(data));
  }
  return Named.fromBytes(data) as Named;
}

export function loadNbtFromFile(path: string): Named {
  const buf = readFileSync(path);
  return loadNbtFromBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}
