// Pure, worker-safe mod jar parser.
//
// Inflates only the client assets needed to catalog and render a mod's blocks
// (blockstates, block models, textures, English lang file, FramedBlocks
// geometry templates) plus the rule data generated-block providers read
// (`generated/jar-data.ts`), and turns them into plain data. Never touches class
// files — no mod code is ever loaded.

import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

import type { AppearanceSources } from "../render/block-appearance";
import {
  legacyBlockstateRefs,
  legacyModelId,
} from "./generated/legacy-blockstate.ts";
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
  CompatPackAssets,
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

/**
 * Built-in resource packs a mod enables when mod `<modid>` is loaded
 * (Dyenamics and Friends' `compat_packs/<modid>/assets/…`).
 */
const COMPAT_PACK_PATH_RE = /^compat_packs\/([^/]+)\/(?=assets\/)/;

/** True if a zip entry should be inflated by `parseModJar`. */
export function isModAssetEntry(name: string): boolean {
  if (TEMPLATE_PATH_RE.test(name)) return true;
  if (providerJarEntry(name) !== null) return true;
  const compat = COMPAT_PACK_PATH_RE.exec(name);
  const match = ASSET_PATH_RE.exec(
    compat === null ? name : name.slice(compat[0].length),
  );
  return match !== null && match[1] !== "minecraft";
}

/**
 * True if `name` (relative to a resource pack's root, `assets/<ns>/…`) is an
 * asset `parseResourcePack` reads: the blockstates, models, textures and
 * English lang file `parseModJar` reads, outside the `minecraft` namespace.
 */
export function isResourcePackAssetEntry(name: string): boolean {
  const match = ASSET_PATH_RE.exec(name);
  return match !== null && match[1] !== "minecraft";
}

/**
 * Counts files read from a resource pack folder against `parseModJar`'s
 * zip-bomb limits. `charge` throws once the files read exceed
 * `MAX_ASSET_ENTRIES` or `MAX_ASSET_BYTES`.
 */
export function resourcePackBudget(what: string): {
  charge: (bytes: number) => void;
} {
  const budget: AssetBudget = { entries: 0, bytes: 0 };
  return {
    charge(bytes) {
      budget.entries += 1;
      budget.bytes += bytes;
      if (
        budget.entries > MAX_ASSET_ENTRIES ||
        budget.bytes > MAX_ASSET_BYTES
      ) {
        throw new Error(
          `${what} is too large to read: its assets exceed ${MAX_ASSET_ENTRIES} files or ${MAX_ASSET_BYTES / (1024 * 1024)} MB`,
        );
      }
    },
  };
}

/** A resource pack's assets (`parseResourcePack`), every file kept. */
export interface ResourcePackAssets {
  /** Non-`minecraft` asset namespaces, sorted. */
  namespaces: string[];
  /** Block id → blockstate JSON. */
  blockstates: Record<string, unknown>;
  /** Model id (`ns:block/x`) → model JSON. */
  models: Record<string, unknown>;
  /** Texture id → PNG bytes. */
  textures: Record<string, Uint8Array>;
  textureMeta: Record<string, unknown>;
  /** `en_us.json` entries. */
  lang: Record<string, string>;
  warnings: string[];
}

/**
 * Parses a resource pack's files (named `assets/<ns>/…`, as
 * `isResourcePackAssetEntry` filters them): every blockstate, model,
 * texture and lang entry, not just those a blockstate reaches, since they
 * sit over other packs' assets. Malformed JSON is skipped with a warning
 * and read leniently as in `parseModJar`.
 */
export function parseResourcePack(
  files: Readonly<Record<string, Uint8Array>>,
): ResourcePackAssets {
  const warnings: string[] = [];
  const entries: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (isResourcePackAssetEntry(name)) entries[name] = bytes;
  }
  const read = readAssetEntries(entries, "", warnings);
  return {
    namespaces: [...read.namespaces].sort(),
    blockstates: read.blockstates,
    models: read.allModels,
    textures: read.allTextures,
    textureMeta: read.allTextureMeta,
    lang: read.lang,
    warnings,
  };
}

