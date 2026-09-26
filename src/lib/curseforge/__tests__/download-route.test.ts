import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/curseforge/mods/[modId]/files/[fileId]/download/route";

const KEY = "test-secret-key";
const CDN = "https://edge.forgecdn.net/files/4/100/create-0.5.1.jar";

function download(modId = "328085", fileId = "100") {
  return GET(
    new Request(
      `http://localhost/api/curseforge/mods/${modId}/files/${fileId}/download`,
    ),
    { params: Promise.resolve({ modId, fileId }) },
  );
}

function resolved(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/** A body that yields `chunks` and records whether it was cancelled. */
function trackedBody(chunks: Uint8Array[]) {
  const state = { cancelled: false, pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled < chunks.length) {
        controller.enqueue(chunks[state.pulled++]);
      } else {
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe("curseforge download route", () => {
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

  it("missing key → 503 without calling upstream", async () => {
    vi.stubEnv("CURSEFORGE_API_KEY", "");
    const res = await download();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "curseforge_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["zero modId", "0", "1"],
    ["non-numeric fileId", "1", "abc"],
    ["url-ish fileId", "1", "https://evil.example/x.jar"],
  ])("%s → 400", async (_label, modId, fileId) => {
    const res = await download(modId, fileId);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves via download-url and streams allowlisted bytes unchanged", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
    fetchMock.mockResolvedValueOnce(resolved(CDN)).mockResolvedValueOnce(
      new Response(bytes, {
        headers: { "Content-Length": String(bytes.byteLength) },
      }),
    );

    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/java-archive");
    expect(res.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    const [resolveUrl, resolveInit] = fetchMock.mock.calls[0];
    expect(resolveUrl).toBe(
      "https://api.curseforge.com/v1/mods/328085/files/100/download-url",
    );
    expect((resolveInit.headers as Record<string, string>)["x-api-key"]).toBe(
      KEY,
    );
    const [cdnUrl, cdnInit] = fetchMock.mock.calls[1];
    expect(String(cdnUrl)).toBe(CDN);
    expect(cdnInit.redirect).toBe("manual");
    expect(cdnInit.signal).toBeInstanceOf(AbortSignal);
    // The API key must never be forwarded to the CDN.
    expect(JSON.stringify(cdnInit.headers ?? {})).not.toContain(KEY);
  });

  it("follows an allowlisted redirect", async () => {
    const next = "https://mediafilez.forgecdn.net/files/4/100/create.jar";
    fetchMock
      .mockResolvedValueOnce(resolved(CDN))
      .mockResolvedValueOnce(redirect(next))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9])));

    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([7, 8, 9]),
    );
    expect(String(fetchMock.mock.calls[2][0])).toBe(next);
  });

  it.each([
    ["foreign host", "https://evil.example/create.jar"],
    ["lookalike host", "https://edge.forgecdn.net.evil.example/create.jar"],
    ["plain http", "http://edge.forgecdn.net/files/create.jar"],
  ])("disallowed resolved URL (%s) → 502", async (_label, url) => {
    fetchMock.mockResolvedValueOnce(resolved(url));
    const res = await download();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "disallowed_host" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirect to a disallowed host → 502 without fetching it", async () => {
    fetchMock
      .mockResolvedValueOnce(resolved(CDN))
      .mockResolvedValueOnce(redirect("http://169.254.169.254/latest", 301));
    const res = await download();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "disallowed_host" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("endless redirects → 502", async () => {
    fetchMock.mockResolvedValueOnce(resolved(CDN));
    fetchMock.mockImplementation(async () => redirect(CDN));
    const res = await download();
    expect(res.status).toBe(502);
  });

  it.each([
    ["null download URL", () => resolved(null)],
    ["404 from download-url", () => new Response("nope", { status: 404 })],
  ])("%s → 403", async (_label, make) => {
    fetchMock.mockResolvedValueOnce(make());
    const res = await download();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "distribution_disallowed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("oversize Content-Length → 413 before streaming", async () => {
    vi.stubEnv("CURSEFORGE_MAX_JAR_BYTES", "4");
    const { stream, state } = trackedBody([new Uint8Array(10)]);
    fetchMock
      .mockResolvedValueOnce(resolved(CDN))
      .mockResolvedValueOnce(
        new Response(stream, { headers: { "Content-Length": "10" } }),
      );
    const res = await download();
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "jar_too_large" });
    expect(state.pulled).toBeLessThanOrEqual(1);
    expect(state.cancelled).toBe(true);
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(
      true,
    );
  });

  it("stream exceeding the cap mid-flight errors and aborts upstream", async () => {
    vi.stubEnv("CURSEFORGE_MAX_JAR_BYTES", "5");
    const { stream, state } = trackedBody(
      Array.from({ length: 20 }, () => new Uint8Array(3)),
    );
    // No Content-Length, so the cap can only be enforced while streaming.
    fetchMock
      .mockResolvedValueOnce(resolved(CDN))
      .mockResolvedValueOnce(new Response(stream));

    const res = await download();
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(
      true,
    );
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(20);
  });

  it("CDN non-2xx → 502", async () => {
    fetchMock
      .mockResolvedValueOnce(resolved(CDN))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }));
    const res = await download();
    expect(res.status).toBe(502);
  });
});
