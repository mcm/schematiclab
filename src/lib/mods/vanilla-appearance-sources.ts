// Vanilla models and texture colours for mod appearances, read from the
// 3D-preview bundle in `public/minecraft-assets/` (`models.json`,
// `atlas-uvs.json`, `atlas.png`; the browser usually has them cached from the
// preview). Mod models almost always inherit a vanilla parent such as
// `minecraft:block/cube_all`, so without these most mod blocks have no shape.
//
// Worker-safe: uses `fetch` and decodes the atlas in JS, only once a mod model
// actually references a vanilla texture. Fetched once per worker; a failed
// fetch resolves to null and is retried on the next call. The mod-jar worker
// starts the fetch at startup so it overlaps the first jar download.

import {
  atlasTextureColors,
  decodePng,
  vanillaModelLookup,
  type AppearanceSources,
  type TextureColor,
} from "../render/block-appearance";

const ASSETS_BASE = "/minecraft-assets";

let loading: Promise<AppearanceSources | null> | null = null;

export function loadVanillaAppearanceSources(
  fetchImpl: typeof fetch = fetch,
): Promise<AppearanceSources | null> {
  if (loading === null) {
    const attempt = fetchSources(fetchImpl).catch((err: unknown) => {
      console.warn("Could not load vanilla models for mod colours.", err);
      if (loading === attempt) loading = null;
      return null;
    });
    loading = attempt;
  }
  return loading;
}

async function fetchSources(
  fetchImpl: typeof fetch,
): Promise<AppearanceSources> {
  const get = async (name: string): Promise<Response> => {
    const res = await fetchImpl(`${ASSETS_BASE}/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res;
  };
  const [models, uvs, atlasBytes] = await Promise.all([
    get("models.json").then(
      (res) => res.json() as Promise<Record<string, unknown>>,
    ),
    get("atlas-uvs.json").then(
      (res) => res.json() as Promise<Record<string, unknown>>,
    ),
    get("atlas.png").then(
      async (res) => new Uint8Array(await res.arrayBuffer()),
    ),
  ]);

  let atlasColors: ((id: string) => TextureColor | null) | null = null;
  return {
    getModel: vanillaModelLookup(models),
    getTextureColor: (id) => {
      if (atlasColors === null) {
        const atlas = decodePng(atlasBytes);
        atlasColors =
          atlas === null ? () => null : atlasTextureColors(atlas, uvs);
      }
      return atlasColors(id);
    },
  };
}

// Test-only: forget the cached sources.
export function __resetVanillaAppearanceSourcesForTests(): void {
  loading = null;
}
