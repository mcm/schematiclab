// Port of Moonlight Lib's
// `net.mehvahdjukaar.moonlight.api.resources.textures.Respriter` (with its
// `Color2ColorMap` and `FrameColorRemapper`) and of the palette helpers of
// `SpriteUtils` (`extrapolateSignBlockPalette`, `extrapolateWoodItemPalette`),
// from https://github.com/MehVahdJukaar/Moonlight (branch 1.21, commit
// 72afa38c8b7f5c05639644fdabc92d5254924732). Moonlight Lib is by MehVahdJukaar
// and the Supplementaries Team, under the Supplementaries Team License; this
// port is a derivative of it under the same terms.
//
// A Respriter holds a source texture and its exact-colour palette. Recolouring
// resizes a copy of each target palette to the source palette's size
// (`Palette.matchSize`) and maps source colour i to target colour i by
// luminance rank; pixels of other colours stay as they are. When the sizes
// can't be matched the texture comes out un-recoloured.
//
// Worker-safe: no DOM access.

import { abgrAlpha, HSVColor, PaletteColor } from "./colors";
import { clamp } from "./mth";
import { BASE_TOLERANCE, Palette } from "./palette";
import {
  createSingleFrameAnimation,
  McMetaFile,
  TextureImage,
} from "./texture-image";

const f = Math.fround;

/** `Color2ColorMap.NO_MATCH_MARKER`: palette colours never have alpha 0. */
const NO_MATCH = 0;

/**
 * `Respriter.Color2ColorMap.create`: source colour value → target colour
 * value, or an empty map when the target can't be resized to fit.
 */
export function createColorMap(
  original: Palette,
  toPalette: Palette,
): Map<number, number> {
  const to = toPalette.copy();
  to.matchSize(original.size(), original.getAverageLuminanceStep());
  const map = new Map<number, number>();
  if (to.size() !== original.size()) return map;
  const keys = original.values;
  const values = to.values;
  for (let i = 0; i < keys.length; i++) map.set(keys[i].value, values[i].value);
  return map;
}

/** `Respriter.FrameColorRemapper.of`: one colour map per output frame. */
function frameColorRemapper(
  original: Palette,
  originalFrameCount: number,
  targets: readonly Palette[],
  targetFrameCount: number,
): (frameIndex: number, color: number) => number {
  const invalidSize = targetFrameCount > targets.length;
  if (originalFrameCount !== 1 || invalidSize) {
    if (targets.length === 0) throw new Error("No target palettes");
    const single = createColorMap(original, targets[0]);
    return (_frame, color) => single.get(color) ?? NO_MATCH;
  }
  const perFrame: Map<number, number>[] = [];
  for (let i = 0; i < targetFrameCount; i++)
    perFrame.push(createColorMap(original, targets[i]));
  return (frame, color) => perFrame[frame].get(color) ?? NO_MATCH;
}

/** `Respriter`: recolours one texture with target palettes. */
export class Respriter {
  private constructor(
    readonly imageToRecolor: TextureImage,
    readonly originalPalette: Palette,
    private readonly recoloringMask: TextureImage | null,
  ) {
    if (originalPalette.isEmpty()) {
      throw new Error("Respriter must have a non empty target palette");
    }
  }

  /** `Respriter.of`: every exact colour of the image (throws if none). */
  static of(image: TextureImage): Respriter {
    return new Respriter(image, Palette.fromImage(image, null, 0), null);
  }

  /** `Respriter.masked`: only colours (and pixels) where the mask is transparent. */
  static masked(image: TextureImage, mask: TextureImage): Respriter {
    return new Respriter(image, Palette.fromImage(image, mask, 0), mask);
  }

  /** `Respriter.ofPalette`: an explicit source palette, no mask. */
  static ofPalette(image: TextureImage, colorsToSwap: Palette): Respriter {
    return new Respriter(image, colorsToSwap, null);
  }

