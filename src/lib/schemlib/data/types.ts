// Shared types for the block-translation data layer.
//
// The translator walks a small set of ANCHOR versions in order and applies a
// diff between each adjacent pair. The diffs are computed at build time by
// `scripts/generate-block-translations.mts` from PrismarineJS/minecraft-data
// (for the 1.12 ↔ 1.13 flatten and the 1.13 block schema) and misode/mcmeta
// (per-release tags for 1.14+). Anything codegen can't infer — block renames,
// removed-block fallbacks, property-value renames, defaults for newly-added
// properties — lives in `manual-overrides.ts` and is merged in by the script.

export type AnchorVersion =
  | "1.12.2"
  | "1.13.2"
  | "1.14.4"
  | "1.15.2"
  | "1.16.5"
  | "1.17.1"
  | "1.18.2"
  | "1.19.4"
  | "1.20.1"
  | "1.21.4";

/** Ordered list of anchors, oldest → newest. Translation walks this chain. */
export const ANCHOR_VERSIONS = [
  "1.12.2",
  "1.13.2",
  "1.14.4",
  "1.15.2",
  "1.16.5",
  "1.17.1",
  "1.18.2",
  "1.19.4",
  "1.20.1",
  "1.21.4",
] as const satisfies readonly AnchorVersion[];

/**
 * Schema for a single block at a single anchor version: the property names and
 * the allowed values for each. `{}` means a stateless block (no properties).
 */
export type BlockSchema = Record<string, readonly string[]>;

/** Map of "minecraft:name" → property schema for one anchor version. */
export type AnchorSchemas = Record<string, BlockSchema>;

/**
 * Diff between two adjacent anchors (`from` is older, `to` is newer).
 *
 *   - addedBlocks       : exist in `to` but not in `from` (forward translation
 *                         must decide what to map them to when going `to → from`;
 *                         backward translation just keeps them)
 *   - removedBlocks     : exist in `from` but not in `to`
 *   - renamedBlocks     : hand-curated `from-name → to-name` (e.g.
 *                         "grass_path" → "dirt_path" in 1.16→1.17). These are
 *                         applied bidirectionally.
 *   - propertyChanges   : for blocks present in both, what properties were
 *                         added/removed/value-renamed.
 *   - removedFallbacks  : when a block is removed going `from → to`, this is
 *                         what to substitute (default: drop to air).
 *   - addedDefaults     : default value for a property that was newly added
 *                         to an existing block going `from → to` (e.g.
 *                         `waterlogged → "false"`). Used to fill in the gap
 *                         when translating forward.
 */
export interface VersionDiff {
  from: AnchorVersion;
  to: AnchorVersion;
  addedBlocks: readonly string[];
  removedBlocks: readonly string[];
  renamedBlocks: Readonly<Record<string, string>>;
  propertyChanges: Readonly<
    Record<
      string, // block name (in `from`'s namespace, pre-rename)
      {
        added: Readonly<Record<string, readonly string[]>>; // prop → allowed values in `to`
        removed: readonly string[]; // prop names dropped in `to`
        valueRenames: Readonly<
          Record<string, Readonly<Record<string, string>>>
        >; // prop → {old → new}
      }
    >
  >;
  removedFallbacks: Readonly<Record<string, string>>; // from-name → "minecraft:foo[a=b]" replacement
  addedDefaults: Readonly<Record<string, Readonly<Record<string, string>>>>; // block → prop → default value
}

/**
 * Top-level translation bundle emitted by codegen and consumed at runtime.
 *
 * `flattenTable` maps pre-flatten `"id:metadata"` → post-flatten blockstate
 * string (e.g. `"minecraft:grass_block[snowy=false]"`). It is the 1.12 ↔ 1.13
 * boundary; everything else uses the diff chain.
 */
export interface TranslationBundle {
  anchors: readonly AnchorVersion[];
  schemas: Readonly<Record<AnchorVersion, AnchorSchemas>>;
  diffs: readonly VersionDiff[];
  flattenTable: Readonly<Record<string, string>>;
}
