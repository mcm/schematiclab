// End-to-end checks of the MCP epic's functional requirements (SCHEM-88)
// that the per-tool tests don't already cover: the public `/api/mcp` path,
// the cleanup cron's wiring, input allowlisting on every schematic tool and
// the render size of a large generated shape. Everything else is covered next
// to its code (server, load, registry, output, cleanup, render, limits, …).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as cronRoute from "@/app/api/cron/mcp-blob-cleanup/route";
import nextConfig from "../../../../next.config";
import { decodePng } from "../../render/block-appearance";
import { MAX_INPUT_BYTES } from "../limits";
import { MAX_RENDER_EDGE } from "../render";
import { createMcpRequestHandler } from "../server";
import type { McpDeps } from "../types";
import { createFakeBlob } from "./fake-blob";

const ROOT = path.join(__dirname, "../../../..");
const NOW = new Date("2026-10-04T12:00:00Z");

const clients: Client[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

function makeDeps(): McpDeps & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(() => Promise.reject(new Error("no network"))),
    now: () => NOW,
    blob: createFakeBlob(() => NOW),
    blobStoreId: "store_store",
  } as unknown as McpDeps & { fetch: ReturnType<typeof vi.fn> };
}

// An anonymous client (no auth headers) talking to a handler built on `deps`.
async function connect(deps: McpDeps): Promise<Client> {
  const handler = createMcpRequestHandler(deps);
  const client = new Client({ name: "fr-test", version: "0.0.0" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      fetch: async (input, init) => handler(new Request(input, init)),
    }),
  );
  return client;
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

describe("FR-1: public endpoint at /api/mcp", () => {
  it("rewrites /api/mcp to the MCP route", async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toContainEqual({
      source: "/api/mcp",
      destination: "/api/mcp/mcp",
    });
    expect(
      existsSync(path.join(ROOT, "src/app/api/mcp/[transport]/route.ts")),
    ).toBe(true);
  });
});

describe("FR-7: cleanup cron", () => {
  it("is scheduled in vercel.json at the cleanup route", () => {
    const vercel = JSON.parse(
      readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
    ) as { crons: { path: string; schedule: string }[] };
    const cron = vercel.crons.find(
      (c) => c.path === "/api/cron/mcp-blob-cleanup",
    );
    expect(cron?.schedule).toBeTruthy();
    expect(
      existsSync(path.join(ROOT, "src/app/api/cron/mcp-blob-cleanup/route.ts")),
    ).toBe(true);
  });

  it("answers 401 through the route without the bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const response = await cronRoute.GET(
      new Request("http://localhost/api/cron/mcp-blob-cleanup"),
    );
    expect(response.status).toBe(401);
    const wrong = await cronRoute.GET(
      new Request("http://localhost/api/cron/mcp-blob-cleanup", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(wrong.status).toBe(401);
  });
});

describe("FR-9: schematic inputs over MCP", () => {
  const extraArgs: Record<string, Record<string, unknown>> = {
    inspect_schematic: {},
    convert_schematic: { output_format: "Sponge[v2]" },
    render_schematic: {},
  };

  for (const [tool, extra] of Object.entries(extraArgs)) {
    it(`${tool} rejects URLs off the allowlist without a request`, async () => {
      const deps = makeDeps();
      const client = await connect(deps);
      for (const url of [
        "https://example.com/house.nbt",
        "https://pastebin.com.evil.example/raw/abc",
        "https://other.private.blob.vercel-storage.com/mcp/a.nbt",
        "https://store.private.blob.vercel-storage.com/secret/a.nbt",
      ]) {
        const result = (await client.callTool({
          name: tool,
          arguments: { url, ...extra },
        })) as CallToolResult;
        expect(result.isError).toBe(true);
        expect(text(result)).not.toBe("");
      }
      expect(deps.fetch).not.toHaveBeenCalled();
    });

    it(`${tool} rejects base64 over 5 MB`, async () => {
      const client = await connect(makeDeps());
      const base64 = Buffer.alloc(MAX_INPUT_BYTES + 3).toString("base64");
      const result = (await client.callTool({
        name: tool,
        arguments: { base64, filename: "big.nbt", ...extra },
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("larger than the 5 MB limit");
    });
  }
});

describe("FR-8: generate_shape render size", () => {
  it("scales a large shape's contact sheet down to the edge limit", async () => {
    const client = await connect(makeDeps());
    const result = (await client.callTool({
      name: "generate_shape",
      arguments: {
        shape: "cuboid",
        width: 64,
        height: 24,
        depth: 64,
        hollow: true,
        material: "stone",
        version: "1.21.4",
        output_format: "Litematic",
        render: true,
      },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const image = result.content.find((c) => c.type === "image");
    if (image?.type !== "image") throw new Error("expected image content");
    const png = decodePng(new Uint8Array(Buffer.from(image.data, "base64")));
    if (!png) throw new Error("expected a PNG");
    expect(Math.max(png.width, png.height)).toBe(MAX_RENDER_EDGE);
  }, 30_000);
});
