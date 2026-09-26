// Proxies CurseForge mod search so the API key stays server-side.
//
//   GET /api/curseforge/search?q=&gameVersion=&loader=&index=

import type { NextResponse } from "next/server";
import {
  MINECRAFT_GAME_ID,
  MODS_CLASS_ID,
  curseForgeGet,
  jsonError,
  jsonOk,
  notConfigured,
  parseNonNegativeInt,
  trimMod,
  upstreamFailed,
  validateGameVersion,
  validateLoader,
} from "@/lib/curseforge/server";
import {
  MOD_LOADER_TYPE,
  type CurseForgeSearchResponse,
} from "@/lib/curseforge/types";

const PAGE_SIZE = 20;
// CurseForge rejects requests where index + pageSize exceeds 10,000.
const MAX_INDEX = 10_000 - PAGE_SIZE;
const MAX_QUERY_LENGTH = 100;

export async function GET(request: Request): Promise<NextResponse> {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey) return notConfigured();

  const params = new URL(request.url).searchParams;

  const q = (params.get("q") ?? "").trim();
  if (q.length > MAX_QUERY_LENGTH) {
    return jsonError(
      400,
      `'q' must be at most ${MAX_QUERY_LENGTH} characters.`,
    );
  }

  const gameVersion = validateGameVersion(params.get("gameVersion"));
  if (!gameVersion.ok) return jsonError(400, gameVersion.error);

  const loader = validateLoader(params.get("loader"));
  if (!loader.ok) return jsonError(400, loader.error);

  const rawIndex = params.get("index");
  const index =
    rawIndex === null || rawIndex === "" ? 0 : parseNonNegativeInt(rawIndex);
  if (index === null || index > MAX_INDEX) {
    return jsonError(
      400,
      `'index' must be an integer between 0 and ${MAX_INDEX}.`,
    );
  }

  const upstreamParams = new URLSearchParams({
    gameId: String(MINECRAFT_GAME_ID),
    classId: String(MODS_CLASS_ID),
    gameVersion: gameVersion.value,
    pageSize: String(PAGE_SIZE),
    index: String(index),
    sortField: "2",
    sortOrder: "desc",
  });
  if (q) upstreamParams.set("searchFilter", q);
  if (loader.value) {
    upstreamParams.set("modLoaderType", String(MOD_LOADER_TYPE[loader.value]));
  }

  let payload: unknown;
  try {
    payload = await curseForgeGet(apiKey, "/v1/mods/search", upstreamParams);
  } catch (err) {
    return upstreamFailed(err);
  }

  const body = (payload ?? {}) as {
    data?: unknown;
    pagination?: { index?: unknown; pageSize?: unknown; totalCount?: unknown };
  };
  const data = Array.isArray(body.data) ? body.data : [];
  const p = body.pagination ?? {};
  const response: CurseForgeSearchResponse = {
    mods: data.map(trimMod),
    pagination: {
      index: typeof p.index === "number" ? p.index : index,
      pageSize: typeof p.pageSize === "number" ? p.pageSize : PAGE_SIZE,
      totalCount: typeof p.totalCount === "number" ? p.totalCount : data.length,
    },
  };
  return jsonOk(response);
}
