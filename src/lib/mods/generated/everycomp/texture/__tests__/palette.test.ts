import { describe, expect, it } from "vitest";

import { PaletteColor, RGBColor } from "../colors";
import { BASE_TOLERANCE, Palette } from "../palette";
import {
  extrapolateSignBlockPalettes,
  extrapolateWoodItemPaletteOf,
} from "../respriter";
import { TextureImage } from "../texture-image";
import { fb, GOLDENS, makePlanks, pal, pals } from "./fixtures";

// Goldens from the real Moonlight `Palette` on HotSpot (see fixtures.ts).

const planks = makePlanks();

describe("Palette extraction", () => {
  planks.forEach((image, i) => {
    it(`matches Java for synthetic planks ${i}`, () => {
      expect(pals(Palette.fromAnimatedImage(image))).toBe(
        GOLDENS[`planks.${i}.animated`],
      );
      expect(pal(Palette.fromImage(image, null, 0))).toBe(
        GOLDENS[`planks.${i}.exact`],
      );
      expect(pals(extrapolateSignBlockPalettes(image))).toBe(
        GOLDENS[`planks.${i}.sign`],
      );
      expect(pal(extrapolateWoodItemPaletteOf(image))).toBe(
        GOLDENS[`planks.${i}.item`],
      );
      const tol = Palette.fromImage(image, null, 0);
      tol.updateTolerance(0.02);
      expect(pal(tol)).toBe(GOLDENS[`planks.${i}.tol02`]);
    });
  });

  it("applies the sign transform only to 7-colour palettes", () => {
    // planks 4 has 7 colours at tolerance 1/300: one is dropped.
    const [sign] = extrapolateSignBlockPalettes(planks[4]);
    expect(sign.size()).toBe(6);
    expect(GOLDENS["planks.4.sign"].split(" ")).toHaveLength(6);
  });

  it("ignores a mask smaller than the image's frame", () => {
    const small = new TextureImage(
      8,
      8,
      new Int32Array(64).fill(0xff000000 | 0),
      null,
    );
    expect(pal(Palette.fromImage(planks[0], small, 0))).toBe(
      GOLDENS["planks.0.exact"],
    );
  });
});

describe("Palette.matchSize", () => {
  const sizes = [1, 2, 3, 5, 8, 12, 18, 25];
  const steps = [0.01, 0.03, 0.05, 0.08].map(Math.fround);
  planks.forEach((image, i) => {
    it(`matches Java (shrink and grow) for planks ${i}`, () => {
      const base = Palette.fromAnimatedImage(image)[0];
      for (const size of sizes) {
        for (const step of steps) {
          const c = base.copy();
          let result: string;
          try {
            c.matchSize(size, step);
            result = pal(c);
          } catch {
            result = "ERR";
          }
          expect(result, `match.${i}.${size}.${fb(step)}`).toBe(
            GOLDENS[`match.${i}.${size}.${fb(step)}`],
          );
        }
      }
      const c = base.copy();
      c.matchSize(12);
      expect(pal(c)).toBe(GOLDENS[`match.${i}.nostep12`]);
    });
  });

  it("matches Java for the two-colour arc and single-colour paths", () => {
    const two = new Palette([
      PaletteColor.of(0xff203040 | 0),
      PaletteColor.of(0xffa0b0c0 | 0),
    ]);
    two.matchSize(6);
    expect(pal(two)).toBe(GOLDENS["match.arc6"]);
    const one = new Palette([PaletteColor.of(0xff4070a0 | 0)], BASE_TOLERANCE);
    one.matchSize(5, 0.05);
    expect(pal(one)).toBe(GOLDENS["match.single5"]);
  });

  it("shrinks large palettes by occurrence, then by averaging", () => {
    const base = Palette.fromAnimatedImage(planks[3])[0];
    expect(base.size()).toBeGreaterThan(14);
    const c = base.copy();
    c.matchSize(5, 0.05);
    expect(c.size()).toBe(5);
    expect(base.size()).toBeGreaterThan(14); // copy() leaves the original alone
  });

  it("throws when (size - 1) * step exceeds 1", () => {
    const c = Palette.fromAnimatedImage(planks[0])[0];
    expect(() => c.matchSize(25, 0.05)).toThrow();
  });
});

describe("Palette basics", () => {
  it("dedupes ofColors by value (Java HashSet)", () => {
    const p = Palette.ofColors([
      RGBColor.fromInt(0xff112233 | 0),
      RGBColor.fromInt(0xff445566 | 0),
      RGBColor.fromInt(0xff112233 | 0),
      RGBColor.fromInt(0xff998877 | 0),
    ]);
    expect(pal(p)).toBe(GOLDENS.ofColors);
  });

  it("throws on bad indices like ArrayList", () => {
    const p = new Palette([PaletteColor.of(0xff102030 | 0)]);
    expect(() => p.get(1)).toThrow(RangeError);
    expect(() => p.increaseUp()).toThrow(RangeError);
    expect(() => p.increaseInner()).toThrow(RangeError);
  });

  it("keeps luminance order and rejects transparent colours", () => {
    const p = Palette.empty();
    expect(p.add(PaletteColor.of(0x00ffffff))).toBe(false);
    p.add(PaletteColor.of(0xffeeeeee | 0));
    p.add(PaletteColor.of(0xff111111 | 0));
    expect(p.getDarkest().value).toBe(0xff111111 | 0);
    expect(p.getLightest().value).toBe(0xffeeeeee | 0);
  });
});
