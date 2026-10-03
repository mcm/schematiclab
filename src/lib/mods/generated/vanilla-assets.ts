// Vanilla blockstates, models and texture pixels for generated-block
// providers, read from the 3D-preview bundle in `public/minecraft-assets/`
// (`blockstates.json`, `models.json`, `atlas-uvs.json`, `atlas.png`; the
// browser usually has them cached from the preview). Fetched once; a failed
// fetch resolves to null and is retried on the next call. The atlas is only
// decoded once a texture is asked for.
//
// Worker-safe: uses `fetch` and decodes the atlas in JS.

import { decodePng, type RgbaImage } from "../../render/block-appearance";
import type { GeneratedVanillaAssets } from "./types";

const ASSETS_BASE = "/minecraft-assets";

export interface VanillaBundleData {
  /** Keyed by block path (`stone`). */
  blockstates: Record<string, unknown>;
  /** Keyed by path under `models/block/` (`cube_all`). */
  models: Record<string, unknown>;
  /** Texture path (`block/stone`) → pixel `[x, y, w, h]` in the atlas. */
  uvs: Record<string, unknown>;
  /** Decodes the atlas (called once, on first use); null when it can't. */
  atlas: () => RgbaImage | null;
}

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function crop(
  image: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(start, start + w * 4), row * w * 4);
  }
  return { width: w, height: h, data };
}

/** `GeneratedVanillaAssets` over the bundle's files. */
export function vanillaAssetsFromBundle(
  bundle: VanillaBundleData,
): GeneratedVanillaAssets {
  const textures = new Map<string, RgbaImage | null>();
  let decoded: RgbaImage | null | undefined;
  return {
    blockstate: (blockId) =>
      blockId.startsWith("minecraft:")
        ? own(bundle.blockstates, blockId.slice("minecraft:".length))
        : undefined,
    model: (modelId) =>
      modelId.startsWith("minecraft:block/")
        ? own(bundle.models, modelId.slice("minecraft:block/".length))
        : undefined,
    texture(textureId) {
      if (!textureId.startsWith("minecraft:")) return null;
      const cached = textures.get(textureId);
      if (cached !== undefined) return cached;
      let image: RgbaImage | null = null;
      const uv = own(bundle.uvs, textureId.slice("minecraft:".length));
      if (decoded === undefined) decoded = bundle.atlas();
      const atlas = decoded;
      if (
        atlas !== null &&
        Array.isArray(uv) &&
        uv.length === 4 &&
        uv.every((n) => Number.isInteger(n) && n >= 0)
      ) {
        const [x, y, w, h] = uv as number[];
        // Animated textures occupy their whole strip; keep the first frame.
        const frame = Math.min(w, h);
        if (w > 0 && x + w <= atlas.width && y + frame <= atlas.height) {
          image = crop(atlas, x, y, w, frame);
        }
      }
      textures.set(textureId, image);
      return image;
    },
  };
}

let loading: Promise<GeneratedVanillaAssets | null> | null = null;

/** The vanilla bundle's assets, fetched once; null when they can't be read. */
export function loadGeneratedVanillaAssets(
  fetchImpl: typeof fetch = fetch,
): Promise<GeneratedVanillaAssets | null> {
  if (loading === null) {
    const attempt = fetchBundle(fetchImpl).catch((err: unknown) => {
      console.warn("Could not load vanilla assets for generated blocks.", err);
      if (loading === attempt) loading = null;
      return null;
    });
    loading = attempt;
  }
  return loading;
}

async function fetchBundle(
  fetchImpl: typeof fetch,
): Promise<GeneratedVanillaAssets> {
  const get = async (name: string): Promise<Response> => {
    const res = await fetchImpl(`${ASSETS_BASE}/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res;
  };
  const json = async (name: string) =>
    (await (await get(name)).json()) as Record<string, unknown>;
  const [blockstates, models, uvs, atlasBytes] = await Promise.all([
    json("blockstates.json"),
    json("models.json"),
    json("atlas-uvs.json"),
    get("atlas.png").then(
      async (res) => new Uint8Array(await res.arrayBuffer()),
    ),
  ]);
  return vanillaAssetsFromBundle({
    blockstates,
    models,
    uvs,
    atlas: () => decodePng(atlasBytes),
  });
}

// Test-only: forget the cached bundle.
export function __resetGeneratedVanillaAssetsForTests(): void {
  loading = null;
}
