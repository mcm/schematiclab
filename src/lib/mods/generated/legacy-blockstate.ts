// Minecraft 1.12 blockstate files, vanilla and Forge (`forge_marker: 1`),
// read the way 1.12 picks a variant's model: a variant string (`a=1,b=2`,
// `normal`, or a mod's own name such as Chisel's `cracked`) selects the
// `defaults`, then the exact `variants` entry (first of a list), or each
// property's entry of a Forge property object. Model names gain the `block/`
// prefix 1.12 adds (`cube_all` → `minecraft:block/cube_all`).
//
// Generated-block providers read them to find a source block's model and
// textures. `modernizeLegacyBlockstate` rewrites one as a blockstate deepslate
// renders (one synthesized model per variant), for the 3D preview and for
// block appearances; `legacyBlockstateRefs` lists what a jar must keep.
//
// Worker-safe: no DOM access.

import { normalizeResourceId } from "../../render/block-appearance";

/** One resolved 1.12 blockstate variant. */
export interface LegacyBlockstateVariant {
  /** Normalized model id, e.g. `minecraft:block/cube_all`. */
  model: string;
  /** Forge variant `textures` (variable → texture as written), merged. */
  textures: Record<string, string>;
  x?: number;
  y?: number;
  uvlock?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The 1.12 variant string of `properties`: sorted `a=1,b=2`, else `normal`. */
export function legacyVariantString(
  properties: Readonly<Record<string, string>>,
): string {
  const names = Object.keys(properties).sort();
  return names.length === 0
    ? "normal"
    : names.map((name) => `${name}=${properties[name]}`).join(",");
}

/** A blockstate `model` value as a model id (1.12 adds `block/`). */
export function legacyModelId(model: string): string {
  const id = normalizeResourceId(model);
  const colon = id.indexOf(":");
  return `${id.slice(0, colon)}:block/${id.slice(colon + 1)}`;
}

interface PartialVariant {
  model?: string;
  textures: Record<string, string>;
  x?: number;
  y?: number;
  uvlock?: boolean;
}

function mergeVariant(into: PartialVariant, value: unknown): void {
  const entry = Array.isArray(value) ? (value[0] as unknown) : value;
  if (!isRecord(entry)) return;
  if (typeof entry.model === "string") into.model = entry.model;
  if (isRecord(entry.textures)) {
    for (const [name, texture] of Object.entries(entry.textures)) {
      if (typeof texture === "string") into.textures[name] = texture;
    }
  }
  if (typeof entry.x === "number") into.x = entry.x;
  if (typeof entry.y === "number") into.y = entry.y;
  if (typeof entry.uvlock === "boolean") into.uvlock = entry.uvlock;
}

function parsePairs(variant: string): [string, string][] {
  return variant.split(",").flatMap((pair): [string, string][] => {
    const eq = pair.indexOf("=");
    return eq < 0
      ? []
      : [[pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()]];
  });
}

/**
 * The `variants` key for `variant`: itself, its lower-cased form
 * (`ModelResourceLocation` lower-cases variants), or, for a partial
 * `a=1` string, the first key that agrees with every pair it names.
 */
function variantKey(
  variants: Record<string, unknown>,
  variant: string,
): string | null {
  if (Object.hasOwn(variants, variant)) return variant;
  const lower = variant.toLowerCase();
  if (Object.hasOwn(variants, lower)) return lower;
  const wanted = parsePairs(lower);
  if (wanted.length === 0) return null;
  for (const key of Object.keys(variants)) {
    if (!key.includes("=")) continue;
    const pairs = new Map(parsePairs(key));
    if (wanted.every(([name, value]) => pairs.get(name) === value)) return key;
  }
  return null;
}

/**
 * The model and Forge textures 1.12 uses for `variant` of `blockstate`
 * (vanilla or `forge_marker` format), or null when none applies or it has
 * no model.
 */
export function legacyBlockstateVariant(
  blockstate: unknown,
  variant: string,
): LegacyBlockstateVariant | null {
  if (!isRecord(blockstate) || !isRecord(blockstate.variants)) return null;
  const { variants } = blockstate;
  const forge = blockstate.forge_marker !== undefined;
  const merged: PartialVariant = { textures: {} };
  if (forge) mergeVariant(merged, blockstate.defaults);

  const key = variantKey(variants, variant);
  let matched = false;
  if (key !== null && (!forge || !isPropertyObject(variants[key]))) {
    mergeVariant(merged, variants[key]);
    matched = true;
  } else if (forge) {
    for (const [name, value] of parsePairs(variant.toLowerCase())) {
      const property = variants[name];
      if (!isPropertyObject(property)) continue;
      const entry = (property as Record<string, unknown>)[value];
      if (entry === undefined) continue;
      mergeVariant(merged, entry);
      matched = true;
    }
  }
  if (!matched || merged.model === undefined) return null;
  return {
    model: legacyModelId(merged.model),
    textures: merged.textures,
    ...(merged.x !== undefined ? { x: merged.x } : {}),
    ...(merged.y !== undefined ? { y: merged.y } : {}),
    ...(merged.uvlock !== undefined ? { uvlock: merged.uvlock } : {}),
  };
}

// Keys of a variant object, which a Forge property object never has.
const VARIANT_KEYS = new Set([
  "model",
  "textures",
  "x",
  "y",
  "uvlock",
  "weight",
  "submodel",
  "transform",
  "custom",
]);

/** A Forge `"prop": { "value": {…}, … }` entry (values are variants). */
export function isPropertyObject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([name, entry]) => !VARIANT_KEYS.has(name) && isRecord(entry))
  );
}

