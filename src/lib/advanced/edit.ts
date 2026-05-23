// Transform layer for in-memory schematic edits.
//
// One place that knows how to apply edits — block swaps and version-mapping
// results — to the editor's in-memory schematic model. The UI and the worker
// both call into this module rather than rewriting palettes / placements ad
// hoc at the call site.
//
// Pure TS: no DOM, no `window`, importable from a Web Worker module.

import type {
  ParsedSchematicPaletteEntry,
  ParsedSchematicProjection,
  ParsedSchematicRegion,
} from "../convert";
import { BlockState } from "../schemlib/blocks";
import { translateBlockState } from "../schemlib/data/translate";
import type { MinecraftVersion } from "../schemlib/schematic-formats/version-mapping";
import { isInvisibleBlockId } from "../invisible-blocks";

// ── Public types ──────────────────────────────────────────────────────────

// A schematic in the editor's in-memory form. Superset of the parser's
// projection: each region may optionally carry tile entities (chests, signs,
// banners, etc.). The parser doesn't populate tile entities yet; the field is
// declared here so the transform layer can preserve/drop them per the
// compatibility rule below as soon as the parser starts emitting them.
export interface SchematicTileEntity {
  pos: [number, number, number];
  blockId: string;
  data: Record<string, unknown>;
}

export interface SchematicRegion extends ParsedSchematicRegion {
  tileEntities?: SchematicTileEntity[];
}

export interface Schematic
  extends Omit<ParsedSchematicProjection, "regions"> {
  regions: SchematicRegion[];
}

export interface BlockStateTarget {
  blockId: string;
  properties: Record<string, string>;
}

// Overrides for `applyVersionMapping`. Keys are source `BlockState.toString()`
// strings (i.e. `Name[sorted=props]`). Each override replaces the target state
// the natural mapper would have produced for that source state.
export type VersionMappingOverrides = Record<string, BlockStateTarget>;

// ── Tile-entity compatibility ─────────────────────────────────────────────
//
// A tile entity is preserved across a state change iff the new block id (same
// thing as `BlockState.Name`, e.g. `minecraft:chest`) is identical to the old
// block id. Property-only changes (rotate a chest, open a door) keep the tile
// entity intact; a swap to a different block id (chest → stone) drops it
// because the inventory / sign text / etc. no longer makes sense on the new
// block.
function isTileEntityCompatible(
  oldBlockId: string,
  newBlockId: string,
): boolean {
  return oldBlockId === newBlockId;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function blockStateKey(blockId: string, properties: Record<string, string>): string {
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return blockId;
  const props = keys.map((k) => `${k}=${properties[k]}`).join(",");
  return `${blockId}[${props}]`;
}

function posKey(pos: readonly [number, number, number]): string {
  return `${pos[0]},${pos[1]},${pos[2]}`;
}

function propsRecordFromBlockState(state: BlockState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of state.Properties) out[k] = v;
  return out;
}

// ── applyBlockSwap ────────────────────────────────────────────────────────

/**
 * Redirect every placement whose state equals `sourceState` to `targetState`.
 *
 * - Returns a NEW `Schematic` with palette / placement counts updated across
 *   every region. The input is not mutated; downstream consumers are free to
 *   keep the prior reference (e.g. for undo).
 * - If the source isn't in the palette or the swap is a no-op, returns the
 *   input reference unchanged.
 * - Air-like targets (`minecraft:air`, `cave_air`, `void_air`,
 *   `structure_void`) cause the matching placements to be removed from the
 *   region rather than reappearing as visible air blocks.
 * - Tile entities at positions whose state actually changed are kept iff
 *   `isTileEntityCompatible(old.blockId, new.blockId)` returns true (same
 *   block id). Otherwise they're dropped from the result.
 */
