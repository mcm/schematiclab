import { describe, expect, it } from "vitest";

import { RGBColor } from "../colors";
import { Palette } from "../palette";
import { extrapolateSignBlockPalettes, Respriter } from "../respriter";
import { applyOverlay } from "../texture-image";
import { GOLDENS, img, makePlanks, makeRespriteInputs } from "./fixtures";

// Goldens from the real Moonlight `Respriter` on HotSpot (see fixtures.ts).
// Planks 3 is a 3-frame animated target (16x48, frametime 2, frames
// [{0, 3}, 2, 1]); the others are static.

const planks = makePlanks();
const { src, mask, srcAnim, src2, overlay } = makeRespriteInputs();

describe("Respriter", () => {
  planks.forEach((target, i) => {
    const palettes = Palette.fromAnimatedImage(target);
    const meta = target.mcMeta;

    it(`recolours a plain texture like Java (planks ${i})`, () => {
      expect(img(Respriter.of(src).recolorWithAnimation(palettes, meta))).toBe(
        GOLDENS[`resprite.of.${i}`],
      );
      expect(img(Respriter.of(src).recolor(palettes))).toBe(
        GOLDENS[`resprite.of.noanim.${i}`],
      );
    });

    it(`recolours through a mask like Java (planks ${i})`, () => {
      expect(
        img(Respriter.masked(src, mask).recolorWithAnimation(palettes, meta)),
      ).toBe(GOLDENS[`resprite.masked.${i}`]);
    });

    it(`keeps an animated source's own animation (planks ${i})`, () => {
      expect(
        img(Respriter.of(srcAnim).recolorWithAnimation(palettes, meta)),
      ).toBe(GOLDENS[`resprite.anim.${i}`]);
    });

    it(`copyTexture and merged palettes match Java (planks ${i})`, () => {
      const copy = Respriter.ofPalette(
        src,
        Palette.ofColors([RGBColor.fromInt(0)]),
      );
      expect(img(copy.recolorWithAnimation(palettes, meta))).toBe(
        GOLDENS[`resprite.copy.${i}`],
      );
      const global = Palette.empty();
      global.addAll(Palette.fromImage(src, null, 0).values);
      global.addAll(Palette.fromImage(src2, mask, 0).values);
      expect(
        img(
          Respriter.ofPalette(src2, global).recolorWithAnimation(
            palettes,
            meta,
          ),
        ),
      ).toBe(GOLDENS[`resprite.merged.${i}`]);
    });

    it(`sign palettes and overlays match Java (planks ${i})`, () => {
      expect(
        img(
          Respriter.of(src).recolorWithAnimation(
            extrapolateSignBlockPalettes(target),
            meta,
          ),
        ),
      ).toBe(GOLDENS[`resprite.sign.${i}`]);
      const out = Respriter.masked(src, mask).recolorWithAnimation(
        palettes,
        meta,
      );
      applyOverlay(out, overlay);
      expect(img(out)).toBe(GOLDENS[`resprite.overlay.${i}`]);
    });
  });

  it("turns a static texture into the target's animation", () => {
    const out = Respriter.of(src).recolorWithAnimation(
      Palette.fromAnimatedImage(planks[3]),
      planks[3].mcMeta,
    );
    expect(out.height).toBe(48);
    expect(out.frameCount).toBe(3);
    expect(out.toGenerated().meta).toEqual({
      animation: {
        frametime: 2,
        interpolate: false,
        height: 16,
        width: 16,
        frames: [
          { time: 3, index: 0 },
          { time: 2, index: 2 },
          { time: 2, index: 1 },
        ],
      },
    });
  });

  it("leaves pixels under an opaque mask alone", () => {
    const out = Respriter.masked(src, mask).recolor(
      Palette.fromAnimatedImage(planks[0]),
    );
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 6; x++)
        expect(out.getPixel(x, y)).toBe(src.getPixel(x, y));
    }
  });

  it("refuses an empty source palette", () => {
    const empty = src.makeCopy();
    empty.pixels.fill(0);
    expect(() => Respriter.of(empty)).toThrow();
  });
});
