// Orchestration helper for converting raw schematic bytes into another format.
//
// Worker-safe: pure TS with no DOM / `window` access — importable from a Web
// Worker module. The UI talks to this module (directly in tests, via a worker
// in production) and never touches schemlib internals on its own.

import {
  AbstractSchematic,
  MinecraftVersion,
  SchematicTooLargeError,
  detectSchematicType,
  getVersion,
  type SchematicLoadOptions,
} from "./schemlib/schematic-formats";
import { Block, BlockPos, BlockState } from "./schemlib/blocks";
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
import {
  IntermediateRegion,
  IntermediateSchematic,
} from "./schemlib/schematic-formats/intermediate";
import { Entity } from "./schemlib/entities";
import { withCamoMaterials } from "./camo/materials";
import * as nbt from "./schemlib/nbt";
import { posKey } from "./schemlib/schematic-formats/version-mapping";
import {
  type NbtCompoundValue,
  fromNbtCompoundValue,
  toNbtCompoundValue,
} from "./nbt-value";

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
  /** The same limits as `parseSchematic`'s options. */
  loadOptions?: SchematicLoadOptions;
}

export type ConvertResult =
  | { ok: true; bytes: Uint8Array; filename: string; mimeType: string }
  | { ok: false; error: string; cause?: unknown };

export interface SerializeSchematicOptions {
  schematic: ParsedSchematicProjection;
  inputFilename: string;
  outputFormat: SchematicFormatId;
  targetVersion?: MinecraftVersion | string;
}

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
  // Camo-capable entries only: the distinct camo states in their placements'
  // slots, plus one "empty" material for their empty slots (see
  // `src/lib/camo/materials.ts`). Rebuild it with
  // `withCamoMaterials` whenever the palette or block entities change.
  camoMaterials?: ParsedCamoMaterial[];
}