/**
 * The model ids (`parent`s included, followed in `models`) and literal
 * texture ids a blockstate reaches, read the 1.13+ way and the 1.12 way.
 */
export function blockstateAssetRefs(
  blockstate: unknown,
  models: Readonly<Record<string, unknown>> | ((id: string) => unknown),
): { models: Set<string>; textures: Set<string> } {
  const modelIds = new Set<string>();
  const textures = new Set<string>();
  const getModel =
    typeof models === "function"
      ? models
      : (id: string) => (Object.hasOwn(models, id) ? models[id] : undefined);
  const visit = (modelId: string, depth: number): void => {
    if (depth > MAX_PARENT_DEPTH || modelIds.has(modelId)) return;
    modelIds.add(modelId);
    const model = getModel(modelId);
    if (!isRecord(model)) return;
    if (isRecord(model.textures)) {
      for (const value of Object.values(model.textures)) {
        const ref = textureRefOf(value);
        if (ref !== null) textures.add(ref);
      }
    }
    if (typeof model.parent === "string") {
      visit(normalizeResourceId(model.parent), depth + 1);
    }
  };
  for (const modelId of blockstateModelRefs(blockstate)) visit(modelId, 0);
  const legacy = legacyBlockstateRefs(blockstate);
  for (const modelId of legacy.models) visit(modelId, 0);
  for (const texture of legacy.textures) textures.add(texture);
  return { models: modelIds, textures };
}

/** A model's parent id and the literal texture ids it names. */
export function modelAssetRefs(model: unknown): {
  parent: string | null;
  textures: string[];
} {
  if (!isRecord(model)) return { parent: null, textures: [] };
  const textures: string[] = [];
  if (isRecord(model.textures)) {
    for (const value of Object.values(model.textures)) {
      const ref = textureRefOf(value);
      if (ref !== null) textures.push(ref);
    }
  }
  return {
    parent:
      typeof model.parent === "string"
        ? normalizeResourceId(model.parent)
        : null,
    textures,
  };
}

/**
 * The model ids a blockstate (and the parents of its models) reaches, and
 * the literal texture ids those name, that `getModel` / `hasTexture` don't
 * have; `minecraft:` ids are never listed. A model name is found in its
 * 1.13+ form or its 1.12 `block/` form (`legacyModelId`); when neither
 * exists, the form its format uses is listed (1.12 for Forge files).
 */
export function missingAssetRefs(
  blockstate: unknown,
  getModel: (id: string) => unknown,
  hasTexture: (id: string) => boolean,
): { models: Set<string>; textures: Set<string> } {
  const models = new Set<string>();
  const textures = new Set<string>();
  const vanillaId = (id: string) => id.startsWith("minecraft:");
  const checkTexture = (id: string) => {
    if (!vanillaId(id) && !hasTexture(id)) textures.add(id);
  };
  const seen = new Set<string>();
  const visit = (modelId: string, depth: number): void => {
    if (depth > MAX_PARENT_DEPTH || seen.has(modelId)) return;
    seen.add(modelId);
    const model = getModel(modelId);
    if (!isRecord(model)) return;
    if (isRecord(model.textures)) {
      for (const value of Object.values(model.textures)) {
        const ref = textureRefOf(value);
        if (ref !== null) checkTexture(ref);
      }
    }
    if (typeof model.parent === "string") {
      const parent = normalizeResourceId(model.parent);
      if (getModel(parent) === undefined) {
        if (!vanillaId(parent)) models.add(parent);
      } else {
        visit(parent, depth + 1);
      }
    }
  };
  const refs = legacyBlockstateRefs(blockstate);
  const named = new Set(refs.models);
  const forge = isRecord(blockstate) && blockstate.forge_marker !== undefined;
  for (const id of named) {
    // Skip the `block/` forms `legacyBlockstateRefs` adds.
    const colon = id.indexOf(":");
    if (
      id.startsWith("block/", colon + 1) &&
      named.has(
        `${id.slice(0, colon)}:${id.slice(colon + "block/".length + 1)}`,
      )
    ) {
      continue;
    }
    const legacy = legacyModelId(id);
    if (getModel(id) !== undefined) visit(id, 0);
    else if (getModel(legacy) !== undefined) visit(legacy, 0);
    else if (!vanillaId(id)) models.add(forge ? legacy : id);
  }
  for (const texture of refs.textures) checkTexture(texture);
  return { models, textures };
}

