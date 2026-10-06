// The extraction core of the modpack upload CLI (`pnpm modpack:upload`):
// turns a pack's mod jars into one `pack.json.gz` record and a swatch sheet
// per mod file. Each jar goes through the browser's jar parser
// (`parseModJar`), then `classifyModBlock`, the appearance descriptors and
// `packSwatches`; properties are completed with `completeBlockProperties`.
// Blocks whose models or textures are in other jars of the pack are then
// described again with those (`resolveCrossJarLooks`), and their looks and
// the `kubejs/assets` looks go in per-upload `pack-<hash>` sheets.
// Only derived data comes out: no textures, models or jars.
//
// Where the jars come from (an instance folder, CurseForge) is the caller's
// business: it hands over a `ModpackSource` whose mods read their own bytes.
// Every mod ends with a status, so the pack record accounts for all of them.
//
// Pure apart from `crypto.subtle` (hashing jars without CurseForge ids and
// the per-upload swatch sheets).
// Imports carry their `.ts` extension so node's strip-types can load it.

import {
  CAMO_BLOCK_IDS,
  DOUBLE_CAMO_BLOCK_IDS,
} from "../camo/camo-blocks.generated.ts";
import { camoFrameTexture } from "../camo/frame-textures.ts";
import { modernizeLegacyModAssets } from "../mods/generated/legacy-blockstate.ts";
import {
  blockstateAssetRefs,
  displayNameFor,
  extractProperties,
  langBlockKey,
  missingAssetRefs,
  modelAssetRefs,
  parseModJar,
  parseResourcePack,
  readJarAssets,
  readModJarIndex,
  type ModJarIndex,
  type ReadJarAssetsOptions,
  type ResourcePackAssets,
} from "../mods/parse-mod-jar.ts";
import type { ModBlock, ParsedModAssets } from "../mods/types.ts";
import { completeBlockProperties } from "../mods/property-domains.ts";
import {
  appearanceRecord,
  describeModBlocks,
  packSwatches,
  packSwatchSheets,
  type BlockDescriptor,
  type DescriptorSources,
  type SwatchBlock,
} from "./appearance.ts";
import {
  applyBlockList,
  vanillaMismatchWarning,
  type BlockList,
} from "./block-list.ts";
import { classifyModBlock } from "./classify.ts";
import {
  dropAbsentModCompatBlocks,
  type DroppedCompatBlocks,
} from "./compat-blocks.ts";
import {
  chooseNestedJars,
  type NestedJarDecision,
  type NestedJarOwner,
} from "./nested-mods.ts";
import {
  BLOB_KEY_PATTERN,
  BLOCK_ID_PATTERN,
  MODPACK_FORMAT_VERSION,
  MODPACK_SLUG_PATTERN,
  type ModpackBlock,
  type ModpackData,
  type ModpackLoader,
  type ModpackMod,
  type ModStatus,
  type RuntimeBlockSource,
} from "./schema.ts";

/** Jars bigger than this aren't read (`skipped-too-large`). */
export const MAX_MOD_JAR_BYTES = 512 * 1024 * 1024;

/** One mod of the pack, before extraction. */
export interface ModpackModSource {
  name: string;
  /** Jar file name, when known. */
  fileName: string | null;
  curseForgeProjectId: number | null;
  curseForgeFileId: number | null;
  /** Jar size in bytes when known up front, to skip huge jars unread. */
  size: number | null;
  /** Reads the jar; null when the jar isn't available. */
  read: (() => Promise<Uint8Array>) | null;
  /** Why the jar isn't available (with `read: null`). */
  missingMessage?: string;
  /** The status of a mod with `read: null` (default `failed`). */
  missingStatus?: Extract<
    ModStatus,
    "failed" | "skipped-undistributable" | "skipped-too-large"
  >;
}

/** A pack as a source (instance folder, CurseForge…) describes it. */
export interface ModpackSource {
  name: string;
  /** The pack's slug when the source has one (CurseForge's). */
  slug?: string;
  /** The pack's own version label, when the source names one. */
  displayVersion: string | null;
  minecraftVersion: string | null;
  loader: ModpackLoader;
  curseForgeProjectId: number | null;
  /** CurseForge file id of the pack file, when known. */
  packFileId: number | null;
  mods: ModpackModSource[];
  /** True when the pack has a `kubejs/` folder. */
  hasKubeJs: boolean;
  /**
   * Reads the pack's `kubejs/assets/` resource pack: its files that
   * `isResourcePackAssetEntry` accepts, named `assets/<ns>/…`, within
   * `resourcePackBudget`'s limits (throws past them). Absent, or null from
   * it, when the pack has no `kubejs/assets/`.
   */
  readKubeJsAssets?: () => Promise<Record<string, Uint8Array> | null>;
  /** Problems the source noticed (shown in the CLI's summary). */
  warnings: string[];
}

export interface ExtractOptions {
  /** Defaults to the slugified pack name. */
  slug?: string;
  /** Overrides the source's display version. */
  displayVersion?: string;
  /** Vanilla models and textures for appearances (`vanillaDescriptorSources`). */
  vanilla: DescriptorSources | null;
  /**
   * A server's block list (`readBlockList`): the pack data's blocks become
   * exactly its modded ids (`applyBlockList`).
   */
  blockList?: BlockList;
  /**
   * The vanilla block ids of the pack's Minecraft version, to check the
   * block list's `minecraft:` ids against. Not checked when absent.
   */
  vanillaBlockIds?: Iterable<string>;
  now?: () => Date;
  /** Called after each mod, for progress output. */
  onMod?: (mod: ModpackMod, index: number, total: number) => void;
}

export interface ModpackExtraction {
  data: ModpackData;
  /** Mod-file key → `swatches.png` bytes, for mods with any swatch. */
  swatches: Map<string, Uint8Array>;
  /** Every nested jar of the pack's jars: read (`kept`) or skipped, and why. */
  nestedJars: NestedJarDecision[];
  /** The `compat_packs/<modid>/` resource packs read, per mod. */
  compatPacks: { mod: string; modId: string; blocks: number }[];
  /** Compat blocks left out because the pack lacks their mod, per prefix. */
  droppedCompatBlocks: DroppedCompatBlocks[];
  /** What the block list changed, when one was given. */
  blockList?: {
    /** Ids on the list. */
    listed: number;
    /** Pack blocks the list doesn't name, per namespace, largest first. */
    dropped: { namespace: string; count: number }[];
    /** Listed modded ids added without a look. */
    added: number;
  };
  /**
   * Keys of the per-upload swatch sheets (`pack-<hash of the PNG>`): the
   * looks that use another jar's assets or `kubejs/assets`.
   */
  packSheets: string[];
  /** What other jars' models and textures gave the pack's blocks. */
  crossJar: {
    /** Blocks described again that got a look. */
    looks: number;
    /** Blocks described again with another jar's assets. */
    redescribed: number;
    /** Jars re-read for their models and textures. */
    jarsRead: number;
    /** Model and texture ids still missing, per namespace, largest first. */
    unresolved: { count: number; namespaces: NamespaceCount[] };
  };
  /** What the pack's `kubejs/assets/` changed, when it has one. */
  kubejs?: {
    /** Pack blocks whose look or states it changed. */
    overridden: number;
    /** Listed blocks added from it (with a block list). */
    added: number;
    /** Its blockstates of ids no jar has, left out (without a block list). */
    ignored: number;
  };
  warnings: string[];
}

