// Per-texture generation of Every Compat's
// `net.mehvahdjukaar.every_compat.misc.TextureGenHelper.generateDefault`
// (the work done for one `TextureInfo` and one block type), plus the texture
// predicates of `CompatSpritesHelper` (`LOOKS_LIKE_TOP_LOG_TEXTURE`,
// `LOOKS_LIKE_SIDE_LOG_TEXTURE`, `LOOKS_LIKE_LEAF_TEXTURE`, `normalizeLabel`)
// that the caller's `findFirstBlockTextureLocation` port needs.
//
// From Every Compat (https://github.com/MehVahdJukaar/WoodGood, branch 1.21,
// commit 556d936) on Moonlight Lib (https://github.com/MehVahdJukaar/Moonlight,
// branch 1.21, commit 72afa38c8b7f5c05639644fdabc92d5254924732), both by
// MehVahdJukaar and the Supplementaries Team, under the Supplementaries Team
// License; this port is a derivative of them under the same terms.
//
// Java differences, by design:
// - Java aborts the whole entry set when any texture's source palette is
//   empty (a fully transparent or fully masked texture). Here only this
//   texture and its merged group are checked; the caller decides the rest.
// - `CompatSpritesHelper.maybePostProcessWoodTexture` (flower, lava and vine
//   overlays for three specific woods) isn't ported.
// - Resource-pack precedence (`addTextureIfNotPresent`) is the caller's.
//
// Worker-safe: no DOM access.

import type { GeneratedTextureImage } from "../../types";
import { RGBColor } from "./colors";
import { BASE_TOLERANCE, Palette } from "./palette";
import { Respriter } from "./respriter";
import { paletteStrategy, type TexturePredicateKind } from "./strategies";
import { applyOverlay, TextureImage } from "./texture-image";

/** A texture of a merged-palette entry set, with its mask if it has one. */
export interface EcMergedTexture {
  texture: string;
  mask?: string;
}

export interface EcTextureParams {
  /** Texture id of the mask (`sources` holds it). Transparent mask pixels are recoloured. */
  mask?: string;
  /** Texture id of an overlay blended on top after recolouring. */
  overlay?: string;
  /** `copyTexture`: only fully transparent black pixels change (to the planks' average). */
  copyTexture?: boolean;
  /** `noAnimation`: don't adopt the target texture's animation. */
  noAnimation?: boolean;
  /**
   * Merged palette (`useMergedPalette`): every non-copy texture of the entry
   * set, in the order Java visits them, this texture included. Their exact
   * colours (each under its own mask) form one palette that this texture is
   * recoloured with; this texture's own mask is then not applied.
   */
  mergedWith?: ReadonlyArray<string | EcMergedTexture>;
  /** Target palette source texture id (the type's child texture chosen by the caller). */
  target: string;
  /** Strategy key (`strategies.ts`). */
  strategy: string;
  /** The block type id (`ns:name`), for strategies with special cases. */
  typeId: string;
}

function open(
  sources: ReadonlyMap<string, GeneratedTextureImage>,
  id: string,
): TextureImage | null {
  const texture = sources.get(id);
  if (texture === undefined) return null;
  try {
    return TextureImage.fromGenerated(texture);
  } catch {
    return null;
  }
}

/** The respriter Java builds for this `TextureInfo`, or null to skip. */
function makeRespriter(
  main: TextureImage,
  sources: ReadonlyMap<string, GeneratedTextureImage>,
  params: EcTextureParams,
): Respriter | null {
  if (params.copyTexture) {
    return Respriter.ofPalette(main, Palette.ofColors([RGBColor.fromInt(0)]));
  }
  if (params.mergedWith !== undefined && params.mergedWith.length > 0) {
    const global = Palette.empty();
    for (const entry of params.mergedWith) {
      const { texture, mask } =
        typeof entry === "string" ? { texture: entry, mask: undefined } : entry;
      const image = open(sources, texture);
      if (image === null) continue; // IOException: that texture is skipped
      let maskImage: TextureImage | null = null;
      if (mask !== undefined) {
        maskImage = open(sources, mask);
        if (maskImage === null) continue;
      }
      // Throws on an empty palette, which aborts the whole set in Java.
      global.addAll(Palette.fromImage(image, maskImage, 0).values);
    }
    return Respriter.ofPalette(main, global);
  }
  if (params.mask !== undefined) {
    const mask = open(sources, params.mask);
    if (mask === null) return null;
    return Respriter.masked(main, mask);
  }
  return Respriter.of(main);
}

