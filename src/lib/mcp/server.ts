// Stateless streamable-HTTP MCP handler. Every request gets a fresh server
// built from `TOOLS`; nothing is kept between requests.

import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { registerTools } from "./tools";
import type { McpDeps } from "./types";

// Request bodies over this are answered 413 with a JSON-RPC error before the
// body is parsed. It leaves room for a 5 MB schematic sent as base64.
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export const SERVER_INFO = { name: "schematiclab", version: "0.1.0" };

export function createMcpRequestHandler(
  deps: McpDeps,
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(SERVER_INFO, {
        capabilities: { tools: {} },
      });
      registerTools(server, deps);
      return server;
    },
    {
      legacy: "stateless",
      maxRequestBodySize: MAX_REQUEST_BYTES,
      maxSubscriptions: 0,
    },
  );
  return (request) => handler.fetch(request);
}