export interface NamespaceCount {
  namespace: string;
  count: number;
}

/**
 * Mods that register blocks at runtime, by an asset namespace they ship or
 * their jar's file name. Their blocks can't be in the pack data.
 */
const RUNTIME_BLOCK_PROVIDERS: readonly {
  name: string;
  namespaces: readonly string[];
  fileName: RegExp;
}[] = [
  { name: "Every Compat", namespaces: ["everycomp"], fileName: /every.?comp/i },
  {
    name: "Unlimited Chisel Works",
    namespaces: ["unlimitedchiselworks"],
    fileName: /unlimited.?chisel.?works/i,
  },
];

const CAMO_BLOCKS: ReadonlySet<string> = new Set(CAMO_BLOCK_IDS);
const DOUBLE_CAMO_BLOCKS: ReadonlySet<string> = new Set(DOUBLE_CAMO_BLOCK_IDS);

/** `All the Mods 10` → `all-the-mods-10`. */
export function slugifyModpackName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug === "" ? "modpack" : slug;
}

/**
 * The Blob path segment of a pack version: `cf-<pack file id>` when the pack
 * file is known, else `v-<display version>` (so re-uploading a version
 * replaces it).
 */
export function modpackVersionKey(
  packFileId: number | null,
  displayVersion: string,
): string {
  if (packFileId !== null) return `cf-${packFileId}`;
  const key = `v-${displayVersion.replace(/[^A-Za-z0-9._-]+/g, "-")}`.slice(
    0,
    128,
  );
  if (!BLOB_KEY_PATTERN.test(key)) {
    throw new Error(`Can't make a storage key of version "${displayVersion}".`);
  }
  return key;
}

/** SHA-256 of `bytes`, in hex. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mod-file key: `cf-<file id>`, or `sha256-<hex>` of the jar. */
async function modFileKey(
  source: ModpackModSource,
  bytes: Uint8Array | null,
): Promise<string | null> {
  if (source.curseForgeFileId !== null) return `cf-${source.curseForgeFileId}`;
  if (bytes === null) return null;
  return `sha256-${await sha256Hex(bytes)}`;
}

