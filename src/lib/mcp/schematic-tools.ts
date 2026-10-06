// `inspect_schematic`, `convert_schematic` and `render_schematic`: read,
// convert and view an existing schematic given as a URL or base64 bytes
// (`input.ts`).

import { z } from "zod";
import {
  SUPPORTED_FORMATS,
  convertSchematic,
  parseSchematic,
  type ParsedSchematicProjection,
  type SchematicFormatId,
} from "../convert";
import { translateBlockState } from "../schemlib/data/translate";
import { BlockState } from "../schemlib/blocks";
import type { ModpackBlocks } from "../modpacks/registry";
import { SchematicTooLargeError } from "../schemlib/schematic-formats/abstract";
import { DecompressedTooLargeError } from "../schemlib/nbt";
import {
  KNOWN_VERSIONS,
  type MinecraftVersion,
  versionName,
  versionsEqual,
} from "../schemlib/schematic-formats/version-mapping";
import {
  modpackInput,
  resolveSchematicInput,
  schematicInputShape,
  type SchematicInput,
  type SchematicInputArgs,
} from "./input";
import {
  assertProjectionBlocks,
  resolveLimits,
  decompressedTooLargeMessage,
  tooManyBlocksMessage,
} from "./limits";
import { assertBlobConfigured, publishFile } from "./output";
import {
  modpackRenderSource,
  renderProjectionPng,
  statesNotInModpack,
} from "./render";
import { resolveToolBlocks } from "./tool-blocks";
import { type McpDeps, defineTool, jsonResult } from "./types";

const SCHEMATIC_TIMEOUT_HINT = "Try a smaller schematic.";
export const INSPECT_PALETTE_LIMIT = 30;
export const MAX_WARNINGS = 50;

// Every writable format; the JSON intermediate format is never an output
// (FORMATS.md).
export const OUTPUT_FORMATS = SUPPORTED_FORMATS.filter(
  (id): id is Exclude<SchematicFormatId, "JSON"> => id !== "JSON",
);

interface LoadedSchematic {
  input: SchematicInput;
  projection: ParsedSchematicProjection;
}

// Resolves the input and parses it; a parse failure throws the
// `ParseResult` error text, which `runTool` returns as a tool error, and so
// does a schematic over `MAX_PROJECTION_BLOCKS`. The cap is checked twice:
// against the regions' declared sizes before any block data is decoded (so a
// small compressed file declaring a huge region fails fast), and against the
// parsed blocks.
async function loadSchematic(
  args: SchematicInputArgs,
  deps: McpDeps,
): Promise<LoadedSchematic> {
  const input = await resolveSchematicInput(args, deps);
  const limits = resolveLimits(deps.limits);
  const maxBlocks = limits.maxProjectionBlocks;
  const parsed = parseSchematic(input.bytes, {
    maxBlocks,
    maxDecompressedBytes: limits.maxDecompressedBytes,
  });
  if (!parsed.ok) {
    if (parsed.cause instanceof SchematicTooLargeError) {
      throw new Error(tooManyBlocksMessage(parsed.cause.blocks, maxBlocks));
    }
    if (parsed.cause instanceof DecompressedTooLargeError) {
      throw new Error(decompressedTooLargeMessage(parsed.cause.maxBytes));
    }
    throw new Error(parsed.error);
  }
  assertProjectionBlocks(parsed.schematic, maxBlocks);
  return { input, projection: parsed.schematic };
}

/** The size of the box enclosing every region. */
export function overallSize(
  projection: ParsedSchematicProjection,
): [number, number, number] {
  if (projection.regions.length === 0) return [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { origin, size } of projection.regions) {
    // A region that is empty along any axis holds no blocks.
    if (size.some((n) => n === 0)) continue;
    for (let axis = 0; axis < 3; axis++) {
      const a = origin[axis];
      const b = origin[axis] + size[axis] - Math.sign(size[axis]);
      min[axis] = Math.min(min[axis], a, b);
      max[axis] = Math.max(max[axis], a, b);
    }
  }
  return [0, 1, 2].map((axis) =>
    max[axis] < min[axis] ? 0 : max[axis] - min[axis] + 1,
  ) as [number, number, number];
}

