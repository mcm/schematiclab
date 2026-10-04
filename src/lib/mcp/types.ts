// Shared shapes for the MCP tools. Tool logic lives in plain functions that
// take their dependencies (fetch, clock, ...) injected, so tests drive them
// without Next or the network.

import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";

export interface McpDeps {
  fetch: typeof fetch;
  now: () => Date;
}

export interface McpTool<I extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema?: z.ZodObject;
  annotations?: ToolAnnotations;
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
