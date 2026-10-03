// Pure (DOM-free) assembly of the deepslate `Resources` used by the 3D
// preview: vanilla blockstates/models plus every loaded mod's, all flattened
// against one combined model provider, over a prebuilt texture atlas.
//
// Modded blocks that can't be rendered faithfully (no blockstate, missing or
// cyclic model, custom `loader` model, no geometry, missing texture) fall back
// to a full cube with the magenta/black "missing" texture so they never
// silently disappear from the preview. So do `minecraft:` ids the vanilla
// bundle doesn't know (blocks renamed or removed since the schematic's
// version, typos in a swap target).
//
// Generated blocks (Unlimited Chisel Works) come as provider-synthesized
// blockstates and models (`mods/generated/render.ts`) and render like mod
// blocks, with the same placeholder fallback.
//
// Camo-capable blocks (FramedBlocks, copycats) whose mod is loaded get a
// `CamoBlockDefinition` that renders their shape with their camo textures;
// without the mod they're the missing cube too.

import {
  BlockDefinition,
  BlockModel,
  Identifier,
  type BlockFlags,
  type Resources,
  type UV,
} from "deepslate";

import {
  MISSING_TEXTURE_ID,
  TRANSPARENT_TEXTURE_ID,
  qualifyId,
} from "./atlas-layout";
import { isCamoCapableBlockId } from "../camo/extract";
import {
  CamoBlockDefinition,
  camoBlockFlags,
  type CamoRenderContext,
} from "./camo/camo-definition";
import { getActiveCamoTable, type CamoTable } from "./camo/camo-table";
import type { ShapePack, ShapeRule } from "./camo/shape-pack";
import { isSupersededEntityTexture } from "./special-textures";

/** Model id of the placeholder cube. */
export const MISSING_MODEL_ID = "schematiclab:block/missing";

/** Max `parent` hops followed per mod model (guards against cycles). */
const MAX_PARENT_DEPTH = 32;

const PLACEHOLDER_FACE = { texture: "#all" };
const PLACEHOLDER_MODEL_JSON = {
  textures: { all: MISSING_TEXTURE_ID },
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        down: { ...PLACEHOLDER_FACE, cullface: "down" },
        up: { ...PLACEHOLDER_FACE, cullface: "up" },
        north: { ...PLACEHOLDER_FACE, cullface: "north" },
        south: { ...PLACEHOLDER_FACE, cullface: "south" },
        west: { ...PLACEHOLDER_FACE, cullface: "west" },
        east: { ...PLACEHOLDER_FACE, cullface: "east" },
      },
    },
  ],
};
const PLACEHOLDER_DEFINITION_JSON = {
  variants: { "": { model: MISSING_MODEL_ID } },
};

/** Vanilla blockstates + flattened models, built once and reused. */
export interface VanillaBlockData {
  /** Keyed by full block id, e.g. `minecraft:acacia_stairs`. */
  blockDefinitions: ReadonlyMap<string, BlockDefinition>;
  /** Keyed by full model id, e.g. `minecraft:block/cube_all`. */
  blockModels: ReadonlyMap<string, BlockModel>;
  opaque: ReadonlySet<string>;
}

/** Render assets of one loaded mod (plain JSON, never mutated). */
export interface ModBlockAssets {
  /** Block id → raw blockstate JSON. */
  blockstates: Record<string, unknown>;
  /** `<ns>:<path>` → raw model JSON. */
  models: Record<string, unknown>;
}

export interface AssembleResourcesInput {
  vanilla: VanillaBlockData;
  mods: readonly ModBlockAssets[];
  /**
   * Generated-block providers' synthesized blockstates and models; their
   * textures must be in `uvMap`. Take precedence over `mods` on id clashes.
   */
  generated?: readonly ModBlockAssets[];
  /**
   * Texture id → normalized UV; must contain `MISSING_TEXTURE_ID`. Without
   * `TRANSPARENT_TEXTURE_ID`, superseded entity textures render as missing.
   */
  uvMap: Readonly<Record<string, UV>>;
  atlasImage: ImageData;
  camo?: CamoResourcesInput;
}

