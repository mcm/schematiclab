// The client assets of one generated block: its blockstate and models
// (the supported mod's template block's files, rewritten as text by the
// addon's transformers) and recipes for its recoloured textures.
//
// Port of Every Compat 1.21 (`ResourcesUtils.generateStandardBlockFiles`,
// `addBuiltinModelTransformer`, `SimpleEntrySet.makeModelTransformer`/
// `makeBlockStateTransformer`, `TextureGenHelper.generateDefault`'s naming,
// `CompatSpritesHelper.replaceWoodTextures`/`replaceLeavesTextures`;
// https://github.com/MehVahdJukaar/WoodGood, commit 556d936), Stone Zone 1.21
// (`StoneZoneEntrySet` transformers, `CompatSpritesHelper.
// replaceStoneTextures`, `ResourcesUtils.getChildModelId`;
// https://github.com/MehVahdJukaar/StoneZone, commit d17ed21), Gems Realm
// 1.21.1 (`GemsRealmEntrySet` transformers;
// https://github.com/Xelbayria/GemsRealm, commit 66b66be) and Moonlight Lib
// 1.21 (`RPUtils.findFirstBlockTextureLocation`,
// `findAllResourcesInJsonRecursive`, `TextureCache`;
// https://github.com/MehVahdJukaar/Moonlight, commit 72afa38). Copyright (c)
// MehVahdJukaar, Xel'Bayria and the Supplementaries Team, under the
// Supplementaries Team License, whose authors this port credits.
//
// The game transforms the raw bytes of the template files; the app stores
// them parsed, so they're re-serialized with two-space indentation first
// (what mod jars ship), which matters for Stone Zone's line-sensitive
// `parent|template` look-ahead.
//
// Worker-safe: no DOM access.

import { normalizeResourceId } from "../../../render/block-appearance";
import type { GeneratedTextureRecipe } from "../types";
import { mainChildKey } from "./block-types/detect";
import type { DetectedBlockType } from "./block-types/types";
import type { EcTextureInfo } from "./entry-sets";
import {
  ANY_TEXTURE,
  EcResourceLocation,
  EcResTransformer,
  J,
  LOOKS_LIKE_LEAF_TEXTURE,
  LOOKS_LIKE_SIDE_LOG_TEXTURE,
  LOOKS_LIKE_TOP_LOG_TEXTURE,
  replaceFullGenericType,
  replaceTypeNoNamespace,
  type EcTypeView,
  type TexturePredicate,
} from "./runtime";
import {
  makeEntryName,
  typeNameOf,
  type EcAddonState,
  type EcBlockMatch,
  type TypeView,
} from "./state";
import type { EcMergedTexture, EcTextureParams } from "./texture/generate";
import { EC_SPECIAL_TEXTURES } from "./tables";
import { javaStringHash, JavaHashSet } from "./texture/java-order";
import {
  DEFAULT_PALETTE_STRATEGY,
  paletteStrategy,
} from "./texture/strategies";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** `RPUtils.findAllResourcesInJsonRecursive(element, key -> key == filter)`. */
export function findAllResourcesInJson(
  element: unknown,
  filter: (key: string) => boolean = () => true,
): JavaHashSet<string> {
  const out = new JavaHashSet<string>(javaStringHash);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        const primitive = child === null || typeof child !== "object";
        if (primitive && !filter(key)) continue;
        visit(child);
      }
    } else if (value !== null && value !== undefined) {
      out.add(String(value));
    }
  };
  visit(element);
  return out;
}

/** Pretty JSON, like the files mod jars ship. */
function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ── findFirstBlockTextureLocation ────────────────────────────────────────

/** Per-state `TextureCache` (special textures + per-block cache). */
interface TextureCacheState {
  cached: Map<string, JavaHashSet<string>>;
}

const textureCaches = new WeakMap<EcAddonState, TextureCacheState>();

function textureCache(state: EcAddonState): TextureCacheState {
  let cache = textureCaches.get(state);
  if (cache === undefined) {
    cache = { cached: new Map() };
    textureCaches.set(state, cache);
  }
  return cache;
}

