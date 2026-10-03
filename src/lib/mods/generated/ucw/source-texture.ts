// Port of Unlimited Chisel Works 0.3.5 `pl.asie.ucw.UCWMagic.getLocation`
// (https://github.com/asiekierka/UnlimitedChiselWorks, commit c458fc8).
// Copyright (c) 2017, 2018, 2019, 2021 Adrian Siekierka. Unlimited Chisel
// Works is licensed under the GNU Lesser General Public License v3.0 (or
// later); this port is a derivative of it under the same terms.
//
// Picks the texture that stands for a block state (`from`, `overlay`,
// `basedUpon`) in the recolouring: Forestry and ExtraTrees planks by name,
// else a model's only texture, else the sprite of its first north-culled
// face, else its first texture.
//
// Worker-safe: no DOM access.

import {
  normalizeResourceId,
  type ResolvedModel,
} from "../../../render/block-appearance";

/** Texture id of Minecraft's missing texture (`TextureMap.LOCATION_MISSING_TEXTURE`). */
export const UCW_MISSING_TEXTURE = "minecraft:missingno";

/** Upper bound on `#var` hops, like the rest of the model code. */
const MAX_DEPTH = 32;

/** 1.12 `EnumFacing` order, which `BlockPart.mapFaces` (an `EnumMap`) iterates in. */
const FACINGS = ["down", "up", "north", "south", "west", "east"] as const;

export interface UcwSourceTextureInput {
  /** Registry id of the state's block, e.g. `forestry:planks.0`. */
  blockId: string;
  /** The state's properties. */
  properties: Readonly<Record<string, string>>;
  /** Namespace of the state's `ModelResourceLocation` (its blockstate file). */
  modelNamespace: string;
  /**
   * The state's model with its parent chain merged and the blockstate
   * variant's Forge `textures` applied (`resolveModel`), or null when it has
   * no model.
   */
  model: ResolvedModel | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `IModel.getTextures()` of a vanilla model: the distinct texture values that
 * aren't `#` references, in map order.
 */
export function ucwModelTextures(model: ResolvedModel): string[] {
  const textures = new Set<string>();
  for (const value of Object.values(model.textures)) {
    if (typeof value === "string" && !value.startsWith("#")) {
      textures.add(normalizeResourceId(value));
    }
  }
  return [...textures];
}

/**
 * `ModelBlock.resolveTextureName`: a face texture with or without its `#`,
 * followed through the texture variables; `missingno` when it doesn't
 * resolve.
 */
function resolveFaceTexture(
  texture: string,
  textures: Record<string, unknown>,
): string {
  let name = texture.startsWith("#") ? texture : `#${texture}`;
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const value = textures[name.slice(1)];
    if (typeof value !== "string") return UCW_MISSING_TEXTURE;
    if (!value.startsWith("#")) return normalizeResourceId(value);
    name = value;
  }
  return UCW_MISSING_TEXTURE;
}

/**
 * Texture of the first quad `getQuads(state, NORTH)` returns for the model
 * baked without rotation: the first face (elements in order, faces in
 * `EnumFacing` order) whose `cullface` is `north`. Null when there is none.
 */
function northFaceTexture(model: ResolvedModel): string | null {
  for (const element of model.elements ?? []) {
    if (!isRecord(element) || !isRecord(element.faces)) continue;
    for (const facing of FACINGS) {
      const face = element.faces[facing];
      if (!isRecord(face) || face.cullface !== "north") continue;
      return typeof face.texture === "string"
        ? resolveFaceTexture(face.texture, model.textures)
        : UCW_MISSING_TEXTURE;
    }
  }
  return null;
}

/** Forestry's and ExtraTrees' planks name their texture after the variant. */
function plankTexture(input: UcwSourceTextureInput): string | null {
  const { modelNamespace } = input;
  if (modelNamespace !== "forestry" && modelNamespace !== "extratrees") {
    return null;
  }
  const variant = input.properties.variant;
  if (variant === undefined) return null;
  const path = input.blockId.slice(input.blockId.indexOf(":") + 1);
  const dot = path.indexOf(".");
  if (dot < 0 || path.slice(0, dot) !== "planks") return null;
  return modelNamespace === "forestry"
    ? `forestry:blocks/wood/planks.${variant}`
    : `extratrees:blocks/planks/${variant}`;
}

/** Port of `UCWMagic.getLocation`: the texture id that stands for a state. */
export function ucwSourceTexture(input: UcwSourceTextureInput): string {
  const plank = plankTexture(input);
  if (plank !== null) return plank;

  const { model } = input;
  if (model === null) return UCW_MISSING_TEXTURE;
  const textures = ucwModelTextures(model);
  if (textures.length === 1) return textures[0];
  // Some mods have a skewed particle texture, so UCW prefers the north face.
  return northFaceTexture(model) ?? textures[0] ?? UCW_MISSING_TEXTURE;
}
