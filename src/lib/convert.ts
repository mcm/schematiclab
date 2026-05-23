// Orchestration helper for converting raw schematic bytes into another format.
//
// Worker-safe: pure TS with no DOM / `window` access — importable from a Web
// Worker module. The UI talks to this module (directly in tests, via a worker
// in production) and never touches schemlib internals on its own.

import {
  AbstractSchematic,
  MinecraftVersion,
  detectSchematicType,
  getVersion,
} from "./schemlib/schematic-formats";
import { LitematicSchematic } from "./schemlib/schematic-formats/litematic";
import { StructureSchematic } from "./schemlib/schematic-formats/structure";
import {
  SpongeSchematicV1,
  SpongeSchematicV2,
  SpongeSchematicV3,
} from "./schemlib/schematic-formats/sponge";
import {
  BuildingGadgetsV0Schematic,
  BuildingGadgetsV1Schematic,
  BuildingGadgetsV2Schematic,
} from "./schemlib/schematic-formats/building-gadgets";
import { StructurizeBlueprint } from "./schemlib/schematic-formats/structurize";
import { IntermediateSchematic } from "./schemlib/schematic-formats/intermediate";

// ── Public types ──────────────────────────────────────────────────────────

// Format ids match `detectSchematicType` output exactly.
export const SUPPORTED_FORMATS = [
  "Litematic",
  "Sponge[v1]",
  "Sponge[v2]",
  "Sponge[v3]",
  "Structure",
  "BuildingGadgets[1.12]",
  "BuildingGadgets[1.14.4-1.19.3]",
  "BuildingGadgets2[1.20+]",
  "StructurizeBlueprint",
  "JSON",
] as const;

export type SchematicFormatId = (typeof SUPPORTED_FORMATS)[number];

export interface ConvertSchematicOptions {
  bytes: Uint8Array;
  inputFilename: string;
  outputFormat: SchematicFormatId;
  targetVersion?: MinecraftVersion | string;
}

export type ConvertResult =
  | { ok: true; bytes: Uint8Array; filename: string; mimeType: string }
  | { ok: false; error: string; cause?: unknown };

// ── Parse projection ──────────────────────────────────────────────────────
//
// `AbstractSchematic` instances are class graphs (methods, Maps, BlockState
// objects) and don't survive structured cloning across the worker boundary.
// The worker parses and then projects the bits the editor needs into this
// plain-object shape. Future stories (3D preview, transforms) extend it.

export interface ParsedSchematicPaletteEntry {
  blockState: string;
  blockId: string;
  properties: Record<string, string>;
  count: number;
}

// A single block placement inside a region. `pos` is the absolute world
// position as the parser sees it; `paletteIndex` references
// `ParsedSchematicProjection.palette`. Air-like states are excluded so the
// 3D renderer doesn't waste vertices on them.
export interface ParsedSchematicBlockPlacement {
  pos: [number, number, number];
  paletteIndex: number;
}

export interface ParsedSchematicRegion {
  origin: [number, number, number];
  size: [number, number, number];
  blocks: ParsedSchematicBlockPlacement[];
}

export interface ParsedSchematicProjection {
  name: string;
  inputFormat: SchematicFormatId;
  minecraftVersion: MinecraftVersion;
  totalBlocks: number;
  palette: ParsedSchematicPaletteEntry[];
  regions: ParsedSchematicRegion[];
}

export type ParseResult =
  | { ok: true; schematic: ParsedSchematicProjection }
  | { ok: false; error: string; cause?: unknown };

// ── Format registry ───────────────────────────────────────────────────────

// Each entry pairs a detection id with the concrete schematic class that
// implements load/dump/fromSchematic, plus the canonical extension and mime
// type per FORMATS.md.
type SchematicClass = typeof AbstractSchematic & {
  schematicLoad(obj: string | Uint8Array): AbstractSchematic;
  fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): AbstractSchematic;
};

interface FormatEntry {
  cls: SchematicClass;
  extension: string;
  mimeType: string;
}

