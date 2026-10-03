import { describe, expect, it } from "vitest";

import type { RgbaImage } from "../../../../render/block-appearance";
import type { GeneratedTextureImage } from "../../types";
import {
  asInt,
  fromInt,
  LABtoXYZ,
  sRGBtoLuma,
  sRGBtoXYZ,
  XYZtoLAB,
  XYZtosRGB,
} from "../colorspace";
import {
  argbPixels,
  calculateContrast,
  generateUcwTexture,
  transformUcwFrame,
  transformUcwTexture,
} from "../recolour";
import { UCW_PROVIDER } from "../provider";
import type { UcwBlendMode } from "../rules";

// Golden values come from running UCW 0.3.5's own Java on the same synthetic
// images: `UCWColorspaceUtils.java` copied verbatim (package line dropped),
// and `UCWMagic.transform` / `calculateContrast` copied verbatim with the
// `TextureAtlasSprite` accessors replaced by int[] arrays and their sizes
// (JDK 21, `javac` + `java`). Floats were printed with `Float.toString`, which
// prints the shortest decimal that rounds back to the same float, so
// `Math.fround(<printed>)` is the exact Java value. Images were hashed with
// FNV-1a over each output `0xAARRGGBB` int's bytes, low byte first.

const f = Math.fround;

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function fnv1a(img: RgbaImage): string {
  let hash = 0x811c9dc5;
  for (const v of argbPixels(img)) {
    for (let k = 0; k < 4; k++) {
      hash ^= (v >>> (8 * k)) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function argbAt(img: RgbaImage, index: number): string {
  return `0x${(argbPixels(img)[index] >>> 0).toString(16).padStart(8, "0")}`;
}

const tex = (img: RgbaImage, meta?: unknown): GeneratedTextureImage =>
  meta === undefined ? { image: img } : { image: img, meta };

// Grey ramp; pixel (0,0) is half transparent and (15,15) fully transparent,
// to check the through alpha survives.
const THROUGH = image(16, 16, (x, y) => {
  const v = 40 + 10 * x + 3 * y;
  const a = x === 0 && y === 0 ? 0x80 : x === 15 && y === 15 ? 0 : 0xff;
  return [v, v, v, a];
});
const FROM = image(16, 16, (x, y) => [
  120 + 4 * x,
  80 + 2 * y,
  40 + (x ^ y),
  255,
]);
const OVERLAY = image(16, 16, (x, y) => [200 - 5 * y, 60 + 6 * x, 150, 255]);
const BASED_UPON = image(16, 16, (x, y) => {
  const v = 100 + 5 * ((x + y) % 16);
  return [v, v, v, 255];
});

describe("UCW colorspace", () => {
  it.each([
    // [rgb, luma / L, a, b] from Java
    [0x800080, 44.65765, 78.07877, -48.34119],
    [0x000000, 0, 0, 0],
    [0xffffff, 100, 0.012278557, -0.0018358231],
    [0x8b5a2b, 68.057816, 6.5042076, 28.851582],
    [0x2e7d32, 69.68844, -34.65128, 25.555908],
    [0x123456, 50.11947, -7.2639585, -22.503794],
  ])("matches Java's LAB and luma for %i", (rgb, l, a, b) => {
    const lab = XYZtoLAB(sRGBtoXYZ(fromInt(rgb)));
    expect(lab).toEqual([f(l), f(a), f(b)]);
    expect(sRGBtoLuma(fromInt(rgb))).toBe(f(l));
    // Java's round trip gives the colour back for each of these.
    expect(asInt(XYZtosRGB(LABtoXYZ(lab)))).toBe(rgb);
  });

  it("round-trips sRGB → XYZ → LAB → XYZ → sRGB within 1 per channel", () => {
    let worst = 0;
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const rgb = (r << 16) | (g << 8) | b;
          const back = asInt(
            XYZtosRGB(LABtoXYZ(XYZtoLAB(sRGBtoXYZ(fromInt(rgb))))),
          );
          for (const shift of [16, 8, 0]) {
            const diff = Math.abs(
              ((back >> shift) & 0xff) - ((rgb >> shift) & 0xff),
            );
            worst = Math.max(worst, diff);
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("ignores alpha when unpacking", () => {
    expect(fromInt(0x80123456 | 0)).toEqual(fromInt(0x123456));
  });

  it("clamps channels like asFF", () => {
    expect(asInt([1.5, -0.2, f(0.5)])).toBe((255 << 16) | (0 << 8) | 128);
    expect(asInt([Number.NaN, 0, 0])).toBe(0);
  });
});

describe("calculateContrast", () => {
  it("matches Java's [min, range] of the luma", () => {
    // Java: contrastFrom=[64.62496, 9.561012], contrastBased=[68.90721, 17.412025]
    expect(calculateContrast(argbPixels(FROM))).toEqual([
      f(64.62496),
      f(9.561012),
    ]);
    expect(calculateContrast(argbPixels(BASED_UPON))).toEqual([
      f(68.90721),
      f(17.412025),
    ]);
  });

  it("keeps Float.MIN_VALUE as the range of an all-black image", () => {
    // Java: black=[0.0, 1.4E-45] (the maximum starts at Float.MIN_VALUE).
    expect(calculateContrast([0xff000000 | 0])).toEqual([
      0, 1.401298464324817e-45,
    ]);
  });
});

describe("transformUcwFrame", () => {
  it.each<[UcwBlendMode, string, string, string, string, string]>([
    // [mode, FNV-1a, pixel 0, pixel 17, pixel 136, pixel 255] from Java
    [
      "none",
      "0xe269aad4",
      "0x807b1b59",
      "0xff822461",
      "0xff8d5d84",
      "0x007d9696",
    ],
    [
      "blend",
      "0x093e0260",
      "0x80512f13",
      "0xff5c3717",
      "0xff9a6231",
      "0x00cb8649",
    ],
    [
      "plank",
      "0x6327a071",
      "0x80522e15",
      "0xff5e3619",
      "0xff9a6231",
      "0x00ca8746",
    ],
  ])("matches Java in mode %s", (mode, hash, p0, p17, p136, p255) => {
    const out = transformUcwFrame(THROUGH, FROM, OVERLAY, BASED_UPON, mode);
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
    expect(fnv1a(out)).toBe(hash);
    expect([
      argbAt(out, 0),
      argbAt(out, 17),
      argbAt(out, 136),
      argbAt(out, 255),
    ]).toEqual([p0, p17, p136, p255]);
  });

  it("preserves the through pixel's alpha", () => {
    const out = transformUcwFrame(THROUGH, FROM, OVERLAY, BASED_UPON, "none");
    for (let i = 0; i < 256; i++) {
      expect(out.data[i * 4 + 3]).toBe(THROUGH.data[i * 4 + 3]);
    }
  });

  it("reads the overlay tiled by the from texture's size", () => {
    // Java: an 8×8 from with the 16×16 overlay reads overlay row-major with
    // width 8, so pixel 9 (x=9, y=0) uses overlay[1] and pixel 137 (x=9,
    // y=8) uses overlay[1] too.
    const from8 = image(8, 8, (x, y) => [
      120 + 8 * x,
      80 + 4 * y,
      40 + 2 * (x ^ y),
      255,
    ]);
    const out = transformUcwFrame(THROUGH, from8, OVERLAY, BASED_UPON, "none");
    expect(fnv1a(out)).toBe("0x0a3759a8");
    expect(argbAt(out, 9)).toBe("0xffc54194");
    expect(argbAt(out, 137)).toBe("0xffd649a1");
  });

  it("uses the middle of from's range when basedUpon is flat", () => {
    // Java: a flat grey basedUpon has range 0, so normV = 0.5.
    const flat = image(16, 16, () => [90, 90, 90, 255]);
    const out = transformUcwFrame(THROUGH, FROM, OVERLAY, flat, "none");
    expect(fnv1a(out)).toBe("0x28fd1660");
    expect(argbAt(out, 0)).toBe("0x80d1409d");
  });

  it("throws, like Java, when the overlay is smaller than from", () => {
    const small = image(4, 4, () => [0, 0, 0, 255]);
    expect(() =>
      transformUcwFrame(THROUGH, FROM, small, BASED_UPON, "none"),
    ).toThrow(RangeError);
  });
});

describe("transformUcwTexture", () => {
  it("recolours each frame of an animated through texture", () => {
    const second = image(16, 16, (x, y) => [255 - x, 128, y, 255]);
    const strip: RgbaImage = {
      width: 16,
      height: 32,
      data: new Uint8Array([...THROUGH.data, ...second.data]),
    };
    const meta = { animation: { frametime: 2 } };
    // An animated from texture contributes its first frame only.
    const fromStrip: RgbaImage = {
      width: 16,
      height: 32,
      data: new Uint8Array([...FROM.data, ...second.data]),
    };
    const out = transformUcwTexture(
      tex(strip, meta),
      tex(fromStrip, meta),
      tex(OVERLAY),
      tex(BASED_UPON),
      "blend",
    );
    expect(out.meta).toEqual(meta);
    expect(out.image.width).toBe(16);
    expect(out.image.height).toBe(32);
    const frame0 = transformUcwFrame(
      THROUGH,
      FROM,
      OVERLAY,
      BASED_UPON,
      "blend",
    );
    const frame1 = transformUcwFrame(
      second,
      FROM,
      OVERLAY,
      BASED_UPON,
      "blend",
    );
    expect([...out.image.data.subarray(0, 1024)]).toEqual([...frame0.data]);
    expect([...out.image.data.subarray(1024)]).toEqual([...frame1.data]);
  });

  it("treats a texture without animation as one frame", () => {
    const out = transformUcwTexture(
      tex(THROUGH),
      tex(FROM),
      tex(OVERLAY),
      tex(BASED_UPON),
      "plank",
    );
    expect(out.meta).toBeUndefined();
    expect(fnv1a(out.image)).toBe("0x6327a071");
  });
});

describe("generateUcwTexture", () => {
  const sources = new Map<string, GeneratedTextureImage>([
    ["chisel:blocks/planks/oak/a", tex(THROUGH)],
    ["natura:blocks/nether_planks", tex(FROM)],
    ["natura:blocks/nether_planks_overlay", tex(OVERLAY)],
    ["minecraft:blocks/planks_oak", tex(BASED_UPON)],
  ]);
  const recipe = {
    id: "unlimitedchiselworks:generated/x",
    sources: [...sources.keys()],
    params: {
      through: "chisel:blocks/planks/oak/a",
      from: "natura:blocks/nether_planks",
      overlay: "natura:blocks/nether_planks_overlay",
      basedUpon: "minecraft:blocks/planks_oak",
      mode: "none",
    },
  };

  it("runs a recipe through the provider", () => {
    const out = UCW_PROVIDER.generateTexture(recipe, sources);
    expect(out).not.toBeNull();
    expect(fnv1a(out!.image)).toBe("0xe269aad4");
  });

  it("returns null for a missing source or bad params", () => {
    const partial = new Map(sources);
    partial.delete("natura:blocks/nether_planks");
    expect(generateUcwTexture(recipe, partial)).toBeNull();
    expect(
      generateUcwTexture(
        { ...recipe, params: { ...recipe.params, mode: "x" } },
        sources,
      ),
    ).toBeNull();
    expect(generateUcwTexture({ ...recipe, params: null }, sources)).toBeNull();
  });
});
