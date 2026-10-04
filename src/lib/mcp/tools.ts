// The one list of MCP tools the server registers.

import type { McpServer } from "@modelcontextprotocol/server";
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
      async (args: Record<string, unknown>) => {
        try {
          return await tool.handler(args, deps);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      },
    );
  }
}
