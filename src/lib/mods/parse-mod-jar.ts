// Pure, worker-safe mod jar parser.
//
// Inflates only the client assets needed to catalog and render a mod's blocks
// (blockstates, block models, textures, English lang file, FramedBlocks
// geometry templates) plus the rule data generated-block providers read
// (`generated/jar-data.ts`), and turns them into plain data. Never touches class
// files — no mod code is ever loaded.

import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

import type { AppearanceSources } from "../render/block-appearance";
import { legacyBlockstateRefs } from "./generated/legacy-blockstate.ts";
import {
  providerDataGeneratesBlocks,
  providerJarEntry,
  type ProviderJarReader,
} from "./generated/jar-data.ts";
import { firstJsonValue } from "./lenient-json.ts";
import { computeModAppearances } from "./mod-appearance.ts";
import {
  COPYCAT_TEXTURE,
  FRAMED_ALT_TEXTURE,
  FRAMED_TEXTURE,
} from "../camo/frame-textures.ts";
import {
  parseFramedTemplate,
  type TemplateCube,
} from "../render/camo/shape-pack.ts";
import type {
  ModBlock,
  NestedModJar,
  ParsedModAssets,
  ProviderData,
} from "./types";

const ASSET_PATH_RE =
  /^assets\/([^/]+)\/(blockstates\/.+\.json|models\/.+\.json|textures\/.+\.png(?:\.mcmeta)?|lang\/en_us\.json)$/;

/** FramedBlocks geometry templates (`GeometryTemplateManager`). */
const TEMPLATE_PATH_RE =
  /^assets\/framedblocks\/framed_templates\/([^/]+)\.json$/;

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
  if (TEMPLATE_PATH_RE.test(name)) return true;
  if (providerJarEntry(name) !== null) return true;
  const match = ASSET_PATH_RE.exec(name);
  return match !== null && match[1] !== "minecraft";
}

/** Jars nested in a jar (NeoForge / Forge jar-in-jar). */
const NESTED_JAR_RE = /^META-INF\/jarjar\/[^/]+\.jar$/;
/** Lists each nested jar's maven coordinates and version. */
const JARJAR_METADATA_PATH = "META-INF/jarjar/metadata.json";
/** Declare the jar's mod ids (`[[mods]] modId`). */
const MODS_TOML_PATHS = ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"];

/** Jars nested deeper than this (the outer jar is depth 0) are skipped. */
export const MAX_NESTED_JAR_DEPTH = 3;

/**
 * Parse a mod jar's bytes into block definitions and render assets.
 *
 * Jars nested in `META-INF/jarjar/` are read too, up to
 * `MAX_NESTED_JAR_DEPTH` deep, and their assets merged in as if they were the
 * outer jar's; where both define the same asset, the shallower jar's wins.
 *
 * Block appearances resolve vanilla parent models and textures through
 * `vanilla` (see `vanilla-appearance-sources.ts`); without it only what the jar
 * itself defines is used.
 *
 * Malformed JSON entries and unreadable nested jars are skipped with a
 * warning. Throws if the bytes are not a readable zip archive or its assets,
 * nested jars included, exceed the size/entry budget.
 */
