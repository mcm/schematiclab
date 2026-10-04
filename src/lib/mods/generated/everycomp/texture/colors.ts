// Port of Moonlight Lib's colour classes
// `net.mehvahdjukaar.moonlight.api.util.math.colors.{BaseColor, RGBColor,
// LABColor, HCLColor, HSVColor, XYZColor, ColorSpaces}` and
// `net.mehvahdjukaar.moonlight.api.resources.textures.PaletteColor`
// (https://github.com/MehVahdJukaar/Moonlight, branch 1.21, commit
// 72afa38c8b7f5c05639644fdabc92d5254924732). Moonlight Lib is by MehVahdJukaar
// and the Supplementaries Team, under the Supplementaries Team License; this
// port is a derivative of it under the same terms.
//
// Java `float` arithmetic is reproduced with `Math.fround`: every float result
// is rounded to float32; expressions Java evaluates in `double` (a float times
// a `double`, `Math.pow`, `Math.cos`) stay doubles until the `(float)` cast.
// Rounding a double sum, product, quotient or square root of two floats once
// gives Java's float result. The forward (RGB → LAB → HCL) and backward
// (LAB/HCL → RGB → int) chains matched HotSpot bit for bit over every 24-bit
// colour when this port was written; `__tests__/colors.test.ts` keeps a
// sample of colours and a 1-in-251 sweep against Java goldens.
//
// Pixels are Minecraft `NativeImage` ints: ABGR (`r | g << 8 | b << 16 |
// a << 24`), the little-endian reading of RGBA bytes.
//
// Worker-safe: no DOM access.

import { clamp, javaInt, mthCos, mthSin, rotLerp } from "./mth";

const f = Math.fround;

// ── ABGR ints (`FastColor.ABGR32`) ────────────────────────────────────────

export function abgrAlpha(c: number): number {
  return c >>> 24;
}
export function abgrRed(c: number): number {
  return c & 0xff;
}
export function abgrGreen(c: number): number {
  return (c >> 8) & 0xff;
}
export function abgrBlue(c: number): number {
  return (c >> 16) & 0xff;
}
/** `FastColor.ABGR32.color(a, b, g, r)` / `RGBColor.combine`. */
export function abgr(
  alpha: number,
  blue: number,
  green: number,
  red: number,
): number {
  return (
    ((alpha & 255) << 24) |
    ((blue & 255) << 16) |
    ((green & 255) << 8) |
    (red & 255)
  );
}

// ── Colour classes ───────────────────────────────────────────────────────

/** `BaseColor.distTo`: float Euclidean distance over the first 3 channels. */
function distTo3(
  a0: number,
  a1: number,
  a2: number,
  b0: number,
  b1: number,
  b2: number,
): number {
  const d0 = f(a0 - b0);
  const d1 = f(a1 - b1);
  const d2 = f(a2 - b2);
  return f(Math.sqrt(f(f(f(d0 * d0) + f(d1 * d1)) + f(d2 * d2))));
}

/** `RGBColor`: float channels clamped to [0, 1]. */
export class RGBColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;

  constructor(r: number, g: number, b: number, a: number) {
    this.red = clamp(f(r), 0, 1);
    this.green = clamp(f(g), 0, 1);
    this.blue = clamp(f(b), 0, 1);
    this.alpha = clamp(f(a), 0, 1);
  }

  /** `new RGBColor(int abgr)`. */
  static fromInt(value: number): RGBColor {
    return new RGBColor(
      f(abgrRed(value) / 255),
      f(abgrGreen(value) / 255),
      f(abgrBlue(value) / 255),
      f(((value >> 24) & 0xff) / 255),
    );
  }

  /** `toInt()`: rounds each channel (`Math.round(c * 255)`). */
  toInt(): number {
    return abgr(
      Math.round(f(this.alpha * 255)),
      Math.round(f(this.blue * 255)),
      Math.round(f(this.green * 255)),
      Math.round(f(this.red * 255)),
    );
  }

  asRGB(): RGBColor {
    return this;
  }
  asXYZ(): XYZColor {
    return RGBtoXYZ(this);
  }
  asLAB(): LABColor {
    return XYZtoLAB(this.asXYZ());
  }
  asHCL(): HCLColor {
    return LABtoHCL(this.asLAB());
  }
  asHSV(): HSVColor {
    return RGBtoHSV(this);
  }

  mixWith(o: RGBColor, bias = 0.5): RGBColor {
    const i = f(1 - bias);
    return new RGBColor(
      f(f(this.red * i) + f(o.red * bias)),
      f(f(this.green * i) + f(o.green * bias)),
      f(f(this.blue * i) + f(o.blue * bias)),
      f(f(this.alpha * i) + f(o.alpha * bias)),
    );
  }

  distTo(o: RGBColor): number {
    return distTo3(this.red, this.green, this.blue, o.red, o.green, o.blue);
  }
}