/** A vanilla-format blockstate's `model` value as 1.12 or 1.13+ reads it. */
function legacyOrModernModelId(
  model: string,
  hasModel: (id: string) => boolean,
): string {
  const id = normalizeResourceId(model);
  if (hasModel(id) || id.slice(id.indexOf(":") + 1).startsWith("block/")) {
    return id;
  }
  return legacyModelId(model);
}

/**
 * True for a 1.12 blockstate: Forge `forge_marker` files, and vanilla-format
 * files naming a model without the `block/` prefix that only exists with it.
 */
export function isLegacyBlockstate(
  blockstate: unknown,
  hasModel: (id: string) => boolean,
): boolean {
  if (!isRecord(blockstate)) return false;
  if (blockstate.forge_marker !== undefined) return true;
  let legacy = false;
  forEachVariantEntry(blockstate, (entry) => {
    if (typeof entry.model !== "string") return;
    const id = normalizeResourceId(entry.model);
    if (legacyOrModernModelId(entry.model, hasModel) !== id) legacy = true;
  });
  return legacy;
}

// Every variant object of a vanilla-format blockstate (`variants` entries and
// lists, `multipart` `apply`), or of a Forge one (`defaults`, entries, and
// each property object's values).
function forEachVariantEntry(
  blockstate: Record<string, unknown>,
  visit: (entry: Record<string, unknown>) => void,
): void {
  const visitValue = (value: unknown): void => {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (isRecord(entry)) visit(entry);
    }
  };
  if (isRecord(blockstate.defaults)) visit(blockstate.defaults);
  if (isRecord(blockstate.variants)) {
    for (const value of Object.values(blockstate.variants)) {
      if (blockstate.forge_marker !== undefined && isPropertyObject(value)) {
        Object.values(value as Record<string, unknown>).forEach(visitValue);
      } else {
        visitValue(value);
      }
    }
  }
  if (Array.isArray(blockstate.multipart)) {
    for (const part of blockstate.multipart as unknown[]) {
      if (isRecord(part)) visitValue(part.apply);
    }
  }
}

/**
 * Model ids and texture ids (as written, normalized) a blockstate may use,
 * read both the 1.12 way (`block/` added, Forge `textures`) and the 1.13+
 * way. Callers keep the ones that exist.
 */
export function legacyBlockstateRefs(blockstate: unknown): {
  models: string[];
  textures: string[];
} {
  const models = new Set<string>();
  const textures = new Set<string>();
  if (isRecord(blockstate)) {
    forEachVariantEntry(blockstate, (entry) => {
      if (typeof entry.model === "string") {
        models.add(normalizeResourceId(entry.model));
        models.add(legacyModelId(entry.model));
      }
      if (isRecord(entry.textures)) {
        for (const texture of Object.values(entry.textures)) {
          if (typeof texture === "string" && !texture.startsWith("#")) {
            textures.add(normalizeResourceId(texture));
          }
        }
      }
    });
  }
  return { models: [...models], textures: [...textures] };
}

/** Max variants a Forge file's property objects expand to. */
const MAX_FORGE_VARIANTS = 4096;

/**
 * The variant strings of a Forge blockstate: its explicit keys (but
 * `inventory`), then every combination of its property objects' values.
 */