export function applyBlockSwap(
  schematic: Schematic,
  sourceState: string,
  targetState: BlockStateTarget,
): Schematic {
  const sourceIndex = schematic.palette.findIndex(
    (entry) => entry.blockState === sourceState,
  );
  if (sourceIndex === -1) return schematic;

  const sourceBlockId = schematic.palette[sourceIndex].blockId;
  const targetKey = blockStateKey(targetState.blockId, targetState.properties);
  if (targetKey === sourceState) return schematic;

  const compatible = isTileEntityCompatible(sourceBlockId, targetState.blockId);
  const targetIsAir = isInvisibleBlockId(targetState.blockId);

  // Build a working palette: start from the existing entries, then ensure
  // there's an entry for the target (either reused or newly appended).
  type WorkingEntry = ParsedSchematicPaletteEntry & { workingIndex: number };
  const working: WorkingEntry[] = schematic.palette.map((entry, i) => ({
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
      blockId: targetState.blockId,
      properties: { ...targetState.properties },
      count: 0,
      workingIndex: targetWorkingIndex,
    });
  }

  // Remap source placements to the target index. Recount via a parallel
  // counts array — every placement contributes 1 to its (post-remap) entry.
  const indexRemap = new Array<number>(working.length);
  for (let i = 0; i < working.length; i += 1) indexRemap[i] = i;
  indexRemap[sourceIndex] = targetWorkingIndex;

  const counts = new Array<number>(working.length).fill(0);

  let remappedRegions = schematic.regions.map<SchematicRegion>((region) => {
    const blocks = region.blocks.map((placement) => {
      const remapped = indexRemap[placement.paletteIndex];
      counts[remapped] += 1;
      if (remapped === placement.paletteIndex) return placement;
      return { pos: placement.pos, paletteIndex: remapped };
    });
    return {
      origin: region.origin,
      size: region.size,
      blocks,
      ...(region.tileEntities !== undefined
        ? { tileEntities: region.tileEntities }
        : {}),
    };
  });

  // Air-like target: drop the swapped placements entirely so the editor doesn't
  // carry phantom air blocks. Likewise zero out the target's count so the
  // compaction step prunes the palette entry.
  if (targetIsAir) {
    remappedRegions = remappedRegions.map((region) => ({
      ...region,
      blocks: region.blocks.filter(
        (placement) => placement.paletteIndex !== targetWorkingIndex,
      ),
    }));
    counts[targetWorkingIndex] = 0;
  }

  // Filter tile entities at the positions that changed state. Positions that
  // changed are exactly the positions whose ORIGINAL paletteIndex === sourceIndex.
  remappedRegions = remappedRegions.map((region, regionIndex) => {
    const originalTEs = schematic.regions[regionIndex]?.tileEntities;
    if (!originalTEs || originalTEs.length === 0) return region;

    const originalRegion = schematic.regions[regionIndex];
    const changedPositions = new Set<string>();
    for (const placement of originalRegion.blocks) {
      if (placement.paletteIndex === sourceIndex) {
        changedPositions.add(posKey(placement.pos));
      }
    }

    const keptTEs = originalTEs.filter((te) => {
      if (!changedPositions.has(posKey(te.pos))) return true;
      // The block at this position became air → drop the tile entity regardless
      // (air can't hold one).
      if (targetIsAir) return false;
      return compatible;
    });

    return { ...region, tileEntities: keptTEs };
  });

  // Compact the palette: drop zero-count entries; sort survivors by count desc
  // then block id asc; rebuild placement indexes against the compacted list.
  const survivingIndices: number[] = [];
  for (let i = 0; i < working.length; i += 1) {
    if (counts[i] > 0) survivingIndices.push(i);
  }
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

  const finalRegions: SchematicRegion[] = remappedRegions.map((region) => ({
    ...region,
    blocks: region.blocks.map((placement) => ({
      pos: placement.pos,
      paletteIndex: finalRemap[placement.paletteIndex],
    })),
  }));

  const totalBlocks = finalRegions.reduce(
    (sum, region) => sum + region.blocks.length,
    0,
  );

  return {
    name: schematic.name,
    inputFormat: schematic.inputFormat,
    minecraftVersion: schematic.minecraftVersion,
    totalBlocks,
    palette: finalPalette,
    regions: finalRegions,
  };
}

// ── applyVersionMapping ───────────────────────────────────────────────────

/**
 * Translate every block state in the schematic to `targetVersion`.
 *
 * For each palette entry:
 *  - If `overrides[entry.blockState]` is present, the user's chosen target is
 *    used (and the natural mapper is bypassed for that source state).
 *  - Otherwise, the natural per-version diff walker (`translateBlockState`)
 *    computes the target state.
 *
 * The whole palette is rewritten in a single pass — chains like
 * `foo(source) → bar(natural) → baz(natural)` don't apply, because each source
 * entry is resolved against the original projection, not the intermediate
 * result. This is what "preserves the user's overrides" means: a user
 * override `foo → custom_block` stays as `custom_block` in the output, even
 * if the natural mapper would have re-translated `foo` or `custom_block`
 * further.
 *
 * Tile entities follow the same compatibility rule as `applyBlockSwap`:
 * preserved when the post-mapping block id equals the pre-mapping block id,
 * dropped otherwise.
 *
 * `schematic.minecraftVersion` is updated to `targetVersion` on the result.
 */