/** `XYZColor` (no clamping). */
export class XYZColor {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly alpha: number,
  ) {}

  asRGB(): RGBColor {
    return XYZtoRGB(this);
  }
}

/** `LABColor`: luminance and a/b scaled to roughly [0, 1] / [-1, 1]. */
export class LABColor {
  readonly luminance: number;
  readonly a: number;
  readonly b: number;
  readonly alpha: number;

  constructor(l: number, a: number, b: number, alpha: number) {
    this.luminance = f(l);
    this.a = f(a);
    this.b = f(b);
    this.alpha = f(alpha);
  }

  withLuminance(l: number): LABColor {
    return new LABColor(l, this.a, this.b, this.alpha);
  }

  asRGB(): RGBColor {
    return XYZtoRGB(LABtoXYZ(this));
  }
  asLAB(): LABColor {
    return this;
  }
  asHCL(): HCLColor {
    return LABtoHCL(this);
  }

  mixWith(o: LABColor, bias = 0.5): LABColor {
    const i = f(1 - bias);
    return new LABColor(
      f(f(this.luminance * i) + f(o.luminance * bias)),
      f(f(this.a * i) + f(o.a * bias)),
      f(f(this.b * i) + f(o.b * bias)),
      f(f(this.alpha * i) + f(o.alpha * bias)),
    );
  }

  distTo(o: LABColor): number {
    return distTo3(this.luminance, this.a, this.b, o.luminance, o.a, o.b);
  }

  /** `LABColor.averageColors`. */
  static average(colors: readonly LABColor[]): LABColor {
    const size = f(colors.length);
    let l = 0;
    let a = 0;
    let b = 0;
    let alpha = 0;
    for (const c of colors) {
      l = f(l + c.luminance);
      a = f(a + c.a);
      b = f(b + c.b);
      alpha = f(alpha + c.alpha);
    }
    return new LABColor(f(l / size), f(a / size), f(b / size), f(alpha / size));
  }
}

/** `BaseColor.weightedAverageAngles`: hue lerp along the short arc. */
function weightedAverageAngles(a: number, b: number, bias: number): number {
  return f(rotLerp(bias, f(a * 360), f(b * 360)) / 360);
}

/** `HCLColor`: polar LAB; hue in turns. */
export class HCLColor {
  readonly hue: number;
  readonly chroma: number;
  readonly luminance: number;
  readonly alpha: number;

  constructor(h: number, c: number, l: number, a: number) {
    this.hue = f(h);
    this.chroma = f(c);
    this.luminance = f(l);
    this.alpha = f(a);
  }

  withHue(h: number): HCLColor {
    return new HCLColor(h, this.chroma, this.luminance, this.alpha);
  }
  withChroma(c: number): HCLColor {
    return new HCLColor(this.hue, c, this.luminance, this.alpha);
  }
  withLuminance(l: number): HCLColor {
    return new HCLColor(this.hue, this.chroma, l, this.alpha);
  }

  asRGB(): RGBColor {
    return HCLtoLAB(this).asRGB();
  }
  asLAB(): LABColor {
    return HCLtoLAB(this);
  }
  asHCL(): HCLColor {
    return this;
  }

