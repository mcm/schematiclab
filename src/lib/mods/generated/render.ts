// Render output of generated blocks for the 3D preview and the static
// renders: the providers' synthesized blockstates and models, their
// generated textures, and each resolved block's `appearance` computed from
// those textures.
//
// Generated textures are cached by `generatedTextureCacheKey` (provider,
// recipe sources and params, and which loaded file each source came from),
// so a rebuild for unrelated changes reuses them.
//
// Worker-safe: no DOM access.

import {
  averageTextureColor,
  blockAppearance,
  decodePng,
  firstFrameRegion,
  type TextureColor,
} from "../../render/block-appearance";
import { canonicalJson } from "../store";
import type { LoadedModMeta, ModBlock } from "../types";
import { generatedModelLookup } from "./model-lookup";
import { getGeneratedBlockProvider, loadGeneratedBlockFiles } from "./registry";
import type {
  GeneratedBlockFiles,
  GeneratedBlockProvider,
  GeneratedTextureImage,
  GeneratedTextureRecipe,
} from "./types";

export interface GeneratedBlockRender {
  /** Synthesized blockstates by block id. */
  blockstates: Record<string, unknown>;
  /** Synthesized models by id. */
  models: Record<string, unknown>;
  /** Generated textures by id (unusable recipes are left out). */
  textures: ReadonlyMap<string, GeneratedTextureImage>;
  /**
   * Resolved blocks, with `appearance` from their generated textures when
   * it resolves.
   */
  blocks: ReadonlyMap<string, ModBlock>;
}

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** True when a provider generates blocks in `blockId`'s namespace. */
export function isGeneratedBlockId(blockId: string): boolean {
  return getGeneratedBlockProvider(namespaceOf(blockId)) !== null;
}

/** Identity of the loaded file (or `vanilla`) a source texture is read from. */
function sourceFile(
  id: string,
  files: GeneratedBlockFiles,
): LoadedModMeta | "vanilla" | null {
  if (namespaceOf(id) === "minecraft") return "vanilla";
  // Later files win, as they do in the preview's atlas.
  for (let i = files.files.length - 1; i >= 0; i--) {
    const file = files.files[i];
    const textures = files.assets(file)?.textures;
    if (textures !== undefined && Object.hasOwn(textures, id)) return file;
  }
  return null;
}

/**
 * Cache key of a generated texture: the provider, the recipe's sources (each
 * with the identity of the file it is read from) and params. The recipe's
 * own id is left out, so equal recolourings share one entry.
 */
export function generatedTextureCacheKey(
  provider: string,
  recipe: GeneratedTextureRecipe,
  sourceVersion: (id: string) => string,
): string {
  return canonicalJson({
    provider,
    sources: recipe.sources.map((id) => [id, sourceVersion(id)]),
    params: recipe.params,
  });
}

function sourceVersion(files: GeneratedBlockFiles): (id: string) => string {
  return (id) => {
    const file = sourceFile(id, files);
    return file === null
      ? "missing"
      : file === "vanilla"
        ? "vanilla"
        : `${file.key}@${file.fileId}:${file.loadedAt}`;
  };
}

async function loadSourceTexture(
  id: string,
  files: GeneratedBlockFiles,
): Promise<GeneratedTextureImage | null> {
  const file = sourceFile(id, files);
  if (file === null) return null;
  if (file === "vanilla") {
    const image = files.vanilla?.texture(id) ?? null;
    return image === null ? null : { image };
  }
  const assets = files.assets(file);
  const blob = assets?.textures[id];
  if (assets == null || blob === undefined) return null;
  const image = decodePng(new Uint8Array(await blob.arrayBuffer()));
  if (image === null) return null;
  const meta = assets.textureMeta[id];
  return meta === undefined ? { image } : { image, meta };
}

// Generated textures by cache key. Bounded; the oldest entries go first.
const MAX_CACHED_TEXTURES = 4096;
const textureCache = new Map<string, Promise<GeneratedTextureImage | null>>();

async function generate(
  provider: GeneratedBlockProvider,
  recipe: GeneratedTextureRecipe,
  files: GeneratedBlockFiles,
): Promise<GeneratedTextureImage | null> {
  const sources = new Map<string, GeneratedTextureImage>();
  for (const id of recipe.sources) {
    const texture = await loadSourceTexture(id, files);
    if (texture !== null) sources.set(id, texture);
  }
  return provider.generateTexture(recipe, sources);
}

