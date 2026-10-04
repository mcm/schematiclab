// Iteration-order emulation of the Java collections whose order leaks into
// Moonlight Lib's and Every Compat's output (see the porting notes of
// `palette.ts`): `java.util.HashSet` / `HashMap` (OpenJDK 21) and fastutil
// 8.5's `Int2ObjectOpenHashMap`.
//
// - A `HashSet<String>` decides which texture is "first" when Moonlight looks
//   up a block's texture, and the order models are visited in.
// - A `HashSet<PaletteColor>` (`Collectors.toSet()`) is the insertion order of
//   `Palette.ofColors` / `Palette.fromArc`, which only matters for colours of
//   equal luminance (the palette sort is stable).
// - The per-frame `Int2ObjectOpenHashMap` of `Palette.fromAnimatedImage` is
//   the insertion order of every extracted palette, again only visible on
//   luminance ties.
//
// Treeified buckets (8+ colliding keys in a table of 64+) are not emulated:
// they keep insertion order here. Java reorders them (the tree root moves to
// the front) and, for `PaletteColor`s of equal luminance, breaks `compareTo`
// ties by `System.identityHashCode`, so Java's own order there differs from
// launch to launch. Colours of equal RGB and different alpha always share a
// bucket; fewer than 8 of them (the realistic case) are emulated exactly.
//
// Worker-safe: no DOM access.

/** Java `String.hashCode()`. */
export function javaStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** `Objects.hash(int)` = `31 + value`, `PaletteColor.hashCode()`. */
export function javaObjectsHashInt(value: number): number {
  return (31 + value) | 0;
}

/**
 * A `java.util.HashSet` with default capacity (16, load factor 0.75): keeps
 * the first of equal elements and iterates in Java's order.
 */
export class JavaHashSet<T> implements Iterable<T> {
  private capacity = 16;
  private threshold = 12;
  private table: T[][] = Array.from({ length: 16 }, () => []);
  private count = 0;

  constructor(
    private readonly hash: (value: T) => number,
    private readonly equals: (a: T, b: T) => boolean = Object.is,
  ) {}

  get size(): number {
    return this.count;
  }

  private bucket(value: T): number {
    const h = this.hash(value) | 0;
    return (h ^ (h >>> 16)) & (this.capacity - 1);
  }

  /** `add`: false when an equal element is already present. */
  add(value: T): boolean {
    const bucket = this.table[this.bucket(value)];
    if (bucket.some((v) => this.equals(v, value))) return false;
    bucket.push(value);
    if (++this.count > this.threshold) this.resize();
    return true;
  }

  private resize(): void {
    const old = this.table;
    this.capacity *= 2;
    this.threshold *= 2;
    this.table = Array.from({ length: this.capacity }, () => []);
    // HashMap.resize splits each bucket keeping its relative order.
    for (const bucket of old) {
      for (const v of bucket) this.table[this.bucket(v)].push(v);
    }
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const bucket of this.table) yield* bucket;
  }
}

/** A `HashSet<String>` in Java iteration order. */
export function javaStringHashSet(
  values: Iterable<string>,
): JavaHashSet<string> {
  const set = new JavaHashSet<string>(javaStringHash);
  for (const v of values) set.add(v);
  return set;
}

/** fastutil `HashCommon.mix(int)`. */
function mix(x: number): number {
  const h = Math.imul(x, 0x9e3779b9 | 0);
  return h ^ (h >>> 16);
}

function nextPowerOfTwo(x: number): number {
  let p = 1;
  while (p < x) p *= 2;
  return p;
}

function arraySize(expected: number, f: number): number {
  return Math.max(2, nextPowerOfTwo(Math.ceil(expected / f)));
}

function maxFill(n: number, f: number): number {
  return Math.min(Math.ceil(n * f), n - 1);
}

/**
 * Insertion and iteration order of a fastutil 8.5 `Int2ObjectOpenHashMap`
 * built with the default constructor (`values()` iterates slots from the
 * top down). Key 0 (fastutil's "null key", iterated first) is supported.
 */
export class FastutilIntMap<V> {
  private readonly loadFactor = 0.75;
  private n = arraySize(16, 0.75);
  private mask = this.n - 1;
  private fill = maxFill(this.n, 0.75);
  private keys = new Int32Array(this.n + 1);
  private vals: (V | undefined)[] = new Array<V | undefined>(this.n + 1);
  private hasNullKey = false;
  private count = 0;

  get size(): number {
    return this.count;
  }

  get(key: number): V | undefined {
    key |= 0;
    if (key === 0) return this.hasNullKey ? this.vals[this.n] : undefined;
    let p = mix(key) & this.mask;
    while (this.keys[p] !== 0) {
      if (this.keys[p] === key) return this.vals[p];
      p = (p + 1) & this.mask;
    }
    return undefined;
  }

  set(key: number, value: V): void {
    key |= 0;
    let p: number;
    if (key === 0) {
      if (this.hasNullKey) {
        this.vals[this.n] = value;
        return;
      }
      this.hasNullKey = true;
      p = this.n;
    } else {
      p = mix(key) & this.mask;
      while (this.keys[p] !== 0) {
        if (this.keys[p] === key) {
          this.vals[p] = value;
          return;
        }
        p = (p + 1) & this.mask;
      }
    }
    this.keys[p] = key;
    this.vals[p] = value;
    if (this.count++ >= this.fill)
      this.rehash(arraySize(this.count + 1, this.loadFactor));
  }

  private rehash(newN: number): void {
    const oldKeys = this.keys;
    const oldVals = this.vals;
    const m = newN - 1;
    const newKeys = new Int32Array(newN + 1);
    const newVals = new Array<V | undefined>(newN + 1);
    let i = this.n;
    for (let j = this.count - (this.hasNullKey ? 1 : 0); j-- !== 0; ) {
      while (oldKeys[--i] === 0);
      let p = mix(oldKeys[i]) & m;
      while (newKeys[p] !== 0) p = (p + 1) & m;
      newKeys[p] = oldKeys[i];
      newVals[p] = oldVals[i];
    }
    newVals[newN] = oldVals[this.n];
    this.n = newN;
    this.mask = m;
    this.fill = maxFill(newN, this.loadFactor);
    this.keys = newKeys;
    this.vals = newVals;
  }

  /** `values()` in fastutil's iteration order. */
  values(): V[] {
    const out: V[] = [];
    if (this.hasNullKey) out.push(this.vals[this.n] as V);
    for (let p = this.n - 1; p >= 0; p--) {
      if (this.keys[p] !== 0) out.push(this.vals[p] as V);
    }
    return out;
  }
}