/** Jars nested in a jar (NeoForge / Forge jar-in-jar). */
const NESTED_JAR_RE = /^META-INF\/jarjar\/[^/]+\.jar$/;
/** Lists each nested jar's maven coordinates and version. */
const JARJAR_METADATA_PATH = "META-INF/jarjar/metadata.json";
/** Declare the jar's mod ids (`[[mods]] modId`). */
const MODS_TOML_PATHS = ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"];

/** Jars nested deeper than this (the outer jar is depth 0) are skipped. */
export const MAX_NESTED_JAR_DEPTH = 3;

export interface ParseModJarOptions {
  /**
   * Nested jars (by `NestedModJar.path`) whose assets aren't read; the jars
   * nested in them still are. They are still listed in `nestedJars`.
   */
  skipNestedJar?: (path: string) => boolean;
}

/** Model ids (`ns:block/x`) and texture ids a jar ships. */
export interface JarAssetIds {
  models: string[];
  textures: string[];
}

/** The asset ids of one jar (outer or nested), by entry name. */
export interface JarAssetIndex extends JarAssetIds {
  /**
   * Namespaces it ships blockstates in (its blocks'), sorted: shipping a
   * model or texture of a namespace doesn't make it the namespace's jar.
   */
  blockNamespaces: string[];
  /** Its `compat_packs/<modid>/` packs' ids, by mod id. */
  compatPacks: Record<string, JarAssetIds>;
}

/** A jar's mod ids, nested jars and asset ids, without its assets. */
export interface ModJarIndex {
  modIds: string[];
  /** The outer jar's own asset ids. */
  assets: JarAssetIndex;
  nestedJars: (Omit<NestedModJar, "blockIds"> & { assets: JarAssetIndex })[];
}

/**
 * Reads only the mod ids, nested jars and the model and texture ids of a mod
 * jar, from its zip entry names (no assets are inflated), e.g. to pick which
 * copy of a nested mod to read before `parseModJar`. Throws like
 * `parseModJar` does.
 */
export function readModJarIndex(bytes: Uint8Array): ModJarIndex {
  const layers: JarLayer[] = [];
  readJarLayers(
    bytes,
    { path: "", depth: 0, metadata: null },
    { budget: { entries: 0, bytes: 0 }, readAssets: () => false },
    layers,
    [],
  );
  return {
    modIds: layers[0].modIds,
    assets: assetIndexOf(layers[0].assetNames),
    nestedJars: layers.slice(1).map((layer) => ({
      ...nestedModJarOf(layer),
      assets: assetIndexOf(layer.assetNames),
    })),
  };
}

/** The model and texture ids of a layer's asset entry names. */
function assetIndexOf(names: readonly string[]): JarAssetIndex {
  const namespaces = new Set<string>();
  const own: { models: Set<string>; textures: Set<string> } = {
    models: new Set(),
    textures: new Set(),
  };
  const compat = new Map<string, typeof own>();
  for (const name of names) {
    const prefix = COMPAT_PACK_PATH_RE.exec(name);
    const match = ASSET_PATH_RE.exec(
      prefix === null ? name : name.slice(prefix[0].length),
    );
    if (match === null || match[1] === "minecraft") continue;
    let ids = own;
    if (prefix === null) {
      if (match[2].startsWith("blockstates/")) namespaces.add(match[1]);
    } else {
      ids = compat.get(prefix[1]) ?? { models: new Set(), textures: new Set() };
      compat.set(prefix[1], ids);
    }
    const rest = match[2];
    if (rest.startsWith("models/")) {
      ids.models.add(
        `${match[1]}:${rest.slice("models/".length, -".json".length)}`,
      );
    } else if (rest.startsWith("textures/") && rest.endsWith(".png")) {
      ids.textures.add(
        `${match[1]}:${rest.slice("textures/".length, -".png".length)}`,
      );
    }
  }
  const sorted = (ids: typeof own): JarAssetIds => ({
    models: [...ids.models].sort(),
    textures: [...ids.textures].sort(),
  });
  return {
    ...sorted(own),
    blockNamespaces: [...namespaces].sort(),
    compatPacks: Object.fromEntries(
      [...compat.keys()]
        .sort()
        .map((modId) => [modId, sorted(compat.get(modId)!)]),
    ),
  };
}

