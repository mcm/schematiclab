// Runtime loader for the static vanilla Minecraft asset bundle that lives in
// `public/minecraft-assets/`. Constructs a deepslate `Resources` provider
// backed by real vanilla blockstates / block models / textures so that slabs,
// stairs, fences, etc. render with their actual geometry instead of the
// US-005 smoke cube.
//
// The bundle is produced by `scripts/build-minecraft-assets.mts`. To refresh
// for a newer Minecraft version, run `pnpm gen:mc-assets`.

import {
  BlockDefinition,
  BlockModel,
  Identifier,
  TextureAtlas,
  type BlockFlags,
  type Resources,
  type UV,
} from "deepslate";

// Re-export so existing render-path callers keep their import site. The
// canonical home is now `@/lib/invisible-blocks` — modules that DON'T need
// deepslate (editor-state edits, swap mutator, material list) import from
// there directly so the dep doesn't leak into `/`'s initial chunk.
export { isInvisibleBlockId } from "../invisible-blocks";

const ASSETS_BASE = "/minecraft-assets";

// mcmeta `atlas/blocks/data.min.json` shape: `{ "<path>": [x, y, w, h] }` in
// pixel coordinates relative to the atlas. Paths come without a namespace
// (e.g. `block/stone`) — we prepend `minecraft:` at lookup time.
type McmetaAtlasUVs = Record<string, [number, number, number, number]>;

interface OpaqueBlocksFile {
  opaque: string[];
}

// Module-level cache. `cachedResources` flips to non-null once the singleton
// promise resolves. Subscribers (via `useSyncExternalStore` in the React
// component) get notified on completion so they re-render with the loaded
// resources without anyone having to call setState from inside an effect.
let resourcesPromise: Promise<Resources> | null = null;
let cachedResources: Resources | null = null;
let loadError: Error | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) listener();
}

export function ensureMinecraftResourcesLoading(): void {
  if (resourcesPromise !== null) return;
  resourcesPromise = buildResources().then(
    (r) => {
      cachedResources = r;
      notifyListeners();
      return r;
    },
    (err: unknown) => {
      loadError = err instanceof Error ? err : new Error(String(err));
      notifyListeners();
      throw err;
    },
  );
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

async function buildResources(): Promise<Resources> {
  const [
    blockstatesJson,
    modelsJson,
    atlasUvsJson,
    opaqueBlocksJson,
    atlasImageData,
  ] = await Promise.all([
    fetchJson<Record<string, unknown>>(`${ASSETS_BASE}/blockstates.json`),
    fetchJson<Record<string, unknown>>(`${ASSETS_BASE}/models.json`),
    fetchJson<McmetaAtlasUVs>(`${ASSETS_BASE}/atlas-uvs.json`),
    fetchJson<OpaqueBlocksFile>(`${ASSETS_BASE}/opaque-blocks.json`),
    loadAtlasImageData(`${ASSETS_BASE}/atlas.png`),
  ]);

  // Block-state map keyed by full id (e.g. "minecraft:acacia_stairs").
  const blockDefinitions: Record<string, BlockDefinition> = {};
  for (const [path, data] of Object.entries(blockstatesJson)) {
    blockDefinitions[`minecraft:${path}`] = BlockDefinition.fromJson(data);
  }

  // Block-model map keyed by full id (e.g. "minecraft:block/cube_all").
  // Vanilla model parents reference IDs like "minecraft:block/cube_all", so
  // the keys here must include the "block/" prefix.
  const blockModels: Record<string, BlockModel> = {};
  for (const [path, data] of Object.entries(modelsJson)) {
    blockModels[`minecraft:block/${path}`] = BlockModel.fromJson(data);
  }

  const modelProvider = {
    getBlockModel(id: Identifier) {
      return blockModels[id.toString()] ?? null;
    },
  };
  for (const model of Object.values(blockModels)) {
    model.flatten(modelProvider);
  }

  // Convert mcmeta's pixel-space `[x, y, w, h]` UVs to deepslate's normalized
  // `[u1, v1, u2, v2]`. For animated textures (frames stacked vertically,
  // h > w) we take only the first frame — animation isn't part of US-006.
  const atlasW = atlasImageData.width;
  const atlasH = atlasImageData.height;
  const uvMap: Record<string, UV> = {};
  for (const [path, rect] of Object.entries(atlasUvsJson)) {
    const [x, y, w, h] = rect;
    const frame = Math.min(w, h);
    uvMap[`minecraft:${path}`] = [
      x / atlasW,
      y / atlasH,
      (x + frame) / atlasW,
      (y + frame) / atlasH,
    ];
  }
  const textureAtlas = new TextureAtlas(atlasImageData, uvMap);

  const opaque = new Set(opaqueBlocksJson.opaque);

  return {
    getBlockDefinition(id: Identifier) {
      return blockDefinitions[id.toString()] ?? null;
    },
    getBlockModel(id: Identifier) {
      return blockModels[id.toString()] ?? null;
    },
    getTextureAtlas() {
      return textureAtlas.getTextureAtlas();
    },
    getTextureUV(id: Identifier) {
      return textureAtlas.getTextureUV(id);
    },
    getBlockFlags(id: Identifier): BlockFlags | null {
      return { opaque: opaque.has(id.toString()) };
    },
    getBlockProperties() {
      return null;
    },
    getDefaultBlockProperties() {
      return null;
    },
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function loadAtlasImageData(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable for atlas decode");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}
