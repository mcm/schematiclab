// Server-only helpers shared by the `/api/curseforge/*` route handlers:
// upstream fetch, input validation, and trimming of upstream payloads into
// the client-facing shapes in `./types`. The API key is never read here —
// route modules read `process.env.CURSEFORGE_API_KEY` and pass it in.

import { NextResponse } from "next/server";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/known-versions";
import {
  MOD_LOADERS,
  isModLoader,
  type CurseForgeModFile,
  type CurseForgeModSummary,
  type ModLoader,
} from "./types";

export const CURSEFORGE_API_BASE = "https://api.curseforge.com";
export const MINECRAFT_GAME_ID = 432;
export const MODS_CLASS_ID = 6;
const FETCH_TIMEOUT_MS = 10_000;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export function jsonOk(body: unknown): NextResponse {
  return NextResponse.json(body, { status: 200, headers: CACHE_HEADERS });
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export function notConfigured(): NextResponse {
  return jsonError(503, "curseforge_not_configured");
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    /** Upstream HTTP status, when CurseForge responded at all. */
    readonly status?: number,
    /** Parsed `Retry-After`, in milliseconds. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (value.trim() !== "" && Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * GET a CurseForge API path. Throws `UpstreamError` with a generic message on
 * timeout, network failure, non-2xx, or unparsable JSON — the upstream body
 * is never surfaced to the caller.
 */
export async function curseForgeGet(
  apiKey: string,
  path: string,
  params: URLSearchParams,
): Promise<unknown> {
  const url = `${CURSEFORGE_API_BASE}${path}?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new UpstreamError("CurseForge request failed.");
  }
  if (!res.ok) {
    throw new UpstreamError(
      `CurseForge returned HTTP ${res.status}.`,
      res.status,
      parseRetryAfter(res.headers.get("Retry-After")),
    );
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError("CurseForge returned an invalid response.");
  }
}

export function upstreamFailed(err: unknown): NextResponse {
  return jsonError(
    502,
    err instanceof UpstreamError ? err.message : "CurseForge request failed.",
  );
}

// ---- validation ----------------------------------------------------------

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function validateGameVersion(raw: string | null): Validated<string> {
  if (!raw) return { ok: false, error: "Missing 'gameVersion' parameter." };
  if (!Object.hasOwn(KNOWN_VERSIONS, raw)) {
    return { ok: false, error: `Unknown Minecraft version '${raw}'.` };
  }
  return { ok: true, value: raw };
}

export function validateLoader(
  raw: string | null,
): Validated<ModLoader | null> {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (!isModLoader(raw)) {
    return {
      ok: false,
      error: `Invalid 'loader'; expected one of ${MOD_LOADERS.join(", ")}.`,
    };
  }
  return { ok: true, value: raw };
}

export function parsePositiveInt(raw: string | null): number | null {
  if (raw === null || !/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

// ---- trimming ------------------------------------------------------------

type Json = Record<string, unknown>;

function asObject(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function trimMod(raw: unknown): CurseForgeModSummary {
  const m = asObject(raw);
  const authors = Array.isArray(m.authors) ? m.authors : [];
  return {
    id: num(m.id),
    name: str(m.name),
    slug: str(m.slug),
    summary: str(m.summary),
    authors: authors.map((a) => str(asObject(a).name)).filter(Boolean),
    logoThumbnailUrl: strOrNull(asObject(m.logo).thumbnailUrl),
    downloadCount: num(m.downloadCount),
    websiteUrl: strOrNull(asObject(m.links).websiteUrl),
    // CurseForge reports null for "unknown"; treat anything but `true` as
    // disallowed so we never offer a download we can't make.
    allowModDistribution: m.allowModDistribution === true,
  };
}

const LOADER_TAGS: Record<string, ModLoader> = {
  forge: "forge",
  neoforge: "neoforge",
  fabric: "fabric",
  quilt: "quilt",
};

export function trimFile(raw: unknown): CurseForgeModFile {
  const f = asObject(raw);
  const tags = Array.isArray(f.gameVersions)
    ? f.gameVersions.filter((v): v is string => typeof v === "string")
    : [];
  const loaders: ModLoader[] = [];
  const gameVersions: string[] = [];
  for (const tag of tags) {
    const loader = LOADER_TAGS[tag.toLowerCase()];
    if (loader) {
      if (!loaders.includes(loader)) loaders.push(loader);
    } else if (/^\d+\.\d+(\.\d+)?(-Snapshot)?$/i.test(tag)) {
      gameVersions.push(tag);
    }
  }
  return {
    id: num(f.id),
    modId: num(f.modId),
    displayName: str(f.displayName),
    fileName: str(f.fileName),
    fileLength: num(f.fileLength),
    fileDate: str(f.fileDate),
    gameVersions,
    loaders,
    downloadable: typeof f.downloadUrl === "string" && f.downloadUrl !== "",
  };
}
