// Reads uploaded modpack data from the private Blob store: resolves a
// modpack reference against `modpacks/index.json` and loads a version's
// `pack.json.gz`. Both are cached in memory per server instance (best
// effort), like block data (`blockdata/load.ts`): a pack version is read once
// per cold start, the index at most once a minute so new uploads show up.

import { Gunzip, gzipSync } from "fflate";
import type { z } from "zod";
import type { BlobClient } from "../mcp/blob.ts";
import { modpackDataPath, modpackIndexPath } from "./paths.ts";
import { parseModpackRef } from "./ref.ts";
import {
  MODPACK_FORMAT_VERSION,
  modpackDataSchema,
  modpackIndexSchema,
  type ModpackData,
  type ModpackIndex,
  type ModpackIndexEntry,
  type ModpackIndexVersion,
} from "./schema.ts";

/** Same budget as a block data fetch. */
export const MODPACK_READ_TIMEOUT_MS = 10_000;
export const MAX_MODPACK_INDEX_BYTES = 4 * 1024 * 1024;
export const MAX_MODPACK_GZIP_BYTES = 64 * 1024 * 1024;
export const MAX_MODPACK_JSON_BYTES = 512 * 1024 * 1024;
export const MODPACK_INDEX_CACHE_MS = 60_000;

export interface ResolvedModpack {
  pack: ModpackIndexEntry;
  version: ModpackIndexVersion;
}

let indexCache: { at: number; index: Promise<ModpackIndex> } | null = null;
// Pack data per pathname and upload time, so a re-upload isn't served stale.
const packCache = new Map<string, Promise<ModpackData>>();

export function clearModpackCache(): void {
  indexCache = null;
  packCache.clear();
}

export function unknownModpackMessage(ref: string): string {
  return `Unknown modpack '${ref}'. Call list_modpacks for the uploaded packs.`;
}

/** The uploaded packs; an empty index when nothing was uploaded yet. */
export function loadModpackIndex(
  blob: BlobClient,
  now: () => number = Date.now,
): Promise<ModpackIndex> {
  const at = now();
  if (indexCache && at - indexCache.at < MODPACK_INDEX_CACHE_MS) {
    return indexCache.index;
  }
  const index = readIndex(blob);
  const entry = { at, index };
  indexCache = entry;
  index.catch(() => {
    if (indexCache === entry) indexCache = null;
  });
  return index;
}

async function readIndex(blob: BlobClient): Promise<ModpackIndex> {
  const bytes = await readBlob(
    blob,
    modpackIndexPath(),
    MAX_MODPACK_INDEX_BYTES,
  );
  if (bytes === null)
    return { formatVersion: MODPACK_FORMAT_VERSION, packs: [] };
  return validate(
    "modpacks/index.json",
    modpackIndexSchema,
    parseJson("modpacks/index.json", bytes),
  );
}

/**
 * Resolves `<slug>` to the pack's latest upload, or `<slug>@<version>` to the
 * version whose pack file id or display version matches.
 */
export async function resolveModpack(
  ref: string,
  blob: BlobClient,
): Promise<ResolvedModpack> {
  const { slug, version } = parseModpackRef(ref);
  const index = await loadModpackIndex(blob);
  const pack = index.packs.find((p) => p.slug === slug);
  const match = pack && pickVersion(pack.versions, version);
  if (!pack || !match) throw new Error(unknownModpackMessage(ref.trim()));
  return { pack, version: match };
}

function pickVersion(
  versions: ModpackIndexVersion[],
  wanted: string | null,
): ModpackIndexVersion | undefined {
  if (wanted === null) {
    let latest: ModpackIndexVersion | undefined;
    for (const v of versions) {
      if (!latest || Date.parse(v.uploadedAt) > Date.parse(latest.uploadedAt))
        latest = v;
    }
    return latest;
  }
  // A file id wins over a display version that happens to be digits; among
  // several uploads of one display version the newest wins.
  const byFileId = versions.find((v) => String(v.packFileId) === wanted);
  if (byFileId) return byFileId;
  return pickVersion(
    versions.filter((v) => v.displayVersion === wanted),
    null,
  );
}

