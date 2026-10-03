// Port of Unlimited Chisel Works 0.3.5 `pl.asie.ucw.UCWMagic.transform` and
// `calculateContrast`, plus the per-frame loop of
// `UCWProxyClient.onTextureStitchPre`
// (https://github.com/asiekierka/UnlimitedChiselWorks, commit c458fc8).
// Copyright (c) 2017, 2018, 2019, 2021 Adrian Siekierka. Unlimited Chisel
// Works is licensed under the GNU Lesser General Public License v3.0 (or
// later); this port is a derivative of it under the same terms.
//
// UCW recolours each texture of the `through` (Chisel) block in its LAB
// space (`colorspace.ts`): lightness is rescaled from `basedUpon`'s range to
// `from`'s, and the chroma (a, b) comes from the `overlay` pixel at the same
// position (`none`), `from`'s average (`blend`), or a mix of `from`'s dark and
// light halves weighted by the pixel's lightness (`plank`). Java `float`
// arithmetic is reproduced with `Math.fround`; Java `double`s stay doubles.
//
// Worker-safe: no DOM access.

import {
  firstFrameRegion,
  type RgbaImage,
} from "../../../render/block-appearance";
import type { GeneratedTextureImage, GeneratedTextureRecipe } from "../types";
import {
  asInt,
  fromInt,
  LABtoXYZ,
  sRGBtoLuma,
  sRGBtoXYZ,
  XYZtoLAB,
  XYZtosRGB,
  type Float3,
} from "./colorspace";
import type { UcwBlendMode } from "./rules";

const f = Math.fround;

/** Java's `Float.MAX_VALUE`. */
const FLOAT_MAX_VALUE = 3.4028234663852886e38;
/** Java's `Float.MIN_VALUE`: the smallest positive float, not the lowest. */
const FLOAT_MIN_VALUE = 1.401298464324817e-45;

function toLuma(rgb: number): number {
  return sRGBtoLuma(fromInt(rgb));
}

function toLAB(rgb: number): Float3 {
  return XYZtoLAB(sRGBtoXYZ(fromInt(rgb)));
}

function fromLAB(lab: readonly number[]): number {
  return asInt(XYZtosRGB(LABtoXYZ(lab)));
}

/** `image`'s pixels as Java `0xAARRGGBB` ints (`TextureAtlasSprite` data). */
export function argbPixels(image: RgbaImage): Int32Array {
  const pixels = new Int32Array(image.width * image.height);
  for (let i = 0; i < pixels.length; i++) {
    const o = i * 4;
    pixels[i] =
      (image.data[o + 3] << 24) |
      (image.data[o] << 16) |
      (image.data[o + 1] << 8) |
      image.data[o + 2];
  }
  return pixels;
}

/**
 * `[min, max - min]` of the pixels' UCW lightness. Like Java, the maximum
 * starts at `Float.MIN_VALUE`, so an all-black image has range
 * `Float.MIN_VALUE`, not 0.
 */
export function calculateContrast(data: ArrayLike<number>): [number, number] {
  const contrast: [number, number] = [FLOAT_MAX_VALUE, FLOAT_MIN_VALUE];
  for (let i = 0; i < data.length; i++) {
    const d = toLuma(data[i]);
    if (contrast[0] > d) contrast[0] = d;
    if (contrast[1] < d) contrast[1] = d;
  }
  contrast[1] = f(contrast[1] - contrast[0]);
  return contrast;
}

/**
 * Port of `UCWMagic.transform` for one frame. `through` is the frame of the
 * texture being recoloured; `from`, `overlay` and `basedUpon` are the first
 * frames of their textures. The result has `through`'s size and alpha.
 * Overlay pixels are read with `from`'s width and height (tiling by `from`'s
 * size, as in Java); like Java, it throws when that reads past the overlay.
 */
export function transformUcwFrame(
  through: RgbaImage,
  from: RgbaImage,
  overlay: RgbaImage,
  basedUpon: RgbaImage,
  mode: UcwBlendMode,
): RgbaImage {
  if (from.width <= 0 || from.height <= 0) {
    throw new RangeError("UCW from texture is empty");
  }
  const texture = argbPixels(through);
  const fromData = argbPixels(from);
  const overlayData = argbPixels(overlay);
  const { width, height } = through;
  const contrastFrom = calculateContrast(fromData);
  const contrastBasedUpon = calculateContrast(argbPixels(basedUpon));
  let avgA = 0;
  let avgB = 0;
  const rangeA = [0, 0];
  const rangeB = [0, 0];
  const rangeDiv = [0, 0];

  if (mode === "plank") {
    for (const i of fromData) {
      const hd = toLAB(i);
      const normV = f(hd[0] - contrastFrom[0]) / contrastFrom[1];
      const half = normV < 0.5 ? 0 : 1;
      rangeA[half] += hd[1];
      rangeB[half] += hd[2];
      rangeDiv[half]++;
    }
    for (const half of [0, 1]) {
      if (rangeDiv[half] > 0) {
        rangeA[half] /= rangeDiv[half];
        rangeB[half] /= rangeDiv[half];
      }
    }
  }

  if (mode === "blend") {
    for (const i of fromData) {
      const data = toLAB(i);
      avgA += data[1];
      avgB += data[2];
    }
    avgA /= from.width * from.height;
    avgB /= from.width * from.height;
  }

  const out = new Uint8Array(width * height * 4);
  for (let iy = 0; iy < height; iy++) {
    for (let ix = 0; ix < width; ix++) {
      const i = iy * width + ix;
      const it = texture[i];
      const overlayIndex = (iy % from.height) * from.width + (ix % from.width);
      if (overlayIndex >= overlayData.length) {
        throw new RangeError(
          `UCW overlay texture (${overlay.width}×${overlay.height}) is smaller than the from texture (${from.width}×${from.height})`,
        );
      }
      const ibu = overlayData[overlayIndex];

      const hsbTex = toLAB(it);
      const hsbBu = toLAB(ibu);
      const normV =
        contrastBasedUpon[1] !== 0
          ? f(hsbTex[0] - contrastBasedUpon[0]) / contrastBasedUpon[1]
          : 0.5;
      let v = f(normV * contrastFrom[1] + contrastFrom[0]);

      if (mode === "blend") {
        hsbBu[1] = f(avgA);
        hsbBu[2] = f(avgB);
      } else if (mode === "plank") {
        let nv2 = normV;
        if (nv2 < 0) nv2 = 0;
        else if (nv2 > 1) nv2 = 1;
        hsbBu[1] = f(rangeA[1] * nv2 + rangeA[0] * (1 - nv2));
        hsbBu[2] = f(rangeB[1] * nv2 + rangeB[0] * (1 - nv2));
      }

      if (v < 0) v = 0;
      else if (v > 100) v = 100;
      const rgb = fromLAB([v, hsbBu[1], hsbBu[2]]);
      const o = i * 4;
      out[o] = (rgb >> 16) & 0xff;
      out[o + 1] = (rgb >> 8) & 0xff;
      out[o + 2] = rgb & 0xff;
      out[o + 3] = through.data[o + 3];
    }
  }
  return { width, height, data: out };
}

