// Pure swap-and-recount over a `ParsedSchematicProjection`. Given a source
// blockState (the full `Name + [sorted-props]` key) and a target block id +
// properties, returns a new projection in which every placement that pointed
// to the source is redirected to the target. The palette is rebuilt: counts
// recomputed, zero-count entries dropped, sort restored (count desc, ID asc).
//
// Positions and tile-entity associations on each placement are untouched —
// only the palette mapping changes. Air-like targets effectively delete the
// source from the visible world (the placement row vanishes from the palette
// because its count drops to zero).

import type {
  ParsedSchematicPaletteEntry,
  ParsedSchematicProjection,
  ParsedSchematicRegion,
} from "./convert";
import { isInvisibleBlockId } from "./invisible-blocks";

export interface SwapTarget {
  blockId: string;
  properties: Record<string, string>;
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
): ParsedSchematicProjection {
  const sourceIndex = projection.palette.findIndex(
    (entry) => entry.blockState === sourceBlockState,
  );
  // Caller is expected to pass a source that exists in the palette. If it
  // doesn't, return the projection unchanged so the editor's undo stack stays
  // consistent.
  if (sourceIndex === -1) return projection;

  const targetKey = blockStateKey(target);
  // If the swap is a no-op (target equals source), short-circuit.
  if (targetKey === sourceBlockState) return projection;

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
    (region) => ({
      origin: region.origin,
      size: region.size,
      blocks: region.blocks.map((placement) => {
        const remapped = indexRemap[placement.paletteIndex];
        counts[remapped] += 1;
        if (remapped === placement.paletteIndex) return placement;
        return { pos: placement.pos, paletteIndex: remapped };
      }),
    }),
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
      origin: region.origin,
      size: region.size,
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
      origin: region.origin,
      size: region.size,
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
    palette: finalPalette,
    regions: finalRegions,
  };
}
