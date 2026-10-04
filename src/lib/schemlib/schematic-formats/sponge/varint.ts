// Varint codec for Sponge `BlockData` (v1, v2) and `Blocks.Data` (v3): each
// palette index is 7-bit base-128 with the MSB as continuation.

import type * as nbt from "../../nbt";

/**
 * Decodes `bytes`, throwing as soon as it holds more than `maxCount` values
 * (when given), so oversized data stops early.
 */
export function decodeVarintArray(
  bytes: number[] | Int8Array,
  maxCount = Infinity,
): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] as number) & 0xff;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      if (out.length >= maxCount) {
        throw new Error(`Block data holds more than ${maxCount} entries`);
      }
      out.push(value >>> 0);
      value = 0;
      shift = 0;
    } else {
      shift += 7;
    }
  }
  if (shift !== 0) throw new Error("Truncated varint at end of block data");
  return out;
}

// A 32-bit palette index takes 1 to 5 varint bytes.
const MAX_VARINT_BYTES = 5;

/**
 * The `expected` palette indices of a Sponge block-data tag. Its byte length
 * is checked before the tag is unpacked and decoding stops at `expected`
 * entries, so data far larger than the declared size is never materialized.
 */
export function decodeBlockData(
  tag: nbt.ByteArray,
  expected: number,
  label: string,
): number[] {
  if (tag.length < expected || tag.length > expected * MAX_VARINT_BYTES) {
    throw new Error(
      `${label} has ${tag.length} bytes, which can't hold ${expected} entries`,
    );
  }
  const values = decodeVarintArray(tag.toObject() as number[], expected);
  if (values.length !== expected) {
    throw new Error(
      `${label} decoded to ${values.length} entries, expected ${expected}`,
    );
  }
  return values;
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
