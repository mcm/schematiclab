// Aggregated catalog of every bare block identifier (e.g. "minecraft:stone")
// schemlib knows about across all anchor versions. Used by the Advanced
// Editor's block-state picker for autocomplete. Blocks from loaded mods
// (`./mods/registry`) are merged in at query time. A `CatalogScope` narrows
// the catalog to one Minecraft version: its vanilla blocks, and the blocks of
// mod files loaded for exactly that version (a mod's file for another version
// may list blocks the version doesn't have, so it is never a stand-in).
// Generated-block providers (`./mods/generated/registry`, e.g. Unlimited
// Chisel Works) add the blocks they can generate from the files loaded for
// a version, like a mod file for that version would.
//
// Sources (in `block-translations.generated.ts`):
//   - FLATTEN_TABLE         values are post-flatten block-state strings
//   - REVERSE_FLATTEN_TABLE keys are post-flatten block-state strings
//   - VERSION_DIFFS         addedBlocks / removedBlocks / renamedBlocks /
//                           propertyChanges keys (each is a bare block id)
//
// Block-state strings in the tables include optional `[props]` suffixes; the
// catalog strips those so the autocomplete list is a clean set of identifiers.

import {
  FLATTEN_TABLE,
  REVERSE_FLATTEN_TABLE,
  VERSION_DIFFS,
} from "./schemlib/data/block-translations.generated";
import {
  getLoadedModBlockIds,
  getSnapshot,
  type LoadedModsSnapshot,
} from "./mods/registry";
import {
  enumerateGeneratedBlockSets,
  type GeneratedBlockSet,
} from "./mods/generated/registry";
import { vanillaBlocksForVersion } from "./schemlib/data/vanilla-blocks";
import type { MinecraftVersion } from "./schemlib/schematic-formats/version-mapping";

/** The Minecraft version a search is limited to. */
export interface CatalogScope {
  version: MinecraftVersion;
  /** `KNOWN_VERSIONS` key of `version` (loaded mod files are keyed by it). */
  versionId: string;
}

function stripProperties(blockState: string): string {
  const bracket = blockState.indexOf("[");
  return bracket === -1 ? blockState : blockState.slice(0, bracket);
}

function buildCatalog(): readonly string[] {
  const ids = new Set<string>();

  for (const value of Object.values(FLATTEN_TABLE)) {
    ids.add(stripProperties(value));
  }
  for (const key of Object.keys(REVERSE_FLATTEN_TABLE)) {
    ids.add(stripProperties(key));
  }
  for (const diff of VERSION_DIFFS) {
    for (const id of diff.addedBlocks) ids.add(stripProperties(id));
    for (const id of diff.removedBlocks) ids.add(stripProperties(id));
    for (const [from, to] of Object.entries(diff.renamedBlocks)) {
      ids.add(stripProperties(from));
      ids.add(stripProperties(to));
    }
    for (const id of Object.keys(diff.propertyChanges)) {
      ids.add(stripProperties(id));
    }
    for (const replacement of Object.values(diff.removedFallbacks)) {
      ids.add(stripProperties(replacement));
    }
    for (const id of Object.keys(diff.addedDefaults)) {
      ids.add(stripProperties(id));
    }
  }

  return [...ids].sort();
}

const CATALOG = buildCatalog();
const CATALOG_SET: ReadonlySet<string> = new Set(CATALOG);

// Loaded mod blocks layer on top of the static vanilla catalog. The sorted
// lists are cached per registry block-id set (whose identity changes only
// when the loaded-mod set changes).
let modCache: {
  for: ReadonlySet<string>;
  generated: readonly (readonly GeneratedBlockSet[])[];
  ids: readonly string[];
  set: ReadonlySet<string>;
  all: readonly string[];
} | null = null;

