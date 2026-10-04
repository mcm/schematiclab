// Delivers files the tools write: uploaded to the private Blob store under
// `mcp/` and handed back as a signed GET URL that expires 24 hours after
// upload. The cleanup cron (`cleanup.ts`) deletes the objects after that.

import type { BlobClient } from "./blob";

export const OUTPUT_PREFIX = "mcp/";
export const OUTPUT_TTL_MS = 24 * 60 * 60 * 1000;

export const BLOB_NOT_CONFIGURED_MESSAGE =
  "File output is not configured on this server: no Vercel Blob store credentials " +
  "(BLOB_STORE_ID with Vercel OIDC) were found, so files cannot be returned.";

export class BlobNotConfiguredError extends Error {
  constructor() {
    super(BLOB_NOT_CONFIGURED_MESSAGE);
    this.name = "BlobNotConfiguredError";
  }
}

export interface OutputDeps {
  blob: BlobClient | null;
  now: () => Date;
}

export interface PublishedFile {
  url: string;
  filename: string;
  bytes: number;
  expiresAt: string;
}

// The SDK's messages when it finds no usable credentials at call time (for
// example `BLOB_STORE_ID` set but no OIDC token outside Vercel).
const CREDENTIAL_ERRORS = ["No blob credentials found", "No read-write token"];

// Keeps the last path segment and only filename-safe characters, so a tool's
// filename can never leave `mcp/`.
export function safeOutputFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 100);
  return cleaned === "" ? "file" : cleaned;
}

export async function publishFile(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  deps: OutputDeps,
): Promise<PublishedFile> {
  const { blob } = deps;
  if (!blob) throw new BlobNotConfiguredError();
  const name = safeOutputFilename(filename);
  try {
    const uploaded = await blob.put(`${OUTPUT_PREFIX}${name}`, bytes, {
      access: "private",
      addRandomSuffix: true,
      contentType: mimeType,
    });
    const validUntil = deps.now().getTime() + OUTPUT_TTL_MS;
    const token = await blob.issueSignedToken({
      pathname: uploaded.pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await blob.presignUrl(token, {
      operation: "get",
      pathname: uploaded.pathname,
      validUntil,
      access: "private",
    });
    return {
      url: presignedUrl,
      filename: name,
      bytes: bytes.byteLength,
      expiresAt: new Date(validUntil).toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (CREDENTIAL_ERRORS.some((prefix) => message.includes(prefix))) {
      throw new BlobNotConfiguredError();
    }
    throw new Error(`Could not store the output file: ${message}`);
  }
}
