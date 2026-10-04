// Port of Moonlight Lib's `TextureImage`, `PixelContext`, `McMetaFile` and
// the `TextureOps` operations the Every Compat pipeline uses
// (`createSingleFrameAnimation`, `applyOverlay`, `applyOverlayOnExisting`,
// `applyMask`), from https://github.com/MehVahdJukaar/Moonlight (branch 1.21,
// commit 72afa38c8b7f5c05639644fdabc92d5254924732). Moonlight Lib is by
// MehVahdJukaar and the Supplementaries Team, under the Supplementaries Team
// License; this port is a derivative of it under the same terms.
//
// Also reimplemented, from their documented 1.21.1 behaviour (no Minecraft
// jar is read): `AnimationMetadataSection` and its serializer (frame list,
// `frametime`, `width`/`height`, `interpolate`, `calculateFrameSize`,
// `forEachFrame`), `AbstractPackResources.getMetadataFromStream` (an invalid
// `animation` section is logged and read as absent) and
// `NativeImage.blendPixel`.
//
// A texture is an `RgbaImage` (RGBA bytes) plus its parsed `.png.mcmeta`.
// Pixels are handled as `NativeImage` ABGR ints (`r | g << 8 | b << 16 |
// a << 24`). A texture with an `animation` section is a grid of frames
// (`frameWidth` × `frameHeight`, row-major).
//
// Worker-safe: no DOM access.

import type { RgbaImage } from "../../../../render/block-appearance";
import type { GeneratedTextureImage } from "../../types";
import { javaInt } from "./mth";

const f = Math.fround;

/** A JSON object as Gson's `JsonObject` holds it (insertion-ordered). */
export type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepCopy<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// ── AnimationMetadataSection ─────────────────────────────────────────────

/** `AnimationFrame`: `time` is -1 when the frame uses the default time. */
export interface AnimationFrame {
  index: number;
  time: number;
}

/** Vanilla's `AnimationMetadataSection` (`UNKNOWN_SIZE` = -1). */
export class AnimationSection {
  constructor(
    readonly frames: readonly AnimationFrame[],
    readonly frameWidth: number,
    readonly frameHeight: number,
    readonly defaultFrameTime: number,
    readonly interpolate: boolean,
  ) {}

  /** `calculateFrameSize(width, height)`. */
  calculateFrameSize(width: number, height: number): [number, number] {
    if (this.frameWidth !== -1) {
      return [
        this.frameWidth,
        this.frameHeight !== -1 ? this.frameHeight : height,
      ];
    }
    if (this.frameHeight !== -1) return [width, this.frameHeight];
    const size = Math.min(width, height);
    return [size, size];
  }

  /** `forEachFrame`: the explicit frame list only, times resolved. */
  forEachFrame(fn: (index: number, time: number) => void): void {
    for (const frame of this.frames) {
      fn(frame.index, frame.time === -1 ? this.defaultFrameTime : frame.time);
    }
  }
}

