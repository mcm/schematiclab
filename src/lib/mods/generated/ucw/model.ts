// Port of Unlimited Chisel Works 0.3.5's model remapping
// (`UCWProxyClient.onTextureStitchPre`, `UCWVanillaModelRemapper.retexture`,
// `UCWUtils.toUcwGenerated`; https://github.com/asiekierka/UnlimitedChiselWorks,
// commit c458fc8). Copyright (c) 2017, 2018, 2019, 2021 Adrian Siekierka.
// Unlimited Chisel Works is licensed under the GNU Lesser General Public
// License v3.0 (or later); this port is a derivative of it under the same
// terms.
//
// A UCW block's state `j` draws the `through` block's state `j` model with
// every texture it uses replaced by a recoloured copy named
// `ucw_generated:ucw_ucw_<from id>_<from meta>/<ns>/<path>`. Chisel ≥ 1.0
// sets those textures in its blockstate variants (`textures`), which UCW
// remaps too. Here each state gets a synthesized model that parents the
// `through` model and sets every texture variable of the merged chain (and
// the variant's `textures`) to its generated copy, plus one texture recipe
// per copy. The source texture of `from`, `overlay` and `based_upon` is
// picked by `source-texture.ts` (`UCWMagic.getLocation`).
//
// Vanilla `through` blocks aren't drawn (no UCW rule uses one; their 1.12
// blockstates aren't in the vanilla bundle). Vanilla `from`, `overlay` and
// `based_upon` states are flattened (Forge 1.12 table, then the 1.13 flatten
// table) and read from the vanilla bundle, which has newer textures than
// 1.12.
//
// Worker-safe: no DOM access.

import {
  defaultStateModels,
  normalizeResourceId,
  resolveModel,
  type ResolvedModel,
} from "../../../render/block-appearance";
import { FLATTEN_TABLE } from "../../../schemlib/data/block-translations.generated";
import { FORGE_1_12_FLATTEN } from "../../../schemlib/data/forge-1.12-flatten.generated";
import {
  legacyBlockstateVariant,
  legacyVariantString,
  type LegacyBlockstateVariant,
} from "../legacy-blockstate";
import { generatedModelLookup } from "../model-lookup";
import type {
  GeneratedBlockFiles,
  GeneratedBlockModels,
  GeneratedTextureRecipe,
} from "../types";
import { chiselVariant } from "./chisel";
import type { UcwTextureParams } from "./recolour";
import {
  sanitizeUcwId,
  ucwFromStates,
  ucwMetaStates,
  ucwSourceBlock,
} from "./resolve";
import {
  parseUcwBlockState,
  UCW_NAMESPACE,
  type UcwBlockRule,
  type UcwBlockState,
  type UcwStateSource,
} from "./rules";
import { UCW_MISSING_TEXTURE, ucwSourceTexture } from "./source-texture";

/** Namespace of UCW's generated textures (`UCWUtils.toUcwGenerated`). */
export const UCW_GENERATED_TEXTURE_NAMESPACE = "ucw_generated";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** `lastFromBlockString + "_" + meta`: names a `from` state's textures. */
export function ucwTextureSuffix(fromBlock: string, fromMeta: number): string {
  return `${sanitizeUcwId(fromBlock)}_${fromMeta}`;
}

/** `UCWUtils.toUcwGenerated(texture, suffix)`. */
export function ucwGeneratedTextureId(texture: string, suffix: string): string {
  const id = normalizeResourceId(texture);
  const colon = id.indexOf(":");
  return `${UCW_GENERATED_TEXTURE_NAMESPACE}:ucw_ucw_${suffix}/${id.slice(0, colon)}/${id.slice(colon + 1)}`;
}

function modBlockstate(blockstateId: string, files: GeneratedBlockFiles) {
  const file = files.fileForNamespace(namespaceOf(blockstateId));
  const blockstates =
    file === null ? undefined : files.assets(file)?.blockstates;
  return blockstates !== undefined && Object.hasOwn(blockstates, blockstateId)
    ? blockstates[blockstateId]
    : undefined;
}

/**
 * The 1.12 blockstate variant of a modded state: Chisel blocks through
 * `chisel.ts`, others by their variant string in the blockstate named after
 * the block. Null for vanilla blocks and unknown states.
 */
