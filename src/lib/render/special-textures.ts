// Textures deepslate's hardcoded block-entity renderers (`SpecialRenderers`:
// chests, shulker boxes, banners, bells, heads, ...) request. They live
// outside the vanilla block atlas, so `scripts/build-minecraft-assets.mts`
// bundles them separately and the drift test checks every one is covered.
//
// Imports only `deepslate`, so the build script can load this file directly
// with `node --experimental-strip-types`.

import { BlockState, Identifier, SpecialRenderers, type UV } from "deepslate";

/**
 * deepslate still draws beds and signs as block entities from these textures,
 * on top of their block model. Minecraft 26.2 turned beds and signs into
 * block models and removed the textures (misode/deepslate#76), so when the
 * atlas lacks them they map to the transparent cell and deepslate's shader
 * discards those faces, leaving only the block model.
 */
export const SUPERSEDED_ENTITY_TEXTURE_PREFIXES: readonly string[] = [
  "minecraft:entity/bed/",
  "minecraft:entity/signs/",
];

export function isSupersededEntityTexture(id: string): boolean {
  return SUPERSEDED_ENTITY_TEXTURE_PREFIXES.some((prefix) =>
    id.startsWith(prefix),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `"facing=north,type=single"` → `{ facing: "north", type: "single" }`. */
function parseVariantKey(key: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const pair of key.split(",")) {
    const sep = pair.indexOf("=");
    if (sep > 0) properties[pair.slice(0, sep)] = pair.slice(sep + 1);
  }
  return properties;
}

/**
 * Every texture id (e.g. `minecraft:entity/chest/normal`) that deepslate's
 * special renderers request for any variant of the given vanilla blockstates
 * (keyed by block path, as in `blockstates.json`). Multipart blocks are
 * checked with default properties only. Block-entity NBT is never passed to
 * the preview, so NBT-driven textures (banner patterns) aren't included.
 */
export function specialRendererTextures(
  blockstates: Record<string, unknown>,
): Set<string> {
  const requested = new Set<string>();
  const recorder = {
    getTextureAtlas(): ImageData {
      throw new Error("not used while recording");
    },
    getTextureUV(id: Identifier): UV {
      requested.add(id.toString());
      return [0, 0, 1, 1];
    },
  };
  for (const [path, blockstate] of Object.entries(blockstates)) {
    const name = Identifier.create(path);
    const variants =
      isRecord(blockstate) && isRecord(blockstate.variants)
        ? Object.keys(blockstate.variants)
        : [""];
    for (const key of variants) {
      SpecialRenderers.getBlockMesh(
        new BlockState(name, parseVariantKey(key)),
        undefined,
        recorder,
        {},
      );
    }
  }
  return requested;
}
