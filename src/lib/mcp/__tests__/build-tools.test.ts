import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../../next.config";
import {
  clearBlockDataCache,
  MINECRAFT_DATA_COMMIT,
} from "../../blockdata/load";
import { compileProgram } from "../../buildlang/build";
import { parseSchematic } from "../../convert";
import { decodePng } from "../../render/block-appearance";
import {
  BUILDLANG_SPEC_URI,
  buildFileStem,
  buildlangWorkflow,
  checkBuildTool,
  compileBuildTool,
} from "../build-tools";
import { BLOB_NOT_CONFIGURED_MESSAGE } from "../output";
import { createMcpRequestHandler } from "../server";
import { runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const ROOT = path.join(__dirname, "../../../..");
const SPEC_FILE = path.join(ROOT, "src/lib/buildlang/SPEC.md");
const FIXTURES = path.join(__dirname, "../../blockdata/__tests__/fixtures");
const RESPONSES: Record<string, string> = {
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json":
    "registry-mcmeta-1.21.4-blocks.json",
  [`https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-data@${MINECRAFT_DATA_COMMIT}/data/pc/1.13.2/blocks.json`]:
    "minecraft-data-1.13.2-blocks.json",
};
const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const file = RESPONSES[String(input)];
  return file === undefined
    ? new Response("not found", { status: 404 })
    : new Response(readFileSync(path.join(FIXTURES, file), "utf8"), {
        status: 200,
      });
});

const NOW = new Date("2026-10-04T12:00:00Z");

function makeDeps(
  overrides: Partial<McpDeps> = {},
): McpDeps & { blob: FakeBlob } {
  return {
    fetch: fetchStub as never,
    now: () => NOW,
    blob: createFakeBlob(() => NOW),
    blobStoreId: "store_store",
    ...overrides,
  } as McpDeps & { blob: FakeBlob };
}

beforeEach(() => clearBlockDataCache());

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connect(deps: McpDeps): Promise<Client> {
  const handler = createMcpRequestHandler(deps);
  const client = new Client({ name: "test", version: "0.0.0" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      fetch: async (input, init) => handler(new Request(input, init)),
    }),
  );
  return client;
}

function texts(result: CallToolResult): string[] {
  return result.content.flatMap((c) => (c.type === "text" ? [c.text] : []));
}

function images(result: CallToolResult) {
  return result.content.flatMap((c) => (c.type === "image" ? [c] : []));
}

// A stone floor and walls with a stair step: small, valid on 1.21.4 and on
// 1.12.2 (1.13.2 block data).
const HUT = {
  name: "Stone hut",
  size: [5, 4, 5],
  palette: { wall: "stone" },
  build: [
    { box: { size: ["~", 1, "~"], do: [{ fill: "@wall" }] } },
    {
      box: {
        at: [0, 1, 0],
        size: ["~", 3, "~"],
        do: [{ faces: { sides: [{ fill: "@wall" }] } }],
      },
    },
    { block: { at: [2, 1, 2], material: "oak_stairs", facing: "+z" } },
  ],
};

