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
// emitted ≥1 warning. Everything else is "clean."
//
// Pure TS, no DOM, Worker-safe.

import type { ParsedSchematicProjection } from "../convert";
import { BlockState } from "../schemlib/blocks";
import { translateBlockState } from "../schemlib/data/translate";
import type { MinecraftVersion } from "../schemlib/schematic-formats/version-mapping";

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
}

export interface VersionMappingPreview {
  targetVersion: MinecraftVersion;
  // Number of source palette states whose translation emitted no warnings.
  cleanCount: number;
  // Number of source palette states whose translation emitted at least one
  // warning (i.e. `problematic.length`).
  problematicCount: number;
  problematic: ProblematicEntry[];
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
 * If the source and target versions are identical, every entry is treated as
 * clean (the translator short-circuits).
 */
export function previewVersionMapping(
  schematic: ParsedSchematicProjection,
  targetVersion: MinecraftVersion,
): VersionMappingPreview {
  const sourceVersion = schematic.minecraftVersion;

  let cleanCount = 0;
  const problematic: ProblematicEntry[] = [];

  for (const entry of schematic.palette) {
    const warnings: string[] = [];
    const source = new BlockState({
      Name: entry.blockId,
      Properties: entry.properties,
    });
    const translated = translateBlockState(
      source,
      sourceVersion,
      targetVersion,
      {
        onWarning: (message) => {
          warnings.push(message);
        },
      },
    );

    if (warnings.length === 0) {
      cleanCount += 1;
      continue;
    }

    problematic.push({
      sourceBlockState: entry.blockState,
      sourceBlockId: entry.blockId,
      sourceProperties: entry.properties,
      sourceCount: entry.count,
      proposedTargetBlockState: translated.toString(),
      proposedTargetBlockId: translated.Name,
      proposedTargetProperties: propsRecordFromBlockState(translated),
      warnings,
    });
  }

  return {
    targetVersion,
    cleanCount,
    problematicCount: problematic.length,
    problematic,
  };
}
