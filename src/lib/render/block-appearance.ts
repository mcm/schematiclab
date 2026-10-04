// Average colour and shape of a block's default-state model, used to suggest
// look-alike substitute blocks.
//
// A block's appearance is `{ oklab, fullCube }`:
//   - `oklab` averages every texture its default-state model draws, one entry
//     per element face, weighted by each face's coverage (alpha). Within a
//     face, pixels are weighted by alpha, and averaging happens in linear sRGB before the
//     result is converted to OKLab. Faces with a `tintindex` are multiplied by
//     a default biome colour (`defaultTint`). Models without elements (block
//     entities such as chests) fall back to their resolved texture variables.
//   - `fullCube` is true when a model the default state draws has resolved
//     elements that are a single `[0,0,0]`–`[16,16,16]` cube (repeated
//     identical cubes, i.e. overlay layers such as the grass block's, still
//     count), and every model resolves. Other multipart parts are then
//     overlays on that cube (the chiseled bookshelf's empty slots).
//
// Everything here is pure and DOM-free (PNGs are decoded in JS), so it runs in
// the mod-jar worker, in unit tests, and in `scripts/build-minecraft-assets.mts`.
// It imports only `fflate`, so the build script can load it directly with
// `node --experimental-strip-types`.
//
// Vanilla colours are precomputed from the 3D-preview bundle's texture atlas
// (`public/minecraft-assets/block-colors.json`); mod colours are computed when
// a jar is parsed (`src/lib/mods/mod-appearance.ts`).

import { unzlibSync } from "fflate";

export interface BlockAppearance {
  /** OKLab `[L, a, b]`, rounded to 3 decimals. */
  oklab: [number, number, number];
  fullCube: boolean;
}

/**
 * Alpha-weighted average of one texture: premultiplied linear-sRGB channel
 * means and the mean alpha, all in 0–1. Averages of averages stay exact, and
 * a fully transparent texture has `a === 0`.
 */
export interface TextureColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Straight (non-premultiplied) 8-bit RGBA pixels, row-major. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A pixel rectangle `[x, y, w, h]`. */
export type PixelRegion = readonly [number, number, number, number];

// ── PNG decoding ──────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Refuse images larger than this many pixels (decompression-bomb guard). */
const MAX_PNG_PIXELS = 4096 * 4096;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decode a non-interlaced PNG (every colour type and bit depth) to 8-bit RGBA.
 * Returns null for anything it can't read.
 */
export function decodePng(bytes: Uint8Array): RgbaImage | null {
  try {
    return decodePngOrThrow(bytes);
  } catch {
    return null;
  }
}

function decodePngOrThrow(bytes: Uint8Array): RgbaImage | null {
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") {
      if (length < 13) return null;
      width = view.getUint32(pos - 4 - length);
      height = view.getUint32(pos - length);
      depth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const channels = CHANNELS[colorType];
  if (
    channels === undefined ||
    width === 0 ||
    height === 0 ||
    width * height > MAX_PNG_PIXELS ||
    ![1, 2, 4, 8, 16].includes(depth) ||
    (colorType === 3 && palette === null)
  ) {
    return null;
  }

  const compressed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = unzlibSync(compressed, {
    out: new Uint8Array((stride + 1) * height),
  });
  if (raw.length < (stride + 1) * height) return null;

  // Undo per-scanline filters in place.
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? lines[row + x - bpp] : 0;
      const up = y > 0 ? lines[prev + x] : 0;
      const upLeft = y > 0 && x >= bpp ? lines[prev + x - bpp] : 0;
      let predictor: number;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default:
          return null;
      }
      lines[row + x] = (raw[src + x] + predictor) & 0xff;
    }
  }

  const sample = (row: number, index: number): number => {
    if (depth === 8) return lines[row + index];
    if (depth === 16) return lines[row + index * 2];
    const bit = index * depth;
    const byte = lines[row + (bit >> 3)];
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  // Raw sample value (before scaling), for tRNS comparisons.
  const rawSample = (row: number, index: number): number =>
    depth === 16
      ? (lines[row + index * 2] << 8) | lines[row + index * 2 + 1]
      : sample(row, index);
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  const trnsKey = (i: number): number =>
    transparency !== null && transparency.length >= i * 2 + 2
      ? (transparency[i * 2] << 8) | transparency[i * 2 + 1]
      : -1;

  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const base = x * channels;
      switch (colorType) {
        case 0: {
          const v = Math.round(sample(row, base) * scale);
          out[o] = out[o + 1] = out[o + 2] = v;
          out[o + 3] = rawSample(row, base) === trnsKey(0) ? 0 : 255;
          break;
        }
        case 2: {
          out[o] = sample(row, base);
          out[o + 1] = sample(row, base + 1);
          out[o + 2] = sample(row, base + 2);
          const opaque =
            rawSample(row, base) !== trnsKey(0) ||
            rawSample(row, base + 1) !== trnsKey(1) ||
            rawSample(row, base + 2) !== trnsKey(2);
          out[o + 3] = opaque ? 255 : 0;
          break;
        }
        case 3: {
          const index = sample(row, base);
          if (index * 3 + 2 >= palette!.length) return null;
          out[o] = palette![index * 3];
          out[o + 1] = palette![index * 3 + 1];
          out[o + 2] = palette![index * 3 + 2];
          out[o + 3] =
            transparency !== null && index < transparency.length
              ? transparency[index]
              : 255;
          break;
        }
        case 4: {
          const v = Math.round(sample(row, base) * scale);
          out[o] = out[o + 1] = out[o + 2] = v;
          out[o + 3] = sample(row, base + 1);
          break;
        }
        case 6:
          out[o] = sample(row, base);
          out[o + 1] = sample(row, base + 1);
          out[o + 2] = sample(row, base + 2);
          out[o + 3] = sample(row, base + 3);
          break;
      }
    }
  }
  return { width, height, data: out };
}

