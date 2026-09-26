// Pure, worker-safe mod jar parser.
//
// Inflates only the client assets needed to catalog and render a mod's blocks
// (blockstates, block models, textures, English lang file) and turns them into
// plain data. Never touches class files — no mod code is ever loaded.

import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

import type { ModBlock, ParsedModAssets } from "./types";

const ASSET_PATH_RE =
  /^assets\/([^/]+)\/(blockstates\/.+\.json|models\/.+\.json|textures\/.+\.png(?:\.mcmeta)?|lang\/en_us\.json)$/;

/** Max `parent` hops followed per model (guards against cycles). */
const MAX_PARENT_DEPTH = 32;

/**
 * Zip-bomb guards, checked against each entry's declared size before it is
 * inflated. fflate allocates exactly the declared size and never grows past
 * it, so declared sizes bound memory even when they lie. Large mods (e.g.
 * Create) carry ~15–30 MB of client assets.
 */
export const MAX_ASSET_ENTRIES = 100_000;
export const MAX_ASSET_BYTES = 512 * 1024 * 1024;

export const NO_BLOCKS_WARNING = "No blocks found in this mod";

/** True if a zip entry should be inflated by `parseModJar`. */
export function isModAssetEntry(name: string): boolean {
  const match = ASSET_PATH_RE.exec(name);
  return match !== null && match[1] !== "minecraft";
}

/**
 * Parse a mod jar's bytes into block definitions and render assets.
 *
 * Malformed JSON entries are skipped with a warning. Throws if the bytes are
 * not a readable zip archive or its assets exceed the size/entry budget.
 */
export function parseModJar(bytes: Uint8Array): ParsedModAssets {
  let entryCount = 0;
  let totalBytes = 0;
  const entries = unzipSync(bytes, {
    filter: (file: UnzipFileInfo) => {
      if (!isModAssetEntry(file.name)) return false;
      entryCount += 1;
      // Stored entries are copied at their compressed size.
      totalBytes += Math.max(file.originalSize, file.size);
      if (entryCount > MAX_ASSET_ENTRIES || totalBytes > MAX_ASSET_BYTES) {
        throw new Error(
          `Mod jar is too large to read: its assets exceed ${MAX_ASSET_ENTRIES} files or ${MAX_ASSET_BYTES / (1024 * 1024)} MB uncompressed`,
        );
      }
      return true;
    },
  });

  const warnings: string[] = [];
  const namespaces = new Set<string>();
  const blockstates: Record<string, unknown> = {};
  const allModels: Record<string, unknown> = {};
  const allTextures: Record<string, Uint8Array> = {};
  const allTextureMeta: Record<string, unknown> = {};
  const lang: Record<string, string> = {};

  const names = Object.keys(entries).sort();
  for (const name of names) {
    const match = ASSET_PATH_RE.exec(name);
    if (match === null) continue;
    const ns = match[1];
    const rest = match[2];
    const data = entries[name];
    namespaces.add(ns);

    if (rest.startsWith("textures/")) {
      if (rest.endsWith(".png")) {
        allTextures[`${ns}:${rest.slice("textures/".length, -".png".length)}`] =
          data;
      } else {
        const meta = parseJson(name, data, warnings);
        if (meta !== undefined) {
          const key = `${ns}:${rest.slice("textures/".length, -".png.mcmeta".length)}`;
          allTextureMeta[key] = meta;
        }
      }
      continue;
    }

    const json = parseJson(name, data, warnings);
    if (json === undefined) continue;

    if (rest.startsWith("blockstates/")) {
      const path = rest.slice("blockstates/".length, -".json".length);
      blockstates[`${ns}:${path}`] = json;
    } else if (rest.startsWith("models/")) {
      const path = rest.slice("models/".length, -".json".length);
      allModels[`${ns}:${path}`] = json;
    } else if (isRecord(json)) {
      // lang/en_us.json
      for (const [key, value] of Object.entries(json)) {
        if (typeof value === "string") lang[key] = value;
      }
    } else {
      warnings.push(`Skipped ${name}: expected a JSON object`);
    }
  }

  const blocks: ModBlock[] = Object.keys(blockstates)
    .sort()
    .map((id) => ({
      id,
      displayName: displayNameFor(id, lang),
      properties: extractProperties(blockstates[id]),
    }));

  if (blocks.length === 0) warnings.push(NO_BLOCKS_WARNING);

  // Keep only models reachable from a blockstate, and only textures those
  // models (or their in-mod parents) reference.
  const models: Record<string, unknown> = {};
  const textureRefs = new Set<string>();
  const visit = (modelId: string, depth: number): void => {
    if (depth > MAX_PARENT_DEPTH || modelId in models) return;
    const model = allModels[modelId];
    if (!isRecord(model)) return;
    models[modelId] = model;
    if (isRecord(model.textures)) {
      for (const value of Object.values(model.textures)) {
        const ref = textureRefOf(value);
        if (ref !== null) textureRefs.add(ref);
      }
    }
    if (typeof model.parent === "string") {
      visit(normalizeResourceId(model.parent), depth + 1);
    }
  };
  for (const id of Object.keys(blockstates)) {
    for (const modelId of blockstateModelRefs(blockstates[id])) {
      visit(modelId, 0);
    }
  }

  const textures: Record<string, Uint8Array> = {};
  const textureMeta: Record<string, unknown> = {};
  for (const ref of textureRefs) {
    const png = allTextures[ref];
    if (png === undefined) continue;
    textures[ref] = png;
    if (ref in allTextureMeta) textureMeta[ref] = allTextureMeta[ref];
  }

  return {
    namespaces: [...namespaces].sort(),
    blocks,
    blockstates,
    models,
    textures,
    textureMeta,
    warnings,
  };
}

