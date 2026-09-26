import { describe, expect, it, vi } from "vitest";

import {
  buildSearchUrl,
  formatDownloadCount,
  hasMoreResults,
  searchCurseForgeMods,
} from "../client";

const PARAMS = { q: " create ", gameVersion: "1.20.1", loader: null, index: 0 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildSearchUrl", () => {
  it("includes loader only when set and trims the query", () => {
    expect(buildSearchUrl(PARAMS)).toBe(
      "/api/curseforge/search?q=create&gameVersion=1.20.1&index=0",
    );
    expect(buildSearchUrl({ ...PARAMS, loader: "forge", index: 20 })).toBe(
      "/api/curseforge/search?q=create&gameVersion=1.20.1&index=20&loader=forge",
    );
  });
});

describe("searchCurseForgeMods", () => {
  it("returns data on success", async () => {
    const data = {
      mods: [],
      pagination: { index: 0, pageSize: 20, totalCount: 0 },
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, data));
    await expect(
      searchCurseForgeMods(PARAMS, undefined, fetchImpl),
    ).resolves.toEqual({ status: "ok", data });
  });

  it("maps 503 to not_configured", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: "curseforge_not_configured" }),
    );
    await expect(
      searchCurseForgeMods(PARAMS, undefined, fetchImpl),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("surfaces the server error message", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(502, { error: "Boom." }));
    await expect(
      searchCurseForgeMods(PARAMS, undefined, fetchImpl),
    ).resolves.toEqual({ status: "error", message: "Boom." });
  });

  it("maps network failures to an error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const result = await searchCurseForgeMods(PARAMS, undefined, fetchImpl);
    expect(result.status).toBe("error");
  });

  it("rethrows when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      searchCurseForgeMods(PARAMS, controller.signal, fetchImpl),
    ).rejects.toThrow();
  });
});

describe("formatDownloadCount", () => {
  it("uses compact notation", () => {
    expect(formatDownloadCount(999)).toBe("999");
    expect(formatDownloadCount(1234567)).toBe("1.2M");
  });
});

describe("hasMoreResults", () => {
  it("compares loaded count to total", () => {
    expect(hasMoreResults(20, 40)).toBe(true);
    expect(hasMoreResults(40, 40)).toBe(false);
    expect(hasMoreResults(9_981, 50_000)).toBe(false);
  });
});
