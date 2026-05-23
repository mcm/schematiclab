// Aggregated catalog of every bare block identifier (e.g. "minecraft:stone")
// schemlib knows about across all anchor versions. Used by the Advanced
// Editor's block-state picker for autocomplete.
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

export function getBlockCatalog(): readonly string[] {
  return CATALOG;
}

// Case-insensitive substring/prefix scoring. Prefix matches rank above
// substring matches; ties broken by identifier order. Caller decides how many
// matches to show.
export function searchBlockCatalog(
  query: string,
  limit = 50,
): readonly string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return CATALOG.slice(0, limit);

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

  const combined = prefix.concat(substring);
  return combined.slice(0, limit);
}

export function isCatalogedBlockId(id: string): boolean {
  return CATALOG.includes(id);
}
