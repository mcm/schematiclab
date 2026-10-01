// Pure swap-and-recount over a `ParsedSchematicProjection`. Given a source
// blockState (the full `Name + [sorted-props]` key) and a target block id +
// properties, returns a new projection in which every placement that pointed
// to the source is redirected to the target. The palette is rebuilt: counts
// recomputed, zero-count entries dropped, sort restored (count desc, ID asc).
//
// Positions are untouched — only the palette mapping changes. Block entities
// at swapped positions survive a property-only change (rotating a chest) and
// are dropped when the block id changes (chest → stone), since the inventory,
// sign text or camo no longer belongs to the new block. The exception is a
// camo block swapped to another camo block with the same block-entity type
// (framed panel → framed slab), which keeps its camo. A swap to a camo block
// can also put a camo on every swapped block (`camo`). Air-like targets
// effectively delete the source from the visible world (the placement row
// vanishes from the palette because its count drops to zero).

import type {
  ParsedSchematicPaletteEntry,
  ParsedSchematicProjection,
  ParsedSchematicRegion,
} from "./convert";
import { isInvisibleBlockId } from "./invisible-blocks";
import { keepsBlockEntity } from "./camo/block-entity-type";
import { withCamoMaterials } from "./camo/materials";
import {
  camoWriteOptionsFor,
  writeCamoChoice,
  type CamoChoice,
} from "./camo/write";

export interface SwapTarget {
  blockId: string;
  properties: Record<string, string>;
}

/** One source block state's swap, for `swapBlockStates`. */
export interface BlockStateSwap {
  sourceBlockState: string;
  target: SwapTarget;
  /** Camo for the swapped blocks, when the target is a camo block. */
  camo?: CamoChoice;
}

function posKey(pos: readonly [number, number, number]): string {
  return `${pos[0]},${pos[1]},${pos[2]}`;
}

function blockStateKey(target: SwapTarget): string {
  const keys = Object.keys(target.properties).sort();
  if (keys.length === 0) return target.blockId;
  const props = keys.map((k) => `${k}=${target.properties[k]}`).join(",");
  return `${target.blockId}[${props}]`;
}