export interface ReadJarAssetsOptions extends ParseModJarOptions {
  /** The `compat_packs/<modid>/` packs read (none when absent). */
  compatPacks?: ReadonlySet<string>;
}

/** Models and textures `readJarAssets` read. */
export interface JarAssets {
  models: Record<string, unknown>;
  textures: Record<string, Uint8Array>;
  textureMeta: Record<string, unknown>;
  warnings: string[];
}

/**
 * Reads only the models and textures `ids` names from a mod jar: its own
 * `assets/`, its nested jars' (but those `skipNestedJar` skips) and its
 * `compatPacks`' packs, layered as `parseModJar` layers them (the outer jar
 * over nested ones, compat packs over the jar). Same entry filter and
 * zip-bomb budget as `parseModJar`; ids the jar lacks are left out.
 */
export function readJarAssets(
  bytes: Uint8Array,
  ids: { models: Iterable<string>; textures: Iterable<string> },
  options: ReadJarAssetsOptions = {},
): JarAssets {
  const wanted = new Set<string>();
  for (const id of ids.models) {
    const colon = id.indexOf(":");
    wanted.add(
      `assets/${id.slice(0, colon)}/models/${id.slice(colon + 1)}.json`,
    );
  }
  for (const id of ids.textures) {
    const colon = id.indexOf(":");
    const path = `assets/${id.slice(0, colon)}/textures/${id.slice(colon + 1)}.png`;
    wanted.add(path);
    wanted.add(`${path}.mcmeta`);
  }
  const compatPacks = options.compatPacks ?? new Set<string>();
  const warnings: string[] = [];
  const layers: JarLayer[] = [];
  const skip = options.skipNestedJar;
  readJarLayers(
    bytes,
    { path: "", depth: 0, metadata: null },
    {
      budget: { entries: 0, bytes: 0 },
      readAssets: (path) => path === "" || skip === undefined || !skip(path),
      wantEntry: (name) => {
        const compat = COMPAT_PACK_PATH_RE.exec(name);
        if (compat === null) return wanted.has(name);
        return (
          compatPacks.has(compat[1]) && wanted.has(name.slice(compat[0].length))
        );
      },
    },
    layers,
    warnings,
  );
  const entries: Record<string, Uint8Array> = {};
  for (const layer of layers) {
    for (const name of Object.keys(layer.entries)) {
      if (!Object.hasOwn(entries, name)) entries[name] = layer.entries[name];
    }
  }
  const outer: Record<string, Uint8Array> = {};
  const compat = new Map<string, Record<string, Uint8Array>>();
  for (const name of Object.keys(entries)) {
    const prefix = COMPAT_PACK_PATH_RE.exec(name);
    if (prefix === null) {
      outer[name] = entries[name];
    } else {
      const pack = compat.get(prefix[1]) ?? {};
      pack[name] = entries[name];
      compat.set(prefix[1], pack);
    }
  }
  const out: JarAssets = {
    models: {},
    textures: {},
    textureMeta: {},
    warnings,
  };
  const reads = [readAssetEntries(outer, "", warnings)];
  for (const modId of [...compat.keys()].sort()) {
    reads.push(
      readAssetEntries(compat.get(modId)!, `compat_packs/${modId}/`, warnings),
    );
  }
  for (const read of reads) {
    Object.assign(out.models, read.allModels);
    Object.assign(out.textures, read.allTextures);
    Object.assign(out.textureMeta, read.allTextureMeta);
  }
  return out;
}

