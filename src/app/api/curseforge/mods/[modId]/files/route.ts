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
  let partial = false;
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
    // A failed later page shouldn't discard the rest. Retry it once (these
    // are usually transient 429/5xx); if it still fails, serve what arrived
    // uncached. The client auto-picks the newest file, so a missing page
    // could mean an older pick — hence the retry and the log.
    const rest = await Promise.allSettled(
      indexes.map((index) => fetchPage(index).catch(() => fetchPage(index))),
    );
    rest.forEach((page, i) => {
      if (page.status === "fulfilled") {
        raw.push(...page.value.data);
        return;
      }
      partial = true;
      console.warn(
        `CurseForge files page ${indexes[i]} for mod ${modId} failed; serving a partial list.`,
        page.reason,
      );
    });
  } catch (err) {
    return upstreamFailed(err);
  }

  const files: CurseForgeModFile[] = raw
    .map(trimFile)
    .sort(
      (a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate) || b.id - a.id,
    );
  const response = jsonOk(files);
  if (partial) response.headers.set("Cache-Control", "no-store");
  return response;
}