export function ucwModdedVariant(
  state: UcwBlockState,
  files: GeneratedBlockFiles,
): LegacyBlockstateVariant | null {
  if (namespaceOf(state.block) === "minecraft") return null;
  const chisel = chiselVariant(state.block, state.properties);
  return chisel !== null
    ? legacyBlockstateVariant(
        modBlockstate(chisel.blockstate, files),
        chisel.variant,
      )
    : legacyBlockstateVariant(
        modBlockstate(state.block, files),
        legacyVariantString(state.properties),
      );
}

/** The variant's model with its parents merged and its `textures` applied. */
function variantModel(
  variant: LegacyBlockstateVariant,
  getModel: (id: string) => unknown,
): ResolvedModel {
  const model = resolveModel(variant.model, getModel);
  return {
    textures: { ...(model?.textures ?? {}), ...variant.textures },
    elements: model?.elements ?? null,
  };
}

/**
 * The 1.13+ vanilla state a 1.12 vanilla state flattens to, or null: the
 * first Forge 1.12 state of the block agreeing with the given properties,
 * through its legacy `id:meta`.
 */
export function flattenUcwVanillaState(
  state: UcwBlockState,
): { block: string; properties: Record<string, string> } | null {
  for (const [key, legacy] of Object.entries(FORGE_1_12_FLATTEN)) {
    const bracket = key.indexOf("[");
    if ((bracket < 0 ? key : key.slice(0, bracket)) !== state.block) continue;
    const known =
      bracket < 0
        ? {}
        : parseUcwBlockState(`${state.block}#${key.slice(bracket + 1, -1)}`)
            .properties;
    const agrees = Object.entries(state.properties).every(
      ([name, value]) => known[name] === value,
    );
    if (!agrees) continue;
    const flattened = FLATTEN_TABLE[legacy];
    if (flattened === undefined) return null;
    const open = flattened.indexOf("[");
    return open < 0
      ? { block: flattened, properties: {} }
      : {
          block: flattened.slice(0, open),
          properties: parseUcwBlockState(
            `${flattened.slice(0, open)}#${flattened.slice(open + 1, -1)}`,
          ).properties,
        };
  }
  return null;
}

/**
 * Port of `UCWMagic.getLocation` for a rule's state: the texture standing
 * for it, `minecraft:missingno` when its model is unknown.
 */
export function ucwStateTexture(
  state: UcwBlockState,
  files: GeneratedBlockFiles,
): string {
  const getModel = generatedModelLookup(files);
  if (namespaceOf(state.block) === "minecraft") {
    const flat = flattenUcwVanillaState(state);
    const blockstate =
      flat === null ? undefined : files.vanilla?.blockstate(flat.block);
    const modelId =
      flat === null
        ? undefined
        : defaultStateModels(blockstate, flat.properties)[0];
    return ucwSourceTexture({
      blockId: state.block,
      properties: state.properties,
      modelNamespace: "minecraft",
      model: modelId === undefined ? null : resolveModel(modelId, getModel),
    });
  }
  const variant = ucwModdedVariant(state, files);
  return ucwSourceTexture({
    blockId: state.block,
    properties: state.properties,
    modelNamespace: namespaceOf(state.block),
    model: variant === null ? null : variantModel(variant, getModel),
  });
}

/**
 * The state of `source` used with `from` metadata `fromMeta`: its only
 * state, else the one at that metadata (`overlay.get(i)`,
 * `basedUpon.get(i)`), else its first.
 */
function stateForMeta(
  source: UcwStateSource,
  fromMeta: number,
  files: GeneratedBlockFiles,
): UcwBlockState | null {
  const states = ucwFromStates(source, files);
  if (states.size === 1) return [...states.values()][0].state;
  const at = states.get(fromMeta);
  if (at !== undefined) return at.state;
  const first = [...states].sort(([a], [b]) => a - b)[0];
  return first === undefined ? null : first[1].state;
}