// One camo state inside a camo-capable palette entry's placements. `count` is
// the number of slots holding it. For a fluid camo, `blockId` and
// `blockState` are the fluid id. The "empty" material counts the empty slots,
// with `blockId` and `blockState` "" and no properties.
export interface ParsedCamoMaterial {
  kind: "block" | "fluid" | "empty";
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

// Block-entity data (chest contents, sign text, camos) for the block at `pos`,
// which uses the same coordinates as the region's placements. `nbt` is the
// chunk-format compound (`id` plus the block entity's fields) without the
// `x`/`y`/`z` keys; the position lives in `pos` so edits can't desync them.
export interface ParsedSchematicBlockEntity {
  pos: [number, number, number];
  nbt: NbtCompoundValue;
}

export interface ParsedSchematicRegion {
  origin: [number, number, number];
  size: [number, number, number];
  blocks: ParsedSchematicBlockPlacement[];
  blockEntities: ParsedSchematicBlockEntity[];
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
  schematicLoad(
    obj: string | Uint8Array,
    options?: SchematicLoadOptions,
  ): AbstractSchematic;
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

// Canonical file extension (no dot) for a format id, per FORMATS.md.
export function formatExtension(format: SchematicFormatId): string {
  return FORMAT_REGISTRY[format].extension;
}

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

/**
 * With `options.maxDecompressedBytes`, gunzips gzipped `bytes` once, up to
 * that many bytes, so detection and loading reuse the result and never
 * inflate uncapped (fflate's `gunzipSync` allocates whatever size the gzip
 * trailer claims). Gzip that fails to inflate is an error, not a fallback.
 */
function inflateCapped(
  bytes: Uint8Array,
  options: SchematicLoadOptions | undefined,
):
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string; cause: unknown } {
  const max = options?.maxDecompressedBytes;
  if (max === undefined || !nbt.isGzip(bytes)) return { ok: true, bytes };
  try {
    return { ok: true, bytes: nbt.gunzipCapped(bytes, max) };
  } catch (cause) {
    if (cause instanceof nbt.DecompressedTooLargeError) {
      return { ok: false, error: cause.message, cause };
    }
    return {
      ok: false,
      error: `Could not decompress the schematic: ${errorMessage(cause)}`,
      cause,
    };
  }
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
  const { inputFilename, outputFormat, targetVersion, loadOptions } = options;

  const outputEntry = FORMAT_REGISTRY[outputFormat];
  if (!outputEntry) {
    return {
      ok: false,
      error: `Unsupported output format: ${String(outputFormat)}`,
    };
  }

  const inflated = inflateCapped(options.bytes, loadOptions);
  if (!inflated.ok) return inflated;
  const { bytes } = inflated;

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
    loaded = inputEntry.cls.schematicLoad(bytes, loadOptions);
  } catch (cause) {
    if (cause instanceof SchematicTooLargeError) {
      return { ok: false, error: cause.message, cause };
    }
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
 *
 * With `options.maxBlocks`, a file whose regions declare more blocks than
 * that fails before its block data is decoded; the error's `cause` is the
 * `SchematicTooLargeError` and `error` is its message, unprefixed.
 *
 * With `options.maxDecompressedBytes`, gzipped input is inflated once, up to
 * that many bytes, and the result is reused for detection and loading; past
 * the cap it fails the same way with a `DecompressedTooLargeError`, and gzip
 * that doesn't inflate fails too.
 */
export function parseSchematic(
  bytes: Uint8Array,
  options?: SchematicLoadOptions,
): ParseResult {
  const inflated = inflateCapped(bytes, options);
  if (!inflated.ok) return inflated;
  bytes = inflated.bytes;

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
    loaded = entry.cls.schematicLoad(bytes, options);
  } catch (cause) {
    if (cause instanceof SchematicTooLargeError) {
      return { ok: false, error: cause.message, cause };
    }
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

/**
 * Serialize an in-memory `ParsedSchematicProjection` to bytes in `outputFormat`,
 * optionally version-mapping to `targetVersion` on the way out. Used by the
 * Advanced Editor's Export panel after the user has applied edits to the
 * projection in memory.
 *
 * The projection is first reified into an `IntermediateSchematic` (the
 * schemlib canonical interchange shape) and then handed to the target format's
 * `fromSchematic` constructor — same code path as `convertSchematic`, which is
 * how cross-format conversion works in Simple Mode. Errors are reported via
 * `{ ok: false }`, never thrown.
 */
export function serializeSchematic(
  options: SerializeSchematicOptions,
): ConvertResult {
  const { schematic, inputFilename, outputFormat, targetVersion } = options;

  const outputEntry = FORMAT_REGISTRY[outputFormat];
  if (!outputEntry) {
    return {
      ok: false,
      error: `Unsupported output format: ${String(outputFormat)}`,
    };
  }

  let resolvedTarget: MinecraftVersion | null;
  try {
    resolvedTarget = resolveTargetVersion(targetVersion);
  } catch (cause) {
    return { ok: false, error: errorMessage(cause), cause };
  }

  let intermediate: IntermediateSchematic;
  try {
    intermediate = projectionToIntermediate(schematic);
  } catch (cause) {
    return {
      ok: false,
      error: `Failed to materialize in-memory schematic: ${errorMessage(cause)}`,
      cause,
    };
  }

  let converted: AbstractSchematic;
  try {
    converted = outputEntry.cls.fromSchematic(intermediate, resolvedTarget);
  } catch (cause) {
    return {
      ok: false,
      error: `Failed to convert to ${outputFormat}: ${errorMessage(cause)}`,
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

const BLOCK_ENTITY_POS_KEYS = new Set(["x", "y", "z"]);

function projectBlockEntity(
  pos: [number, number, number],
  entity: Entity,
): ParsedSchematicBlockEntity {
  const data = new nbt.Compound();
  for (const [k, v] of entity.toCompound().entries) {
    if (!BLOCK_ENTITY_POS_KEYS.has(k)) data.set(k, v);
  }
  return { pos, nbt: toNbtCompoundValue(data) };
}

function blockEntityToEntity(blockEntity: ParsedSchematicBlockEntity): Entity {
  const compound = fromNbtCompoundValue(blockEntity.nbt);
  for (const k of BLOCK_ENTITY_POS_KEYS) compound.delete(k);
  compound.set("x", new nbt.Int(blockEntity.pos[0]));
  compound.set("y", new nbt.Int(blockEntity.pos[1]));
  compound.set("z", new nbt.Int(blockEntity.pos[2]));
  return new Entity(compound);
}

function projectionToIntermediate(
  projection: ParsedSchematicProjection,
): IntermediateSchematic {
  const regions = projection.regions.map((region) => {
    // Only block entities that still sit on a block are written out; a stray
    // one (its block was deleted) would otherwise land on air.
    const occupied = new Set(
      region.blocks.map((p) => `${p.pos[0]},${p.pos[1]},${p.pos[2]}`),
    );
    const tileEntities = region.blockEntities
      .filter((be) => occupied.has(`${be.pos[0]},${be.pos[1]},${be.pos[2]}`))
      .map(blockEntityToEntity);
    const blocks: Block[] = region.blocks.map((placement) => {
      const entry = projection.palette[placement.paletteIndex];
      const state = new BlockState({
        Name: entry.blockId,
        Properties: entry.properties,
      });
      return new Block(
        new BlockPos(placement.pos[0], placement.pos[1], placement.pos[2]),
        state,
      );
    });
    return new IntermediateRegion(
      projection.minecraftVersion,
      new BlockPos(region.origin[0], region.origin[1], region.origin[2]),
      [region.size[0], region.size[1], region.size[2]],
      blocks,
      [],
      tileEntities,
    );
  });

  return new IntermediateSchematic(
    {},
    projection.name,
    regions,
    projection.minecraftVersion,
  );
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
    const blockEntities: ParsedSchematicBlockEntity[] = [];
    const projectedRegion: ParsedSchematicRegion = {
      origin: [origin[0], origin[1], origin[2]],
      size: [size[0], size[1], size[2]],
      blocks: placements,
      blockEntities,
    };
    regionAccumulators.push({ region: projectedRegion, placements });

    // Keys are block positions (`posKey`), so each block picks up the block
    // entity at its own position.
    const tileEntities = region.getTileEntityMatrix();

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
      const tileEntity = tileEntities.get(posKey(block.pos));
      if (tileEntity !== undefined) {
        blockEntities.push(
          projectBlockEntity([pos[0], pos[1], pos[2]], tileEntity),
        );
      }
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

  const regions = regionAccumulators.map((r) => r.region);
  const palette = withCamoMaterials(
    sortedEntries.map((e) => ({
      blockState: e.blockState,
      blockId: e.blockId,
      properties: e.properties,
      count: e.count,
    })),
    regions,
  );

  return {
    name: schematic.getName(),
    inputFormat,
    minecraftVersion: schematic.getMinecraftVersion(),
    totalBlocks,
    palette,
    regions,
  };
}
