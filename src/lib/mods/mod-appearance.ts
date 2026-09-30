// Average colour and shape (`ModBlock.appearance`) for a mod's blocks.
//
// Pure and worker-safe. Models and textures come from the jar; parents and
// textures in the `minecraft` namespace come from the vanilla 3D-preview
// bundle (`vanilla-appearance-sources.ts`) when it is available. Runs in the
// mod-jar worker, both when a jar is parsed and when a mod loaded before
// appearances existed is backfilled (`appearance-backfill.ts`).

import {
  averageTextureColor,
  blockAppearance,
  decodePng,
  firstFrameRegion,
  type AppearanceSources,
  type BlockAppearance,
  type TextureColor,
} from "../render/block-appearance";

export interface ModAppearanceInput {
  blockIds: readonly string[];
  /** Block id → raw blockstate JSON. */
  blockstates: Record<string, unknown>;
  /** `<ns>:<path>` → raw model JSON. */
  models: Record<string, unknown>;
  /** `<ns>:<path>` (no `.png`) → PNG bytes. */
  textures: Record<string, Uint8Array>;
  /** Same keys as `textures` → parsed `.png.mcmeta` JSON, where present. */
  textureMeta: Record<string, unknown>;
}

/**
 * Appearance per block id, omitting blocks whose models or textures can't be
 * resolved. Without `vanilla`, blocks built on vanilla parents (`cube_all`, …)
 * or textures resolve only as far as the jar allows.
 */
export function computeModAppearances(
  input: ModAppearanceInput,
  vanilla: AppearanceSources | null = null,
): Record<string, BlockAppearance> {
  const textureColors = new Map<string, TextureColor | null>();
  const sources: AppearanceSources = {
    getModel: (id) =>
      Object.hasOwn(input.models, id)
        ? input.models[id]
        : vanilla?.getModel(id),
    getTextureColor: (id) => {
      if (!Object.hasOwn(input.textures, id)) {
        return vanilla?.getTextureColor(id) ?? null;
      }
      let color = textureColors.get(id);
      if (color === undefined) {
        const image = decodePng(input.textures[id]);
        color =
          image === null
            ? null
            : averageTextureColor(
                image,
                firstFrameRegion(
                  image.width,
                  image.height,
                  input.textureMeta[id],
                ),
              );
        textureColors.set(id, color);
      }
      return color;
    },
  };

  const out: Record<string, BlockAppearance> = {};
  for (const id of input.blockIds) {
    if (!Object.hasOwn(input.blockstates, id)) continue;
    const appearance = blockAppearance(id, input.blockstates[id], sources);
    if (appearance !== undefined) out[id] = appearance;
  }
  return out;
}
