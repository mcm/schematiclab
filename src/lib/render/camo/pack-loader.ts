// Lazy loader for the camo shape packs in `public/camo-shapes/`. A pack is
// fetched only once its mod's namespace is loaded, and at most once per
// session. A pack that fails validation (including an unknown
// `formatVersion`) counts as missing, so its blocks fall back to full frame
// cubes.

import { validateShapePack, type ShapePack } from "./shape-pack";

const SHAPE_PACK_BASE = "/camo-shapes";

/** Namespaces with a pack in `public/camo-shapes/<namespace>.json`. */
export const SHAPE_PACK_NAMESPACES: readonly string[] = [
  "framedblocks",
  "copycats",
  "create",
];

const packs = new Map<string, Promise<ShapePack | null>>();

function loadShapePack(
  namespace: string,
  fetchFn: typeof fetch,
): Promise<ShapePack | null> {
  let pending = packs.get(namespace);
  if (pending === undefined) {
    const url = `${SHAPE_PACK_BASE}/${namespace}.json`;
    pending = (async () => {
      const res = await fetchFn(url);
      if (!res.ok) {
        throw new Error(
          `Failed to load ${url}: ${res.status} ${res.statusText}`,
        );
      }
      const json: unknown = await res.json();
      try {
        return validateShapePack(json);
      } catch (err) {
        console.warn("Ignoring camo shape pack %s", url, err);
        return null;
      }
    })().catch((err: unknown) => {
      // Network trouble: retry on the next build.
      packs.delete(namespace);
      console.warn("Could not load camo shape pack %s", url, err);
      return null;
    });
    packs.set(namespace, pending);
  }
  return pending;
}

/** The valid shape packs of every loaded namespace that has one. */
export async function loadShapePacks(
  loadedNamespaces: ReadonlySet<string>,
  fetchFn: typeof fetch = fetch,
): Promise<ShapePack[]> {
  const loaded = await Promise.all(
    SHAPE_PACK_NAMESPACES.filter((ns) => loadedNamespaces.has(ns)).map((ns) =>
      loadShapePack(ns, fetchFn),
    ),
  );
  return loaded.filter((pack): pack is ShapePack => pack !== null);
}

// Test-only: forget cached packs.
export function __resetShapePacksForTests(): void {
  packs.clear();
}
