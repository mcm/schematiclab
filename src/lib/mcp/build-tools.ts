// The build language (`src/lib/buildlang/`) over MCP: `compile_build` and
// `check_build`, the language spec as the resource
// `schematiclab://buildlang/spec`, and the `design_build` prompt. Stateless:
// the agent sends its whole program on every call.
//
// The spec is read from `src/lib/buildlang/SPEC.md` on disk; the file is
// traced into the MCP route by `outputFileTracingIncludes` in
// `next.config.ts`.

import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CallToolResult,
  GetPromptResult,
  McpServer,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  type BuildResult,
  compileForRegistry,
  compileProgram,
} from "../buildlang/build";
import type { ModpackBlocks } from "../modpacks/registry";
import { MAX_BUILD_SIZE } from "../buildlang/program";
import { serializeSchematic, type SchematicFormatId } from "../convert";
import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/known-versions";
import { modpackInput } from "./input";
import { assertBlobConfigured, publishFile } from "./output";
import { modpackRenderSource, renderProjectionPng } from "./render";
import { OUTPUT_FORMATS } from "./schematic-tools";
import { resolveToolBlocks } from "./tool-blocks";
import { defineTool, type McpDeps } from "./types";

export const BUILDLANG_SPEC_URI = "schematiclab://buildlang/spec";
export const BUILDLANG_SPEC_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "buildlang",
  "SPEC.md",
);

let spec: string | undefined;

/** The build language reference (`src/lib/buildlang/SPEC.md`). */
export function buildlangSpec(): string {
  spec ??= readFileSync(BUILDLANG_SPEC_PATH, "utf8");
  return spec;
}

/** The spec's "Workflow" section (section 6), heading included. */
export function buildlangWorkflow(): string {
  const text = buildlangSpec();
  const start = text.indexOf("\n## 6. Workflow");
  if (start < 0) throw new Error("SPEC.md has no '## 6. Workflow' section.");
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start + 1, next < 0 ? undefined : next).trim();
}

function checkVersion(raw: string): string {
  const versionId = raw.trim();
  if (!Object.hasOwn(KNOWN_VERSIONS, versionId)) {
    throw new Error(
      `Unknown Minecraft version '${versionId}'. Call list_versions for the supported versions.`,
    );
  }
  return versionId;
}

