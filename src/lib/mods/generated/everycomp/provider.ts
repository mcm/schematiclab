// The generated-block providers of the Every Compat family: Every Compat
// ("Wood Good", `everycomp:`), Stone Zone (`stonezone:`) and Gems Realm
// (`gemsrealm:`). They share one engine over the generated module tables:
// `state.ts` finds the entry set and block type of an id, `assets.ts`
// rewrites the supported mod's template block and lists texture recipes,
// and `texture/` recolours them.
//
// Supported for Minecraft 1.21 / 1.21.1 (the tables are read from the mods'
// 1.21 sources; `EC_GAME_VERSIONS`). The addon's own jar must be loaded: its
// masks and hand-made textures live there, and its loader picks the
// platform's modules.
//
// Worker-safe: no DOM access.

import type { ModBlock } from "../../types";
import { generatedAssetsSignature } from "../registry";
import type {
  GeneratedBlockFiles,
  GeneratedBlockProvider,
  GeneratedBlockResolution,
  GeneratedTextureRecipe,
} from "../types";
import { baseBlockId, synthesizeModels, textureRecipes } from "./assets";
import type { EcAddon, EcAddonTable } from "./entry-sets";
import {
  EC_GAME_VERSIONS,
  ecAddonState,
  entrySetName,
  makeEntryName,
  type EcAddonState,
  type EcBlockMatch,
  type EcEntryRef,
} from "./state";
import { EC_TABLES } from "./tables";
import { generateEcTexture, type EcTextureParams } from "./texture/generate";
import type { DetectedBlockType } from "./block-types/types";

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

