// Varint codec for Sponge `BlockData` (v1, v2) and `Blocks.Data` (v3): each
// palette index is 7-bit base-128 with the MSB as continuation.

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
  if (shift !== 0) throw new Error("Truncated varint at end of block data");
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
