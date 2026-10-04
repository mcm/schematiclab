import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/import-url/route";
import {
  ImportUrlError,
  MAX_IMPORT_BYTES,
  fetchImportUrl,
  normalizeImportUrl,
} from "../import-url";

describe("normalizeImportUrl", () => {
  it("rebuilds pastebin and gist URLs from their ids", () => {
    expect(normalizeImportUrl("https://pastebin.com/AbC123")).toEqual({
      fetchUrl: "https://pastebin.com/raw/AbC123",
      source: "pastebin",
      id: "AbC123",
    });
    expect(normalizeImportUrl("https://pastebin.com/raw/AbC123").id).toBe(
      "AbC123",
    );
    expect(normalizeImportUrl("https://gist.github.com/user/abc123")).toEqual({
      fetchUrl: "https://api.github.com/gists/abc123",
      source: "gist",
      id: "abc123",
    });
    expect(normalizeImportUrl("https://gist.github.com/abc123").id).toBe(
      "abc123",
    );
  });

  it("rejects other hosts, http and malformed ids", () => {
    for (const url of [
      "https://pastebin.com.evil.com/abc",
      "https://evil.com/pastebin.com/abc",
      "http://pastebin.com/abc",
      "https://pastebin.com/a/b/c",
      "https://pastebin.com/ab-c",
      "https://gist.github.com/user/not-hex",
      "nope",
    ]) {
      expect(() => normalizeImportUrl(url)).toThrow(ImportUrlError);
    }
  });
});

describe("fetchImportUrl", () => {
  it("downloads a paste without following redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response("paste body"));
    const file = await fetchImportUrl(
      normalizeImportUrl("https://pastebin.com/AbC"),
      fetchImpl as never,
    );
    expect(new TextDecoder().decode(file.bytes)).toBe("paste body");
    expect(file.filename).toBe("pastebin-AbC.txt");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://pastebin.com/raw/AbC",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("reads a gist's first file, falling back to its raw URL when truncated", async () => {
    const inline = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            files: {
              "a.txt": {
                filename: "a.txt",
                content: "inline",
                truncated: false,
              },
            },
          }),
        ),
    );
    const file = await fetchImportUrl(
      normalizeImportUrl("https://gist.github.com/abc"),
      inline as never,
    );
    expect(new TextDecoder().decode(file.bytes)).toBe("inline");
    expect(file.filename).toBe("a.txt");

    const rawUrl = "https://gist.githubusercontent.com/u/abc/raw/a.txt";
    const truncated = vi.fn(async (url: string) =>
      url === rawUrl
        ? new Response("raw body")
        : new Response(
            JSON.stringify({
              files: {
                "a.txt": {
                  filename: "a.txt",
                  content: "",
                  truncated: true,
                  raw_url: rawUrl,
                },
              },
            }),
          ),
    );
    const raw = await fetchImportUrl(
      normalizeImportUrl("https://gist.github.com/abc"),
      truncated as never,
    );
    expect(new TextDecoder().decode(raw.bytes)).toBe("raw body");
  });

  it("refuses a truncated gist whose raw URL is on another host", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            files: {
              "a.txt": {
                filename: "a.txt",
                content: "",
                truncated: true,
                raw_url: "https://evil.com/a.txt",
              },
            },
          }),
        ),
    );
    await expect(
      fetchImportUrl(
        normalizeImportUrl("https://gist.github.com/abc"),
        fetchImpl as never,
      ),
    ).rejects.toThrow("Unexpected gist raw host.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the 5 MB limit and reports HTTP errors", async () => {
    const big = vi.fn(
      async () => new Response(new Uint8Array(MAX_IMPORT_BYTES + 1)),
    );
    await expect(
      fetchImportUrl(
        normalizeImportUrl("https://pastebin.com/a"),
        big as never,
      ),
    ).rejects.toThrow("larger than the 5 MB limit");
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      fetchImportUrl(
        normalizeImportUrl("https://pastebin.com/a"),
        missing as never,
      ),
    ).rejects.toThrow("Pastebin returned HTTP 404.");
  });
});

describe("POST /api/import-url", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown): Promise<Response> {
    return POST(
      new Request("http://localhost/api/import-url", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  }

  it("returns the fetched bytes and filename", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("paste body")),
    );
    const res = await post({ url: "https://pastebin.com/AbC" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("paste body");
    expect(res.headers.get("X-Source-Filename")).toBe("pastebin-AbC.txt");
  });

  it("answers 400 for bad input and 502 for upstream failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchImpl);
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    const disallowed = await post({ url: "https://example.com/a" });
    expect(disallowed.status).toBe(400);
    expect(await disallowed.json()).toEqual({
      error: "Only pastebin.com and gist.github.com URLs are allowed.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const failed = await post({ url: "https://pastebin.com/AbC" });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      error: "Pastebin returned HTTP 500.",
    });
  });
});
