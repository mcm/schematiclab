// Streams a mod file's jar from the CurseForge CDN so the browser can fetch
// it without CORS and without seeing the API key.
//
//   GET /api/curseforge/mods/{modId}/files/{fileId}/download
//
// The client supplies only ids — never a URL. The CDN URL is resolved
// server-side via CurseForge's download-url endpoint, and it (plus every
// redirect hop, followed manually) must be https on an allowlisted host so
// this route can't be turned into an open proxy. The body is streamed, never
// buffered: Vercel caps buffered responses at 4.5 MB.

import {
  CURSEFORGE_API_BASE,
  jsonError,
  notConfigured,
  parseNonNegativeInt,
  parsePositiveInt,
} from "@/lib/curseforge/server";

export const maxDuration = 60;

const TIMEOUT_MS = 60_000;
const DEFAULT_MAX_JAR_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_HOSTS = new Set(["edge.forgecdn.net", "mediafilez.forgecdn.net"]);

class DownloadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isAllowedUrl(url: URL): boolean {
  return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
}

function maxJarBytes(): number {
  return (
    parsePositiveInt(process.env.CURSEFORGE_MAX_JAR_BYTES ?? null) ??
    DEFAULT_MAX_JAR_BYTES
  );
}

async function resolveDownloadUrl(
  apiKey: string,
  modId: number,
  fileId: number,
  signal: AbortSignal,
): Promise<URL> {
  let res: Response;
  try {
    res = await fetch(
      `${CURSEFORGE_API_BASE}/v1/mods/${modId}/files/${fileId}/download-url`,
      {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        signal,
        redirect: "error",
      },
    );
  } catch {
    throw new DownloadError(502, "CurseForge request failed.");
  }
  if (res.status === 404) {
    throw new DownloadError(403, "distribution_disallowed");
  }
  if (!res.ok) {
    throw new DownloadError(502, `CurseForge returned HTTP ${res.status}.`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new DownloadError(502, "CurseForge returned an invalid response.");
  }
  const data = (payload as { data?: unknown } | null)?.data;
  if (typeof data !== "string" || data === "") {
    throw new DownloadError(403, "distribution_disallowed");
  }
  let url: URL;
  try {
    url = new URL(data);
  } catch {
    throw new DownloadError(502, "disallowed_host");
  }
  return url;
}

/** Fetch `start`, following redirects by hand so each hop is re-checked. */
async function fetchAllowlisted(
  start: URL,
  signal: AbortSignal,
): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUrl(url)) throw new DownloadError(502, "disallowed_host");
    let res: Response;
    try {
      res = await fetch(url, { signal, redirect: "manual" });
    } catch {
      throw new DownloadError(502, "CDN request failed.");
    }
    if (res.status < 300 || res.status >= 400) return res;
    await res.body?.cancel();
    const location = res.headers.get("Location");
    if (!location) {
      throw new DownloadError(502, "CDN redirect without a location.");
    }
    try {
      url = new URL(location, url);
    } catch {
      throw new DownloadError(502, "disallowed_host");
    }
  }
  throw new DownloadError(502, "Too many redirects from the CDN.");
}

/** Pass bytes through unchanged, erroring once more than `limit` have flowed. */
function byteLimit(
  limit: number,
  onExceeded: () => void,
): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) {
        onExceeded();
        controller.error(new Error("jar_too_large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ modId: string; fileId: string }> },
): Promise<Response> {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey) return notConfigured();

  const raw = await params;
  const modId = parsePositiveInt(raw.modId);
  if (modId === null) {
    return jsonError(400, "'modId' must be a positive integer.");
  }
  const fileId = parsePositiveInt(raw.fileId);
  if (fileId === null) {
    return jsonError(400, "'fileId' must be a positive integer.");
  }

  // One controller for the whole request — resolve, redirects and body — so
  // the 60 s budget covers streaming too, and an over-cap stream can abort
  // the upstream connection.
  const upstream = new AbortController();
  const signal = AbortSignal.any([
    upstream.signal,
    AbortSignal.timeout(TIMEOUT_MS),
  ]);

  let res: Response;
  try {
    const url = await resolveDownloadUrl(apiKey, modId, fileId, signal);
    res = await fetchAllowlisted(url, signal);
  } catch (err) {
    if (err instanceof DownloadError) return jsonError(err.status, err.code);
    return jsonError(502, "CDN request failed.");
  }

  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return jsonError(502, `CDN returned HTTP ${res.status}.`);
  }

  const limit = maxJarBytes();
  const length = parseNonNegativeInt(res.headers.get("Content-Length"));
  if (length !== null && length > limit) {
    await res.body.cancel().catch(() => {});
    upstream.abort();
    return jsonError(413, "jar_too_large");
  }

  const body = res.body.pipeThrough(byteLimit(limit, () => upstream.abort()));

  const headers = new Headers({
    "Content-Type": "application/java-archive",
    "Cache-Control": "private, no-store",
  });
  if (length !== null) headers.set("Content-Length", String(length));
  return new Response(body, { status: 200, headers });
}
