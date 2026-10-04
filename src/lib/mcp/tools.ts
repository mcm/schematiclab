// The one list of MCP tools the server registers.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { searchBlocksTool, suggestPaletteTool } from "./block-tools";
import { generateShapeTool } from "./generate-shape";
import { listVersionsTool } from "./list-versions";
import {
  convertSchematicTool,
  inspectSchematicTool,
  renderSchematicTool,
} from "./schematic-tools";
import { type McpDeps, type McpTool, toolError } from "./types";

export const TOOLS: readonly McpTool[] = [
  listVersionsTool,
  inspectSchematicTool,
  convertSchematicTool,
  renderSchematicTool,
  generateShapeTool,
  searchBlocksTool,
  suggestPaletteTool,
];

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
