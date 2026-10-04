// Port of the Minecraft 1.21.1 `net.minecraft.util.Mth` helpers that Moonlight
// Lib's texture code uses (`sin`, `cos`, `atan2`, `fastInvSqrt`, `rotLerp`,
// `wrapDegrees`, `clamp`), and of Moonlight Lib's
// `net.mehvahdjukaar.moonlight.api.util.math.MthUtils.signedAngleDiff`
// (https://github.com/MehVahdJukaar/Moonlight, branch 1.21, commit
// 72afa38c8b7f5c05639644fdabc92d5254924732). Moonlight Lib is by MehVahdJukaar
// and the Supplementaries Team, under the Supplementaries Team License; this
// port is a derivative of it under the same terms. The vanilla helpers are
// reimplemented from their documented behaviour (no Minecraft jar is read).
//
// Java `float` arithmetic is reproduced with `Math.fround`; Java `double`s
// stay doubles. `Mth.atan2` uses Mojang's lookup tables: V8 builds `SIN` and
// `ASIN_TAB` bit-identical to HotSpot, but 10 `COS_TAB` entries come out one
// ulp off, so HotSpot's values are hard-coded below.
//
// Worker-safe: no DOM access.

const f = Math.fround;

/** Java `(int)` of a float or double: truncation, NaN → 0, saturating. */
export function javaInt(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v) | 0;
}

/** `Mth.SIN`: `(float) Math.sin(i * PI * 2 / 65536)`. */
const SIN = (() => {
  const table = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    table[i] = Math.sin((i * Math.PI * 2.0) / 65536.0);
  }
  return table;
})();

const SIN_SCALE = f(10430.378);

/** `Mth.sin(float)`: `SIN[(int)(value * 10430.378F) & 65535]`. */
export function mthSin(value: number): number {
  return SIN[javaInt(f(f(value) * SIN_SCALE)) & 0xffff];
}

/** `Mth.cos(float)`: `SIN[(int)(value * 10430.378F + 16384.0F) & 65535]`. */
export function mthCos(value: number): number {
  return SIN[javaInt(f(f(f(value) * SIN_SCALE) + 16384)) & 0xffff];
}

const bitsBuffer = new DataView(new ArrayBuffer(8));

function doubleFromBits(bits: bigint): number {
  bitsBuffer.setBigInt64(0, bits);
  return bitsBuffer.getFloat64(0);
}

function doubleToBits(value: number): bigint {
  bitsBuffer.setFloat64(0, value);
  return bitsBuffer.getBigInt64(0);
}

/** `Mth.FRAC_BIAS = Double.longBitsToDouble(4805340802404319232L)` (2^44). */
const FRAC_BIAS = doubleFromBits(4805340802404319232n);

/** HotSpot's `Math.cos(Math.asin(j / 256.0))` where V8 differs by one ulp. */
const COS_TAB_JAVA: Record<number, bigint> = {
  61: 0x3fef140a0a086af1n,
  70: 0x3feec7cd0f2b5adfn,
  125: 0x3febed0bdee7064dn,
  127: 0x3febc8dbfdbfda88n,
  141: 0x3feab5732734fa47n,
  170: 0x3fe7ecf874b086dfn,
  175: 0x3fe75b090e40447an,
  181: 0x3fe6a13cc8a9b946n,
  182: 0x3fe681110a985d4dn,
  186: 0x3fe5fcb9f031317bn,
};

const ASIN_TAB = new Float64Array(257);
const COS_TAB = new Float64Array(257);
for (let i = 0; i < 257; i++) {
  const asin = Math.asin(i / 256.0);
  ASIN_TAB[i] = asin;
  const java = COS_TAB_JAVA[i];
  COS_TAB[i] = java === undefined ? Math.cos(asin) : doubleFromBits(java);
}

/** `Mth.fastInvSqrt(double)`. */
export function fastInvSqrt(d: number): number {
  const half = 0.5 * d;
  const bits = 6910469410427058090n - (doubleToBits(d) >> 1n);
  const r = doubleFromBits(BigInt.asIntN(64, bits));
  return r * (1.5 - half * r * r);
}

/** `Mth.atan2(double y, double x)`: Mojang's table-based approximation. */
export function mthAtan2(y: number, x: number): number {
  const d0 = x * x + y * y;
  if (Number.isNaN(d0)) return NaN;
  const negY = y < 0.0;
  if (negY) y = -y;
  const negX = x < 0.0;
  if (negX) x = -x;
  const swapped = y > x;
  if (swapped) {
    const t = x;
    x = y;
    y = t;
  }
  const inv = fastInvSqrt(d0);
  x *= inv;
  y *= inv;
  const d2 = FRAC_BIAS + y;
  // (int) Double.doubleToRawLongBits(d2): the low 32 bits.
  bitsBuffer.setFloat64(0, d2);
  const i = bitsBuffer.getInt32(4);
  const d3 = ASIN_TAB[i];
  const d4 = COS_TAB[i];
  const d5 = d2 - FRAC_BIAS;
  const d6 = y * d4 - x * d5;
  const d7 = (6.0 + d6 * d6) * d6 * 0.16666666666666666;
  let d8 = d3 + d7;
  if (swapped) d8 = Math.PI / 2 - d8;
  if (negX) d8 = Math.PI - d8;
  if (negY) d8 = -d8;
  return d8;
}

/** `Mth.wrapDegrees(float)`. */
export function wrapDegrees(degrees: number): number {
  // Java's float `%` is exact, as is JS's on the same values.
  let r = f(f(degrees) % 360);
  if (r >= 180) r = f(r - 360);
  if (r < -180) r = f(r + 360);
  return r;
}

/** `Mth.rotLerp(float delta, float start, float end)`. */
export function rotLerp(delta: number, start: number, end: number): number {
  return f(start + f(delta * wrapDegrees(f(end - start))));
}

/** `Mth.clamp(float value, float min, float max)`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : Math.min(value, max);
}

/**
 * `MthUtils.signedAngleDiff(double to, double from)`, bug included: Moonlight
 * computes `x1 * y1 - y1 * x2` where `x1 * y2 - y1 * x2` was meant.
 */
export function signedAngleDiff(to: number, from: number): number {
  const x1 = mthCos(f(to));
  const y1 = mthSin(f(to));
  const x2 = mthCos(f(from));
  const y2 = mthSin(f(from));
  return f(mthAtan2(f(f(x1 * y1) - f(y1 * x2)), f(f(x1 * x2) + f(y1 * y2))));
}

/** Java `Float.compare(a, b)`, used to sort palettes by luminance. */
export function floatCompare(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  const aNaN = Number.isNaN(a);
  const bNaN = Number.isNaN(b);
  if (aNaN || bNaN) return aNaN === bNaN ? 0 : aNaN ? 1 : -1;
  // a == b: -0.0 sorts before 0.0.
  const aNeg = Object.is(a, -0);
  const bNeg = Object.is(b, -0);
  return aNeg === bNeg ? 0 : aNeg ? -1 : 1;
}