/** `provider`'s texture for `recipe`, generated once per cache key. */
export function generatedTexture(
  provider: GeneratedBlockProvider,
  recipe: GeneratedTextureRecipe,
  files: GeneratedBlockFiles,
): Promise<GeneratedTextureImage | null> {
  const key = generatedTextureCacheKey(
    provider.namespace,
    recipe,
    sourceVersion(files),
  );
  let texture = textureCache.get(key);
  if (texture === undefined) {
    texture = generate(provider, recipe, files).catch((err: unknown) => {
      console.warn(`Could not generate texture ${recipe.id}.`, err);
      return null;
    });
    textureCache.set(key, texture);
    if (textureCache.size > MAX_CACHED_TEXTURES) {
      textureCache.delete(textureCache.keys().next().value!);
    }
  }
  return texture;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `model` without `tintindex` on its faces: generated blocks aren't tinted
 * (UCW's `has_color` tinting isn't supported), whatever their source model
 * asks for.
 */
function untinted(model: unknown): unknown {
  if (!isRecord(model) || !Array.isArray(model.elements)) return model;
  return {
    ...model,
    elements: model.elements.map((element: unknown) => {
      if (!isRecord(element) || !isRecord(element.faces)) return element;
      const faces: Record<string, unknown> = {};
      for (const [direction, face] of Object.entries(element.faces)) {
        if (isRecord(face)) {
          const { tintindex: _tintindex, ...rest } = face;
          faces[direction] = rest;
        } else {
          faces[direction] = face;
        }
      }
      return { ...element, faces };
    }),
  };
}

/** A generated block's appearance from its synthesized models and textures. */
function generatedAppearance(
  blockId: string,
  blockstate: unknown,
  models: Readonly<Record<string, unknown>>,
  textures: ReadonlyMap<string, GeneratedTextureImage>,
  files: GeneratedBlockFiles,
) {
  const lookup = generatedModelLookup(files);
  const colors = new Map<string, TextureColor | null>();
  return blockAppearance(blockId, blockstate, {
    getModel: (id) =>
      untinted(Object.hasOwn(models, id) ? models[id] : lookup(id)),
    getTextureColor: (id) => {
      let color = colors.get(id);
      if (color === undefined) {
        const texture = textures.get(id);
        color =
          texture === undefined
            ? null
            : averageTextureColor(
                texture.image,
                firstFrameRegion(
                  texture.image.width,
                  texture.image.height,
                  texture.meta,
                ),
              );
        colors.set(id, color);
      }
      return color;
    },
  });
}

/**
 * Render output of the generated blocks among `blockIds`, against the files
 * loaded for `gameVersion`. Resolved blocks get their recoloured models and
 * textures; recognised blocks whose sources aren't loaded get the
 * provider's fallback models (e.g. the un-recoloured Chisel block) when it
 * has them; anything else is left out (the preview draws the missing cube).
 */
export async function loadGeneratedBlockRender(
  blockIds: Iterable<string>,
  gameVersion: string,
): Promise<GeneratedBlockRender> {
  const ids = [...new Set(blockIds)].filter(isGeneratedBlockId).sort();
  const blockstates: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  const textures = new Map<string, GeneratedTextureImage>();
  const blocks = new Map<string, ModBlock>();
  if (ids.length === 0) return { blockstates, models, textures, blocks };

  const files = await loadGeneratedBlockFiles(gameVersion);
  const resolved: { id: string; block: ModBlock; blockstate: unknown }[] = [];
  const pending: {
    id: string;
    texture: Promise<GeneratedTextureImage | null>;
  }[] = [];
  for (const id of ids) {
    const provider = getGeneratedBlockProvider(namespaceOf(id))!;
    const resolution = provider.resolve(id, {}, files);
    if (resolution.kind === "needs-mods") {
      if (resolution.fallbackModels !== undefined) {
        blockstates[id] = resolution.fallbackModels.blockstate;
        Object.assign(models, resolution.fallbackModels.models);
      }
      continue;
    }
    if (resolution.kind !== "resolved") continue;
    if (resolution.blockstate !== null) {
      blockstates[id] = resolution.blockstate;
      Object.assign(models, resolution.models);
    }
    resolved.push({
      id,
      block: resolution.block,
      blockstate: resolution.blockstate,
    });
    for (const recipe of resolution.textures) {
      pending.push({
        id: recipe.id,
        texture: generatedTexture(provider, recipe, files),
      });
    }
  }
  // The first recipe registering an id wins, as sprites do in 1.12.
  const generated = await Promise.all(pending.map((entry) => entry.texture));
  pending.forEach(({ id }, i) => {
    const texture = generated[i];
    if (texture !== null && !textures.has(id)) textures.set(id, texture);
  });

  for (const { id, block, blockstate } of resolved) {
    const appearance =
      blockstate === null
        ? undefined
        : generatedAppearance(id, blockstate, models, textures, files);
    blocks.set(id, appearance === undefined ? block : { ...block, appearance });
  }
  return { blockstates, models, textures, blocks };
}

// Test-only: forget generated textures.
export function __resetGeneratedTextureCacheForTests(): void {
  textureCache.clear();
}
