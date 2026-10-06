// Writes an extracted pack where the MCP server reads it: each mod file's
// `swatches.png` (skipped when already stored, since mod files are shared
// between packs), the version's `pack.json.gz`, and last the updated
// `modpacks/index.json`, so the index never names data that isn't there.
// The store is the private Vercel Blob store, or a folder for `--dry-run`.
//
// Node only. Imports carry their `.ts` extension so node's strip-types can
// load it.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { BlobNotFoundError, head, put } from "@vercel/blob";

import { blobCredentialsConfigured, vercelBlobClient } from "../mcp/blob.ts";
import type { ModpackExtraction } from "./extract.ts";
import {
  modFileSwatchesPath,
  modpackDataPath,
  modpackIndexPath,
} from "./paths.ts";
import {
  clearModpackCache,
  encodeModpackData,
  loadModpackIndex,
} from "./reader.ts";
import {
  MODPACK_FORMAT_VERSION,
  modpackIndexSchema,
  type ModpackData,
  type ModpackIndex,
  type ModStatus,
} from "./schema.ts";

export interface ModpackStore {
  /** Where the store writes, for messages (`Vercel Blob`, a folder). */
  description: string;
  /** The current index; an empty one when nothing was uploaded yet. */
  readIndex(): Promise<ModpackIndex>;
  exists(pathname: string): Promise<boolean>;
  /** Writes (or overwrites) `pathname`. */
  write(pathname: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface PublishResult {
  bytesWritten: number;
  swatchesWritten: number;
  swatchesSkipped: number;
}

/**
 * `index` with `data`'s pack version added, replacing an earlier upload of
 * the same version key. Other packs and versions are kept as they are.
 */
export function mergeModpackIndex(
  index: ModpackIndex,
  data: ModpackData,
): ModpackIndex {
  const packs = index.packs.filter((p) => p.slug !== data.slug);
  const existing = index.packs.find((p) => p.slug === data.slug);
  packs.push({
    slug: data.slug,
    name: data.name,
    curseForgeProjectId:
      data.curseForgeProjectId ?? existing?.curseForgeProjectId ?? null,
    versions: [
      ...(existing?.versions ?? []).filter((v) => v.key !== data.version.key),
      data.version,
    ],
  });
  packs.sort((a, b) => a.slug.localeCompare(b.slug));
  return { formatVersion: MODPACK_FORMAT_VERSION, packs };
}

export async function publishModpack(
  store: ModpackStore,
  extraction: ModpackExtraction,
): Promise<PublishResult> {
  const { data, swatches } = extraction;
  // Read first: an unreadable index stops the upload before anything is written.
  const index = await store.readIndex();
  const result: PublishResult = {
    bytesWritten: 0,
    swatchesWritten: 0,
    swatchesSkipped: 0,
  };
  const write = async (
    pathname: string,
    body: Uint8Array,
    contentType: string,
  ) => {
    await store.write(pathname, body, contentType);
    result.bytesWritten += body.byteLength;
  };

  for (const [key, png] of swatches) {
    const pathname = modFileSwatchesPath(key);
    if (await store.exists(pathname)) {
      result.swatchesSkipped += 1;
      continue;
    }
    await write(pathname, png, "image/png");
    result.swatchesWritten += 1;
  }
  await write(
    modpackDataPath(data.slug, data.version.key),
    encodeModpackData(data),
    "application/gzip",
  );
  const merged = mergeModpackIndex(index, data);
  await write(
    modpackIndexPath(),
    new TextEncoder().encode(`${JSON.stringify(merged, null, 2)}\n`),
    "application/json",
  );
  return result;
}

/** A folder laid out like the Blob store, for `--dry-run --out <dir>`. */
export function directoryModpackStore(root: string): ModpackStore {
  const file = (pathname: string) => path.join(root, ...pathname.split("/"));
  return {
    description: root,
    async readIndex() {
      const indexFile = file(modpackIndexPath());
      if (!existsSync(indexFile)) {
        return { formatVersion: MODPACK_FORMAT_VERSION, packs: [] };
      }
      return modpackIndexSchema.parse(
        JSON.parse(await readFile(indexFile, "utf8")),
      );
    },
    exists: async (pathname) => existsSync(file(pathname)),
    async write(pathname, body) {
      await mkdir(path.dirname(file(pathname)), { recursive: true });
      await writeFile(file(pathname), body);
    },
  };
}

/** Message for a missing Blob credential. */
export const MISSING_BLOB_CREDENTIALS =
  "Vercel Blob credentials are missing (BLOB_STORE_ID with VERCEL_OIDC_TOKEN or BLOB_READ_WRITE_TOKEN). Run `vercel env pull .env.local` (pull again when the OIDC token expires), or use --dry-run --out <dir>.";

/**
 * Whether the environment can write to the Blob store: the store id the MCP
 * server needs (`blobCredentialsConfigured`) plus a token the SDK can use.
 */
export function blobUploadCredentialsConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return (
    blobCredentialsConfigured(env) &&
    Boolean(env.VERCEL_OIDC_TOKEN?.trim() || env.BLOB_READ_WRITE_TOKEN?.trim())
  );
}

/**
 * The private Vercel Blob store. Credentials come from the environment, as
 * for the MCP server (`lib/mcp/blob.ts`): the SDK resolves them itself.
 */
export function blobModpackStore(): ModpackStore {
  return {
    description: "Vercel Blob",
    readIndex() {
      clearModpackCache();
      return loadModpackIndex(vercelBlobClient);
    },
    async exists(pathname) {
      try {
        await head(pathname);
        return true;
      } catch (err) {
        if (err instanceof BlobNotFoundError) return false;
        throw err;
      }
    },
    async write(pathname, body, contentType) {
      await put(
        pathname,
        Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType,
        },
      );
    },
  };
}

/** Mod count per status, every status listed. */
export function countModStatuses(data: ModpackData): Record<ModStatus, number> {
  const counts: Record<ModStatus, number> = {
    ok: 0,
    "no-blocks": 0,
    "skipped-undistributable": 0,
    "skipped-too-large": 0,
    failed: 0,
  };
  for (const mod of data.mods) counts[mod.status] += 1;
  return counts;
}
