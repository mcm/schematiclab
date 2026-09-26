// Pure (DOM-free) layout for the runtime block texture atlas.
//
// The vanilla `atlas.png` is drawn at the origin unchanged; mod textures are
// shelf-packed below it. Every UV (vanilla and mod) is normalized against the
// final atlas size, so the vanilla-only atlas keeps today's exact UVs. The
// only DOM-bound step — drawing pixels — lives in `minecraft-resources.ts`.

import type { UV } from "deepslate";

/** `[x, y, w, h]` in atlas pixels. */
export type PixelRect = readonly [number, number, number, number];

/** Texture id used for the magenta/black "missing" checker. */
export const MISSING_TEXTURE_ID = "schematiclab:block/missing";
/** Pixel size of one texture cell (and of the missing texture). */
export const CELL_SIZE = 16;
/** Assumed `MAX_TEXTURE_SIZE` when the real value can't be queried. */
export const DEFAULT_MAX_TEXTURE_SIZE = 4096;

export interface ModTextureSize {
  id: string;
  /** Full source image size (animated textures stack frames vertically). */
  width: number;
  height: number;
}

export interface AtlasPlacement {
  id: string;
  /** Source rect in the texture image (first animation frame only). */
  source: PixelRect;
  /** Destination rect in the atlas (may be smaller than `source`). */
  dest: PixelRect;
}

export interface AtlasPlan {
  width: number;
  height: number;
  /** Where to draw the missing texture (16×16). */
  missing: PixelRect;
  placements: AtlasPlacement[];
  /** Texture id (`<ns>:<path>`) → normalized UV, for vanilla, mod and missing. */
  uvMap: Record<string, UV>;
  /** True if mod textures were downscaled to 16×16 to fit. */
  downscaled: boolean;
  /** Mod textures that could not fit even after downscaling. */
  dropped: string[];
}

export interface AtlasPlanInput {
  baseWidth: number;
  baseHeight: number;
  /** Vanilla atlas rects keyed by unprefixed path (e.g. `block/stone`). */
  vanillaRects: Record<string, PixelRect>;
  modTextures: readonly ModTextureSize[];
  maxSize?: number;
}