// ── Colour maths ──────────────────────────────────────────────────────────

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** 8-bit sRGB channel → linear 0–1. */
export function srgbToLinear(value: number): number {
  return SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(value)))];
}

/** Linear sRGB (0–1) → OKLab `[L, a, b]` (Björn Ottosson's matrices). */
export function linearSrgbToOklab(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** 8-bit sRGB → OKLab. */
export function srgbToOklab(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  return linearSrgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

/** OKLab → 8-bit sRGB, clamped to the gamut (inverse of `srgbToOklab`). */
export function oklabToSrgb(
  L: number,
  a: number,
  b: number,
): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r, g, bl] = linear.map((v) => {
    const c = Math.max(0, Math.min(1, v));
    const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
  return [r, g, bl];
}

/**
 * Alpha-weighted average of `image` (or a region of it). Pixels outside the
 * image are ignored; an empty region yields a transparent result.
 */
export function averageTextureColor(
  image: RgbaImage,
  region: PixelRegion = [0, 0, image.width, image.height],
): TextureColor {
  const [rx, ry, rw, rh] = region;
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const x1 = Math.min(image.width, rx + rw);
  const y1 = Math.min(image.height, ry + rh);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      const alpha = image.data[o + 3] / 255;
      r += srgbToLinear(image.data[o]) * alpha;
      g += srgbToLinear(image.data[o + 1]) * alpha;
      b += srgbToLinear(image.data[o + 2]) * alpha;
      a += alpha;
      count += 1;
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: r / count, g: g / count, b: b / count, a: a / count };
}

/**
 * Region of an animated texture's first frame: frames are stacked vertically
 * and square unless `.mcmeta` says otherwise.
 */
export function firstFrameRegion(
  width: number,
  height: number,
  meta?: unknown,
): PixelRegion {
  const animation = isRecord(meta) ? meta.animation : undefined;
  if (!isRecord(animation)) return [0, 0, width, height];
  const w =
    typeof animation.width === "number" && animation.width > 0
      ? Math.min(width, animation.width)
      : Math.min(width, height);
  const h =
    typeof animation.height === "number" && animation.height > 0
      ? Math.min(height, animation.height)
      : w;
  return [0, 0, w, h];
}

/**
 * Coverage-weighted combination of face colours, converted to OKLab: each
 * face's premultiplied average is summed and divided by the total alpha, so a
 * mostly transparent face counts for less than an opaque one. Null when every
 * face is fully transparent.
 */
export function combineFaceColors(
  faces: readonly TextureColor[],
): [number, number, number] | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const face of faces) {
    r += face.r;
    g += face.g;
    b += face.b;
    a += face.a;
  }
  if (a <= 0) return null;
  const [L, A, B] = linearSrgbToOklab(r / a, g / a, b / a);
  return [round3(L), round3(A), round3(B)];
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded; // no -0 in JSON
}

