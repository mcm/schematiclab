// Deletes MCP output files older than their 24-hour signed URLs, run by the
// Vercel cron at `/api/cron/mcp-blob-cleanup`.

import { timingSafeEqual } from "node:crypto";
import type { BlobClient } from "./blob";
import { OUTPUT_PREFIX, OUTPUT_TTL_MS } from "./output";

// The SDK's `del` accepts many pathnames per call; keep batches modest.
const DELETE_BATCH = 100;

export interface CleanupResult {
  deleted: number;
  kept: number;
}

export async function cleanupExpiredOutputs(deps: {
  blob: BlobClient;
  now: () => Date;
}): Promise<CleanupResult> {
  const cutoff = deps.now().getTime() - OUTPUT_TTL_MS;
  const expired: string[] = [];
  let kept = 0;
  let cursor: string | undefined;
  do {
    const page = await deps.blob.list({ prefix: OUTPUT_PREFIX, cursor });
    for (const entry of page.blobs) {
      if (!entry.pathname.startsWith(OUTPUT_PREFIX)) continue;
      if (entry.uploadedAt.getTime() < cutoff) expired.push(entry.pathname);
      else kept++;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < expired.length; i += DELETE_BATCH) {
    await deps.blob.del(expired.slice(i, i + DELETE_BATCH));
  }
  return { deleted: expired.length, kept };
}

// Vercel sends `Authorization: Bearer <CRON_SECRET>` with cron requests.
export function isAuthorizedCron(
  request: Request,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createCleanupHandler(deps: {
  blob: BlobClient | null;
  now: () => Date;
  cronSecret: string | undefined;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!isAuthorizedCron(request, deps.cronSecret)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!deps.blob) {
      return Response.json(
        { error: "Blob store not configured" },
        { status: 503 },
      );
    }
    const result = await cleanupExpiredOutputs({
      blob: deps.blob,
      now: deps.now,
    });
    return Response.json(result);
  };
}
