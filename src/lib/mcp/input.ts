// Schematic inputs of the MCP tools: `{ url }` or `{ base64, filename }`.
//
// URLs are either pastebin/gist URLs (the `/api/import-url` allowlist in
// `lib/import-url.ts`) or signed URLs from our own private Blob store, which
// are read back with the SDK's `get()` by pathname and never fetched. Every
// other URL is rejected before any request is made.

import { z } from "zod";
import {
  MAX_IMPORT_BYTES,
  fetchImportUrl,
  normalizeImportUrl,
} from "../import-url";
import { OUTPUT_PREFIX } from "./output";
import type { McpDeps } from "./types";

export const MAX_INPUT_BYTES = MAX_IMPORT_BYTES;

const MAX_INPUT_MB = MAX_INPUT_BYTES / (1024 * 1024);

export const schematicInputShape = {
  url: z
    .string()
    .optional()
    .describe(
      "A pastebin.com or gist.github.com URL, or a file URL returned by another Schematiclab tool. Give either url or base64.",
    ),
  base64: z
    .string()
    .optional()
    .describe(
      `The schematic file's bytes in base64 (at most ${MAX_INPUT_MB} MB decoded). Give either url or base64.`,
    ),
  filename: z
    .string()
    .optional()
    .describe(
      "The file's name, used to name outputs (the format is detected from the bytes). Required with base64.",
    ),
};

export interface SchematicInputArgs {
  url?: string;
  base64?: string;
  filename?: string;
}

export interface SchematicInput {
  bytes: Uint8Array;
  filename: string;
}

const NOT_ALLOWED =
  "Only pastebin.com and gist.github.com URLs, or file URLs returned by this server, are accepted.";

// Pathnames `publishFile` writes: `mcp/` plus a filename-safe name.
const OUTPUT_PATHNAME = /^mcp\/[A-Za-z0-9._-]+$/;

/** The host of a private store's blob URLs (the SDK drops a `store_` prefix). */
export function privateBlobHost(storeId: string): string {
  const id = storeId.trim().replace(/^store_/, "");
  return `${id}.private.blob.vercel-storage.com`.toLowerCase();
}

export async function resolveSchematicInput(
  args: SchematicInputArgs,
  deps: Pick<McpDeps, "fetch" | "blob" | "blobStoreId">,
): Promise<SchematicInput> {
  const hasUrl = args.url !== undefined && args.url !== "";
  const hasBase64 = args.base64 !== undefined && args.base64 !== "";
  if (hasUrl === hasBase64) {
    throw new Error("Give exactly one of url or base64.");
  }
  if (hasBase64) return decodeBase64Input(args.base64 ?? "", args.filename);
  return readUrlInput(args.url ?? "", deps);
}

function decodeBase64Input(
  base64: string,
  filename: string | undefined,
): SchematicInput {
  if (filename === undefined || filename.trim() === "") {
    throw new Error("filename is required with base64.");
  }
  const cleaned = base64
    .replace(/^data:[^,]*;base64,/, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) {
    throw new Error("base64 is not valid base64.");
  }
  if (Math.floor((cleaned.length * 3) / 4) > MAX_INPUT_BYTES + 2) {
    throw new Error(`The file is larger than the ${MAX_INPUT_MB} MB limit.`);
  }
  const bytes = new Uint8Array(Buffer.from(cleaned, "base64"));
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`The file is larger than the ${MAX_INPUT_MB} MB limit.`);
  }
  if (bytes.byteLength === 0) throw new Error("base64 is empty.");
  return { bytes, filename: filename.trim() };
}

async function readUrlInput(
  input: string,
  deps: Pick<McpDeps, "fetch" | "blob" | "blobStoreId">,
): Promise<SchematicInput> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("url doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("url must use https.");

  if (
    parsed.hostname === "pastebin.com" ||
    parsed.hostname === "gist.github.com"
  ) {
    return fetchImportUrl(normalizeImportUrl(input), deps.fetch);
  }

  const storeId = deps.blobStoreId?.trim();
  if (storeId && parsed.hostname === privateBlobHost(storeId)) {
    return readOwnBlob(parsed.pathname.slice(1), deps);
  }
  throw new Error(NOT_ALLOWED);
}

async function readOwnBlob(
  pathname: string,
  deps: Pick<McpDeps, "blob">,
): Promise<SchematicInput> {
  if (!OUTPUT_PATHNAME.test(pathname)) {
    throw new Error(
      `Only files this server wrote (under ${OUTPUT_PREFIX}) can be read from its Blob store.`,
    );
  }
  if (!deps.blob) {
    throw new Error("This server has no Blob store configured to read from.");
  }
  let found: Awaited<ReturnType<NonNullable<McpDeps["blob"]>["get"]>>;
  try {
    found = await deps.blob.get(pathname, { access: "private" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read the file from Blob storage: ${message}`);
  }
  if (found === null) {
    throw new Error(
      "That file no longer exists (output files are deleted after 24 hours).",
    );
  }
  if (found.size > MAX_INPUT_BYTES) {
    await found.stream.cancel();
    throw new Error(`The file is larger than the ${MAX_INPUT_MB} MB limit.`);
  }
  const bytes = await readCapped(found.stream, MAX_INPUT_BYTES);
  return { bytes, filename: pathname.slice(OUTPUT_PREFIX.length) };
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`The file is larger than the ${MAX_INPUT_MB} MB limit.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
