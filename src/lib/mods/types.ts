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

/** CurseForge mod loaders the Mods tab can filter by. */
export type ModLoader = "forge" | "neoforge" | "fabric" | "quilt";

/** Metadata for one loaded CurseForge mod file (persisted in IndexedDB). */
export interface LoadedModMeta {
  /** `${modId}:${fileId}` — primary key in the store and registry. */
  key: string;
  /** CurseForge mod id. */
  modId: number;
  modName: string;
  modSlug: string;
  logoUrl: string | null;
  /** CurseForge file id. */
  fileId: number;
  fileDisplayName: string;
  /** Minecraft versions the file declares, e.g. `["1.20.1"]`. */
  gameVersions: string[];
  loader: ModLoader | null;
  /** Non-`minecraft` asset namespaces the jar provides. */
  namespaces: string[];
  blocks: ModBlock[];
  /** Non-fatal parse warnings (skipped files). Absent on older records. */
  warnings?: string[];
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
}

export function loadedModKey(modId: number, fileId: number): string {
  return `${modId}:${fileId}`;
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
  };
}
