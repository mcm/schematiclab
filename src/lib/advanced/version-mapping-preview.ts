// Translation preview pass for the Version Mapping panel.
//
// Runs `translateBlockState` per source palette entry against a chosen target
// version, collects any warnings the translator emits via the existing
// `TranslateOptions.onWarning` callback, and returns a serializable summary
// that the editor's UI can render WITHOUT committing the translation to the
// in-memory schematic. US-015 is what actually applies the result via
// `applyVersionMapping` from `./edit`.
//
// "Problematic" follows US-013: any source `BlockState` whose translation
// emitted ≥1 warning. Everything else is "clean." Modded namespaces described
// by the `ModMappingContext` are validated (and rewritten, for replacement
// mods) against the target mod file instead of translated; see
// `./mod-mapping`. With a null target version only that modded pass runs.
//
// Camo states (the materials inside FramedBlocks / copycat block entities)
// are source states too. A camo state that's also a palette entry shares its
// row, and its slots add to the row's count. Camo warnings name the parent
// block state and the slot.
//
// Pure TS, no DOM, Worker-safe.

import type { ParsedSchematicProjection } from "../convert";
import { BlockState } from "../schemlib/blocks";
import { translateBlockState } from "../schemlib/data/translate";
import {
  camoWarning,
  type MinecraftVersion,
} from "../schemlib/schematic-formats/version-mapping";
import { extractCamoSlots, isCamoCapableBlockId } from "../camo/extract";
import { stateKey } from "../camo/write";
import {
  resolveModdedState,
  type ModdedProblemReason,
  type ModMappingContext,
} from "./mod-mapping";

export type ProblematicReason = "vanilla" | ModdedProblemReason;

// One row per source state the mapper flagged as problematic. The picker UI
// in US-013/014 will read this directly. Plain-object only — survives
// `postMessage` from the worker.
export interface ProblematicEntry {
  sourceBlockState: string;
  sourceBlockId: string;
  sourceProperties: Record<string, string>;
  sourceCount: number;
  proposedTargetBlockState: string;
  proposedTargetBlockId: string;
  proposedTargetProperties: Record<string, string>;
  warnings: string[];
  reason: ProblematicReason;
}

export interface VersionMappingPreview {
  // Null when only mod mapping runs (vanilla entries untouched).
  targetVersion: MinecraftVersion | null;
  // Number of source palette states whose translation emitted no warnings.
  cleanCount: number;
  // Number of source palette states whose translation emitted at least one
  // warning (i.e. `problematic.length`).
  problematicCount: number;
  problematic: ProblematicEntry[];
  // Number of source palette states whose target mod file is still loading.
  // Apply must wait until this is 0.
  pendingCount: number;
}

function propsRecordFromBlockState(state: BlockState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of state.Properties) out[k] = v;
  return out;
}

/**
 * Walk `schematic.palette` and translate each entry to `targetVersion`,
 * collecting per-entry warnings. The schematic is NOT mutated.
 *
 * If the source and target versions are identical, or `targetVersion` is
 * null, every vanilla entry is clean. Entries in a namespace of `mods` are
 * resolved by `resolveModdedState`.
 */