/** Special textures of every loaded addon table, for `block`. */
function specialTextures(
  state: EcAddonState,
  block: string,
): { label: string; texture: string }[] {
  return EC_SPECIAL_TEXTURES.filter(
    (s) =>
      s.block === block &&
      (s.unlessLoaded === undefined || !state.isModLoaded(s.unlessLoaded)),
  );
}

/** The textures of a model (`findAllTexturesInModelRecursive`); throws like Java. */
function modelTextures(
  state: EcAddonState,
  modelId: string,
  depth = 0,
): string[] {
  if (depth > 16) throw new Error("parent loop");
  const model = state.world.model(normalizeResourceId(modelId));
  if (!isRecord(model)) throw new Error(`Failed to parse model at ${modelId}`);
  if (!isRecord(model.textures)) throw new Error("no textures"); // Java NPE
  const textures = [...findAllResourcesInJson(model.textures)];
  if (textures.length === 0 && typeof model.parent === "string") {
    textures.push(...modelTextures(state, model.parent, depth + 1));
  }
  return textures;
}

/** The type and child key of a wood log/stripped log block, for guesses. */
function isWoodLog(state: EcAddonState, block: string): boolean {
  for (const wood of state.typesOf("wood").values()) {
    if (wood.children.get("log")?.id === block) return true;
    if (wood.children.get("stripped_log")?.id === block) return true;
  }
  return false;
}

/**
 * Moonlight `RPUtils.findFirstBlockTextureLocation`: the first texture of
 * `block` (special textures first, then its models' textures in Java
 * `HashSet` order, then guesses) passing `predicate`, or null where Java
 * throws `FileNotFoundException`.
 */
export function findFirstBlockTexture(
  state: EcAddonState,
  block: string,
  predicate: TexturePredicate = ANY_TEXTURE,
): string | null {
  for (const special of specialTextures(state, block)) {
    if (predicate(special.label)) return special.texture;
  }
  const cache = textureCache(state).cached;
  const existing = cache.get(block);
  const passing = (set: JavaHashSet<string>): string | null => {
    for (const texture of set) {
      if (predicate(texture)) {
        return texture.startsWith("#") ? null : normalizeResourceId(texture);
      }
    }
    return null;
  };
  if (existing !== undefined) return passing(existing);

  const set = new JavaHashSet<string>(javaStringHash);
  cache.set(block, set);
  try {
    const blockstate = state.world.blockstate(block);
    if (!isRecord(blockstate)) throw new Error("no blockstate");
    for (const model of findAllResourcesInJson(
      blockstate,
      (k) => k === "model",
    )) {
      for (const texture of modelTextures(state, model)) set.add(texture);
    }
    const found = passing(set);
    if (found !== null) return found;
  } catch {
    // fall through to the guesses
  }
  const ns = namespaceOf(block);
  const path = block.slice(ns.length + 1);
  const guesses = isWoodLog(state, block)
    ? [
        `${ns}:block/${path}_top`,
        `${ns}:block/${path}_side`,
        `${ns}:block/${path}`,
      ]
    : [`${ns}:block/${path}`];
  for (const guess of guesses) {
    set.add(guess);
    if (predicate(guess)) return guess;
  }
  return null;
}

// ── Transformers ─────────────────────────────────────────────────────────

function childTextureLookup(state: EcAddonState) {
  return (
    type: EcTypeView,
    child: string | ((t: EcTypeView) => string | null),
    predicate: TexturePredicate,
  ): string | null => {
    const block =
      typeof child === "string" ? type.getBlockOfThis(child) : child(type);
    if (block === null || !state.world.hasBlock(block)) return null;
    return findFirstBlockTexture(state, block, predicate);
  };
}

/** `CompatSpritesHelper.replaceWoodTextures(t, wood)` with base wood name `n`. */
function replaceWoodTextures(t: EcResTransformer, n: string): void {
  t.replaceWithTextureFromChild(`minecraft:block/${n}_planks`, "planks")
    .replaceWithTextureFromChild(
      `minecraft:block/stripped_${n}_log`,
      "stripped_log",
      LOOKS_LIKE_SIDE_LOG_TEXTURE,
    )
    .replaceWithTextureFromChild(
      `minecraft:block/stripped_${n}_log_top`,
      "stripped_log",
      LOOKS_LIKE_TOP_LOG_TEXTURE,
    )
    .replaceWithTextureFromChild(
      `minecraft:block/${n}_log`,
      "log",
      LOOKS_LIKE_SIDE_LOG_TEXTURE,
    )
    .replaceWithTextureFromChild(
      `minecraft:block/${n}_log_top`,
      "log",
      LOOKS_LIKE_TOP_LOG_TEXTURE,
    );
}

