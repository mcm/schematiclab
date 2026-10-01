// Camo material swaps.
//
// Rewrites the camo slots whose material equals a source camo material,
// either under one parent palette entry ("Swap…") or under every camo block
// in the schematic ("Replace all"). The source can be the empty slots, which
// fills them, and the target can be null, which removes the camo. A camo
// block without a block entity (just swapped in) has all its slots empty, and
// filling one creates the block entity. Placements and the palette's block
// states are untouched; only block entities change, and the palette's
// camoMaterials are recomputed. The NBT itself is written by write.ts.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type {
  ParsedCamoMaterial,
  ParsedSchematicBlockEntity,
  ParsedSchematicProjection,
  ParsedSchematicRegion,
} from "../convert";
import type { CamoSlot } from "./extract";
import { isCamoCapableBlockId, placedCamoSlots } from "./extract";
import { withCamoMaterials } from "./materials";
import {
  camoWriteOptionsFor,
  newCamoBlockEntity,
  stateKey,
  writeCamoSlots,
  type CamoTarget,
} from "./write";

/** The camo material to replace, as listed in a palette entry's camoMaterials. */
export type CamoSwapSource = Pick<ParsedCamoMaterial, "kind" | "blockState">;

/** The new camo, or null to empty the slots. */
export type CamoSwapTarget = CamoTarget | null;

const posKey = (pos: readonly [number, number, number]) =>
  `${pos[0]},${pos[1]},${pos[2]}`;

function matchesSource(slot: CamoSlot, source: CamoSwapSource): boolean {
  if (source.kind === "empty") return slot.kind === "empty";
  return (
    slot.kind === source.kind &&
    slot.state !== null &&
    stateKey(slot.state.name, slot.state.properties) === source.blockState
  );
}

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
  if (
    target === null
      ? source.kind === "empty"
      : source.kind === "block" &&
        source.blockState === stateKey(target.blockId, target.properties)
  ) {
    return projection;
  }

  const inScope = projection.palette.map(
    (entry) =>
      isCamoCapableBlockId(entry.blockId) &&
      (scope.kind === "all" || entry.blockState === scope.parentBlockState),
  );
  if (!inScope.includes(true)) return projection;
  const options = camoWriteOptionsFor(projection.minecraftVersion);

  let changed = false;
  const regions: ParsedSchematicRegion[] = projection.regions.map((region) => {
    const indexAt = new Map(
      region.blockEntities.map((blockEntity, i) => [
        posKey(blockEntity.pos),
        i,
      ]),
    );
    let blockEntities: ParsedSchematicBlockEntity[] | null = null;
    for (const placement of region.blocks) {
      if (!inScope[placement.paletteIndex]) continue;
      const entry = projection.palette[placement.paletteIndex];
      const key = posKey(placement.pos);
      const index = indexAt.get(key);
      const existing =
        index === undefined ? undefined : region.blockEntities[index].nbt;
      const matching = new Set(
        placedCamoSlots(entry.blockId, entry.properties, existing)
          .filter((slot) => matchesSource(slot, source))
          .map(({ slot }) => slot),
      );
      if (matching.size === 0) continue;
      const base =
        existing ?? newCamoBlockEntity(entry.blockId, entry.properties);
      if (base === undefined) continue;
      const nbt = writeCamoSlots(
        entry.blockId,
        base,
        matching,
        target,
        options,
      );
      blockEntities ??= [...region.blockEntities];
      if (index === undefined) {
        indexAt.set(key, blockEntities.length);
        blockEntities.push({ pos: placement.pos, nbt });
      } else {
        blockEntities[index] = { pos: placement.pos, nbt };
      }
    }
    if (blockEntities === null) return region;
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
