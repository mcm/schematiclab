// Vercel cron (vercel.json): deletes MCP output files under `mcp/` once their
// signed URLs have expired. Logic is in `src/lib/mcp/cleanup.ts`.

import { blobClientFromEnv } from "@/lib/mcp/blob";
import { createCleanupHandler } from "@/lib/mcp/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(request: Request): Promise<Response> {
  return createCleanupHandler({
    blob: blobClientFromEnv(),
    now: () => new Date(),
    cronSecret: process.env.CRON_SECRET,
  })(request);
}