/** `CompatSpritesHelper.replaceLeavesTextures(t, leaves)` with base name `n`. */
function replaceLeavesTextures(t: EcResTransformer, n: string): void {
  const wfl = (key: string) => (l: EcTypeView) =>
    l.getAssociatedWoodType()?.getChild(key) ?? null;
  t.replaceWithTextureFromChild(
    `minecraft:block/${n}_leaves`,
    "leaves",
    LOOKS_LIKE_LEAF_TEXTURE,
  )
    .replaceWithTextureFromChild(
      `minecraft:block/stripped_${n}_log`,
      wfl("stripped_log"),
      LOOKS_LIKE_SIDE_LOG_TEXTURE,
    )
    .replaceWithTextureFromChild(
      `minecraft:block/stripped_${n}_log_top`,
      wfl("stripped_log"),
      LOOKS_LIKE_TOP_LOG_TEXTURE,
    )
    .replaceWithTextureFromChild(
      `minecraft:block/${n}_log`,
      wfl("log"),
      LOOKS_LIKE_SIDE_LOG_TEXTURE,
    )
    .replaceWithTextureFromChild(
      `minecraft:block/${n}_log_top`,
      wfl("log"),
      LOOKS_LIKE_TOP_LOG_TEXTURE,
    );
}

/** The base leaves type's associated wood name (oak → oak). */
function leavesBaseWood(state: EcAddonState, baseType: string): string | null {
  const wood = state.registries.leavesToWood.get(baseType);
  return wood === undefined ? null : typeNameOf(wood);
}

/** EC `makeModelTransformer` (extra transform + `addBuiltinModelTransformer`). */
function everyCompatModelTransformer(
  state: EcAddonState,
  match: EcBlockMatch,
  withExtra = true,
): EcResTransformer {
  const { entry, registration } = match;
  const old = typeNameOf(entry.baseType);
  const t = new EcResTransformer(registration.modId, childTextureLookup(state));
  if (withExtra && entry.modelTransform) {
    entry.modelTransform(state.context(registration))(t);
  }
  t.setIDModifier((text, id, w) =>
    replaceFullGenericType(text, w.getTypeName(), id, old, null, 2),
  );
  if (entry.kind === "leaves") {
    replaceLeavesTextures(t, old);
    const wood = leavesBaseWood(state, entry.baseType);
    if (wood !== null) replaceWoodTextures(t, wood);
  } else if (entry.kind === "wood") {
    replaceWoodTextures(t, old);
  }
  t.replaceGenericType(old, "block");
  return t;
}

/** EC `makeBlockStateTransformer`. */
function everyCompatBlockstateTransformer(
  state: EcAddonState,
  match: EcBlockMatch,
): EcResTransformer {
  const { entry, registration } = match;
  const old = typeNameOf(entry.baseType);
  const t = new EcResTransformer(registration.modId, childTextureLookup(state));
  if (entry.modelTransform)
    entry.modelTransform(state.context(registration))(t);
  return t
    .replaceWithTextureFromChild(`minecraft:block/${old}_planks`, "planks")
    .replaceBlockType(old)
    .IDReplaceType(old);
}

/** Stone Zone's tinted myalite textures (`tintedStoneType`). */
const TINTED_STONE_TYPES: Record<string, [string, string]> = {
  "quark:myalite": [
    ":block/quark/myalite_tinted",
    ":block/quark/myalite_bricks_tinted",
  ],
};

