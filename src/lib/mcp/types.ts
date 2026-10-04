// Shared shapes for the MCP tools. Tool logic lives in plain functions that
// take their dependencies (fetch, clock, ...) injected, so tests drive them
// without Next or the network.

import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { BlobClient } from "./blob";
import type { McpLimits } from "./limits";

export interface McpDeps {
  fetch: typeof fetch;
  now: () => Date;
  // Null when no Blob store is configured; `publishFile` then throws a clear
  // error, which the tool returns as a tool error.
  blob: BlobClient | null;
  // `BLOB_STORE_ID`: signed URLs on this store's host are accepted as tool
  // inputs and read back through `blob.get`.
  blobStoreId?: string | null;
  // Overrides of `DEFAULT_LIMITS` (`limits.ts`), for tests.
  limits?: Partial<McpLimits>;
  // Set by `runTool`, aborted when the call times out, so a handler still
  // running doesn't leave an output file nobody will get a URL for.
  signal?: AbortSignal;
}

export interface McpTool<I extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema?: z.ZodObject;
  annotations?: ToolAnnotations;
  /** What to try when the tool times out; "Try again." when unset. */
  timeoutHint?: string;
  handler: (
    args: z.infer<I>,
    deps: McpDeps,
  ) => CallToolResult | Promise<CallToolResult>;
}

// Erases a tool's input type so tools with different schemas share one list.
export function defineTool<I extends z.ZodObject>(tool: McpTool<I>): McpTool {
  return tool as unknown as McpTool;
}

// A successful result carrying `value` as both structured content and JSON
// text, for clients that only read text content.
export function jsonResult(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
