import { describe, expect, it, vi } from "vitest";

import {
  buildFilesUrl,
  buildSearchUrl,
  downloadModJar,
  fetchCurseForgeModFiles,
  formatDownloadCount,
  hasMoreResults,
  pickDownloadableFile,
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

  it("omits gameVersion when null", () => {
    expect(buildSearchUrl({ ...PARAMS, gameVersion: null })).toBe(
      "/api/curseforge/search?q=create&index=0",
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

describe("abort while reading the body", () => {
  // A response whose body errors once `controller` aborts mid-read.
  function stalledResponse(controller: AbortController, status = 200) {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller.signal.addEventListener("abort", () =>
          c.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return new Response(body, { status });
  }

  it("searchCurseForgeMods rejects instead of resolving an error", async () => {
    const controller = new AbortController();
    const pending = searchCurseForgeMods(
      PARAMS,
      controller.signal,
      vi.fn(async () => stalledResponse(controller)),
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });

  it.each([200, 502])(
    "fetchCurseForgeModFiles rethrows the abort (HTTP %i)",
    async (status) => {
      const controller = new AbortController();
      const pending = fetchCurseForgeModFiles(
        { modId: 1, gameVersion: "1.20.1", loader: null },
        controller.signal,
        vi.fn(async () => stalledResponse(controller, status)),
      );
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    },
  );
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

describe("mod file helpers", () => {
  const file = (id: number, fileDate: string, downloadable = true) => ({
    id,
    modId: 1,
    displayName: `f${id}`,
    fileName: `f${id}.jar`,
    fileLength: 1,
    fileDate,
    gameVersions: ["1.20.1"],
    loaders: [],
    downloadable,
  });

  it("builds the files URL", () => {
    expect(
      buildFilesUrl({ modId: 5, gameVersion: "1.20.1", loader: "fabric" }),
    ).toBe("/api/curseforge/mods/5/files?gameVersion=1.20.1&loader=fabric");
  });

  it("picks the newest downloadable file", () => {
    expect(
      pickDownloadableFile([
        file(1, "2023-01-01T00:00:00Z"),
        file(2, "2025-01-01T00:00:00Z", false),
        file(3, "2024-01-01T00:00:00Z"),
      ])?.id,
    ).toBe(3);
    expect(pickDownloadableFile([file(2, "2025-01-01", false)])).toBeNull();
  });

  it("lists files and surfaces errors", async () => {
    const files = [file(1, "2024-01-01T00:00:00Z")];
    await expect(
      fetchCurseForgeModFiles(
        { modId: 1, gameVersion: "1.20.1", loader: null },
        undefined,
        vi.fn(async () => jsonResponse(200, files)),
      ),
    ).resolves.toEqual(files);
    await expect(
      fetchCurseForgeModFiles(
        { modId: 1, gameVersion: "1.20.1", loader: null },
        undefined,
        vi.fn(async () => jsonResponse(502, { error: "upstream down" })),
      ),
    ).rejects.toThrow("upstream down");
  });

  it("downloads with progress", async () => {
    const progress: number[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const bytes = await downloadModJar(
      1,
      2,
      ({ received, total }) => {
        expect(total).toBe(3);
        progress.push(received);
      },
      undefined,
      vi.fn(
        async () => new Response(body, { headers: { "Content-Length": "3" } }),
      ),
    );
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(progress).toEqual([0, 2, 3]);
  });

  it.each([
    ["shorter than", "5"],
    ["longer than", "2"],
    ["without", null],
  ])(
    "returns exactly the received bytes for a body %s Content-Length",
    async (_label, length) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      });
      const headers: Record<string, string> =
        length === null ? {} : { "Content-Length": length };
      const bytes = await downloadModJar(
        1,
        2,
        () => {},
        undefined,
        vi.fn(async () => new Response(body, { headers })),
      );
      expect([...bytes]).toEqual([1, 2, 3]);
      expect(bytes.byteLength).toBe(bytes.buffer.byteLength);
    },
  );

  it.each([
    [403, "disallows third-party downloads"],
    [404, "no longer exists"],
    [413, "too large"],
  ])("maps download HTTP %i to a friendly error", async (status, text) => {
    await expect(
      downloadModJar(
        1,
        2,
        () => {},
        undefined,
        vi.fn(async () => jsonResponse(status, { error: "x" })),
      ),
    ).rejects.toThrow(text);
  });
});
