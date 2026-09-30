// Browser-side helpers for the `/api/curseforge/*` proxy routes (SCHEM-11).

import type {
  CurseForgeModFile,
  CurseForgeSearchResponse,
  ModLoader,
} from "./types";

export interface CurseForgeSearchParams {
  q: string;
  /** Minecraft version to filter by; null searches every version. */
  gameVersion: string | null;
  loader: ModLoader | null;
  index: number;
}

export type CurseForgeSearchResult =
  | { status: "ok"; data: CurseForgeSearchResponse }
  | { status: "not_configured" }
  | { status: "error"; message: string };

export function buildSearchUrl(params: CurseForgeSearchParams): string {
  const query = new URLSearchParams({ q: params.q.trim() });
  if (params.gameVersion !== null) query.set("gameVersion", params.gameVersion);
  query.set("index", String(params.index));
  if (params.loader) query.set("loader", params.loader);
  return `/api/curseforge/search?${query.toString()}`;
}

/**
 * Search CurseForge via our proxy. Resolves to a tagged result; only rejects
 * when `signal` aborts (so callers can ignore stale requests).
 */
export async function searchCurseForgeMods(
  params: CurseForgeSearchParams,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CurseForgeSearchResult> {
  let response: Response;
  try {
    response = await fetchImpl(buildSearchUrl(params), { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { status: "error", message: "Could not reach the server." };
  }

  if (response.status === 503) return { status: "not_configured" };

  let body: unknown = null;
  try {
    body = await response.json();
  } catch (err) {
    if (signal?.aborted) throw err;
    // Fall through with a null body.
  }

  if (!response.ok) {
    const error =
      body !== null &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `CurseForge search failed (HTTP ${response.status}).`;
    return { status: "error", message: error };
  }

  const data = body as CurseForgeSearchResponse | null;
  if (!data || !Array.isArray(data.mods) || !data.pagination) {
    return { status: "error", message: "Unexpected response from server." };
  }
  return { status: "ok", data };
}

const COMPACT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** `1234567` → `1.2M`. */
export function formatDownloadCount(count: number): string {
  return COMPACT.format(Math.max(0, count));
}

// Largest `index` the search route accepts (CurseForge rejects
// index + pageSize beyond 10,000).
const MAX_SEARCH_INDEX = 10_000 - 20;

/** True while more results exist beyond what's been loaded. */
export function hasMoreResults(loaded: number, totalCount: number): boolean {
  return loaded < totalCount && loaded <= MAX_SEARCH_INDEX;
}

export interface CurseForgeFilesParams {
  modId: number;
  gameVersion: string;
  loader: ModLoader | null;
}

export function buildFilesUrl(params: CurseForgeFilesParams): string {
  const query = new URLSearchParams({ gameVersion: params.gameVersion });
  if (params.loader) query.set("loader", params.loader);
  return `/api/curseforge/mods/${params.modId}/files?${query.toString()}`;
}

export function buildDownloadUrl(modId: number, fileId: number): string {
  return `/api/curseforge/mods/${modId}/files/${fileId}/download`;
}

/** Thrown by the mod-file helpers below; `message` is user-facing. */
export class CurseForgeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "CurseForgeRequestError";
  }
}

async function errorBodyCode(
  response: Response,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    const error = (body as { error?: unknown } | null)?.error;
    return typeof error === "string" ? error : null;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/**
 * List a mod's files for a version/loader, newest first. Rejects with
 * `CurseForgeRequestError` on failure (or the abort reason when aborted).
 */
export async function fetchCurseForgeModFiles(
  params: CurseForgeFilesParams,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CurseForgeModFile[]> {
  let response: Response;
  try {
    response = await fetchImpl(buildFilesUrl(params), { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new CurseForgeRequestError("Could not reach the server.");
  }
  if (response.status === 503) {
    throw new CurseForgeRequestError(
      "CurseForge integration is not configured on this server.",
      503,
    );
  }
  if (!response.ok) {
    const code = await errorBodyCode(response, signal);
    throw new CurseForgeRequestError(
      code ?? `Could not list mod files (HTTP ${response.status}).`,
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    if (signal?.aborted) throw err;
    body = null;
  }
  if (!Array.isArray(body)) {
    throw new CurseForgeRequestError("Unexpected response from server.");
  }
  return body as CurseForgeModFile[];
}

/** The newest downloadable file, or null. Doesn't assume input order. */
export function pickDownloadableFile(
  files: readonly CurseForgeModFile[],
): CurseForgeModFile | null {
  let best: CurseForgeModFile | null = null;
  for (const file of files) {
    if (!file.downloadable) continue;
    if (
      best === null ||
      Date.parse(file.fileDate) > Date.parse(best.fileDate) ||
      (file.fileDate === best.fileDate && file.id > best.id)
    ) {
      best = file;
    }
  }
  return best;
}

const DOWNLOAD_ERROR_MESSAGES: Record<number, string> = {
  403: "The author disallows third-party downloads of this file.",
  404: "This mod file no longer exists on CurseForge.",
  413: "The mod file is too large to load.",
  503: "CurseForge integration is not configured on this server.",
};

export interface DownloadProgress {
  received: number;
  /** From `Content-Length`; null when the server didn't send one. */
  total: number | null;
}

/**
 * Download a mod file's jar through the streaming proxy, reporting progress
 * as chunks arrive. Rejects with `CurseForgeRequestError` on failure.
 */
export async function downloadModJar(
  modId: number,
  fileId: number,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(buildDownloadUrl(modId, fileId), { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new CurseForgeRequestError("Download failed: network error.");
  }
  if (!response.ok || !response.body) {
    const known = DOWNLOAD_ERROR_MESSAGES[response.status];
    const code = known ? null : await errorBodyCode(response, signal);
    throw new CurseForgeRequestError(
      known ?? code ?? `Download failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  const header = Number(response.headers.get("Content-Length"));
  const total = Number.isFinite(header) && header > 0 ? header : null;
  // With a known length, fill one buffer as chunks arrive instead of
  // concatenating at the end (which briefly needs twice the jar's size).
  // Fall back to collecting chunks if the body outgrows the header.
  let buffer: Uint8Array | null = total !== null ? new Uint8Array(total) : null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  onProgress({ received, total });
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (buffer !== null && received + value.byteLength <= buffer.length) {
        buffer.set(value, received);
      } else {
        if (buffer !== null) chunks.push(buffer.subarray(0, received));
        buffer = null;
        chunks.push(value);
      }
      received += value.byteLength;
      onProgress({ received, total });
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new CurseForgeRequestError("Download interrupted.");
  }

  if (buffer !== null) {
    // Exact-length view when the body was shorter than advertised.
    return received === buffer.length ? buffer : buffer.slice(0, received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