// Agents sometimes send the program as a JSON string; both are accepted.
function parseProgramArg(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `program is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

const programInput = z
  .union([z.record(z.string(), z.unknown()), z.string()])
  .describe(
    `The whole build program, a JSON object (or the same as a JSON string): name, size (at most ${MAX_BUILD_SIZE} per axis), seed, palette, templates and build. Read the resource ${BUILDLANG_SPEC_URI} for the language.`,
  );
const versionInput = z
  .string()
  .describe(
    "The Minecraft version to build for, as listed by list_versions. Block ids are flattened (1.13+) names for every version.",
  );

const buildSummary = z.object({
  name: z.string(),
  minecraft_version: z.string(),
  valid: z.boolean(),
  errors: z.number(),
  warnings: z.number(),
  notes: z.number(),
  block_count: z.number(),
});

function summary(
  built: BuildResult,
  versionId: string,
  program: unknown,
): z.infer<typeof buildSummary> {
  const raw = program as { name?: unknown } | null;
  return {
    name:
      built.analysis?.name ??
      (typeof raw?.name === "string" && raw.name.trim() !== ""
        ? raw.name
        : "untitled"),
    minecraft_version: versionId,
    valid: built.projection !== null,
    errors: built.errors.length,
    warnings: built.warnings.length,
    notes: built.notes.length,
    block_count: built.projection?.totalBlocks ?? 0,
  };
}

interface CompiledArgs {
  built: BuildResult;
  versionId: string;
  program: unknown;
  /** The pack compiled against, null without `modpack`. */
  modpack: ModpackBlocks | null;
}

async function compileArgs(
  args: { program: unknown; version: string; modpack?: string },
  deps: McpDeps,
): Promise<CompiledArgs> {
  const versionId = checkVersion(args.version);
  const program = parseProgramArg(args.program);
  if (args.modpack?.trim()) {
    const blocks = await resolveToolBlocks(
      { version: versionId, modpack: args.modpack },
      deps,
    );
    const built = compileForRegistry(program, versionId, blocks.registry);
    return { built, versionId, program, modpack: blocks.modpack };
  }
  const built = await compileProgram(program, versionId, { fetch: deps.fetch });
  return { built, versionId, program, modpack: null };
}

/** `name` as a file name stem: runs of anything but letters, digits, `-` and `_` become `_`. */
export function buildFileStem(name: string): string {
  const stem = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return stem === "" ? "build" : stem;
}

export const checkBuildTool = defineTool({
  name: "check_build",
  title: "Check a build program",
  description: `Compile a build-language program for a Minecraft version and return only its report: errors, warnings and notes at their program paths, then geometry (floating pieces, sealed rooms), features (doors, windows, blocked doors), symmetry and materials. No render and no file. The language is the resource ${BUILDLANG_SPEC_URI}.`,
  inputSchema: z.object({
    program: programInput,
    version: versionInput,
    modpack: modpackInput,
  }),
  outputSchema: buildSummary,
  annotations: { readOnlyHint: true, openWorldHint: false },
  timeoutHint: "Try a smaller build.",
  handler: async (args, deps): Promise<CallToolResult> => {
    const { built, versionId, program } = await compileArgs(args, deps);
    return {
      content: [{ type: "text", text: built.report }],
      structuredContent: summary(built, versionId, program),
    };
  },
});

export const compileBuildTool = defineTool({
  name: "compile_build",
  title: "Compile a build program",
  description: `Compile a build-language program for a Minecraft version. Returns the report (errors, warnings and notes at their program paths, then geometry, features, symmetry and materials) as text and, unless render is false, a PNG contact sheet of the build. With output_format, also writes the build as a schematic file and returns a download URL that expires after 24 hours. Send the whole program each time. The language is the resource ${BUILDLANG_SPEC_URI}; the design_build prompt has the workflow.`,
  inputSchema: z.object({
    program: programInput,
    version: versionInput,
    modpack: modpackInput,
    output_format: z
      .enum(OUTPUT_FORMATS as [string, ...string[]])
      .optional()
      .describe(
        "Also write the build as a schematic in this format (a format id from list_versions).",
      ),
    render: z
      .boolean()
      .optional()
      .describe("Return a PNG contact sheet of the build. Defaults to true."),
  }),
  outputSchema: buildSummary.extend({
    file: z
      .object({
        url: z.string(),
        filename: z.string(),
        bytes: z.number(),
        expires_at: z.string(),
        format: z.string(),
        minecraft_version: z.string(),
      })
      .optional(),
  }),
  annotations: { readOnlyHint: false, openWorldHint: true },
  timeoutHint: "Try a smaller build, or render: false.",
  handler: async (args, deps): Promise<CallToolResult> => {
    const outputFormat = args.output_format as SchematicFormatId | undefined;
    if (outputFormat) assertBlobConfigured(deps);
    const { built, versionId, program, modpack } = await compileArgs(
      args,
      deps,
    );
    const data: Record<string, unknown> = summary(built, versionId, program);
    const content: CallToolResult["content"] = [
      { type: "text", text: built.report },
    ];
    const { projection } = built;
    const render = args.render ?? true;

    if (projection === null) {
      if (outputFormat || render) {
        content.push({
          type: "text",
          text: "Nothing was rendered or written: the program has validation errors. Fix them and send the whole program again.",
        });
      }
      return { content, structuredContent: data };
    }

    // Rendered before the upload, so a render failure leaves no file behind.
    let png: Uint8Array | undefined;
    if (render) {
      if (projection.totalBlocks === 0) {
        content.push({
          type: "text",
          text: "Nothing was rendered: the build is empty.",
        });
      } else {
        png = renderProjectionPng(projection, {
          name: projection.name,
          ...(modpack && { appearance: modpackRenderSource(modpack) }),
        }).png;
      }
    }

    if (outputFormat) {
      const serialized = serializeSchematic({
        schematic: projection,
        inputFilename: `${buildFileStem(projection.name)}.json`,
        outputFormat,
        targetVersion: versionId,
      });
      if (!serialized.ok) throw new Error(serialized.error);
      const file = await publishFile(
        serialized.bytes,
        serialized.filename,
        serialized.mimeType,
        deps,
      );
      const fileData = {
        url: file.url,
        filename: file.filename,
        bytes: file.bytes,
        expires_at: file.expiresAt,
        format: outputFormat,
        minecraft_version: versionId,
      };
      data.file = fileData;
      content.push({ type: "text", text: JSON.stringify({ file: fileData }) });
    }

    if (png) {
      content.push({
        type: "image",
        data: Buffer.from(png).toString("base64"),
        mimeType: "image/png",
      });
    }
    return { content, structuredContent: data };
  },
});

/** Registers the spec resource and the `design_build` prompt. */
export function registerBuildlangResources(server: McpServer): void {
  server.registerResource(
    "buildlang_spec",
    BUILDLANG_SPEC_URI,
    {
      title: "Build language reference",
      description:
        "The build language compile_build and check_build take: program structure, scopes, operations, materials, idioms and the design workflow.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: buildlangSpec() },
      ],
    }),
  );

  server.registerPrompt(
    "design_build",
    {
      title: "Design a build",
      description:
        "Design a Minecraft build with the build language: the language reference plus the plan-first workflow for compile_build.",
      argsSchema: z.object({
        request: z.string().describe("What to build."),
        version: z
          .string()
          .describe("The Minecraft version, as listed by list_versions."),
      }),
    },
    ({ request, version }) => designBuildPrompt(request, version),
  );
}

/** The `design_build` prompt: the request, the workflow, then the whole spec. */
export function designBuildPrompt(
  request: string,
  version: string,
): GetPromptResult {
  const versionId = checkVersion(version);
  const text = [
    `Design this Minecraft build for Minecraft Java ${versionId} with Schematiclab's build language:`,
    "",
    request.trim(),
    "",
    "Work plan-first, following the workflow below. Compile every revision with `compile_build` " +
      `(version "${versionId}"), or \`check_build\` for the report alone, and keep revising until ` +
      "the report has no errors and no unintended warnings. Then compile once more with an " +
      "`output_format` to get the schematic file.",
    "",
    buildlangWorkflow(),
    "",
    "The full language reference follows.",
    "",
    buildlangSpec(),
  ].join("\n");
  return {
    description: `Design a build for Minecraft ${versionId}`,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}
