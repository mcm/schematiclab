// Shared types for loaded CurseForge mods.
//
// Plain data only — every type here must survive structured cloning so it can
// cross the mod-jar worker boundary and be persisted to IndexedDB.

/** A single block contributed by a mod (one per blockstates file). */
export interface ModBlock {
  /** Namespaced block id, e.g. `create:andesite_casing`. */
  id: string;
  /** English display name from `lang/en_us.json`, else the title-cased path. */
  displayName: string;
  /** Property name → sorted list of known values. Empty for stateless blocks. */
  properties: Record<string, string[]>;
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
  /** Non-fatal problems encountered while parsing (malformed JSON, …). */
  warnings: string[];
}
