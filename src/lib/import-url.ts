// Server-side fetcher for "import from URL", shared by `/api/import-url` and
// the MCP tools.
//
// Only URLs hosted on pastebin.com or gist.github.com are accepted. The
// allowlist is enforced via URL parsing (hostname equality), not a raw
// `startsWith` — `https://pastebin.com.evil.com/...` would otherwise pass a
// naive prefix check. The URL that is fetched is rebuilt from the validated
// id, never taken from the input.

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

export type ImportSource = "pastebin" | "gist";

export interface NormalizedImportUrl {
  fetchUrl: string;
  source: ImportSource;
  id: string;
}

export interface ImportedFile {
  bytes: Uint8Array;
  filename: string;
}

/** The input URL is not an allowed pastebin or gist URL. */
export class ImportUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportUrlError";
  }
}

export function normalizeImportUrl(input: string): NormalizedImportUrl {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ImportUrlError("That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new ImportUrlError("URL must use https.");
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
      throw new ImportUrlError(
        "Couldn't find a paste id in that pastebin URL.",
      );
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
      throw new ImportUrlError("Couldn't find a gist id in that URL.");
    }
    return {
      fetchUrl: `https://api.github.com/gists/${id}`,
      source: "gist",
      id,
    };
  }

  throw new ImportUrlError(
    "Only pastebin.com and gist.github.com URLs are allowed.",
  );
}

function tooLarge(what: string): Error {
  return new Error(
    `${what} is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB limit.`,
  );
}

async function fetchPastebin(
  fetchImpl: typeof fetch,
  fetchUrl: string,
  id: string,
): Promise<ImportedFile> {
  const res = await fetchImpl(fetchUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`Pastebin returned HTTP ${res.status}.`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_IMPORT_BYTES) throw tooLarge("Paste");
  return { bytes: new Uint8Array(buf), filename: `pastebin-${id}.txt` };
}

interface GistFile {
  filename: string;
  content: string;
  truncated: boolean;
  raw_url: string;
}

async function fetchGist(
  fetchImpl: typeof fetch,
  fetchUrl: string,
): Promise<ImportedFile> {
  const res = await fetchImpl(fetchUrl, {
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
    let rawUrl: URL;
    try {
      rawUrl = new URL(file.raw_url);
    } catch {
      throw new Error("Unexpected gist raw host.");
    }
    if (
      rawUrl.protocol !== "https:" ||
      rawUrl.hostname !== "gist.githubusercontent.com"
    ) {
      throw new Error("Unexpected gist raw host.");
    }
    const rawRes = await fetchImpl(rawUrl.href, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!rawRes.ok) {
      throw new Error(`Gist raw fetch returned HTTP ${rawRes.status}.`);
    }
    const buf = await rawRes.arrayBuffer();
    if (buf.byteLength > MAX_IMPORT_BYTES) throw tooLarge("File");
    return { bytes: new Uint8Array(buf), filename: file.filename };
  }

  const bytes = new TextEncoder().encode(file.content);
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw tooLarge("File");
  return { bytes, filename: file.filename };
}

/** Downloads a URL returned by `normalizeImportUrl`. */
export function fetchImportUrl(
  normalized: NormalizedImportUrl,
  fetchImpl: typeof fetch,
): Promise<ImportedFile> {
  return normalized.source === "pastebin"
    ? fetchPastebin(fetchImpl, normalized.fetchUrl, normalized.id)
    : fetchGist(fetchImpl, normalized.fetchUrl);
}
