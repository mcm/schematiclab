// Aggregated catalog of every bare block identifier (e.g. "minecraft:stone")
// schemlib knows about across all anchor versions. Used by the Advanced
// Editor's block-state picker for autocomplete. Blocks from loaded mods
// (`./mods/registry`) are merged in at query time.
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
import { getLoadedModBlockIds } from "./mods/registry";

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
  ids: readonly string[];
  all: readonly string[];
} | null = null;

function getModCache(): NonNullable<typeof modCache> {
  const set = getLoadedModBlockIds();
  if (modCache?.for !== set) {
    const ids = [...set].filter((id) => !CATALOG_SET.has(id)).sort();
    modCache = {
      for: set,
      ids,
      all: ids.length === 0 ? CATALOG : CATALOG.concat(ids).sort(),
    };
  }
  return modCache;
}

/** Every known id (vanilla and loaded mods), sorted. */
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
// matches to show.
export function searchBlockCatalog(
  query: string,
  limit = 50,
): readonly string[] {
  const modIds = getModCache().ids;
  const needle = query.trim().toLowerCase();
  // Empty query: vanilla ids first, then mod ids (same tiering as below).
  if (needle.length === 0) {
    return CATALOG.slice(0, limit).concat(modIds).slice(0, limit);
  }

  const prefix: string[] = [];
  const substring: string[] = [];
  for (const id of CATALOG) {
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

export function isCatalogedBlockId(id: string): boolean {
  return CATALOG_SET.has(id) || getLoadedModBlockIds().has(id);
}
