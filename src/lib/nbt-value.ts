// Plain-object NBT value tree.
//
// schemlib's NBT tags are class instances and don't survive structured cloning
// across the worker boundary. This is the same tree as tagged plain objects,
// keeping every tag type so a value converts back to the exact NBT it came
// from (an Int stays an Int, a Byte stays a Byte). Longs are bigints, which
// structured cloning supports.
//
// Worker-safe: no DOM access.

import * as nbt from "./schemlib/nbt";

export type NbtValue =
  | { type: "byte" | "short" | "int" | "float" | "double"; value: number }
  | { type: "long"; value: bigint }
  | { type: "string"; value: string }
  | { type: "byteArray" | "intArray"; value: number[] }
  | { type: "longArray"; value: bigint[] }
  | { type: "list"; items: NbtValue[] }
  | NbtCompoundValue;

export interface NbtCompoundValue {
  type: "compound";
  entries: Record<string, NbtValue>;
}

export function toNbtValue(tag: nbt.NbtTag): NbtValue {
  if (tag instanceof nbt.Compound) return toNbtCompoundValue(tag);
  if (tag instanceof nbt.NbtList) {
    return { type: "list", items: tag.items.map(toNbtValue) };
  }
  if (tag instanceof nbt.StringTag) return { type: "string", value: tag.value };
  if (tag instanceof nbt.Byte) return { type: "byte", value: tag.value };
  if (tag instanceof nbt.Short) return { type: "short", value: tag.value };
  if (tag instanceof nbt.Int) return { type: "int", value: tag.value };
  if (tag instanceof nbt.Long) return { type: "long", value: tag.value };
  if (tag instanceof nbt.Float) return { type: "float", value: tag.value };
  if (tag instanceof nbt.Double) return { type: "double", value: tag.value };
  if (tag instanceof nbt.ByteArray) {
    return { type: "byteArray", value: tag.toObject() as number[] };
  }
  if (tag instanceof nbt.IntArray) {
    return { type: "intArray", value: tag.toObject() as number[] };
  }
  if (tag instanceof nbt.LongArray) {
    return { type: "longArray", value: tag.toObject() as bigint[] };
  }
  throw new TypeError(`Unsupported NBT tag: ${tag.constructor.name}`);
}

export function toNbtCompoundValue(tag: nbt.Compound): NbtCompoundValue {
  // Object.fromEntries defines own properties, so a "__proto__" key stays a
  // plain entry instead of replacing the prototype.
  return {
    type: "compound",
    entries: Object.fromEntries(
      [...tag.entries].map(([k, v]) => [k, toNbtValue(v)]),
    ),
  };
}

export function fromNbtValue(value: NbtValue): nbt.NbtTag {
  switch (value.type) {
    case "compound":
      return fromNbtCompoundValue(value);
    case "list":
      return new nbt.NbtList(value.items.map(fromNbtValue));
    case "string":
      return new nbt.StringTag(value.value);
    case "byte":
      return new nbt.Byte(value.value);
    case "short":
      return new nbt.Short(value.value);
    case "int":
      return new nbt.Int(value.value);
    case "long":
      return new nbt.Long(value.value);
    case "float":
      return new nbt.Float(value.value);
    case "double":
      return new nbt.Double(value.value);
    case "byteArray":
      return new nbt.ByteArray(value.value);
    case "intArray":
      return new nbt.IntArray(value.value);
    case "longArray":
      return new nbt.LongArray(value.value);
  }
}

export function fromNbtCompoundValue(value: NbtCompoundValue): nbt.Compound {
  return new nbt.Compound(
    Object.entries(value.entries).map(
      ([k, v]) => [k, fromNbtValue(v)] as [string, nbt.NbtTag],
    ),
  );
}