export function applyVersionMapping(
  schematic: Schematic,
  targetVersion: MinecraftVersion,
  overrides: VersionMappingOverrides = {},
): Schematic {
  const sourceVersion = schematic.minecraftVersion;
  const sourceCount = schematic.palette.length;

  // Step 1: compute the post-mapping state for every source palette entry.
  // Overrides win; otherwise the natural mapper runs.
  interface ResolvedTarget {
    key: string;
    blockId: string;
    properties: Record<string, string>;
  }
  const targetByIndex: ResolvedTarget[] = new Array(sourceCount);
  for (let i = 0; i < sourceCount; i += 1) {
    const entry = schematic.palette[i];
    const override = overrides[entry.blockState];
    if (override !== undefined) {
      const props = { ...override.properties };
      targetByIndex[i] = {
        key: blockStateKey(override.blockId, props),
        blockId: override.blockId,
        properties: props,
      };
      continue;
    }
    const source = new BlockState({
      Name: entry.blockId,
      Properties: entry.properties,
    });
    const translated = translateBlockState(source, sourceVersion, targetVersion);
    targetByIndex[i] = {
      key: translated.toString(),
      blockId: translated.Name,
      properties: propsRecordFromBlockState(translated),
    };
  }

  // Step 2: build the merged target palette plus a sourceIndex → workingIndex
  // remap. Two different source states that map to the same target merge into
  // one palette entry; their counts will be summed during placement rewriting.
  type WorkingEntry = {
    blockState: string;
    blockId: string;
    properties: Record<string, string>;
    count: number;
  };
  const byKey = new Map<string, number>();
  const working: WorkingEntry[] = [];
  const indexRemap = new Array<number>(sourceCount);
  for (let i = 0; i < sourceCount; i += 1) {
    const t = targetByIndex[i];
    let wIdx = byKey.get(t.key);
    if (wIdx === undefined) {
      wIdx = working.length;
      byKey.set(t.key, wIdx);
      working.push({
        blockState: t.key,
        blockId: t.blockId,
        properties: t.properties,
        count: 0,
      });
    }
    indexRemap[i] = wIdx;
  }

  // Step 3: rewrite placements through the remap, recount each working entry.
  const counts = new Array<number>(working.length).fill(0);
  let remappedRegions = schematic.regions.map<SchematicRegion>((region) => {
    const blocks = region.blocks.map((placement) => {
      const remapped = indexRemap[placement.paletteIndex];
      counts[remapped] += 1;
      return { pos: placement.pos, paletteIndex: remapped };
    });
    return {
      origin: region.origin,
      size: region.size,
      blocks,
      ...(region.tileEntities !== undefined
        ? { tileEntities: region.tileEntities }
        : {}),
    };
  });

  // Step 4: drop placements whose target state is air-like so the editor
  // doesn't carry phantom air blocks. Zero out the count so the air entry
  // gets pruned by the compaction step below.
  const airWorkingIndices = new Set<number>();
  for (let i = 0; i < working.length; i += 1) {
    if (isInvisibleBlockId(working[i].blockId)) airWorkingIndices.add(i);
  }
  if (airWorkingIndices.size > 0) {
    remappedRegions = remappedRegions.map((region) => ({
      ...region,
      blocks: region.blocks.filter(
        (placement) => !airWorkingIndices.has(placement.paletteIndex),
      ),
    }));
    for (const i of airWorkingIndices) counts[i] = 0;
  }

  // Step 5: tile-entity compatibility. For each original tile entity, look at
  // the block at its position in the source projection, then compare its
  // pre-mapping block id with its post-mapping block id; drop if they differ
  // (or if the post-mapping state is air).
  remappedRegions = remappedRegions.map((region, regionIndex) => {
    const originalRegion = schematic.regions[regionIndex];
    const originalTEs = originalRegion?.tileEntities;
    if (!originalTEs || originalTEs.length === 0) return region;

    // Build a position → original paletteIndex lookup so we can locate each
    // tile entity's pre-mapping state.
    const posToOriginalIndex = new Map<string, number>();
    for (const placement of originalRegion.blocks) {
      posToOriginalIndex.set(posKey(placement.pos), placement.paletteIndex);
    }

    const keptTEs = originalTEs.filter((te) => {
      const origIdx = posToOriginalIndex.get(posKey(te.pos));
      if (origIdx === undefined) return false; // tile entity with no block — drop.
      const oldBlockId = schematic.palette[origIdx].blockId;
      const newBlockId = working[indexRemap[origIdx]].blockId;
      if (isInvisibleBlockId(newBlockId)) return false;
      return isTileEntityCompatible(oldBlockId, newBlockId);
    });

    return { ...region, tileEntities: keptTEs };
  });

  // Step 6: compact + sort the palette.
  const survivingIndices: number[] = [];
  for (let i = 0; i < working.length; i += 1) {
    if (counts[i] > 0) survivingIndices.push(i);
  }
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

  const finalRegions: SchematicRegion[] = remappedRegions.map((region) => ({
    ...region,
    blocks: region.blocks.map((placement) => ({
      pos: placement.pos,
      paletteIndex: finalRemap[placement.paletteIndex],
    })),
  }));

  const totalBlocks = finalRegions.reduce(
    (sum, region) => sum + region.blocks.length,
    0,
  );

  return {
    name: schematic.name,
    inputFormat: schematic.inputFormat,
    minecraftVersion: targetVersion,
    totalBlocks,
    palette: finalPalette,
    regions: finalRegions,
  };
}
