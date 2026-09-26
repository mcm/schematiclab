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

// CurseForge caps pageSize at 50 and doesn't document the order of this
// endpoint, so gather every page (bounded) before sorting — otherwise the
// newest file could sit past page one for mods with many releases.
const PAGE_SIZE = 50;
const MAX_PAGES = 5;

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

  const fetchPage = async (index: number) => {
    const params = new URLSearchParams(upstreamParams);
    params.set("index", String(index));
    const payload = (await curseForgeGet(
      apiKey,
      `/v1/mods/${modId}/files`,
      params,
    )) as { data?: unknown; pagination?: { totalCount?: unknown } } | null;
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const total = payload?.pagination?.totalCount;
    return { data, total: typeof total === "number" ? total : 0 };
  };

  const raw: unknown[] = [];
  try {
    const first = await fetchPage(0);
    raw.push(...first.data);
    const indexes: number[] = [];
    for (
      let index = PAGE_SIZE;
      index < first.total && indexes.length < MAX_PAGES - 1;
      index += PAGE_SIZE
    ) {
      indexes.push(index);
    }
    const rest = await Promise.all(indexes.map(fetchPage));
    for (const page of rest) raw.push(...page.data);
  } catch (err) {
    return upstreamFailed(err);
  }

  const files: CurseForgeModFile[] = raw
    .map(trimFile)
    .sort(
      (a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate) || b.id - a.id,
    );
  return jsonOk(files);
}