const FORMAT_REGISTRY: Record<SchematicFormatId, FormatEntry> = {
  Litematic: {
    cls: LitematicSchematic as unknown as SchematicClass,
    extension: "litematic",
    mimeType: "application/octet-stream",
  },
  "Sponge[v1]": {
    cls: SpongeSchematicV1 as unknown as SchematicClass,
    extension: "schem",
    mimeType: "application/octet-stream",
  },
  "Sponge[v2]": {
    cls: SpongeSchematicV2 as unknown as SchematicClass,
    extension: "schem",
    mimeType: "application/octet-stream",
  },
  "Sponge[v3]": {
    cls: SpongeSchematicV3 as unknown as SchematicClass,
    extension: "schem",
    mimeType: "application/octet-stream",
  },
  Structure: {
    cls: StructureSchematic as unknown as SchematicClass,
    extension: "nbt",
    mimeType: "application/octet-stream",
  },
  "BuildingGadgets[1.12]": {
    cls: BuildingGadgetsV0Schematic as unknown as SchematicClass,
    extension: "txt",
    mimeType: "text/plain",
  },
  "BuildingGadgets[1.14.4-1.19.3]": {
    cls: BuildingGadgetsV1Schematic as unknown as SchematicClass,
    extension: "txt",
    mimeType: "text/plain",
  },
  "BuildingGadgets2[1.20+]": {
    cls: BuildingGadgetsV2Schematic as unknown as SchematicClass,
    extension: "txt",
    mimeType: "text/plain",
  },
  StructurizeBlueprint: {
    cls: StructurizeBlueprint as unknown as SchematicClass,
    extension: "blueprint",
    mimeType: "application/octet-stream",
  },
  JSON: {
    cls: IntermediateSchematic as unknown as SchematicClass,
    extension: "json",
    mimeType: "application/json",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function stripExtension(filename: string): string {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const base = slash >= 0 ? filename.slice(slash + 1) : filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function resolveTargetVersion(
  v: MinecraftVersion | string | undefined,
): MinecraftVersion | null {
  if (v === undefined) return null;
  return typeof v === "string" ? getVersion(v) : v;
}

function toBytes(dumped: string | Uint8Array): Uint8Array {
  return typeof dumped === "string" ? new TextEncoder().encode(dumped) : dumped;
}

function isSchematicFormatId(value: string): value is SchematicFormatId {
  return (SUPPORTED_FORMATS as readonly string[]).includes(value);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Detect the format of `bytes`, parse it into an `AbstractSchematic`,
 * optionally version-map it to `targetVersion`, then serialize to
 * `outputFormat`. Returns a discriminated result — errors are reported via
 * `{ ok: false, error, cause }`, never thrown.
 */
export function convertSchematic(
  options: ConvertSchematicOptions,
): ConvertResult {
  const { bytes, inputFilename, outputFormat, targetVersion } = options;

  const outputEntry = FORMAT_REGISTRY[outputFormat];
  if (!outputEntry) {
    return {
      ok: false,
      error: `Unsupported output format: ${String(outputFormat)}`,
    };
  }

  let detectedId: string;
  try {
    detectedId = detectSchematicType(bytes);
  } catch (cause) {
    return {
      ok: false,
      error: `Could not detect schematic format: ${errorMessage(cause)}`,
      cause,
    };
  }

  if (!isSchematicFormatId(detectedId)) {
    return {
      ok: false,
      error: `Detected format '${detectedId}' is not supported for conversion`,
    };
  }

  const inputEntry = FORMAT_REGISTRY[detectedId];

  let loaded: AbstractSchematic;
  try {
    loaded = inputEntry.cls.schematicLoad(bytes);
  } catch (cause) {
    return {
      ok: false,
      error: `Failed to parse ${detectedId} input: ${errorMessage(cause)}`,
      cause,
    };
  }

  let resolvedTarget: MinecraftVersion | null;
  try {
    resolvedTarget = resolveTargetVersion(targetVersion);
  } catch (cause) {
    return {
      ok: false,
      error: errorMessage(cause),
      cause,
    };
  }

  let converted: AbstractSchematic;
  try {
    converted = outputEntry.cls.fromSchematic(loaded, resolvedTarget);
  } catch (cause) {
    return {
      ok: false,
      error: `Failed to convert ${detectedId} -> ${outputFormat}: ${errorMessage(cause)}`,
      cause,
    };
  }

  let outBytes: Uint8Array;
  try {
    outBytes = toBytes(converted.schematicDump());
  } catch (cause) {
    return {
      ok: false,
      error: `Failed to serialize ${outputFormat}: ${errorMessage(cause)}`,
      cause,
    };
  }

  const filename = `${stripExtension(inputFilename)}.${outputEntry.extension}`;

  return {
    ok: true,
    bytes: outBytes,
    filename,
    mimeType: outputEntry.mimeType,
  };
}

/**
 * Detect + parse `bytes` into an `AbstractSchematic` and return a
 * worker-serializable projection. Used by the Advanced Editor to populate
 * editor state on entry. Errors are reported via `{ ok: false }`, never thrown.
 */
export function parseSchematic(bytes: Uint8Array): ParseResult {
  let detectedId: string;
  try {
    detectedId = detectSchematicType(bytes);
  } catch (cause) {
    return {
      ok: false,
      error: `Could not detect schematic format: ${errorMessage(cause)}`,
      cause,
    };
  }

  if (!isSchematicFormatId(detectedId)) {
    return {
      ok: false,
      error: `Detected format '${detectedId}' is not supported`,
    };
  }

  const entry = FORMAT_REGISTRY[detectedId];

  let loaded: AbstractSchematic;
  try {
    loaded = entry.cls.schematicLoad(bytes);
  } catch (cause) {
    return {
      ok: false,
      error: `Failed to parse ${detectedId} input: ${errorMessage(cause)}`,
      cause,
    };
  }

  try {
    return { ok: true, schematic: projectSchematic(loaded, detectedId) };
  } catch (cause) {
    return {
      ok: false,
      error: `Failed to project ${detectedId} schematic: ${errorMessage(cause)}`,
      cause,
    };
  }
}

function projectSchematic(
  schematic: AbstractSchematic,
  inputFormat: SchematicFormatId,
): ParsedSchematicProjection {
  // First pass: build the per-region placement lists and a keyed palette
  // accumulator. Palette indexes are assigned in insertion order so each
  // placement can record a stable index; we re-sort and re-key afterwards.
  type PaletteAccumulator = ParsedSchematicPaletteEntry & {
    insertionIndex: number;
  };
  const paletteByKey = new Map<string, PaletteAccumulator>();
  const regionAccumulators: Array<{
    region: ParsedSchematicRegion;
    placements: ParsedSchematicBlockPlacement[];
  }> = [];
  let totalBlocks = 0;

  for (const region of schematic.getRegions()) {
    const origin = region.getOrigin().astuple();
    const size = region.getSize();
    const placements: ParsedSchematicBlockPlacement[] = [];
    const projectedRegion: ParsedSchematicRegion = {
      origin: [origin[0], origin[1], origin[2]],
      size: [size[0], size[1], size[2]],
      blocks: placements,
    };
    regionAccumulators.push({ region: projectedRegion, placements });

    for (const block of region.getBlocks()) {
      totalBlocks += 1;
      const key = block.state.toString();
      let entry = paletteByKey.get(key);
      if (entry === undefined) {
        const properties: Record<string, string> = {};
        for (const [k, v] of block.state.Properties) properties[k] = v;
        entry = {
          blockState: key,
          blockId: block.state.Name,
          properties,
          count: 1,
          insertionIndex: paletteByKey.size,
        };
        paletteByKey.set(key, entry);
      } else {
        entry.count += 1;
      }

      const pos = block.pos.astuple();
      placements.push({
        pos: [pos[0], pos[1], pos[2]],
        paletteIndex: entry.insertionIndex,
      });
    }
  }

  // Sort the palette by count (most common first), then build a remap from
  // insertion order to the final sorted order so per-block placements still
  // resolve correctly.
  const sortedEntries = [...paletteByKey.values()].sort(
    (a, b) => b.count - a.count,
  );
  const indexRemap = new Array<number>(sortedEntries.length);
  for (let finalIdx = 0; finalIdx < sortedEntries.length; finalIdx += 1) {
    indexRemap[sortedEntries[finalIdx].insertionIndex] = finalIdx;
  }
  for (const { placements } of regionAccumulators) {
    for (const placement of placements) {
      placement.paletteIndex = indexRemap[placement.paletteIndex];
    }
  }

  const palette: ParsedSchematicPaletteEntry[] = sortedEntries.map((e) => ({
    blockState: e.blockState,
    blockId: e.blockId,
    properties: e.properties,
    count: e.count,
  }));

  return {
    name: schematic.getName(),
    inputFormat,
    minecraftVersion: schematic.getMinecraftVersion(),
    totalBlocks,
    palette,
    regions: regionAccumulators.map((r) => r.region),
  };
}
