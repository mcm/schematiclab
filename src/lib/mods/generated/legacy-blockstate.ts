// Minecraft 1.12 blockstate files, vanilla and Forge (`forge_marker: 1`),
// read the way 1.12 picks a variant's model: a variant string (`a=1,b=2`,
// `normal`, or a mod's own name such as Chisel's `cracked`) selects the
// `defaults`, then the exact `variants` entry (first of a list), or each
// property's entry of a Forge property object. Model names gain the `block/`
// prefix 1.12 adds (`cube_all` → `minecraft:block/cube_all`).
//
// The 3D preview doesn't render these files; generated-block providers read
// them to find a source block's model and textures.
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
function isPropertyObject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([name, entry]) => !VARIANT_KEYS.has(name) && isRecord(entry))
  );
}