/**
 * Recolours `main` for one block type as `TextureGenHelper.generateDefault`
 * does: the source palette (exact colours, masked or merged) is mapped by
 * luminance rank onto the target palette the strategy derives from
 * `sources.get(params.target)`, frame by frame, adopting the target's
 * animation unless `noAnimation`; then the overlay is applied (an overlay
 * that's missing or too small is skipped). Returns the PNG pixels and the
 * `.png.mcmeta` JSON `ResourceSink` writes, or null where Java skips the
 * texture (a missing or unreadable source, mask or target, an unknown
 * strategy, an empty palette or a strategy that fails).
 */
export function generateEcTexture(
  main: GeneratedTextureImage,
  sources: ReadonlyMap<string, GeneratedTextureImage>,
  params: EcTextureParams,
): GeneratedTextureImage | null {
  try {
    const spec = paletteStrategy(params.strategy);
    if (spec === undefined) return null;
    const mainImage = TextureImage.fromGenerated(main);
    const respriter = makeRespriter(mainImage, sources, params);
    if (respriter === null) return null;

    const target = open(sources, params.target);
    if (target === null) return null;
    const palettes = Palette.fromAnimatedImage(
      target,
      null,
      spec.tolerance ?? BASE_TOLERANCE,
    );
    spec.transform?.(palettes, params.typeId);
    if (palettes.length === 0) return null;

    const image = params.noAnimation
      ? respriter.recolor(palettes)
      : respriter.recolorWithAnimation(palettes, target.mcMeta);

    if (params.overlay !== undefined) {
      const overlay = open(sources, params.overlay);
      if (overlay !== null) {
        try {
          applyOverlay(image, overlay);
        } catch {
          // Too small: Java logs it and keeps the image without the overlay.
        }
      }
    }
    return image.toGenerated();
  } catch {
    return null;
  }
}

// ── Texture predicates (CompatSpritesHelper) ──────────────────────────────

function isValidPathChar(c: string): boolean {
  return (
    c === "_" ||
    c === "-" ||
    (c >= "a" && c <= "z") ||
    (c >= "0" && c <= "9") ||
    c === "/" ||
    c === "."
  );
}

function isValidNamespaceChar(c: string): boolean {
  return (
    c === "_" ||
    c === "-" ||
    (c >= "a" && c <= "z") ||
    (c >= "0" && c <= "9") ||
    c === "."
  );
}

/** `ResourceLocation.tryParse(s)`'s path, or null when `s` isn't a valid id. */
export function tryParseResourcePath(s: string): string | null {
  const i = s.indexOf(":");
  const path = i >= 0 ? s.slice(i + 1) : s;
  if (![...path].every(isValidPathChar)) return null;
  if (i > 0 && ![...s.slice(0, i)].every(isValidNamespaceChar)) return null;
  return path;
}

/** `CompatSpritesHelper.normalizeLabel`: the id's path, or `s` without `#`. */
export function normalizeLabel(s: string): string {
  const path = tryParseResourcePath(s);
  return path === null ? s.replaceAll("#", "") : path;
}

/** `LOOKS_LIKE_TOP_LOG_TEXTURE`. */
export function looksLikeTopLogTexture(label: string): boolean {
  const s = normalizeLabel(label);
  if (s.includes("_overlay")) return false;
  return s.includes("_top") || s.includes("_end") || s.includes("_up");
}

/** `LOOKS_LIKE_SIDE_LOG_TEXTURE`. */
export function looksLikeSideLogTexture(label: string): boolean {
  const s = normalizeLabel(label);
  return (
    !looksLikeTopLogTexture(s) &&
    !(s.includes("_overlay") && !s.includes("_leaves"))
  );
}

/** `LOOKS_LIKE_LEAF_TEXTURE`. */
export function looksLikeLeafTexture(label: string): boolean {
  const s = normalizeLabel(label);
  return (
    !s.includes("_top") &&
    !s.includes("_bushy") &&
    !s.includes("_snow") &&
    !s.includes("_overlay") &&
    !s.includes("/snow")
  );
}

/** The predicate of a strategy's `predicate` kind ("any" accepts everything). */
export function texturePredicate(
  kind: TexturePredicateKind,
): (label: string) => boolean {
  switch (kind) {
    case "top":
      return looksLikeTopLogTexture;
    case "side":
      return looksLikeSideLogTexture;
    case "leaf":
      return looksLikeLeafTexture;
    default:
      return () => true;
  }
}
