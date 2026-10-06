// Appearance descriptors of blocks for agents: average colour, up to three
// dominant colours with their shares, texture variance, and 16×16 swatches
// of the top, side and bottom faces. Built from the same inputs as
// `computeModAppearances` (a blockstate, its models and decoded textures),
// for mod blocks and vanilla blocks alike, so the two are comparable.
//
//   - Statistics pool the pixels of every face the default state's models
//     draw (each face weighs 1, spread over its texture's first animation
//     frame), weighted by alpha, so transparent pixels count for nothing.
//     Faces with a `tintindex` are multiplied by `defaultTint` first.
//   - `hex` is the alpha-weighted mean in linear sRGB, as in
//     `render/block-appearance.ts`. `dominant` is a 3-means clustering in
//     OKLab with near-identical clusters merged. `variance` is twice the
//     RMS OKLab distance from the mean, clamped to 1 (a black and white
//     checkerboard is 1, a flat colour 0).
//   - Swatches show the whole first frame of the texture on each face,
//     box-filtered (or nearest-neighbour upscaled) to 16×16, tinted, with
//     transparent pixels kept. `top`/`bottom` are the largest up/down faces,
//     `side` the texture covering the most horizontal-facing area.
//
// Pure: no DOM, no Node APIs. Imports carry their `.ts` extension so the
// upload CLI can load it with node's strip-types.

import {
  decodePng,
  defaultStateModels,
  defaultTint,
  firstFrameRegion,
  linearSrgbToOklab,
  normalizeResourceId,
  oklabToSrgb,
  resolveModel,
  resolveTextureRef,
  srgbToLinear,
  srgbToOklab,
  vanillaModelLookup,
  type BlockStateProperties,
  type PixelRegion,
  type RgbaImage,
} from "../render/block-appearance.ts";
import { modernizeLegacyModAssets } from "../mods/generated/legacy-blockstate.ts";
import { modernVanillaTextureId } from "../mods/generated/legacy-textures.ts";
import type { ModAppearanceInput } from "../mods/mod-appearance.ts";
import type { ModBlockAppearance } from "./schema.ts";
import { encodeRgbaPng } from "./png.ts";

export const SWATCH_SIZE = 16;
export const SWATCH_FACES = ["top", "side", "bottom"] as const;
export type SwatchFace = (typeof SWATCH_FACES)[number];

/** At most this many dominant colours per block. */
export const MAX_DOMINANT_COLORS = 3;

export interface DominantColor {
  hex: string;
  /** Share of the block's opaque pixels, 0–1; a block's shares sum to ~1. */
  share: number;
}

export interface BlockDescriptor {
  /** Alpha-weighted average colour, `#rrggbb`. */
  hex: string;
  /** OKLab `[L, a, b]` of `hex`, rounded to 3 decimals. */
  oklab: [number, number, number];
  /** Largest first. */
  dominant: DominantColor[];
  /** 0 (flat colour) to 1 (very busy). */
  variance: number;
  /** 16×16 RGBA swatch per face; null when the model draws no such face. */
  faces: Record<SwatchFace, RgbaImage | null>;
}

/** One texture's pixels: the image and its first animation frame. */
export interface TextureFrame {
  image: RgbaImage;
  region: PixelRegion;
}

export interface DescriptorSources {
  /** Raw model JSON by normalized id (`ns:block/x`), or undefined. */
  getModel: (id: string) => unknown;
  /** Decoded texture by normalized id (`ns:block/x`), or null. */
  getTexture: (id: string) => TextureFrame | null;
}

// ── Model faces ───────────────────────────────────────────────────────────

const DIRECTIONS = ["down", "up", "north", "south", "west", "east"] as const;
type Direction = (typeof DIRECTIONS)[number];
const HORIZONTAL: readonly Direction[] = ["north", "south", "west", "east"];