/** Stone Zone `StoneZoneEntrySet.makeModelTransformer`. */
function stoneZoneModelTransformer(
  state: EcAddonState,
  match: EcBlockMatch,
): EcResTransformer {
  const { entry, registration } = match;
  const old = typeNameOf(entry.baseType);
  const t = new EcResTransformer(registration.modId, childTextureLookup(state));
  t.setIDModifier((s, id, w) =>
    replaceFullGenericType(
      J.replace(s, "stonebrick", "stone_brick"),
      w.getTypeName(),
      id,
      old,
      null,
      2,
    ),
  ).addModifier((s, id, w) => {
    const out = replaceFullGenericType(
      s,
      w.getTypeName(),
      id,
      old,
      registration.modId,
      "block(?!.*(?:parent|template))",
    );
    const tinted = TINTED_STONE_TYPES[w.getId().toString()];
    if (tinted !== undefined) {
      return J.replace(
        J.replace(
          out,
          `minecraft:block/${old}_bricks`,
          `stonezone${tinted[0]}`,
        ),
        `minecraft:block/${old}`,
        `stonezone${tinted[1]}`,
      );
    }
    return out;
  });
  if (entry.modelTransform)
    entry.modelTransform(state.context(registration))(t);
  return t
    .replaceWithTextureFromChild(`minecraft:block/${old}_bricks`, "bricks")
    .replaceWithTextureFromChild(`minecraft:block/${old}`, "block")
    .replaceWithTextureFromChild("minecraft:block/cobblestone", "cobblestone")
    .replaceWithTextureFromChild(`minecraft:block/smooth_${old}`, "smooth")
    .replaceWithTextureFromChild(
      `minecraft:block/smooth_${old}_slab_side`,
      "smooth_slab",
    )
    .replaceWithTextureFromChild(`minecraft:block/polished_${old}`, "polished")
    .replaceWithTextureFromChild(
      `minecraft:block/mossy_${old}_bricks`,
      "mossy_bricks",
    );
}

/** Stone Zone `ResourcesUtils.getChildModelId`. */
function stoneZoneChildModelId(
  state: EcAddonState,
  childKey: string,
  type: EcTypeView,
  blockId: EcResourceLocation,
): string {
  const hardcoded = state.table.hardcodedModels[blockId.path];
  if (hardcoded !== undefined) return hardcoded;
  const child = type.getBlockOfThis(childKey) ?? "minecraft:air";
  const parsed = EcResourceLocation.parse(child);
  return `${parsed.namespace}:block/${parsed.path}`;
}

/** Stone Zone `StoneZoneEntrySet.makeBlockStateTransformer`. */
function stoneZoneBlockstateTransformer(
  state: EcAddonState,
  match: EcBlockMatch,
): EcResTransformer {
  const { entry, registration } = match;
  const old = typeNameOf(entry.baseType);
  // VanillaStoneChildKeys.STONE / VanillaMudChildKeys.MUD are both "block"
  const stoneKey = "block";
  return new EcResTransformer(registration.modId, childTextureLookup(state))
    .addModifier((s) => J.replace(s, "stonebrick", "stone_brick"))
    .replaceWithTextureFromChild(`minecraft:block/${old}`, stoneKey)
    .replaceWithTextureFromChild(`minecraft:block/polished_${old}`, "polished")
    .addModifier((s, id, w) =>
      J.replace(
        s,
        `minecraft:block/${old}`,
        stoneZoneChildModelId(state, stoneKey, w, id),
      ),
    )
    .addModifier((s, id, w) =>
      J.replace(
        s,
        `minecraft:block/${old}_bricks`,
        stoneZoneChildModelId(state, "bricks", w, id),
      ),
    )
    .addModifier((s, id, w) =>
      J.replace(
        s,
        `minecraft:block/smooth_${old}`,
        stoneZoneChildModelId(state, "smooth", w, id),
      ),
    )
    .replaceBlockType(old)
    .IDReplaceType(old);
}

/** Gems Realm `GemsRealmEntrySet.makeModelTransformer`. */
function gemsRealmModelTransformer(
  state: EcAddonState,
  match: EcBlockMatch,
): EcResTransformer {
  const { entry, registration } = match;
  const n = typeNameOf(entry.baseType);
  const t = new EcResTransformer(registration.modId, childTextureLookup(state));
  if (entry.modelTransform)
    entry.modelTransform(state.context(registration))(t);
  t.replaceWithTextureFromChild("minecraft:block/anvil", "block")
    .replaceWithTextureFromChild(`minecraft:block/${n}_block`, "block")
    .replaceWithTextureFromChild(`minecraft:block/raw_${n}_block`, "raw_block")
    .replaceWithTextureFromChild(`minecraft:block/${n}_bricks`, "bricks")
    .replaceWithTextureFromChild(`minecraft:block/smooth_${n}`, "smooth")
    .replaceWithTextureFromChild(`minecraft:block/polished_${n}`, "polished")
    .replaceWithTextureFromChild(
      `minecraft:block/mossy_${n}_bricks`,
      "mossy_bricks",
    )
    .replaceWithTextureFromChild(`minecraft:block/budding_${n}`, "budding");
  return t.andThen(everyCompatModelTransformer(state, match));
}

