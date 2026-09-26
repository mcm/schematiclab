// Proxies CurseForge file listing for a single mod, filtered to a Minecraft
// version and optional loader. Returns files newest first.
//
//   GET /api/curseforge/mods/{modId}/files?gameVersion=&loader=

import type { NextResponse } from "next/server";
import {
  curseForgeGet,
  jsonError,
  jsonOk,
  notConfigured,
  parsePositiveInt,
  trimFile,
  upstreamFailed,
  validateGameVersion,
  validateLoader,
} from "@/lib/curseforge/server";
import {
  MOD_LOADER_TYPE,
  type CurseForgeModFile,
} from "@/lib/curseforge/types";

const PAGE_SIZE = 50;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ modId: string }> },
): Promise<NextResponse> {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey) return notConfigured();

  const modId = parsePositiveInt((await params).modId);
  if (modId === null) {
    return jsonError(400, "'modId' must be a positive integer.");
  }

  const query = new URL(request.url).searchParams;

  const gameVersion = validateGameVersion(query.get("gameVersion"));
  if (!gameVersion.ok) return jsonError(400, gameVersion.error);

  const loader = validateLoader(query.get("loader"));
  if (!loader.ok) return jsonError(400, loader.error);

  const upstreamParams = new URLSearchParams({
    gameVersion: gameVersion.value,
    pageSize: String(PAGE_SIZE),
  });
  if (loader.value) {
    upstreamParams.set("modLoaderType", String(MOD_LOADER_TYPE[loader.value]));
  }

  let payload: unknown;
  try {
    payload = await curseForgeGet(
      apiKey,
      `/v1/mods/${modId}/files`,
      upstreamParams,
    );
  } catch (err) {
    return upstreamFailed(err);
  }

  const data = (payload as { data?: unknown } | null)?.data;
  const files: CurseForgeModFile[] = (Array.isArray(data) ? data : [])
    .map(trimFile)
    .sort(
      (a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate) || b.id - a.id,
    );
  return jsonOk(files);
}
