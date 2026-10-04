// Port of Moonlight Lib's
// `net.mehvahdjukaar.moonlight.api.resources.textures.Palette`
// (https://github.com/MehVahdJukaar/Moonlight, branch 1.21, commit
// 72afa38c8b7f5c05639644fdabc92d5254924732). Moonlight Lib is by MehVahdJukaar
// and the Supplementaries Team, under the Supplementaries Team License; this
// port is a derivative of it under the same terms.
//
// A palette is a list of `PaletteColor`s kept sorted from darkest to lightest
// LAB luminance (a stable sort, so ties keep insertion order) with a merge
// tolerance. Every method the Respriter, `SpriteUtils` and the Every Compat /
// Stone Zone / Gems Realm palette strategies call is ported with Java's
// quirks:
//
// - `get`, `set` and `removeAt` throw on a bad index like `ArrayList`, so a
//   strategy that runs out of colours fails (the caller skips that texture).
// - `remove(color)` / `reduceUp` remove the first colour of equal `value`.
// - `add` rejects alpha 0 and colours within the tolerance; `addUnchecked`
//   (internal) rejects alpha 0 and clipped colours but not duplicates.
// - Palette insertion order follows Java's hash collections (`java-order.ts`).
//
// Not ported: `resampleWithOneMore` (unused by the strategies; it needs
// `java.util.Random`), `nearestColorMapper` and the `Set` view methods.
//
// Worker-safe: no DOM access.

import {
  HCLColor,
  LABColor,
  PaletteColor,
  type AnyColor,
  abgrAlpha,
} from "./colors";
import { FastutilIntMap, JavaHashSet, javaObjectsHashInt } from "./java-order";
import { clamp, floatCompare, signedAngleDiff } from "./mth";
import type { TextureImage } from "./texture-image";

const f = Math.fround;

/** `Float.MAX_VALUE`. */
const FLOAT_MAX_VALUE = 3.4028234663852886e38;

/** `Palette.BASE_TOLERANCE` = `1 / 170f`. */
export const BASE_TOLERANCE = f(1 / 170);

/** `Collectors.toSet()` of palette colours: Java `HashSet` order, deduped. */
function javaColorSet(colors: Iterable<PaletteColor>): PaletteColor[] {
  const set = new JavaHashSet<PaletteColor>(
    (c) => javaObjectsHashInt(c.value),
    (a, b) => a.value === b.value,
  );
  for (const c of colors) set.add(c);
  return [...set];
}

/** `Palette.RunningAverage`, used by `updateTolerance`. */
class RunningAverage {
  private single: PaletteColor | null = null;
  private l = 0;
  private a = 0;
  private b = 0;
  private alpha = 0;
  private count = 0;
  private occurrence = 0;

  isEmpty(): boolean {
    return this.count === 0;
  }

  accept(color: PaletteColor): void {
    if (this.count === 0) this.single = color;
    const lab = color.lab;
    this.l = f(this.l + lab.luminance);
    this.a = f(this.a + lab.a);
    this.b = f(this.b + lab.b);
    this.alpha = f(this.alpha + lab.alpha);
    this.occurrence += color.occurrence;
    this.count++;
  }

  average(): LABColor {
    const n = this.count;
    return new LABColor(
      f(this.l / n),
      f(this.a / n),
      f(this.b / n),
      f(this.alpha / n),
    );
  }

  collapse(): PaletteColor {
    const result =
      this.count === 1 && this.single !== null
        ? this.single
        : PaletteColor.of(this.average());
    result.occurrence = this.occurrence;
    this.l = this.a = this.b = this.alpha = 0;
    this.count = 0;
    this.occurrence = 0;
    this.single = null;
    return result;
  }
}

/** `Palette`: colours sorted by LAB luminance, darkest first. */
export class Palette {
  private tolerance = 0;
  private readonly internal: PaletteColor[] = [];