/** `GsonHelper.convertToInt`: a JSON number, truncated like Gson does. */
function jsonInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Expected ${name} to be an int`);
  }
  return javaInt(v);
}

function getAsInt(obj: JsonObject, key: string, fallback?: number): number {
  if (!(key in obj)) {
    if (fallback === undefined)
      throw new Error(`Missing ${key}, expected an int`);
    return fallback;
  }
  return jsonInt(obj[key], key);
}

/** `GsonHelper.getAsBoolean(obj, key, false)` (`JsonPrimitive.getAsBoolean`). */
function getAsBoolean(obj: JsonObject, key: string): boolean {
  if (!(key in obj)) return false;
  const v = obj[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  if (typeof v === "number") return false;
  throw new Error(`Expected ${key} to be a Boolean`);
}

function validatePositive(v: number, what: string): void {
  if (v < 1) throw new Error(`Invalid ${what}`);
}

/** `AnimationMetadataSectionSerializer.fromJson`. */
function parseAnimation(json: JsonObject): AnimationSection {
  const frameTime = getAsInt(json, "frametime", 1);
  if (frameTime !== 1) validatePositive(frameTime, "default frame time");
  const frames: AnimationFrame[] = [];
  if ("frames" in json) {
    const list = json.frames;
    if (!Array.isArray(list)) throw new Error("Invalid animation->frames");
    list.forEach((el: unknown, i) => {
      if (
        typeof el === "number" ||
        typeof el === "string" ||
        typeof el === "boolean"
      ) {
        frames.push({ index: jsonInt(el, `frames[${i}]`), time: -1 });
      } else if (isObject(el)) {
        const time = getAsInt(el, "time", -1);
        if ("time" in el) validatePositive(time, "frame time");
        const index = getAsInt(el, "index");
        if (index < 0) throw new Error("Invalid frame index");
        frames.push({ index, time });
      }
      // Anything else (null, arrays) is skipped.
    });
  }
  const width = getAsInt(json, "width", -1);
  const height = getAsInt(json, "height", -1);
  if (width !== -1) validatePositive(width, "width");
  if (height !== -1) validatePositive(height, "height");
  return new AnimationSection(
    frames,
    width,
    height,
    frameTime,
    getAsBoolean(json, "interpolate"),
  );
}

// ── McMetaFile ───────────────────────────────────────────────────────────

const VANILLA_KEYS = [
  "animation",
  "frametime",
  "width",
  "height",
  "interpolate",
  "frames",
];

/**
 * `McMetaFile`: a parsed `.png.mcmeta`. `animation` is null when the file has
 * no (valid) `animation` section, e.g. connected-texture data only;
 * `moddedStuff` is everything else.
 */
export class McMetaFile {
  constructor(
    readonly animation: AnimationSection | null,
    readonly moddedStuff: JsonObject,
  ) {}

  /**
   * `McMetaFile.read`: from parsed `.png.mcmeta` JSON. Throws (like the
   * `IOException` Moonlight raises) when the JSON isn't an object.
   */
  static read(json: unknown): McMetaFile {
    if (!isObject(json)) throw new Error("mcmeta is not a JSON object");
    let animation: AnimationSection | null = null;
    if ("animation" in json) {
      // getMetadataFromStream logs and returns null on a bad section.
      try {
        const section = json.animation;
        if (!isObject(section)) throw new Error("animation is not an object");
        animation = parseAnimation(section);
      } catch {
        animation = null;
      }
    }
    const modded: JsonObject = {};
    for (const [k, v] of Object.entries(json)) {
      if (!VANILLA_KEYS.includes(k)) modded[k] = deepCopy(v);
    }
    return new McMetaFile(animation, modded);
  }

  /** `McMetaFile.merge(mostImportant, leastImportant)`. */
  static merge(
    mostImportant: McMetaFile | null,
    leastImportant: McMetaFile | null,
  ): McMetaFile | null {
    if (mostImportant === null && leastImportant === null) return null;
    if (leastImportant === null) return mostImportant;
    if (mostImportant === null) return leastImportant;
    if (!mostImportant.hasAnimation()) {
      return new McMetaFile(
        leastImportant.animation,
        mostImportant.moddedStuff,
      );
    }
    return mostImportant;
  }

  hasAnimation(): boolean {
    return this.animation !== null;
  }

  /** Highest explicit frame index + 1 (0 without a frame list). */
  requiredFrameCount(): number {
    if (this.animation === null) return 0;
    let highest = -1;
    this.animation.forEachFrame((i) => {
      highest = Math.max(highest, i);
    });
    return highest + 1;
  }

  /** `toJson()`: what `ResourceSink` writes as the `.png.mcmeta`. */
  toJson(): JsonObject {
    const obj = deepCopy(this.moddedStuff);
    const animation = this.animation;
    if (animation === null) return obj;
    const anim: JsonObject = {
      frametime: animation.defaultFrameTime,
      interpolate: animation.interpolate,
      height: animation.frameHeight,
      width: animation.frameWidth,
    };
    const frames: unknown[] = [];
    animation.forEachFrame((index, time) => {
      // forEachFrame resolves the time, so the bare-index branch never runs.
      frames.push(time !== -1 ? { time, index } : index);
    });
    if (frames.length > 0) anim.frames = frames;
    obj.animation = anim;
    return obj;
  }

  copy(): McMetaFile {
    return new McMetaFile(this.animation, deepCopy(this.moddedStuff));
  }

  /** `cloneWithSize`: frame times resolved, explicit frame size. */
  cloneWithSize(frameWidth: number, frameHeight: number): McMetaFile {
    const animation = this.animation;
    if (animation === null) return this.copy();
    const frames: AnimationFrame[] = [];
    animation.forEachFrame((index, time) => frames.push({ index, time }));
    return new McMetaFile(
      new AnimationSection(
        frames,
        frameWidth,
        frameHeight,
        animation.defaultFrameTime,
        animation.interpolate,
      ),
      deepCopy(this.moddedStuff),
    );
  }
}

// ── TextureImage ─────────────────────────────────────────────────────────

/** Per-pixel callback of `forEachPixel` (`PixelContext`). */
export type PixelVisitor = (
  frameIndex: number,
  frameX: number,
  frameY: number,
  globalX: number,
  globalY: number,
) => void;

/** `TextureImage`: ABGR pixels plus `.png.mcmeta`, split into frames. */
export class TextureImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Int32Array;
  readonly mcMeta: McMetaFile | null;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** All frames of the grid, used or not. */
  readonly frameCount: number;
  private readonly frameScale: number;

  constructor(
    width: number,
    height: number,
    pixels: Int32Array,
    mcMeta: McMetaFile | null,
  ) {
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.mcMeta = mcMeta;
    let [fw, fh] =
      mcMeta === null || mcMeta.animation === null
        ? [width, height]
        : mcMeta.animation.calculateFrameSize(width, height);
    if (fw <= 0 || fh <= 0 || fw > width || fh > height) {
      fw = width;
      fh = height;
    }
    this.frameWidth = fw;
    this.frameHeight = fh;
    let gridW = Math.floor(width / fw);
    let gridH = Math.floor(height / fh);
    if (gridW === 0 || gridH === 0) {
      gridW = 1;
      gridH = 1;
    }
    this.frameScale = gridW;
    this.frameCount = gridW * gridH;
  }

  /** `TextureImage.createNew`: transparent pixels. */
  static createNew(
    width: number,
    height: number,
    mcMeta: McMetaFile | null = null,
  ): TextureImage {
    if (width <= 0 || height <= 0) {
      throw new Error("Width and height must be positive integers");
    }
    return new TextureImage(
      width,
      height,
      new Int32Array(width * height),
      mcMeta,
    );
  }

  /** From RGBA bytes and parsed mcmeta (`TextureImage.open`). Throws on bad mcmeta. */
  static fromRgba(image: RgbaImage, meta?: unknown): TextureImage {
    const { width, height, data } = image;
    const pixels = new Int32Array(width * height);
    for (let i = 0; i < pixels.length; i++) {
      const o = i * 4;
      pixels[i] =
        data[o] |
        (data[o + 1] << 8) |
        (data[o + 2] << 16) |
        (data[o + 3] << 24);
    }
    return new TextureImage(
      width,
      height,
      pixels,
      meta === undefined || meta === null ? null : McMetaFile.read(meta),
    );
  }

  static fromGenerated(texture: GeneratedTextureImage): TextureImage {
    return TextureImage.fromRgba(texture.image, texture.meta);
  }

  toRgba(): RgbaImage {
    const data = new Uint8Array(this.pixels.length * 4);
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i];
      const o = i * 4;
      data[o] = c & 0xff;
      data[o + 1] = (c >> 8) & 0xff;
      data[o + 2] = (c >> 16) & 0xff;
      data[o + 3] = (c >>> 24) & 0xff;
    }
    return { width: this.width, height: this.height, data };
  }

  /** The PNG plus the `.png.mcmeta` JSON `ResourceSink` would write. */
  toGenerated(): GeneratedTextureImage {
    const out: GeneratedTextureImage = { image: this.toRgba() };
    if (this.mcMeta !== null) out.meta = this.mcMeta.toJson();
    return out;
  }

  getFrameStartX(frameIndex: number): number {
    return (frameIndex % this.frameScale) * this.frameWidth;
  }

  getFrameStartY(frameIndex: number): number {
    return Math.floor(frameIndex / this.frameScale) * this.frameHeight;
  }

  /** `NativeImage.getPixelRGBA`: throws outside the image. */
  getPixel(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      throw new RangeError(
        `(${x}, ${y}) outside of image bounds (${this.width}, ${this.height})`,
      );
    }
    return this.pixels[x + y * this.width];
  }

  setPixel(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      throw new RangeError(
        `(${x}, ${y}) outside of image bounds (${this.width}, ${this.height})`,
      );
    }
    this.pixels[x + y * this.width] = color;
  }

  getFramePixel(frameIndex: number, x: number, y: number): number {
    return this.getPixel(
      this.getFrameStartX(frameIndex) + x,
      this.getFrameStartY(frameIndex) + y,
    );
  }

  setFramePixel(frameIndex: number, x: number, y: number, color: number): void {
    this.setPixel(
      this.getFrameStartX(frameIndex) + x,
      this.getFrameStartY(frameIndex) + y,
      color,
    );
  }

  /** `sample(x, y)`: nearest pixel, clamped over the whole image. */
  sample(x: number, y: number): number {
    const ix = clampInt(Math.round(f(x)), 0, this.width - 1);
    const iy = clampInt(Math.round(f(y)), 0, this.height - 1);
    return this.getPixel(ix, iy);
  }

  /** `NativeImage.blendPixel`. */
  blendPixel(x: number, y: number, color: number): void {
    this.setPixel(x, y, blendColors(this.getPixel(x, y), color));
  }

  /** Every pixel of every frame: frame by frame, then row-major. */
  forEachPixel(fn: PixelVisitor): void {
    for (let frame = 0; frame < this.frameCount; frame++) {
      const xOff = this.getFrameStartX(frame);
      const yOff = this.getFrameStartY(frame);
      for (let y = 0; y < this.frameHeight; y++) {
        for (let x = 0; x < this.frameWidth; x++)
          fn(frame, x, y, x + xOff, y + yOff);
      }
    }
  }

  makeCopy(): TextureImage {
    return this.makeCopyWithMetadata(this.mcMeta);
  }

  makeCopyWithMetadata(mcMeta: McMetaFile | null): TextureImage {
    return new TextureImage(
      this.width,
      this.height,
      this.pixels.slice(),
      mcMeta,
    );
  }
}

/** `Mth.clamp(int, int, int)`. */
function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : Math.min(v, max);
}

/**
 * `NativeImage.blendPixel`'s maths: float source-over where the output alpha
 * is `sa² + da·(1 − sa)` (sic), channels truncated by `(int)(v * 255)`.
 */
export function blendColors(dst: number, src: number): number {
  const sa = f((src >>> 24) / 255);
  const sb = f(((src >> 16) & 0xff) / 255);
  const sg = f(((src >> 8) & 0xff) / 255);
  const sr = f((src & 0xff) / 255);
  const da = f((dst >>> 24) / 255);
  const db = f(((dst >> 16) & 0xff) / 255);
  const dg = f(((dst >> 8) & 0xff) / 255);
  const dr = f((dst & 0xff) / 255);
  const inv = f(1 - sa);
  let a = f(f(sa * sa) + f(da * inv));
  let b = f(f(sb * sa) + f(db * inv));
  let g = f(f(sg * sa) + f(dg * inv));
  let r = f(f(sr * sa) + f(dr * inv));
  if (a > 1) a = 1;
  if (b > 1) b = 1;
  if (g > 1) g = 1;
  if (r > 1) r = 1;
  const ai = javaInt(f(a * 255));
  const bi = javaInt(f(b * 255));
  const gi = javaInt(f(g * 255));
  const ri = javaInt(f(r * 255));
  return (
    ((ai & 255) << 24) | ((bi & 255) << 16) | ((gi & 255) << 8) | (ri & 255)
  );
}

// ── TextureOps ───────────────────────────────────────────────────────────

/**
 * `TextureOps.createSingleFrameAnimation`: `length` copies of frame 0 stacked
 * vertically, with `animationData` resized to this frame size.
 */
export function createSingleFrameAnimation(
  img: TextureImage,
  length: number,
  animationData: McMetaFile,
): TextureImage {
  if (length <= 0) throw new Error("Length must be greater than 0");
  const meta = animationData.cloneWithSize(img.frameWidth, img.frameHeight);
  if (length === 1) return img.makeCopyWithMetadata(meta);
  const out = TextureImage.createNew(
    img.frameWidth,
    img.frameHeight * length,
    meta,
  );
  out.forEachPixel((_frame, x, y, gx, gy) => {
    out.setPixel(gx, gy, img.getFramePixel(0, x, y));
  });
  return out;
}

function applyOverlayImpl(
  base: TextureImage,
  onlyOnExisting: boolean,
  overlays: readonly TextureImage[],
): void {
  for (const overlay of overlays) {
    if (overlay.frameWidth < base.frameWidth) {
      throw new Error(
        `Overlay width too small (overlay W: ${overlay.frameWidth}, base W: ${base.frameWidth})`,
      );
    }
    if (overlay.frameHeight < base.frameHeight) {
      throw new Error(
        `Overlay height too small (overlay H: ${overlay.frameHeight}, base H: ${base.frameHeight})`,
      );
    }
  }
  for (const overlay of overlays) {
    base.forEachPixel((frame, x, y, gx, gy) => {
      const overlayFrame = Math.min(frame, overlay.frameCount - 1);
      const pixel = overlay.getFramePixel(overlayFrame, x, y);
      if (onlyOnExisting && pixel >>> 24 === 0) return;
      base.blendPixel(gx, gy, pixel);
    });
  }
}

/** `TextureOps.applyOverlay`: throws when an overlay frame is smaller. */
export function applyOverlay(
  base: TextureImage,
  ...overlays: TextureImage[]
): void {
  applyOverlayImpl(base, false, overlays);
}

/** `TextureOps.applyOverlayOnExisting`: skips transparent overlay pixels. */
export function applyOverlayOnExisting(
  base: TextureImage,
  ...overlays: TextureImage[]
): void {
  applyOverlayImpl(base, true, overlays);
}

/**
 * `TextureOps.applyMask` (`discardOpaque` = true) / `applyMaskInverted`:
 * clears pixels where the mask is opaque (or transparent). A mask whose frame
 * is smaller than the image's is ignored.
 */
export function applyMask(
  img: TextureImage,
  mask: TextureImage,
  discardOpaque = true,
): void {
  if (mask.frameWidth < img.frameWidth || mask.frameHeight < img.frameHeight)
    return;
  const maskFrames = mask.frameCount;
  img.forEachPixel((frame, x, y, gx, gy) => {
    const maskOpaque =
      mask.getFramePixel(frame % maskFrames, x, y) >>> 24 !== 0;
    if (maskOpaque === discardOpaque) img.setPixel(gx, gy, 0);
  });
}