export interface ModpackPaletteRow {
  /** The pack mod the block comes from, `minecraft`, or its namespace. */
  mod: string;
  in_modpack: boolean;
  /** The state compared, when translation to the pack's version changed it. */
  translated_state?: string;
  /** Camo blocks only: the camos in their slots (`empty` for empty slots). */
  camo_materials?: {
    block_state: string;
    count: number;
    in_modpack?: boolean;
  }[];
}

export interface ModpackComparison {
  /** One row per palette entry, in palette order. */
  rows: ModpackPaletteRow[];
  /** Set when the schematic's Minecraft version isn't the pack's. */
  note?: string;
}

/**
 * Which of `projection`'s block states `modpack` has (a vanilla block of its
 * Minecraft version or one of its mod blocks). A schematic of another
 * Minecraft version is translated to the pack's version first, state by
 * state as conversion does; mod blocks pass through unchanged.
 */
export function compareWithModpack(
  projection: ParsedSchematicProjection,
  modpack: ModpackBlocks,
): ModpackComparison {
  const packVersion = Object.hasOwn(KNOWN_VERSIONS, modpack.minecraftVersion)
    ? KNOWN_VERSIONS[modpack.minecraftVersion]
    : null;
  const translate =
    packVersion !== null &&
    !versionsEqual(projection.minecraftVersion, packVersion);
  const compare = (blockId: string, properties: Record<string, string>) => {
    if (!translate) return { id: blockId, state: null };
    const state = translateBlockState(
      new BlockState({ Name: blockId, Properties: properties }),
      projection.minecraftVersion,
      packVersion,
    );
    const source = new BlockState({ Name: blockId, Properties: properties });
    return {
      id: state.Name,
      state: state.equals(source) ? null : state.toString(),
    };
  };
  const modOf = (id: string, inPack: boolean) => {
    const block = inPack ? modpack.modBlock(id) : undefined;
    if (block !== undefined) return block.mod.name;
    const colon = id.indexOf(":");
    return colon === -1 ? "minecraft" : id.slice(0, colon);
  };

  const rows = projection.palette.map((entry): ModpackPaletteRow => {
    const { id, state } = compare(entry.blockId, entry.properties);
    const inPack = modpack.registry.exists(id);
    const row: ModpackPaletteRow = {
      mod: modOf(id, inPack),
      in_modpack: inPack,
      ...(state !== null && { translated_state: state }),
    };
    if (entry.camoMaterials !== undefined) {
      row.camo_materials = entry.camoMaterials.map((m) =>
        m.kind === "empty"
          ? { block_state: "empty", count: m.count }
          : {
              block_state: m.blockState,
              count: m.count,
              ...(m.kind === "block" && {
                in_modpack: modpack.registry.exists(
                  compare(m.blockId, m.properties).id,
                ),
              }),
            },
      );
    }
    return row;
  });
  return {
    rows,
    ...(translate && {
      note: `The schematic is Minecraft ${versionName(projection.minecraftVersion)} and ${modpack.ref} is Minecraft ${modpack.minecraftVersion}: block states are compared with the pack after translation to ${modpack.minecraftVersion}.`,
    }),
  };
}

export interface MissingFromModpack {
  /** The most common missing block states, at most `MAX_WARNINGS`. */
  block_states: { block_state: string; count: number }[];
  /** How many more missing block states there are. */
  states_not_listed: number;
}

// The palette's states the pack lacks, air left out, most common first.
function missingStates(
  projection: ParsedSchematicProjection,
  comparison: ModpackComparison,
): { block_state: string; count: number }[] {
  return projection.palette
    .filter((e, i) => !AIR_IDS.has(e.blockId) && !comparison.rows[i].in_modpack)
    .map((e) => ({ block_state: e.blockState, count: e.count }));
}