// ── Tints ─────────────────────────────────────────────────────────────────

// Plains biome colours (and a few fixed block colours) for `tintindex` faces.
const GRASS_TINT = 0x91bd59;
const FOLIAGE_TINT = 0x77ab2f;
const TINT_OVERRIDES: Record<string, number> = {
  "minecraft:water": 0x3f76e4,
  "minecraft:bubble_column": 0x3f76e4,
  "minecraft:water_cauldron": 0x3f76e4,
  "minecraft:spruce_leaves": 0x619961,
  "minecraft:birch_leaves": 0x80a755,
  "minecraft:lily_pad": 0x208030,
  "minecraft:redstone_wire": 0x4b0000,
  "minecraft:attached_melon_stem": 0xe0c71c,
  "minecraft:attached_pumpkin_stem": 0xe0c71c,
};

/** sRGB colour applied to a block's tinted faces, as `0xRRGGBB`. */
export function defaultTint(blockId: string): number {
  const override = TINT_OVERRIDES[blockId];
  if (override !== undefined) return override;
  return /grass|fern|sugar_cane|bush/.test(blockId) &&
    !/leaves|dead_bush/.test(blockId)
    ? GRASS_TINT
    : FOLIAGE_TINT;
}

function tinted(color: TextureColor, rgb: number): TextureColor {
  return {
    r: color.r * srgbToLinear((rgb >> 16) & 0xff),
    g: color.g * srgbToLinear((rgb >> 8) & 0xff),
    b: color.b * srgbToLinear(rgb & 0xff),
    a: color.a,
  };
}

// ── Models ────────────────────────────────────────────────────────────────

/** Max `parent` hops and `#var` indirections followed (guards cycles). */
const MAX_DEPTH = 32;
const FACES = ["down", "up", "north", "south", "west", "east"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unprefixed resource ids default to the `minecraft` namespace. */
export function normalizeResourceId(ref: string): string {
  return ref.includes(":") ? ref : `minecraft:${ref}`;
}

/** A block's default property values (`{ facing: "north", lit: "true" }`). */
export type BlockStateProperties = Readonly<Record<string, string>>;

/**
 * True when a `variants` key (`facing=north,lit=true`, `""`, or a subset of
 * the block's properties) matches `properties`.
 */
function variantKeyMatches(key: string, properties: BlockStateProperties) {
  if (key === "") return true;
  return key.split(",").every((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) return false;
    const name = pair.slice(0, eq).trim();
    return (
      Object.prototype.hasOwnProperty.call(properties, name) &&
      properties[name] === pair.slice(eq + 1).trim()
    );
  });
}

/**
 * True when a multipart `when` condition matches `properties`: `{ prop:
 * "a|b" }` (every listed property matches one of its `|` values, `!` negates),
 * `{ OR: [...] }` or `{ AND: [...] }`.
 */
function whenMatches(when: unknown, properties: BlockStateProperties): boolean {
  if (!isRecord(when)) return false;
  if (Array.isArray(when.OR)) {
    return when.OR.some((condition) => whenMatches(condition, properties));
  }
  if (Array.isArray(when.AND)) {
    return when.AND.every((condition) => whenMatches(condition, properties));
  }
  return Object.entries(when).every(([name, raw]) => {
    if (!Object.prototype.hasOwnProperty.call(properties, name)) return false;
    let expected = String(raw);
    const negate = expected.startsWith("!");
    if (negate) expected = expected.slice(1);
    const hit = expected.split("|").includes(properties[name]);
    return negate ? !hit : hit;
  });
}

/**
 * Normalized model ids drawn by a blockstate's default state. With
 * `defaults` (the block's default property values), picks the variant or the
 * multipart parts that match them; without (mods), or when nothing matches,
 * falls back to the first variant, or to the unconditional parts (else the
 * first part) of a multipart blockstate.
 */
