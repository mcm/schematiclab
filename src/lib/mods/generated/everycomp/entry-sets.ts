// The shape of the generated Every Compat / Stone Zone / Gems Realm module
// tables (`*.generated.ts`, written by `pnpm gen:everycomp` from the mods'
// Java sources): which compat modules exist, which mod each supports, and
// each module's entry sets (`SimpleEntrySet` builder chains) as data plus the
// few lambdas they carry, translated to TypeScript.
//
// Worker-safe: no DOM access.

import type { BlockTypeKind } from "./block-types/types";
import type { EcContext, EcResTransformer, EcTypeView } from "./runtime";

/** The addon generating the blocks; also their namespace. */
export type EcAddon = "everycomp" | "stonezone" | "gemsrealm";

/** Mod loaders a module is registered for. */
export type EcPlatform = "fabric" | "neoforge";

/**
 * A texture id in a module table: `ns:path`, or `@:path` for the supported
 * mod's namespace (`modRes`), which depends on the registration.
 */
export type EcTextureRef = string;

/** One `TextureInfo` of an entry set. */
export interface EcTextureInfo {
  texture: EcTextureRef;
  mask?: EcTextureRef;
  overlay?: EcTextureRef;
  /** Palette strategy key (`PALETTE_STRATEGIES`); default MAIN_CHILD. */
  palette?: string;
  noAnimation?: true;
  copyTexture?: true;
  keepNamespace?: true;
  /** `TextureInfo.of(texture, customPath)` / `addTextureC`. */
  customPath?: string;
}

/** One entry set (`SimpleEntrySet` / `StoneZoneEntrySet` / `GemsRealmEntrySet`). */
export interface EcEntrySet {
  kind: BlockTypeKind;
  /** `name` builder argument (the postfix; may be empty). */
  name: string;
  /** `prefix` builder argument, or null. */
  prefix: string | null;
  /** Base type id, e.g. `minecraft:oak`. */
  baseType: string;
  /**
   * The template block, when it isn't `<modId>:<entry name of the base
   * type>` (Copper Age Backport's `minecraft:oak_shelf`).
   */
  baseBlock?: string;
  /** Java field holding the entry set, when assigned to one. */
  field?: string;
  /** Source line of the builder call (for messages and tests). */
  line: number;
  textures?: EcTextureInfo[];
  /** `useMergedPalette()`. */
  mergedPalette?: true;
  /** `addModelTransform`: (context) → the Java transformer lambda. */
  modelTransform?: (c: EcContext) => (m: EcResTransformer) => unknown;
  /**
   * Every `requiresChildren` / `requiresFromMap` / `excludeBlockTypes` /
   * `addCondition` of the chain, ANDed: (context) → (type) → boolean.
   */
  condition?: (c: EcContext) => (t: EcTypeView) => boolean;
  /** `includeModelsBlock` / `includeModelsItem`. */
  includeModels?: { block: string[]; item: string[]; generate: boolean };
  /** `setRenderType`, lower-cased. */
  renderType?: string;
  /** `addTile`: drawn by a block-entity renderer in game. */
  tile?: true;
  /** `copyParentTint()`. */
  copyTint?: true;
  /** Parts of the chain the generator couldn't translate. */
  unsupported?: string[];
}

/** One compat module class. */
export interface EcModule {
  /** `<sourceSet>:<ClassName>`, unique per addon. */
  key: string;
  /** `CompatModule.shortId`. */
  shortId: string;
  /** Source file, relative to the addon checkout. */
  file: string;
  entrySets: EcEntrySet[];
  /** `getAlreadySupportedMods()`. */
  alreadySupportedMods?: string[];
  /**
   * True when the module also generates assets in Java code
   * (`addDynamicClientResources`), which the port doesn't run.
   */
  customClientResources?: true;
}

/** One `addOptionalModule` / `addIfLoaded` call. */
export interface EcRegistration {
  /** Supported mod id (the module's `modId`). */
  modId: string;
  /** `EcModule.key`. */
  module: string;
  platforms: EcPlatform[];
  /** Extra mods of which at least one must be loaded (code guards). */
  requiresAnyOf?: string[];
  /** Mods that must not be loaded. */
  requiresNoneOf?: string[];
}

/** `addOtherCompatMod(modId, woodsFrom, blocksFrom)`. */
export interface EcOtherCompatMod {
  modId: string;
  woodsFrom: string[];
  blocksFrom: string[];
}

/** A `TextureCache.registerSpecialTextureForBlock` / `SpriteExtra` entry. */
export interface EcSpecialTexture {
  block: string;
  label: string;
  texture: string;
  /** Only when this mod is not loaded. */
  unlessLoaded?: string;
}

/** One addon's generated table. */
export interface EcAddonTable {
  addon: EcAddon;
  /** Display name, e.g. "Every Compat". */
  modName: string;
  source: {
    repository: string;
    commit: string;
    modVersion: string;
    minecraftVersion: string;
    license: string;
  };
  modules: Record<string, EcModule>;
  registrations: EcRegistration[];
  otherCompatMods: EcOtherCompatMod[];
  specialTextures: EcSpecialTexture[];
  /**
   * Stone Zone's hardcoded model ids (`CompatSpritesHelper.modelID`):
   * generated block path → model id used for a child's model.
   */
  hardcodedModels: Record<string, string>;
}