// Generated blocks of every version with loaded files, per version.
function generatedSetsOfLoadedVersions(): (readonly GeneratedBlockSet[])[] {
  const versions = [...new Set(getSnapshot().map((m) => m.gameVersion))];
  return versions.sort().map((v) => enumerateGeneratedBlockSets(v));
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function getModCache(): NonNullable<typeof modCache> {
  const blockIds = getLoadedModBlockIds();
  const generated = generatedSetsOfLoadedVersions();
  if (modCache?.for !== blockIds || !sameItems(modCache.generated, generated)) {
    const set = new Set<string>();
    for (const id of blockIds) if (!CATALOG_SET.has(id)) set.add(id);
    for (const sets of generated) addGeneratedIds(set, sets);
    const ids = [...set].sort();
    modCache = {
      for: blockIds,
      generated,
      ids,
      set,
      all: ids.length === 0 ? CATALOG : CATALOG.concat(ids).sort(),
    };
  }
  return modCache;
}

function addGeneratedIds(
  into: Set<string>,
  sets: readonly GeneratedBlockSet[],
): void {
  for (const { blocks } of sets) {
    for (const block of blocks) {
      if (!CATALOG_SET.has(block.id)) into.add(block.id);
    }
  }
}

// Vanilla ids of one version, keyed by `vanillaBlocksForVersion`'s cached set.
const scopedVanilla = new WeakMap<ReadonlySet<string>, readonly string[]>();

interface ScopedIds {
  ids: readonly string[];
  set: ReadonlySet<string>;
}

// Mod ids of one version, keyed by the registry snapshot, then version id.
const scopedMods = new WeakMap<LoadedModsSnapshot, Map<string, ScopedIds>>();

// Mod plus generated ids of one version, keyed by the version's generated
// block sets (a new array whenever they change).
const scopedGenerated = new WeakMap<
  readonly GeneratedBlockSet[],
  { base: ScopedIds; value: ScopedIds }
>();

function getScopedVanilla(scope: CatalogScope): {
  ids: readonly string[];
  set: ReadonlySet<string>;
} {
  const set = vanillaBlocksForVersion(scope.version);
  let ids = scopedVanilla.get(set);
  if (ids === undefined) {
    ids = [...set].sort();
    scopedVanilla.set(set, ids);
  }
  return { ids, set };
}

function getScopedMods(scope: CatalogScope): ScopedIds {
  const base = getScopedModFiles(scope);
  const generated = enumerateGeneratedBlockSets(scope.versionId);
  if (generated.length === 0) return base;
  let merged = scopedGenerated.get(generated);
  if (merged?.base !== base) {
    const set = new Set(base.set);
    addGeneratedIds(set, generated);
    merged = { base, value: { ids: [...set].sort(), set } };
    scopedGenerated.set(generated, merged);
  }
  return merged.value;
}

function getScopedModFiles(scope: CatalogScope): ScopedIds {
  const snapshot = getSnapshot();
  let byVersion = scopedMods.get(snapshot);
  if (byVersion === undefined) {
    byVersion = new Map();
    scopedMods.set(snapshot, byVersion);
  }
  let scoped = byVersion.get(scope.versionId);
  if (scoped === undefined) {
    const set = new Set<string>();
    for (const file of snapshot) {
      if (file.gameVersion !== scope.versionId) continue;
      for (const block of file.blocks) {
        if (!CATALOG_SET.has(block.id)) set.add(block.id);
      }
    }
    scoped = { ids: [...set].sort(), set };
    byVersion.set(scope.versionId, scoped);
  }
  return scoped;
}

/**
 * Every known id (vanilla, loaded mods, and the blocks generated from the
 * files of each loaded version), sorted.
 */
export function getBlockCatalog(): readonly string[] {
  return getModCache().all;
}

function barePath(id: string): string {
  const colon = id.indexOf(":");
  return colon === -1 ? id : id.slice(colon + 1);
}

// Case-insensitive substring/prefix scoring. Prefix matches rank above
// substring matches; vanilla ids rank above mod ids within each tier; ties
// broken by identifier order. A query matches as a prefix of the full id or
// of the bare path (`andesite` → `create:andesite_casing`), so namespace
// queries (`create:`) list that mod's blocks. Caller decides how many
// matches to show. With a `scope`, only ids in that version are searched.
export function searchBlockCatalog(
  query: string,
  limit = 50,
  scope?: CatalogScope,
): readonly string[] {
  const vanillaIds = scope ? getScopedVanilla(scope).ids : CATALOG;
  const modIds = scope ? getScopedMods(scope).ids : getModCache().ids;
  const needle = query.trim().toLowerCase();
  // Empty query: vanilla ids first, then mod ids (same tiering as below).
  if (needle.length === 0) {
    return vanillaIds.slice(0, limit).concat(modIds).slice(0, limit);
  }

  const prefix: string[] = [];
  const substring: string[] = [];
  for (const id of vanillaIds) {
    const lower = id.toLowerCase();
    if (lower.startsWith(needle) || lower.startsWith(`minecraft:${needle}`)) {
      prefix.push(id);
    } else if (lower.includes(needle)) {
      substring.push(id);
    }
    if (prefix.length >= limit) break;
  }

  const modPrefix: string[] = [];
  const modSubstring: string[] = [];
  for (const id of modIds) {
    if (prefix.length + modPrefix.length >= limit) break;
    const lower = id.toLowerCase();
    if (lower.startsWith(needle) || barePath(lower).startsWith(needle)) {
      modPrefix.push(id);
    } else if (lower.includes(needle)) {
      modSubstring.push(id);
    }
  }

  return prefix.concat(modPrefix, substring, modSubstring).slice(0, limit);
}

/** Whether `id` is a known block (in `scope`'s version, when given). */
export function isCatalogedBlockId(id: string, scope?: CatalogScope): boolean {
  if (scope) {
    return (
      getScopedVanilla(scope).set.has(id) || getScopedMods(scope).set.has(id)
    );
  }
  return CATALOG_SET.has(id) || getModCache().set.has(id);
}
