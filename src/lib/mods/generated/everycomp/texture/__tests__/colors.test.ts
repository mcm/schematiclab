import { describe, expect, it } from "vitest";

import { HCLColor, PaletteColor, RGBColor } from "../colors";
import { javaStringHashSet } from "../java-order";
import { mthAtan2, signedAngleDiff } from "../mth";
import { Palette } from "../palette";
import { abgr, fb, fnv, GOLDENS, hex, pal, Rng, tex } from "./fixtures";

// Goldens from the real Moonlight colour classes on HotSpot (see fixtures.ts).

function sampleColors(): number[] {
  const rng = new Rng(0x1234567);
  const samples: number[] = [];
  for (let i = 0; i < 72; i++) samples.push(rng.next() | 0xff000000);
  samples.push(0xff000000 | 0, 0xffffffff | 0, 0xff808080 | 0, 0x80ff0000 | 0);
  samples.push(0, 0x00ffffff, 0x7f3a5c11, 0xff0000ff | 0);
  return samples;
}

describe("Moonlight colour conversions", () => {
  it("match Java for sample colours (PaletteColor, LAB, HCL, HSV, darken/lighten)", () => {
    sampleColors().forEach((v, i) => {
      const c = PaletteColor.of(v);
      const hsv = c.rgb.asHSV();
      const line =
        `${hex(v)} v=${hex(c.value)}` +
        ` lab=${fb(c.lab.luminance)},${fb(c.lab.a)},${fb(c.lab.b)},${fb(c.lab.alpha)}` +
        ` hcl=${fb(c.hcl.hue)},${fb(c.hcl.chroma)},${fb(c.hcl.luminance)}` +
        ` dk=${hex(c.getDarkened().value)} lt=${hex(c.getLightened().value)}` +
        ` hsv=${fb(hsv.hue)},${fb(hsv.saturation)},${fb(hsv.value)}` +
        ` hsv2rgb=${hex(hsv.asRGB().toInt())}` +
        ` hcl2rgb=${hex(c.hcl.asRGB().toInt())}`;
      expect(line, `color.${i}`).toBe(GOLDENS[`color.${i}`]);
    });
  });

  it("match Java over every 251st 24-bit colour", () => {
    const acc: number[] = [];
    const bits = new DataView(new ArrayBuffer(4));
    const fbits = (x: number) => {
      bits.setFloat32(0, x);
      return bits.getInt32(0);
    };
    for (let v = 0; v < 0x1000000; v += 251) {
      const c = PaletteColor.of(v | 0xff000000);
      acc.push(
        fbits(c.hcl.hue),
        fbits(c.hcl.chroma),
        c.getDarkened().value,
        c.getLightened().value,
      );
    }
    expect(fnv(acc)).toBe(GOLDENS.sweep);
  });

  it("keeps the HSVtoRGB grey bug: greys come out white", () => {
    const grey = RGBColor.fromInt(0xff808080 | 0).asHSV();
    expect(hex(grey.asRGB().toInt())).toBe("ffffffff");
  });
});

describe("Mth and MthUtils", () => {
  it("match Java for signedAngleDiff, Mth.atan2 and HCL mixing", () => {
    const rng = new Rng(0x5eed);
    const acc: number[] = [];
    const bits = new DataView(new ArrayBuffer(8));
    const f = Math.fround;
    for (let i = 0; i < 10000; i++) {
      const a = f((rng.pos() % 100000) / 100000);
      const b = f((rng.pos() % 100000) / 100000);
      bits.setFloat32(0, signedAngleDiff(a * Math.PI * 2, b * Math.PI * 2));
      acc.push(bits.getInt32(0));
      bits.setFloat64(0, mthAtan2(f(a - 0.5), f(b - 0.5)));
      acc.push(bits.getInt32(4), bits.getInt32(0));
      const h1 = new HCLColor(a, f(b * 0.5), b, 1);
      const h2 = new HCLColor(b, f(a * 0.5), a, 1);
      bits.setFloat32(0, h1.mixWith(h2).hue);
      acc.push(bits.getInt32(0));
    }
    expect(fnv(acc)).toBe(GOLDENS.mth);
  });
});

describe("Java collection order", () => {
  it("emulates HashSet<String> iteration", () => {
    const values: string[] = [];
    for (let i = 0; i < 40; i++)
      values.push(`mod${i % 7}:block/tex_${(i * 7919).toString(36)}`);
    expect([...javaStringHashSet(values)].join(" ")).toBe(
      GOLDENS["order.hashset"],
    );
  });

  it("emulates HashSet<PaletteColor> order on luminance ties (ofColors)", () => {
    const greys: RGBColor[] = [];
    for (let i = 1; i <= 7; i++) {
      greys.push(RGBColor.fromInt(abgr(i * 31, 0x80, 0x80, 0x80)));
      greys.push(RGBColor.fromInt(abgr(255, i * 30, 0x40 + i, 0x90 - i)));
      greys.push(RGBColor.fromInt(abgr(i * 29, 0x30, 0x30, 0x30)));
    }
    expect(pal(Palette.ofColors(greys))).toBe(GOLDENS["order.ofColors"]);
  });

  it("emulates fastutil Int2ObjectOpenHashMap order on luminance ties", () => {
    const px = new Int32Array(64);
    for (let i = 0; i < 64; i++)
      px[i] = abgr(1 + ((i * 37) % 255), 0x55, 0x55, 0x55);
    expect(pal(Palette.fromImage(tex(8, 8, px, null), null, 0))).toBe(
      GOLDENS["order.fastutil"],
    );
  });
});
