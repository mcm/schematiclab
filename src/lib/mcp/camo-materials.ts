// Camo materials (`<frame>{camo=<block>}`) in the build tools and
// `generate_shape`: what a modpack allows as camo. A frame's camo is written
// only for the (namespace, Minecraft version) pairs in `CAMO_WRITE_VERSIONS`,
// and a camo must be one of the pack's camo materials (approximate: full
// cubes that aren't camo frames or known block-entity blocks).

import type { BlockData } from "../blockdata/load";
import type { CamoRules } from "../buildlang/materials";
import { camoFrameError, type CamoKey } from "../camo/material-syntax";
import type { CamoTarget } from "../camo/write";
import { camoWriteReason } from "../camo/write-versions";
import type { ModpackBlocks } from "../modpacks/registry";
import { parseMaterial } from "../shapes/generate";
import { blockColorsForVersion } from "./block-tools";
import { CAMO_MATERIAL_RULE, modpackCamoMaterials } from "./camo-options";

/** The camo rules of `modpack`; `data` is its Minecraft version's blocks. */
export function modpackCamoRules(
  modpack: ModpackBlocks,
  data: BlockData,
): CamoRules {
  let materials: ReturnType<typeof modpackCamoMaterials> | undefined;
  return {
    frame(id) {
      const namespace = id.slice(0, id.indexOf(":"));
      return camoWriteReason(namespace, modpack.minecraftVersion) ?? null;
    },
    material(id) {
      materials ??= modpackCamoMaterials(modpack, blockColorsForVersion(data));
      if (materials.has(id)) return null;
      return `${id} isn't a camo material in '${modpack.ref}'. Camo materials (${CAMO_MATERIAL_RULE}) are full-cube blocks that aren't camo frames or known block-entity blocks.`;
    },
  };
}

/**
 * The camo targets of a typed `{camo=...}` suffix (Shape Generator syntax:
 * `minecraft:` is the default namespace), each a pack block with valid
 * states (defaults filled in) that `rules` allows as camo. Throws otherwise.
 */
export function camoTargetsOf(
  camo: { camo: string; camo_two?: string },
  modpack: ModpackBlocks,
  rules: CamoRules,
): { camo: CamoTarget; camo_two?: CamoTarget } {
  const target = (text: string): CamoTarget => {
    const parsed = parseMaterial(text);
    if (!parsed.ok) throw new Error(`Camo: ${parsed.error}`);
    const { blockId, properties } = parsed.material;
    const list = Object.entries(properties)
      .map(([name, value]) => `${name}=${value}`)
      .join(",");
    const result = modpack.registry.validateState(
      list ? `${blockId}[${list}]` : blockId,
    );
    if (!result.ok) throw new Error(result.error);
    const error = rules.material(blockId);
    if (error) throw new Error(error);
    return {
      blockId,
      properties: { ...modpack.registry.defaults(blockId), ...properties },
    };
  };
  return {
    camo: target(camo.camo),
    ...(camo.camo_two !== undefined && { camo_two: target(camo.camo_two) }),
  };
}

/**
 * Throws unless the frame `blockId` holds the camo `keys` and `rules` let
 * the server write its camo.
 */
export function assertCamoFrame(
  blockId: string,
  properties: Record<string, string>,
  keys: readonly CamoKey[],
  rules: CamoRules,
): void {
  const error =
    camoFrameError(blockId, properties, keys) ?? rules.frame(blockId);
  if (error) throw new Error(error);
}
