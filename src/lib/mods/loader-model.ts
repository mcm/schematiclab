// Models drawn by a custom model loader (`"loader": "modularbees:connect_model"`,
// Modern Industrialization machines, Cable Tiers' disk interfaces) keep their
// textures in loader-specific keys instead of `textures`, and draw no
// `elements`. We can't run the loader, so the strings such a model names
// that look like texture ids are read as its textures, best effort.
//
// Pure: no DOM, no Node APIs. Imports carry their `.ts` extension so the
// upload CLI can load it with node's strip-types.

import { normalizeResourceId } from "../render/block-appearance.ts";

/** Parent chains longer than this aren't followed. */
const MAX_CHAIN_DEPTH = 16;

/** `ns:path` or `path`; no `#` variables, spaces or upper case. */
const TEXTURE_ID_RE = /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/;

/** Keys whose values name something other than a texture. */
const NON_TEXTURE_KEYS = new Set(["loader", "parent"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `model` itself names a custom model loader. */
export function hasModelLoader(model: unknown): boolean {
  return isRecord(model) && typeof model.loader === "string";
}

/**
 * True when the model `id` or a model in its `parent` chain (as far as
 * `getModel` has them) names a custom model loader.
 */
export function modelChainHasLoader(
  id: string,
  getModel: (id: string) => unknown,
): boolean {
  const seen = new Set<string>();
  let current = id;
  for (let depth = 0; depth <= MAX_CHAIN_DEPTH; depth++) {
    if (seen.has(current)) return false;
    seen.add(current);
    const model = getModel(current);
    if (!isRecord(model)) return false;
    if (hasModelLoader(model)) return true;
    if (typeof model.parent !== "string") return false;
    current = normalizeResourceId(model.parent);
  }
  return false;
}

/** A string a loader model names that may be a texture id. */
export interface LoaderTextureCandidate {
  /** Normalized id (`ns:path`). */
  id: string;
  /** The key naming it, lower case; array items take their array's key. */
  key: string;
  /** True when its key or a key above it contains `overlay`. */
  overlay: boolean;
}

/**
 * Every string in `model` (nested objects and arrays included, in key
 * order) shaped like a texture id, except under `loader` and `parent` keys.
 * Whether it is one is up to the caller (a texture lookup).
 */
export function loaderTextureCandidates(
  model: unknown,
): LoaderTextureCandidate[] {
  const out: LoaderTextureCandidate[] = [];
  const walk = (
    value: unknown,
    key: string,
    overlay: boolean,
    depth: number,
  ): void => {
    if (depth > MAX_CHAIN_DEPTH) return;
    if (typeof value === "string") {
      if (TEXTURE_ID_RE.test(value)) {
        out.push({ id: normalizeResourceId(value), key, overlay });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, overlay, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    // 1.21.4+ `{ "sprite": "ns:path", ... }` texture objects.
    if (typeof value.sprite === "string") {
      walk(value.sprite, key, overlay, depth + 1);
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      if (NON_TEXTURE_KEYS.has(child)) continue;
      const name = child.toLowerCase();
      walk(item, name, overlay || name.includes("overlay"), depth + 1);
    }
  };
  walk(model, "", false, 0);
  return out;
}

/** The ids of `loaderTextureCandidates(model)`, without repeats. */
export function loaderTextureRefs(model: unknown): string[] {
  return [...new Set(loaderTextureCandidates(model).map((c) => c.id))];
}