  /** `new Palette(colors[, tolerance])`: sorts, then merges at `tolerance`. */
  constructor(colors: Iterable<PaletteColor> = [], tolerance?: number) {
    for (const c of colors) this.internal.push(c);
    this.sort();
    if (tolerance !== undefined) this.updateTolerance(tolerance);
  }

  static empty(): Palette {
    return new Palette();
  }

  /** The colours, darkest first (live view, don't mutate). */
  get values(): readonly PaletteColor[] {
    return this.internal;
  }

  get currentTolerance(): number {
    return this.tolerance;
  }

  isEmpty(): boolean {
    return this.internal.length === 0;
  }

  size(): number {
    return this.internal.length;
  }

  /** Shallow copy: same `PaletteColor` objects, same tolerance. */
  copy(): Palette {
    const p = new Palette(this.internal);
    p.tolerance = this.tolerance;
    return p;
  }

  /** Stable sort by `Float.compare` of luminance (`Collections.sort`). */
  sort(): void {
    this.internal.sort((x, y) =>
      floatCompare(x.lab.luminance, y.lab.luminance),
    );
  }

  /**
   * `updateTolerance`: merges runs of luminance-adjacent colours whose
   * distance to the run's running LAB average is within `tolerance`.
   */
  updateTolerance(tolerance: number): void {
    tolerance = f(tolerance);
    if (this.tolerance === tolerance) return;
    this.tolerance = tolerance;
    if (tolerance === 0 || this.size() < 2) return;
    const merged: PaletteColor[] = [];
    const run = new RunningAverage();
    for (const color of this.internal) {
      if (run.isEmpty() || run.average().distTo(color.lab) <= tolerance) {
        run.accept(color);
      } else {
        merged.push(run.collapse());
        run.accept(color);
      }
    }
    if (!run.isEmpty()) merged.push(run.collapse());
    this.internal.length = 0;
    this.internal.push(...merged);
    this.sort();
  }