export function previewVersionMapping(
  schematic: ParsedSchematicProjection,
  targetVersion: MinecraftVersion | null,
  mods: ModMappingContext = {},
): VersionMappingPreview {
  const sourceVersion = schematic.minecraftVersion;

  // One row per distinct source state, palette entries first, in order.
  // `warnings` holds the translator's raw messages, which a palette state
  // reports as-is and a camo state reports per (parent state, slot).
  interface Row {
    entry: ProblematicEntry;
    // The state's target mod file is still loading.
    pending: boolean;
    inPalette: boolean;
    camoWarnings: Set<string>;
  }
  const rows = new Map<string, Row>();
  const rowFor = (
    blockState: string,
    blockId: string,
    properties: Record<string, string>,
  ): Row => {
    let row = rows.get(blockState);
    if (row !== undefined) return row;
    let target = { blockState, blockId, properties };
    let warnings: string[] = [];
    let reason: ProblematicReason = "vanilla";
    const modded = resolveModdedState(blockId, properties, mods);
    if (modded.status === "resolved") {
      target = {
        blockState: new BlockState({
          Name: modded.blockId,
          Properties: modded.properties,
        }).toString(),
        blockId: modded.blockId,
        properties: modded.properties,
      };
      if (modded.problem !== undefined) {
        warnings = [...modded.problem.warnings];
        reason = modded.problem.reason;
      }
    } else if (modded.status === "vanilla" && targetVersion !== null) {
      const translated = translateBlockState(
        new BlockState({ Name: blockId, Properties: properties }),
        sourceVersion,
        targetVersion,
        { onWarning: (message) => warnings.push(message) },
      );
      target = {
        blockState: translated.toString(),
        blockId: translated.Name,
        properties: propsRecordFromBlockState(translated),
      };
    }
    row = {
      entry: {
        sourceBlockState: blockState,
        sourceBlockId: blockId,
        sourceProperties: properties,
        sourceCount: 0,
        proposedTargetBlockState: target.blockState,
        proposedTargetBlockId: target.blockId,
        proposedTargetProperties: target.properties,
        warnings,
        reason,
      },
      pending: modded.status === "pending",
      inPalette: false,
      camoWarnings: new Set(),
    };
    rows.set(blockState, row);
    return row;
  };

  for (const paletteEntry of schematic.palette) {
    const row = rowFor(
      paletteEntry.blockState,
      paletteEntry.blockId,
      paletteEntry.properties,
    );
    row.entry.sourceCount += paletteEntry.count;
    row.inPalette = true;
  }

  for (const region of schematic.regions) {
    if (region.blockEntities.length === 0) continue;
    const indexAt = new Map<string, number>();
    for (const placement of region.blocks) {
      const blockId = schematic.palette[placement.paletteIndex].blockId;
      if (isCamoCapableBlockId(blockId)) {
        indexAt.set(placement.pos.join(","), placement.paletteIndex);
      }
    }
    for (const blockEntity of region.blockEntities) {
      const index = indexAt.get(blockEntity.pos.join(","));
      if (index === undefined) continue;
      const parent = schematic.palette[index];
      const slots = extractCamoSlots(
        parent.blockId,
        parent.properties,
        blockEntity.nbt,
      );
      for (const { slot, state, kind } of slots) {
        if (kind !== "block" || state === null) continue;
        const row = rowFor(
          stateKey(state.name, state.properties),
          state.name,
          state.properties,
        );
        row.entry.sourceCount += 1;
        for (const message of row.entry.warnings) {
          row.camoWarnings.add(camoWarning(parent.blockState, slot, message));
        }
      }
    }
  }

  let cleanCount = 0;
  let pendingCount = 0;
  const problematic: ProblematicEntry[] = [];
  for (const { entry, pending, inPalette, camoWarnings } of rows.values()) {
    if (pending) {
      pendingCount += 1;
      continue;
    }
    const warnings = [...(inPalette ? entry.warnings : []), ...camoWarnings];
    if (warnings.length === 0) {
      cleanCount += 1;
      continue;
    }
    problematic.push({ ...entry, warnings });
  }

  return {
    targetVersion,
    cleanCount,
    problematicCount: problematic.length,
    problematic,
    pendingCount,
  };
}

// Problematic rows for one block: every source state of `sourceBlockId` that
// maps to `proposedTargetBlockId` for the same reason. The panel decides a
// group as a whole, so e.g. a property dropped from every state of a block
// needs one decision rather than one per state.
export interface ProblematicGroup {
  // Stable within a preview: source id, target id and reason.
  key: string;
  sourceBlockId: string;
  proposedTargetBlockId: string;
  reason: ProblematicReason;
  // Sum of `sourceCount` over `entries`.
  totalCount: number;
  // Every entry's warnings, deduplicated, in first-seen order.
  warnings: string[];
  // In source palette order.
  entries: ProblematicEntry[];
}

/** Group problematic rows by block, keeping first-seen (palette) order. */
export function groupProblematicEntries(
  entries: readonly ProblematicEntry[],
): ProblematicGroup[] {
  const groups = new Map<string, ProblematicGroup>();
  for (const entry of entries) {
    const key = [
      entry.sourceBlockId,
      entry.proposedTargetBlockId,
      entry.reason,
    ].join("\u0000");
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        sourceBlockId: entry.sourceBlockId,
        proposedTargetBlockId: entry.proposedTargetBlockId,
        reason: entry.reason,
        totalCount: 0,
        warnings: [],
        entries: [],
      };
      groups.set(key, group);
    }
    group.totalCount += entry.sourceCount;
    for (const warning of entry.warnings) {
      if (!group.warnings.includes(warning)) group.warnings.push(warning);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}
