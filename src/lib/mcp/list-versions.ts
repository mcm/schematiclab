// `list_versions`: the Minecraft versions and output formats the other tools
// accept.

import { z } from "zod";
import {
  SUPPORTED_FORMATS,
  type SchematicFormatId,
  formatExtension,
} from "@/lib/convert";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/known-versions";
import { defineTool, jsonResult } from "./types";

export interface OutputFormatInfo {
  id: SchematicFormatId;
  extension: string;
}

export interface ListVersionsResult {
  versions: string[];
  formats: OutputFormatInfo[];
}

export function listVersions(): ListVersionsResult {
  return {
    versions: Object.keys(KNOWN_VERSIONS),
    // The JSON intermediate format is dev-only and never an output (FORMATS.md).
    formats: SUPPORTED_FORMATS.filter((id) => id !== "JSON").map((id) => ({
      id,
      extension: formatExtension(id),
    })),
  };
}

export const listVersionsTool = defineTool({
  name: "list_versions",
  title: "List versions and formats",
  description:
    "List the Minecraft Java versions Schematiclab can read and write, and the schematic output formats with their file extensions.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    versions: z.array(z.string()),
    formats: z.array(z.object({ id: z.string(), extension: z.string() })),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: () => jsonResult({ ...listVersions() }),
});