function transformers(
  state: EcAddonState,
  match: EcBlockMatch,
): { model: EcResTransformer; blockstate: EcResTransformer } {
  switch (state.table.addon) {
    case "stonezone":
      return {
        model: stoneZoneModelTransformer(state, match),
        blockstate: stoneZoneBlockstateTransformer(state, match),
      };
    case "gemsrealm":
      return {
        model: gemsRealmModelTransformer(state, match),
        blockstate: everyCompatBlockstateTransformer(state, match),
      };
    default:
      return {
        model: everyCompatModelTransformer(state, match),
        blockstate: everyCompatBlockstateTransformer(state, match),
      };
  }
}

/** The template (base) block of a match: `<modId>:<entry name of the base type>`. */
export function baseBlockId(
  match: Pick<EcBlockMatch, "entry" | "registration">,
): string {
  const { entry, registration } = match;
  return (
    entry.baseBlock ??
    `${registration.modId}:${makeEntryName(entry, typeNameOf(entry.baseType))}`
  );
}

export interface EcSynthesizedModels {
  /** Rewritten blockstate, or null when the template has none. */
  blockstate: unknown;
  /** Rewritten models by id. */
  models: Record<string, unknown>;
  warnings: string[];
}

/**
 * `ResourcesUtils.generateStandardBlockFiles` for one block: the template's
 * blockstate and the non-vanilla models it names (plus `includeModels`),
 * each rewritten by the addon's transformers.
 */
export function synthesizeModels(
  state: EcAddonState,
  match: EcBlockMatch,
): EcSynthesizedModels {
  const warnings: string[] = [];
  const base = baseBlockId(match);
  const template = state.world.blockstate(base);
  if (!isRecord(template)) {
    return {
      blockstate: null,
      models: {},
      warnings: [`The template block ${base} has no blockstate`],
    };
  }
  const blockId = EcResourceLocation.parse(match.blockId);
  const view: TypeView = state.view(match.type);
  const { model: modelT, blockstate: blockstateT } = transformers(state, match);
  const include = match.entry.includeModels;
  const modelIds = [...findAllResourcesInJson(template, (k) => k === "model")]
    .map(normalizeResourceId)
    .filter(
      (id) => namespaceOf(id) !== "minecraft" || include?.block.includes(id),
    );
  if (include?.generate) {
    for (const id of include.block)
      if (!modelIds.includes(id)) modelIds.push(id);
  }

  const models: Record<string, unknown> = {};
  for (const id of modelIds) {
    const model = state.world.model(id);
    if (!isRecord(model)) continue;
    try {
      const text = modelT.transformText(jsonText(model), blockId, view);
      const ns = namespaceOf(id);
      const path = modelT.transformPath(
        `models/${id.slice(ns.length + 1)}.json`,
        blockId,
        view,
      );
      const newId = `${blockId.namespace}:${path.replace(/^models\//, "").replace(/\.json$/, "")}`;
      models[newId] = JSON.parse(text);
    } catch (err) {
      warnings.push(`Model ${id}: ${(err as Error).message}`);
    }
  }
  let blockstate: unknown = null;
  try {
    blockstate = JSON.parse(
      blockstateT.transformText(jsonText(template), blockId, view),
    );
  } catch (err) {
    warnings.push(`Blockstate: ${(err as Error).message}`);
  }
  return { blockstate, models, warnings };
}

// ── Textures ─────────────────────────────────────────────────────────────

/** A table texture ref with `@:` resolved to the supported mod. */
function textureRef(ref: string, modId: string): string {
  return ref.startsWith("@:") ? `${modId}:${ref.slice(2)}` : ref;
}