/** Where a model face ends up after a blockstate `x: 90` rotation. */
const X90: Record<Direction, Direction> = {
  north: "down",
  down: "south",
  south: "up",
  up: "north",
  west: "west",
  east: "east",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface PlacedModel {
  id: string;
  /** Blockstate `x` rotation in quarter turns (0–3). */
  xTurns: number;
}

function variantKeyMatches(key: string, defaults: BlockStateProperties) {
  if (key === "") return true;
  return key.split(",").every((pair) => {
    const eq = pair.indexOf("=");
    return (
      eq >= 0 &&
      Object.hasOwn(defaults, pair.slice(0, eq).trim()) &&
      defaults[pair.slice(0, eq).trim()] === pair.slice(eq + 1).trim()
    );
  });
}

/**
 * The default state's models with their `x` rotation. Without `defaults`
 * (mods), a `variants` blockstate prefers its first unrotated variant, so a
 * log shows its end on top instead of the alphabetically first `axis=x`.
 */
function defaultPlacedModels(
  blockstate: unknown,
  defaults?: BlockStateProperties,
): PlacedModel[] {
  if (isRecord(blockstate) && isRecord(blockstate.variants)) {
    const entries = Object.entries(blockstate.variants).map(
      ([key, value]) => [key, Array.isArray(value) ? value[0] : value] as const,
    );
    const rotated = (entry: unknown) =>
      isRecord(entry) &&
      ((typeof entry.x === "number" && entry.x % 360 !== 0) ||
        (typeof entry.y === "number" && entry.y % 360 !== 0));
    const chosen =
      (defaults !== undefined
        ? entries.find(([key]) => variantKeyMatches(key, defaults))
        : undefined) ??
      entries.find(([, entry]) => !rotated(entry)) ??
      entries[0];
    const entry = chosen?.[1];
    if (!isRecord(entry) || typeof entry.model !== "string") return [];
    const x = typeof entry.x === "number" ? entry.x : 0;
    return [
      {
        id: normalizeResourceId(entry.model),
        xTurns: (((Math.round(x / 90) % 4) + 4) % 4) as number,
      },
    ];
  }
  return defaultStateModels(blockstate, defaults).map((id) => ({
    id,
    xTurns: 0,
  }));
}

function rotateX(direction: Direction, turns: number): Direction {
  let out = direction;
  for (let i = 0; i < turns; i++) out = X90[out];
  return out;
}

/** One face a model draws: where it faces, its texture, size and tint. */
interface DrawnFace {
  direction: Direction;
  texture: string;
  tinted: boolean;
  area: number;
}

function vector(value: unknown, fallback: number): [number, number, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number")
    ? (value as [number, number, number])
    : [fallback, fallback, fallback];
}

function faceArea(element: Record<string, unknown>, direction: Direction) {
  const from = vector(element.from, 0);
  const to = vector(element.to, 16);
  const [dx, dy, dz] = [0, 1, 2].map((i) => Math.abs(to[i] - from[i]));
  const area =
    direction === "up" || direction === "down"
      ? dx * dz
      : direction === "north" || direction === "south"
        ? dx * dy
        : dz * dy;
  // Flat planes (zero-thickness overlays) still draw something.
  return Math.max(area, 1);
}

/**
 * Every face the default state draws. Models without elements (block
 * entities, fluids) draw each of their texture variables on every side, so
 * their `particle` texture still gives them a colour and swatches.
 */
function drawnFaces(
  blockstate: unknown,
  sources: DescriptorSources,
  defaults?: BlockStateProperties,
): DrawnFace[] {
  const out: DrawnFace[] = [];
  for (const placed of defaultPlacedModels(blockstate, defaults)) {
    const model = resolveModel(placed.id, sources.getModel);
    if (model === null) continue;
    let drew = false;
    for (const element of model.elements ?? []) {
      if (!isRecord(element) || !isRecord(element.faces)) continue;
      for (const direction of DIRECTIONS) {
        const face = element.faces[direction];
        if (!isRecord(face)) continue;
        drew = true;
        // Face textures always name a variable; the `#` is optional.
        const variable =
          typeof face.texture === "string" && !face.texture.startsWith("#")
            ? `#${face.texture}`
            : face.texture;
        const texture = resolveTextureRef(variable, model.textures);
        if (texture === null) continue;
        out.push({
          direction: rotateX(direction, placed.xTurns),
          texture,
          tinted: typeof face.tintindex === "number",
          area: faceArea(element, direction),
        });
      }
    }
    if (drew) continue;
    const refs = Object.hasOwn(model.textures, "particle")
      ? [model.textures.particle]
      : Object.values(model.textures);
    for (const ref of refs) {
      const texture = resolveTextureRef(ref, model.textures);
      if (texture === null) continue;
      for (const direction of DIRECTIONS) {
        out.push({ direction, texture, tinted: false, area: 1 });
      }
    }
  }
  return out;
}

// ── Pixels ────────────────────────────────────────────────────────────────

function tintChannel(value: number, tint: number, shift: number): number {
  return Math.round((value * ((tint >> shift) & 0xff)) / 255);
}

/**
 * Colour histogram of a frame: `0xRRGGBB` → summed alpha, normalized so a
 * fully opaque frame sums to 1.
 */
function frameHistogram(
  frame: TextureFrame,
  tint: number | null,
): Map<number, number> {
  const { image, region } = frame;
  const [rx, ry, rw, rh] = region;
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const x1 = Math.min(image.width, rx + rw);
  const y1 = Math.min(image.height, ry + rh);
  const count = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const out = new Map<number, number>();
  if (count === 0) return out;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      const alpha = image.data[o + 3];
      if (alpha === 0) continue;
      let r = image.data[o];
      let g = image.data[o + 1];
      let b = image.data[o + 2];
      if (tint !== null) {
        r = tintChannel(r, tint, 16);
        g = tintChannel(g, tint, 8);
        b = tintChannel(b, tint, 0);
      }
      const key = (r << 16) | (g << 8) | b;
      out.set(key, (out.get(key) ?? 0) + alpha / 255 / count);
    }
  }
  return out;
}

