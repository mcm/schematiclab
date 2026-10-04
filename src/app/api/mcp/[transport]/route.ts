// Hosted MCP endpoint (streamable HTTP, stateless). `/api/mcp` is rewritten
// here as `/api/mcp/mcp` (next.config.ts); tool logic is in `src/lib/mcp/`.

import { blobClientFromEnv } from "@/lib/mcp/blob";
import { createMcpRequestHandler } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handleMcp = createMcpRequestHandler({
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  blob: blobClientFromEnv(),
});

async function handler(
  request: Request,
  { params }: { params: Promise<{ transport: string }> },
): Promise<Response> {
  const { transport } = await params;
  if (transport !== "mcp") return new Response("Not found", { status: 404 });
  return handleMcp(request);
}

export { handler as DELETE, handler as GET, handler as POST };