  /**
   * `recolorWithAnimation(targetPalettes, targetAnimationData)`. A static
   * source adopts the target's animation (one frame per target palette); an
   * animated source keeps its own and uses the first palette throughout.
   */
  recolorWithAnimation(
    targetPalettes: readonly Palette[],
    targetAnimationData: McMetaFile | null,
  ): TextureImage {
    const source = this.imageToRecolor;
    if (targetPalettes.length === 0) return source.makeCopy();
    const merged = McMetaFile.merge(source.mcMeta, targetAnimationData);
    const originalFrameCount = source.frameCount;
    const turnsIntoAnimation =
      originalFrameCount === 1 && merged !== null && merged.hasAnimation();
    const output =
      turnsIntoAnimation && merged !== null
        ? createSingleFrameAnimation(
            source,
            Math.max(targetPalettes.length, merged.requiredFrameCount()),
            merged,
          )
        : source.makeCopyWithMetadata(merged);
    const remap = frameColorRemapper(
      this.originalPalette,
      originalFrameCount,
      targetPalettes,
      output.frameCount,
    );
    const mask = this.recoloringMask;
    output.forEachPixel((frame, _x, _y, gx, gy) => {
      if (mask !== null && abgrAlpha(mask.sample(gx, gy)) !== 0) return;
      const next = remap(frame, output.getPixel(gx, gy));
      if (next !== NO_MATCH) output.setPixel(gx, gy, next);
    });
    return output;
  }

  /** `recolor(palettes)`: no target animation. */
  recolor(targetPalettes: readonly Palette[] | Palette): TextureImage {
    return this.recolorWithAnimation(
      targetPalettes instanceof Palette ? [targetPalettes] : targetPalettes,
      null,
    );
  }

  /** `recolorWithAnimationOf(texture)`: its merged palette and animation. */
  recolorWithAnimationOf(texture: TextureImage): TextureImage {
    return this.recolorWithAnimation(
      [Palette.fromImage(texture)],
      texture.mcMeta,
    );
  }
}

// ── SpriteUtils ──────────────────────────────────────────────────────────

/**
 * `SpriteUtils.extrapolateSignBlockPalette(Palette)`: for a 7-colour palette,
 * replaces the lightest with a saturated, brightened copy of the 5th colour
 * (`HSVtoRGB` grey bug included) and drops the 6th. In place.
 */
export function extrapolateSignBlockPalette(palette: Palette): void {
  const size = palette.size();
  if (size !== 7) return;
  const color = palette.get(size - 3);
  const hsv = color.rgb.asHSV();
  const inc = f(1 / f(0.94));
  const next = PaletteColor.of(
    new HSVColor(
      hsv.hue,
      clamp(f(hsv.saturation * inc), 0, 1),
      clamp(f(hsv.value * inc), 0, 1),
      hsv.alpha,
    ),
  );
  next.occurrence = color.occurrence;
  palette.set(size - 1, next);
  palette.removeAt(size - 2);
}

/** `SpriteUtils.extrapolateSignBlockPalette(TextureImage)`: per frame, tolerance 1/300. */
export function extrapolateSignBlockPalettes(
  planksTexture: TextureImage,
): Palette[] {
  const palettes = Palette.fromAnimatedImage(planksTexture, null, f(1 / 300));
  for (const p of palettes) extrapolateSignBlockPalette(p);
  return palettes;
}

/**
 * `SpriteUtils.extrapolateWoodItemPalette(Palette)`: replaces the darkest
 * colour with a more saturated (×1.11), darker (×0.94) copy. In place.
 */
export function extrapolateWoodItemPalette(palette: Palette): void {
  const color = palette.get(0);
  const hsv = color.rgb.asHSV();
  const next = PaletteColor.of(
    new HSVColor(
      hsv.hue,
      clamp(f(hsv.saturation * f(1.11)), 0, 1),
      clamp(f(hsv.value * f(0.94)), 0, 1),
      hsv.alpha,
    ),
  );
  next.occurrence = color.occurrence;
  palette.set(0, next);
}

/** `SpriteUtils.extrapolateWoodItemPalette(TextureImage)`: first frame only. */
export function extrapolateWoodItemPaletteOf(
  planksTexture: TextureImage,
): Palette {
  const palette = Palette.fromAnimatedImage(
    planksTexture,
    null,
    BASE_TOLERANCE,
  )[0];
  extrapolateWoodItemPalette(palette);
  return palette;
}
