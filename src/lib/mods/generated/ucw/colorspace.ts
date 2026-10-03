// Port of Unlimited Chisel Works 0.3.5 `pl.asie.ucw.UCWColorspaceUtils`
// (https://github.com/asiekierka/UnlimitedChiselWorks, commit c458fc8).
// Copyright (c) 2017, 2018, 2019, 2021 Adrian Siekierka. Unlimited Chisel
// Works is licensed under the GNU Lesser General Public License v3.0 (or
// later); this port is a derivative of it under the same terms.
//
// UCW's "sRGB" is the gamma-encoded channel value used as-is (no linearising
// step), so the "XYZ" and "LAB" here are UCW's, not CIE's. Java `float`
// arithmetic is reproduced with `Math.fround`: every float result is rounded
// to float32, and expressions Java evaluates in `double` (a double literal
// times a float) are rounded once when cast back to `float`. Float products,
// sums and quotients computed in double and rounded once equal Java's float
// results.
//
// Worker-safe: no DOM access.

const f = Math.fround;

/** A three-component float vector (`float[]` in Java). */
export type Float3 = [number, number, number];

const D65_WHITE: Float3 = [f(0.9504), f(1.0), f(1.0888)];
const E = f(0.008856);
const K = f(903.3);
const KE = f(K * E);
const E_CBRT = f(0.2068930344);

/** `(xr > E) ? (float) Math.cbrt(xr) : (K*xr + 16)/116.0f` */
function labF(r: number): number {
  return r > E ? f(Math.cbrt(r)) : f(f(f(K * r) + 16) / 116);
}

/** `116*f - 16`, an int times a float. */
function labL(fy: number): number {
  return f(f(116 * fy) - 16);
}

/** UCW's lightness (`L*`) of an sRGB colour. */
export function sRGBtoLuma(v: readonly number[]): number {
  const v1 = f(0.2126729 * v[0] + 0.7151522 * v[1] + 0.072175 * v[2]);
  const yr = f(v1 / D65_WHITE[1]);
  return labL(labF(yr));
}

export function XYZtoLAB(v: readonly number[]): Float3 {
  const fx = labF(f(v[0] / D65_WHITE[0]));
  const fy = labF(f(v[1] / D65_WHITE[1]));
  const fz = labF(f(v[2] / D65_WHITE[2]));
  return [labL(fy), f(500 * f(fx - fy)), f(200 * f(fy - fz))];
}

export function LABtoXYZ(v: readonly number[]): Float3 {
  const fy = f(f(v[0] + 16) / 116);
  const fx = f(f(v[1] / 500) + fy);
  const fz = f(fy - f(v[2] / 200));

  const inverse = (fr: number) =>
    fr > E_CBRT ? f(f(fr * fr) * fr) : f(f(f(116 * fr) - 16) / K);
  const xr = inverse(fx);
  const zr = inverse(fz);
  let yr: number;
  if (v[0] > KE) {
    yr = f(f(v[0] + 16) / 116);
    yr = f(yr * f(yr * yr));
  } else {
    yr = f(v[0] / K);
  }

  return [f(xr * D65_WHITE[0]), f(yr * D65_WHITE[1]), f(zr * D65_WHITE[2])];
}

/** One channel as `0..255`: clamped, then `Math.round(f * 255.0f)`. */
function asFF(value: number): number {
  if (value >= 1) return 255;
  if (value <= 0) return 0;
  // NaN falls through both checks; Java's Math.round(NaN) is 0.
  const scaled = f(value * 255);
  return Number.isNaN(scaled) ? 0 : Math.round(scaled) & 0xff;
}

/** Packs an sRGB float colour as `0xRRGGBB` (no alpha). */
export function asInt(v: readonly number[]): number {
  return (asFF(v[0]) << 16) | (asFF(v[1]) << 8) | asFF(v[2]);
}

/** Unpacks the RGB channels of `0x(AA)RRGGBB` into floats in `0..1`. */
export function fromInt(v: number): Float3 {
  return [
    f(((v >> 16) & 0xff) / 255),
    f(((v >> 8) & 0xff) / 255),
    f((v & 0xff) / 255),
  ];
}

export function sRGBtoXYZ(v: readonly number[]): Float3 {
  return [
    f(0.4124564 * v[0] + 0.3575761 * v[1] + 0.1804375 * v[2]),
    f(0.2126729 * v[0] + 0.7151522 * v[1] + 0.072175 * v[2]),
    f(0.0193339 * v[0] + 0.119192 * v[1] + 0.9503041 * v[2]),
  ];
}

export function XYZtosRGB(v: readonly number[]): Float3 {
  return [
    f(3.2404542 * v[0] + -1.5371385 * v[1] + -0.4985314 * v[2]),
    f(-0.969266 * v[0] + 1.8760108 * v[1] + 0.041556 * v[2]),
    f(0.0556434 * v[0] + -0.2040259 * v[1] + 1.0572252 * v[2]),
  ];
}