const PREDICATES: Record<string, TexturePredicate> = {
  any: ANY_TEXTURE,
  side: LOOKS_LIKE_SIDE_LOG_TEXTURE,
  top: LOOKS_LIKE_TOP_LOG_TEXTURE,
  leaf: LOOKS_LIKE_LEAF_TEXTURE,
};

/** The texture a palette strategy reads for `type`, or null. */
export function strategyTarget(
  state: EcAddonState,
  strategyKey: string,
  type: DetectedBlockType,
): string | null {
  const spec = paletteStrategy(strategyKey);
  if (spec === undefined || spec.item) return null;
  const view = state.view(type);
  const main = mainChildKey(type.kind);
  let child = spec.child === "main" ? main : spec.child;
  if (
    spec.fallbackToMain &&
    view.getBlockOfThis(spec.fallbackWhenMissing ?? child) === null
  ) {
    child = main;
  }
  const block = view.getBlockOfThis(child);
  if (block === null) return null;
  return findFirstBlockTexture(
    state,
    block,
    PREDICATES[spec.predicate] ?? ANY_TEXTURE,
  );
}

/** The id `TextureGenHelper` gives `info`'s output for `match`. */
export function generatedTextureId(
  match: EcBlockMatch,
  info: EcTextureInfo,
): string {
  const blockId = EcResourceLocation.parse(match.blockId);
  const old = typeNameOf(match.entry.baseType);
  const source = EcResourceLocation.parse(
    textureRef(info.texture, match.registration.modId),
  );
  if (info.customPath !== undefined) {
    return blockId
      .withPath(
        replaceTypeNoNamespace(
          info.customPath,
          match.type.typeName,
          blockId,
          old,
        ),
      )
      .toString();
  }
  const newPath = replaceTypeNoNamespace(
    source.path,
    match.type.typeName,
    blockId,
    old,
  );
  return info.keepNamespace
    ? source.withPath(newPath).toString()
    : `${blockId.namespace}:${newPath}`;
}

/**
 * The recipes of a block's generated textures (`TextureGenHelper.
 * generateDefault`), skipping ids a loaded jar already ships ("add if not
 * present") and textures whose palette source is missing.
 */
export function textureRecipes(
  state: EcAddonState,
  match: EcBlockMatch,
  hasTexture: (id: string) => boolean,
): GeneratedTextureRecipe[] {
  const { entry, registration, type } = match;
  const infos = entry.textures ?? [];
  const modId = registration.modId;
  const merged: EcMergedTexture[] | undefined = entry.mergedPalette
    ? infos
        .filter((info) => !info.copyTexture)
        .map((info) => ({
          texture: textureRef(info.texture, modId),
          ...(info.mask ? { mask: textureRef(info.mask, modId) } : {}),
        }))
    : undefined;
  const recipes: GeneratedTextureRecipe[] = [];
  const seen = new Set<string>();
  for (const info of infos) {
    const id = generatedTextureId(match, info);
    if (seen.has(id) || hasTexture(id)) continue;
    seen.add(id);
    const strategy = info.palette ?? DEFAULT_PALETTE_STRATEGY;
    const target = strategyTarget(state, strategy, type);
    if (target === null) continue;
    const main = textureRef(info.texture, modId);
    const params: EcTextureParams = {
      target,
      strategy,
      typeId: type.id,
      ...(info.mask && !merged ? { mask: textureRef(info.mask, modId) } : {}),
      ...(info.overlay ? { overlay: textureRef(info.overlay, modId) } : {}),
      ...(info.copyTexture ? { copyTexture: true } : {}),
      ...(info.noAnimation ? { noAnimation: true } : {}),
      ...(merged && !info.copyTexture ? { mergedWith: merged } : {}),
    };
    const sources = new Set<string>([main, target]);
    if (params.mask) sources.add(params.mask);
    if (params.overlay) sources.add(params.overlay);
    for (const m of params.mergedWith ?? []) {
      const entryTexture = typeof m === "string" ? { texture: m } : m;
      sources.add(entryTexture.texture);
      if (entryTexture.mask) sources.add(entryTexture.mask);
    }
    recipes.push({ id, sources: [...sources], params: { main, ...params } });
  }
  return recipes;
}