function forgeVariantStrings(variants: Record<string, unknown>): string[] {
  const explicit: string[] = [];
  const properties: [string, string[]][] = [];
  for (const [key, value] of Object.entries(variants)) {
    if (isPropertyObject(value)) {
      properties.push([key, Object.keys(value as Record<string, unknown>)]);
    } else if (key !== "inventory") {
      explicit.push(key);
    }
  }
  properties.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let combinations: string[][] = properties.length === 0 ? [] : [[]];
  for (const [name, values] of properties) {
    if (combinations.length * values.length > MAX_FORGE_VARIANTS) {
      combinations = [];
      break;
    }
    combinations = combinations.flatMap((pairs) =>
      values.map((value) => [...pairs, `${name}=${value}`]),
    );
  }
  return [...new Set([...explicit, ...combinations.map((p) => p.join(","))])];
}

/** A 1.12 blockstate rewritten for deepslate, with the models it adds. */
export interface ModernizedBlockstate {
  blockstate: Record<string, unknown>;
  models: Record<string, unknown>;
}

/**
 * `blockstate` of block `blockId` as a blockstate deepslate renders:
 * 1.12 model names gain `block/`, `normal` becomes `""`, and each Forge
 * variant becomes a model parenting its merged model with its merged
 * `textures` (`<ns>:block/legacy_variant/<path>/<n>`). Null when it isn't
 * a 1.12 blockstate (`isLegacyBlockstate`) or no variant has a model.
 */
export function modernizeLegacyBlockstate(
  blockId: string,
  blockstate: unknown,
  hasModel: (id: string) => boolean,
): ModernizedBlockstate | null {
  if (!isRecord(blockstate) || !isLegacyBlockstate(blockstate, hasModel)) {
    return null;
  }
  const deepslateKey = (key: string) => (key === "normal" ? "" : key);
  if (blockstate.forge_marker === undefined) {
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!isRecord(value) || typeof value.model !== "string") return value;
      return { ...value, model: legacyOrModernModelId(value.model, hasModel) };
    };
    const out: Record<string, unknown> = {};
    if (isRecord(blockstate.variants)) {
      out.variants = Object.fromEntries(
        Object.entries(blockstate.variants).map(([key, value]) => [
          deepslateKey(key),
          rewrite(value),
        ]),
      );
    }
    if (Array.isArray(blockstate.multipart)) {
      out.multipart = (blockstate.multipart as unknown[]).map((part) =>
        isRecord(part) ? { ...part, apply: rewrite(part.apply) } : part,
      );
    }
    return { blockstate: out, models: {} };
  }

  if (!isRecord(blockstate.variants)) return null;
  const id = normalizeResourceId(blockId);
  const colon = id.indexOf(":");
  const prefix = `${id.slice(0, colon)}:block/legacy_variant/${id.slice(colon + 1)}`;
  const variants: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  for (const key of forgeVariantStrings(blockstate.variants)) {
    const variant = legacyBlockstateVariant(blockstate, key);
    if (variant === null) continue;
    let model = variant.model;
    if (Object.keys(variant.textures).length > 0) {
      model = `${prefix}/${Object.keys(models).length}`;
      models[model] = { parent: variant.model, textures: variant.textures };
    }
    variants[deepslateKey(key)] = {
      model,
      ...(variant.x !== undefined ? { x: variant.x } : {}),
      ...(variant.y !== undefined ? { y: variant.y } : {}),
      ...(variant.uvlock !== undefined ? { uvlock: variant.uvlock } : {}),
    };
  }
  if (Object.keys(variants).length === 0) return null;
  return { blockstate: { variants }, models };
}

/** A mod's blockstates and models (`ModBlockAssets`, `LoadedModAssets`). */
export interface LegacyModAssets {
  blockstates: Record<string, unknown>;
  models: Record<string, unknown>;
}

/**
 * `assets` with every 1.12 blockstate modernized (`modernizeLegacyBlockstate`)
 * and the models that adds; `assets` itself when it has none. `hasVanillaModel`
 * tells whether a `minecraft:` model id exists.
 */
export function modernizeLegacyModAssets<T extends LegacyModAssets>(
  assets: T,
  hasVanillaModel: (id: string) => boolean,
): T {
  const hasModel = (id: string) =>
    Object.hasOwn(assets.models, id) || hasVanillaModel(id);
  let blockstates: Record<string, unknown> | null = null;
  let models: Record<string, unknown> | null = null;
  for (const [id, blockstate] of Object.entries(assets.blockstates)) {
    const modern = modernizeLegacyBlockstate(id, blockstate, hasModel);
    if (modern === null) continue;
    blockstates ??= { ...assets.blockstates };
    models ??= { ...assets.models };
    blockstates[id] = modern.blockstate;
    Object.assign(models, modern.models);
  }
  return blockstates === null || models === null
    ? assets
    : { ...assets, blockstates, models };
}