/**
 * Parse a mod jar's bytes into block definitions and render assets.
 *
 * Jars nested in `META-INF/jarjar/` are read too, up to
 * `MAX_NESTED_JAR_DEPTH` deep, and their assets merged in as if they were the
 * outer jar's; where both define the same asset, the shallower jar's wins.
 *
 * Built-in `compat_packs/<modid>/` resource packs are returned in
 * `compatPacks`, not merged into `blocks`.
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
  options: ParseModJarOptions = {},
): ParsedModAssets {
  const warnings: string[] = [];
  const layers: JarLayer[] = [];
  const skip = options.skipNestedJar;
  readJarLayers(
    bytes,
    { path: "", depth: 0, metadata: null },
    {
      budget: { entries: 0, bytes: 0 },
      readAssets: (path) => path === "" || skip === undefined || !skip(path),
    },
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

  // Built-in resource packs (`compat_packs/<modid>/assets/…`) are read on
  // their own: only the modpack upload enables them.
  const outerEntries: Record<string, Uint8Array> = {};
  const compatEntries = new Map<string, Record<string, Uint8Array>>();
  for (const name of Object.keys(entries)) {
    const compat = COMPAT_PACK_PATH_RE.exec(name);
    if (compat === null) {
      outerEntries[name] = entries[name];
      continue;
    }
    let pack = compatEntries.get(compat[1]);
    if (pack === undefined) {
      pack = {};
      compatEntries.set(compat[1], pack);
    }
    pack[name] = entries[name];
  }

  const read = readAssetEntries(outerEntries, "", warnings);
  const inferred = inferLangModelBlockstates(read);
  const { unresolvedRefs, ...assets } = collectBlockAssets(read, vanilla);
  const { blocks } = assets;

  const nestedBlockIds = layers.map((): string[] => []);
  for (const block of blocks) {
    const colon = block.id.indexOf(":");
    const ns = block.id.slice(0, colon);
    const path = block.id.slice(colon + 1);
    const entry = inferred.has(block.id)
      ? `assets/${ns}/models/block/${path}.json`
      : `assets/${ns}/blockstates/${path}.json`;
    nestedBlockIds[entryLayer.get(entry) ?? 0].push(block.id);
  }
  const nestedJars: NestedModJar[] = layers.slice(1).map((layer, i) => ({
    ...nestedModJarOf(layer),
    blockIds: nestedBlockIds[i + 1],
  }));

  const providerData: ProviderData = {};
  for (const [reader, readerEntries] of read.providerEntries) {
    providerData[reader.namespace] = reader.read(readerEntries, warnings);
  }

  if (blocks.length === 0 && !providerDataGeneratesBlocks(providerData)) {
    warnings.push(NO_BLOCKS_WARNING);
  }

  // A compat pack sits on top of the jar's own assets, as an enabled
  // resource pack does: its blockstates may use the jar's models and
  // textures, and its own replace the jar's.
  const compatPacks: Record<string, CompatPackAssets> = {};
  const langs = [read.lang];
  for (const modId of [...compatEntries.keys()].sort()) {
    const prefix = `compat_packs/${modId}/`;
    const pack = readAssetEntries(compatEntries.get(modId)!, prefix, warnings);
    langs.push(pack.lang);
    const packAssets = collectBlockAssets(
      {
        ...pack,
        allModels: { ...read.allModels, ...pack.allModels },
        allTextures: { ...read.allTextures, ...pack.allTextures },
        allTextureMeta: { ...read.allTextureMeta, ...pack.allTextureMeta },
        lang: { ...read.lang, ...pack.lang },
      },
      vanilla,
    );
    if (packAssets.blocks.length === 0) continue;
    compatPacks[modId] = {
      namespaces: [...pack.namespaces].sort(),
      ...packAssets,
    };
  }

  // `block.<ns>.<path>` names no block read here uses: the modpack upload
  // names blocks a server registers without assets by them.
  const usedNames = new Set(
    [
      ...blocks,
      ...Object.values(compatPacks).flatMap((pack) => pack.blocks),
    ].map((block) => langBlockKey(block.id)),
  );
  const langBlockNames: Record<string, string> = {};
  for (const lang of langs) {
    for (const [key, name] of Object.entries(lang)) {
      if (
        key.startsWith("block.") &&
        name.length > 0 &&
        !usedNames.has(key) &&
        !Object.hasOwn(langBlockNames, key)
      ) {
        langBlockNames[key] = name;
      }
    }
  }

  return {
    namespaces: [...read.namespaces].sort(),
    ...assets,
    unresolvedRefs,
    templates: read.templates,
    ...(read.providerEntries.size > 0 ? { providerData } : {}),
    modIds: layers[0].modIds,
    nestedJars,
    compatPacks,
    langBlockNames,
    warnings,
    appearancesComputed: vanilla !== null,
  };
}

/** The asset entries of a jar (or of a compat pack in it), parsed. */
interface ReadAssets {
  namespaces: Set<string>;
  blockstates: Record<string, unknown>;
  allModels: Record<string, unknown>;
  allTextures: Record<string, Uint8Array>;
  allTextureMeta: Record<string, unknown>;
  lang: Record<string, string>;
  templates: Record<string, TemplateCube[]>;
  providerEntries: Map<ProviderJarReader, Map<string, unknown>>;
}