  private checkIndex(index: number): void {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.internal.length
    ) {
      throw new RangeError(
        `Index ${index} out of bounds for length ${this.internal.length}`,
      );
    }
  }

  get(index: number): PaletteColor {
    this.checkIndex(index);
    return this.internal[index];
  }

  /** `set(index, color)`: no re-sort; no-op when another colour is too close. */
  set(index: number, color: PaletteColor): void {
    if (color.rgb.alpha === 0) return;
    for (let i = 0; i < this.internal.length; i++) {
      if (i === index) continue;
      const c = this.internal[i];
      if (
        this.tolerance === 0
          ? c.value === color.value
          : c.distanceTo(color) <= this.tolerance
      ) {
        return;
      }
    }
    this.checkIndex(index);
    this.internal[index] = color;
  }

  /** `indexOf`: first colour of equal `value`, or -1. */
  indexOf(color: PaletteColor): number {
    return this.internal.findIndex((c) => c.value === color.value);
  }

  private addUnchecked(color: PaletteColor): void {
    if (wasColorClipped(color)) return;
    if (color.rgb.alpha === 0) return;
    this.internal.push(color);
    this.sort();
  }

  /** `add`: rejects alpha 0 and colours `hasColor` matches. */
  add(color: PaletteColor | null): boolean {
    if (color === null) throw new TypeError("Cannot add null to a palette");
    if (color.rgb.alpha === 0) return false;
    if (!this.hasColor(color)) {
      this.internal.push(color);
      this.sort();
      return true;
    }
    return false;
  }

  /** `addAll`: like `add` for each, one sort at the end. */
  addAll(colors: Iterable<PaletteColor>): boolean {
    let added = false;
    for (const c of colors) {
      if (c.rgb.alpha === 0) continue;
      if (!this.hasColor(c)) {
        this.internal.push(c);
        added = true;
      }
    }
    if (added) this.sort();
    return added;
  }

  /** `hasColor(int)`: exact ABGR match (never for alpha 0). */
  hasColorValue(abgr: number): boolean {
    if (abgrAlpha(abgr) === 0) return false;
    return this.internal.some((c) => c.value === abgr);
  }

  /** `hasColor(color[, tolerance])`: exact at tolerance 0, else LAB distance. */
  hasColor(color: PaletteColor, tolerance: number = this.tolerance): boolean {
    if (color.rgb.alpha === 0) return false;
    for (const c of this.internal) {
      if (tolerance === 0) {
        if (c.value === color.value) return true;
      } else if (c.distanceTo(color) <= tolerance) {
        return true;
      }
    }
    return false;
  }

  getDarkest(offset = 0): PaletteColor {
    return this.get(offset);
  }

  getLightest(offset = 0): PaletteColor {
    return this.get(this.internal.length - 1 - offset);
  }

  /** `remove(int index)`. */
  removeAt(index: number): PaletteColor {
    this.checkIndex(index);
    return this.internal.splice(index, 1)[0];
  }

  /** `remove(PaletteColor)`: the first colour of equal `value`. */
  remove(color: PaletteColor): boolean {
    const i = this.indexOf(color);
    if (i < 0) return false;
    this.internal.splice(i, 1);
    return true;
  }

  /** `removeAll`: removes every colour equal to one of `colors`, then sorts. */
  removeAll(colors: Iterable<PaletteColor>): boolean {
    const values = new Set([...colors].map((c) => c.value));
    const before = this.internal.length;
    const kept = this.internal.filter((c) => !values.has(c.value));
    if (kept.length === before) return false;
    this.internal.length = 0;
    this.internal.push(...kept);
    this.sort();
    return true;
  }

  clear(): void {
    this.internal.length = 0;
  }

  /** `calculateAverage`: LAB mean of every colour. */
  calculateAverage(): PaletteColor {
    return PaletteColor.of(LABColor.average(this.internal.map((c) => c.lab)));
  }

  /** `getColorAtSlope`: 0 = darkest, 1 = lightest. */
  getColorAtSlope(slope: number): PaletteColor {
    const index = Math.round(
      f((this.internal.length - 1) * clamp(f(slope), 0, 1)),
    );
    return this.get(index);
  }

  getCenterColor(): PaletteColor {
    return this.getColorClosestTo(this.calculateAverage());
  }

  getColorClosestTo(target: PaletteColor): PaletteColor {
    let best = target;
    let lastDist = FLOAT_MAX_VALUE;
    for (const c of this.internal) {
      const dist = target.distanceTo(c);
      if (dist < lastDist) {
        lastDist = dist;
        best = c;
      }
    }
    return best;
  }

  /**
   * `matchSize(targetSize[, targetLumStep])`: removes or adds colours until
   * the size matches (or the try budget runs out).
   */
  matchSize(targetSize: number, targetLumStep: number | null = null): void {
    const originalSize = this.size();
    const sizeDiff = Math.max(6, Math.abs(targetSize - originalSize));
    let step = targetLumStep === null ? null : f(targetLumStep);
    if (step !== null && f((targetSize - 1) * step) > 1) {
      throw new Error("Palette (size-1) * luminance step must be less than 1");
    }
    if (step !== null && step < 0)
      throw new Error("Luminance step must be positive");
    if (this.size() === 0 || targetSize <= 0)
      throw new Error("Palette size can't be 0");
    if (step !== null) step = f(step - f(0.00001));
    if (this.size() === 1) {
      const first = this.get(0);
      this.add(first.getDarkened());
      this.add(first.getLightened());
      if (this.size() === 1) return;
    }
    if (this.size() === 2 && targetSize > 1 && step === null) {
      const lightest = this.getLightest();
      const darkest = this.getDarkest();
      const other = Palette.fromArc(lightest.hcl, darkest.hcl, targetSize);
      this.internal.length = 0;
      this.internal.push(...other.internal);
    }
    let maxTries = sizeDiff * 6;
    while (this.size() > targetSize && maxTries-- > 0) {
      if (this.size() > 14) this.removeLeastUsed();
      else this.reduceAndAverage();
    }
    let down = true;
    let canIncreaseDown = true;
    let canIncreaseUp = true;
    maxTries = sizeDiff * 6;
    while (this.size() < targetSize && maxTries-- > 0) {
      if (
        (!canIncreaseDown && !canIncreaseUp) ||
        !this.shouldExpandRange(targetSize, step)
      ) {
        this.increaseInner();
      } else {
        const added = down ? this.increaseDown() : this.increaseUp();
        if (added === null) {
          if (down) canIncreaseDown = false;
          else canIncreaseUp = false;
          down = !down;
        }
        if (canIncreaseDown && canIncreaseUp) down = !down;
      }
    }
  }

  private shouldExpandRange(
    targetSize: number,
    targetStep: number | null,
  ): boolean {
    if (targetStep === null) return false;
    const targetRange = f((targetSize - 1) * targetStep);
    return this.getLuminanceSpan() < targetRange;
  }

  /** Removes the first colour with the strictly smallest occurrence. */
  removeLeastUsed(): PaletteColor {
    let toRemove = this.get(0);
    for (const p of this.internal) {
      if (p.occurrence < toRemove.occurrence) toRemove = p;
    }
    this.remove(toRemove);
    return toRemove;
  }

  /** `reduce`: removes the colour closest in luminance to the one below it. */
  reduce(): PaletteColor {
    if (this.size() < 2) return this.removeAt(0);
    return this.removeAt(this.indexOfSmallestLuminanceStep());
  }

  /** `reduceAndAverage`: replaces the closest pair by their LAB mix. */
  reduceAndAverage(): PaletteColor {
    const index = this.indexOfSmallestLuminanceStep();
    const toRemove = this.get(index);
    const toRemove2 = this.get(index - 1);
    this.remove(toRemove);
    this.remove(toRemove2);
    const newColor = PaletteColor.of(toRemove.lab.mixWith(toRemove2.lab));
    newColor.occurrence = toRemove.occurrence + toRemove2.occurrence;
    this.addUnchecked(newColor);
    return newColor;
  }

  private indexOfSmallestLuminanceStep(): number {
    let index = 1;
    let minDelta = FLOAT_MAX_VALUE;
    let lastLum = this.get(0).luminance;
    for (let i = 1; i < this.size(); i++) {
      const l = this.get(i).luminance;
      const dl = f(l - lastLum);
      if (dl < minDelta) {
        index = i;
        minDelta = dl;
      }
      lastLum = l;
    }
    return index;
  }

  /** `changeSizeMatchingLuminanceSpan`. */
  changeSizeMatchingLuminanceSpan(targetLuminanceSpan: number): void {
    targetLuminanceSpan = f(targetLuminanceSpan);
    if (targetLuminanceSpan > 1 || targetLuminanceSpan < 0) {
      throw new Error("Luminance span must be between 0 and 1");
    }
    let currentSpan = this.getLuminanceSpan();
    while (
      Math.abs(f(currentSpan - targetLuminanceSpan)) >
      0.5 * this.getAverageLuminanceStep()
    ) {
      const sizeBefore = this.size();
      if (currentSpan < targetLuminanceSpan) {
        if (this.getLightest().luminance < f(1 - this.getDarkest().luminance))
          this.increaseUp();
        else this.increaseDown();
      } else if (currentSpan > targetLuminanceSpan) {
        if (this.size() <= 2) break;
        if (this.getLightest().luminance > f(1 - this.getDarkest().luminance))
          this.reduceUp();
        else this.reduceDown();
      } else {
        break;
      }
      if (sizeBefore === this.size()) break;
      currentSpan = this.getLuminanceSpan();
    }
  }

  /** `expandMatchingLuminanceRange`. */
  expandMatchingLuminanceRange(
    minLuminance: number,
    maxLuminance: number,
  ): void {
    minLuminance = f(minLuminance);
    maxLuminance = f(maxLuminance);
    let currentMin = this.getDarkest().luminance;
    let currentMax = this.getLightest().luminance;
    while (
      Math.abs(f(currentMin - minLuminance)) >
      0.5 * this.getAverageLuminanceStep()
    ) {
      const sizeBefore = this.size();
      if (currentMin < minLuminance) {
        if (this.size() <= 2) break;
        this.reduceDown();
      } else {
        this.increaseDown();
      }
      if (sizeBefore === this.size()) break;
      currentMin = this.getDarkest().luminance;
    }
    while (
      Math.abs(f(currentMax - maxLuminance)) >
      0.5 * this.getAverageLuminanceStep()
    ) {
      const sizeBefore = this.size();
      if (currentMax > maxLuminance) {
        if (this.size() <= 2) break;
        this.reduceUp();
      } else {
        this.increaseUp();
      }
      if (sizeBefore === this.size()) break;
      currentMax = this.getLightest().luminance;
    }
  }

  /**
   * `matchLuminanceStep`: same size, colours re-spaced `newLuminanceStep`
   * apart (HCL luminance), centred on the old centre luminance.
   */
  matchLuminanceStep(newLuminanceStep: number): void {
    let step = f(newLuminanceStep);
    const size = this.size();
    if (size < 2) return;
    let span = f(step * (size - 1));
    if (span > 1) {
      step = f(1 / (size - 1));
      span = 1;
    }
    const lower = clamp(
      f(this.getCenterLuminance() - f(span / 2)),
      0,
      f(1 - span),
    );
    const rescaled: PaletteColor[] = [];
    for (let i = 0; i < size; i++) {
      const color = this.internal[i];
      const moved = PaletteColor.of(
        color.hcl.withLuminance(f(lower + f(i * step))),
      );
      moved.occurrence = color.occurrence;
      rescaled.push(moved);
    }
    this.internal.length = 0;
    this.internal.push(...rescaled);
    this.sort();
  }

  multiplyContrast(factor: number): void {
    this.matchLuminanceStep(f(this.getAverageLuminanceStep() * f(factor)));
  }

  matchLuminanceSpan(targetLuminanceSpan: number): void {
    if (this.size() < 2) return;
    this.matchLuminanceStep(f(f(targetLuminanceSpan) / (this.size() - 1)));
  }

  shiftLuminance(delta: number): void {
    this.transformColors((c) =>
      PaletteColor.of(c.hcl.withLuminance(f(c.hcl.luminance + f(delta)))),
    );
  }

  multiplyChroma(factor: number): void {
    this.transformColors((c) =>
      PaletteColor.of(c.hcl.withChroma(f(c.hcl.chroma * f(factor)))),
    );
  }

  /** `transformColors`: keeps occurrences; equal results collapse into one. */
  transformColors(transform: (c: PaletteColor) => PaletteColor): void {
    const out: PaletteColor[] = [];
    for (const color of this.internal) {
      const next = transform(color);
      next.occurrence = color.occurrence;
      if (next.rgb.alpha !== 0 && !out.some((c) => c.value === next.value))
        out.push(next);
    }
    this.internal.length = 0;
    this.internal.push(...out);
    this.sort();
  }

  /** `getLuminanceSteps`: luminance increase between neighbours. */
  getLuminanceSteps(): number[] {
    const list: number[] = [];
    let lastLum = this.get(0).luminance;
    for (let i = 1; i < this.size(); i++) {
      const l = this.get(i).luminance;
      list.push(f(l - lastLum));
      lastLum = l;
    }
    return list;
  }

  /** `getLuminanceStepVariationCoeff`: SD / mean of the steps. */
  getLuminanceStepVariationCoeff(): number {
    const mean = this.getAverageLuminanceStep();
    if (this.size() < 3 || mean === 0) return 0;
    const list = this.getLuminanceSteps();
    let sum = 0;
    for (const s of list) sum = f(sum + f(f(s - mean) * f(s - mean)));
    return f(f(Math.sqrt(f(sum / (list.length - 1)))) / mean);
  }

  /** `(lightest − darkest) / (size − 1)`, 0 below 2 colours. */
  getAverageLuminanceStep(): number {
    if (this.size() < 2) return 0;
    return f(this.getLuminanceSpan() / (this.size() - 1));
  }

  getLuminanceSpan(): number {
    return f(this.getLightest().luminance - this.getDarkest().luminance);
  }

  getCenterLuminance(): number {
    return f(f(this.getLightest().luminance + this.getDarkest().luminance) / 2);
  }

  /** Removes the lightest colour (by value). */
  reduceUp(): PaletteColor {
    const c = this.getLightest();
    this.remove(c);
    return c;
  }

  /** Removes the darkest colour (by value). */
  reduceDown(): PaletteColor {
    const c = this.getDarkest();
    this.remove(c);
    return c;
  }

  /**
   * `increaseInner`: adds the HCL mix of the pair with the largest luminance
   * gap (ignores tolerance; clipped colours are dropped). Throws below 2.
   */
  increaseInner(): PaletteColor {
    let index = 1;
    let maxDelta = 0;
    let lastLum = this.get(0).luminance;
    for (let i = 1; i < this.size(); i++) {
      const l = this.get(i).luminance;
      const dl = f(l - lastLum);
      if (dl > maxDelta) {
        index = i;
        maxDelta = dl;
      }
      lastLum = l;
    }
    const c1 = this.get(index).hcl;
    const c2 = this.get(index - 1).hcl;
    const newC = PaletteColor.of(c1.mixWith(c2));
    this.addUnchecked(newC);
    return newC;
  }

  /** `increaseUp`: a highlight above the lightest, or null if none fits. */
  increaseUp(): PaletteColor | null {
    const step = this.getAverageLuminanceStep();
    const lightest = this.getLightest().hcl;
    const second = this.get(this.size() - 2).hcl;
    return this.addNextColor(getNextColor(step, lightest, second));
  }

  /** `increaseDown`: an outline below the darkest, or null if none fits. */
  increaseDown(): PaletteColor | null {
    const step = this.getAverageLuminanceStep();
    const darkest = this.getDarkest().hcl;
    const second = this.get(1).hcl;
    return this.addNextColor(getNextColor(f(-step), darkest, second));
  }

  private addNextColor(next: HCLColor | null): PaletteColor | null {
    if (next === null) return null;
    const color = PaletteColor.of(next);
    if (this.hasColorValue(color.value)) return null;
    const sizeBefore = this.size();
    this.addUnchecked(color);
    return this.size() > sizeBefore ? color : null;
  }

  /** `Palette.merge`: one colour per value, occurrences summed (copies). */
  static merge(...palettes: Palette[]): Palette {
    const map = new Map<number, PaletteColor>();
    for (const p of palettes) {
      for (const c of p.internal) {
        const existing = map.get(c.value);
        if (existing === undefined) map.set(c.value, c.copy());
        else existing.occurrence += c.occurrence;
      }
    }
    return new Palette(map.values());
  }

  /** `Palette.ofColors`. */
  static ofColors(colors: Iterable<AnyColor | number>): Palette {
    return new Palette(
      javaColorSet([...colors].map((c) => PaletteColor.of(c))),
    );
  }

  /** `Palette.fromArc`: `size` mixes from `dark` to `light`. */
  static fromArc(light: HCLColor, dark: HCLColor, size: number): Palette;
  static fromArc(light: LABColor, dark: LABColor, size: number): Palette;
  static fromArc(
    light: HCLColor | LABColor,
    dark: HCLColor | LABColor,
    size: number,
  ): Palette {
    if (size <= 1) throw new Error("Size must be greater than one");
    const colors: PaletteColor[] = [];
    for (let i = 0; i < size; i++) {
      const t = f(i / f(size - 1));
      const mixed =
        dark instanceof HCLColor
          ? dark.mixWith(light as HCLColor, t)
          : (dark as LABColor).mixWith(light as LABColor, t);
      colors.push(PaletteColor.of(mixed));
    }
    return new Palette(javaColorSet(colors));
  }

  /**
   * `Palette.fromImage`: the merged palette of every frame (exact colours),
   * then `updateTolerance(tolerance)`. Throws when it ends up empty.
   */
  static fromImage(
    image: TextureImage,
    mask: TextureImage | null = null,
    tolerance: number = BASE_TOLERANCE,
  ): Palette {
    const palettes = Palette.fromAnimatedImage(image, mask, 0);
    const palette = Palette.merge(...palettes);
    if (f(tolerance) !== 0) palette.updateTolerance(tolerance);
    if (palette.isEmpty())
      throw new Error("Palette from image ended up being empty");
    return palette;
  }

  /**
   * `Palette.fromAnimatedImage`: one palette per frame of the grid. A pixel
   * counts when it isn't fully transparent and the mask (if any, repeated
   * over the frames) is transparent there. A mask whose frame is smaller
   * than the image's is ignored.
   */
  static fromAnimatedImage(
    image: TextureImage,
    mask: TextureImage | null = null,
    tolerance: number = BASE_TOLERANCE,
  ): Palette[] {
    if (
      mask !== null &&
      (mask.frameWidth < image.frameWidth ||
        mask.frameHeight < image.frameHeight)
    ) {
      mask = null;
    }
    const maskImage = mask;
    const maskFrames = maskImage === null ? 1 : maskImage.frameCount;
    const builders: FastutilIntMap<PaletteColor>[] = [];
    image.forEachPixel((frame, x, y, gx, gy) => {
      if (builders.length <= frame)
        builders.push(new FastutilIntMap<PaletteColor>());
      const builder = builders[frame];
      if (
        maskImage === null ||
        abgrAlpha(maskImage.getFramePixel(frame % maskFrames, x, y)) === 0
      ) {
        const color = image.getPixel(gx, gy);
        if (abgrAlpha(color) !== 0) {
          let pc = builder.get(color);
          if (pc === undefined) {
            pc = PaletteColor.of(color);
            builder.set(color, pc);
          }
          pc.occurrence++;
        }
      }
    });
    return builders.map((b) =>
      b.size === 0 ? new Palette() : new Palette(b.values(), tolerance),
    );
  }
}