export interface CamoResourcesInput {
  /**
   * Asset namespaces of loaded mods. Camo-capable blocks outside these
   * render as the missing cube. Defaults to the namespaces of `mods`'
   * blockstates.
   */
  loadedNamespaces?: ReadonlySet<string>;
  /** Loaded shape packs (`camo/pack-loader.ts`). */
  packs?: readonly ShapePack[];
  /** Table the structure's `__camo` values index; defaults to the active one. */
  getTable?: () => CamoTable | null;
}

export interface AssembledResources {
  resources: Resources;
  /** Mod block ids (with a blockstate) that render as the placeholder cube. */
  placeholderBlocks: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `BlockModel.fromJson`, but first reduces 1.21.4+ texture objects
 * (`{ "sprite": "ns:path", "force_translucent": true }`) to their sprite id,
 * since deepslate only understands plain string texture values.
 */
function blockModelFromJson(data: unknown): BlockModel {
  if (!isRecord(data) || !isRecord(data.textures)) {
    return BlockModel.fromJson(data);
  }
  const textures: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data.textures)) {
    const sprite = isRecord(value) ? value.sprite : value;
    if (typeof sprite === "string") textures[key] = sprite;
  }
  return BlockModel.fromJson({ ...data, textures });
}

/**
 * Build vanilla block data from the static asset bundle. `models` keys are
 * paths under `models/block/` (e.g. `cube_all`); `blockstates` keys are block
 * paths (e.g. `stone`). Models are flattened here once.
 */
export function createVanillaBlockData(
  blockstates: Record<string, unknown>,
  models: Record<string, unknown>,
  opaque: readonly string[],
): VanillaBlockData {
  const blockDefinitions = new Map<string, BlockDefinition>();
  for (const [path, data] of Object.entries(blockstates)) {
    blockDefinitions.set(`minecraft:${path}`, BlockDefinition.fromJson(data));
  }
  // Vanilla model parents reference ids like `minecraft:block/cube_all`, so
  // keys include the `block/` prefix.
  const blockModels = new Map<string, BlockModel>();
  for (const [path, data] of Object.entries(models)) {
    blockModels.set(`minecraft:block/${path}`, blockModelFromJson(data));
  }
  const provider = {
    getBlockModel: (id: Identifier) => blockModels.get(id.toString()) ?? null,
  };
  for (const model of blockModels.values()) model.flatten(provider);
  return { blockDefinitions, blockModels, opaque: new Set(opaque) };
}

/**
 * Model references (as written) that deepslate would render for a blockstate,
 * or null if the blockstate has neither `variants` nor `multipart` (e.g. a
 * Forge 1.12 `forge_marker` file).
 */
export function blockstateModelRefs(blockstate: unknown): string[] | null {
  if (!isRecord(blockstate)) return null;
  const refs: string[] = [];
  const addVariant = (variant: unknown): boolean => {
    // deepslate's `getModelVariants` only ever renders the first weighted
    // choice, so later entries are never meshed and needn't validate.
    const first = Array.isArray(variant) ? (variant[0] as unknown) : variant;
    if (!isRecord(first) || typeof first.model !== "string") return false;
    refs.push(first.model);
    return true;
  };
  if (isRecord(blockstate.variants)) {
    for (const variant of Object.values(blockstate.variants)) {
      if (!addVariant(variant)) return null;
    }
    return refs;
  }
  if (Array.isArray(blockstate.multipart)) {
    for (const part of blockstate.multipart as unknown[]) {
      if (!isRecord(part) || !addVariant(part.apply)) return null;
    }
    return refs;
  }
  return null;
}

/**
 * Collect mod model JSON (deep-cloned, since deepslate's `flatten` mutates it)
 * and drop models that can't resolve: custom `loader` models, missing or
 * cyclic parents, and anything inheriting from those.
 */