/**
 * Parses `entries` (named `<prefix>assets/…`; the prefix is "" for the jar's
 * own assets) into blockstates, models, textures, lang, templates and
 * provider data.
 */
function readAssetEntries(
  entries: Record<string, Uint8Array>,
  prefix: string,
  warnings: string[],
): ReadAssets {
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
    const path = name.slice(prefix.length);
    if (prefix === "") {
      const providerEntry = providerJarEntry(path);
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
      const template = TEMPLATE_PATH_RE.exec(path);
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
    }
    const match = ASSET_PATH_RE.exec(path);
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
      const id = rest.slice("blockstates/".length, -".json".length);
      blockstates[`${ns}:${id}`] = json;
    } else if (rest.startsWith("models/")) {
      const id = rest.slice("models/".length, -".json".length);
      allModels[`${ns}:${id}`] = json;
    } else if (isRecord(json)) {
      // lang/en_us.json
      for (const [key, value] of Object.entries(json)) {
        if (typeof value === "string") lang[key] = value;
      }
    } else {
      warnings.push(`Skipped ${name}: expected a JSON object`);
    }
  }
  return {
    namespaces,
    blockstates,
    allModels,
    allTextures,
    allTextureMeta,
    lang,
    templates,
    providerEntries,
  };
}

const LANG_BLOCK_KEY_RE = /^block\.([^.]+)\.([a-z0-9_/-]+)$/;

/**
 * Adds to `read.blockstates` the blocks a jar names (`block.<ns>.<path>` in
 * its lang) and ships a block model for (`<ns>:block/<path>`) but gives no
 * blockstate, as a single-variant blockstate using that model. Mods that
 * build their blockstates in code (Modular Bees) ship only those. Returns the
 * ids added.
 */
function inferLangModelBlockstates(read: ReadAssets): Set<string> {
  const inferred = new Set<string>();
  for (const key of Object.keys(read.lang).sort()) {
    const match = LANG_BLOCK_KEY_RE.exec(key);
    if (match === null) continue;
    const id = `${match[1]}:${match[2]}`;
    const model = `${match[1]}:block/${match[2]}`;
    if (Object.hasOwn(read.blockstates, id)) continue;
    if (!Object.hasOwn(read.allModels, model)) continue;
    read.blockstates[id] = { variants: { "": { model } } };
    inferred.add(id);
  }
  return inferred;
}

/**
 * The blocks of `read`'s blockstates, with the models they reach, the
 * textures those use and the blocks' appearances.
 */
