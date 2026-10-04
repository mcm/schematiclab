import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as route from "@/app/api/mcp/[transport]/route";
import { MAX_IMPORT_BYTES } from "../../import-url";
import { MAX_SHAPE_BLOCKS } from "../../shapes/generate";
import { generateShapeTool } from "../generate-shape";
import { resolveSchematicInput } from "../input";
import {
  MAX_DECOMPRESSED_BYTES,
  MAX_INPUT_BYTES,
  MAX_PROJECTION_BLOCKS,
  MAX_REQUEST_BYTES,
  TOOL_TIMEOUT_MS,
  assertProjectionBlocks,
} from "../limits";
import {
  convertSchematicTool,
  inspectSchematicTool,
  renderSchematicTool,
} from "../schematic-tools";
import { LitematicRegion } from "../../schemlib/schematic-formats/litematic";
import {
  gzipBomb,
  oversizedSchematics,
} from "../../__tests__/oversized-schematics";
import { publishFile } from "../output";
import { createMcpRequestHandler } from "../server";
import { runTool } from "../tools";
import { type McpDeps, defineTool, jsonResult } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const FIXTURES = path.join(__dirname, "../../__tests__/fixtures");
const NOW = new Date("2026-10-04T12:00:00Z");
const STORE_ID = "store_store";

function makeDeps(
  overrides: Partial<McpDeps> = {},
): McpDeps & { blob: FakeBlob } {
  return {
    fetch: vi.fn(() => Promise.reject(new Error("no network"))) as never,
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

function stoneBlockArgs(): { base64: string; filename: string } {
  const bytes = readFileSync(path.join(FIXTURES, "one_stone_block.nbt"));
  return { base64: bytes.toString("base64"), filename: "stone.nbt" };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("request size", () => {
  it("answers 413 for a body one byte over MAX_REQUEST_BYTES", async () => {
    const handler = createMcpRequestHandler(makeDeps());
    const response = await handler(
      new Request("http://localhost/api/mcp/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: "x".repeat(MAX_REQUEST_BYTES + 1),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("leaves room for a tools/call carrying a 5 MB schematic as base64", () => {
    const call = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "convert_schematic",
        arguments: {
          base64: Buffer.alloc(MAX_INPUT_BYTES).toString("base64"),
          filename: "x".repeat(255),
          output_format: "Sponge[v3]",
          target_version: "1.21.4",
        },
      },
    });
    expect(Buffer.byteLength(call)).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
  });
});

describe("decoded schematic size", () => {
  it("is 5 MB, the same as pastebin and gist downloads", () => {
    expect(MAX_INPUT_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_IMPORT_BYTES).toBe(MAX_INPUT_BYTES);
  });

  it("rejects base64 that decodes to one byte over 5 MB", async () => {
    const base64 = Buffer.alloc(MAX_INPUT_BYTES + 1).toString("base64");
    await expect(
      resolveSchematicInput({ base64, filename: "big.nbt" }, makeDeps()),
    ).rejects.toThrow("The file is larger than the 5 MB limit.");
  });

  it("accepts base64 that decodes to exactly 5 MB", async () => {
    const base64 = Buffer.alloc(MAX_INPUT_BYTES, 1).toString("base64");
    const input = await resolveSchematicInput(
      { base64, filename: "big.nbt" },
      makeDeps(),
    );
    expect(input.bytes.byteLength).toBe(MAX_INPUT_BYTES);
  });

  it("rejects a pastebin download over 5 MB", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array(MAX_INPUT_BYTES + 1)),
    );
    await expect(
      resolveSchematicInput(
        { url: "https://pastebin.com/AbC123" },
        makeDeps({ fetch: fetchImpl as never }),
      ),
    ).rejects.toThrow("larger than the 5 MB limit");
  });
});

