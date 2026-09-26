// Browser-side helpers for the `/api/curseforge/*` proxy routes (SCHEM-11).

import type { CurseForgeSearchResponse, ModLoader } from "./types";

export interface CurseForgeSearchParams {
  q: string;
  gameVersion: string;
  loader: ModLoader | null;
  index: number;
}

export type CurseForgeSearchResult =
  | { status: "ok"; data: CurseForgeSearchResponse }
  | { status: "not_configured" }
  | { status: "error"; message: string };

export function buildSearchUrl(params: CurseForgeSearchParams): string {
  const query = new URLSearchParams({
    q: params.q.trim(),
    gameVersion: params.gameVersion,
    index: String(params.index),
  });
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
  } catch {
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
