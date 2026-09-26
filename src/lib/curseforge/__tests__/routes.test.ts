import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as searchGET } from "@/app/api/curseforge/search/route";
import { GET as filesGET } from "@/app/api/curseforge/mods/[modId]/files/route";
import { MOD_LOADER_TYPE } from "@/lib/curseforge/types";

const KEY = "test-secret-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function search(query: string) {
  return searchGET(
    new Request(`http://localhost/api/curseforge/search?${query}`),
  );
}

function files(modId: string, query: string) {
  return filesGET(
    new Request(`http://localhost/api/curseforge/mods/${modId}/files?${query}`),
    { params: Promise.resolve({ modId }) },
  );
}

function upstreamUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  return new URL(fetchMock.mock.calls[0][0] as string);
}

const RAW_MOD = {
  id: 328085,
  gameId: 432,
  name: "Create",
  slug: "create",
  summary: "Aesthetic technology",
  authors: [
    { id: 1, name: "simibubi", url: "https://example/simibubi" },
    { id: 2, name: "zelophed", url: "https://example/zelophed" },
  ],
  logo: {
    id: 9,
    thumbnailUrl: "https://media.forgecdn.net/thumb.png",
    url: "x",
  },
  downloadCount: 123456789,
  links: { websiteUrl: "https://www.curseforge.com/minecraft/mc-mods/create" },
  allowModDistribution: true,
  screenshots: [{ url: "should-be-dropped" }],
  latestFiles: [{ id: 1 }],
};

const RAW_FILES = [
  {
    id: 100,
    modId: 328085,
    displayName: "Create 0.5.0",
    fileName: "create-0.5.0.jar",
    fileLength: 1000,
    fileDate: "2023-01-01T00:00:00Z",
    gameVersions: ["1.20.1", "Forge", "Client", "Server"],
    downloadUrl: "https://edge.forgecdn.net/files/1/100/create-0.5.0.jar",
    hashes: [{ value: "dropme" }],
  },
  {
    id: 200,
    modId: 328085,
    displayName: "Create 0.5.1",
    fileName: "create-0.5.1.jar",
    fileLength: 2000,
    fileDate: "2024-06-01T00:00:00Z",
    gameVersions: ["1.20.1", "NeoForge", "Forge"],
    downloadUrl: null,
  },
];