function resolvableModModels(
  mods: readonly ModBlockAssets[],
  vanillaModels: ReadonlyMap<string, BlockModel>,
): Map<string, Record<string, unknown>> {
  const raw = new Map<string, unknown>();
  for (const mod of mods) {
    for (const [id, json] of Object.entries(mod.models)) {
      const qualified = qualifyId(id);
      // Mods may not override vanilla assets.
      if (qualified.startsWith("minecraft:")) continue;
      raw.set(qualified, json);
    }
  }

  const ok = new Map<string, boolean>();
  const check = (id: string, depth: number): boolean => {
    const known = ok.get(id);
    if (known !== undefined) return known;
    if (vanillaModels.has(id)) return true;
    if (depth > MAX_PARENT_DEPTH) return false;
    const json = raw.get(id);
    let result: boolean;
    if (!isRecord(json) || typeof json.loader === "string") {
      result = false;
    } else if (json.parent === undefined) {
      result = true;
    } else if (typeof json.parent !== "string") {
      result = false;
    } else {
      // Provisionally false so a cycle resolves to "unresolvable".
      ok.set(id, false);
      result = check(qualifyId(json.parent), depth + 1);
    }
    ok.set(id, result);
    return result;
  };

  const out = new Map<string, Record<string, unknown>>();
  for (const [id, json] of raw) {
    if (check(id, 0)) {
      out.set(id, structuredClone(json) as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * True if every model the blockstate renders exists, has geometry, and only
 * references textures present in `uvMap`. Meshes each model once against a
 * recording atlas to see exactly which textures deepslate would request.
 */
function isRenderableBlockstate(
  blockstate: unknown,
  getModel: (id: string) => BlockModel | null,
  uvMap: Readonly<Record<string, UV>>,
): boolean {
  const refs = blockstateModelRefs(blockstate);
  if (refs === null || refs.length === 0) return false;
  const noCull = {};
  for (const ref of new Set(refs.map(qualifyId))) {
    const model = getModel(ref);
    if (model === null) return false;
    let missingTexture = false;
    const recorder = {
      getTextureAtlas(): ImageData {
        throw new Error("not used during validation");
      },
      getTextureUV(id: Identifier): UV {
        if (!(id.toString() in uvMap)) missingTexture = true;
        return [0, 0, 1, 1];
      },
    };
    try {
      const mesh = model.getMesh(recorder, noCull);
      if (mesh.isEmpty() || missingTexture) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Assemble a deepslate `Resources` from vanilla data, loaded mods' assets and
 * a prebuilt atlas. Any block id without a renderable blockstate resolves
 * to the placeholder cube.
 */
export function assembleResources(
  input: AssembleResourcesInput,
): AssembledResources {
  const { vanilla, uvMap, atlasImage, camo = {} } = input;
  const mods = [...input.mods, ...(input.generated ?? [])];

  const modModels = new Map<string, BlockModel>();
  for (const [id, json] of resolvableModModels(mods, vanilla.blockModels)) {
    modModels.set(id, blockModelFromJson(json));
  }
  const placeholderModel = BlockModel.fromJson(
    structuredClone(PLACEHOLDER_MODEL_JSON),
  );
  const getModel = (id: string): BlockModel | null =>
    id === MISSING_MODEL_ID
      ? placeholderModel
      : (vanilla.blockModels.get(id) ?? modModels.get(id) ?? null);
  const modelProvider = {
    getBlockModel: (id: Identifier) => getModel(id.toString()),
  };
  // Vanilla models are already flattened, so this only resolves mod chains
  // (which may parent vanilla models such as `minecraft:block/cube_all`).
  // `flatten` throws on malformed shapes (e.g. a string `textures`); drop
  // those so blocks using them fall back to the placeholder.
  for (const [id, model] of modModels) {
    try {
      model.flatten(modelProvider);
    } catch {
      modModels.delete(id);
    }
  }

  const placeholder = BlockDefinition.fromJson(PLACEHOLDER_DEFINITION_JSON);
  const modDefinitions = new Map<string, BlockDefinition>();
  const placeholderBlocks: string[] = [];
  for (const mod of mods) {
    for (const [id, blockstate] of Object.entries(mod.blockstates)) {
      const qualified = qualifyId(id);
      if (qualified.startsWith("minecraft:")) continue;
      if (isCamoCapableBlockId(qualified)) continue;
      if (isRenderableBlockstate(blockstate, getModel, uvMap)) {
        modDefinitions.set(qualified, BlockDefinition.fromJson(blockstate));
      } else {
        modDefinitions.set(qualified, placeholder);
        placeholderBlocks.push(qualified);
      }
    }
  }

  const missingUv = uvMap[MISSING_TEXTURE_ID];
  const transparentUv = uvMap[TRANSPARENT_TEXTURE_ID] ?? missingUv;
  // deepslate's shader insets UVs by half of this scalar on both axes. The
  // atlas may be non-square once mod textures are packed in, so use the
  // smaller per-axis texel (larger dimension): the larger one would inset the
  // short axis by several texels and collapse whole textures to one row.
  const pixelSize = 1 / Math.max(atlasImage.width, atlasImage.height);
  const placeholderFlags: BlockFlags = { opaque: true };

  const loadedNamespaces =
    camo.loadedNamespaces ??
    new Set(
      input.mods.flatMap((mod) =>
        Object.keys(mod.blockstates).map((id) => qualifyId(id).split(":")[0]),
      ),
    );
  const shapeRules = new Map<string, ShapeRule[]>();
  for (const pack of camo.packs ?? []) {
    for (const [id, rules] of Object.entries(pack.blocks)) {
      shapeRules.set(id, rules);
    }
  }
  const getTable = camo.getTable ?? getActiveCamoTable;
  const getDefinition = (key: string): BlockDefinition =>
    vanilla.blockDefinitions.get(key) ??
    modDefinitions.get(key) ??
    camoDefinition(key) ??
    placeholder;
  const camoContext: CamoRenderContext = {
    getBlockDefinition: getDefinition,
    isOpaqueBlock: (id) => vanilla.opaque.has(id),
    getTable,
  };
  const camoDefinitions = new Map<string, CamoBlockDefinition | null>();
  // The camo definition of a camo-capable id whose mod is loaded, else null.
  function camoDefinition(key: string): CamoBlockDefinition | null {
    let definition = camoDefinitions.get(key);
    if (definition === undefined) {
      definition =
        isCamoCapableBlockId(key) && loadedNamespaces.has(key.split(":")[0])
          ? new CamoBlockDefinition(
              key,
              shapeRules.get(key) ?? null,
              camoContext,
            )
          : null;
      camoDefinitions.set(key, definition);
    }
    return definition;
  }

  const resources: Resources = {
    getBlockDefinition(id: Identifier) {
      return getDefinition(id.toString());
    },
    getBlockModel(id: Identifier) {
      return getModel(id.toString());
    },
    getTextureAtlas() {
      return atlasImage;
    },
    getTextureUV(id: Identifier) {
      const key = id.toString();
      const uv = uvMap[key];
      if (uv !== undefined) return uv;
      return isSupersededEntityTexture(key) ? transparentUv : missingUv;
    },
    getPixelSize() {
      return pixelSize;
    },
    getBlockFlags(id: Identifier): BlockFlags | null {
      const key = id.toString();
      if (vanilla.blockDefinitions.has(key)) {
        return { opaque: vanilla.opaque.has(key) };
      }
      const camoDef = camoDefinition(key);
      if (camoDef !== null) return camoBlockFlags(camoDef, getTable());
      const definition = modDefinitions.get(key);
      return definition === undefined || definition === placeholder
        ? placeholderFlags
        : { opaque: false };
    },
    getBlockProperties() {
      return null;
    },
    getDefaultBlockProperties() {
      return null;
    },
  };

  return { resources, placeholderBlocks: placeholderBlocks.sort() };
}