export interface InspectResult {
  format: SchematicFormatId;
  minecraft_version: string;
  size: [number, number, number];
  total_blocks: number;
  palette_size: number;
  palette: { block_state: string; count: number }[];
  blocks_not_listed: number;
  regions: {
    origin: [number, number, number];
    size: [number, number, number];
    blocks: number;
  }[];
  missing_from_modpack?: MissingFromModpack;
  note?: string;
}

const AIR_IDS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);

/**
 * What `inspect_schematic` reports. Air is left out of the palette and the
 * block counts (structure files store it explicitly, other formats don't).
 */
export function inspectProjection(
  projection: ParsedSchematicProjection,
  modpack?: ModpackBlocks | null,
): InspectResult {
  const comparison = modpack ? compareWithModpack(projection, modpack) : null;
  const isAir = projection.palette.map((e) => AIR_IDS.has(e.blockId));
  // The projection's palette is sorted by count, most common first.
  const palette = projection.palette.filter((_, i) => !isAir[i]);
  const total = palette.reduce((sum, e) => sum + e.count, 0);
  const top = palette.slice(0, INSPECT_PALETTE_LIMIT);
  const listed = top.reduce((sum, e) => sum + e.count, 0);
  const rowOf = new Map(
    comparison?.rows.map((row, i) => [projection.palette[i], row]),
  );
  const missing = comparison ? missingStates(projection, comparison) : [];
  return {
    format: projection.inputFormat,
    minecraft_version: versionName(projection.minecraftVersion),
    size: overallSize(projection),
    total_blocks: total,
    palette_size: palette.length,
    palette: top.map((e) => ({
      block_state: e.blockState,
      count: e.count,
      ...rowOf.get(e),
    })),
    blocks_not_listed: total - listed,
    regions: projection.regions.map((r) => ({
      origin: r.origin,
      size: r.size,
      blocks: r.blocks.filter((b) => !isAir[b.paletteIndex]).length,
    })),
    ...(comparison && {
      missing_from_modpack: {
        block_states: missing.slice(0, MAX_WARNINGS),
        states_not_listed: Math.max(0, missing.length - MAX_WARNINGS),
      },
    }),
    ...(comparison?.note !== undefined && { note: comparison.note }),
  };
}

/**
 * The warnings translating `projection`'s block states to `target` reports
 * (each prefixed by its source state), at most `MAX_WARNINGS` of them plus a
 * line counting the rest. Conversion translates block by block with the
 * same `translateBlockState`, so translating each palette entry once gives
 * the same warnings.
 */
export function translationWarnings(
  projection: ParsedSchematicProjection,
  target: MinecraftVersion,
): string[] {
  return capWarnings(uncappedTranslationWarnings(projection, target));
}

/** `warnings` without duplicates, the first `MAX_WARNINGS` plus a count. */
export function capWarnings(warnings: string[]): string[] {
  const unique = [...new Set(warnings)];
  if (unique.length <= MAX_WARNINGS) return unique;
  return [
    ...unique.slice(0, MAX_WARNINGS),
    `…and ${unique.length - MAX_WARNINGS} more warnings.`,
  ];
}

function uncappedTranslationWarnings(
  projection: ParsedSchematicProjection,
  target: MinecraftVersion,
): string[] {
  if (versionsEqual(projection.minecraftVersion, target)) return [];
  const warnings: string[] = [];
  for (const entry of projection.palette) {
    translateBlockState(
      new BlockState({ Name: entry.blockId, Properties: entry.properties }),
      projection.minecraftVersion,
      target,
      {
        onWarning: (message) =>
          warnings.push(`${entry.blockState}: ${message}`),
      },
    );
  }
  return warnings;
}

/** One warning per block state of `projection` that `modpack` lacks. */
export function modpackWarnings(
  projection: ParsedSchematicProjection,
  modpack: ModpackBlocks,
  comparison = compareWithModpack(projection, modpack),
): string[] {
  return missingStates(projection, comparison).map(
    ({ block_state, count }) =>
      `${block_state}: not in modpack '${modpack.ref}' (${count} block${count === 1 ? "" : "s"}).`,
  );
}

