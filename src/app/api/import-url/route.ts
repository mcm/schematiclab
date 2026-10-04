// Server-side fetcher for "import from URL". The pastebin/gist allowlist and
// the fetching live in `src/lib/import-url.ts`, shared with the MCP tools.

import { NextResponse } from "next/server";
import { fetchImportUrl, normalizeImportUrl } from "@/lib/import-url";
import type { NormalizedImportUrl } from "@/lib/import-url";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function upstreamFailed(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 502 });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { url?: unknown }).url !== "string"
  ) {
    return badRequest("Missing 'url' field.");
  }
  const url = (body as { url: string }).url;

  let normalized: NormalizedImportUrl;
  try {
    normalized = normalizeImportUrl(url);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Invalid URL.");
  }

  try {
    const { bytes, filename } = await fetchImportUrl(
      normalized,
      (input, init) => fetch(input, init),
    );
    return new NextResponse(bytes as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Source-Filename": encodeURIComponent(filename),
      },
    });
  } catch (err) {
    return upstreamFailed(err instanceof Error ? err.message : "Fetch failed.");
  }
}
