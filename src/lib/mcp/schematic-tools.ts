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
import { SchematicTooLargeError } from "../schemlib/schematic-formats/abstract";
import { DecompressedTooLargeError } from "../schemlib/nbt";
import {
  KNOWN_VERSIONS,
  type MinecraftVersion,
  versionName,
  versionsEqual,
} from "../schemlib/schematic-formats/version-mapping";
import {
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
import { publishFile } from "./output";
import { renderProjectionPng } from "./render";
import { type McpDeps, defineTool, jsonResult } from "./types";

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
): InspectResult {
  const isAir = projection.palette.map((e) => AIR_IDS.has(e.blockId));
  // The projection's palette is sorted by count, most common first.
  const palette = projection.palette.filter((_, i) => !isAir[i]);
  const total = palette.reduce((sum, e) => sum + e.count, 0);
  const top = palette.slice(0, INSPECT_PALETTE_LIMIT);
  const listed = top.reduce((sum, e) => sum + e.count, 0);
  return {
    format: projection.inputFormat,
    minecraft_version: versionName(projection.minecraftVersion),
    size: overallSize(projection),
    total_blocks: total,
    palette_size: palette.length,
    palette: top.map((e) => ({ block_state: e.blockState, count: e.count })),
    blocks_not_listed: total - listed,
    regions: projection.regions.map((r) => ({
      origin: r.origin,
      size: r.size,
      blocks: r.blocks.filter((b) => !isAir[b.paletteIndex]).length,
    })),
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
  const unique = [...new Set(warnings)];
  if (unique.length <= MAX_WARNINGS) return unique;
  return [
    ...unique.slice(0, MAX_WARNINGS),
    `…and ${unique.length - MAX_WARNINGS} more warnings.`,
  ];
}

const inspectOutputSchema = z.object({
  format: z.string(),
  minecraft_version: z.string(),
  size: z.array(z.number()),
  total_blocks: z.number(),
  palette_size: z.number(),
  palette: z.array(z.object({ block_state: z.string(), count: z.number() })),
  blocks_not_listed: z.number(),
  regions: z.array(
    z.object({
      origin: z.array(z.number()),
      size: z.array(z.number()),
      blocks: z.number(),
    }),
  ),
});

export const inspectSchematicTool = defineTool({
  name: "inspect_schematic",
  title: "Inspect a schematic",
  description:
    "Read a schematic file (Litematic, Sponge .schem, structure .nbt, Building Gadgets, Structurize blueprint) and report its format, Minecraft version, overall size [x, y, z], total non-air blocks, the 30 most common block states with counts, and each region's origin and size.",
  inputSchema: z.object(schematicInputShape),
  outputSchema: inspectOutputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    const { projection } = await loadSchematic(args, deps);
    return jsonResult({ ...inspectProjection(projection) });
  },
});

export const convertSchematicTool = defineTool({
  name: "convert_schematic",
  title: "Convert a schematic",
  description:
    "Convert a schematic to another format and, optionally, another Minecraft version. Returns a download URL that expires after 24 hours, plus any warnings from translating block states between versions. See list_versions for formats and versions.",
  inputSchema: z.object({
    ...schematicInputShape,
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
  }),
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: async (args, deps) => {
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
    const { input, projection } = await loadSchematic(args, deps);
    const converted = convertSchematic({
      bytes: input.bytes,
      inputFilename: input.filename,
      outputFormat,
      targetVersion,
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
    const warnings = translationWarnings(projection, outputVersion);

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
    });
  },
});

export const renderSchematicTool = defineTool({
  name: "render_schematic",
  title: "Render a schematic",
  description:
    "Render a schematic as a PNG contact sheet: four isometric views, front/side/top elevations, two plan slices and a cutaway, with flat-coloured blocks. Use it to see what a build looks like.",
  inputSchema: z.object(schematicInputShape),
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, deps) => {
    const { input, projection } = await loadSchematic(args, deps);
    const name = projection.name.trim() || input.filename;
    const { png, width, height } = renderProjectionPng(projection, { name });
    const info = inspectProjection(projection);
    const [x, y, z] = info.size;
    const summary =
      `Contact sheet of ${name}: ${projection.inputFormat}, Minecraft ` +
      `${versionName(projection.minecraftVersion)}, ${x}×${y}×${z}, ` +
      `${info.total_blocks} blocks in ${info.palette_size} block states ` +
      `(${width}×${height} PNG).`;
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