const inspectOutputSchema = z.object({
  format: z.string(),
  minecraft_version: z.string(),
  size: z.array(z.number()),
  total_blocks: z.number(),
  palette_size: z.number(),
  palette: z.array(
    z.object({
      block_state: z.string(),
      count: z.number(),
      mod: z.string().optional(),
      in_modpack: z.boolean().optional(),
      translated_state: z.string().optional(),
      camo_materials: z
        .array(
          z.object({
            block_state: z.string(),
            count: z.number(),
            in_modpack: z.boolean().optional(),
          }),
        )
        .optional(),
    }),
  ),
  blocks_not_listed: z.number(),
  regions: z.array(
    z.object({
      origin: z.array(z.number()),
      size: z.array(z.number()),
      blocks: z.number(),
    }),
  ),
  missing_from_modpack: z
    .object({
      block_states: z.array(
        z.object({ block_state: z.string(), count: z.number() }),
      ),
      states_not_listed: z.number(),
    })
    .optional(),
  note: z.string().optional(),
});

// The pack's blocks, resolved in parallel with parsing the schematic.
function modpackOf(ref: string | undefined, deps: McpDeps) {
  return ref?.trim()
    ? resolveToolBlocks({ modpack: ref }, deps).then((b) => b.modpack)
    : Promise.resolve(null);
}

export const inspectSchematicTool = defineTool({
  name: "inspect_schematic",
  title: "Inspect a schematic",
  description:
    "Read a schematic file (Litematic, Sponge .schem, structure .nbt, Building Gadgets, Structurize blueprint) and report its format, Minecraft version, overall size [x, y, z], total non-air blocks, the 30 most common block states with counts, and each region's origin and size. With a modpack, each palette row also has its mod (minecraft for vanilla), in_modpack and, for camo blocks, their camo materials, and missing_from_modpack lists the block states the pack lacks with counts (at most 50, plus how many more). A schematic of another Minecraft version is compared after translation to the pack's version.",
  inputSchema: z.object({ ...schematicInputShape, modpack: modpackInput }),
  outputSchema: inspectOutputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  timeoutHint: SCHEMATIC_TIMEOUT_HINT,
  handler: async (args, deps) => {
    const [{ projection }, modpack] = await Promise.all([
      loadSchematic(args, deps),
      modpackOf(args.modpack, deps),
    ]);
    return jsonResult({ ...inspectProjection(projection, modpack) });
  },
});

export const convertSchematicTool = defineTool({
  name: "convert_schematic",
  title: "Convert a schematic",
  description:
    "Convert a schematic to another format and, optionally, another Minecraft version. Returns a download URL that expires after 24 hours, plus any warnings from translating block states between versions. With a modpack, the warnings also name each block state the pack lacks (compared after translation to the pack's Minecraft version); the conversion itself is the same. See list_versions for formats and versions.",
  inputSchema: z.object({
    ...schematicInputShape,
    modpack: modpackInput,
    output_format: z
      .enum(OUTPUT_FORMATS as [string, ...string[]])
      .describe("The output format id, as listed by list_versions."),
    target_version: z
      .string()
      .optional()
      .describe(
        "The Minecraft version to write, as listed by list_versions. Defaults to the schematic's own version (Building Gadgets formats move it into their supported range).",
      ),
  }),
  outputSchema: z.object({
    url: z.string(),
    filename: z.string(),
    bytes: z.number(),
    expires_at: z.string(),
    format: z.string(),
    minecraft_version: z.string(),
    warnings: z.array(z.string()),
    note: z.string().optional(),
  }),
  annotations: { readOnlyHint: false, openWorldHint: true },
  timeoutHint: SCHEMATIC_TIMEOUT_HINT,
  handler: async (args, deps) => {
    assertBlobConfigured(deps);
    const outputFormat = args.output_format as SchematicFormatId;
    const targetVersion = args.target_version?.trim() || undefined;
    if (
      targetVersion !== undefined &&
      !Object.hasOwn(KNOWN_VERSIONS, targetVersion)
    ) {
      throw new Error(
        `Unknown Minecraft version '${targetVersion}'. Call list_versions for the supported versions.`,
      );
    }
    const [{ input, projection }, modpack] = await Promise.all([
      loadSchematic(args, deps),
      modpackOf(args.modpack, deps),
    ]);
    const limits = resolveLimits(deps.limits);
    // The same limits again: conversion inflates and loads the input anew.
    const converted = convertSchematic({
      bytes: input.bytes,
      inputFilename: input.filename,
      outputFormat,
      targetVersion,
      loadOptions: {
        maxBlocks: limits.maxProjectionBlocks,
        maxDecompressedBytes: limits.maxDecompressedBytes,
      },
    });
    if (!converted.ok) throw new Error(converted.error);

    // The version actually written: the target, or the source moved into a
    // Building Gadgets format's range.
    const written = parseSchematic(converted.bytes);
    const outputVersion = written.ok
      ? written.schematic.minecraftVersion
      : targetVersion !== undefined
        ? KNOWN_VERSIONS[targetVersion]
        : projection.minecraftVersion;
    const comparison = modpack ? compareWithModpack(projection, modpack) : null;
    const warnings = capWarnings([
      ...uncappedTranslationWarnings(projection, outputVersion),
      ...(modpack && comparison
        ? modpackWarnings(projection, modpack, comparison)
        : []),
    ]);

    const file = await publishFile(
      converted.bytes,
      converted.filename,
      converted.mimeType,
      deps,
    );
    return jsonResult({
      url: file.url,
      filename: file.filename,
      bytes: file.bytes,
      expires_at: file.expiresAt,
      format: outputFormat,
      minecraft_version: versionName(outputVersion),
      warnings,
      ...(comparison?.note !== undefined && { note: comparison.note }),
    });
  },
});