  mixWith(o: HCLColor, bias = 0.5): HCLColor {
    const i = f(1 - bias);
    let h = weightedAverageAngles(this.hue, o.hue, bias);
    while (h < 0) h = f(h + 1);
    return new HCLColor(
      h,
      f(f(this.chroma * i) + f(o.chroma * bias)),
      f(f(this.luminance * i) + f(o.luminance * bias)),
      f(f(this.alpha * i) + f(o.alpha * bias)),
    );
  }

  /** `HCLColor.distTo`: the chroma plane in double, luminance in float. */
  distTo(o: HCLColor): number {
    const x =
      this.chroma * Math.cos(this.hue * Math.PI * 2) -
      o.chroma * Math.cos(o.hue * Math.PI * 2);
    const y =
      this.chroma * Math.sin(this.hue * Math.PI * 2) -
      o.chroma * Math.sin(o.hue * Math.PI * 2);
    const dl = f(this.luminance - o.luminance);
    return f(Math.sqrt(x * x + y * y + f(dl * dl)));
  }
}

/** `HSVColor`. */
export class HSVColor {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
  readonly alpha: number;

  constructor(h: number, s: number, v: number, a: number) {
    this.hue = f(h);
    this.saturation = f(s);
    this.value = f(v);
    this.alpha = f(a);
  }

  asRGB(): RGBColor {
    return HSVtoRGB(this);
  }
}

/** Any colour Moonlight can turn into a `PaletteColor`. */
export type AnyColor = RGBColor | LABColor | HCLColor | HSVColor | XYZColor;

// ── ColorSpaces ──────────────────────────────────────────────────────────

const C_0_04045 = f(0.04045);
const C_0_055 = f(0.055);
const C_1_055 = f(1.055);
const C_2_4 = f(2.4);
const C_12_92 = f(12.92);

function srgbToLinear(c: number): number {
  return c > C_0_04045
    ? Math.pow(f(f(c + C_0_055) / C_1_055), C_2_4)
    : f(c / C_12_92);
}

const M_XYZ = [
  [f(0.4124), f(0.3576), f(0.1805)],
  [f(0.2126), f(0.7152), f(0.0722)],
  [f(0.0193), f(0.1192), f(0.9505)],
];

/** `ColorSpaces.RGBtoXYZ`. */
export function RGBtoXYZ(color: RGBColor): XYZColor {
  const r = srgbToLinear(color.red);
  const g = srgbToLinear(color.green);
  const b = srgbToLinear(color.blue);
  const row = (m: number[]) => f(m[0] * r + m[1] * g + m[2] * b);
  return new XYZColor(row(M_XYZ[0]), row(M_XYZ[1]), row(M_XYZ[2]), color.alpha);
}

const C_3_2406 = f(3.2406);
const C_1_5372 = f(1.5372);
const C_0_4986 = f(0.4986);
const C_N0_9689 = f(-0.9689);
const C_1_8758 = f(1.8758);
const C_0_0415 = f(0.0415);
const C_0_0557 = f(0.0557);
const C_0_2040 = f(0.204);
const C_1_0570 = f(1.057);
const C_0_0031308 = f(0.0031308);
const C_INV_2_4 = f(1 / C_2_4);

function linearToSrgb(c: number): number {
  return c > C_0_0031308
    ? f(C_1_055 * Math.pow(c, C_INV_2_4) - C_0_055)
    : f(C_12_92 * c);
}

/** `ColorSpaces.XYZtoRGB`. */
export function XYZtoRGB(color: XYZColor): RGBColor {
  const { x, y, z } = color;
  const r = f(f(f(C_3_2406 * x) - f(C_1_5372 * y)) - f(C_0_4986 * z));
  const g = f(f(f(C_N0_9689 * x) + f(C_1_8758 * y)) + f(C_0_0415 * z));
  const b = f(f(f(C_0_0557 * x) - f(C_0_2040 * y)) + f(C_1_0570 * z));
  return new RGBColor(
    linearToSrgb(r),
    linearToSrgb(g),
    linearToSrgb(b),
    color.alpha,
  );
}

