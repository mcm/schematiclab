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
import { modernizeLegacyModAssets } from "../mods/generated/legacy-blockstate.ts";
import { parseModJar } from "../mods/parse-mod-jar.ts";
import { completeBlockProperties } from "../mods/property-domains.ts";
import {
  appearanceRecord,
  describeModBlocks,
  packSwatches,
  type DescriptorSources,
} from "./appearance.ts";
import { classifyModBlock } from "./classify.ts";
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
  now?: () => Date;
  /** Called after each mod, for progress output. */
  onMod?: (mod: ModpackMod, index: number, total: number) => void;
}

export interface ModpackExtraction {
  data: ModpackData;
  /** Mod-file key → `swatches.png` bytes, for mods with any swatch. */
  swatches: Map<string, Uint8Array>;
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
}

async function extractMod(
  source: ModpackModSource,
  vanilla: DescriptorSources | null,
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

  let parsed: ReturnType<typeof parseModJar>;
  try {
    parsed = parseModJar(bytes);
  } catch (err) {
    const message = errorMessage(err);
    return /too large/i.test(message)
      ? ended(key, "skipped-too-large", message)
      : ended(key, "failed", message);
  }
  base.namespaces = parsed.namespaces;
  if (parsed.blocks.length === 0) {
    return { ...ended(key, "no-blocks"), namespaces: parsed.namespaces };
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
      templates: parsed.templates,
    };
  } catch (err) {
    return {
      ...ended(key, "failed", errorMessage(err)),
      namespaces: parsed.namespaces,
    };
  }
}

/**
 * Extracts every mod of `source`, one at a time (only derived data is kept),
 * into the pack record and its swatch sheets. Throws when the pack's
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
  if (source.hasKubeJs) {
    runtimeBlockSources.push({
      kind: "kubejs",
      name: "kubejs",
      message:
        "The pack has a kubejs/ folder: blocks its startup scripts register aren't in the pack data.",
    });
  }
  const seenKeys = new Map<string, string>();
  const total = source.mods.length;
  for (const [index, modSource] of source.mods.entries()) {
    const result = await extractMod(modSource, options.vanilla);
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
        message: `${provider.name} registers blocks at runtime; they aren't in the pack data.`,
      });
    }
    options.onMod?.(mod, index, total);
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
      modCount: mods.length,
      uploadedAt: now().toISOString(),
    },
    mods,
    blocks: [...blocks.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    runtimeBlockSources,
    ...(Object.keys(framedTemplates).length > 0 && { framedTemplates }),
  };
  return { data, swatches, warnings };
}