const MISSING_EXAMPLES = 5;

// "N block states not in <ref>" with a few of them, or that none are.
function missingFromPackSummary(
  projection: ParsedSchematicProjection,
  modpack: ModpackBlocks,
): string {
  const missing = statesNotInModpack(projection, modpack);
  if (missing.length === 0) {
    return `Every block state is in ${modpack.ref}.`;
  }
  const shown = missing.slice(0, MISSING_EXAMPLES).join(", ");
  const more = missing.length > MISSING_EXAMPLES ? ", …" : "";
  return `${missing.length} block state${missing.length === 1 ? "" : "s"} not in ${modpack.ref} (${shown}${more}).`;
}

export const renderSchematicTool = defineTool({
  name: "render_schematic",
  title: "Render a schematic",
  description:
    "Render a schematic as a PNG contact sheet: four isometric views, front/side/top elevations, two plan slices and a cutaway, with flat-coloured blocks. Use it to see what a build looks like. With a modpack, mod blocks take the pack's colours and shapes, and the summary counts the block states the pack lacks.",
  inputSchema: z.object({ ...schematicInputShape, modpack: modpackInput }),
  annotations: { readOnlyHint: true, openWorldHint: true },
  timeoutHint: SCHEMATIC_TIMEOUT_HINT,
  handler: async (args, deps) => {
    const [{ input, projection }, blocks] = await Promise.all([
      loadSchematic(args, deps),
      args.modpack?.trim()
        ? resolveToolBlocks({ modpack: args.modpack }, deps)
        : null,
    ]);
    const modpack = blocks?.modpack ?? null;
    const name = projection.name.trim() || input.filename;
    const { png, width, height } = renderProjectionPng(projection, {
      name,
      ...(modpack && { appearance: modpackRenderSource(modpack) }),
    });
    const info = inspectProjection(projection);
    const [x, y, z] = info.size;
    let summary =
      `Contact sheet of ${name}: ${projection.inputFormat}, Minecraft ` +
      `${versionName(projection.minecraftVersion)}, ${x}×${y}×${z}, ` +
      `${info.total_blocks} blocks in ${info.palette_size} block states ` +
      `(${width}×${height} PNG).`;
    if (modpack) summary += ` ${missingFromPackSummary(projection, modpack)}`;
    return {
      content: [
        {
          type: "image",
          data: Buffer.from(png).toString("base64"),
          mimeType: "image/png",
        },
        { type: "text", text: summary },
      ],
    };
  },
});
