// `generate_shape`: the Shape Generator (`src/lib/shapes/`) as a tool. A
// shape, a material and a version become a schematic file in any writable
// format, returned as a signed URL, optionally with a rendered PNG.

import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CamoSpec } from "../buildlang/materials";
import {
  camoChoiceForFrame,
  formatCamoSuffix,
  splitCamoMaterial,
} from "../camo/material-syntax";
import { withCamoMaterials } from "../camo/materials";
import { camoWriteOptionsFor, writeCamoChoice } from "../camo/write";
import {
  serializeSchematic,
  type ParsedSchematicProjection,
  type SchematicFormatId,
} from "../convert";
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
import {
  assertCamoFrame,
  camoTargetsOf,
  modpackCamoRules,
} from "./camo-materials";
import { modpackInput } from "./input";
import { assertProjectionBlocks, resolveLimits } from "./limits";
import { assertBlobConfigured, publishFile } from "./output";
import { modpackRenderSource, renderProjectionPng } from "./render";
import { OUTPUT_FORMATS } from "./schematic-tools";
import { resolveToolBlocks, type ToolBlocks } from "./tool-blocks";
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
      "Block state, e.g. minecraft:oak_log[axis=x]; minecraft: may be left off. Use flattened (1.13+) ids for every version: 1.12.2 shapes are written as the material's Forge 1.12 state. With modpack, a mod block must be one of the pack's blocks; without it, mod ids are written as typed. With modpack, a camo frame takes a camo: framedblocks:framed_cube{camo=create:brass_block}, or {camo=<a>,camo_two=<b>} for FramedBlocks double blocks.",
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

/**
 * The camo of a `{camo=...}` material on the frame `material`, checked
 * against the pack's camo rules. Throws without a modpack.
 */
function camoOf(
  camo: { camo: string; camo_two?: string },
  material: string,
  blocks: ToolBlocks | null,
): CamoSpec {
  if (!blocks?.modpack) {
    throw new Error(
      "A camo material ({camo=...}) needs a modpack with camo frames.",
    );
  }
  const parsed = parseMaterial(material);
  if (!parsed.ok) throw new Error(parsed.error);
  const { blockId, properties } = parsed.material;
  const rules = modpackCamoRules(blocks.modpack, blocks.data);
  assertCamoFrame(
    blockId,
    { ...blocks.registry.defaults(blockId), ...properties },
    camo.camo_two === undefined ? ["camo"] : ["camo", "camo_two"],
    rules,
  );
  return camoTargetsOf(camo, blocks.modpack, rules);
}

/**
 * `projection` (one frame block) with the block entity holding `camo` on
 * every placement; they share one NBT compound.
 */
function withCamo(
  projection: ParsedSchematicProjection,
  camo: CamoSpec,
): ParsedSchematicProjection {
  const [frame] = projection.palette;
  const nbt = writeCamoChoice(
    frame.blockId,
    frame.properties,
    undefined,
    camoChoiceForFrame(frame.blockId, frame.properties, camo),
    camoWriteOptionsFor(projection.minecraftVersion),
  );
  if (nbt === undefined) return projection;
  const regions = projection.regions.map((region) => ({
    ...region,
    blockEntities: region.blocks.map((block) => ({ pos: block.pos, nbt })),
  }));
  return {
    ...projection,
    palette: withCamoMaterials(projection.palette, regions),
    regions,
  };
}

export const generateShapeTool = defineTool({
  name: "generate_shape",
  title: "Generate a shape",
  description: `Generate a primitive shape (cuboid, ellipsoid, dome, cylinder, cone, pyramid) of one material, solid or hollow, and write it as a schematic file. Returns a download URL that expires after 24 hours and the block count; with render, also a PNG contact sheet. At most ${MAX_SHAPE_BLOCKS.toLocaleString("en-US")} blocks. When the user names a modpack, pass its ref (from list_modpacks) as modpack: the material must then be one of the pack's blocks, and a camo frame can hold a camo material (frame{camo=block}).`,
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
    camo: z.string().optional(),
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
    const blocks = args.modpack?.trim()
      ? await resolveToolBlocks(
          { version: versionId, modpack: args.modpack },
          deps,
        )
      : null;
    const modpack = blocks?.modpack ?? null;
    const split = splitCamoMaterial(args.material);
    if (!split.ok) throw new Error(`Material: ${split.error}.`);
    const material = split.value.frame;
    const outputFormat = args.output_format as SchematicFormatId;
    const spec: ShapeSpec = {
      shape: args.shape,
      width: args.width,
      height: args.height,
      depth: args.depth,
      axis: args.axis,
      hollow: args.hollow,
      thickness: args.thickness,
      material,
      versionId,
    };

    if (modpack) assertModpackMaterial(material, modpack);
    const camo = split.value.camo && camoOf(split.value.camo, material, blocks);
    const built = buildShapeProjection(spec);
    if (!built.ok) throw new Error(built.error);
    const projection = camo
      ? withCamo(built.projection, camo)
      : built.projection;
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
      ...(camo && { camo: formatCamoSuffix(camo) }),
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
