// Generated-block providers: per-mod support for blocks a mod registers at
// runtime instead of shipping in its jar (Unlimited Chisel Works crosses
// Chisel's patterns with other mods' materials, Every Compat crosses
// furniture mods with wood mods). Their jars hold no blockstates, models or
// textures for those blocks, so a provider hand-ports the mod's generation
// logic: from the loaded mod files of one Minecraft version it lists the
// blocks it can produce, resolves a block state to synthesized blockstate,
// model and texture recipes, and runs those recipes on source images.
//
// Preview, catalog, material list and mapping code only talk to this
// interface (through `registry.ts`), never to a specific provider.
//
// Worker-safe: no DOM access. From src/lib/render/ only pure types/helpers.

import type { RgbaImage } from "../../render/block-appearance";
import type { LoadedModAssets, LoadedModMeta, ModBlock } from "../types";

/** Block state properties of one placement, e.g. `{ variation: "3" }`. */
export type GeneratedBlockProperties = Readonly<Record<string, string>>;

/**
 * Vanilla blockstates, models and textures (the 3D-preview bundle in
 * `public/minecraft-assets/`, from the newest Minecraft version), for
 * providers whose blocks are generated from vanilla ones.
 */
export interface GeneratedVanillaAssets {
  /** Blockstate JSON of `minecraft:<block>`, or undefined. */
  blockstate(blockId: string): unknown;
  /** Model JSON by normalized id (`minecraft:block/x`), or undefined. */
  model(modelId: string): unknown;
  /** A texture by id (`minecraft:block/x`), first animation frame, or null. */
  texture(textureId: string): RgbaImage | null;
}

/**
 * The loaded mod files of one Minecraft version, as a provider sees them.
 * Built by `getGeneratedBlockFiles` / `loadGeneratedBlockFiles`.
 */
export interface GeneratedBlockFiles {
  /** The Minecraft version (`KNOWN_VERSIONS` key) the files were loaded for. */
  readonly gameVersion: string;
  /** Every file loaded for `gameVersion`, oldest first. */
  readonly files: readonly LoadedModMeta[];
  /** The file loaded for `gameVersion` that provides `namespace`, or null. */
  fileForNamespace(namespace: string): LoadedModMeta | null;
  /** Blocks in `namespace` from the files loaded for `gameVersion`. */
  blocks(namespace: string): ReadonlyMap<string, ModBlock>;
  /**
   * The render assets of `file`, or null while they aren't in memory yet
   * (`loadGeneratedBlockFiles` reads them first).
   */
  assets(file: LoadedModMeta): LoadedModAssets | null;
  /**
   * `providerData[providerNamespace]` of the file providing
   * `providerNamespace`, or undefined (no such file, assets not in memory, or
   * a file loaded before the provider existed).
   */
  providerData(providerNamespace: string): unknown;
  /**
   * Vanilla assets, or null/absent while they aren't loaded
   * (`loadGeneratedBlockFiles` loads them).
   */
  readonly vanilla?: GeneratedVanillaAssets | null;
}

/**
 * How to produce one generated texture: the provider-specific recipe is run
 * by `GeneratedBlockProvider.generateTexture` on the decoded `sources`.
 * Plain data, and deterministic: equal recipes produce equal textures, so
 * callers may cache outputs by `canonicalJson(recipe)`.
 */
export interface GeneratedTextureRecipe {
  /**
   * Texture id the synthesized models reference, without `.png`, e.g.
   * `unlimitedchiselworks:generated/chisel/planks/oak/legacy_0`.
   */
  id: string;
  /** Texture ids (`<ns>:<path>`, no `.png`) the recipe reads, vanilla or modded. */
  sources: string[];
  /** Provider-specific parameters. */
  params: unknown;
}

/** A source or generated texture: RGBA pixels plus its `.png.mcmeta`, if any. */
export interface GeneratedTextureImage {
  image: RgbaImage;
  /** Parsed `.png.mcmeta` JSON (animation), when present. */
  meta?: unknown;
}

/** A generated block whose sources are all loaded. */
export interface GeneratedBlockResolved {
  kind: "resolved";
  /** Namespace of the provider that resolved it. */
  provider: string;
  /** The synthesized block (display name, properties, appearance when known). */
  block: ModBlock;
  /**
   * Synthesized blockstate JSON for `block.id` (every state of the block),
   * or null when the provider can't draw it.
   */
  blockstate: unknown;
  /** Synthesized models, `<ns>:<path>` → model JSON, referenced by `blockstate`. */
  models: Record<string, unknown>;
  /** Recipes for every generated texture the `models` reference. */
  textures: GeneratedTextureRecipe[];
  /**
   * True when the resolution relied on a heuristic (e.g. guessed metadata
   * order) and may pick the wrong source variant.
   */
  approximate: boolean;
  /** Namespaces of the mods the block was generated from, sorted. */
  sourceNamespaces: string[];
  /** Problems resolving it (e.g. an unknown state shown as another). */
  warnings?: string[];
}

/**
 * Synthesized render assets of a block: its blockstate and the models it
 * references, keyed like a mod's (`blockstates`, `models`).
 */
export interface GeneratedBlockModels {
  blockstate: unknown;
  models: Record<string, unknown>;
}

/** A block the provider recognises but whose source mods aren't loaded. */
export interface GeneratedBlockNeedsMods {
  kind: "needs-mods";
  /** Namespace of the provider that recognised it. */
  provider: string;
  /** Namespaces to load for the resolution's Minecraft version, sorted. */
  namespaces: string[];
  /**
   * Block ids it is generated from, when known (for messages): the block
   * whose material it takes (UCW's `from`) first.
   */
  sourceBlocks: string[];
  /**
   * A loaded block state to render instead (e.g. the un-recoloured Chisel
   * block), when one is available.
   */
  fallback?: { id: string; properties: GeneratedBlockProperties };
  /**
   * The block drawn as `fallback` (its blockstate and models, with the
   * fallback's own textures), when the provider can synthesize it.
   */
  fallbackModels?: GeneratedBlockModels;
}

/** No provider produces this block id. */
export interface GeneratedBlockUnrecognised {
  kind: "unrecognised";
}

export type GeneratedBlockResolution =
  | GeneratedBlockResolved
  | GeneratedBlockNeedsMods
  | GeneratedBlockUnrecognised;

/** Per-mod support for runtime-generated blocks. */
export interface GeneratedBlockProvider {
  /** Block id namespace of the generated blocks, e.g. `unlimitedchiselworks`. */
  readonly namespace: string;
  /** Display name of the generating mod, e.g. `Unlimited Chisel Works`. */
  readonly modName: string;
  /** Every block the loaded `files` let it generate, sorted by id. */
  enumerate(files: GeneratedBlockFiles): ModBlock[];
  /** Resolve one block state of a block in `namespace`. */
  resolve(
    id: string,
    properties: GeneratedBlockProperties,
    files: GeneratedBlockFiles,
  ): GeneratedBlockResolution;
  /**
   * Run `recipe` on its decoded sources (keyed by texture id). Null when a
   * source is missing or unusable.
   */
  generateTexture(
    recipe: GeneratedTextureRecipe,
    sources: ReadonlyMap<string, GeneratedTextureImage>,
  ): GeneratedTextureImage | null;
}
