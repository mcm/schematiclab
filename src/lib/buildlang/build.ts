// A whole program compiled for one Minecraft version: validation, the
// compile, the analysis report and the build as a `ParsedSchematicProjection`,
// which `serializeSchematic` writes in any output format and the MCP renderer
// draws unchanged. Worker-safe.
//
// 1.12.2 compiles against the 1.13.2 block data (flattened ids, like every
// other version); its projection holds the Forge 1.12 block states of those
// blocks, from the flatten table, the way the Shape Generator writes 1.12.2.

import { type BlockDataDeps } from "../blockdata/load";
import { type BlockRegistry, loadBlockRegistry } from "../blockdata/registry";
import type {
  ParsedSchematicPaletteEntry,
  ParsedSchematicProjection,
} from "../convert";
import { getVersion } from "../schemlib/schematic-formats/version-mapping";
import { materialForVersion } from "../shapes/generate";
import {
  type Analysis,
  analyze,
  formatInvalidReport,
  formatReport,
} from "./analyze";
import {
  type CompileOptions,
  type CompileResult,
  compileWithRegistry,
} from "./compiler";
import { type ProgramError, validateProgram } from "./program";

export interface BuildResult {
  errors: ProgramError[];
  warnings: ProgramError[];
  notes: ProgramError[];
  /** The build, or null when the program failed validation. */
  projection: ParsedSchematicProjection | null;
  /** The markdown report (`formatReport`). */
  report: string;
  /** The analysis behind the report, or null when the program was invalid. */
  analysis: Analysis | null;
}

/**
 * Validates and compiles `program` (parsed JSON) for `versionId`, a
 * `KNOWN_VERSIONS` key. The target version's block data is fetched through
 * `deps`. Throws only when the version is unknown or its block data can't be
 * loaded; problems with the program are returned with their paths. A program
 * with compile errors still gets a projection of what it built.
 */
export async function compileProgram(
  program: unknown,
  versionId: string,
  deps: BlockDataDeps,
  options: CompileOptions = {},
): Promise<BuildResult> {
  const registry = await loadBlockRegistry(versionId, deps);
  return compileForRegistry(program, versionId, registry, options);
}

/** `compileProgram` with the version's registry already loaded. */
export function compileForRegistry(
  program: unknown,
  versionId: string,
  registry: BlockRegistry,
  options: CompileOptions = {},
): BuildResult {
  const validation = validateProgram(program);
  if (!validation.ok) {
    const raw = program as { name?: unknown } | null;
    const name =
      typeof raw?.name === "string" && raw.name.trim() !== ""
        ? raw.name
        : "untitled";
    return {
      errors: validation.errors,
      warnings: [],
      notes: [],
      projection: null,
      report: formatInvalidReport(name, validation.errors),
      analysis: null,
    };
  }

  const result = compileWithRegistry(validation.program, registry, options);
  const { projection, errors } = toProjection(result, versionId, registry);
  result.errors.push(...errors);
  const analysis = analyze(result, registry);
  return {
    errors: result.errors,
    warnings: result.warnings,
    notes: result.notes,
    projection,
    report: formatReport(result, analysis),
    analysis,
  };
}

interface PaletteSlot {
  /** Index into the projection's palette, or -1 for a dropped block. */
  index: number;
}

/**
 * The compiled blocks as a one-region projection the size of the program.
 * Block states are written in full (the block's defaults overlaid with what
 * the build set). 1.12.2 blocks with no Forge 1.12 state are dropped, with an
 * error at the operation that placed the first of them.
 */
export function toProjection(
  result: CompileResult,
  versionId: string,
  registry: BlockRegistry,
): { projection: ParsedSchematicProjection; errors: ProgramError[] } {
  const errors: ProgramError[] = [];
  const palette: ParsedSchematicPaletteEntry[] = [];
  const slots = new Map<string, PaletteSlot>();
  const blocks: ParsedSchematicProjection["regions"][number]["blocks"] = [];

  for (const [pos, block] of result.blocks.entries()) {
    const properties = { ...registry.defaults(block.id), ...block.states };
    const key = JSON.stringify([block.id, properties]);
    let slot = slots.get(key);
    if (slot === undefined) {
      const written = materialForVersion(
        { blockId: block.id, properties },
        versionId,
      );
      if (written.ok) {
        const state = written.state;
        palette.push({
          blockState: state.toString(),
          blockId: state.Name,
          properties: Object.fromEntries(state.Properties),
          count: 0,
        });
        slot = { index: palette.length - 1 };
      } else {
        errors.push({
          path: result.log.pathAt(pos) ?? "",
          message: `${written.error} Use another block.`,
        });
        slot = { index: -1 };
      }
      slots.set(key, slot);
    }
    if (slot.index < 0) continue;
    palette[slot.index].count++;
    blocks.push({ pos: [pos[0], pos[1], pos[2]], paletteIndex: slot.index });
  }

  // Same-state Forge 1.12 entries (two flattened states can share one legacy
  // state) are merged so the palette has no duplicates.
  const merged = mergePalette(palette, blocks);

  return {
    projection: {
      name: result.name ?? "untitled",
      // A compiled build was never read from a file. The projection still
      // needs a format; export ignores it.
      inputFormat: "Litematic",
      minecraftVersion: getVersion(versionId),
      totalBlocks: blocks.length,
      palette: merged,
      regions: [
        {
          origin: [0, 0, 0],
          size: [result.size[0], result.size[1], result.size[2]],
          blocks,
          blockEntities: [],
        },
      ],
    },
    errors,
  };
}

function mergePalette(
  palette: ParsedSchematicPaletteEntry[],
  blocks: ParsedSchematicProjection["regions"][number]["blocks"],
): ParsedSchematicPaletteEntry[] {
  const byState = new Map<string, number>();
  const remap: number[] = [];
  const merged: ParsedSchematicPaletteEntry[] = [];
  for (const entry of palette) {
    const seen = byState.get(entry.blockState);
    if (seen === undefined) {
      byState.set(entry.blockState, merged.length);
      remap.push(merged.length);
      merged.push(entry);
    } else {
      remap.push(seen);
      merged[seen].count += entry.count;
    }
  }
  if (merged.length === palette.length) return palette;
  for (const block of blocks) block.paletteIndex = remap[block.paletteIndex];
  return merged;
}
