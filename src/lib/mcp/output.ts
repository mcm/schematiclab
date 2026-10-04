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

class ToolCallAbortedError extends Error {
  constructor() {
    super("The tool call was stopped before its file was stored.");
    this.name = "ToolCallAbortedError";
  }
}

export interface OutputDeps {
  blob: BlobClient | null;
  now: () => Date;
  // Aborted once the tool call has given up (timed out): nothing is
  // uploaded, and an upload already under way is deleted when it lands.
  signal?: AbortSignal;
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

const MAX_FILENAME_LENGTH = 100;
const MAX_EXTENSION_LENGTH = 16;

// Keeps the last path segment and only filename-safe characters, so a tool's
// filename can never leave `mcp/`. Long names lose the end of their stem,
// never their extension.
export function safeOutputFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  if (cleaned === "") return "file";
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  if (ext.length > MAX_EXTENSION_LENGTH) {
    return cleaned.slice(0, MAX_FILENAME_LENGTH);
  }
  return cleaned.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
}

/**
 * Throws `BlobNotConfiguredError` without a Blob store, so a tool that
 * writes a file fails before doing work `publishFile` would throw away.
 */
export function assertBlobConfigured(deps: Pick<OutputDeps, "blob">): void {
  if (!deps.blob) throw new BlobNotConfiguredError();
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
  deps.signal?.throwIfAborted();
  try {
    const uploaded = await blob.put(`${OUTPUT_PREFIX}${name}`, bytes, {
      access: "private",
      addRandomSuffix: true,
      contentType: mimeType,
    });
    if (deps.signal?.aborted) {
      await blob.del([uploaded.pathname]).catch(() => {});
      throw new ToolCallAbortedError();
    }
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
    if (err instanceof ToolCallAbortedError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (CREDENTIAL_ERRORS.some((prefix) => message.includes(prefix))) {
      throw new BlobNotConfiguredError();
    }
    throw new Error(`Could not store the output file: ${message}`);
  }
}