/** Reads, gunzips and validates a resolved version's `pack.json.gz`. */
export function loadModpack(
  resolved: ResolvedModpack,
  blob: BlobClient,
): Promise<ModpackData> {
  const path = modpackDataPath(resolved.pack.slug, resolved.version.key);
  const key = `${path}@${resolved.version.uploadedAt}`;
  let data = packCache.get(key);
  if (!data) {
    data = readPack(path, blob);
    packCache.set(key, data);
    data.catch(() => {
      if (packCache.get(key) === data) packCache.delete(key);
    });
  }
  return data;
}

async function readPack(path: string, blob: BlobClient): Promise<ModpackData> {
  const gzipped = await readBlob(blob, path, MAX_MODPACK_GZIP_BYTES);
  if (gzipped === null) {
    throw new Error(`Modpack data ${path} is missing from Blob storage.`);
  }
  let json: Uint8Array;
  try {
    // fflate's streaming Gunzip yields nothing for non-gzip input.
    if (gzipped[0] !== 0x1f || gzipped[1] !== 0x8b) {
      throw new Error("not gzip data");
    }
    json = gunzipCapped(gzipped, MAX_MODPACK_JSON_BYTES);
  } catch (err) {
    throw new Error(
      `Modpack data ${path} could not be gunzipped: ${message(err)}`,
    );
  }
  return validate(path, modpackDataSchema, parseJson(path, json));
}

/** A pack version as `pack.json.gz` stores it, validated first. */
export function encodeModpackData(data: ModpackData): Uint8Array {
  const valid = validate("pack.json.gz", modpackDataSchema, data);
  return gzipSync(new TextEncoder().encode(JSON.stringify(valid)));
}

function parseJson(path: string, bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${message(err)}`);
  }
}

function validate<T>(path: string, schema: z.ZodType<T>, value: unknown): T {
  const formatVersion =
    typeof value === "object" && value !== null
      ? (value as { formatVersion?: unknown }).formatVersion
      : undefined;
  if (formatVersion !== MODPACK_FORMAT_VERSION) {
    throw new Error(
      `${path} has format version ${JSON.stringify(formatVersion)}, but this server reads version ${MODPACK_FORMAT_VERSION}. Re-upload the modpack with the matching CLI.`,
    );
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.map(String).join(".") || "(root)";
    throw new Error(`${path} is invalid at ${where}: ${issue.message}`);
  }
  return result.data;
}

/** A private blob's bytes, null when it doesn't exist; capped and timed. */
async function readBlob(
  blob: BlobClient,
  pathname: string,
  maxBytes: number,
): Promise<Uint8Array | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stream: ReadableStream<Uint8Array> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void stream?.cancel().catch(() => {});
      reject(
        new Error(
          `Reading ${pathname} from Blob storage took longer than ${MODPACK_READ_TIMEOUT_MS / 1000} s.`,
        ),
      );
    }, MODPACK_READ_TIMEOUT_MS);
  });
  const read = async (): Promise<Uint8Array | null> => {
    let found: Awaited<ReturnType<BlobClient["get"]>>;
    try {
      found = await blob.get(pathname, { access: "private" });
    } catch (err) {
      throw new Error(
        `Could not read ${pathname} from Blob storage: ${message(err)}`,
      );
    }
    if (found === null) return null;
    stream = found.stream;
    if (found.size > maxBytes) {
      await found.stream.cancel();
      throw new Error(`${pathname} is larger than ${maxBytes} bytes.`);
    }
    return readCapped(found.stream, pathname, maxBytes);
  };
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  pathname: string,
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
      throw new Error(`${pathname} is larger than ${limit} bytes.`);
    }
    chunks.push(value);
  }
  return concat(chunks, total);
}

// `schemlib/nbt.ts` has one too, but node's strip-types can't load that
// file, and the upload CLI loads this one.
function gunzipCapped(bytes: Uint8Array, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Gunzip((chunk) => {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`it inflates to more than ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  });
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    const end = Math.min(offset + 64 * 1024, bytes.length);
    stream.push(bytes.subarray(offset, end), end === bytes.length);
  }
  return concat(chunks, total);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