/** The `through` block's states, in metadata order (one `{}` when unknown). */
function throughStates(
  rule: UcwBlockRule,
  files: GeneratedBlockFiles,
): Record<string, string>[] {
  const block = ucwSourceBlock(rule.through);
  const states =
    ucwMetaStates(block, files)?.states.filter(
      (state): state is Record<string, string> => state !== null,
    ) ?? [];
  const seen = new Set<string>();
  const unique = states.filter((state) => {
    const key = legacyVariantString(state);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length > 0 ? unique : [{}];
}

/** A deepslate `variants` key: sorted `a=1,b=2`, `""` without properties. */
function variantsKey(properties: Readonly<Record<string, string>>): string {
  const variant = legacyVariantString(properties);
  return variant === "normal" ? "" : variant;
}

export interface UcwSynthesizedModels extends GeneratedBlockModels {
  /** Every texture the `through` models use (before remapping), sorted. */
  throughTextures: string[];
}

/**
 * Blockstate and models drawing every state of UCW block `id` as the
 * matching `through` state, with each concrete texture passed through
 * `remap` (identity for the un-recoloured fallback). Null when no `through`
 * state has a model.
 */
export function synthesizeUcwModels(
  id: string,
  rule: UcwBlockRule,
  files: GeneratedBlockFiles,
  remap: (texture: string) => string,
  kind: "generated" | "fallback",
): UcwSynthesizedModels | null {
  const block = ucwSourceBlock(rule.through);
  const getModel = generatedModelLookup(files);
  const path = id.slice(id.indexOf(":") + 1);
  const variants: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  const throughTextures = new Set<string>();
  for (const properties of throughStates(rule, files)) {
    const variant = ucwModdedVariant({ block, properties }, files);
    if (variant === null) continue;
    const textures: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      variantModel(variant, getModel).textures,
    )) {
      // Values that name another variable (`#all`) follow it.
      const sprite = isRecord(value) ? value.sprite : value;
      if (typeof sprite !== "string" || sprite.startsWith("#")) continue;
      const texture = normalizeResourceId(sprite);
      throughTextures.add(texture);
      textures[name] = remap(texture);
    }
    const key = variantsKey(properties);
    const modelId = `${UCW_NAMESPACE}:block/ucw_${kind}/${path}/${sanitizeUcwId(key) || "normal"}`;
    models[modelId] = { parent: variant.model, textures };
    variants[key] = {
      model: modelId,
      ...(variant.x !== undefined ? { x: variant.x } : {}),
      ...(variant.y !== undefined ? { y: variant.y } : {}),
      ...(variant.uvlock !== undefined ? { uvlock: variant.uvlock } : {}),
    };
  }
  if (Object.keys(variants).length === 0) return null;
  return {
    blockstate: { variants },
    models,
    throughTextures: [...throughTextures].sort(),
  };
}

/** Render output of a resolved UCW block: models plus texture recipes. */
export interface UcwRenderOutput extends GeneratedBlockModels {
  textures: GeneratedTextureRecipe[];
}

/**
 * The recoloured models and texture recipes of UCW block `id`, generated by
 * `rule` from the `from` state with metadata `fromMeta`. Null when the
 * `through` block can't be drawn.
 */
export function ucwRenderOutput(
  id: string,
  rule: UcwBlockRule,
  from: UcwBlockState,
  fromMeta: number,
  files: GeneratedBlockFiles,
): UcwRenderOutput | null {
  const suffix = ucwTextureSuffix(ucwSourceBlock(rule.from), fromMeta);
  const synthesized = synthesizeUcwModels(
    id,
    rule,
    files,
    (texture) => ucwGeneratedTextureId(texture, suffix),
    "generated",
  );
  if (synthesized === null) return null;

  const textureOf = (state: UcwBlockState | null) =>
    state === null ? UCW_MISSING_TEXTURE : ucwStateTexture(state, files);
  const fromTexture = textureOf(from);
  const overlayTexture =
    rule.overlay === undefined
      ? fromTexture
      : textureOf(stateForMeta(rule.overlay, fromMeta, files));
  const basedUponTexture = textureOf(
    stateForMeta(rule.basedUpon, fromMeta, files),
  );
  const textures = synthesized.throughTextures.map(
    (through): GeneratedTextureRecipe => {
      const params: UcwTextureParams = {
        through,
        from: fromTexture,
        overlay: overlayTexture,
        basedUpon: basedUponTexture,
        mode: rule.mode,
      };
      return {
        id: ucwGeneratedTextureId(through, suffix),
        sources: [
          ...new Set([through, fromTexture, overlayTexture, basedUponTexture]),
        ],
        params,
      };
    },
  );
  return {
    blockstate: synthesized.blockstate,
    models: synthesized.models,
    textures,
  };
}