export function defaultStateModels(
  blockstate: unknown,
  defaults?: BlockStateProperties,
): string[] {
  if (!isRecord(blockstate)) return [];
  const first = (value: unknown): string | null => {
    const entry = Array.isArray(value) ? value[0] : value;
    return isRecord(entry) && typeof entry.model === "string"
      ? normalizeResourceId(entry.model)
      : null;
  };
  if (isRecord(blockstate.variants)) {
    const entries = Object.entries(blockstate.variants);
    const chosen =
      (defaults !== undefined
        ? entries.find(([key]) => variantKeyMatches(key, defaults))
        : undefined) ?? entries[0];
    const model = chosen === undefined ? null : first(chosen[1]);
    return model === null ? [] : [model];
  }
  if (Array.isArray(blockstate.multipart)) {
    const parts = blockstate.multipart.filter(isRecord);
    const always = parts.filter((part) => part.when === undefined);
    const matching =
      defaults === undefined
        ? []
        : parts.filter(
            (part) =>
              part.when === undefined || whenMatches(part.when, defaults),
          );
    // Unconditional parts (fence posts, …) always draw; without defaults,
    // take the first part as a stand-in for the default state.
    const chosen =
      matching.length > 0
        ? matching
        : always.length > 0
          ? always
          : parts.slice(0, 1);
    return chosen
      .map((part) => first(part.apply))
      .filter((model): model is string => model !== null);
  }
  return [];
}

export interface ResolvedModel {
  /** Merged texture variables (child overrides parent), `#` refs unresolved. */
  textures: Record<string, unknown>;
  /** Elements of the nearest model in the parent chain that defines them. */
  elements: unknown[] | null;
}

/**
 * Walk a model's parent chain. `getModel` takes normalized ids
 * (`ns:block/x`). Null when the model or one of its parents is missing
 * (`builtin/*` parents excepted), since its shape is then unknown.
 */
export function resolveModel(
  id: string,
  getModel: (id: string) => unknown,
): ResolvedModel | null {
  const textures: Record<string, unknown> = {};
  let elements: unknown[] | null = null;
  let current: unknown = getModel(id);
  if (!isRecord(current)) return null;
  for (let depth = 0; isRecord(current) && depth <= MAX_DEPTH; depth++) {
    if (isRecord(current.textures)) {
      for (const [key, value] of Object.entries(current.textures)) {
        if (!(key in textures)) textures[key] = value;
      }
    }
    if (elements === null && Array.isArray(current.elements)) {
      elements = current.elements;
    }
    if (typeof current.parent !== "string") break;
    const parentId = normalizeResourceId(current.parent);
    if (parentId.startsWith("minecraft:builtin/")) break;
    current = getModel(parentId);
    if (!isRecord(current)) return null;
  }
  return { textures, elements };
}

/** Follow `#var` references to a normalized texture id. */
export function resolveTextureRef(
  ref: unknown,
  textures: Record<string, unknown>,
): string | null {
  let value = ref;
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    // 1.21.4+ also allows `{ "sprite": "ns:path", ... }` objects.
    const raw = isRecord(value) ? value.sprite : value;
    if (typeof raw !== "string" || raw.length === 0) return null;
    if (!raw.startsWith("#")) return normalizeResourceId(raw);
    value = textures[raw.slice(1)];
  }
  return null;
}

function isVector(value: unknown, expected: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => component === expected)
  );
}

/**
 * True when `elements` is one full `0`–`16` cube. Overlay layers that repeat
 * the same cube (grass block sides) still count as one cube.
 */
export function isFullCubeModel(elements: unknown[] | null): boolean {
  return (
    elements !== null &&
    elements.length > 0 &&
    elements.every(
      (element) =>
        isRecord(element) &&
        isVector(element.from, 0) &&
        isVector(element.to, 16),
    )
  );
}

export interface AppearanceSources {
  /** Raw model JSON by normalized id (`ns:block/x`), or undefined. */
  getModel: (id: string) => unknown;
  /** Colour of a texture by normalized id (`ns:block/x`), or null. */
  getTextureColor: (id: string) => TextureColor | null;
}

/**
 * `{ oklab, fullCube }` for a block's default state, or undefined when its
 * models or textures can't be resolved (or are fully transparent). Faces whose
 * texture can't be resolved are skipped. `defaults` are the block's default
 * property values when known (vanilla); see `defaultStateModels`.
 */
