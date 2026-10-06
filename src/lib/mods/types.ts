// Shared types for loaded CurseForge mods.
//
// Plain data only — every type here must survive structured cloning so it can
// cross the mod-jar worker boundary and be persisted to IndexedDB.

import type { BlockAppearance } from "../render/block-appearance";
import type { TemplateCube } from "../render/camo/shape-pack";

/** A single block contributed by a mod (one per blockstates file). */
export interface ModBlock {
  /** Namespaced block id, e.g. `create:andesite_casing`. */
  id: string;
  /** English display name from `lang/en_us.json`, else the title-cased path. */
  displayName: string;
  /** Property name → sorted list of known values. Empty for stateless blocks. */
  properties: Record<string, string[]>;
  /**
   * Average colour and full-cube flag of the default-state model. Absent when
   * its textures can't be resolved, and on files loaded before appearances
   * existed until `ensureModAppearances` backfills them.
   */
  appearance?: BlockAppearance;
}

/** Structured output of parsing a mod jar's client assets. */
export interface ParsedModAssets {
  /** Non-`minecraft` asset namespaces present in the jar, sorted. */
  namespaces: string[];
  /** Blocks sorted by id. */
  blocks: ModBlock[];
  /** Block id → raw blockstate JSON. */
  blockstates: Record<string, unknown>;
  /** `<ns>:<path>` (e.g. `create:block/andesite_casing`) → raw model JSON. */
  models: Record<string, unknown>;
  /** `<ns>:<path>` without `.png` (e.g. `create:block/andesite_casing`) → PNG bytes. */
  textures: Record<string, Uint8Array>;
  /** Same keys as `textures` → parsed `.png.mcmeta` JSON, where present. */
  textureMeta: Record<string, unknown>;
  /**
   * `framedblocks:<name>` → parsed `assets/framedblocks/framed_templates/<name>.json`.
   * Empty for jars without templates.
   */
  templates: Record<string, TemplateCube[]>;
  /**
   * Generated-block provider namespace (e.g. `unlimitedchiselworks`) → the
   * plain data that provider reads from the jar (see `mods/generated/`).
   * Absent or empty for jars no provider reads.
   */
  providerData?: ProviderData;
  /**
   * Mod ids the outer jar declares (`[[mods]] modId` in
   * `META-INF/neoforge.mods.toml` / `META-INF/mods.toml`), sorted. Empty when
   * it has neither.
   */
  modIds: string[];
  /**
   * Jars nested in `META-INF/jarjar/` (jar-in-jar), recursively, whose assets
   * are merged into the fields above (`blocks` includes their blocks).
   */
  nestedJars: NestedModJar[];
  /**
   * Mod id → the blocks of the jar's built-in `compat_packs/<modid>/`
   * resource pack (Dyenamics and Friends), which the game enables only when
   * that mod is loaded. Not part of `blocks`; only the modpack upload reads
   * them. Packs without blockstates are left out.
   */
  compatPacks: Record<string, CompatPackAssets>;
  /**
   * The jar's refs to models and textures it doesn't ship (not its compat
   * packs'; theirs are on each pack). Only the modpack upload reads them.
   */
  unresolvedRefs?: UnresolvedAssetRefs;
  /**
   * `block.<ns>.<path>` lang key → English name, for the names in the jar's
   * (and its compat packs') `en_us.json` that no block read from it uses.
   * Only the modpack upload reads them.
   */
  langBlockNames?: Record<string, string>;
  /** Non-fatal problems encountered while parsing (malformed JSON, …). */
  warnings: string[];
  /**
   * True when block appearances were computed with the vanilla bundle
   * available (so vanilla parents and textures resolved).
   */
  appearancesComputed?: boolean;
}

/**
 * One compat pack's blocks, with the models and textures they reach (the
 * jar's own included, under the pack's).
 */
export interface CompatPackAssets {
  /** Non-`minecraft` asset namespaces of the pack, sorted. */
  namespaces: string[];
  blocks: ModBlock[];
  blockstates: Record<string, unknown>;
  models: Record<string, unknown>;
  textures: Record<string, Uint8Array>;
  textureMeta: Record<string, unknown>;
  /** See `ParsedModAssets.unresolvedRefs`. */
  unresolvedRefs?: UnresolvedAssetRefs;
}

/**
 * Model ids a jar's blockstates and model parents reach, and texture ids
 * those models name, that neither the jar nor the vanilla sources have
 * (`minecraft:` ids aren't listed). Another jar of a modpack may ship them.
 */
export interface UnresolvedAssetRefs {
  models: string[];
  textures: string[];
}

/** One jar nested in a mod jar's `META-INF/jarjar/` (see `ParsedModAssets`). */
export interface NestedModJar {
  /**
   * Entry path inside its parent jar; for deeper jars the chain of paths from
   * the outer jar joined with `!/`.
   */
  path: string;
  /** `identifier.group` / `identifier.artifact` from the parent's `META-INF/jarjar/metadata.json`; null when it doesn't list the jar. */
  group: string | null;
  artifact: string | null;
  /** `version.artifactVersion` from the same metadata; null when absent. */
  version: string | null;
  /** Mod ids the nested jar's own mods.toml declares, sorted. */
  modIds: string[];
  /** Ids of the blocks whose assets came from this jar, sorted. */
  blockIds: string[];
  /** 1 for a jar in the outer jar, 2 for a jar in that one, and so on. */
  depth: number;
}