const SCALE_X = f(f(95.047) / 100);
const SCALE_Y = 1;
const SCALE_Z = f(f(108.883) / 100);
const SCALE_L = 100;
const SCALE_A = 255;
const SCALE_B = 255;
const C_0_008856 = f(0.008856);
const C_7_787 = f(7.787);
const C_16_116 = f(16 / 116);

function labF(t: number): number {
  return t > C_0_008856 ? f(Math.cbrt(t)) : f(f(C_7_787 * t) + C_16_116);
}

/** `ColorSpaces.XYZtoLAB`. */
export function XYZtoLAB(color: XYZColor): LABColor {
  const x = labF(f(color.x / SCALE_X));
  const y = labF(f(color.y / SCALE_Y));
  const z = labF(f(color.z / SCALE_Z));
  const l = f(f(116 * y) - 16);
  const a = f(500 * f(x - y));
  const b = f(200 * f(y - z));
  return new LABColor(
    f(l / SCALE_L),
    f(a / SCALE_A),
    f(b / SCALE_B),
    color.alpha,
  );
}

function labFInv(t: number, scale: number): number {
  const t3 = f(f(t * t) * t);
  // `(x3 > 0.008856f) ? x3 : ((x0 - 16f/116f) / 7.787)` is a double (the
  // literal 7.787 is a double), times the float scale, then cast.
  const v = t3 > C_0_008856 ? t3 : f(t - C_16_116) / 7.787;
  return f(v * scale);
}

/** `ColorSpaces.LABtoXYZ`. */
export function LABtoXYZ(color: LABColor): XYZColor {
  const y0 = f(f(f(color.luminance * SCALE_L) + 16) / 116);
  const x0 = f(f(f(color.a * SCALE_A) / 500) + y0);
  const z0 = f(y0 - f(f(color.b * SCALE_B) / 200));
  return new XYZColor(
    labFInv(x0, SCALE_X),
    labFInv(y0, SCALE_Y),
    labFInv(z0, SCALE_Z),
    color.alpha,
  );
}

/** `ColorSpaces.LABtoHCL`. */
export function LABtoHCL(color: LABColor): HCLColor {
  const { a, b } = color;
  const c = f(Math.sqrt(f(f(a * a) + f(b * b))));
  let h = f(Math.atan2(b, a));
  h = f(h / (Math.PI * 2));
  while (h < 0) h = f(h + 1);
  return new HCLColor(h, c, color.luminance, color.alpha);
}

/** `ColorSpaces.HCLtoLAB`. */
export function HCLtoLAB(color: HCLColor): LABColor {
  const h = color.hue;
  const c = color.chroma;
  const a = f(c * Math.cos(h * Math.PI * 2));
  const b = f(c * Math.sin(h * Math.PI * 2));
  return new LABColor(color.luminance, a, b, color.alpha);
}

/** `ColorSpaces.RGBtoHSV`. */
export function RGBtoHSV(color: RGBColor): HSVColor {
  const r = color.red;
  const g = color.green;
  const b = color.blue;
  let cmax = Math.max(r, g);
  if (b > cmax) cmax = b;
  let cmin = Math.min(r, g);
  if (b < cmin) cmin = b;
  const brightness = cmax;
  const saturation = cmax !== 0 ? f(f(cmax - cmin) / cmax) : 0;
  let hue: number;
  if (saturation === 0) {
    hue = 0;
  } else {
    const span = f(cmax - cmin);
    const redc = f(f(cmax - r) / span);
    const greenc = f(f(cmax - g) / span);
    const bluec = f(f(cmax - b) / span);
    if (r === cmax) hue = f(bluec - greenc);
    else if (g === cmax) hue = f(f(2 + redc) - bluec);
    else hue = f(f(4 + greenc) - redc);
    hue = f(hue / 6);
    if (hue < 0) hue = f(hue + 1);
  }
  return new HSVColor(hue, saturation, brightness, color.alpha);
}