describe("blocks per projection", () => {
  it("allows MAX_PROJECTION_BLOCKS and rejects one more", () => {
    expect(() =>
      assertProjectionBlocks({ totalBlocks: MAX_PROJECTION_BLOCKS }),
    ).not.toThrow();
    expect(() =>
      assertProjectionBlocks({ totalBlocks: MAX_PROJECTION_BLOCKS + 1 }),
    ).toThrow(
      "This schematic has 2,000,001 blocks, more than the 2,000,000 this server handles.",
    );
  });

  it("covers every shape the Shape Generator allows", () => {
    expect(MAX_PROJECTION_BLOCKS).toBeGreaterThanOrEqual(MAX_SHAPE_BLOCKS);
  });

  it("stops a schematic tool when the parsed schematic is over the limit", async () => {
    const deps = makeDeps({ limits: { maxProjectionBlocks: 0 } });
    const result = await runTool(inspectSchematicTool, stoneBlockArgs(), deps);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "This schematic has 1 blocks, more than the 0 this server handles.",
    );
  });

  it("stops generate_shape before writing a shape over the limit", async () => {
    const deps = makeDeps({ limits: { maxProjectionBlocks: 26 } });
    const result = await runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 3,
        height: 3,
        depth: 3,
        material: "stone",
        version: "1.20.1",
        output_format: "Sponge[v2]",
      },
      deps,
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("27 blocks, more than the 26");
    expect(deps.blob.objects.size).toBe(0);
  });
});

describe("declared schematic size", () => {
  const tools = [
    { tool: inspectSchematicTool, extra: {} },
    { tool: convertSchematicTool, extra: { output_format: "Litematic" } },
    { tool: renderSchematicTool, extra: {} },
  ];

  for (const { tool, extra } of tools) {
    it(`stops ${tool.name} on a header declaring more than the limit`, async () => {
      // Two Litematic regions that only add up to more than 2,000,000, and no
      // block data to back them.
      const file = oversizedSchematics().find((f) => f.format === "Litematic")!;
      const decode = vi.spyOn(LitematicRegion.prototype, "getBlockMatrix");
      const deps = makeDeps();
      const result = await runTool(
        tool,
        {
          base64: Buffer.from(file.bytes).toString("base64"),
          filename: "bomb.litematic",
          ...extra,
        },
        deps,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        "This schematic has 3,000,000 blocks, more than the 2,000,000 this server handles.",
      );
      expect(decode).not.toHaveBeenCalled();
      expect(deps.blob.objects.size).toBe(0);
    });
  }

  it("uses a lowered limit from McpDeps.limits", async () => {
    const file = oversizedSchematics().find((f) => f.format === "Sponge[v2]")!;
    const result = await runTool(
      inspectSchematicTool,
      {
        base64: Buffer.from(file.bytes).toString("base64"),
        filename: "a.schem",
      },
      makeDeps({ limits: { maxProjectionBlocks: 10 } }),
    );
    expect(text(result)).toBe(
      "This schematic has 1,000,000,000 blocks, more than the 10 this server handles.",
    );
  });
});

describe("decompressed size", () => {
  const tools = [
    { tool: inspectSchematicTool, extra: {} },
    { tool: convertSchematicTool, extra: { output_format: "Litematic" } },
    { tool: renderSchematicTool, extra: {} },
  ];
  let bomb: Uint8Array;

  beforeAll(async () => {
    // Under 1 MB of gzip that would inflate to twice the cap.
    bomb = await gzipBomb(2 * MAX_DECOMPRESSED_BYTES);
  });

  it("is 128 MB", () => {
    expect(MAX_DECOMPRESSED_BYTES).toBe(128 * 1024 * 1024);
  });

  for (const { tool, extra } of tools) {
    it(`stops ${tool.name} on a small gzip that inflates past the limit`, async () => {
      expect(bomb.length).toBeLessThan(1024 * 1024);
      const deps = makeDeps();
      const result = await runTool(
        tool,
        {
          base64: Buffer.from(bomb).toString("base64"),
          filename: "bomb.litematic",
          ...extra,
        },
        deps,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        "This schematic decompresses to more than 128 MB, the most this server handles.",
      );
      expect(deps.blob.objects.size).toBe(0);
    });
  }

  it("uses a lowered limit from McpDeps.limits", async () => {
    const small = await gzipBomb(2 * 1024 * 1024);
    const result = await runTool(
      inspectSchematicTool,
      { base64: Buffer.from(small).toString("base64"), filename: "a.nbt" },
      makeDeps({ limits: { maxDecompressedBytes: 1024 * 1024 } }),
    );
    expect(text(result)).toBe(
      "This schematic decompresses to more than 1 MB, the most this server handles.",
    );
  });
});

