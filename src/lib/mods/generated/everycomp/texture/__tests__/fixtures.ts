// Synthetic inputs and formatting helpers shared with the Java golden
// generator. `moonlight-goldens.json` was produced by running the real
// Moonlight Lib classes (branch 1.21, commit 72afa38c) on HotSpot 21:
//
//   M=~/projects/moonlight/common/src/main/java/net/mehvahdjukaar/moonlight
//   # copied verbatim: api/util/math/colors/*.java and
//   #   api/resources/textures/{Palette,PaletteColor,Respriter,PixelContext}.java
//   # extracted verbatim: TextureOps.{applyOverlay,createSingleFrameAnimation},
//   #   SpriteUtils.extrapolate{SignBlock,WoodItem}Palette, MthUtils.signedAngleDiff
//   # stubbed: Mth (1.21.1 sin/cos/atan2/fastInvSqrt/rotLerp/wrapDegrees/clamp),
//   #   FastColor.ABGR32, AnimationMetadataSection/AnimationFrame/FrameSize,
//   #   McMetaFile (without Gson), TextureImage over an int[] (frame logic and
//   #   NativeImage.blendPixel as in 1.21.1), PlatHelper, Moonlight.LOGGER
//   # Gen.java builds the inputs below with the same xorshift32 PRNG, applies
//   #   the strategy lambdas copied from the Every Compat / Stone Zone / Gems
//   #   Realm sources and prints one golden per line.
//   javac -cp fastutil-8.5.12.jar -d out $(find src -name '*.java')
//   java -cp out:fastutil-8.5.12.jar net.mehvahdjukaar.moonlight.api.resources.textures.Gen > goldens.tsv
//
// Nothing here comes from a mod texture.

import { Palette } from "../palette";
import { AnimationSection, McMetaFile, TextureImage } from "../texture-image";
import goldens from "./moonlight-goldens.json";

export const GOLDENS = goldens as Record<string, string>;

/** xorshift32, as `Gen.next()`. */
export class Rng {
  constructor(private s: number) {}
  next(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s | 0;
    return this.s;
  }
  /** `next() >>> 1`. */
  pos(): number {
    return this.next() >>> 1;
  }
}

const c255 = (v: number) => Math.max(0, Math.min(255, v));
const idiv = (a: number, b: number) => Math.trunc(a / b);

export function abgr(a: number, b: number, g: number, r: number): number {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export function ramp(
  rng: Rng,
  n: number,
  R: number,
  G: number,
  B: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = 40 + (n === 1 ? 0 : idiv(60 * i, n - 1));
    const b = c255(idiv(B * k, 100) + (rng.pos() % 9) - 4);
    const g = c255(idiv(G * k, 100) + (rng.pos() % 9) - 4);
    const r = c255(idiv(R * k, 100) + (rng.pos() % 9) - 4);
    out.push(abgr(255, b, g, r));
  }
  return out;
}

export function pixels(
  rng: Rng,
  w: number,
  h: number,
  cols: number[],
  transparentPct: number,
): Int32Array {
  const px = new Int32Array(w * h);
  for (let i = 0; i < px.length; i++) {
    px[i] =
      rng.pos() % 100 < transparentPct ? 0 : cols[rng.pos() % cols.length];
  }
  return px;
}

export function anim(frametime: number, frames: number[][]): McMetaFile {
  return new McMetaFile(
    new AnimationSection(
      frames.map((fr) => ({
        index: fr[0],
        time: fr.length === 1 ? -1 : fr[1],
      })),
      -1,
      -1,
      frametime,
      false,
    ),
    {},
  );
}

export function tex(
  w: number,
  h: number,
  px: Int32Array,
  meta: McMetaFile | null,
): TextureImage {
  return new TextureImage(w, h, px, meta);
}

export const hex = (v: number) => (v >>> 0).toString(16);

const fbView = new DataView(new ArrayBuffer(4));
/** `Integer.toHexString(Float.floatToRawIntBits(v))`. */
export function fb(v: number): string {
  fbView.setFloat32(0, v);
  return fbView.getUint32(0).toString(16);
}