/** Qualify a resource reference: unprefixed ids belong to `minecraft:`. */
export function qualifyId(ref: string): string {
  const sep = ref.indexOf(":");
  if (sep < 0) return `minecraft:${ref}`;
  if (sep === 0) return `minecraft${ref}`;
  return ref;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Convert vanilla pixel rects to normalized UVs keyed `minecraft:<path>`.
 * Animated textures (frames stacked vertically) use only the first frame.
 */
export function vanillaUvMap(
  rects: Record<string, PixelRect>,
  atlasWidth: number,
  atlasHeight: number,
): Record<string, UV> {
  const uvMap: Record<string, UV> = {};
  for (const [path, [x, y, w, h]] of Object.entries(rects)) {
    const frame = Math.min(w, h);
    uvMap[`minecraft:${path}`] = [
      x / atlasWidth,
      y / atlasHeight,
      (x + frame) / atlasWidth,
      (y + frame) / atlasHeight,
    ];
  }
  return uvMap;
}

function rectToUv([x, y, w, h]: PixelRect, width: number, height: number): UV {
  return [x / width, y / height, (x + w) / width, (y + h) / height];
}

/**
 * Find a free `CELL_SIZE` cell inside the vanilla atlas (scanning from the
 * bottom-right, where the packer leaves slack), or null if it is full.
 */
export function findFreeCell(
  rects: Iterable<PixelRect>,
  width: number,
  height: number,
): PixelRect | null {
  const cols = Math.floor(width / CELL_SIZE);
  const rows = Math.floor(height / CELL_SIZE);
  if (cols === 0 || rows === 0) return null;
  const used = new Uint8Array(cols * rows);
  for (const [x, y, w, h] of rects) {
    const c0 = Math.max(0, Math.floor(x / CELL_SIZE));
    const r0 = Math.max(0, Math.floor(y / CELL_SIZE));
    const c1 = Math.min(cols, Math.ceil((x + w) / CELL_SIZE));
    const r1 = Math.min(rows, Math.ceil((y + h) / CELL_SIZE));
    for (let r = r0; r < r1; r += 1) {
      for (let c = c0; c < c1; c += 1) used[r * cols + c] = 1;
    }
  }
  for (let i = used.length - 1; i >= 0; i -= 1) {
    if (used[i] === 0) {
      return [
        (i % cols) * CELL_SIZE,
        Math.floor(i / cols) * CELL_SIZE,
        CELL_SIZE,
        CELL_SIZE,
      ];
    }
  }
  return null;
}

interface PackItem {
  id: string;
  source: PixelRect;
  w: number;
  h: number;
}

interface PackResult {
  width: number;
  height: number;
  placed: Array<{ item: PackItem; x: number; y: number }>;
  overflow: PackItem[];
}

// Shelf packing below the base atlas: tallest first, left to right, a new
// shelf when the row is full. Items that would push the atlas past `maxSize`
// are returned in `overflow`. The atlas is at least `minWidth` wide.
function shelfPack(
  items: readonly PackItem[],
  baseWidth: number,
  baseHeight: number,
  maxSize: number,
  minWidth = 0,
): PackResult {
  const widest = items.reduce((max, item) => Math.max(max, item.w), 0);
  const width = Math.min(
    maxSize,
    nextPowerOfTwo(Math.max(baseWidth, widest, minWidth)),
  );
  const sorted = [...items].sort(
    (a, b) => b.h - a.h || b.w - a.w || a.id.localeCompare(b.id),
  );
  const placed: PackResult["placed"] = [];
  const overflow: PackItem[] = [];
  let shelfY = baseHeight;
  let shelfH = 0;
  let cursorX = 0;
  for (const item of sorted) {
    if (item.w > width) {
      overflow.push(item);
      continue;
    }
    if (cursorX + item.w > width) {
      shelfY += shelfH;
      shelfH = 0;
      cursorX = 0;
    }
    if (shelfY + item.h > maxSize) {
      overflow.push(item);
      continue;
    }
    placed.push({ item, x: cursorX, y: shelfY });
    cursorX += item.w;
    shelfH = Math.max(shelfH, item.h);
  }
  const usedHeight = shelfY + shelfH;
  return {
    width,
    height: nextPowerOfTwo(Math.max(baseHeight, usedHeight)),
    placed,
    overflow,
  };
}

function toPackItem(texture: ModTextureSize, downscale: boolean): PackItem {
  // First animation frame only: frames are square and stacked vertically.
  const frameH = Math.min(texture.width, texture.height);
  const source: PixelRect = [0, 0, texture.width, frameH];
  const oversized = texture.width > CELL_SIZE || frameH > CELL_SIZE;
  return downscale && oversized
    ? { id: texture.id, source, w: CELL_SIZE, h: CELL_SIZE }
    : { id: texture.id, source, w: texture.width, h: frameH };
}

/**
 * Lay out the combined atlas. With no mod textures the result has the vanilla
 * atlas's dimensions and UVs. On overflow, mod textures larger than 16×16 are
 * downscaled to 16×16 (with a single `console.warn`); any that still don't fit
 * are dropped and render with the missing texture.
 */
export function planAtlas(input: AtlasPlanInput): AtlasPlan {
  const { baseWidth, baseHeight, vanillaRects } = input;
  const maxSize = input.maxSize ?? DEFAULT_MAX_TEXTURE_SIZE;
  const textures = input.modTextures.filter(
    (t) => t.width > 0 && t.height > 0 && t.id !== MISSING_TEXTURE_ID,
  );

  const freeCell = findFreeCell(
    Object.values(vanillaRects),
    baseWidth,
    baseHeight,
  );
  const missingItem: PackItem = {
    id: MISSING_TEXTURE_ID,
    source: [0, 0, CELL_SIZE, CELL_SIZE],
    w: CELL_SIZE,
    h: CELL_SIZE,
  };
  const pack = (downscale: boolean, minWidth?: number): PackResult =>
    shelfPack(
      [
        ...(freeCell === null ? [missingItem] : []),
        ...textures.map((t) => toPackItem(t, downscale)),
      ],
      baseWidth,
      baseHeight,
      maxSize,
      minWidth,
    );

  let result = pack(false);
  let downscaled = false;
  if (result.overflow.length > 0) {
    // Retrying only helps if some texture is actually larger than 16×16.
    downscaled = textures.some((t) => {
      const { w, h } = toPackItem(t, false);
      return w > CELL_SIZE || h > CELL_SIZE;
    });
    if (downscaled) {
      // Downscaling shrinks the widest texture, so the retry may pick a
      // narrower atlas. Use it unless that drops more than keeping the
      // first attempt's width.
      let retry = pack(true);
      if (retry.width < result.width) {
        const wide = pack(true, result.width);
        if (wide.overflow.length < retry.overflow.length) retry = wide;
      }
      // Only give up resolution if it actually saves textures.
      if (retry.overflow.length < result.overflow.length) result = retry;
      else downscaled = false;
    }
    const dropped = result.overflow.length;
    console.warn(
      `Mod textures exceed the ${maxSize}px texture atlas limit;` +
        (downscaled
          ? " textures larger than 16×16 were downscaled to 16×16."
          : "") +
        (dropped > 0
          ? ` ${dropped} texture(s) ${downscaled ? "still " : ""}did not fit and will render as missing.`
          : ""),
    );
  }

  const { width, height } = result;
  let missing = freeCell;
  const placements: AtlasPlacement[] = [];
  for (const { item, x, y } of result.placed) {
    const dest: PixelRect = [x, y, item.w, item.h];
    if (item.id === MISSING_TEXTURE_ID) missing = dest;
    else placements.push({ id: item.id, source: item.source, dest });
  }
  // Only reachable if even the 16×16 missing cell overflowed, i.e. the base
  // atlas already fills `maxSize`; reuse the top-left cell rather than crash.
  missing ??= [0, 0, CELL_SIZE, CELL_SIZE];

  const uvMap = vanillaUvMap(vanillaRects, width, height);
  for (const { id, dest } of placements) {
    uvMap[id] = rectToUv(dest, width, height);
  }
  uvMap[MISSING_TEXTURE_ID] = rectToUv(missing, width, height);

  return {
    width,
    height,
    missing,
    placements,
    uvMap,
    downscaled,
    dropped: result.overflow
      .map((item) => item.id)
      .filter((id) => id !== MISSING_TEXTURE_ID),
  };
}
