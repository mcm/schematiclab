import { describe, expect, it } from "vitest";
import { cleanupExpiredOutputs, createCleanupHandler } from "../cleanup";
import { OUTPUT_TTL_MS } from "../output";
import { createFakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const now = () => NOW;
const SECRET = "test-cron-secret-0123456789";
const URL_BASE = "http://localhost/api/cron/mcp-blob-cleanup";

function seed(pageSize?: number) {
  const blob = createFakeBlob(now, { pageSize });
  const at = (ms: number) => ({
    body: new Uint8Array(),
    uploadedAt: new Date(NOW.getTime() - ms),
  });
  blob.objects.set("mcp/old-a.schem", at(OUTPUT_TTL_MS + 1));
  blob.objects.set("mcp/old-b.nbt", at(3 * OUTPUT_TTL_MS));
  blob.objects.set("mcp/fresh.litematic", at(OUTPUT_TTL_MS - 1000));
  blob.objects.set("mcp/new.png", at(0));
  blob.objects.set("other/old.bin", at(5 * OUTPUT_TTL_MS));
  return blob;
}

describe("cleanupExpiredOutputs", () => {
  it("deletes mcp/ objects older than 24 hours and keeps the rest", async () => {
    const blob = seed();
    const result = await cleanupExpiredOutputs({ blob, now });
    expect(result).toEqual({ deleted: 2, kept: 2 });
    expect([...blob.objects.keys()].sort()).toEqual([
      "mcp/fresh.litematic",
      "mcp/new.png",
      "other/old.bin",
    ]);
    expect(blob.calls.find((c) => c.method === "list")?.args).toEqual([
      { prefix: "mcp/", cursor: undefined },
    ]);
  });

  it("follows list pagination", async () => {
    const blob = seed(1);
    const result = await cleanupExpiredOutputs({ blob, now });
    expect(result).toEqual({ deleted: 2, kept: 2 });
    expect(blob.calls.filter((c) => c.method === "list")).toHaveLength(4);
  });

  it("does not call del when nothing expired", async () => {
    const blob = createFakeBlob(now);
    expect(await cleanupExpiredOutputs({ blob, now })).toEqual({
      deleted: 0,
      kept: 0,
    });
    expect(blob.calls.some((c) => c.method === "del")).toBe(false);
  });
});

describe("cron cleanup handler", () => {
  const request = (authorization?: string) =>
    new Request(URL_BASE, {
      headers: authorization ? { authorization } : {},
    });

  it("rejects requests without the CRON_SECRET bearer token", async () => {
    const blob = seed();
    const handler = createCleanupHandler({ blob, now, cronSecret: SECRET });
    for (const auth of [
      undefined,
      "Bearer wrong",
      SECRET,
      `Bearer ${SECRET}x`,
      `Basic ${SECRET}`,
    ]) {
      const response = await handler(request(auth));
      expect(response.status).toBe(401);
    }
    expect(blob.calls).toEqual([]);
  });

  it("rejects every request when CRON_SECRET is unset", async () => {
    const blob = seed();
    for (const cronSecret of [undefined, ""]) {
      const handler = createCleanupHandler({ blob, now, cronSecret });
      expect((await handler(request("Bearer "))).status).toBe(401);
      expect((await handler(request("Bearer undefined"))).status).toBe(401);
    }
    expect(blob.calls).toEqual([]);
  });

  it("cleans up with the right bearer token", async () => {
    const blob = seed();
    const handler = createCleanupHandler({ blob, now, cronSecret: SECRET });
    const response = await handler(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2, kept: 2 });
  });

  it("answers 503 when no blob store is configured", async () => {
    const handler = createCleanupHandler({
      blob: null,
      now,
      cronSecret: SECRET,
    });
    expect((await handler(request(`Bearer ${SECRET}`))).status).toBe(503);
  });
});
