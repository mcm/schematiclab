// Runtime loader for the 3D preview's deepslate `Resources`: the static
// vanilla asset bundle in `public/minecraft-assets/` plus loaded mods'
// blockstates, models and textures. Exactly one file per mod is used
// (`getPreviewModFiles` for the schematic's version, set through
// `setMinecraftResourcesVersion`), so two versions of a mod never merge. Vanilla block-entity textures (chests,
// heads, ...) are packed into the atlas the same way as mod textures.
//
// The vanilla bundle is produced by `scripts/build-minecraft-assets.mts`. To
// refresh for a newer Minecraft version, run `pnpm gen:mc-assets`.
//
// Vanilla data is fetched and flattened once. Whenever the selected preview
// files change (registry change or a new schematic version), resources are
// rebuilt (new combined atlas, new model set) and subscribers are notified so
// `ThreeDPreview` re-meshes. Generated blocks (Unlimited Chisel Works) of the
// schematic on screen (`setMinecraftResourcesBlocks`) add their synthesized
// blockstates, models and generated textures (`mods/generated/render.ts`,
// which caches the textures), so they rebuild too when that set changes.
// Camo shape packs are fetched only for loaded mod
// namespaces. Builds are serialized; changes during a build coalesce into one
// follow-up. Layout and assembly are
// pure (`atlas-layout.ts`, `block-resources.ts`); only pixel drawing lives here.

import type { Resources } from "deepslate";
import { unzipSync } from "fflate";

import {
  isGeneratedBlockId,
  loadGeneratedBlockRender,
  type GeneratedBlockRender,
} from "../mods/generated/render";
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
import { loadShapePacks } from "./camo/pack-loader";
import {
  applyTemplateOverrides,
  mergeTemplates,
} from "./camo/template-overrides";

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
  /** Block-entity textures keyed `minecraft:entity/...`. */
  entityTextures: Record<string, Blob>;
}

// Module-level cache. `cachedResources` flips to non-null once the first
// build resolves and is replaced by each later build. Subscribers (via
// `useSyncExternalStore` in the React component) get notified on every swap.
let vanillaPromise: Promise<VanillaBundle> | null = null;
let started = false;
let cachedResources: Resources | null = null;
let loadError: Error | null = null;
const listeners = new Set<() => void>();
// The schematic's version (KNOWN_VERSIONS key); picks each mod's file.
let previewVersionId: string | null = null;
// Files of the last build; null until the registry has hydrated.
let builtFiles: LoadedModsSnapshot | null = null;
// Generated-block ids of the schematic on screen, sorted.
let generatedBlockIds: readonly string[] = [];
// True while a rebuild for a file set other than the cached resources' is in
// flight (never during the initial build), so the preview can keep its last
// mesh instead of re-meshing with resources about to be replaced.
let rebuildPending = false;

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
    modRegistry.subscribe(rebuildIfFilesChanged);
    builtFiles = modRegistry.getPreviewModFiles(previewVersionId);
    await rebuild();
  })();
}

/**
 * Set the schematic version whose mod files the preview renders. Rebuilds
 * only if that changes which files are selected, or if the schematic has
 * generated blocks (they are resolved against that version's files).
 */
export function setMinecraftResourcesVersion(versionId: string | null): void {
  if (versionId === previewVersionId) return;
  previewVersionId = versionId;
  if (builtFiles === null) return;
  if (generatedBlockIds.length > 0) {
    builtFiles = modRegistry.getPreviewModFiles(previewVersionId);
    startRebuild();
    return;
  }
  rebuildIfFilesChanged();
}

/**
 * Set the block ids of the schematic on screen. Rebuilds only if that
 * changes which generated blocks (`isGeneratedBlockId`) it has.
 */
export function setMinecraftResourcesBlocks(blockIds: Iterable<string>): void {
  const ids = [...new Set(blockIds)].filter(isGeneratedBlockId).sort();
  if (
    ids.length === generatedBlockIds.length &&
    ids.every((id, i) => id === generatedBlockIds[i])
  ) {
    return;
  }
  generatedBlockIds = ids;
  // Before the first build there is nothing to replace; it reads the ids.
  if (builtFiles === null) return;
  startRebuild();
}

/** Whether two preview file selections differ (by file record identity). */
export function previewFilesChanged(
  previous: LoadedModsSnapshot,
  next: LoadedModsSnapshot,
): boolean {
  return (
    previous.length !== next.length ||
    previous.some((file, i) => file !== next[i])
  );
}

function rebuildIfFilesChanged(): void {
  if (builtFiles === null) return;
  const files = modRegistry.getPreviewModFiles(previewVersionId);
  if (!previewFilesChanged(builtFiles, files)) return;
  builtFiles = files;
  startRebuild();
}

function startRebuild(): void {
  if (!rebuildPending) {
    rebuildPending = true;
    notifyListeners();
  }
  void rebuild();
}

// Builds run one at a time. A change during a build queues one follow-up
// build of the latest file selection, so a burst of changes (a modpack load
// adds hundreds of mods) can't pile up concurrent full atlas builds.
let building: Promise<void> | null = null;
let rebuildQueued = false;

function rebuild(): Promise<void> {
  if (building !== null) {
    rebuildQueued = true;
    return building;
  }
  building = (async () => {
    try {
      do {
        rebuildQueued = false;
        await buildOnce();
      } while (rebuildQueued);
    } finally {
      building = null;
    }
  })();
  return building;
}