export function parseModJar(
  bytes: Uint8Array,
  vanilla: AppearanceSources | null = null,
): ParsedModAssets {
  const warnings: string[] = [];
  const layers: JarLayer[] = [];
  readJarLayers(
    bytes,
    { path: "", depth: 0, metadata: null },
    { entries: 0, bytes: 0 },
    layers,
    warnings,
  );

  // Merge the layers' assets; the first layer (outer jar first, each jar
  // before the jars nested in it) to define an entry wins.
  const entries: Record<string, Uint8Array> = {};
  const entryLayer = new Map<string, number>();
  for (const [index, layer] of layers.entries()) {
    for (const name of Object.keys(layer.entries).sort()) {
      const winner = entryLayer.get(name);
      if (winner !== undefined) {
        const blockstate = ASSET_PATH_RE.exec(name);
        if (blockstate !== null && blockstate[2].startsWith("blockstates/")) {
          const id = `${blockstate[1]}:${blockstate[2].slice("blockstates/".length, -".json".length)}`;
          warnings.push(
            `Block ${id} is in both ${describeLayer(layers[winner])} and ${describeLayer(layer)}; using the assets of ${describeLayer(layers[winner])}`,
          );
        }
        continue;
      }
      entries[name] = layer.entries[name];
      entryLayer.set(name, index);
    }
  }

  const namespaces = new Set<string>();
  const blockstates: Record<string, unknown> = {};
  const allModels: Record<string, unknown> = {};
  const allTextures: Record<string, Uint8Array> = {};
  const allTextureMeta: Record<string, unknown> = {};
  const lang: Record<string, string> = {};
  const templates: Record<string, TemplateCube[]> = {};
  const providerEntries = new Map<ProviderJarReader, Map<string, unknown>>();

  const names = Object.keys(entries).sort();
  for (const name of names) {
    const providerEntry = providerJarEntry(name);
    if (providerEntry !== null) {
      const { reader, key } = providerEntry;
      let readerEntries = providerEntries.get(reader);
      if (readerEntries === undefined) {
        readerEntries = new Map();
        providerEntries.set(reader, readerEntries);
      }
      readerEntries.set(key, parseJson(name, entries[name], warnings));
      namespaces.add(reader.namespace);
      continue;
    }
    const template = TEMPLATE_PATH_RE.exec(name);
    if (template !== null) {
      const json = parseJson(name, entries[name], warnings);
      if (json === undefined) continue;
      try {
        templates[`framedblocks:${template[1]}`] = parseFramedTemplate(json);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        warnings.push(`Skipped ${name}: ${reason}`);
      }
      continue;
    }
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

  const nestedBlockIds = layers.map((): string[] => []);
  for (const block of blocks) {
    const colon = block.id.indexOf(":");
    const entry = `assets/${block.id.slice(0, colon)}/blockstates/${block.id.slice(colon + 1)}.json`;
    nestedBlockIds[entryLayer.get(entry) ?? 0].push(block.id);
  }
  const nestedJars: NestedModJar[] = layers.slice(1).map((layer, i) => ({
    path: layer.path,
    group: layer.metadata?.group ?? null,
    artifact: layer.metadata?.artifact ?? null,
    version: layer.metadata?.version ?? null,
    modIds: layer.modIds,
    blockIds: nestedBlockIds[i + 1],
    depth: layer.depth,
  }));

  const providerData: ProviderData = {};
  for (const [reader, readerEntries] of providerEntries) {
    providerData[reader.namespace] = reader.read(readerEntries, warnings);
  }

  if (blocks.length === 0 && !providerDataGeneratesBlocks(providerData)) {
    warnings.push(NO_BLOCKS_WARNING);
  }

  // Keep only models reachable from a blockstate, and only textures those
  // models (or their in-mod parents) reference, plus the camo frame textures
  // (empty camo slots, and frames whose placeholder model draws nothing).
  const models: Record<string, unknown> = {};
  const textureRefs = new Set<string>([
    FRAMED_TEXTURE,
    FRAMED_ALT_TEXTURE,
    COPYCAT_TEXTURE,
  ]);
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
    // 1.12 blockstates name models without `block/` and set Forge variant
    // textures themselves.
    const legacy = legacyBlockstateRefs(blockstates[id]);
    for (const modelId of legacy.models) visit(modelId, 0);
    for (const texture of legacy.textures) textureRefs.add(texture);
  }

  const textures: Record<string, Uint8Array> = {};
  const textureMeta: Record<string, unknown> = {};
  for (const ref of textureRefs) {
    const png = allTextures[ref];
    if (png === undefined) continue;
    textures[ref] = png;
    if (ref in allTextureMeta) textureMeta[ref] = allTextureMeta[ref];
  }

  const appearances = computeModAppearances(
    {
      blockIds: blocks.map((block) => block.id),
      blockstates,
      models,
      textures,
      textureMeta,
    },
    vanilla,
  );
  for (const block of blocks) {
    if (Object.hasOwn(appearances, block.id)) {
      block.appearance = appearances[block.id];
    }
  }

  return {
    namespaces: [...namespaces].sort(),
    blocks,
    blockstates,
    models,
    textures,
    textureMeta,
    templates,
    ...(providerEntries.size > 0 ? { providerData } : {}),
    modIds: layers[0].modIds,
    nestedJars,
    warnings,
    appearancesComputed: vanilla !== null,
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

// ── Nested jars ───────────────────────────────────────────────────────────

/** One jar's inflated entries: the outer jar or a nested one. */
interface JarLayer {
  /** "" for the outer jar; see `NestedModJar.path`. */
  path: string;
  depth: number;
  metadata: NestedJarMetadata | null;
  modIds: string[];
  /** Asset entries only (`isModAssetEntry`). */
  entries: Record<string, Uint8Array>;
}

interface NestedJarMetadata {
  group: string | null;
  artifact: string | null;
  version: string | null;
}

/** Inflated entries and bytes so far, shared by a jar and every nested jar. */
interface AssetBudget {
  entries: number;
  bytes: number;
}

/** Over the asset budget: never caught as an unreadable nested jar. */
class AssetBudgetError extends Error {}

/**
 * Inflate `bytes`' asset, mods.toml and jar-in-jar entries into `layers`
 * (this jar, then each nested jar's layers in path order), charging `budget`.
 */
function readJarLayers(
  bytes: Uint8Array,
  jar: { path: string; depth: number; metadata: NestedJarMetadata | null },
  budget: AssetBudget,
  layers: JarLayer[],
  warnings: string[],
): void {
  const entries = unzipSync(bytes, {
    filter: (file: UnzipFileInfo) => {
      const nested = NESTED_JAR_RE.test(file.name);
      if (
        !nested &&
        !isModAssetEntry(file.name) &&
        file.name !== JARJAR_METADATA_PATH &&
        !MODS_TOML_PATHS.includes(file.name)
      ) {
        return false;
      }
      if (nested && jar.depth >= MAX_NESTED_JAR_DEPTH) {
        warnings.push(
          `Skipped nested jar ${nestedPath(jar.path, file.name)}: jars nested more than ${MAX_NESTED_JAR_DEPTH} deep are not read`,
        );
        return false;
      }
      budget.entries += 1;
      // Stored entries are copied at their compressed size.
      budget.bytes += Math.max(file.originalSize, file.size);
      if (
        budget.entries > MAX_ASSET_ENTRIES ||
        budget.bytes > MAX_ASSET_BYTES
      ) {
        throw new AssetBudgetError(
          `Mod jar is too large to read: its assets exceed ${MAX_ASSET_ENTRIES} files or ${MAX_ASSET_BYTES / (1024 * 1024)} MB uncompressed`,
        );
      }
      return true;
    },
  });

  const modIds = new Set<string>();
  for (const name of MODS_TOML_PATHS) {
    if (!(name in entries)) continue;
    for (const id of readModsTomlModIds(strFromU8(entries[name]))) {
      modIds.add(id);
    }
    delete entries[name];
  }
  const metadata =
    JARJAR_METADATA_PATH in entries
      ? readJarJarMetadata(entries[JARJAR_METADATA_PATH], warnings)
      : new Map<string, NestedJarMetadata>();
  delete entries[JARJAR_METADATA_PATH];

  const nestedNames = Object.keys(entries)
    .filter((name) => NESTED_JAR_RE.test(name))
    .sort();
  const nestedBytes = nestedNames.map((name) => entries[name]);
  for (const name of nestedNames) delete entries[name];

  layers.push({ ...jar, modIds: [...modIds].sort(), entries });

  for (const [i, name] of nestedNames.entries()) {
    const path = nestedPath(jar.path, name);
    try {
      readJarLayers(
        nestedBytes[i],
        { path, depth: jar.depth + 1, metadata: metadata.get(name) ?? null },
        budget,
        layers,
        warnings,
      );
    } catch (err) {
      if (err instanceof AssetBudgetError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push(`Skipped nested jar ${path}: ${reason}`);
    }
  }
}

function nestedPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}!/${name}`;
}

function describeLayer(layer: JarLayer): string {
  return layer.depth === 0 ? "the outer jar" : `nested jar ${layer.path}`;
}

/** `META-INF/jarjar/metadata.json`: nested jar path → coordinates. */
function readJarJarMetadata(
  data: Uint8Array,
  warnings: string[],
): Map<string, NestedJarMetadata> {
  const byPath = new Map<string, NestedJarMetadata>();
  const json = parseJson(JARJAR_METADATA_PATH, data, warnings);
  if (!isRecord(json) || !Array.isArray(json.jars)) return byPath;
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  for (const jar of json.jars) {
    if (!isRecord(jar) || typeof jar.path !== "string") continue;
    const identifier = isRecord(jar.identifier) ? jar.identifier : {};
    const version = isRecord(jar.version) ? jar.version : {};
    byPath.set(jar.path, {
      group: text(identifier.group),
      artifact: text(identifier.artifact),
      version: text(version.artifactVersion),
    });
  }
  return byPath;
}

/**
 * The `modId` values of a mods.toml's `[[mods]]` tables. A minimal reader:
 * one `key = "string"` per line, as every mod's toml writes them.
 */
export function readModsTomlModIds(toml: string): string[] {
  const ids: string[] = [];
  let inMods = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inMods = /^\[\[\s*mods\s*\]\]/.test(line);
      continue;
    }
    if (!inMods) continue;
    const match = /^["']?modId["']?\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    const id = match?.[1] ?? match?.[2];
    if (id !== undefined && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
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
  // Strip a UTF-8 BOM, which some mod tooling emits.
  const text = strFromU8(data).replace(/^﻿/, "");
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    // Minecraft reads these files with Gson's lenient reader, which ignores
    // comments and anything after the first complete value.
    const lenient = firstJsonValue(text);
    if (lenient !== null) {
      try {
        const json = JSON.parse(lenient) as unknown;
        warnings.push(
          `Read ${name} leniently (comments or content after the JSON value ignored)`,
        );
        return json;
      } catch {
        // Fall through to the strict error.
      }
    }
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
