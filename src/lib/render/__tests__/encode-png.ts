// Test-only PNG encoder for small synthetic textures.

import { zlibSync } from "fflate";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface EncodePngOptions {
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  depth?: 1 | 2 | 4 | 8 | 16;
  /** Packed scanlines without filter bytes (`stride * height` bytes). */
  scanlines: Uint8Array;
  /** Filter type byte per row (default 0). The scanlines are filtered here. */
  filter?: 0 | 1 | 2 | 3 | 4;
  palette?: number[];
  transparency?: number[];
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function encodePng(options: EncodePngOptions): Uint8Array<ArrayBuffer> {
  const { width, height, colorType, scanlines } = options;
  if (colorType === 3 && !options.palette) {
    throw new Error("encodePng: colour type 3 (palette) needs a palette");
  }
  const depth = options.depth ?? 8;
  const filter = options.filter ?? 0;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);

  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const cur = scanlines[y * stride + x];
      const left = x >= bpp ? scanlines[y * stride + x - bpp] : 0;
      const up = y > 0 ? scanlines[(y - 1) * stride + x] : 0;
      const upLeft =
        y > 0 && x >= bpp ? scanlines[(y - 1) * stride + x - bpp] : 0;
      const predictor = [
        0,
        left,
        up,
        (left + up) >> 1,
        paeth(left, up, upLeft),
      ][filter];
      raw[y * (stride + 1) + 1 + x] = (cur - predictor) & 0xff;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = colorType;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
  ];
  if (options.palette) {
    parts.push(chunk("PLTE", new Uint8Array(options.palette)));
  }
  if (options.transparency) {
    parts.push(chunk("tRNS", new Uint8Array(options.transparency)));
  }
  parts.push(chunk("IDAT", zlibSync(raw)));
  parts.push(chunk("IEND", new Uint8Array(0)));

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** RGBA8 PNG from `[r, g, b, a]` pixels, row-major. */
export function rgbaPng(
  width: number,
  height: number,
  pixels: readonly (readonly number[])[],
  filter: EncodePngOptions["filter"] = 0,
): Uint8Array<ArrayBuffer> {
  return encodePng({
    width,
    height,
    colorType: 6,
    scanlines: new Uint8Array(pixels.flat()),
    filter,
  });
}

/** A `size`×`size` PNG filled with one RGBA colour. */
export function solidPng(
  rgba: readonly number[],
  size = 2,
): Uint8Array<ArrayBuffer> {
  return rgbaPng(
    size,
    size,
    Array.from({ length: size * size }, () => rgba),
  );
}
