// The extraction core of the modpack upload CLI (`pnpm modpack:upload`):
// turns a pack's mod jars into one `pack.json.gz` record and a swatch sheet
// per mod file. Each jar goes through the browser's jar parser
// (`parseModJar`), then `classifyModBlock`, the appearance descriptors and
// `packSwatches`; properties are completed with `completeBlockProperties`.
// Only derived data comes out: no textures, models or jars.
//
// Where the jars come from (an instance folder, CurseForge) is the caller's
// business: it hands over a `ModpackSource` whose mods read their own bytes.
// Every mod ends with a status, so the pack record accounts for all of them.
//
// Pure apart from `crypto.subtle` (hashing jars without CurseForge ids).
// Imports carry their `.ts` extension so node's strip-types can load it.

import {
  CAMO_BLOCK_IDS,
  DOUBLE_CAMO_BLOCK_IDS,
} from "../camo/camo-blocks.generated.ts";
import { camoFrameTexture } from "../camo/frame-textures.ts";
import { modernizeLegacyModAssets } from "../mods/generated/legacy-blockstate.ts";
import { parseModJar, readModJarIndex } from "../mods/parse-mod-jar.ts";
import type { ParsedModAssets } from "../mods/types.ts";
import { completeBlockProperties } from "../mods/property-domains.ts";
import {
  appearanceRecord,
  describeModBlocks,
  packSwatches,
  type BlockDescriptor,
  type DescriptorSources,
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
  warnings: string[];
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

/** Mod-file key: `cf-<file id>`, or `sha256-<hex>` of the jar. */
async function modFileKey(
  source: ModpackModSource,
  bytes: Uint8Array | null,
): Promise<string | null> {
  if (source.curseForgeFileId !== null) return `cf-${source.curseForgeFileId}`;
  if (bytes === null) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
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

async function extractMod(
  source: ModpackModSource,
  vanilla: DescriptorSources | null,
  skippedNestedJars: ReadonlySet<string>,
  packModIds: ReadonlySet<string>,
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
    // 1.12 assets read the way the preview draws them, for classification.
    const modern = modernizeLegacyModAssets(
      { blockstates: parsed.blockstates, models: parsed.models },
      (id) => vanilla?.getModel(id) !== undefined,
    );
    const descriptors = describeModBlocks(
      {
        blockIds: parsed.blocks.map((block) => block.id),
        blockstates: parsed.blockstates,
        models: parsed.models,
        textures: parsed.textures,
        textureMeta: parsed.textureMeta,
      },
      vanilla,
    );
    Object.assign(descriptors, describeBareCamoFrames(parsed, descriptors));
    const sheet = packSwatches(
      Object.entries(descriptors).map(([id, d]) => ({ id, faces: d.faces })),
    );
    const blocks = parsed.blocks.map((block): ModpackBlock => {
      const properties = completeBlockProperties(block.properties);
      const blockstate = modern.blockstates[block.id];
      const { kind, full_cube } = classifyModBlock({
        id: block.id,
        properties,
        blockstate,
        models: modern.models,
      });
      const descriptor = descriptors[block.id];
      const faces = sheet?.uvs[block.id];
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
      if (faces !== undefined && Object.keys(faces).length > 0) {
        out.swatch = { file: key, faces };
      }
      if (CAMO_BLOCKS.has(block.id)) {
        out.camo = { slots: DOUBLE_CAMO_BLOCKS.has(block.id) ? 2 : 1 };
      }
      return out;
    });
    return {
      mod: { key, ...base, status: "ok", hasSwatches: sheet !== null },
      blocks,
      swatches: sheet?.png ?? null,
      namespaces: parsed.namespaces,
      templates: jar.templates,
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

/**
 * Reads each jar's mod ids and nested jars (not their assets) and decides
 * which copy of each nested mod is read, as NeoForge loads one.
 */
async function chooseModpackNestedJars(
  mods: readonly ModpackModSource[],
): Promise<{ decisions: NestedJarDecision[]; modIds: Set<string> }> {
  const owners: NestedJarOwner[] = [];
  for (const source of mods) {
    let index: NestedJarOwner["index"] = null;
    if (readable(source)) {
      try {
        index = readModJarIndex(await source.read());
      } catch {
        // `extractMod` reports the unreadable jar.
      }
    }
    owners.push({ outer: source.fileName ?? source.name, index });
  }
  const decisions = chooseNestedJars(owners);
  // The mods the pack loads: its jars' and the nested copies read.
  const modIds = new Set(owners.flatMap((owner) => owner.index?.modIds ?? []));
  for (const jar of decisions) {
    if (jar.kept) for (const id of jar.modIds) modIds.add(id);
  }
  return { decisions, modIds };
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
          : "The pack has a kubejs/ folder: a server block list was applied, so blocks its startup scripts register are included, with unknown looks.",
    });
  }
  // `block.<ns>.<path>` → name, from every jar (the first wins).
  const langBlockNames: Record<string, string> = {};
  const { decisions: nestedJars, modIds: packModIds } =
    await chooseModpackNestedJars(source.mods);
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

  const modCount = mods.length;
  let packBlocks = [...blocks.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  let blockListResult: ModpackExtraction["blockList"];
  if (blockList !== undefined) {
    const applied = applyBlockList(packBlocks, mods, blockList, langBlockNames);
    packBlocks = applied.blocks;
    if (applied.blockListMod !== null) mods.push(applied.blockListMod);
    blockListResult = {
      listed: blockList.ids.length,
      dropped: applied.dropped,
      added: applied.added,
    };
    if (options.vanillaBlockIds !== undefined) {
      const mismatch = vanillaMismatchWarning(
        blockList,
        options.vanillaBlockIds,
        source.minecraftVersion,
      );
      if (mismatch !== null) warnings.push(mismatch);
    }
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
    warnings,
  };
}
