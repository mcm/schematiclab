import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blobClientFromEnv, blobCredentialsConfigured } from "../blob";
import {
  BLOB_NOT_CONFIGURED_MESSAGE,
  OUTPUT_TTL_MS,
  publishFile,
  safeOutputFilename,
} from "../output";
import { runTool } from "../tools";
import { defineTool, jsonResult } from "../types";
import { createFakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const now = () => NOW;
const BYTES = new Uint8Array([10, 0, 0, 1, 2, 3]);

describe("publishFile", () => {
  it("uploads privately under mcp/ with a random suffix", async () => {
    const blob = createFakeBlob(now);
    await publishFile(BYTES, "house.schem", "application/octet-stream", {
      blob,
      now,
    });
    const put = blob.calls.find((c) => c.method === "put");
    expect(put?.args).toEqual([
      "mcp/house.schem",
      BYTES,
      {
        access: "private",
        addRandomSuffix: true,
        contentType: "application/octet-stream",
      },
    ]);
    expect([...blob.objects.keys()]).toEqual(["mcp/house-rnd1.schem"]);
  });

  it("returns a signed GET URL that expires 24 hours after upload", async () => {
    const blob = createFakeBlob(now);
    const result = await publishFile(BYTES, "house.schem", "x/y", {
      blob,
      now,
    });
    const validUntil = NOW.getTime() + OUTPUT_TTL_MS;
    expect(result).toEqual({
      url: `https://store.private.blob.vercel-storage.com/mcp/house-rnd1.schem?vercel-blob-expires=${validUntil}`,
      filename: "house.schem",
      bytes: BYTES.byteLength,
      expiresAt: "2026-10-05T12:00:00.000Z",
    });
  });

  it("scopes the signed token to the uploaded pathname and get only", async () => {
    const blob = createFakeBlob(now);
    await publishFile(BYTES, "house.schem", "x/y", { blob, now });
    const validUntil = NOW.getTime() + OUTPUT_TTL_MS;
    const issue = blob.calls.find((c) => c.method === "issueSignedToken");
    expect(issue?.args).toEqual([
      { pathname: "mcp/house-rnd1.schem", operations: ["get"], validUntil },
    ]);
    const presign = blob.calls.find((c) => c.method === "presignUrl");
    expect(presign?.args).toEqual([
      {
        delegationToken: `delegation:mcp/house-rnd1.schem:${validUntil}`,
        clientSigningToken: "signing",
      },
      {
        operation: "get",
        pathname: "mcp/house-rnd1.schem",
        validUntil,
        access: "private",
      },
    ]);
  });

  it("keeps filenames inside mcp/", async () => {
    const blob = createFakeBlob(now);
    const result = await publishFile(BYTES, "../../etc/pa ss?.nbt", "x/y", {
      blob,
      now,
    });
    expect(result.filename).toBe("pa_ss_.nbt");
    expect(blob.calls[0].args[0]).toBe("mcp/pa_ss_.nbt");
    expect(safeOutputFilename("..")).toBe("file");
    expect(safeOutputFilename(".hidden")).toBe("hidden");
    expect(safeOutputFilename("a/b\\c.litematic")).toBe("c.litematic");
  });

  it("shortens long filenames without losing the extension", () => {
    const long = safeOutputFilename(`${"x".repeat(300)}.litematic`);
    expect(long).toHaveLength(100);
    expect(long.endsWith("x.litematic")).toBe(true);
    expect(safeOutputFilename(`a.${"y".repeat(300)}`)).toHaveLength(100);
  });

  it("throws a clear error without a blob store", async () => {
    await expect(
      publishFile(BYTES, "a.nbt", "x/y", { blob: null, now }),
    ).rejects.toThrow(BLOB_NOT_CONFIGURED_MESSAGE);
  });

  it("maps the SDK's missing-credentials error to the same message", async () => {
    const blob = createFakeBlob(now, {
      putError: new Error(
        "Vercel Blob: No blob credentials found. Pass a `token` option, ...",
      ),
    });
    await expect(
      publishFile(BYTES, "a.nbt", "x/y", { blob, now }),
    ).rejects.toThrow(BLOB_NOT_CONFIGURED_MESSAGE);
  });

  it("reports other upload failures", async () => {
    const blob = createFakeBlob(now, {
      putError: new Error("store suspended"),
    });
    await expect(
      publishFile(BYTES, "a.nbt", "x/y", { blob, now }),
    ).rejects.toThrow("Could not store the output file: store suspended");
  });
});

describe("file-writing tools without credentials", () => {
  const writer = defineTool({
    name: "write_file",
    title: "Write",
    description: "test tool",
    inputSchema: z.object({}),
    handler: async (_args, deps) =>
      jsonResult({
        ...(await publishFile(BYTES, "a.nbt", "x/y", deps)),
      }),
  });

  it("return a tool error naming the missing configuration", async () => {
    const result = await runTool(
      writer,
      {},
      { fetch: () => Promise.reject(new Error("no network")), now, blob: null },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: BLOB_NOT_CONFIGURED_MESSAGE },
    ]);
  });

  it("return the signed URL when configured", async () => {
    const result = await runTool(
      writer,
      {},
      {
        fetch: () => Promise.reject(new Error("no network")),
        now,
        blob: createFakeBlob(now),
      },
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      filename: "a.nbt",
      url: `https://store.private.blob.vercel-storage.com/mcp/a-rnd1.nbt?vercel-blob-expires=${NOW.getTime() + OUTPUT_TTL_MS}`,
    });
  });
});

describe("blob credentials", () => {
  it("are configured by BLOB_STORE_ID only", () => {
    expect(blobCredentialsConfigured({})).toBe(false);
    expect(blobCredentialsConfigured({ BLOB_STORE_ID: " " })).toBe(false);
    expect(blobCredentialsConfigured({ BLOB_STORE_ID: "store_abc" })).toBe(
      true,
    );
    // Without BLOB_STORE_ID, returned URLs couldn't be read back as inputs.
    expect(blobCredentialsConfigured({ BLOB_READ_WRITE_TOKEN: "t" })).toBe(
      false,
    );
    expect(blobClientFromEnv({})).toBeNull();
    expect(blobClientFromEnv({ BLOB_STORE_ID: "store_abc" })).not.toBeNull();
  });
});
