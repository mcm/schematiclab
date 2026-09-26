// Runtime loader for the 3D preview's deepslate `Resources`: the static
// vanilla asset bundle in `public/minecraft-assets/` plus every loaded mod's
// blockstates, models and textures.
//
// The vanilla bundle is produced by `scripts/build-minecraft-assets.mts`. To
// refresh for a newer Minecraft version, run `pnpm gen:mc-assets`.
//
// Vanilla data is fetched and flattened once. Whenever the loaded-mods
// registry snapshot changes, resources are rebuilt (new combined atlas, new
// model set) and subscribers are notified so `ThreeDPreview` re-meshes. A
// build superseded by a newer snapshot is discarded. Layout and assembly are
// pure (`atlas-layout.ts`, `block-resources.ts`); only pixel drawing lives here.

import type { Resources } from "deepslate";

import * as modRegistry from "../mods/registry";
import type { LoadedModsSnapshot } from "../mods/registry";
import type { LoadedModAssets } from "../mods/types";
import {
  DEFAULT_MAX_TEXTURE_SIZE,
  planAtlas,
  type AtlasPlan,
  type PixelRect,
} from "./atlas-layout";
import {
  assembleResources,
  createVanillaBlockData,
  type VanillaBlockData,
} from "./block-resources";

// Re-export so existing render-path callers keep their import site. The
// canonical home is now `@/lib/invisible-blocks` — modules that DON'T need
// deepslate (editor-state edits, swap mutator, material list) import from
// there directly so the dep doesn't leak into `/`'s initial chunk.
export { isInvisibleBlockId } from "../invisible-blocks";

const ASSETS_BASE = "/minecraft-assets";

// mcmeta `atlas/blocks/data.min.json` shape: `{ "<path>": [x, y, w, h] }` in
// pixel coordinates relative to the atlas. Paths come without a namespace
// (e.g. `block/stone`) — `minecraft:` is prepended at lookup time.
type McmetaAtlasUVs = Record<string, PixelRect>;

interface OpaqueBlocksFile {
  opaque: string[];
}

interface VanillaBundle {
  blocks: VanillaBlockData;
  atlasRects: McmetaAtlasUVs;
  atlasImage: ImageBitmap;
}

// Module-level cache. `cachedResources` flips to non-null once the first
// build resolves and is replaced by each later build. Subscribers (via
// `useSyncExternalStore` in the React component) get notified on every swap.
let vanillaPromise: Promise<VanillaBundle> | null = null;
let started = false;
let cachedResources: Resources | null = null;
let loadError: Error | null = null;
let buildGeneration = 0;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) listener();
}

export function ensureMinecraftResourcesLoading(): void {
  if (started) return;
  started = true;
  void (async () => {
    // Wait for persisted mods so the first build already includes them
    // instead of flashing placeholders. Never rejects.
    await modRegistry.hydrateLoadedMods();
    // The registry keeps a stable snapshot identity until the set of loaded
    // mods changes, so only real changes trigger a rebuild.
    let lastSnapshot = modRegistry.getSnapshot();
    modRegistry.subscribe(() => {
      const snapshot = modRegistry.getSnapshot();
      if (snapshot === lastSnapshot) return;
      lastSnapshot = snapshot;
      void rebuild();
    });
    await rebuild();
  })();
}

async function rebuild(): Promise<void> {
  buildGeneration += 1;
  const generation = buildGeneration;
  const snapshot = modRegistry.getSnapshot();
  try {
    const resources = await buildResources(snapshot);
    if (generation !== buildGeneration) return;
    cachedResources = resources;
    loadError = null;
  } catch (err: unknown) {
    if (generation !== buildGeneration) return;
    console.error("Failed to build Minecraft resources", err);
    // Keep showing the last good resources; only surface a hard error when
    // there's nothing to show.
    if (cachedResources === null) {
      loadError = err instanceof Error ? err : new Error(String(err));
    }
  }
  notifyListeners();
}