/**
 * `ColorSpaces.HSVtoRGB`, bug included: a grey (saturation 0) sets every
 * channel to `(int)(v * 255 + 0.5)`, which `RGBColor` then clamps to 1, so
 * any non-black grey comes out white.
 */
export function HSVtoRGB(color: HSVColor): RGBColor {
  const hue = color.hue;
  const s = color.saturation;
  const v = color.value;
  let r = 0;
  let g = 0;
  let b = 0;
  if (s === 0) {
    r = g = b = javaInt(f(f(v * 255) + 0.5));
  } else {
    const h = f(f(hue - f(Math.floor(hue))) * 6);
    const fr = f(h - f(Math.floor(h)));
    const p = f(v * f(1 - s));
    const q = f(v * f(1 - f(s * fr)));
    const t = f(v * f(1 - f(s * f(1 - fr))));
    switch (javaInt(h)) {
      case 0:
        [r, g, b] = [v, t, p];
        break;
      case 1:
        [r, g, b] = [q, v, p];
        break;
      case 2:
        [r, g, b] = [p, v, t];
        break;
      case 3:
        [r, g, b] = [p, q, v];
        break;
      case 4:
        [r, g, b] = [t, p, v];
        break;
      case 5:
        [r, g, b] = [v, p, q];
        break;
    }
  }
  return new RGBColor(r, g, b, color.alpha);
}

// ── PaletteColor ─────────────────────────────────────────────────────────

/**
 * `PaletteColor`: a colour with its RGB, LAB and HCL forms cached and an
 * occurrence count. Equality (`equals`/`hashCode`) is by `value` only.
 */
export class PaletteColor {
  readonly value: number;
  readonly rgb: RGBColor;
  readonly lab: LABColor;
  readonly hcl: HCLColor;
  occurrence = 0;

  private constructor(
    rgb: RGBColor,
    lab: LABColor,
    hcl: HCLColor,
    value: number,
  ) {
    this.rgb = rgb;
    this.lab = lab;
    this.hcl = hcl;
    this.value = value;
  }

  /**
   * `new PaletteColor(BaseColor)` / `new PaletteColor(int)`: the colour goes
   * through clamped RGB first; LAB is computed from the unquantised float RGB.
   */
  static of(color: AnyColor | number, occurrence?: number): PaletteColor {
    let c = typeof color === "number" ? RGBColor.fromInt(color) : color.asRGB();
    if (c.alpha === 0) c = RGBColor.fromInt(0);
    const lab = c.asLAB();
    const p = new PaletteColor(c, lab, LABtoHCL(lab), c.toInt());
    if (occurrence !== undefined) p.occurrence = occurrence;
    return p;
  }

  copy(): PaletteColor {
    const p = new PaletteColor(this.rgb, this.lab, this.hcl, this.value);
    p.occurrence = this.occurrence;
    return p;
  }

  get luminance(): number {
    return this.lab.luminance;
  }

  getDarkened(): PaletteColor {
    return PaletteColor.of(
      this.lab.withLuminance(f(this.lab.luminance * f(0.9))),
      this.occurrence,
    );
  }

  getLightened(): PaletteColor {
    return PaletteColor.of(
      this.lab.withLuminance(f(f(this.lab.luminance * f(0.9)) + f(0.1))),
      this.occurrence,
    );
  }

  distanceTo(o: PaletteColor): number {
    return this.lab.distTo(o.lab);
  }

  equals(o: PaletteColor): boolean {
    return this.value === o.value;
  }
}

/** `BaseColor.averageAngles`, used by HCL/HSV averaging (kept for parity). */
export function averageAngles(angles: readonly number[]): number {
  let x = 0;
  let y = 0;
  for (const a of angles) {
    x = f(x + mthCos(f(a * Math.PI * 2)));
    y = f(y + mthSin(f(a * Math.PI * 2)));
  }
  return f(Math.atan2(y, x) / (Math.PI * 2));
}