async function buildOnce(): Promise<void> {
  const files = builtFiles ?? [];
  try {
    const resources = await buildResources(files);
    // Superseded while building: keep what's shown until the queued build
    // finishes, unless there's nothing to show yet.
    if (rebuildQueued && cachedResources !== null) return;
    rebuildPending = false;
    cachedResources = resources;
    loadError = null;
  } catch (err: unknown) {
    if (rebuildQueued) return;
    rebuildPending = false;
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

/**
 * True while resources are being rebuilt for a new set of preview files;
 * `getCachedMinecraftResources` then still returns the previous bundle.
 */
export function isMinecraftResourcesRebuildPending(): boolean {
  return rebuildPending;
}

/**
 * Whether the cached resources are being, or are about to be, replaced for
 * `versionId`: a rebuild is in flight, or that version selects other preview
 * files than the last build or the generated blocks were built for another
 * version (before `setMinecraftResourcesVersion` runs).
 * Reads only; safe to call during render.
 */
export function minecraftResourcesStaleFor(versionId: string | null): boolean {
  if (rebuildPending) return true;
  if (builtFiles === null) return false;
  if (generatedBlockIds.length > 0 && versionId !== previewVersionId) {
    return true;
  }
  return previewFilesChanged(
    builtFiles,
    modRegistry.getPreviewModFiles(versionId),
  );
}

export function getMinecraftResourcesError(): Error | null {
  return loadError;
}

function loadVanilla(): Promise<VanillaBundle> {
  if (vanillaPromise === null) {
    vanillaPromise = (async () => {
      const [
        blockstates,
        models,
        atlasRects,
        opaqueBlocks,
        atlasImage,
        entityZip,
      ] = await Promise.all([
        fetchJson<Record<string, unknown>>(`${ASSETS_BASE}/blockstates.json`),
        fetchJson<Record<string, unknown>>(`${ASSETS_BASE}/models.json`),
        fetchJson<McmetaAtlasUVs>(`${ASSETS_BASE}/atlas-uvs.json`),
        fetchJson<OpaqueBlocksFile>(`${ASSETS_BASE}/opaque-blocks.json`),
        fetchBitmap(`${ASSETS_BASE}/atlas.png`),
        fetchBytes(`${ASSETS_BASE}/entity-textures.zip`),
      ]);
      return {
        blocks: createVanillaBlockData(
          blockstates,
          models,
          opaqueBlocks.opaque,
        ),
        atlasRects,
        atlasImage,
        entityTextures: entityTexturesFromZip(entityZip),
      };
    })();
    // Allow a retry on the next build if the network hiccuped.
    vanillaPromise.catch(() => {
      vanillaPromise = null;
    });
  }
  return vanillaPromise;
}

async function buildResources(files: LoadedModsSnapshot): Promise<Resources> {
  const loadedNamespaces = modRegistry.getLoadedNamespaces();
  const versionId = previewVersionId;
  const [vanilla, modAssets, shapePacks, generated] = await Promise.all([
    loadVanilla(),
    Promise.all(files.map((mod) => modRegistry.getLoadedModAssets(mod.key))),
    loadShapePacks(loadedNamespaces),
    versionId === null || generatedBlockIds.length === 0
      ? null
      : loadGeneratedBlockRender(generatedBlockIds, versionId),
  ]);
  const mods = modAssets.filter((a): a is LoadedModAssets => a !== null);
  // A loaded FramedBlocks jar's own templates win over the pack's.
  const templates = mergeTemplates(mods);

  // Entity textures go first so a mod shipping the same id overrides them,
  // as mod textures already do for vanilla block textures.
  const bitmaps = await decodeModTextures([
    { textures: vanilla.entityTextures },
    ...mods,
  ]);
  if (generated !== null) {
    for (const [id, bitmap] of await generatedTextureBitmaps(generated)) {
      bitmaps.set(id, bitmap);
    }
  }
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
    generated:
      generated === null
        ? []
        : [{ blockstates: generated.blockstates, models: generated.models }],
    uvMap: plan.uvMap,
    atlasImage,
    camo: {
      loadedNamespaces,
      packs: shapePacks.map((pack) => applyTemplateOverrides(pack, templates)),
    },
  }).resources;
}

/**
 * Unpack `entity-textures.zip` (PNGs under `entity/`, built by
 * `scripts/build-minecraft-assets.mts`) into blobs keyed by texture id.
 */
export function entityTexturesFromZip(zip: Uint8Array): Record<string, Blob> {
  const textures: Record<string, Blob> = {};
  for (const [name, bytes] of Object.entries(unzipSync(zip))) {
    if (!name.endsWith(".png")) continue;
    textures[`minecraft:${name.slice(0, -".png".length)}`] = new Blob(
      [bytes as Uint8Array<ArrayBuffer>],
      { type: "image/png" },
    );
  }
  return textures;
}

// Decode every mod texture. Later mods win on id collisions, falling back to
// an earlier mod's copy if theirs won't decode; ids with no decodable copy are
// skipped (blocks using them fall back to the placeholder cube).
export async function decodeModTextures(
  mods: readonly Pick<LoadedModAssets, "textures">[],
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

async function generatedTextureBitmaps(
  generated: GeneratedBlockRender,
): Promise<Map<string, ImageBitmap>> {
  const bitmaps = new Map<string, ImageBitmap>();
  await Promise.all(
    [...generated.textures].map(async ([id, { image }]) => {
      try {
        const pixels = new ImageData(
          new Uint8ClampedArray(image.data),
          image.width,
          image.height,
        );
        bitmaps.set(id, await createImageBitmap(pixels));
      } catch {
        console.warn(`Could not draw generated texture ${id}`);
      }
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

  // Clear the transparent cell before drawing the missing one: when the atlas
  // is full they share a cell, and the missing texture should win.
  ctx.clearRect(...plan.transparent);

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

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  return createImageBitmap(await res.blob());
}