export function subscribeMinecraftResources(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getCachedMinecraftResources(): Resources | null {
  return cachedResources;
}

export function getMinecraftResourcesError(): Error | null {
  return loadError;
}

function loadVanilla(): Promise<VanillaBundle> {
  if (vanillaPromise === null) {
    vanillaPromise = (async () => {
      const [blockstates, models, atlasRects, opaqueBlocks, atlasImage] =
        await Promise.all([
          fetchJson<Record<string, unknown>>(`${ASSETS_BASE}/blockstates.json`),
          fetchJson<Record<string, unknown>>(`${ASSETS_BASE}/models.json`),
          fetchJson<McmetaAtlasUVs>(`${ASSETS_BASE}/atlas-uvs.json`),
          fetchJson<OpaqueBlocksFile>(`${ASSETS_BASE}/opaque-blocks.json`),
          fetchBitmap(`${ASSETS_BASE}/atlas.png`),
        ]);
      return {
        blocks: createVanillaBlockData(
          blockstates,
          models,
          opaqueBlocks.opaque,
        ),
        atlasRects,
        atlasImage,
      };
    })();
    // Allow a retry on the next build if the network hiccuped.
    vanillaPromise.catch(() => {
      vanillaPromise = null;
    });
  }
  return vanillaPromise;
}

async function buildResources(
  snapshot: LoadedModsSnapshot,
): Promise<Resources> {
  const [vanilla, modAssets] = await Promise.all([
    loadVanilla(),
    Promise.all(snapshot.map((mod) => modRegistry.getLoadedModAssets(mod.key))),
  ]);
  const mods = modAssets.filter((a): a is LoadedModAssets => a !== null);

  const bitmaps = await decodeModTextures(mods);
  const plan = planAtlas({
    baseWidth: vanilla.atlasImage.width,
    baseHeight: vanilla.atlasImage.height,
    vanillaRects: vanilla.atlasRects,
    modTextures: [...bitmaps].map(([id, bitmap]) => ({
      id,
      width: bitmap.width,
      height: bitmap.height,
    })),
    maxSize: getMaxTextureSize(),
  });
  const atlasImage = drawAtlas(vanilla.atlasImage, plan, bitmaps);
  for (const bitmap of bitmaps.values()) bitmap.close();

  return assembleResources({
    vanilla: vanilla.blocks,
    mods,
    uvMap: plan.uvMap,
    atlasImage,
  }).resources;
}

// Decode every mod texture. Later mods win on id collisions, falling back to
// an earlier mod's copy if theirs won't decode; ids with no decodable copy are
// skipped (blocks using them fall back to the placeholder cube).
export async function decodeModTextures(
  mods: readonly LoadedModAssets[],
): Promise<Map<string, ImageBitmap>> {
  // Candidates per id, highest priority (latest mod) first.
  const entries = new Map<string, Blob[]>();
  for (const mod of mods) {
    for (const [id, blob] of Object.entries(mod.textures)) {
      entries.set(id, [blob, ...(entries.get(id) ?? [])]);
    }
  }
  const bitmaps = new Map<string, ImageBitmap>();
  await Promise.all(
    [...entries].map(async ([id, blobs]) => {
      for (const blob of blobs) {
        try {
          bitmaps.set(id, await createImageBitmap(blob));
          return;
        } catch {
          // Try the next candidate.
        }
      }
      console.warn(`Could not decode mod texture ${id}`);
    }),
  );
  return bitmaps;
}

function drawAtlas(
  vanillaAtlas: ImageBitmap,
  plan: AtlasPlan,
  bitmaps: ReadonlyMap<string, ImageBitmap>,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable for atlas build");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(vanillaAtlas, 0, 0);

  const [mx, my, mw, mh] = plan.missing;
  const halfW = mw / 2;
  const halfH = mh / 2;
  ctx.fillStyle = "black";
  ctx.fillRect(mx, my, mw, mh);
  ctx.fillStyle = "magenta";
  ctx.fillRect(mx, my, halfW, halfH);
  ctx.fillRect(mx + halfW, my + halfH, halfW, halfH);

  for (const { id, source, dest } of plan.placements) {
    const bitmap = bitmaps.get(id);
    if (bitmap === undefined) continue;
    ctx.drawImage(bitmap, ...source, ...dest);
  }
  return ctx.getImageData(0, 0, plan.width, plan.height);
}

let maxTextureSize: number | null = null;
function getMaxTextureSize(): number {
  if (maxTextureSize !== null) return maxTextureSize;
  maxTextureSize = DEFAULT_MAX_TEXTURE_SIZE;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (gl !== null) {
      const value: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (typeof value === "number" && value > 0) maxTextureSize = value;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // Keep the default.
  }
  return maxTextureSize;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  return createImageBitmap(await res.blob());
}
