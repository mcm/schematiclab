import { describe, expect, it } from "vitest";

import {
  applyMask,
  applyOverlayOnExisting,
  blendColors,
  createSingleFrameAnimation,
  McMetaFile,
  TextureImage,
} from "../texture-image";
import { hex } from "./fixtures";

const rgba = (width: number, height: number, fill: number[]) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
};

describe("McMetaFile", () => {
  it("splits the animation from modded data and writes it back", () => {
    const m = McMetaFile.read({
      ctm: { method: "random" },
      animation: {
        frametime: 3,
        frames: [1, { index: 0, time: 5 }],
        interpolate: true,
      },
      frametime: 9,
    });
    expect(m.moddedStuff).toEqual({ ctm: { method: "random" } });
    expect(m.requiredFrameCount()).toBe(2);
    expect(m.toJson()).toEqual({
      ctm: { method: "random" },
      animation: {
        frametime: 3,
        interpolate: true,
        height: -1,
        width: -1,
        frames: [
          { time: 3, index: 1 },
          { time: 5, index: 0 },
        ],
      },
    });
    expect(Object.keys(m.toJson())).toEqual(["ctm", "animation"]);
  });

  it("reads a bad animation section as no animation", () => {
    expect(
      McMetaFile.read({ animation: { frametime: 0 } }).hasAnimation(),
    ).toBe(false);
    expect(McMetaFile.read({ animation: { frames: "x" } }).hasAnimation()).toBe(
      false,
    );
    expect(McMetaFile.read({ animation: 3, x: 1 }).toJson()).toEqual({ x: 1 });
    expect(() => McMetaFile.read([1])).toThrow();
  });

  it("merges: a static source adopts the target's animation", () => {
    const ctm = McMetaFile.read({ ctm: 1 });
    const anim = McMetaFile.read({ animation: {}, other: 2 });
    const merged = McMetaFile.merge(ctm, anim)!;
    expect(merged.toJson()).toEqual({
      ctm: 1,
      animation: { frametime: 1, interpolate: false, height: -1, width: -1 },
    });
    expect(McMetaFile.merge(anim, ctm)).toBe(anim);
    expect(McMetaFile.merge(null, ctm)).toBe(ctm);
    expect(McMetaFile.merge(null, null)).toBeNull();
  });
});

describe("TextureImage", () => {
  it("lays frames out from the mcmeta", () => {
    const square = TextureImage.fromRgba(rgba(16, 64, [1, 2, 3, 255]), {
      animation: {},
    });
    expect([square.frameWidth, square.frameHeight, square.frameCount]).toEqual([
      16, 16, 4,
    ]);
    const sized = TextureImage.fromRgba(rgba(32, 16, [0, 0, 0, 0]), {
      animation: { width: 8, height: 8 },
    });
    expect([
      sized.frameWidth,
      sized.frameCount,
      sized.getFrameStartX(5),
      sized.getFrameStartY(5),
    ]).toEqual([8, 8, 8, 8]);
    const tooBig = TextureImage.fromRgba(rgba(16, 16, [0, 0, 0, 0]), {
      animation: { width: 32 },
    });
    expect(tooBig.frameCount).toBe(1);
    const noAnim = TextureImage.fromRgba(rgba(16, 32, [0, 0, 0, 0]), {
      ctm: true,
    });
    expect(noAnim.frameCount).toBe(1);
  });

  it("round-trips RGBA bytes through ABGR ints", () => {
    const t = TextureImage.fromRgba(rgba(2, 1, [0x11, 0x22, 0x33, 0x44]));
    expect(hex(t.getPixel(1, 0))).toBe("44332211");
    expect(Array.from(t.toRgba().data)).toEqual([
      0x11, 0x22, 0x33, 0x44, 0x11, 0x22, 0x33, 0x44,
    ]);
    expect(() => t.getPixel(2, 0)).toThrow(RangeError);
  });

  it("samples clamped over the whole image", () => {
    const t = new TextureImage(2, 2, Int32Array.from([1, 2, 3, 4]), null);
    expect(t.sample(5, 5)).toBe(4);
    expect(t.sample(-1, 0)).toBe(1);
  });

  it("stacks frame 0 for createSingleFrameAnimation", () => {
    const meta = McMetaFile.read({ animation: { frames: [0, 1, 2] } });
    const t = new TextureImage(
      2,
      4,
      Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      null,
    );
    const out = createSingleFrameAnimation(t, 3, meta);
    expect([out.width, out.height, out.frameCount]).toEqual([2, 12, 3]);
    expect(Array.from(out.pixels)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(out.mcMeta?.animation?.frameHeight).toBe(4);
  });

  it("blends like NativeImage.blendPixel (sa² alpha, truncation)", () => {
    // Half-transparent white over opaque black: alpha sa² + da(1 − sa) = 0.75.
    expect(hex(blendColors(0xff000000 | 0, 0x80ffffff | 0))).toBe("bf808080");
    // Over transparent: alpha is sa², colours scaled by sa.
    expect(hex(blendColors(0, 0x80ffffff | 0))).toBe("40808080");
    expect(hex(blendColors(0x12345678, 0xff0000ff | 0))).toBe("ff0000ff");
    expect(hex(blendColors(0x12345678, 0))).toBe("12345678");
  });

  it("applies masks and on-existing overlays", () => {
    const t = new TextureImage(
      2,
      1,
      Int32Array.from([0xff112233 | 0, 0xff445566 | 0]),
      null,
    );
    const mask = new TextureImage(
      2,
      1,
      Int32Array.from([0xff000000 | 0, 0]),
      null,
    );
    applyMask(t, mask);
    expect(Array.from(t.pixels).map(hex)).toEqual(["0", "ff445566"]);
    const ov = new TextureImage(
      2,
      1,
      Int32Array.from([0, 0xff0000ff | 0]),
      null,
    );
    applyOverlayOnExisting(t, ov);
    expect(Array.from(t.pixels).map(hex)).toEqual(["0", "ff0000ff"]);
  });
});