function titleCase(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** Lang entries the addon's jar ships (`providerData[addon].lang`), if read. */
function addonLang(
  files: GeneratedBlockFiles,
  addon: EcAddon,
): Record<string, string> {
  const data = files.providerData(addon);
  if (typeof data !== "object" || data === null) return {};
  const lang = (data as { lang?: unknown }).lang;
  return typeof lang === "object" && lang !== null
    ? (lang as Record<string, string>)
    : {};
}

/**
 * The name the game shows: `block_type.<modId>.<entry set>` (e.g. "%s
 * Chair") from the addon's lang file with the type's readable name, else the
 * title-cased entry name.
 */
function displayName(
  state: EcAddonState,
  ref: EcEntryRef,
  type: DetectedBlockType,
): string {
  const lang = addonLang(state.files, state.table.addon);
  const template =
    lang[`block_type.${ref.registration.modId}.${entrySetName(ref.entry)}`];
  const typeName = titleCase(type.typeName);
  if (typeof template === "string" && template.includes("%s")) {
    return template.replace("%s", typeName);
  }
  return titleCase(makeEntryName(ref.entry, type.typeName));
}

/** The generated block's state properties: its template block's. */
function properties(
  state: EcAddonState,
  ref: EcEntryRef,
): Record<string, string[]> {
  const base = baseBlockId(ref);
  return state.files.blocks(namespaceOf(base)).get(base)?.properties ?? {};
}

function modBlock(state: EcAddonState, match: EcBlockMatch): ModBlock {
  return {
    id: match.blockId,
    displayName: displayName(state, match, match.type),
    properties: properties(state, match),
  };
}

/** True when a loaded jar ships texture `id` ("add if not present"). */
function textureShipped(files: GeneratedBlockFiles, id: string): boolean {
  for (const file of files.files) {
    const textures = files.assets(file)?.textures;
    if (textures !== undefined && Object.hasOwn(textures, id)) return true;
  }
  return false;
}

function supportedVersion(files: GeneratedBlockFiles): boolean {
  return EC_GAME_VERSIONS.includes(files.gameVersion);
}

function stateFor(
  table: EcAddonTable,
  files: GeneratedBlockFiles,
): EcAddonState {
  return ecAddonState(table, files, generatedAssetsSignature(files));
}

// Resolutions per state and block id (states are rebuilt when files change).
const resolutions = new WeakMap<
  EcAddonState,
  Map<string, GeneratedBlockResolution>
>();

function resolveInState(
  state: EcAddonState,
  id: string,
): GeneratedBlockResolution {
  const { table, files } = state;
  const match = state.addonFile === null ? null : state.match(id);
  if (match !== null) {
    const synthesized = synthesizeModels(state, match);
    const textures: GeneratedTextureRecipe[] = textureRecipes(
      state,
      match,
      (t) => textureShipped(files, t),
    );
    const compatModule = match.module;
    const warnings = [...synthesized.warnings];
    if (compatModule.customClientResources) {
      warnings.push(
        `${table.modName}'s ${match.registration.modId} module also draws some assets in code, which isn't ported`,
      );
    }
    for (const part of match.entry.unsupported ?? []) {
      warnings.push(`Not ported: ${part}`);
    }
    const sourceNamespaces = [
      ...new Set([match.registration.modId, match.type.namespace]),
    ]
      .filter((ns) => ns !== "minecraft")
      .sort();
    return {
      kind: "resolved",
      provider: table.addon,
      block: modBlock(state, match),
      blockstate: synthesized.blockstate,
      models: synthesized.models,
      textures,
      approximate: false,
      sourceNamespaces,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  // Recognised by name but not generated from the loaded files: which mods
  // are missing?
  const candidates = state.matchesFor(id, table.registrations);
  if (candidates.length === 0) return { kind: "unrecognised" };
  const best = candidates[0];
  const missing = new Set<string>();
  if (state.addonFile === null) missing.add(table.addon);
  if (!state.isModLoaded(best.ref.registration.modId)) {
    missing.add(best.ref.registration.modId);
  }
  if (best.type === null && !state.isModLoaded(best.typeNamespace)) {
    missing.add(best.typeNamespace);
  }
  for (const reg of [best.ref.registration]) {
    if (
      reg.requiresAnyOf &&
      !reg.requiresAnyOf.some((m) => state.isModLoaded(m))
    ) {
      missing.add(reg.requiresAnyOf[0]);
    }
  }
  missing.delete("minecraft");
  const template = baseBlockId(best.ref);
  const templateLoaded = files.blocks(namespaceOf(template)).has(template);
  return {
    kind: "needs-mods",
    provider: table.addon,
    namespaces: [...missing].sort(),
    sourceBlocks: [`${best.typeNamespace}:${best.typeName}`, template],
    ...(templateLoaded ? { fallback: { id: template, properties: {} } } : {}),
  };
}

function createProvider(table: EcAddonTable): GeneratedBlockProvider {
  return {
    namespace: table.addon,
    modName: table.modName,

    enumerate(files) {
      if (!supportedVersion(files)) return [];
      const state = stateFor(table, files);
      if (state.addonFile === null) return [];
      const blocks = new Map<string, ModBlock>();
      for (const ref of state.entryRefs()) {
        for (const type of state.typesOf(ref.entry.kind).values()) {
          const id = state.generatedBlock(ref, type);
          // The first registration of an id wins.
          if (id === null || blocks.has(id)) continue;
          blocks.set(id, modBlock(state, { ...ref, blockId: id, type }));
        }
      }
      return [...blocks.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
    },

    resolve(id, _properties, files) {
      if (namespaceOf(id) !== table.addon || !supportedVersion(files)) {
        return { kind: "unrecognised" };
      }
      const state = stateFor(table, files);
      let cache = resolutions.get(state);
      if (cache === undefined) {
        cache = new Map();
        resolutions.set(state, cache);
      }
      let resolution = cache.get(id);
      if (resolution === undefined) {
        resolution = resolveInState(state, id);
        cache.set(id, resolution);
      }
      return resolution;
    },

    generateTexture(recipe, sources) {
      const params = recipe.params as EcTextureParams & { main: string };
      const main = sources.get(params.main);
      if (main === undefined) return null;
      return generateEcTexture(main, sources, params);
    },
  };
}

export const EVERYCOMP_PROVIDER = createProvider(EC_TABLES.everycomp);
export const STONEZONE_PROVIDER = createProvider(EC_TABLES.stonezone);
export const GEMSREALM_PROVIDER = createProvider(EC_TABLES.gemsrealm);