export function swapBlockState(
  projection: ParsedSchematicProjection,
  sourceBlockState: string,
  target: SwapTarget,
  camo?: CamoChoice,
): ParsedSchematicProjection {
  const sourceIndex = projection.palette.findIndex(
    (entry) => entry.blockState === sourceBlockState,
  );
  // Caller is expected to pass a source that exists in the palette. If it
  // doesn't, return the projection unchanged so the editor's undo stack stays
  // consistent.
  if (sourceIndex === -1) return projection;

  const targetKey = blockStateKey(target);
  const keepBlockEntities = keepsBlockEntity(
    projection.palette[sourceIndex].blockId,
    target.blockId,
  );
  const camoOptions = camoWriteOptionsFor(projection.minecraftVersion);
  // The swapped blocks' block entities, with `camo` written in.
  const withCamo = (
    blockEntities: ParsedSchematicRegion["blockEntities"],
    swapped: ReadonlyMap<string, [number, number, number]>,
  ): ParsedSchematicRegion["blockEntities"] => {
    if (camo === undefined || swapped.size === 0) return blockEntities;
    const pending = new Map(swapped);
    const out = blockEntities.map((be) => {
      const key = posKey(be.pos);
      if (!pending.delete(key)) return be;
      const nbt = writeCamoChoice(
        target.blockId,
        target.properties,
        be.nbt,
        camo,
        camoOptions,
      );
      return nbt === undefined || nbt === be.nbt ? be : { pos: be.pos, nbt };
    });
    for (const pos of pending.values()) {
      const nbt = writeCamoChoice(
        target.blockId,
        target.properties,
        undefined,
        camo,
        camoOptions,
      );
      if (nbt !== undefined) out.push({ pos, nbt });
    }
    return out;
  };

  // Same state: nothing to swap, but the camo still goes on.
  if (targetKey === sourceBlockState) {
    if (camo === undefined) return projection;
    const regions = projection.regions.map((region) => {
      const positions = new Map(
        region.blocks
          .filter((placement) => placement.paletteIndex === sourceIndex)
          .map((placement) => [posKey(placement.pos), placement.pos] as const),
      );
      const blockEntities = withCamo(region.blockEntities, positions);
      return blockEntities === region.blockEntities
        ? region
        : { ...region, blockEntities };
    });
    return {
      ...projection,
      palette: withCamoMaterials(projection.palette, regions),
      regions,
    };
  }

  // Build a working palette: start from the existing entries, then make sure
  // the target exists (either reusing a matching entry or appending a new
  // one). We'll fix counts and sort order after rewriting placements.
  type Working = ParsedSchematicPaletteEntry & { workingIndex: number };
  const working: Working[] = projection.palette.map((entry, i) => ({
    ...entry,
    workingIndex: i,
  }));

  let targetWorkingIndex = working.findIndex(
    (entry) => entry.blockState === targetKey,
  );
  if (targetWorkingIndex === -1) {
    targetWorkingIndex = working.length;
    working.push({
      blockState: targetKey,
      blockId: target.blockId,
      properties: { ...target.properties },
      count: 0,
      workingIndex: targetWorkingIndex,
    });
  }

  // Rewrite placements: any placement whose paletteIndex === sourceIndex now
  // points to targetWorkingIndex. Source entry's count goes to zero.
  const indexRemap = new Array<number>(working.length);
  for (let i = 0; i < working.length; i += 1) indexRemap[i] = i;
  indexRemap[sourceIndex] = targetWorkingIndex;

  const counts = new Array<number>(working.length).fill(0);
  const newRegions: ParsedSchematicRegion[] = projection.regions.map(
    (region) => {
      const swapped = new Map<string, [number, number, number]>();
      const blocks = region.blocks.map((placement) => {
        const remapped = indexRemap[placement.paletteIndex];
        counts[remapped] += 1;
        if (remapped === placement.paletteIndex) return placement;
        swapped.set(posKey(placement.pos), placement.pos);
        return { pos: placement.pos, paletteIndex: remapped };
      });
      return {
        origin: region.origin,
        size: region.size,
        blocks,
        blockEntities: withCamo(
          keepBlockEntities
            ? region.blockEntities
            : region.blockEntities.filter((be) => !swapped.has(posKey(be.pos))),
          swapped,
        ),
      };
    },
  );

  // If the target is air-like, those placements still exist in the projection
  // but should be filtered out — air placements shouldn't survive in the
  // editor model. (The 3D preview already skips them; doing it here too keeps
  // the projection clean so a future export doesn't emit phantom air blocks.)
  const targetIsAir = isInvisibleBlockId(target.blockId);
  let regionsAfterAirFilter = newRegions;
  if (targetIsAir) {
    // Drop placements whose paletteIndex points at the target entry.
    regionsAfterAirFilter = newRegions.map((region) => ({
      ...region,
      blocks: region.blocks.filter(
        (placement) => placement.paletteIndex !== targetWorkingIndex,
      ),
    }));
    counts[targetWorkingIndex] = 0;
  }

  // Compact the palette: drop zero-count entries, build a final remap.
  const survivingIndices: number[] = [];
  for (let i = 0; i < working.length; i += 1) {
    if (counts[i] > 0) survivingIndices.push(i);
  }

  // Sort surviving entries by count desc, then blockId asc.
  survivingIndices.sort((a, b) => {
    const dc = counts[b] - counts[a];
    if (dc !== 0) return dc;
    return working[a].blockId.localeCompare(working[b].blockId);
  });

  const finalRemap = new Array<number>(working.length).fill(-1);
  survivingIndices.forEach((origIdx, finalIdx) => {
    finalRemap[origIdx] = finalIdx;
  });

  const finalPalette: ParsedSchematicPaletteEntry[] = survivingIndices.map(
    (i) => ({
      blockState: working[i].blockState,
      blockId: working[i].blockId,
      properties: working[i].properties,
      count: counts[i],
    }),
  );

  const finalRegions: ParsedSchematicRegion[] = regionsAfterAirFilter.map(
    (region) => ({
      ...region,
      blocks: region.blocks.map((placement) => ({
        pos: placement.pos,
        paletteIndex: finalRemap[placement.paletteIndex],
      })),
    }),
  );

  const totalBlocks = finalRegions.reduce(
    (sum, region) => sum + region.blocks.length,
    0,
  );

  return {
    name: projection.name,
    inputFormat: projection.inputFormat,
    minecraftVersion: projection.minecraftVersion,
    totalBlocks,
    palette: withCamoMaterials(finalPalette, finalRegions),
    regions: finalRegions,
  };
}

/**
 * `swapBlockState` for several source states at once, e.g. every state of
 * one block swapped to a camo block that keeps each state's properties.
 */
export function swapBlockStates(
  projection: ParsedSchematicProjection,
  swaps: readonly BlockStateSwap[],
): ParsedSchematicProjection {
  return swaps.reduce(
    (current, swap) =>
      swapBlockState(current, swap.sourceBlockState, swap.target, swap.camo),
    projection,
  );
}