export function blockAppearance(
  blockId: string,
  blockstate: unknown,
  sources: AppearanceSources,
  defaults?: BlockStateProperties,
): BlockAppearance | undefined {
  const modelIds = defaultStateModels(blockstate, defaults);
  const faces: TextureColor[] = [];
  let hasFullCube = false;
  let unresolved = false;
  const tint = defaultTint(blockId);

  for (const modelId of modelIds) {
    const model = resolveModel(modelId, sources.getModel);
    if (model === null) {
      unresolved = true;
      continue;
    }
    if (isFullCubeModel(model.elements)) hasFullCube = true;

    let drewFace = false;
    for (const element of model.elements ?? []) {
      if (!isRecord(element) || !isRecord(element.faces)) continue;
      for (const direction of FACES) {
        const face = element.faces[direction];
        if (!isRecord(face)) continue;
        drewFace = true;
        // Face textures always name a variable; the `#` is optional.
        const variable =
          typeof face.texture === "string" && !face.texture.startsWith("#")
            ? `#${face.texture}`
            : face.texture;
        const textureId = resolveTextureRef(variable, model.textures);
        const color =
          textureId === null ? null : sources.getTextureColor(textureId);
        if (color === null) continue;
        faces.push(
          typeof face.tintindex === "number" ? tinted(color, tint) : color,
        );
      }
    }
    // Block-entity and fluid models have no elements; use their texture
    // variables (usually just `particle`), tinted only for blocks with a
    // fixed colour (water).
    if (!drewFace) {
      for (const ref of Object.values(model.textures)) {
        const textureId = resolveTextureRef(ref, model.textures);
        const color =
          textureId === null ? null : sources.getTextureColor(textureId);
        if (color === null) continue;
        faces.push(
          blockId in TINT_OVERRIDES
            ? tinted(color, TINT_OVERRIDES[blockId])
            : color,
        );
      }
    }
  }

  const oklab = combineFaceColors(faces);
  return oklab === null
    ? undefined
    : { oklab, fullCube: hasFullCube && !unresolved };
}

// ── Vanilla bundle ────────────────────────────────────────────────────────

/**
 * Model lookup over the bundle's `models.json`, which is keyed by path under
 * `models/block/` (`stone` for `minecraft:block/stone`).
 */
export function vanillaModelLookup(
  models: Record<string, unknown>,
): (id: string) => unknown {
  return (id) => {
    if (!id.startsWith("minecraft:block/")) return undefined;
    const key = id.slice("minecraft:block/".length);
    return Object.prototype.hasOwnProperty.call(models, key)
      ? models[key]
      : undefined;
  };
}

/**
 * Texture colours from the bundle's atlas (`atlas-uvs.json` is keyed by path,
 * e.g. `block/stone`, with pixel `[x, y, w, h]`; animated textures occupy
 * their whole strip). Colours are computed on first use and cached.
 */
export function atlasTextureColors(
  atlas: RgbaImage,
  uvs: Record<string, unknown>,
): (id: string) => TextureColor | null {
  const cache = new Map<string, TextureColor | null>();
  return (id) => {
    if (!id.startsWith("minecraft:")) return null;
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const path = id.slice("minecraft:".length);
    const uv = Object.prototype.hasOwnProperty.call(uvs, path)
      ? uvs[path]
      : undefined;
    let color: TextureColor | null = null;
    if (
      Array.isArray(uv) &&
      uv.length === 4 &&
      uv.every((n) => typeof n === "number")
    ) {
      const [x, y, w, h] = uv as number[];
      const frame = h > w ? w : h;
      color = averageTextureColor(atlas, [x, y, w, frame]);
    }
    cache.set(id, color);
    return color;
  };
}

/**
 * `block-colors.json` contents: `minecraft:<block>` → appearance, sorted by id,
 * for every blockstate whose appearance resolves. `defaultProperties` maps a
 * block path (`sculk_sensor`) to its default property values, so the default
 * state's variant is used rather than the alphabetically first one.
 */
export function vanillaBlockColors(
  blockstates: Record<string, unknown>,
  models: Record<string, unknown>,
  atlas: RgbaImage,
  uvs: Record<string, unknown>,
  defaultProperties: Readonly<Record<string, BlockStateProperties>> = {},
): Record<string, BlockAppearance> {
  const sources: AppearanceSources = {
    getModel: vanillaModelLookup(models),
    getTextureColor: atlasTextureColors(atlas, uvs),
  };
  const out: Record<string, BlockAppearance> = {};
  for (const path of Object.keys(blockstates).sort()) {
    const id = `minecraft:${path}`;
    const defaults = Object.prototype.hasOwnProperty.call(
      defaultProperties,
      path,
    )
      ? defaultProperties[path]
      : undefined;
    const appearance = blockAppearance(
      id,
      blockstates[path],
      sources,
      defaults,
    );
    if (appearance !== undefined) out[id] = appearance;
  }
  return out;
}