describe("per-tool timeout", () => {
  const hangingTool = defineTool({
    name: "hang",
    title: "Hang",
    description: "Never finishes.",
    inputSchema: z.object({}),
    handler: () => new Promise<never>(() => {}),
  });

  it("answers a tool error once TOOL_TIMEOUT_MS has passed", async () => {
    vi.useFakeTimers();
    const pending = runTool(hangingTool, {}, makeDeps());
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "hang took longer than 45 seconds and was stopped. Try again.",
    );
  });

  it("stops a tool waiting on a slow download", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const result = await runTool(
      inspectSchematicTool,
      { url: "https://pastebin.com/AbC123" },
      makeDeps({ fetch: fetchImpl as never, limits: { toolTimeoutMs: 20 } }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^inspect_schematic took longer than .* Try a smaller schematic\.$/,
    );
  });

  it("keeps a handler that finishes late from storing its file", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let late: ReturnType<typeof publishFile> | undefined;
    const slow = defineTool({
      ...hangingTool,
      name: "slow",
      handler: async (_args, deps) => {
        await gate;
        late = publishFile(new Uint8Array([1]), "a.nbt", "x/y", deps);
        return jsonResult({ ...(await late) });
      },
    });
    const deps = makeDeps({ limits: { toolTimeoutMs: 20 } });
    const result = await runTool(slow, {}, deps);
    expect(text(result)).toContain("slow took longer than");
    release();
    await vi.waitFor(() => expect(late).toBeDefined());
    await expect(late).rejects.toThrow("slow took longer than");
    expect(deps.blob.calls.some((c) => c.method === "put")).toBe(false);
    expect(deps.blob.objects.size).toBe(0);
  });

  it("deletes an upload that lands after the timeout", async () => {
    const deps = makeDeps({ limits: { toolTimeoutMs: 20 } });
    const put = deps.blob.put.bind(deps.blob);
    let landed!: () => void;
    const landing = new Promise<void>((resolve) => (landed = resolve));
    deps.blob.put = async (...args) => {
      await landing;
      return put(...args);
    };
    let upload: ReturnType<typeof publishFile> | undefined;
    const uploading = defineTool({
      ...hangingTool,
      name: "upload",
      handler: async (_args, toolDeps) => {
        upload = publishFile(new Uint8Array([1]), "a.nbt", "x/y", toolDeps);
        return jsonResult({ ...(await upload) });
      },
    });
    const result = await runTool(uploading, {}, deps);
    expect(text(result)).toContain("upload took longer than");
    landed();
    await expect(upload).rejects.toThrow("stopped before its file was stored");
    expect(deps.blob.calls.map((c) => c.method)).toEqual(["put", "del"]);
    expect(deps.blob.objects.size).toBe(0);
  });

  it("returns results that finish in time", async () => {
    const quick = defineTool({
      ...hangingTool,
      name: "quick",
      handler: () => jsonResult({ ok: true }),
    });
    const result = await runTool(quick, {}, makeDeps());
    expect(result.structuredContent).toEqual({ ok: true });
  });

  it("ends before the route's maxDuration", () => {
    expect(TOOL_TIMEOUT_MS).toBeLessThan(route.maxDuration * 1000);
  });
});