/** Copy of the `[x, y, w, h]` rectangle of `image`. */
function crop(
  image: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(start, start + w * 4), row * w * 4);
  }
  return { width: w, height: h, data };
}

/**
 * The first animation frame of a texture (`getFrameTextureData(0)`): the
 * whole image unless its `.mcmeta` animates it.
 */
export function firstUcwFrame(texture: GeneratedTextureImage): RgbaImage {
  const { image, meta } = texture;
  const [x, y, w, h] = firstFrameRegion(image.width, image.height, meta);
  return w === image.width && h === image.height
    ? image
    : crop(image, x, y, w, h);
}

/**
 * Recolour every frame of `through` (frames stacked vertically, sized by its
 * `.mcmeta`) with `transformUcwFrame`, as `onTextureStitchPre` does for each
 * of the sprite's frames. `from`, `overlay` and `basedUpon` contribute their
 * first frame only. The result is the recoloured strip, with `through`'s
 * `.mcmeta`.
 */
export function transformUcwTexture(
  through: GeneratedTextureImage,
  from: GeneratedTextureImage,
  overlay: GeneratedTextureImage,
  basedUpon: GeneratedTextureImage,
  mode: UcwBlendMode,
): GeneratedTextureImage {
  const { image } = through;
  const [, , w, h] = firstFrameRegion(image.width, image.height, through.meta);
  if (w <= 0 || h <= 0) throw new RangeError("UCW through texture is empty");
  const frameCount = Math.max(1, Math.floor(image.height / h));
  const fromFrame = firstUcwFrame(from);
  const overlayFrame = firstUcwFrame(overlay);
  const basedUponFrame = firstUcwFrame(basedUpon);
  const data = new Uint8Array(w * h * frameCount * 4);
  for (let frame = 0; frame < frameCount; frame++) {
    const recoloured = transformUcwFrame(
      crop(image, 0, frame * h, w, h),
      fromFrame,
      overlayFrame,
      basedUponFrame,
      mode,
    );
    data.set(recoloured.data, frame * w * h * 4);
  }
  return {
    image: { width: w, height: h * frameCount, data },
    ...(through.meta !== undefined ? { meta: through.meta } : {}),
  };
}

/**
 * `GeneratedTextureRecipe.params` of a UCW texture: the texture ids of the
 * four sprites `transform` reads (each also listed in `sources`) and the
 * rule's blend mode.
 */
export interface UcwTextureParams {
  through: string;
  from: string;
  overlay: string;
  basedUpon: string;
  mode: UcwBlendMode;
}

const BLEND_MODES: readonly string[] = ["none", "blend", "plank"];

function asUcwTextureParams(value: unknown): UcwTextureParams | null {
  if (typeof value !== "object" || value === null) return null;
  const params = value as Record<string, unknown>;
  const ids = [params.through, params.from, params.overlay, params.basedUpon];
  if (!ids.every((id) => typeof id === "string")) return null;
  if (typeof params.mode !== "string" || !BLEND_MODES.includes(params.mode)) {
    return null;
  }
  return params as unknown as UcwTextureParams;
}

/**
 * Run a UCW texture recipe on its decoded sources. Null when the params are
 * malformed, a source is missing or empty, or the overlay is too small to
 * read.
 */
export function generateUcwTexture(
  recipe: GeneratedTextureRecipe,
  sources: ReadonlyMap<string, GeneratedTextureImage>,
): GeneratedTextureImage | null {
  const params = asUcwTextureParams(recipe.params);
  if (params === null) return null;
  const through = sources.get(params.through);
  const from = sources.get(params.from);
  const overlay = sources.get(params.overlay);
  const basedUpon = sources.get(params.basedUpon);
  if (!through || !from || !overlay || !basedUpon) return null;
  try {
    return transformUcwTexture(through, from, overlay, basedUpon, params.mode);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
