import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseSchematic,
  serializeSchematic,
  type ParsedSchematicProjection,
} from "../../convert";
import { decodePng } from "../../render/block-appearance";
import { KNOWN_VERSIONS } from "../../schemlib/schematic-formats/known-versions";
import {
  MAX_INPUT_BYTES,
  privateBlobHost,
  resolveSchematicInput,
} from "../input";
import { BLOB_NOT_CONFIGURED_MESSAGE } from "../output";
import {
  INSPECT_PALETTE_LIMIT,
  convertSchematicTool,
  inspectSchematicTool,
  renderSchematicTool,
  translationWarnings,
} from "../schematic-tools";
import { createMcpRequestHandler } from "../server";
import { runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const FIXTURES = path.join(__dirname, "../../__tests__/fixtures");
const NOW = new Date("2026-10-04T12:00:00Z");
// The fake blob's presigned URLs use the store id "store".
const STORE_ID = "store_store";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fixtureArgs(name: string): { base64: string; filename: string } {
  return { base64: base64Of(fixture(name)), filename: name };
}

function noNetwork(): typeof fetch {
  return vi.fn(() => Promise.reject(new Error("no network"))) as never;
}

function makeDeps(
  overrides: Partial<McpDeps> = {},
): McpDeps & { blob: FakeBlob } {
  return {
    fetch: noNetwork(),
    now: () => NOW,
    blob: createFakeBlob(() => NOW),
    blobStoreId: STORE_ID,
    ...overrides,
  } as McpDeps & { blob: FakeBlob };
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

function parseFixture(name: string): ParsedSchematicProjection {
  const parsed = parseSchematic(fixture(name));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.schematic;
}

describe("resolveSchematicInput", () => {
  it("decodes base64 with its filename", async () => {
    const bytes = fixture("one_stone_block.nbt");
    const input = await resolveSchematicInput(
      { base64: base64Of(bytes), filename: "house.nbt" },
      makeDeps(),
    );
    expect(input.bytes).toEqual(bytes);
    expect(input.filename).toBe("house.nbt");
  });

  it("needs exactly one of url and base64, and a filename with base64", async () => {
    const deps = makeDeps();
    await expect(resolveSchematicInput({}, deps)).rejects.toThrow(
      "exactly one of url or base64",
    );
    await expect(
      resolveSchematicInput(
        { url: "https://pastebin.com/abc", base64: "AAAA", filename: "a" },
        deps,
      ),
    ).rejects.toThrow("exactly one of url or base64");
    await expect(
      resolveSchematicInput({ base64: "AAAA" }, deps),
    ).rejects.toThrow("filename is required");
    await expect(
      resolveSchematicInput({ base64: "not base64!", filename: "a" }, deps),
    ).rejects.toThrow("not valid base64");
  });

  it("rejects base64 over 5 MB before decoding it", async () => {
    const base64 = "A".repeat(Math.ceil((MAX_INPUT_BYTES + 3) / 3) * 4);
    await expect(
      resolveSchematicInput({ base64, filename: "big.nbt" }, makeDeps()),
    ).rejects.toThrow("larger than the 5 MB limit");
  });

  it("fetches pastebin URLs through the import-url allowlist", async () => {
    const bytes = fixture("one_stone_block_bg2.txt");
    const fetchImpl = vi.fn(async () => new Response(bytes as BodyInit));
    const input = await resolveSchematicInput(
      { url: "https://pastebin.com/AbC123" },
      makeDeps({ fetch: fetchImpl as never }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([
      "https://pastebin.com/raw/AbC123",
      expect.objectContaining({ redirect: "error" }),
    ]);
    expect(input.bytes).toEqual(bytes);
    expect(input.filename).toBe("pastebin-AbC123.txt");
  });

  it("rejects every other host without a request", async () => {
    const deps = makeDeps();
    for (const url of [
      "https://example.com/house.nbt",
      "https://pastebin.com.evil.com/abc",
      "https://other.private.blob.vercel-storage.com/mcp/a.nbt",
      "https://store.public.blob.vercel-storage.com/mcp/a.nbt",
      "http://pastebin.com/abc",
      "https://127.0.0.1/a.nbt",
      "not a url",
    ]) {
      await expect(resolveSchematicInput({ url }, deps)).rejects.toThrow();
    }
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.blob.calls.filter((c) => c.method === "get")).toEqual([]);
  });

  it("rejects Blob URLs when no store id is configured", async () => {
    const deps = makeDeps({ blobStoreId: null });
    await expect(
      resolveSchematicInput(
        { url: "https://store.private.blob.vercel-storage.com/mcp/a.nbt" },
        deps,
      ),
    ).rejects.toThrow("Only pastebin.com and gist.github.com URLs");
  });

  it("reads its own Blob URLs with get() by pathname, without fetching", async () => {
    const deps = makeDeps();
    const bytes = fixture("one_stone_block.nbt");
    deps.blob.objects.set("mcp/house-rnd1.nbt", {
      body: bytes,
      uploadedAt: NOW,
    });
    const input = await resolveSchematicInput(
      {
        url: `https://${privateBlobHost(STORE_ID)}/mcp/house-rnd1.nbt?vercel-blob-signature=x`,
      },
      deps,
    );
    expect(input.bytes).toEqual(bytes);
    expect(input.filename).toBe("house-rnd1.nbt");
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.blob.calls).toEqual([
      { method: "get", args: ["mcp/house-rnd1.nbt", { access: "private" }] },
    ]);
  });

  it("only reads files under mcp/ and reports expired ones", async () => {
    const deps = makeDeps();
    const host = `https://${privateBlobHost(STORE_ID)}`;
    await expect(
      resolveSchematicInput({ url: `${host}/other/a.nbt` }, deps),
    ).rejects.toThrow("under mcp/");
    await expect(
      resolveSchematicInput({ url: `${host}/mcp/%2e%2e/a.nbt` }, deps),
    ).rejects.toThrow("under mcp/");
    await expect(
      resolveSchematicInput({ url: `${host}/mcp/gone.nbt` }, deps),
    ).rejects.toThrow("no longer exists");
  });

  it("caps Blob reads at 5 MB", async () => {
    const deps = makeDeps();
    deps.blob.objects.set("mcp/big.nbt", {
      body: new Uint8Array(MAX_INPUT_BYTES + 1),
      uploadedAt: NOW,
    });
    await expect(
      resolveSchematicInput(
        { url: `https://${privateBlobHost(STORE_ID)}/mcp/big.nbt` },
        deps,
      ),
    ).rejects.toThrow("larger than the 5 MB limit");
  });

  it("matches the store host without the store_ prefix, case-insensitively", () => {
    expect(privateBlobHost("store_AbC")).toBe(
      "abc.private.blob.vercel-storage.com",
    );
    expect(privateBlobHost("AbC")).toBe("abc.private.blob.vercel-storage.com");
  });
});

describe("inspect_schematic", () => {
  it("reports a one-block structure", async () => {
    const result = await runTool(
      inspectSchematicTool,
      fixtureArgs("one_stone_block.nbt"),
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      format: "Structure",
      minecraft_version: "1.20.1",
      size: [1, 1, 1],
      total_blocks: 1,
      palette_size: 1,
      palette: [{ block_state: "minecraft:stone", count: 1 }],
      blocks_not_listed: 0,
      regions: [{ origin: [0, 0, 0], size: [1, 1, 1], blocks: 1 }],
    });
    expect(JSON.parse(text(result))).toEqual(result.structuredContent);
  });

  it("lists the 30 most common block states of a larger build", async () => {
    const result = await runTool(
      inspectSchematicTool,
      fixtureArgs("example_bg0_schematic.txt"),
      makeDeps(),
    );
    const data = result.structuredContent as {
      format: string;
      minecraft_version: string;
      size: number[];
      total_blocks: number;
      palette_size: number;
      palette: { block_state: string; count: number }[];
      blocks_not_listed: number;
    };
    expect(data.format).toBe("BuildingGadgets[1.12]");
    expect(data.minecraft_version).toBe("1.12.2");
    expect(data.size).toEqual([39, 27, 36]);
    expect(data.total_blocks).toBe(7889);
    expect(data.palette).toHaveLength(INSPECT_PALETTE_LIMIT);
    expect(data.palette_size).toBeGreaterThan(INSPECT_PALETTE_LIMIT);
    expect(data.palette[0]).toEqual({
      block_state: "minecraft:stonebrick[variant=stonebrick]",
      count: 1625,
    });
    const counts = data.palette.map((e) => e.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts.reduce((a, b) => a + b, 0) + data.blocks_not_listed).toBe(
      data.total_blocks,
    );
  });

  it("leaves explicit air out of the palette and counts", async () => {
    const projection = parseFixture("ucw_1_12_2.nbt");
    const air = projection.palette.find((e) => e.blockId === "minecraft:air");
    expect(air).toBeDefined();
    const result = await runTool(
      inspectSchematicTool,
      fixtureArgs("ucw_1_12_2.nbt"),
      makeDeps(),
    );
    const data = result.structuredContent as {
      total_blocks: number;
      palette: { block_state: string }[];
      regions: { blocks: number }[];
    };
    expect(data.total_blocks).toBe(projection.totalBlocks - (air?.count ?? 0));
    expect(data.regions[0].blocks).toBe(data.total_blocks);
    expect(data.palette.map((e) => e.block_state)).not.toContain(
      "minecraft:air",
    );
  });

  it("returns the ParseResult error text for an unreadable file", async () => {
    const bytes = new TextEncoder().encode("hello, not a schematic");
    const parsed = parseSchematic(bytes);
    expect(parsed.ok).toBe(false);
    const result = await runTool(
      inspectSchematicTool,
      { base64: base64Of(bytes), filename: "junk.txt" },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(parsed.ok ? "" : parsed.error);
  });
});

describe("convert_schematic", () => {
  it("converts, uploads and returns a signed URL", async () => {
    const deps = makeDeps();
    const result = await runTool(
      convertSchematicTool,
      {
        ...fixtureArgs("one_stone_block.nbt"),
        output_format: "Litematic",
        target_version: "1.21.4",
      },
      deps,
    );
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as {
      url: string;
      filename: string;
      expires_at: string;
      format: string;
      minecraft_version: string;
      warnings: string[];
    };
    expect(data.filename).toBe("one_stone_block.litematic");
    expect(data.format).toBe("Litematic");
    expect(data.minecraft_version).toBe("1.21.4");
    expect(data.warnings).toEqual([]);
    expect(data.expires_at).toBe("2026-10-05T12:00:00.000Z");
    expect(data.url).toMatch(
      /^https:\/\/store\.private\.blob\.vercel-storage\.com\/mcp\//,
    );

    const [stored] = [...deps.blob.objects.values()];
    const reparsed = parseSchematic(stored.body);
    expect(reparsed.ok && reparsed.schematic.inputFormat).toBe("Litematic");
    expect(
      reparsed.ok && reparsed.schematic.minecraftVersion.versionNumber,
    ).toEqual([1, 21, 4]);

    // The returned URL is a valid input for the next tool call.
    const inspected = await runTool(
      inspectSchematicTool,
      { url: data.url },
      deps,
    );
    expect(inspected.isError).toBeFalsy();
    expect((inspected.structuredContent as { format: string }).format).toBe(
      "Litematic",
    );
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("reports translation warnings", async () => {
    const stone = parseFixture("one_stone_block_v2.schem");
    const cherry: ParsedSchematicProjection = {
      ...stone,
      minecraftVersion: KNOWN_VERSIONS["1.21.4"],
      palette: [
        {
          ...stone.palette[0],
          blockState: "minecraft:cherry_planks",
          blockId: "minecraft:cherry_planks",
          properties: {},
        },
      ],
    };
    const source = serializeSchematic({
      schematic: cherry,
      inputFilename: "cherry.schem",
      outputFormat: "Sponge[v2]",
    });
    if (!source.ok) throw new Error(source.error);

    const result = await runTool(
      convertSchematicTool,
      {
        base64: base64Of(source.bytes),
        filename: "cherry.schem",
        output_format: "Sponge[v2]",
        target_version: "1.16.5",
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    const { warnings } = result.structuredContent as { warnings: string[] };
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^minecraft:cherry_planks: .*cherry_planks didn't exist/,
    );
  });

  it("reports the version a Building Gadgets format moved the build to", async () => {
    const result = await runTool(
      convertSchematicTool,
      {
        ...fixtureArgs("one_stone_block.nbt"),
        output_format: "BuildingGadgets[1.12]",
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as {
      minecraft_version: string;
      filename: string;
    };
    expect(data.minecraft_version).toBe("1.12.2");
    expect(data.filename).toBe("one_stone_block.txt");
  });

  it("rejects an unknown version, the JSON format and conversion failures", async () => {
    const deps = makeDeps();
    const unknown = await runTool(
      convertSchematicTool,
      {
        ...fixtureArgs("one_stone_block.nbt"),
        output_format: "Litematic",
        target_version: "1.99",
      },
      deps,
    );
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/Unknown Minecraft version '1.99'/);

    expect(
      convertSchematicTool.inputSchema.safeParse({
        base64: "AAAA",
        filename: "a",
        output_format: "JSON",
      }).success,
    ).toBe(false);

    const outOfRange = await runTool(
      convertSchematicTool,
      {
        ...fixtureArgs("one_stone_block.nbt"),
        output_format: "BuildingGadgets[1.12]",
        target_version: "1.20.1",
      },
      deps,
    );
    expect(outOfRange.isError).toBe(true);
    expect(text(outOfRange)).toMatch(/templates are for Minecraft/);
    expect(deps.blob.objects.size).toBe(0);
  });

  it("returns the ParseResult error text for an unreadable file", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const parsed = parseSchematic(bytes);
    const result = await runTool(
      convertSchematicTool,
      {
        base64: base64Of(bytes),
        filename: "x.nbt",
        output_format: "Litematic",
      },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(parsed.ok ? "" : parsed.error);
  });

  it("is a tool error when no Blob store is configured", async () => {
    const result = await runTool(
      convertSchematicTool,
      { ...fixtureArgs("one_stone_block.nbt"), output_format: "Litematic" },
      makeDeps({ blob: null }),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(BLOB_NOT_CONFIGURED_MESSAGE);
  });
});

describe("translationWarnings", () => {
  it("is empty when the version does not change", () => {
    const projection = parseFixture("example_bg0_schematic.txt");
    expect(
      translationWarnings(projection, projection.minecraftVersion),
    ).toEqual([]);
  });
});

describe("render_schematic", () => {
  it("returns a PNG image and a one-line summary", async () => {
    const result = await runTool(
      renderSchematicTool,
      fixtureArgs("example_bg0_schematic.txt"),
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(2);
    const [image, summary] = result.content;
    if (image.type !== "image" || summary.type !== "text") {
      throw new Error("expected image then text content");
    }
    expect(image.mimeType).toBe("image/png");
    const png = decodePng(new Uint8Array(Buffer.from(image.data, "base64")));
    expect(png).not.toBeNull();
    expect(summary.text).not.toContain("\n");
    expect(summary.text).toMatch(
      /^Contact sheet of .+: BuildingGadgets\[1\.12\], Minecraft 1\.12\.2, 39×27×36, 7889 blocks in \d+ block states \(\d+×\d+ PNG\)\.$/,
    );
    expect(summary.text).toContain(`${png?.width}×${png?.height} PNG`);
  });

  it("returns the ParseResult error text for an unreadable file", async () => {
    const bytes = new TextEncoder().encode("{}");
    const parsed = parseSchematic(bytes);
    const result = await runTool(
      renderSchematicTool,
      { base64: base64Of(bytes), filename: "x.json" },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(parsed.ok ? "" : parsed.error);
  });
});

describe("over MCP", () => {
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  it("serves inspect and render results that pass the SDK's validation", async () => {
    const handler = createMcpRequestHandler(makeDeps());
    const client = new Client({ name: "test", version: "0.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
        fetch: (input, init) => handler(new Request(input, init)),
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "inspect_schematic",
        "convert_schematic",
        "render_schematic",
      ]),
    );

    const inspected = await client.callTool({
      name: "inspect_schematic",
      arguments: fixtureArgs("one_stone_block.litematic"),
    });
    expect(inspected.isError).toBeFalsy();
    expect(inspected.structuredContent).toMatchObject({
      format: "Litematic",
      total_blocks: 1,
    });

    const rendered = await client.callTool({
      name: "render_schematic",
      arguments: fixtureArgs("one_stone_block_v3.schem"),
    });
    expect(rendered.isError).toBeFalsy();
    const content = rendered.content as { type: string }[];
    expect(content.map((c) => c.type)).toEqual(["image", "text"]);
  });
});