/**
 * A frame scaled to a 16×16 swatch: each swatch pixel averages the source
 * pixels under it (alpha-weighted), or repeats the nearest one when the
 * source is smaller. Transparent pixels stay transparent.
 */
export function frameSwatch(
  frame: TextureFrame,
  tint: number | null = null,
): RgbaImage {
  const { image, region } = frame;
  const [rx, ry, rw, rh] = region;
  const data = new Uint8Array(SWATCH_SIZE * SWATCH_SIZE * 4);
  const span = (index: number, size: number): [number, number] => {
    const start = Math.floor((index * size) / SWATCH_SIZE);
    const end = Math.floor(((index + 1) * size) / SWATCH_SIZE);
    return [start, Math.max(end, start + 1)];
  };
  for (let ty = 0; ty < SWATCH_SIZE; ty++) {
    const [sy0, sy1] = span(ty, rh);
    for (let tx = 0; tx < SWATCH_SIZE; tx++) {
      const [sx0, sx1] = span(tx, rw);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = ry + sy0; y < ry + sy1; y++) {
        if (y < 0 || y >= image.height) continue;
        for (let x = rx + sx0; x < rx + sx1; x++) {
          if (x < 0 || x >= image.width) continue;
          const o = (y * image.width + x) * 4;
          const alpha = image.data[o + 3];
          r += image.data[o] * alpha;
          g += image.data[o + 1] * alpha;
          b += image.data[o + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }
      if (n === 0 || a === 0) continue;
      const o = (ty * SWATCH_SIZE + tx) * 4;
      const [cr, cg, cb] = [r / a, g / a, b / a].map(Math.round);
      data[o] = tint === null ? cr : tintChannel(cr, tint, 16);
      data[o + 1] = tint === null ? cg : tintChannel(cg, tint, 8);
      data[o + 2] = tint === null ? cb : tintChannel(cb, tint, 0);
      data[o + 3] = Math.round(a / n);
    }
  }
  return { width: SWATCH_SIZE, height: SWATCH_SIZE, data };
}

// ── Colour statistics ─────────────────────────────────────────────────────

/** Clusters whose centres are closer than this (OKLab) are one colour. */
const MERGE_DISTANCE = 0.04;
/** Clusters with a smaller share are dropped from `dominant`. */
const MIN_DOMINANT_SHARE = 0.02;
const KMEANS_ITERATIONS = 16;

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded; // no -0 in JSON
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function linearToSrgb8(value: number): number {
  const c = Math.max(0, Math.min(1, value));
  const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

type Lab = [number, number, number];

function distance2(a: Lab, b: Lab): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

interface ColourStats {
  hex: string;
  oklab: Lab;
  dominant: DominantColor[];
  variance: number;
}

/** Statistics of a weighted colour histogram; null when it's empty. */
function colourStats(histogram: Map<number, number>): ColourStats | null {
  const colours: { lab: Lab; weight: number }[] = [];
  let total = 0;
  let lr = 0;
  let lg = 0;
  let lb = 0;
  // Sorted so ties in the clustering resolve the same way every run.
  for (const [rgb, weight] of [...histogram].sort((a, b) => a[0] - b[0])) {
    if (weight <= 0) continue;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    lr += srgbToLinear(r) * weight;
    lg += srgbToLinear(g) * weight;
    lb += srgbToLinear(b) * weight;
    total += weight;
    colours.push({ lab: srgbToOklab(r, g, b), weight });
  }
  if (total <= 0) return null;

  const mean: Lab = [0, 0, 0];
  for (const { lab, weight } of colours) {
    for (let i = 0; i < 3; i++) mean[i] += (lab[i] * weight) / total;
  }
  let spread = 0;
  for (const { lab, weight } of colours) {
    spread += distance2(lab, mean) * weight;
  }
  const variance = round3(Math.min(1, 2 * Math.sqrt(spread / total)));

  const [hr, hg, hb] = [lr, lg, lb].map((v) => linearToSrgb8(v / total));
  const oklab = linearSrgbToOklab(lr / total, lg / total, lb / total).map(
    round3,
  ) as Lab;
  return {
    hex: toHex(hr, hg, hb),
    oklab,
    dominant: dominantColours(colours, total),
    variance,
  };
}

/**
 * Weighted k-means (k = 3) in OKLab, seeded with the heaviest colour and
 * then the colours farthest from the seeds so far; near-identical clusters
 * are merged and tiny ones dropped.
 */
function dominantColours(
  colours: readonly { lab: Lab; weight: number }[],
  total: number,
): DominantColor[] {
  const centres: Lab[] = [];
  const heaviest = colours.reduce((a, b) => (b.weight > a.weight ? b : a));
  centres.push([...heaviest.lab]);
  while (centres.length < Math.min(MAX_DOMINANT_COLORS, colours.length)) {
    let best: Lab | null = null;
    let bestScore = 0;
    for (const { lab } of colours) {
      const score = Math.min(...centres.map((c) => distance2(lab, c)));
      if (score > bestScore) {
        bestScore = score;
        best = lab;
      }
    }
    if (best === null) break;
    centres.push([...best]);
  }

  let weights: number[] = [];
  for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration++) {
    const sums = centres.map((): [number, number, number, number] => [
      0, 0, 0, 0,
    ]);
    for (const { lab, weight } of colours) {
      let nearest = 0;
      for (let i = 1; i < centres.length; i++) {
        if (distance2(lab, centres[i]) < distance2(lab, centres[nearest])) {
          nearest = i;
        }
      }
      const sum = sums[nearest];
      sum[0] += lab[0] * weight;
      sum[1] += lab[1] * weight;
      sum[2] += lab[2] * weight;
      sum[3] += weight;
    }
    weights = sums.map((sum) => sum[3]);
    let moved = false;
    sums.forEach((sum, i) => {
      if (sum[3] <= 0) return;
      const next: Lab = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
      if (distance2(next, centres[i]) > 1e-12) moved = true;
      centres[i] = next;
    });
    if (!moved) break;
  }

  // Merge clusters that ended up the same colour, heaviest first.
  const clusters = centres
    .map((lab, i) => ({ lab, weight: weights[i] ?? 0 }))
    .filter((cluster) => cluster.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const merged: { lab: Lab; weight: number }[] = [];
  for (const cluster of clusters) {
    const into = merged.find(
      (m) => distance2(m.lab, cluster.lab) < MERGE_DISTANCE ** 2,
    );
    if (into === undefined) {
      merged.push({ lab: [...cluster.lab], weight: cluster.weight });
      continue;
    }
    const sum = into.weight + cluster.weight;
    for (let i = 0; i < 3; i++) {
      into.lab[i] =
        (into.lab[i] * into.weight + cluster.lab[i] * cluster.weight) / sum;
    }
    into.weight = sum;
  }
  const kept = merged.filter((m) => m.weight / total >= MIN_DOMINANT_SHARE);
  const keptTotal = kept.reduce((n, m) => n + m.weight, 0);
  return kept
    .sort((a, b) => b.weight - a.weight)
    .map((m) => ({
      hex: toHex(...oklabToSrgb(...m.lab)),
      share: round3(m.weight / keptTotal),
    }));
}

// ── Descriptors ───────────────────────────────────────────────────────────

/**
 * Descriptor of a block's default state, or undefined when none of its faces
 * resolve to a texture with opaque pixels. `defaults` are the block's default
 * property values when known (vanilla); see `defaultStateModels`.
 */
export function describeBlockAppearance(
  blockId: string,
  blockstate: unknown,
  sources: DescriptorSources,
  defaults?: BlockStateProperties,
): BlockDescriptor | undefined {
  const tint = defaultTint(blockId);
  const histograms = new Map<string, Map<number, number> | null>();
  const swatches = new Map<string, RgbaImage | null>();
  const keyOf = (face: DrawnFace) => `${face.texture}|${face.tinted}`;
  const histogram = (face: DrawnFace) => {
    const key = keyOf(face);
    if (!histograms.has(key)) {
      const frame = sources.getTexture(face.texture);
      histograms.set(
        key,
        frame === null
          ? null
          : frameHistogram(frame, face.tinted ? tint : null),
      );
    }
    return histograms.get(key)!;
  };
  const swatch = (face: DrawnFace | undefined) => {
    if (face === undefined) return null;
    const key = keyOf(face);
    if (!swatches.has(key)) {
      const frame = sources.getTexture(face.texture);
      swatches.set(
        key,
        frame === null ? null : frameSwatch(frame, face.tinted ? tint : null),
      );
    }
    return swatches.get(key)!;
  };

  const faces = drawnFaces(blockstate, sources, defaults).filter(
    (face) => histogram(face) !== null,
  );
  const pooled = new Map<number, number>();
  for (const face of faces) {
    for (const [rgb, weight] of histogram(face)!) {
      pooled.set(rgb, (pooled.get(rgb) ?? 0) + weight);
    }
  }
  const stats = colourStats(pooled);
  if (stats === null) return undefined;

  const largest = (direction: Direction) =>
    faces
      .filter((face) => face.direction === direction)
      .reduce<
        DrawnFace | undefined
      >((best, face) => (best === undefined || face.area > best.area ? face : best), undefined);
  const sideArea = new Map<string, { face: DrawnFace; area: number }>();
  for (const face of faces) {
    if (!HORIZONTAL.includes(face.direction)) continue;
    const entry = sideArea.get(keyOf(face));
    if (entry === undefined) sideArea.set(keyOf(face), { face, area: 0 });
    sideArea.get(keyOf(face))!.area += face.area;
  }
  const side = [...sideArea.values()].reduce<
    { face: DrawnFace; area: number } | undefined
  >(
    (best, entry) =>
      best === undefined || entry.area > best.area ? entry : best,
    undefined,
  );

  return {
    ...stats,
    faces: {
      top: swatch(largest("up")),
      side: swatch(side?.face),
      bottom: swatch(largest("down")),
    },
  };
}

/** The `appearance` record a `pack.json.gz` block stores. */
export function appearanceRecord(
  descriptor: BlockDescriptor,
): ModBlockAppearance {
  return {
    hex: descriptor.hex,
    oklab: descriptor.oklab,
    dominant: descriptor.dominant,
    variance: descriptor.variance,
  };
}

// ── Mod jars ──────────────────────────────────────────────────────────────

/**
 * Descriptor per mod block id, omitting blocks with no resolvable texture.
 * Same inputs and fallbacks as `computeModAppearances`: 1.12 assets are
 * modernized, and `minecraft:` models and textures the jar lacks come from
 * `vanilla` (`vanillaDescriptorSources`).
 */
export function describeModBlocks(
  input: ModAppearanceInput,
  vanilla: DescriptorSources | null = null,
): Record<string, BlockDescriptor> {
  const { blockstates, models } = modernizeLegacyModAssets(
    { blockstates: input.blockstates, models: input.models },
    (id) => vanilla?.getModel(id) !== undefined,
  );
  const frames = new Map<string, TextureFrame | null>();
  const sources: DescriptorSources = {
    getModel: (id) =>
      Object.hasOwn(models, id) ? models[id] : vanilla?.getModel(id),
    getTexture: (id) => {
      if (!Object.hasOwn(input.textures, id)) {
        return vanilla?.getTexture(modernVanillaTextureId(id)) ?? null;
      }
      let frame = frames.get(id);
      if (frame === undefined) {
        const image = decodePng(input.textures[id]);
        frame =
          image === null
            ? null
            : {
                image,
                region: firstFrameRegion(
                  image.width,
                  image.height,
                  input.textureMeta[id],
                ),
              };
        frames.set(id, frame);
      }
      return frame;
    },
  };
  const out: Record<string, BlockDescriptor> = {};
  for (const id of input.blockIds) {
    if (!Object.hasOwn(blockstates, id)) continue;
    const descriptor = describeBlockAppearance(id, blockstates[id], sources);
    if (descriptor !== undefined) out[id] = descriptor;
  }
  return out;
}

// ── Vanilla bundle ────────────────────────────────────────────────────────

/** The 3D-preview bundle in `public/minecraft-assets/`, parsed. */
export interface VanillaAssetBundle {
  /** `blockstates.json`: block path (`stone`) → blockstate JSON. */
  blockstates: Record<string, unknown>;
  /** `models.json`: path under `models/block/` → model JSON. */
  models: Record<string, unknown>;
  /** `atlas.png`, decoded. */
  atlas: RgbaImage;
  /** `atlas-uvs.json`: texture path (`block/stone`) → `[x, y, w, h]`. */
  uvs: Record<string, unknown>;
}

/**
 * Models and textures of the vanilla bundle. Animated textures occupy their
 * whole strip in the atlas; their first frame is the top square.
 */
export function vanillaDescriptorSources(
  bundle: Pick<VanillaAssetBundle, "models" | "atlas" | "uvs">,
): DescriptorSources {
  const { atlas, uvs } = bundle;
  return {
    getModel: vanillaModelLookup(bundle.models),
    getTexture: (id) => {
      if (!id.startsWith("minecraft:")) return null;
      const path = id.slice("minecraft:".length);
      const uv = Object.hasOwn(uvs, path) ? uvs[path] : undefined;
      if (
        !Array.isArray(uv) ||
        uv.length !== 4 ||
        !uv.every((n) => typeof n === "number")
      ) {
        return null;
      }
      const [x, y, w, h] = uv as number[];
      return { image: atlas, region: [x, y, w, h > w ? w : h] };
    },
  };
}

/**
 * Descriptor per vanilla block id (`minecraft:stone`), sorted by id, for
 * every blockstate in the bundle whose textures resolve. `defaultProperties`
 * maps a block path to its default property values.
 */
export function describeVanillaBlocks(
  bundle: VanillaAssetBundle,
  defaultProperties: Readonly<Record<string, BlockStateProperties>> = {},
): Record<string, BlockDescriptor> {
  const sources = vanillaDescriptorSources(bundle);
  const out: Record<string, BlockDescriptor> = {};
  for (const path of Object.keys(bundle.blockstates).sort()) {
    const descriptor = describeBlockAppearance(
      `minecraft:${path}`,
      bundle.blockstates[path],
      sources,
      Object.hasOwn(defaultProperties, path)
        ? defaultProperties[path]
        : undefined,
    );
    if (descriptor !== undefined) out[`minecraft:${path}`] = descriptor;
  }
  return out;
}

// ── Swatch sheets ─────────────────────────────────────────────────────────

/** Swatches per row of a sheet (1,024 px wide). */
export const SWATCH_SHEET_COLUMNS = 64;

/**
 * Most bytes a sheet's PNG may take. Real textures compress to well under a
 * quarter of this for a 2,000-block mod; noisier ones are posterized until
 * they fit (see `packSwatches`).
 */
export const MAX_SWATCH_SHEET_BYTES = 4 * 1024 * 1024;

/** Pixel rectangle `[x, y, width, height]` in a swatch sheet. */
export type SwatchRect = [number, number, number, number];

export interface SwatchSheet {
  /** PNG bytes of the sheet (`mod-files/<key>/swatches.png`). */
  png: Uint8Array;
  width: number;
  height: number;
  /** Block id → face → its rectangle in the sheet. */
  uvs: Record<string, Partial<Record<SwatchFace, SwatchRect>>>;
}

export interface SwatchBlock {
  id: string;
  faces: Partial<Record<SwatchFace, RgbaImage | null>>;
}

/**
 * Lays every swatch of one mod file into one PNG sheet, row by row.
 * Identical swatches (a `cube_all` block's faces, shared textures) are
 * stored once and share a rectangle. Null when no block has a swatch.
 *
 * A sheet whose PNG would exceed `MAX_SWATCH_SHEET_BYTES` (only textures that
 * are close to random noise get there) is re-encoded with fewer bits per
 * colour channel, down to 4, which keeps a 2,000-block mod under 4 MB.
 */
export function packSwatches(
  blocks: readonly SwatchBlock[],
  options: { posterize?: boolean } = {},
): SwatchSheet | null {
  const cells: Uint8Array[] = [];
  const cellOf = new Map<string, number>();
  const uvs: SwatchSheet["uvs"] = {};
  const rect = (index: number): SwatchRect => [
    (index % SWATCH_SHEET_COLUMNS) * SWATCH_SIZE,
    Math.floor(index / SWATCH_SHEET_COLUMNS) * SWATCH_SIZE,
    SWATCH_SIZE,
    SWATCH_SIZE,
  ];
  for (const block of blocks) {
    for (const face of SWATCH_FACES) {
      const image = block.faces[face];
      if (image == null) continue;
      if (image.width !== SWATCH_SIZE || image.height !== SWATCH_SIZE) {
        throw new Error(`packSwatches: ${block.id} ${face} isn't 16×16`);
      }
      const key = String.fromCharCode(...image.data);
      let index = cellOf.get(key);
      if (index === undefined) {
        index = cells.length;
        cells.push(image.data);
        cellOf.set(key, index);
      }
      (uvs[block.id] ??= {})[face] = rect(index);
    }
  }
  if (cells.length === 0) return null;

  const columns = Math.min(cells.length, SWATCH_SHEET_COLUMNS);
  const rows = Math.ceil(cells.length / SWATCH_SHEET_COLUMNS);
  const width = columns * SWATCH_SIZE;
  const height = rows * SWATCH_SIZE;
  const data = new Uint8Array(width * height * 4);
  cells.forEach((cell, index) => {
    const [x, y] = rect(index);
    for (let row = 0; row < SWATCH_SIZE; row++) {
      data.set(
        cell.subarray(row * SWATCH_SIZE * 4, (row + 1) * SWATCH_SIZE * 4),
        ((y + row) * width + x) * 4,
      );
    }
  });
  let png = encodeRgbaPng(width, height, data);
  const posterizes = options.posterize ?? true;
  for (
    let bits = 6;
    posterizes && bits >= 4 && png.length > MAX_SWATCH_SHEET_BYTES;
    bits--
  ) {
    png = encodeRgbaPng(width, height, posterize(data, bits));
  }
  return { png, width, height, uvs };
}

/**
 * Lays `blocks`' swatches into as few sheets as fit in `maxBytes` each, at
 * full colour depth: a sheet over it is split in two halves of its blocks,
 * in order, until each fits (a single block's sheet is kept whatever its
 * size). No sheets when no block has a swatch.
 */
export function packSwatchSheets(
  blocks: readonly SwatchBlock[],
  maxBytes: number = MAX_SWATCH_SHEET_BYTES,
): SwatchSheet[] {
  const sheet = packSwatches(blocks, { posterize: false });
  if (sheet === null) return [];
  if (sheet.png.length <= maxBytes || blocks.length <= 1) return [sheet];
  const half = Math.ceil(blocks.length / 2);
  return [
    ...packSwatchSheets(blocks.slice(0, half), maxBytes),
    ...packSwatchSheets(blocks.slice(half), maxBytes),
  ];
}

/** RGBA with each colour channel cut to its top `bits` bits (alpha kept). */
function posterize(data: Uint8Array, bits: number): Uint8Array {
  const out = new Uint8Array(data);
  const shift = 8 - bits;
  for (let i = 0; i < out.length; i++) {
    if (i % 4 === 3) continue;
    const top = out[i] >> shift;
    // Repeat the kept bits so 0 stays 0 and 255 stays 255.
    out[i] = ((top << shift) | (top >> (bits - shift))) & 0xff;
  }
  return out;
}