/** CurseForge mod loaders the Mods tab can filter by. */
export type ModLoader = "forge" | "neoforge" | "fabric" | "quilt";

/** Metadata for one loaded CurseForge mod file (persisted in IndexedDB). */
export interface LoadedModMeta {
  /** `${modId}:${gameVersion}` — primary key in the store and registry. */
  key: string;
  /** CurseForge mod id. */
  modId: number;
  modName: string;
  modSlug: string;
  logoUrl: string | null;
  /** CurseForge file id. */
  fileId: number;
  fileDisplayName: string;
  /**
   * The Minecraft version (`KNOWN_VERSIONS` key) this file was loaded for.
   * At most one file per (modId, gameVersion) is loaded at a time.
   */
  gameVersion: string;
  /** Minecraft versions the file declares, e.g. `["1.20.1"]`. */
  gameVersions: string[];
  loader: ModLoader | null;
  /** Non-`minecraft` asset namespaces the jar provides. */
  namespaces: string[];
  blocks: ModBlock[];
  /** Non-fatal parse warnings (skipped files). Absent on older records. */
  warnings?: string[];
  /**
   * True once `blocks[].appearance` has been computed (with the vanilla
   * bundle). Absent on files loaded before appearances existed.
   */
  appearancesComputed?: boolean;
  /**
   * Generated-block provider namespaces whose jar data was read when the file
   * was loaded (see `mods/generated/jar-data.ts`), sorted. Absent on files
   * loaded before provider data existed.
   */
  providerDataRead?: string[];
  /**
   * True on files for Minecraft before 1.13 (`isLegacyGameVersion`) loaded
   * since their 1.12 models and textures are read. Older such files were
   * stored without them.
   */
  legacyAssetsRead?: true;
  /** `Date.now()` when the mod was loaded. */
  loadedAt: number;
}

/** Render assets for a loaded mod file (persisted alongside its metadata). */
export interface LoadedModAssets {
  /** Block id → raw blockstate JSON. */
  blockstates: Record<string, unknown>;
  /** `<ns>:<path>` → raw model JSON. */
  models: Record<string, unknown>;
  /** `<ns>:<path>` (no `.png`) → PNG image. */
  textures: Record<string, Blob>;
  /** Same keys as `textures` → parsed `.png.mcmeta` JSON, where present. */
  textureMeta: Record<string, unknown>;
  /**
   * FramedBlocks geometry templates the jar ships, replacing the shape pack's
   * templates of the same id. Absent on older records and template-less jars.
   */
  templates?: Record<string, TemplateCube[]>;
  /**
   * Generated-block provider data the jar ships, keyed by provider namespace.
   * Absent on older records and on jars no provider reads.
   */
  providerData?: ProviderData;
}

/**
 * Generated-block provider namespace → that provider's parsed jar data. Each
 * value must be structured-cloneable plain data.
 */
export type ProviderData = Record<string, unknown>;

/** A mod namespace mapped to the CurseForge project that provides it. */
export interface NamespaceMapping {
  namespace: string;
  modId: number;
  modName: string;
  modSlug: string;
  logoUrl: string | null;
  mappedAt: number;
}

export function loadedModKey(modId: number, gameVersion: string): string {
  return `${modId}:${gameVersion}`;
}

/** True for Minecraft versions before 1.13 (1.12 blockstate and model formats). */
export function isLegacyGameVersion(gameVersion: string): boolean {
  const match = /^1\.(\d+)(?:\.|$)/.exec(gameVersion);
  return match !== null && Number(match[1]) < 13;
}

export const LEGACY_ASSETS_RELOAD_WARNING =
  "Reload this mod to read its Minecraft 1.12 models and textures. Until then its blocks show as missing in the 3D preview.";

/**
 * `meta` plus `LEGACY_ASSETS_RELOAD_WARNING` when it's a pre-1.13 file stored
 * before 1.12 models and textures were read; `meta` itself otherwise.
 */
export function withLegacyAssetsWarning(meta: LoadedModMeta): LoadedModMeta {
  if (
    meta.legacyAssetsRead === true ||
    !isLegacyGameVersion(meta.gameVersion) ||
    (meta.warnings ?? []).includes(LEGACY_ASSETS_RELOAD_WARNING)
  ) {
    return meta;
  }
  return {
    ...meta,
    warnings: [LEGACY_ASSETS_RELOAD_WARNING, ...(meta.warnings ?? [])],
  };
}

/** Convert worker parse output into the persisted asset shape. */
export function toLoadedModAssets(parsed: ParsedModAssets): LoadedModAssets {
  const textures: Record<string, Blob> = {};
  for (const [key, bytes] of Object.entries(parsed.textures)) {
    textures[key] = new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: "image/png",
    });
  }
  return {
    blockstates: parsed.blockstates,
    models: parsed.models,
    textures,
    textureMeta: parsed.textureMeta,
    ...(Object.keys(parsed.templates).length > 0
      ? { templates: parsed.templates }
      : {}),
    ...(parsed.providerData && Object.keys(parsed.providerData).length > 0
      ? { providerData: parsed.providerData }
      : {}),
  };
}