/** Default property values: the first variant's, else each first value. */
function defaultProperties(
  blockstate: unknown,
  properties: Readonly<Record<string, readonly string[]>>,
): Record<string, string> {
  const defaults: Record<string, string> = {};
  const variants =
    typeof blockstate === "object" && blockstate !== null
      ? (blockstate as { variants?: unknown }).variants
      : undefined;
  if (typeof variants === "object" && variants !== null) {
    const first = Object.keys(variants)[0] ?? "";
    for (const pair of first.split(",")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (properties[name]?.includes(value)) defaults[name] = value;
    }
  }
  for (const [name, values] of Object.entries(properties)) {
    if (!Object.hasOwn(defaults, name) && values.length > 0) {
      defaults[name] = values[0];
    }
  }
  return defaults;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface ExtractedMod {
  mod: ModpackMod;
  blocks: ModpackBlock[];
  swatches: Uint8Array | null;
  /** Asset namespaces, for spotting runtime-block providers. */
  namespaces: string[];
  /** FramedBlocks geometry templates the jar ships. */
  templates?: ModpackData["framedTemplates"];
  /** Compat packs read: mod id → their block count. */
  compatPacks?: Record<string, number>;
  droppedCompatBlocks?: DroppedCompatBlocks[];
  /** Lang names no block of the jar uses (`ParsedModAssets.langBlockNames`). */
  langBlockNames?: Record<string, string>;
  /** Blocks of `blocks` `kubejs/assets` changed, and their swatch faces. */
  kubejs?: {
    blocks: ReadonlySet<ModpackBlock>;
    faces: ReadonlyMap<string, SwatchBlock["faces"]>;
  };
  /** Blocks whose models or textures the jar lacks (`crossJarPending`). */
  crossJar?: CrossJarPending;
}

/**
 * A jar's blocks whose models or textures it doesn't ship, as described
 * (`kubejs/assets` applied), with the jar's own assets they reach.
 */
interface CrossJarPending {
  blocks: ModBlock[];
  assets: DescribeAssets;
}

type JarBlockAssets = Pick<
  ParsedModAssets,
  "blocks" | "blockstates" | "models" | "textures" | "textureMeta"
>;

/**
 * The jar's assets with its `compat_packs/<modid>/` packs enabled for the
 * mod ids in `modIds` layered on top, as the game enables them.
 */
function withCompatPacks(
  parsed: ParsedModAssets,
  modIds: ReadonlySet<string>,
): JarBlockAssets & { namespaces: string[]; read: Record<string, number> } {
  const blocks = new Map(parsed.blocks.map((block) => [block.id, block]));
  const merged = {
    blockstates: { ...parsed.blockstates },
    models: { ...parsed.models },
    textures: { ...parsed.textures },
    textureMeta: { ...parsed.textureMeta },
  };
  const namespaces = new Set(parsed.namespaces);
  const read: Record<string, number> = {};
  for (const [modId, pack] of Object.entries(parsed.compatPacks)) {
    if (!modIds.has(modId)) continue;
    read[modId] = pack.blocks.length;
    for (const block of pack.blocks) blocks.set(block.id, block);
    Object.assign(merged.blockstates, pack.blockstates);
    Object.assign(merged.models, pack.models);
    Object.assign(merged.textures, pack.textures);
    Object.assign(merged.textureMeta, pack.textureMeta);
    for (const ns of pack.namespaces) namespaces.add(ns);
  }
  return {
    ...merged,
    blocks: [...blocks.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    namespaces: [...namespaces].sort(),
    read,
  };
}

// A model drawing a frame texture on every side (no elements: its texture
// variables are drawn on every face).
const FRAME_MODEL = "schematiclab:block/camo_frame";

/**
 * Descriptors of the jar's camo frames that its own models give no look
 * (their blockstates point at a placeholder model), from the frame texture
 * an empty slot shows, when the jar ships it. Copycats+ frames show Create's
 * texture; `withCamoFrameLooks` gives those theirs when the pack is read.
 */
function describeBareCamoFrames(
  parsed: JarBlockAssets,
  described: Readonly<Record<string, unknown>>,
): Record<string, BlockDescriptor> {
  const blockstates: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  for (const { id } of parsed.blocks) {
    if (!CAMO_BLOCKS.has(id) || Object.hasOwn(described, id)) continue;
    const texture = camoFrameTexture(id);
    if (!Object.hasOwn(parsed.textures, texture)) continue;
    const model = `${FRAME_MODEL}/${texture.replace(/[:/]/g, "_")}`;
    models[model] = { textures: { particle: texture } };
    blockstates[id] = { variants: { "": { model } } };
  }
  if (Object.keys(blockstates).length === 0) return {};
  return describeModBlocks(
    {
      blockIds: Object.keys(blockstates),
      blockstates,
      models,
      textures: parsed.textures,
      textureMeta: parsed.textureMeta,
    },
    null,
  );
}

type DescribeAssets = Pick<
  JarBlockAssets,
  "blockstates" | "models" | "textures" | "textureMeta"
>;

/**
 * Pack blocks of `modBlocks` (no `swatch`), owned by mod `key`, with their
 * descriptors: properties completed, kind and look from `assets`.
 */
function describeBlocks(
  modBlocks: readonly ModBlock[],
  assets: DescribeAssets,
  vanilla: DescriptorSources | null,
  key: string,
  extraDescriptors?: (
    described: Readonly<Record<string, BlockDescriptor>>,
  ) => Record<string, BlockDescriptor>,
): { blocks: ModpackBlock[]; descriptors: Record<string, BlockDescriptor> } {
  // 1.12 assets read the way the preview draws them, for classification.
  const modern = modernizeLegacyModAssets(
    { blockstates: assets.blockstates, models: assets.models },
    (id) => vanilla?.getModel(id) !== undefined,
  );
  const descriptors = describeModBlocks(
    {
      blockIds: modBlocks.map((block) => block.id),
      blockstates: assets.blockstates,
      models: assets.models,
      textures: assets.textures,
      textureMeta: assets.textureMeta,
    },
    vanilla,
  );
  if (extraDescriptors !== undefined) {
    Object.assign(descriptors, extraDescriptors(descriptors));
  }
  const blocks = modBlocks.map((block): ModpackBlock => {
    const properties = completeBlockProperties(block.properties);
    const blockstate = modern.blockstates[block.id];
    const { kind, full_cube } = classifyModBlock({
      id: block.id,
      properties,
      blockstate,
      models: modern.models,
    });
    const descriptor = descriptors[block.id];
    const out: ModpackBlock = {
      id: block.id,
      mod: key,
      displayName: block.displayName,
      properties,
      defaults: defaultProperties(blockstate, properties),
      kind,
      fullCube: full_cube,
    };
    if (descriptor !== undefined) {
      out.appearance = appearanceRecord(descriptor);
    }
    if (CAMO_BLOCKS.has(block.id)) {
      out.camo = { slots: DOUBLE_CAMO_BLOCKS.has(block.id) ? 2 : 1 };
    }
    return out;
  });
  return { blocks, descriptors };
}

/** The pack's `kubejs/assets/` resource pack, parsed. */
type KubeJsPack = ResourcePackAssets;

/**
 * Swatch sheet key of the looks that depend on more than one jar (another
 * jar's assets, `kubejs/assets`): `pack-<first 16 hex of the sheet PNG's
 * SHA-256>`. Which blocks the sheet holds depends on the whole pack and the
 * block list, so it is keyed by its content: a sheet already stored under
 * the key is the same sheet.
 */
async function packSheetKey(png: Uint8Array): Promise<string> {
  return `pack-${(await sha256Hex(png)).slice(0, 16)}`;
}

/** Reads and parses the source's `kubejs/assets/`; null without one. */
async function readKubeJsPack(
  source: ModpackSource,
  warnings: string[],
): Promise<KubeJsPack | null> {
  if (source.readKubeJsAssets === undefined) return null;
  let files: Record<string, Uint8Array> | null;
  try {
    files = await source.readKubeJsAssets();
  } catch (err) {
    warnings.push(`kubejs/assets wasn't read: ${errorMessage(err)}`);
    return null;
  }
  if (files === null) return null;
  const pack = parseResourcePack(files);
  for (const warning of pack.warnings) warnings.push(`kubejs/: ${warning}`);
  return pack;
}

/** A block's name from the `kubejs/assets` lang file, else `fallback`. */
function kubeJsName(id: string, kubejs: KubeJsPack, fallback: string): string {
  return Object.hasOwn(kubejs.lang, langBlockKey(id))
    ? displayNameFor(id, kubejs.lang)
    : fallback;
}

/**
 * The jar's blocks `kubejs/assets` changes, redescribed over it: blocks it
 * has a blockstate for (which replaces the jar's), and blocks whose models
 * or textures it replaces. Its models and textures sit over the jar's.
 */
function overrideWithKubeJs(
  parsed: JarBlockAssets,
  kubejs: KubeJsPack,
  vanilla: DescriptorSources | null,
  key: string,
): {
  blocks: ModpackBlock[];
  faces: Map<string, SwatchBlock["faces"]>;
  changed: ModBlock[];
} {
  const merged: DescribeAssets = {
    blockstates: { ...parsed.blockstates },
    models: { ...parsed.models, ...kubejs.models },
    textures: { ...parsed.textures, ...kubejs.textures },
    textureMeta: { ...parsed.textureMeta, ...kubejs.textureMeta },
  };
  const changed: ModBlock[] = [];
  for (const block of parsed.blocks) {
    if (Object.hasOwn(kubejs.blockstates, block.id)) {
      const blockstate = kubejs.blockstates[block.id];
      merged.blockstates[block.id] = blockstate;
      changed.push({
        id: block.id,
        displayName: kubeJsName(block.id, kubejs, block.displayName),
        properties: extractProperties(blockstate),
      });
      continue;
    }
    const refs = blockstateAssetRefs(
      parsed.blockstates[block.id],
      merged.models,
    );
    if (
      [...refs.models].some((id) => Object.hasOwn(kubejs.models, id)) ||
      [...refs.textures].some((id) => Object.hasOwn(kubejs.textures, id))
    ) {
      changed.push({
        ...block,
        displayName: kubeJsName(block.id, kubejs, block.displayName),
      });
    }
  }
  if (changed.length === 0) return { blocks: [], faces: new Map(), changed };
  const { blocks, descriptors } = describeBlocks(changed, merged, vanilla, key);
  return {
    blocks,
    faces: new Map(Object.entries(descriptors).map(([id, d]) => [id, d.faces])),
    changed,
  };
}

/**
 * The jar's blocks (`kubejs/assets` applied) whose blockstate reaches a
 * model or texture neither the jar nor `kubejs/assets` has, with the jar's
 * own assets they reach. Camo frames are left out: their looks come from
 * their frame textures. Null when there are none.
 */
function crossJarPending(
  parsed: JarBlockAssets,
  kubejs: KubeJsPack | null,
  kubejsChanged: readonly ModBlock[],
): CrossJarPending | null {
  const changed = new Map(kubejsChanged.map((block) => [block.id, block]));
  const kubeModels = kubejs?.models ?? {};
  const kubeTextures = kubejs?.textures ?? {};
  const getModel = (id: string): unknown =>
    Object.hasOwn(kubeModels, id)
      ? kubeModels[id]
      : Object.hasOwn(parsed.models, id)
        ? parsed.models[id]
        : undefined;
  const hasTexture = (id: string): boolean =>
    Object.hasOwn(kubeTextures, id) || Object.hasOwn(parsed.textures, id);
  const blocks: ModBlock[] = [];
  const assets: DescribeAssets = {
    blockstates: {},
    models: {},
    textures: {},
    textureMeta: {},
  };
  for (const block of parsed.blocks) {
    if (CAMO_BLOCKS.has(block.id)) continue;
    const blockstate =
      kubejs !== null && Object.hasOwn(kubejs.blockstates, block.id)
        ? kubejs.blockstates[block.id]
        : parsed.blockstates[block.id];
    const missing = missingAssetRefs(blockstate, getModel, hasTexture);
    if (missing.models.size + missing.textures.size === 0) continue;
    const refs = blockstateAssetRefs(blockstate, getModel);
    blocks.push(changed.get(block.id) ?? block);
    assets.blockstates[block.id] = blockstate;
    for (const id of refs.models) {
      if (Object.hasOwn(parsed.models, id)) {
        assets.models[id] = parsed.models[id];
      }
    }
    for (const id of refs.textures) {
      if (!Object.hasOwn(parsed.textures, id)) continue;
      assets.textures[id] = parsed.textures[id];
      if (Object.hasOwn(parsed.textureMeta, id)) {
        assets.textureMeta[id] = parsed.textureMeta[id];
      }
    }
  }
  return blocks.length === 0 ? null : { blocks, assets };
}

async function extractMod(
  source: ModpackModSource,
  vanilla: DescriptorSources | null,
  skippedNestedJars: ReadonlySet<string>,
  packModIds: ReadonlySet<string>,
  kubejs: KubeJsPack | null,
): Promise<ExtractedMod> {
  const base = {
    name: source.name,
    curseForgeProjectId: source.curseForgeProjectId,
    curseForgeFileId: source.curseForgeFileId,
    fileName: source.fileName,
    namespaces: [] as string[],
    hasSwatches: false,
  };
  const ended = (
    key: string,
    status: ModStatus,
    message?: string,
  ): ExtractedMod => ({
    mod: { key, ...base, status, ...(message ? { message } : {}) },
    blocks: [],
    swatches: null,
    namespaces: [],
  });
  // A mod without CurseForge ids is keyed by its bytes; one that can't be
  // read gets a key from its name so it is still listed.
  const fallbackKey = (): string =>
    `missing-${(source.fileName ?? source.name).replace(/[^A-Za-z0-9._-]+/g, "-")}`.slice(
      0,
      128,
    );

  if (source.read === null) {
    return ended(
      (await modFileKey(source, null)) ?? fallbackKey(),
      source.missingStatus ?? "failed",
      source.missingMessage ?? "The jar isn't available.",
    );
  }
  if (source.size !== null && source.size > MAX_MOD_JAR_BYTES) {
    return ended(
      (await modFileKey(source, null)) ?? fallbackKey(),
      "skipped-too-large",
      `The jar is ${Math.round(source.size / (1024 * 1024))} MB, over the ${MAX_MOD_JAR_BYTES / (1024 * 1024)} MB limit.`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await source.read();
  } catch (err) {
    return ended(
      (await modFileKey(source, null)) ?? fallbackKey(),
      "failed",
      `Couldn't read the jar: ${errorMessage(err)}`,
    );
  }
  const key = (await modFileKey(source, bytes)) as string;

  let jar: ParsedModAssets;
  try {
    jar = parseModJar(bytes, null, {
      skipNestedJar: (path) => skippedNestedJars.has(path),
    });
  } catch (err) {
    const message = errorMessage(err);
    return /too large/i.test(message)
      ? ended(key, "skipped-too-large", message)
      : ended(key, "failed", message);
  }
  const withPacks = withCompatPacks(jar, packModIds);
  const { kept, dropped } = dropAbsentModCompatBlocks(
    withPacks.blocks,
    packModIds,
  );
  const parsed = { ...withPacks, blocks: kept };
  const compat = {
    ...(jar.langBlockNames !== undefined && {
      langBlockNames: jar.langBlockNames,
    }),
    ...(Object.keys(withPacks.read).length > 0 && {
      compatPacks: withPacks.read,
    }),
    ...(dropped.length > 0 && { droppedCompatBlocks: dropped }),
  };
  base.namespaces = parsed.namespaces;
  if (parsed.blocks.length === 0) {
    return {
      ...ended(key, "no-blocks"),
      namespaces: parsed.namespaces,
      ...compat,
    };
  }

  try {
    // The jar's own sheet is shared between packs, so it never shows
    // `kubejs/assets` looks; blocks those change get their own swatches.
    const { blocks, descriptors } = describeBlocks(
      parsed.blocks,
      parsed,
      vanilla,
      key,
      (described) => describeBareCamoFrames(parsed, described),
    );
    const sheet = packSwatches(
      Object.entries(descriptors).map(([id, d]) => ({ id, faces: d.faces })),
    );
    for (const block of blocks) {
      const faces = sheet?.uvs[block.id];
      if (faces !== undefined && Object.keys(faces).length > 0) {
        block.swatch = { file: key, faces };
      }
    }
    const overrides =
      kubejs === null ? null : overrideWithKubeJs(parsed, kubejs, vanilla, key);
    // Refs the jar (and its enabled compat packs) leave unresolved, or
    // `kubejs/assets` may add: those blocks may get their look from
    // another jar of the pack.
    const unresolved = [
      jar.unresolvedRefs,
      ...Object.keys(withPacks.read).map(
        (modId) => jar.compatPacks[modId].unresolvedRefs,
      ),
    ].some(
      (refs) =>
        refs !== undefined && refs.models.length + refs.textures.length > 0,
    );
    const crossJar =
      unresolved || kubejs !== null
        ? crossJarPending(parsed, kubejs, overrides?.changed ?? [])
        : null;
    if (overrides !== null && overrides.blocks.length > 0) {
      const byId = new Map(overrides.blocks.map((b) => [b.id, b]));
      for (const [i, block] of blocks.entries()) {
        const override = byId.get(block.id);
        if (override !== undefined) blocks[i] = override;
      }
    }
    return {
      mod: { key, ...base, status: "ok", hasSwatches: sheet !== null },
      blocks,
      swatches: sheet?.png ?? null,
      namespaces: parsed.namespaces,
      templates: jar.templates,
      ...(overrides !== null &&
        overrides.blocks.length > 0 && {
          kubejs: { blocks: new Set(overrides.blocks), faces: overrides.faces },
        }),
      ...(crossJar !== null && { crossJar }),
      ...compat,
    };
  } catch (err) {
    return {
      ...ended(key, "failed", errorMessage(err)),
      namespaces: parsed.namespaces,
      ...(compat.langBlockNames !== undefined && {
        langBlockNames: compat.langBlockNames,
      }),
    };
  }
}

/** Whether `extractMod` would read the jar. */
function readable(
  source: ModpackModSource,
): source is ModpackModSource & { read: () => Promise<Uint8Array> } {
  return (
    source.read !== null &&
    (source.size === null || source.size <= MAX_MOD_JAR_BYTES)
  );
}

/** Which jar of the pack ships each model and texture id. */
interface PackAssetIndex {
  /** Per jar (by index in the pack), the ids it ships; null when unread. */
  jars: ({ models: Set<string>; textures: Set<string> } | null)[];
  /** `model:<id>` / `texture:<id>` → the jar providing it. */
  providers: Map<string, number>;
}

/**
 * Reads each jar's mod ids, nested jars and asset ids (not their assets)
 * and decides which copy of each nested mod is read, as NeoForge loads one.
 * Indexes the model and texture ids of the jars, their kept nested jars and
 * their enabled compat packs: of several jars shipping an id, the first
 * whose mod ids or block namespaces (of its blockstates) include its
 * namespace provides it, else the first in pack order.
 */
async function chooseModpackNestedJars(
  mods: readonly ModpackModSource[],
): Promise<{
  decisions: NestedJarDecision[];
  modIds: Set<string>;
  assets: PackAssetIndex;
}> {
  const owners: NestedJarOwner[] = [];
  const indexes: (ModJarIndex | null)[] = [];
  for (const source of mods) {
    let index: ModJarIndex | null = null;
    if (readable(source)) {
      try {
        index = readModJarIndex(await source.read());
      } catch {
        // `extractMod` reports the unreadable jar.
      }
    }
    owners.push({ outer: source.fileName ?? source.name, index });
    indexes.push(index);
  }
  const decisions = chooseNestedJars(owners);
  // The mods the pack loads: its jars' and the nested copies read.
  const modIds = new Set(owners.flatMap((owner) => owner.index?.modIds ?? []));
  for (const jar of decisions) {
    if (jar.kept) for (const id of jar.modIds) modIds.add(id);
  }

  const assets: PackAssetIndex = { jars: [], providers: new Map() };
  const namespacesOf: Set<string>[] = [];
  for (const [i, index] of indexes.entries()) {
    namespacesOf.push(new Set());
    if (index === null) {
      assets.jars.push(null);
      continue;
    }
    const kept = new Set(
      decisions
        .filter((jar) => jar.owner === i && jar.kept)
        .map((jar) => jar.path),
    );
    const nested = index.nestedJars.filter((jar) => kept.has(jar.path));
    const namespaces = namespacesOf[i];
    for (const id of index.modIds) namespaces.add(id);
    const ids = { models: new Set<string>(), textures: new Set<string>() };
    for (const layer of [index.assets, ...nested.map((jar) => jar.assets)]) {
      for (const ns of layer.blockNamespaces) namespaces.add(ns);
      const packs = Object.entries(layer.compatPacks)
        .filter(([modId]) => modIds.has(modId))
        .map(([, pack]) => pack);
      for (const part of [layer, ...packs]) {
        for (const id of part.models) ids.models.add(id);
        for (const id of part.textures) ids.textures.add(id);
      }
    }
    for (const jar of nested) {
      for (const id of jar.modIds) namespaces.add(id);
    }
    assets.jars.push(ids);
    const owns = (jar: number, id: string) =>
      namespacesOf[jar].has(id.slice(0, id.indexOf(":")));
    for (const kind of ["model", "texture"] as const) {
      for (const id of kind === "model" ? ids.models : ids.textures) {
        const ref = `${kind}:${id}`;
        const current = assets.providers.get(ref);
        if (current === undefined || (!owns(current, id) && owns(i, id))) {
          assets.providers.set(ref, i);
        }
      }
    }
  }
  return { decisions, modIds, assets };
}

/** Most rounds of re-reading jars for models and textures other jars need. */
export const MAX_CROSS_JAR_ROUNDS = 8;

/** A jar's blocks whose models or textures are in other jars. */
interface CrossJarRequester extends CrossJarPending {
  /** Index of the jar in the pack. */
  jar: number;
  /** Its mod-file key. */
  key: string;
}

/** Assets read from one jar for other jars' blocks. */
interface FetchedAssets {
  models: Record<string, unknown>;
  textures: Record<string, Uint8Array>;
  textureMeta: Record<string, unknown>;
  /** `model:<id>` / `texture:<id>` refs already asked of it. */
  asked: Set<string>;
}

/** `model:ns:path` → `["model", "ns:path"]`. */
function splitRef(ref: string): ["model" | "texture", string] {
  const colon = ref.indexOf(":");
  return [ref.slice(0, colon) as "model" | "texture", ref.slice(colon + 1)];
}

/**
 * Finds the models and textures `requesters`' blocks reach but their jars
 * lack in the pack's other jars (`assets`), reading each providing jar once
 * per round for just those entries (`readJarAssets`), and the models those
 * reach in turn, for up to `MAX_CROSS_JAR_ROUNDS` rounds. A jar's own copy
 * of an id wins over another jar's, and `kubejs/assets` over all jars.
 * Every block that reaches a model or texture so found is described again
 * from its jar's assets, the found ones, then vanilla.
 */
async function resolveCrossJarLooks(
  requesters: readonly CrossJarRequester[],
  assets: PackAssetIndex,
  mods: readonly ModpackModSource[],
  readOptions: (jar: number) => ReadJarAssetsOptions,
  kubejs: KubeJsPack | null,
  vanilla: DescriptorSources | null,
  warnings: string[],
): Promise<{
  described: {
    blocks: ModpackBlock[];
    descriptors: Record<string, BlockDescriptor>;
  }[];
  jarsRead: number;
  unresolved: string[];
}> {
  const fetched = new Map<number, FetchedAssets>();
  const resolution = requesters.map(() => new Map<string, number>());
  const jarsRead = new Set<number>();

  // Asset lookups of requester `r`: `kubejs/assets`, its jar, other jars.
  type Field = "models" | "textures" | "textureMeta";
  const lookup = (r: number) => {
    const own = requesters[r].assets;
    const layered = (field: Field, kind: "model" | "texture") => {
      const kube: Readonly<Record<string, unknown>> = kubejs?.[field] ?? {};
      const mine: Readonly<Record<string, unknown>> = own[field];
      return (id: string): unknown => {
        if (Object.hasOwn(kube, id)) return kube[id];
        if (Object.hasOwn(mine, id)) return mine[id];
        const provider = resolution[r].get(`${kind}:${id}`);
        const from = provider === undefined ? undefined : fetched.get(provider);
        const theirs: Readonly<Record<string, unknown>> = from?.[field] ?? {};
        return Object.hasOwn(theirs, id) ? theirs[id] : undefined;
      };
    };
    const texture = layered("textures", "texture");
    return {
      model: layered("models", "model"),
      texture: (id: string) => texture(id) as Uint8Array | undefined,
      textureMeta: layered("textureMeta", "texture"),
      local: (field: "models" | "textures", id: string) =>
        Object.hasOwn(kubejs?.[field] ?? {}, id) ||
        Object.hasOwn(own[field], id),
    };
  };

  // The refs block `id` of requester `r` reaches that nothing provides yet.
  const reach = (r: number, id: string) => {
    const look = lookup(r);
    return blockstateAssetRefs(
      requesters[r].assets.blockstates[id],
      look.model,
    );
  };
  const missing = (r: number): Set<string> => {
    const look = lookup(r);
    const out = new Set<string>();
    for (const block of requesters[r].blocks) {
      const refs = missingAssetRefs(
        requesters[r].assets.blockstates[block.id],
        look.model,
        (id) => look.texture(id) !== undefined,
      );
      for (const id of refs.models) out.add(`model:${id}`);
      for (const id of refs.textures) out.add(`texture:${id}`);
    }
    return out;
  };

  for (let round = 0; round < MAX_CROSS_JAR_ROUNDS; round++) {
    const wanted = new Map<number, Set<string>>();
    for (const [r, requester] of requesters.entries()) {
      const ownIds = assets.jars[requester.jar];
      for (const ref of missing(r)) {
        if (resolution[r].has(ref)) continue;
        const [kind, id] = splitRef(ref);
        const ships =
          kind === "model" ? ownIds?.models.has(id) : ownIds?.textures.has(id);
        const provider = ships ? requester.jar : assets.providers.get(ref);
        if (provider === undefined) continue;
        resolution[r].set(ref, provider);
        if (fetched.get(provider)?.asked.has(ref)) continue;
        const refs = wanted.get(provider) ?? new Set<string>();
        refs.add(ref);
        wanted.set(provider, refs);
      }
    }
    if (wanted.size === 0) break;
    for (const provider of [...wanted.keys()].sort((a, b) => a - b)) {
      const refs = wanted.get(provider)!;
      let into = fetched.get(provider);
      if (into === undefined) {
        into = { models: {}, textures: {}, textureMeta: {}, asked: new Set() };
        fetched.set(provider, into);
      }
      for (const ref of refs) into.asked.add(ref);
      const source = mods[provider];
      if (source.read === null) continue;
      let ids = { models: [] as string[], textures: [] as string[] };
      for (const ref of refs) {
        const [kind, id] = splitRef(ref);
        (kind === "model" ? ids.models : ids.textures).push(id);
      }
      jarsRead.add(provider);
      const ships = assets.jars[provider];
      try {
        const bytes = await source.read();
        // The parents and textures of the models read that the jar ships
        // itself are read from the same bytes, not in a later round.
        while (ids.models.length + ids.textures.length > 0) {
          const read = readJarAssets(bytes, ids, readOptions(provider));
          Object.assign(into.models, read.models);
          Object.assign(into.textures, read.textures);
          Object.assign(into.textureMeta, read.textureMeta);
          const next = { models: [] as string[], textures: [] as string[] };
          const ask = (kind: "model" | "texture", id: string) => {
            const shipped = kind === "model" ? ships?.models : ships?.textures;
            const ref = `${kind}:${id}`;
            if (shipped?.has(id) !== true || into.asked.has(ref)) return;
            into.asked.add(ref);
            (kind === "model" ? next.models : next.textures).push(id);
          };
          for (const model of Object.values(read.models)) {
            const refs = modelAssetRefs(model);
            if (refs.parent !== null) ask("model", refs.parent);
            for (const texture of refs.textures) ask("texture", texture);
          }
          ids = next;
        }
      } catch (err) {
        warnings.push(
          `${source.name} couldn't be read again for other jars' models and textures: ${errorMessage(err)}`,
        );
      }
    }
  }

  const unresolved = new Set<string>();
  const described: {
    blocks: ModpackBlock[];
    descriptors: Record<string, BlockDescriptor>;
  }[] = [];
  for (const [r, requester] of requesters.entries()) {
    for (const ref of missing(r)) unresolved.add(ref);
    if (resolution[r].size === 0) continue;
    const look = lookup(r);
    const merged: DescribeAssets = {
      blockstates: {},
      models: {},
      textures: {},
      textureMeta: {},
    };
    const redo: ModBlock[] = [];
    for (const block of requester.blocks) {
      const refs = reach(r, block.id);
      const usesFetched =
        [...refs.models].some(
          (id) => !look.local("models", id) && look.model(id) !== undefined,
        ) ||
        [...refs.textures].some(
          (id) => !look.local("textures", id) && look.texture(id) !== undefined,
        );
      if (!usesFetched) continue;
      redo.push(block);
      merged.blockstates[block.id] = requester.assets.blockstates[block.id];
      for (const id of refs.models) {
        const model = look.model(id);
        if (model !== undefined) merged.models[id] = model;
      }
      for (const id of refs.textures) {
        const png = look.texture(id);
        if (png === undefined) continue;
        merged.textures[id] = png;
        const meta = look.textureMeta(id);
        if (meta !== undefined) merged.textureMeta[id] = meta;
      }
    }
    if (redo.length === 0) continue;
    described.push(describeBlocks(redo, merged, vanilla, requester.key));
  }
  return { described, jarsRead: jarsRead.size, unresolved: [...unresolved] };
}

/** Ids per namespace, largest first (ties by name). */
function countNamespaces(ids: Iterable<string>): NamespaceCount[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const ns = id.slice(0, id.indexOf(":"));
    counts.set(ns, (counts.get(ns) ?? 0) + 1);
  }
  return [...counts]
    .map(([namespace, count]) => ({ namespace, count }))
    .sort((a, b) =>
      b.count !== a.count
        ? b.count - a.count
        : a.namespace < b.namespace
          ? -1
          : 1,
    );
}

/**
 * Extracts every mod of `source`, one at a time (only derived data is kept),
 * into the pack record and its swatch sheets. Of each mod nested in the
 * pack's jars only one copy is read (`chooseNestedJars`); its blocks belong
 * to the jar that holds it. A jar's `compat_packs/<modid>/` packs are read
 * when the pack loads `<modid>`, and compat blocks for mods it lacks
 * (`compat-blocks.ts`) are dropped. With a block list, the blocks are the
 * list's (`applyBlockList`). Throws when the pack's
 * Minecraft version, display version or slug can't be determined.
 */
export async function extractModpack(
  source: ModpackSource,
  options: ExtractOptions,
): Promise<ModpackExtraction> {
  const displayVersion = options.displayVersion ?? source.displayVersion;
  if (displayVersion === null || displayVersion.trim() === "") {
    throw new Error(
      "The pack doesn't name its version. Pass --version <display version>.",
    );
  }
  if (source.minecraftVersion === null) {
    throw new Error("The pack doesn't name its Minecraft version.");
  }
  const slug = options.slug ?? source.slug ?? slugifyModpackName(source.name);
  if (!MODPACK_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": use lower-case words joined by hyphens.`,
    );
  }
  const now = options.now ?? (() => new Date());

  const warnings = [...source.warnings];
  const mods: ModpackMod[] = [];
  const blocks = new Map<string, ModpackBlock>();
  const swatches = new Map<string, Uint8Array>();
  const runtimeBlockSources: RuntimeBlockSource[] = [];
  // Later jars win on the same template, as `mergeTemplates` does.
  const framedTemplates: NonNullable<ModpackData["framedTemplates"]> = {};
  const { blockList } = options;
  if (source.hasKubeJs) {
    runtimeBlockSources.push({
      kind: "kubejs",
      name: "kubejs",
      message:
        blockList === undefined
          ? "The pack has a kubejs/ folder: blocks its startup scripts register aren't in the pack data."
          : "The pack has a kubejs/ folder: a server block list was applied, so blocks its startup scripts register are included, with looks from kubejs/assets/ where it has them, else unknown looks.",
    });
  }
  const kubejs = await readKubeJsPack(source, warnings);
  // Blocks `kubejs/assets` changed or added.
  const kubejsBlocks = new Set<ModpackBlock>();
  // Blocks whose looks go in the per-upload sheets, and their swatch faces.
  const packLookBlocks = new Set<ModpackBlock>();
  const packLookFaces = new Map<ModpackBlock, SwatchBlock["faces"]>();
  const crossJarRequesters: CrossJarRequester[] = [];
  // `block.<ns>.<path>` → name, from every jar (the first wins).
  const langBlockNames: Record<string, string> = {};
  const {
    decisions: nestedJars,
    modIds: packModIds,
    assets: packAssets,
  } = await chooseModpackNestedJars(source.mods);
  const compatPacks: ModpackExtraction["compatPacks"] = [];
  const droppedCompatBlocks = new Map<string, DroppedCompatBlocks>();
  const skippedNestedJars = source.mods.map(() => new Set<string>());
  for (const jar of nestedJars) {
    if (!jar.kept) skippedNestedJars[jar.owner].add(jar.path);
  }
  const seenKeys = new Map<string, string>();
  const total = source.mods.length;
  for (const [index, modSource] of source.mods.entries()) {
    const result = await extractMod(
      modSource,
      options.vanilla,
      skippedNestedJars[index],
      packModIds,
      kubejs,
    );
    const { mod } = result;
    const earlier = seenKeys.get(mod.key);
    if (earlier !== undefined) {
      warnings.push(
        `${mod.name} is the same file as ${earlier}; it was listed once.`,
      );
      continue;
    }
    seenKeys.set(mod.key, mod.name);
    mods.push(mod);
    for (const [modId, count] of Object.entries(result.compatPacks ?? {})) {
      compatPacks.push({ mod: mod.name, modId, blocks: count });
    }
    for (const dropped of result.droppedCompatBlocks ?? []) {
      const dropKey = `${dropped.namespace}:${dropped.prefix}`;
      const sum = droppedCompatBlocks.get(dropKey);
      if (sum === undefined) droppedCompatBlocks.set(dropKey, { ...dropped });
      else sum.count += dropped.count;
    }
    for (const block of result.blocks) {
      // A leftover blockstate file can be named something Minecraft
      // couldn't register (`vs_clockwork:OLD_flap_bearing`).
      if (!BLOCK_ID_PATTERN.test(block.id)) {
        warnings.push(
          `${block.id} in ${mod.name} isn't a valid block id; it was left out.`,
        );
        continue;
      }
      const existing = blocks.get(block.id);
      if (existing !== undefined) {
        warnings.push(
          `${block.id} is in both ${seenKeys.get(existing.mod) ?? existing.mod} and ${mod.name}; the first was kept.`,
        );
        continue;
      }
      blocks.set(block.id, block);
      if (result.kubejs?.blocks.has(block)) {
        kubejsBlocks.add(block);
        packLookBlocks.add(block);
        const faces = result.kubejs.faces.get(block.id);
        if (faces !== undefined) packLookFaces.set(block, faces);
      }
    }
    if (result.crossJar !== undefined) {
      crossJarRequesters.push({ ...result.crossJar, jar: index, key: mod.key });
    }
    for (const [langKey, name] of Object.entries(result.langBlockNames ?? {})) {
      if (!Object.hasOwn(langBlockNames, langKey)) {
        langBlockNames[langKey] = name;
      }
    }
    if (result.swatches !== null) swatches.set(mod.key, result.swatches);
    Object.assign(framedTemplates, result.templates);
    const provider = RUNTIME_BLOCK_PROVIDERS.find(
      (p) =>
        p.namespaces.some((ns) => result.namespaces.includes(ns)) ||
        p.fileName.test(modSource.fileName ?? modSource.name),
    );
    if (
      provider !== undefined &&
      !runtimeBlockSources.some((s) => s.name === provider.name)
    ) {
      runtimeBlockSources.push({
        kind: "generated-block-provider",
        name: provider.name,
        message:
          blockList === undefined
            ? `${provider.name} registers blocks at runtime; they aren't in the pack data.`
            : `${provider.name} registers blocks at runtime; a server block list was applied, so they are included, with unknown looks.`,
      });
    }
    options.onMod?.(mod, index, total);
  }

  // Blocks whose models or textures are in other jars, described again
  // with them. Only blocks the pack keeps: not duplicates, and with a block
  // list only listed ones.
  const listed = blockList === undefined ? null : new Set(blockList.ids);
  const requesters = crossJarRequesters.flatMap((requester) => {
    const kept = requester.blocks.filter(
      (block) =>
        blocks.get(block.id)?.mod === requester.key &&
        (listed === null || listed.has(block.id)),
    );
    return kept.length === 0 ? [] : [{ ...requester, blocks: kept }];
  });
  const crossJar = await resolveCrossJarLooks(
    requesters,
    packAssets,
    source.mods,
    (jar) => ({
      skipNestedJar: (path) => skippedNestedJars[jar].has(path),
      compatPacks: packModIds,
    }),
    kubejs,
    options.vanilla,
    warnings,
  );
  let crossJarLooks = 0;
  let redescribed = 0;
  for (const { blocks: described, descriptors } of crossJar.described) {
    for (const block of described) {
      const existing = blocks.get(block.id)!;
      redescribed += 1;
      existing.properties = block.properties;
      existing.defaults = block.defaults;
      existing.kind = block.kind;
      existing.fullCube = block.fullCube;
      delete existing.swatch;
      if (block.appearance !== undefined) {
        existing.appearance = block.appearance;
        crossJarLooks += 1;
      } else {
        delete existing.appearance;
      }
      packLookBlocks.add(existing);
      const descriptor = descriptors[block.id];
      if (descriptor !== undefined)
        packLookFaces.set(existing, descriptor.faces);
      else packLookFaces.delete(existing);
    }
  }

  const modCount = mods.length;
  let packBlocks = [...blocks.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  // `kubejs/assets` blockstates of ids no jar has: only a block list says
  // whether the pack registers them.
  const kubejsOnly =
    kubejs === null
      ? []
      : Object.keys(kubejs.blockstates)
          .filter((id) => !blocks.has(id) && BLOCK_ID_PATTERN.test(id))
          .sort();
  let kubejsAdded = 0;
  let blockListResult: ModpackExtraction["blockList"];
  if (blockList !== undefined) {
    const described = new Map<string, Omit<ModpackBlock, "mod">>();
    const addedFaces = new Map<string, SwatchBlock["faces"]>();
    if (kubejs !== null) {
      const listed = new Set(blockList.ids);
      const added = describeBlocks(
        kubejsOnly
          .filter((id) => listed.has(id))
          .map((id) => ({
            id,
            displayName: displayNameFor(id, kubejs.lang),
            properties: extractProperties(kubejs.blockstates[id]),
          })),
        kubejs,
        options.vanilla,
        "",
      );
      for (const { mod: _mod, ...block } of added.blocks) {
        described.set(block.id, block);
      }
      for (const [id, d] of Object.entries(added.descriptors)) {
        addedFaces.set(id, d.faces);
      }
    }
    const applied = applyBlockList(
      packBlocks,
      mods,
      blockList,
      langBlockNames,
      described,
    );
    kubejsAdded = applied.addedDescribed;
    packBlocks = applied.blocks;
    if (applied.blockListMod !== null) mods.push(applied.blockListMod);
    blockListResult = {
      listed: blockList.ids.length,
      dropped: applied.dropped,
      added: applied.added,
    };
    for (const block of packBlocks) {
      if (described.has(block.id)) {
        kubejsBlocks.add(block);
        packLookBlocks.add(block);
        const faces = addedFaces.get(block.id);
        if (faces !== undefined) packLookFaces.set(block, faces);
      }
    }
    if (options.vanillaBlockIds !== undefined) {
      const mismatch = vanillaMismatchWarning(
        blockList,
        options.vanillaBlockIds,
        source.minecraftVersion,
      );
      if (mismatch !== null) warnings.push(mismatch);
    }
  }

  // The looks that use another jar's assets or `kubejs/assets` go in
  // per-upload sheets: the jars' own sheets are shared between packs.
  const packLooks = packBlocks.filter((block) => packLookBlocks.has(block));
  const sheets = packSwatchSheets(
    packLooks.flatMap((block) => {
      const faces = packLookFaces.get(block);
      return faces === undefined ? [] : [{ id: block.id, faces }];
    }),
  );
  const packSheets: string[] = [];
  const sheetOf = new Map<string, string>();
  const uvsOf = new Map<string, NonNullable<ModpackBlock["swatch"]>["faces"]>();
  for (const sheet of sheets) {
    const key = await packSheetKey(sheet.png);
    swatches.set(key, sheet.png);
    packSheets.push(key);
    for (const [id, faces] of Object.entries(sheet.uvs)) {
      sheetOf.set(id, key);
      uvsOf.set(id, faces);
    }
  }
  for (const block of packLooks) {
    const key = sheetOf.get(block.id);
    const faces = uvsOf.get(block.id);
    if (
      key !== undefined &&
      faces !== undefined &&
      Object.keys(faces).length > 0
    ) {
      block.swatch = { file: key, faces };
    } else {
      delete block.swatch;
    }
  }

  let kubejsResult: ModpackExtraction["kubejs"];
  if (kubejs !== null) {
    const final = packBlocks.filter((block) => kubejsBlocks.has(block));
    kubejsResult = {
      overridden: final.length - kubejsAdded,
      added: kubejsAdded,
      ignored: blockList === undefined ? kubejsOnly.length : 0,
    };
  }

  const packFileId = source.packFileId;
  const data: ModpackData = {
    formatVersion: MODPACK_FORMAT_VERSION,
    slug,
    name: source.name,
    curseForgeProjectId: source.curseForgeProjectId,
    version: {
      key: modpackVersionKey(packFileId, displayVersion),
      packFileId,
      displayVersion,
      minecraftVersion: source.minecraftVersion,
      loader: source.loader,
      modCount,
      uploadedAt: now().toISOString(),
    },
    mods,
    blocks: packBlocks,
    runtimeBlockSources,
    ...(Object.keys(framedTemplates).length > 0 && { framedTemplates }),
    ...(blockList !== undefined && {
      blockList: { blocks: blockList.ids.length, sha256: blockList.sha256 },
    }),
  };
  return {
    data,
    swatches,
    nestedJars,
    compatPacks,
    droppedCompatBlocks: [...droppedCompatBlocks.values()],
    ...(blockListResult !== undefined && { blockList: blockListResult }),
    packSheets,
    crossJar: {
      looks: crossJarLooks,
      redescribed,
      jarsRead: crossJar.jarsRead,
      unresolved: {
        count: crossJar.unresolved.length,
        namespaces: countNamespaces(
          crossJar.unresolved.map((ref) => splitRef(ref)[1]),
        ),
      },
    },
    ...(kubejsResult !== undefined && { kubejs: kubejsResult }),
    warnings,
  };
}
