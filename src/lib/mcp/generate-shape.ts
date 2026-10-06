// `generate_shape`: the Shape Generator (`src/lib/shapes/`) as a tool. A
// shape, a material and a version become a schematic file in any writable
// format, returned as a signed URL, optionally with a rendered PNG.

import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { serializeSchematic, type SchematicFormatId } from "../convert";
import type { ModpackBlocks } from "../modpacks/registry";
import {
  buildShapeProjection,
  defaultShapeName,
  MAX_SHAPE_BLOCKS,
  parseMaterial,
  type ShapeSpec,
} from "../shapes/generate";
import { MAX_DIMENSION, MAX_THICKNESS, SHAPE_KINDS } from "../shapes/shapes";
import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/known-versions";
import { versionName } from "../schemlib/schematic-formats/version-mapping";
import { modpackInput } from "./input";
import { assertProjectionBlocks, resolveLimits } from "./limits";
import { assertBlobConfigured, publishFile } from "./output";
import { modpackRenderSource, renderProjectionPng } from "./render";
import { OUTPUT_FORMATS } from "./schematic-tools";
import { resolveToolBlocks } from "./tool-blocks";
import { defineTool, jsonResult } from "./types";

// Ranges are described but not enforced by the schema, so out-of-range
// values get the Shape Generator's own error text.
const generateShapeInput = z.object({
  shape: z.enum(SHAPE_KINDS),
  width: z
    .number()
    .describe(`Size along X, a whole number from 1 to ${MAX_DIMENSION}.`),
  height: z
    .number()
    .describe(`Size along Y, a whole number from 1 to ${MAX_DIMENSION}.`),
  depth: z
    .number()
    .describe(`Size along Z, a whole number from 1 to ${MAX_DIMENSION}.`),
  axis: z
    .enum(["x", "y", "z"])
    .optional()
    .describe(
      "Cylinder only: the axis its circular faces are perpendicular to. Defaults to y.",
    ),
  hollow: z
    .boolean()
    .optional()
    .describe("Keep only a shell `thickness` blocks thick."),
  thickness: z
    .number()
    .optional()
    .describe(
      `Wall thickness when hollow, a whole number from 1 to ${MAX_THICKNESS}. Defaults to 1.`,
    ),
  material: z
    .string()
    .describe(
      "Block state, e.g. minecraft:oak_log[axis=x]; minecraft: may be left off. Use flattened (1.13+) ids for every version: 1.12.2 shapes are written as the material's Forge 1.12 state. With modpack, a mod block must be one of the pack's blocks; without it, mod ids are written as typed.",
    ),
  version: z
    .string()
    .describe("The Minecraft version, as listed by list_versions."),
  modpack: modpackInput,
  output_format: z
    .enum(OUTPUT_FORMATS as [string, ...string[]])
    .describe("The output format id, as listed by list_versions."),
  render: z
    .boolean()
    .optional()
    .describe("Also return a PNG contact sheet of the shape."),
});

/**
 * Throws unless a mod `material` is a block of the pack with valid states
 * (the error names close pack ids). Vanilla ids and unparseable materials
 * are left to the Shape Generator's own checks.
 */
function assertModpackMaterial(material: string, modpack: ModpackBlocks) {
  const parsed = parseMaterial(material);
  if (!parsed.ok || parsed.material.blockId.startsWith("minecraft:")) return;
  const { blockId, properties } = parsed.material;
  const list = Object.entries(properties)
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
  const result = modpack.registry.validateState(
    list ? `${blockId}[${list}]` : blockId,
  );
  if (!result.ok) throw new Error(result.error);
}

export const generateShapeTool = defineTool({
  name: "generate_shape",
  title: "Generate a shape",
  description: `Generate a primitive shape (cuboid, ellipsoid, dome, cylinder, cone, pyramid) of one material, solid or hollow, and write it as a schematic file. Returns a download URL that expires after 24 hours and the block count; with render, also a PNG contact sheet. At most ${MAX_SHAPE_BLOCKS.toLocaleString("en-US")} blocks.`,
  inputSchema: generateShapeInput,
  outputSchema: z.object({
    url: z.string(),
    filename: z.string(),
    bytes: z.number(),
    expires_at: z.string(),
    format: z.string(),
    minecraft_version: z.string(),
    size: z.array(z.number()),
    block_count: z.number(),
    block_state: z.string(),
  }),
  annotations: { readOnlyHint: false, openWorldHint: true },
  timeoutHint: "Try a smaller shape.",
  handler: async (args, deps): Promise<CallToolResult> => {
    assertBlobConfigured(deps);
    const versionId = args.version.trim();
    if (!Object.hasOwn(KNOWN_VERSIONS, versionId)) {
      throw new Error(
        `Unknown Minecraft version '${versionId}'. Call list_versions for the supported versions.`,
      );
    }
    // The pack's blocks (the material must be one) and its colours and
    // shapes for the render; its Minecraft version must be `version`.
    const modpack = args.modpack?.trim()
      ? (
          await resolveToolBlocks(
            { version: versionId, modpack: args.modpack },
            deps,
          )
        ).modpack
      : null;
    const outputFormat = args.output_format as SchematicFormatId;
    const spec: ShapeSpec = {
      shape: args.shape,
      width: args.width,
      height: args.height,
      depth: args.depth,
      axis: args.axis,
      hollow: args.hollow,
      thickness: args.thickness,
      material: args.material,
      versionId,
    };

    if (modpack) assertModpackMaterial(args.material, modpack);
    const built = buildShapeProjection(spec);
    if (!built.ok) throw new Error(built.error);
    const { projection } = built;
    // The Shape Generator already stops at MAX_SHAPE_BLOCKS; this applies a
    // lower server limit if one is set.
    assertProjectionBlocks(
      projection,
      resolveLimits(deps.limits).maxProjectionBlocks,
    );

    const serialized = serializeSchematic({
      schematic: projection,
      inputFilename: defaultShapeName(spec),
      outputFormat,
      targetVersion: versionId,
    });
    if (!serialized.ok) throw new Error(serialized.error);

    // Rendered before the upload, so a render failure leaves no file behind.
    const png = args.render
      ? renderProjectionPng(projection, {
          name: projection.name,
          ...(modpack && { appearance: modpackRenderSource(modpack) }),
        }).png
      : undefined;

    const file = await publishFile(
      serialized.bytes,
      serialized.filename,
      serialized.mimeType,
      deps,
    );
    const result = jsonResult({
      url: file.url,
      filename: file.filename,
      bytes: file.bytes,
      expires_at: file.expiresAt,
      format: outputFormat,
      minecraft_version: versionName(projection.minecraftVersion),
      size: projection.regions[0].size,
      block_count: projection.totalBlocks,
      block_state: projection.palette[0].blockState,
    });
    if (!png) return result;
    return {
      ...result,
      content: [
        ...result.content,
        {
          type: "image",
          data: Buffer.from(png).toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  },
});