describe("curseforge proxy routes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CURSEFORGE_API_KEY", KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("missing API key", () => {
    beforeEach(() => vi.stubEnv("CURSEFORGE_API_KEY", ""));

    it("search returns 503", async () => {
      const res = await search("gameVersion=1.20.1");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "curseforge_not_configured" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("files returns 503", async () => {
      const res = await files("1", "gameVersion=1.20.1");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "curseforge_not_configured" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("invalid params → 400", () => {
    it.each([
      ["missing gameVersion", ""],
      ["unknown gameVersion", "gameVersion=9.9.9"],
      ["bad loader", "gameVersion=1.20.1&loader=rift"],
      ["negative index", "gameVersion=1.20.1&index=-1"],
      ["non-numeric index", "gameVersion=1.20.1&index=abc"],
      ["index too large", "gameVersion=1.20.1&index=10000"],
    ])("search: %s", async (_label, query) => {
      const res = await search(query);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["zero modId", "0", "gameVersion=1.20.1"],
      ["negative modId", "-5", "gameVersion=1.20.1"],
      ["non-numeric modId", "abc", "gameVersion=1.20.1"],
      ["fractional modId", "1.5", "gameVersion=1.20.1"],
      ["missing gameVersion", "1", ""],
      ["bad loader", "1", "gameVersion=1.20.1&loader=liteloader"],
    ])("files: %s", async (_label, modId, query) => {
      const res = await files(modId, query);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("search", () => {
    it("calls CurseForge with fixed params, key header, no modLoaderType when loader unset", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          data: [RAW_MOD],
          pagination: { index: 0, pageSize: 20, resultCount: 1, totalCount: 1 },
        }),
      );
      const res = await search("q=create&gameVersion=1.20.1");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, s-maxage=300, stale-while-revalidate=600",
      );

      const url = upstreamUrl(fetchMock);
      expect(url.origin + url.pathname).toBe(
        "https://api.curseforge.com/v1/mods/search",
      );
      const p = url.searchParams;
      expect(p.get("gameId")).toBe("432");
      expect(p.get("classId")).toBe("6");
      expect(p.get("pageSize")).toBe("20");
      expect(p.get("sortField")).toBe("2");
      expect(p.get("sortOrder")).toBe("desc");
      expect(p.get("gameVersion")).toBe("1.20.1");
      expect(p.get("searchFilter")).toBe("create");
      expect(p.get("index")).toBe("0");
      expect(p.has("modLoaderType")).toBe(false);

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    });

    it.each(Object.entries(MOD_LOADER_TYPE))(
      "maps loader %s → modLoaderType %i",
      async (loader, type) => {
        fetchMock.mockResolvedValue(jsonResponse({ data: [], pagination: {} }));
        await search(`gameVersion=1.20.1&loader=${loader}&index=40`);
        const p = upstreamUrl(fetchMock).searchParams;
        expect(p.get("modLoaderType")).toBe(String(type));
        expect(p.get("index")).toBe("40");
      },
    );

    it("trims mods to the client-facing shape", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          data: [
            RAW_MOD,
            { ...RAW_MOD, id: 2, allowModDistribution: null, logo: null },
          ],
          pagination: {
            index: 0,
            pageSize: 20,
            resultCount: 2,
            totalCount: 57,
          },
        }),
      );
      const body = await (await search("gameVersion=1.20.1")).json();
      expect(body).toEqual({
        mods: [
          {
            id: 328085,
            name: "Create",
            slug: "create",
            summary: "Aesthetic technology",
            authors: ["simibubi", "zelophed"],
            logoThumbnailUrl: "https://media.forgecdn.net/thumb.png",
            downloadCount: 123456789,
            websiteUrl: "https://www.curseforge.com/minecraft/mc-mods/create",
            allowModDistribution: true,
          },
          expect.objectContaining({
            id: 2,
            logoThumbnailUrl: null,
            allowModDistribution: false,
          }),
        ],
        pagination: { index: 0, pageSize: 20, totalCount: 57 },
      });
    });

    it("upstream non-2xx → 502 without leaking body or key", async () => {
      fetchMock.mockResolvedValue(
        new Response(`secret upstream detail ${KEY}`, { status: 403 }),
      );
      const res = await search("gameVersion=1.20.1");
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).not.toContain("secret upstream detail");
      expect(text).not.toContain(KEY);
      expect(JSON.parse(text).error).toEqual(expect.any(String));
    });

    it("network failure / timeout → 502", async () => {
      fetchMock.mockRejectedValue(
        new DOMException("timed out", "TimeoutError"),
      );
      const res = await search("gameVersion=1.20.1");
      expect(res.status).toBe(502);
    });

    it("passes a timeout signal to fetch", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
      await search("gameVersion=1.20.1");
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("files", () => {
    it("calls the files endpoint and maps loader", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
      const res = await files("328085", "gameVersion=1.20.1&loader=neoforge");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, s-maxage=300, stale-while-revalidate=600",
      );
      const url = upstreamUrl(fetchMock);
      expect(url.origin + url.pathname).toBe(
        "https://api.curseforge.com/v1/mods/328085/files",
      );
      expect(url.searchParams.get("gameVersion")).toBe("1.20.1");
      expect(url.searchParams.get("modLoaderType")).toBe("6");
    });

    it("omits modLoaderType when loader unset", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
      await files("328085", "gameVersion=1.20.1");
      expect(upstreamUrl(fetchMock).searchParams.has("modLoaderType")).toBe(
        false,
      );
    });

    it("trims files, sorts newest first, and flags non-downloadable", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: RAW_FILES }));
      const body = await (await files("328085", "gameVersion=1.20.1")).json();
      expect(body).toEqual([
        {
          id: 200,
          modId: 328085,
          displayName: "Create 0.5.1",
          fileName: "create-0.5.1.jar",
          fileLength: 2000,
          fileDate: "2024-06-01T00:00:00Z",
          gameVersions: ["1.20.1"],
          loaders: ["neoforge", "forge"],
          downloadable: false,
        },
        {
          id: 100,
          modId: 328085,
          displayName: "Create 0.5.0",
          fileName: "create-0.5.0.jar",
          fileLength: 1000,
          fileDate: "2023-01-01T00:00:00Z",
          gameVersions: ["1.20.1"],
          loaders: ["forge"],
          downloadable: true,
        },
      ]);
    });

    it("fetches later pages (capped) so the newest file isn't missed", async () => {
      const page = (ids: number[], totalCount: number) =>
        jsonResponse({
          data: ids.map((id) => ({
            id,
            fileDate: new Date(Date.UTC(2020, 0, id)).toISOString(),
          })),
          pagination: { totalCount },
        });
      fetchMock.mockImplementation(async (input: string) => {
        const index = Number(new URL(input).searchParams.get("index"));
        return page([index + 1, index + 2], 1000);
      });
      const body = (await (
        await files("328085", "gameVersion=1.20.1")
      ).json()) as { id: number }[];
      const indexes = fetchMock.mock.calls.map((c) =>
        new URL(c[0] as string).searchParams.get("index"),
      );
      expect(indexes).toEqual(["0", "50", "100", "150", "200"]);
      expect(body[0].id).toBe(202);
      expect(body).toHaveLength(10);
    });

    it("serves the pages that loaded, uncached, when a later page fails", async () => {
      fetchMock.mockImplementation(async (input: string) => {
        const index = Number(new URL(input).searchParams.get("index"));
        if (index === 100) return new Response("busy", { status: 429 });
        return jsonResponse({
          data: [{ id: index + 1, fileDate: "2020-01-01T00:00:00Z" }],
          pagination: { totalCount: 150 },
        });
      });
      const res = await files("328085", "gameVersion=1.20.1");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = (await res.json()) as { id: number }[];
      expect(body.map((f) => f.id).sort((a, b) => a - b)).toEqual([1, 51]);
    });

    it("stops after one page when totalCount fits", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: RAW_FILES, pagination: { totalCount: 2 } }),
      );
      await files("328085", "gameVersion=1.20.1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("upstream non-2xx → 502 without leaking body", async () => {
      fetchMock.mockResolvedValue(
        new Response("nope: internal", { status: 500 }),
      );
      const res = await files("328085", "gameVersion=1.20.1");
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain("nope: internal");
    });
  });
});