describe("compile_build", () => {
  it("returns the report and a render by default, and no file", async () => {
    const deps = makeDeps();
    const result = await runTool(
      compileBuildTool,
      { program: HUT, version: "1.21.4" },
      deps,
    );
    expect(result.isError).toBeFalsy();
    const expected = await compileProgram(HUT, "1.21.4", { fetch: fetchStub });
    expect(texts(result)).toEqual([expected.report]);
    expect(expected.report).toContain("# Build report: Stone hut");

    const [image] = images(result);
    expect(image.mimeType).toBe("image/png");
    const png = decodePng(Buffer.from(image.data, "base64"));
    expect(png?.width).toBeGreaterThan(0);
    // The report comes first, the image last.
    expect(result.content.map((c) => c.type)).toEqual(["text", "image"]);

    expect(result.structuredContent).toEqual({
      name: "Stone hut",
      minecraft_version: "1.21.4",
      valid: true,
      errors: 0,
      warnings: expected.warnings.length,
      notes: expected.notes.length,
      block_count: expected.projection?.totalBlocks,
    });
    expect(deps.blob.objects.size).toBe(0);
  });

  it("leaves the render out with render: false", async () => {
    const result = await runTool(
      compileBuildTool,
      { program: HUT, version: "1.21.4", render: false },
      makeDeps(),
    );
    expect(result.content.map((c) => c.type)).toEqual(["text"]);
  });

  it("writes the build and returns its Blob URL with output_format", async () => {
    const deps = makeDeps();
    const result = await runTool(
      compileBuildTool,
      { program: HUT, version: "1.21.4", output_format: "Sponge[v2]" },
      deps,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content.map((c) => c.type)).toEqual([
      "text",
      "text",
      "image",
    ]);
    const data = result.structuredContent as {
      block_count: number;
      file: { url: string; filename: string; bytes: number; format: string };
    };
    expect(JSON.parse(texts(result)[1])).toEqual({ file: data.file });
    expect(data.file).toMatchObject({
      filename: "Stone_hut.schem",
      format: "Sponge[v2]",
      minecraft_version: "1.21.4",
      expires_at: "2026-10-05T12:00:00.000Z",
    });
    expect(data.file.url).toMatch(
      /^https:\/\/store\.private\.blob\.vercel-storage\.com\/mcp\/Stone_hut-rnd1\.schem\?/,
    );

    const [[pathname, stored]] = [...deps.blob.objects];
    expect(pathname).toBe("mcp/Stone_hut-rnd1.schem");
    expect(data.file.bytes).toBe(stored.body.length);
    const reparsed = parseSchematic(stored.body);
    if (!reparsed.ok) throw new Error(reparsed.error);
    expect(reparsed.schematic.inputFormat).toBe("Sponge[v2]");
    const blocks = reparsed.schematic.palette
      .filter((e) => e.blockId !== "minecraft:air")
      .reduce((n, e) => n + e.count, 0);
    expect(blocks).toBe(data.block_count);
  });

  it("writes 1.12.2 builds as Forge 1.12 states", async () => {
    const deps = makeDeps();
    const result = await runTool(
      compileBuildTool,
      {
        program: { ...HUT, palette: { wall: "granite" } },
        version: "1.12.2",
        output_format: "Litematic",
        render: false,
      },
      deps,
    );
    expect(result.isError).toBeFalsy();
    const [[, stored]] = [...deps.blob.objects];
    const reparsed = parseSchematic(stored.body);
    if (!reparsed.ok) throw new Error(reparsed.error);
    expect(reparsed.schematic.minecraftVersion.versionNumber).toEqual([
      1, 12, 2,
    ]);
    expect(reparsed.schematic.palette.map((e) => e.blockState)).toContain(
      "minecraft:stone[variant=granite]",
    );
  });

  it("accepts the program as a JSON string", async () => {
    const result = await runTool(
      compileBuildTool,
      { program: JSON.stringify(HUT), version: "1.21.4", render: false },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(texts(result)[0]).toContain("# Build report: Stone hut");
  });

  it("reports an invalid program at its paths, with no render or file", async () => {
    const deps = makeDeps();
    const result = await runTool(
      compileBuildTool,
      {
        program: { name: "bad", size: [300, 4, 4], build: [{ fil: "stone" }] },
        version: "1.21.4",
        output_format: "Litematic",
      },
      deps,
    );
    expect(result.isError).toBeFalsy();
    const [report, note] = texts(result);
    expect(report).toContain("size[0]");
    expect(report).toContain("build[0]");
    expect(note).toMatch(/Nothing was rendered or written/);
    expect(images(result)).toEqual([]);
    expect(result.structuredContent).toMatchObject({
      name: "bad",
      valid: false,
      block_count: 0,
    });
    expect(deps.blob.objects.size).toBe(0);
  });

  it("builds roofs", async () => {
    const result = await runTool(
      compileBuildTool,
      {
        program: {
          size: [9, 6, 9],
          palette: { roof: "oak" },
          build: [
            { box: { at: [1, 1, 1], size: [7, 5, 7], do: [{ roof: "hip" }] } },
          ],
        },
        version: "1.21.4",
        render: false,
      },
      makeDeps(),
    );
    expect(texts(result)[0]).not.toContain("not supported");
    expect(result.structuredContent).toMatchObject({ valid: true, errors: 0 });
    expect(
      (result.structuredContent as { block_count: number }).block_count,
    ).toBeGreaterThan(49);
  });

  it("says so instead of rendering an empty build", async () => {
    const result = await runTool(
      compileBuildTool,
      { program: { size: [2, 2, 2], build: [] }, version: "1.21.4" },
      makeDeps(),
    );
    expect(texts(result)[1]).toBe("Nothing was rendered: the build is empty.");
    expect(images(result)).toEqual([]);
  });

  it("returns tool errors for bad JSON, unknown versions and no Blob store", async () => {
    const badJson = await runTool(
      compileBuildTool,
      { program: "{not json", version: "1.21.4" },
      makeDeps(),
    );
    expect(badJson.isError).toBe(true);
    expect(texts(badJson)[0]).toMatch(/^program is not valid JSON/);

    const badVersion = await runTool(
      compileBuildTool,
      { program: HUT, version: "1.99" },
      makeDeps(),
    );
    expect(texts(badVersion)[0]).toBe(
      "Unknown Minecraft version '1.99'. Call list_versions for the supported versions.",
    );

    fetchStub.mockClear();
    const noBlob = await runTool(
      compileBuildTool,
      { program: HUT, version: "1.21.4", output_format: "Litematic" },
      makeDeps({ blob: null }),
    );
    expect(texts(noBlob)).toEqual([BLOB_NOT_CONFIGURED_MESSAGE]);
    // Failed before compiling anything.
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("check_build", () => {
  it("returns the report only, with no render and no file", async () => {
    const deps = makeDeps();
    const result = await runTool(
      checkBuildTool,
      { program: HUT, version: "1.21.4" },
      deps,
    );
    expect(result.isError).toBeFalsy();
    const expected = await compileProgram(HUT, "1.21.4", { fetch: fetchStub });
    expect(result.content).toEqual([{ type: "text", text: expected.report }]);
    expect(result.structuredContent).toMatchObject({
      name: "Stone hut",
      valid: true,
      errors: 0,
    });
    expect(deps.blob.objects.size).toBe(0);
  });
});

describe("over MCP", () => {
  it("lists and calls both tools", async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("compile_build");
    expect(names).toContain("check_build");
    const compile = tools.find((t) => t.name === "compile_build");
    expect(Object.keys(compile?.inputSchema.properties ?? {})).toEqual([
      "program",
      "version",
      "modpack",
      "output_format",
      "render",
    ]);
    expect(compile?.inputSchema.required).toEqual(["program", "version"]);

    const result = (await client.callTool({
      name: "check_build",
      arguments: { program: HUT, version: "1.21.4" },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(texts(result)[0]).toContain("# Build report: Stone hut");
  });

  it("serves SPEC.md as the spec resource", async () => {
    const client = await connect(makeDeps());
    const { resources } = await client.listResources();
    expect(resources).toContainEqual(
      expect.objectContaining({
        uri: BUILDLANG_SPEC_URI,
        mimeType: "text/markdown",
      }),
    );
    const read = await client.readResource({ uri: BUILDLANG_SPEC_URI });
    expect(read.contents).toEqual([
      {
        uri: BUILDLANG_SPEC_URI,
        mimeType: "text/markdown",
        text: readFileSync(SPEC_FILE, "utf8"),
      },
    ]);
  });

  it("design_build returns the request, the workflow and the spec", async () => {
    const client = await connect(makeDeps());
    const { prompts } = await client.listPrompts();
    const prompt = prompts.find((p) => p.name === "design_build");
    expect(prompt?.arguments?.map((a) => [a.name, a.required])).toEqual([
      ["request", true],
      ["version", true],
      ["modpack", false],
    ]);

    const result = await client.getPrompt({
      name: "design_build",
      arguments: { request: "A small stone chapel", version: "1.20.1" },
    });
    expect(result.messages).toHaveLength(1);
    const [message] = result.messages;
    expect(message.role).toBe("user");
    if (message.content.type !== "text") throw new Error("expected text");
    const text = message.content.text;
    const spec = readFileSync(SPEC_FILE, "utf8");
    expect(text).toContain("A small stone chapel");
    expect(text).toContain("Minecraft Java 1.20.1");
    expect(text).toContain('`compile_build` (version "1.20.1")');
    expect(text.endsWith(spec)).toBe(true);
    // The workflow comes before the spec as well as inside it.
    const workflow = buildlangWorkflow();
    expect(workflow).toMatch(/^## 6\. Workflow\n/);
    expect(workflow).toContain("**Plan first**");
    expect(text.indexOf(workflow)).toBeLessThan(text.length - spec.length);
  });

  it("design_build adds the modpack instructions with a modpack", async () => {
    const client = await connect(makeDeps());
    const result = await client.getPrompt({
      name: "design_build",
      arguments: {
        request: "A starter base",
        version: "1.21.1",
        modpack: " all-the-mods-10@5678901 ",
      },
    });
    const [message] = result.messages;
    if (message.content.type !== "text") throw new Error("expected text");
    const text = message.content.text;
    const spec = readFileSync(SPEC_FILE, "utf8");
    expect(result.description).toContain("all-the-mods-10@5678901");
    expect(text).toContain(
      '`compile_build` (version "1.21.1", modpack "all-the-mods-10@5678901")',
    );
    expect(text).toContain('`modpack: "all-the-mods-10@5678901"`');
    expect(text).toContain("`list_modpacks`");
    expect(text).toContain("`show_blocks`");
    expect(text).toContain("{camo=<block>}");
    expect(text).toContain("`writable: true`");
    expect(text.endsWith(spec)).toBe(true);
    // The instructions come before the workflow and the spec.
    expect(text.indexOf("Only use blocks the pack has")).toBeLessThan(
      text.indexOf(buildlangWorkflow()),
    );

    const plain = await client.getPrompt({
      name: "design_build",
      arguments: { request: "A starter base", version: "1.21.1" },
    });
    if (plain.messages[0].content.type !== "text") throw new Error("text");
    expect(plain.messages[0].content.text).not.toContain(
      "Only use blocks the pack has",
    );
  });

  it("design_build rejects an invalid modpack ref", async () => {
    const client = await connect(makeDeps());
    await expect(
      client.getPrompt({
        name: "design_build",
        arguments: { request: "A tower", version: "1.21.1", modpack: "A B" },
      }),
    ).rejects.toThrow(/Invalid modpack reference 'A B'/);
  });

  it("tool descriptions point agents at list_modpacks and show_blocks", async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("list_modpacks")?.description).toMatch(
      /whenever the user names a modpack/,
    );
    expect(byName.get("list_modpacks")?.description).toContain("show_blocks");
    for (const tool of tools) {
      const modpack = (
        tool.inputSchema.properties as Record<string, { description?: string }>
      )?.modpack;
      if (!modpack) continue;
      expect(modpack.description, tool.name).toContain("list_modpacks");
      expect(modpack.description, tool.name).toContain("every block tool call");
    }
    for (const name of ["search_blocks", "suggest_palette"]) {
      expect(byName.get(name)?.description, name).toContain("show_blocks");
    }
    for (const name of [
      "search_blocks",
      "suggest_palette",
      "show_blocks",
      "generate_shape",
      "compile_build",
      "check_build",
      "render_schematic",
    ]) {
      expect(byName.get(name)?.description, name).toContain("list_modpacks");
    }
  });

  it("design_build rejects an unknown version", async () => {
    const client = await connect(makeDeps());
    await expect(
      client.getPrompt({
        name: "design_build",
        arguments: { request: "A tower", version: "1.99" },
      }),
    ).rejects.toThrow(/Unknown Minecraft version '1\.99'/);
  });
});

describe("SPEC.md", () => {
  const spec = readFileSync(SPEC_FILE, "utf8");

  it("is version-agnostic, bounded at 256 and documents roofs", () => {
    expect(spec).not.toMatch(/1\.21\.4|Cairn|512/);
    expect(spec).toContain("at most 256 on\n  each axis");
    expect(spec).toContain("### Roofs");
    expect(spec).not.toContain("not supported yet");
  });

  it("is traced into the MCP route", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/mcp/*"]).toContain(
      "./src/lib/buildlang/SPEC.md",
    );
  });
});

describe("buildFileStem", () => {
  it("keeps letters, digits, - and _", () => {
    expect(buildFileStem("Stone hut")).toBe("Stone_hut");
    expect(buildFileStem("  ../a.b c!  ")).toBe("a_b_c");
    expect(buildFileStem("???")).toBe("build");
  });
});