/**
 * Give every texture its own exactly-sized `ArrayBuffer` and return the
 * (deduplicated) list of buffers to transfer.
 */
export function textureTransferables(result: ParsedModAssets): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  for (const [key, bytes] of Object.entries(result.textures)) {
    let view = bytes;
    if (
      !(view.buffer instanceof ArrayBuffer) ||
      view.byteOffset !== 0 ||
      view.byteLength !== view.buffer.byteLength ||
      seen.has(view.buffer)
    ) {
      view = view.slice();
      result.textures[key] = view;
    }
    seen.add(view.buffer as ArrayBuffer);
  }
  return [...seen];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(
  name: string,
  data: Uint8Array,
  warnings: string[],
): unknown {
  try {
    // Strip a UTF-8 BOM, which some mod tooling emits.
    return JSON.parse(strFromU8(data).replace(/^﻿/, "")) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push(`Skipped malformed JSON ${name}: ${reason}`);
    return undefined;
  }
}

/** Unprefixed resource ids default to the `minecraft` namespace. */
function normalizeResourceId(ref: string): string {
  return ref.includes(":") ? ref : `minecraft:${ref}`;
}

/** Literal texture id from a model `textures` value; null for `#var` refs. */
function textureRefOf(value: unknown): string | null {
  // 1.21.4+ also allows `{ "sprite": "ns:path", ... }` objects.
  const raw = isRecord(value) ? value.sprite : value;
  if (typeof raw !== "string" || raw.length === 0 || raw.startsWith("#")) {
    return null;
  }
  return normalizeResourceId(raw);
}

function titleCase(path: string): string {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  return leaf
    .split(/[_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function displayNameFor(id: string, lang: Record<string, string>): string {
  const colon = id.indexOf(":");
  const ns = id.slice(0, colon);
  const path = id.slice(colon + 1);
  const name = lang[`block.${ns}.${path.replace(/\//g, ".")}`];
  return name !== undefined && name.length > 0 ? name : titleCase(path);
}

/** Collect property → values from `variants` keys and `multipart` conditions. */
export function extractProperties(
  blockstate: unknown,
): Record<string, string[]> {
  const props = new Map<string, Set<string>>();
  const add = (key: string, value: string): void => {
    if (key.length === 0 || value.length === 0) return;
    let values = props.get(key);
    if (values === undefined) {
      values = new Set();
      props.set(key, values);
    }
    values.add(value);
  };

  if (isRecord(blockstate)) {
    if (isRecord(blockstate.variants)) {
      for (const variantKey of Object.keys(blockstate.variants)) {
        for (const pair of variantKey.split(",")) {
          const eq = pair.indexOf("=");
          if (eq < 0) continue; // "" or legacy "normal"
          add(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
      }
    }
    if (Array.isArray(blockstate.multipart)) {
      const visitWhen = (when: unknown): void => {
        if (!isRecord(when)) return;
        for (const [key, value] of Object.entries(when)) {
          if (key === "OR" || key === "AND") {
            if (Array.isArray(value)) value.forEach(visitWhen);
            continue;
          }
          if (
            typeof value !== "string" &&
            typeof value !== "number" &&
            typeof value !== "boolean"
          ) {
            continue;
          }
          for (const v of String(value).split("|")) {
            // A leading "!" negates the value (1.21+); the value itself exists.
            add(key, v.trim().replace(/^!/, ""));
          }
        }
      };
      for (const part of blockstate.multipart) {
        if (isRecord(part)) visitWhen(part.when);
      }
    }
  }

  // fromEntries defines own properties, so a `__proto__` key isn't swallowed by
  // the inherited setter.
  return Object.fromEntries(
    [...props.keys()].sort().map((key) => [key, [...props.get(key)!].sort()]),
  );
}

/** Normalized model ids referenced by a blockstate's variants / multipart. */
function blockstateModelRefs(blockstate: unknown): string[] {
  const refs = new Set<string>();
  const addModels = (value: unknown): void => {
    const list = Array.isArray(value) ? value : [value];
    for (const entry of list) {
      if (isRecord(entry) && typeof entry.model === "string") {
        refs.add(normalizeResourceId(entry.model));
      }
    }
  };
  if (isRecord(blockstate)) {
    if (isRecord(blockstate.variants)) {
      Object.values(blockstate.variants).forEach(addModels);
    }
    if (Array.isArray(blockstate.multipart)) {
      for (const part of blockstate.multipart) {
        if (isRecord(part)) addModels(part.apply);
      }
    }
  }
  return [...refs];
}
