import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import * as route from "@/app/api/mcp/[transport]/route";
import { SUPPORTED_FORMATS } from "@/lib/convert";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/known-versions";
import { MAX_REQUEST_BYTES, createMcpRequestHandler } from "../server";
import { TOOLS } from "../tools";

const URL_BASE = "http://localhost/api/mcp/mcp";

// Routes the client's requests straight into the Next route handler.
function routeFetch(transport = "mcp"): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const params = Promise.resolve({ transport });
    if (request.method === "POST") return route.POST(request, { params });
    if (request.method === "DELETE") return route.DELETE(request, { params });
    return route.GET(request, { params });
  };
}

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connect(
  mode?: "auto",
  fetchImpl: typeof fetch = routeFetch(),
): Promise<Client> {
  const client = new Client(
    { name: "test", version: "0.0.0" },
    mode ? { versionNegotiation: { mode } } : undefined,
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(URL_BASE), { fetch: fetchImpl }),
  );
  return client;
}

describe("MCP endpoint", () => {
  for (const mode of [undefined, "auto"] as const) {
    describe(mode ? "2026-07-28 client" : "2025-era client", () => {
      it("lists every registered tool", async () => {
        const client = await connect(mode);
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
        expect(tools.map((t) => t.name)).toContain("list_versions");
      });

      it("returns every known version and the writable formats", async () => {
        const client = await connect(mode);
        const result = await client.callTool({
          name: "list_versions",
          arguments: {},
        });
        expect(result.isError).toBeFalsy();
        const data = result.structuredContent as {
          versions: string[];
          formats: { id: string; extension: string }[];
        };
        expect(data.versions).toEqual(Object.keys(KNOWN_VERSIONS));
        expect(data.formats.map((f) => f.id)).toEqual(
          SUPPORTED_FORMATS.filter((id) => id !== "JSON"),
        );
        expect(data.formats.map((f) => f.id)).not.toContain("JSON");
        expect(data.formats).toContainEqual({
          id: "Litematic",
          extension: "litematic",
        });
        expect(data.formats).toContainEqual({
          id: "Sponge[v3]",
          extension: "schem",
        });
        expect(data.formats).toContainEqual({
          id: "Structure",
          extension: "nbt",
        });
        expect(data.formats).toContainEqual({
          id: "BuildingGadgets2[1.20+]",
          extension: "txt",
        });
        expect(data.formats).toContainEqual({
          id: "StructurizeBlueprint",
          extension: "blueprint",
        });
        const text = result.content as { type: string; text: string }[];
        expect(JSON.parse(text[0].text)).toEqual(data);
      });
    });
  }

  it("keeps no session state between requests", async () => {
    let sessionHeader: string | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await routeFetch()(input, init);
      sessionHeader ??= response.headers.get("mcp-session-id");
      return response;
    };
    const client = await connect(undefined, fetchImpl);
    await client.listTools();
    expect(sessionHeader).toBeNull();
  });

  it("rejects a request over 8 MB before parsing it", async () => {
    const handler = createMcpRequestHandler({
      fetch: () => Promise.reject(new Error("no network")),
      now: () => new Date(0),
    });
    // Not valid JSON: a parse attempt would answer -32700 instead.
    const body = "{" + "x".repeat(MAX_REQUEST_BYTES);
    const response = await handler(
      new Request(URL_BASE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body,
      }),
    );
    expect(response.status).toBe(413);
    const json = (await response.json()) as {
      jsonrpc: string;
      error: { code: number; message: string };
    };
    expect(json.jsonrpc).toBe("2.0");
    expect(json.error.message).toMatch(/Payload Too Large/);
  });

  it("accepts a request just under 8 MB", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "list_versions",
      arguments: { padding: "x".repeat(MAX_REQUEST_BYTES - 1024) },
    });
    expect(result.isError).toBeFalsy();
  });

  it("answers 404 for another transport segment", async () => {
    const response = await routeFetch("sse")(URL_BASE, { method: "POST" });
    expect(response.status).toBe(404);
  });
});
