// The one list of MCP tools the server registers.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { listVersionsTool } from "./list-versions";
import { type McpDeps, type McpTool, toolError } from "./types";

export const TOOLS: readonly McpTool[] = [listVersionsTool];

export function registerTools(server: McpServer, deps: McpDeps): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      (args: Record<string, unknown>) => runTool(tool, args, deps),
    );
  }
}

// Runs a tool's handler, turning a thrown error into a tool error.
export async function runTool(
  tool: McpTool,
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<CallToolResult> {
  try {
    return await tool.handler(args, deps);
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}