function collectBlockAssets(
  read: Pick<
    ReadAssets,
    "blockstates" | "allModels" | "allTextures" | "allTextureMeta" | "lang"
  >,
  vanilla: AppearanceSources | null,
): Omit<CompatPackAssets, "namespaces"> &
  Required<Pick<CompatPackAssets, "unresolvedRefs">> {
  const { blockstates, allModels, allTextures, allTextureMeta, lang } = read;
  const blocks: ModBlock[] = Object.keys(blockstates)
    .sort()
    .map((id) => ({
      id,
      displayName: displayNameFor(id, lang),
      properties: extractProperties(blockstates[id]),
    }));

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

  // Ids the blockstates reach that neither the jar nor vanilla has.
  const missingModels = new Set<string>();
  const missingTextures = new Set<string>();
  for (const id of Object.keys(blockstates)) {
    const missing = missingAssetRefs(
      blockstates[id],
      (modelId) =>
        Object.hasOwn(allModels, modelId)
          ? allModels[modelId]
          : vanilla?.getModel(modelId),
      (texture) =>
        Object.hasOwn(allTextures, texture) ||
        (vanilla?.getTextureColor(texture) ?? null) !== null,
    );
    for (const ref of missing.models) missingModels.add(ref);
    for (const ref of missing.textures) missingTextures.add(ref);
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
    blocks,
    blockstates,
    models,
    textures,
    textureMeta,
    unresolvedRefs: {
      models: [...missingModels].sort(),
      textures: [...missingTextures].sort(),
    },
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
  /** The names of its asset entries, read or not. */
  assetNames: string[];
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

interface ReadLayersOptions {
  budget: AssetBudget;
  /** False for jars (by path, "" for the outer jar) whose assets are skipped. */
  readAssets: (path: string) => boolean;
  /** Which asset entries are read (all when absent). */
  wantEntry?: (name: string) => boolean;
}

function nestedModJarOf(layer: JarLayer): Omit<NestedModJar, "blockIds"> {
  return {
    path: layer.path,
    group: layer.metadata?.group ?? null,
    artifact: layer.metadata?.artifact ?? null,
    version: layer.metadata?.version ?? null,
    modIds: layer.modIds,
    depth: layer.depth,
  };
}

/**
 * Inflate `bytes`' asset, mods.toml and jar-in-jar entries into `layers`
 * (this jar, then each nested jar's layers in path order), charging the
 * options' budget. Asset entries are only read where `readAssets` says so.
 */
function readJarLayers(
  bytes: Uint8Array,
  jar: { path: string; depth: number; metadata: NestedJarMetadata | null },
  options: ReadLayersOptions,
  layers: JarLayer[],
  warnings: string[],
): void {
  const { budget } = options;
  const readAssets = options.readAssets(jar.path);
  const assetNames: string[] = [];
  const entries = unzipSync(bytes, {
    filter: (file: UnzipFileInfo) => {
      const nested = NESTED_JAR_RE.test(file.name);
      const asset = !nested && isModAssetEntry(file.name);
      if (asset) assetNames.push(file.name);
      if (
        !nested &&
        !(
          readAssets &&
          asset &&
          (options.wantEntry === undefined || options.wantEntry(file.name))
        ) &&
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

  layers.push({ ...jar, modIds: [...modIds].sort(), entries, assetNames });

  for (const [i, name] of nestedNames.entries()) {
    const path = nestedPath(jar.path, name);
    try {
      readJarLayers(
        nestedBytes[i],
        { path, depth: jar.depth + 1, metadata: metadata.get(name) ?? null },
        options,
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

/** The lang key of a block's name: `create:a/b` → `block.create.a.b`. */
export function langBlockKey(id: string): string {
  const colon = id.indexOf(":");
  return `block.${id.slice(0, colon)}.${id.slice(colon + 1).replace(/\//g, ".")}`;
}

/** A block's English name from `lang`, else its id's path title-cased. */
export function displayNameFor(
  id: string,
  lang: Readonly<Record<string, string>>,
): string {
  const name = lang[langBlockKey(id)];
  return name !== undefined && name.length > 0
    ? name
    : titleCase(id.slice(id.indexOf(":") + 1));
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