export function pal(p: Palette): string {
  return p.values.map((c) => `${hex(c.value)}:${c.occurrence}`).join(" ");
}

export function pals(ps: readonly Palette[]): string {
  return ps.map((p) => `[${pal(p)}]`).join("");
}

/** 64-bit FNV-1a over the little-endian bytes of `data`, as hex. */
export function fnv(data: ArrayLike<number>): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    for (let b = 0; b < 4; b++) {
      lo = (lo ^ ((v >>> (8 * b)) & 0xff)) >>> 0;
      // h *= 0x100000001b3 (mod 2^64) = h * 0x1b3 + (h << 40)
      const loMul = lo * 0x1b3;
      const carry = Math.floor(loMul / 0x100000000);
      const newLo = loMul >>> 0;
      const newHi = (hi * 0x1b3 + carry + ((lo << 8) >>> 0)) % 0x100000000;
      hi = newHi >>> 0;
      lo = newLo;
    }
  }
  return BigInt.asUintN(64, (BigInt(hi) << 32n) | BigInt(lo)).toString(16);
}

export function describeMeta(m: McMetaFile | null): string {
  if (m === null) return "null";
  const a = m.animation;
  if (a === null) return "noanim:";
  let frames = "";
  a.forEachFrame((i, t) => {
    frames += `${i}/${t},`;
  });
  return `anim ft=${a.defaultFrameTime} i=${a.interpolate} w=${a.frameWidth} h=${a.frameHeight} frames=${frames} m=`;
}

export function img(t: TextureImage): string {
  return `${t.width}x${t.height} f=${t.frameCount} ${fnv(t.pixels)} ${describeMeta(t.mcMeta)}`;
}

/** The five synthetic "planks" textures of `Gen.main` (seed 0xC0FFEE). */
export function makePlanks(): TextureImage[] {
  const rng = new Rng(0xc0ffee);
  const cols = [
    ramp(rng, 6, 180, 140, 90),
    ramp(rng, 9, 160, 100, 60),
    ramp(rng, 13, 200, 170, 120),
    ramp(rng, 20, 120, 80, 50),
    ramp(rng, 7, 150, 110, 70),
  ];
  return [
    tex(16, 16, pixels(rng, 16, 16, cols[0], 0), null),
    tex(16, 16, pixels(rng, 16, 16, cols[1], 0), null),
    tex(16, 16, pixels(rng, 16, 16, cols[2], 0), null),
    tex(16, 48, pixels(rng, 16, 48, cols[3], 0), anim(2, [[0, 3], [2], [1]])),
    tex(16, 16, pixels(rng, 16, 16, cols[4], 0), null),
  ];
}

/** The respriter inputs of `Gen.main` (seed 0xBADA55). */
export function makeRespriteInputs() {
  const rng = new Rng(0xbada55);
  const srcCols = ramp(rng, 10, 90, 160, 200);
  const src = tex(16, 16, pixels(rng, 16, 16, srcCols, 10), null);
  const maskPx = new Int32Array(256);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      maskPx[x + y * 16] = x < 6 ? 0xff000000 | 0 : 0;
  const mask = tex(16, 16, maskPx, null);
  const srcAnim = tex(
    16,
    32,
    pixels(rng, 16, 32, ramp(rng, 8, 200, 60, 60), 5),
    anim(5, []),
  );
  const src2 = tex(
    16,
    16,
    pixels(rng, 16, 16, ramp(rng, 5, 60, 200, 60), 20),
    null,
  );
  const ovPx = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    if (i % 3 === 0) {
      const a = rng.pos() % 256;
      const b = rng.pos() % 256;
      const g = rng.pos() % 256;
      const r = rng.pos() % 256;
      ovPx[i] = abgr(a, b, g, r);
    }
  }
  const overlay = tex(16, 16, ovPx, null);
  return { src, mask, srcAnim, src2, overlay };
}
