// Camo material swaps.
//
// Rewrites the camo slots whose material equals a source camo state, either
// under one parent palette entry ("Swap…") or under every camo block in the
// schematic ("Replace all"). Placements and the palette's block states are
// untouched; only block-entity NBT changes, and the palette's camoMaterials
// are recomputed. The NBT itself is written by write.ts.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type {
  ParsedCamoMaterial,
  ParsedSchematicProjection,
  ParsedSchematicRegion,
} from "../convert";
import { extractCamoSlots, isCamoCapableBlockId } from "./extract";
import { withCamoMaterials } from "./materials";
import { stateKey, writeCamoSlots, type CamoTarget } from "./write";

/** The camo material to replace, as listed in a palette entry's camoMaterials. */
export type CamoSwapSource = Pick<ParsedCamoMaterial, "kind" | "blockState">;

export type CamoSwapTarget = CamoTarget;

const posKey = (pos: readonly [number, number, number]) =>
  `${pos[0]},${pos[1]},${pos[2]}`;

/**
 * "parent" changes only the slots under the palette entry with block state
 * `parentBlockState`; "all" changes every camo slot in the schematic.
 */
export type CamoSwapScope =
  | { kind: "parent"; parentBlockState: string }
  | { kind: "all" };

/**
 * `projection` with every camo slot in `scope` whose material is `source`
 * changed to `target`. Returns `projection` itself when nothing matches or
 * the target is the source.
 */
export function swapCamoMaterial(
  projection: ParsedSchematicProjection,
  source: CamoSwapSource,
  target: CamoSwapTarget,
  scope: CamoSwapScope,
): ParsedSchematicProjection {
  const targetKey = stateKey(target.blockId, target.properties);
  if (source.kind === "block" && source.blockState === targetKey) {
    return projection;
  }

  const inScope = projection.palette.map(
    (entry) =>
      isCamoCapableBlockId(entry.blockId) &&
      (scope.kind === "all" || entry.blockState === scope.parentBlockState),
  );
  if (!inScope.includes(true)) return projection;

  let changed = false;
  const regions: ParsedSchematicRegion[] = projection.regions.map((region) => {
    if (region.blockEntities.length === 0) return region;
    const indexAt = new Map<string, number>();
    for (const placement of region.blocks) {
      if (inScope[placement.paletteIndex]) {
        indexAt.set(posKey(placement.pos), placement.paletteIndex);
      }
    }
    let regionChanged = false;
    const blockEntities = region.blockEntities.map((blockEntity) => {
      const index = indexAt.get(posKey(blockEntity.pos));
      if (index === undefined) return blockEntity;
      const entry = projection.palette[index];
      const matching = new Set(
        extractCamoSlots(entry.blockId, entry.properties, blockEntity.nbt)
          .filter(
            ({ kind, state }) =>
              kind === source.kind &&
              state !== null &&
              stateKey(state.name, state.properties) === source.blockState,
          )
          .map(({ slot }) => slot),
      );
      if (matching.size === 0) return blockEntity;
      regionChanged = true;
      return {
        pos: blockEntity.pos,
        nbt: writeCamoSlots(entry.blockId, blockEntity.nbt, matching, target),
      };
    });
    if (!regionChanged) return region;
    changed = true;
    return { ...region, blockEntities };
  });
  if (!changed) return projection;

  return {
    ...projection,
    palette: withCamoMaterials(projection.palette, regions),
    regions,
  };
}