/** `Palette.wasColorClipped`: chroma > 0 but the RGB is pure white or black. */
function wasColorClipped(col: PaletteColor): boolean {
  const rgbOnly = col.rgb.toInt() & 0x00ffffff;
  return col.hcl.chroma > 0 && (rgbOnly === 0x00ffffff || rgbOnly === 0);
}

/** `Palette.getNextColor`: extrapolates one luminance step past `source`. */
function getNextColor(
  lumIncrease: number,
  source: HCLColor,
  previous: HCLColor,
): HCLColor | null {
  const newLum = f(source.luminance + lumIncrease);
  if (newLum <= 0 || newLum >= 1) return null;
  const h1 = source.hue;
  const c1 = source.chroma;
  const a1 = source.alpha;
  const h2 = previous.hue;
  const c2 = previous.chroma;
  const a2 = previous.alpha;
  const hueIncrease = f(
    -signedAngleDiff(h1 * Math.PI * 2, h2 * Math.PI * 2) / (Math.PI * 2.0),
  );
  let newH = f(h1 + f(hueIncrease * 0.5));
  while (newH < 0) newH = f(newH + 1);
  const newC = Math.max(0, f(c1 + f(f(c1 - c2) * 0.5)));
  const newA = f(a1 + f(a1 - a2));
  return fitChromaInGamut(new HCLColor(newH, newC, newLum, newA));
}

function fitChromaInGamut(color: HCLColor): HCLColor {
  let fitted = color;
  for (let i = 0; i < 12 && !isInGamut(fitted); i++) {
    fitted = fitted.withChroma(f(fitted.chroma * f(0.8)));
  }
  return fitted;
}

function isInGamut(color: HCLColor): boolean {
  return color.asRGB().asHCL().distTo(color) < f(0.005);
}
