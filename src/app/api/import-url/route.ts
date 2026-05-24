// Server-side fetcher for "import from URL".
//
// Only URLs hosted on pastebin.com or gist.github.com are accepted. The
// allowlist is enforced via URL parsing (hostname equality), not a raw
// `startsWith` — `https://pastebin.com.evil.com/...` would otherwise pass a
// naive prefix check.

import { NextResponse } from "next/server";

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

type Source = "pastebin" | "gist";

interface Normalized {
  fetchUrl: string;
  source: Source;
  id: string;
}

interface Fetched {
  bytes: Uint8Array;
  filename: string;
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function upstreamFailed(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 502 });
}

function normalize(input: string): Normalized {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("URL must use https.");
  }

  if (parsed.hostname === "pastebin.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id =
      parts.length === 1
        ? parts[0]
        : parts.length === 2 && parts[0] === "raw"
          ? parts[1]
          : undefined;
    if (!id || !/^[A-Za-z0-9]+$/.test(id)) {
      throw new Error("Couldn't find a paste id in that pastebin URL.");
    }
    return {
      fetchUrl: `https://pastebin.com/raw/${id}`,
      source: "pastebin",
      id,
    };
  }

  if (parsed.hostname === "gist.github.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    // Anonymous gists: /<id>. Named gists: /<user>/<id> (optionally /<sha>).
    const id =
      parts.length === 1 ? parts[0] : parts.length >= 2 ? parts[1] : undefined;
    if (!id || !/^[a-fA-F0-9]+$/.test(id)) {
      throw new Error("Couldn't find a gist id in that URL.");
    }
    return {
      fetchUrl: `https://api.github.com/gists/${id}`,
      source: "gist",
      id,
    };
  }

  throw new Error("Only pastebin.com and gist.github.com URLs are allowed.");
}

async function fetchPastebin(fetchUrl: string, id: string): Promise<Fetched> {
  const res = await fetch(fetchUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`Pastebin returned HTTP ${res.status}.`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(
      `Paste is larger than the ${MAX_BYTES / (1024 * 1024)} MB limit.`,
    );
  }
  return { bytes: new Uint8Array(buf), filename: `pastebin-${id}.txt` };
}

interface GistFile {
  filename: string;
  content: string;
  truncated: boolean;
  raw_url: string;
}

async function fetchGist(fetchUrl: string): Promise<Fetched> {
  const res = await fetch(fetchUrl, {
    headers: {
      "User-Agent": "schematiclab",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`Gist API returned HTTP ${res.status}.`);
  }
  const json = (await res.json()) as { files?: Record<string, GistFile> };
  const files = json.files ? Object.values(json.files) : [];
  if (files.length === 0) {
    throw new Error("Gist has no files.");
  }
  const file = files[0];

  if (file.truncated) {
    // `content` is omitted for files > ~1 MB. Fall back to the raw URL on
    // gist.githubusercontent.com — same trust domain as the API.
    const rawHost = new URL(file.raw_url).hostname;
    if (rawHost !== "gist.githubusercontent.com") {
      throw new Error("Unexpected gist raw host.");
    }
    const rawRes = await fetch(file.raw_url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!rawRes.ok) {
      throw new Error(`Gist raw fetch returned HTTP ${rawRes.status}.`);
    }
    const buf = await rawRes.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(
        `File is larger than the ${MAX_BYTES / (1024 * 1024)} MB limit.`,
      );
    }
    return { bytes: new Uint8Array(buf), filename: file.filename };
  }

  const bytes = new TextEncoder().encode(file.content);
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(
      `File is larger than the ${MAX_BYTES / (1024 * 1024)} MB limit.`,
    );
  }
  return { bytes, filename: file.filename };
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

  let normalized: Normalized;
  try {
    normalized = normalize(url);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Invalid URL.");
  }

  try {
    const { bytes, filename } =
      normalized.source === "pastebin"
        ? await fetchPastebin(normalized.fetchUrl, normalized.id)
        : await fetchGist(normalized.fetchUrl);
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
