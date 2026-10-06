// Writes an extracted pack where the MCP server reads it: each mod file's
// `swatches.png` (skipped when already stored, since mod files are shared
// between packs), the version's `pack.json.gz`, and last the updated
// `modpacks/index.json`, so the index never names data that isn't there.
// The index is read from origin (past the CDN cache) and written back with
// `ifMatch` on the ETag read, so two uploads in a row can't roll back or
// drop each other's entries: on a conflict the upload re-reads and re-merges.
// The store is the private Vercel Blob store, or a folder for `--dry-run`.
//
// Node only. Imports carry their `.ts` extension so node's strip-types can
// load it.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  head,
  put,
} from "@vercel/blob";

import {
  blobCredentialsConfigured,
  vercelBlobClient,
  type BlobClient,
} from "../mcp/blob.ts";
import { BLOCK_LIST_MOD_KEY } from "./block-list.ts";
import type { ModpackExtraction } from "./extract.ts";
import {
  modFileSwatchesPath,
  modpackDataPath,
  modpackIndexPath,
} from "./paths.ts";
import { encodeModpackData, readModpackIndexFromOrigin } from "./reader.ts";
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
  /**
   * The latest index and its version tag (null when nothing was uploaded
   * yet); an empty index then.
   */
  readIndex(): Promise<StoredModpackIndex>;
  exists(pathname: string): Promise<boolean>;
  /** Writes (or overwrites) `pathname`. */
  write(pathname: string, body: Uint8Array, contentType: string): Promise<void>;
  /**
   * Writes the index only if it is still the one `readIndex` returned with
   * `etag` (none stored when `etag` is null); else throws
   * `BlobPreconditionFailedError`.
   */
  writeIndex(body: Uint8Array, etag: string | null): Promise<void>;
}

export interface StoredModpackIndex {
  index: ModpackIndex;
  etag: string | null;
}

/** Index writes tried before an upload gives up on a busy index. */
export const MAX_INDEX_WRITE_ATTEMPTS = 3;

export const INDEX_CONFLICT_MESSAGE = `Another upload changed ${modpackIndexPath()} ${MAX_INDEX_WRITE_ATTEMPTS} times while this one tried to add its version. The pack data is written; run the upload again to add it to the index.`;

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
  let stored = await store.readIndex();
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
  // Merge into the index as it is now, and only write it if no other upload
  // changed it since; on a conflict re-read and merge again.
  for (let attempt = 1; ; attempt++) {
    const merged = mergeModpackIndex(stored.index, data);
    const body = new TextEncoder().encode(
      `${JSON.stringify(merged, null, 2)}\n`,
    );
    try {
      await store.writeIndex(body, stored.etag);
      result.bytesWritten += body.byteLength;
      return result;
    } catch (err) {
      if (!(err instanceof BlobPreconditionFailedError)) throw err;
      if (attempt >= MAX_INDEX_WRITE_ATTEMPTS) {
        throw new Error(INDEX_CONFLICT_MESSAGE, { cause: err });
      }
    }
    stored = await store.readIndex();
  }
}

/** A folder laid out like the Blob store, for `--dry-run --out <dir>`. */
export function directoryModpackStore(root: string): ModpackStore {
  const file = (pathname: string) => path.join(root, ...pathname.split("/"));
  const write = async (pathname: string, body: Uint8Array) => {
    await mkdir(path.dirname(file(pathname)), { recursive: true });
    await writeFile(file(pathname), body);
  };
  return {
    description: root,
    async readIndex() {
      const indexFile = file(modpackIndexPath());
      if (!existsSync(indexFile)) {
        return {
          index: { formatVersion: MODPACK_FORMAT_VERSION, packs: [] },
          etag: null,
        };
      }
      return {
        index: modpackIndexSchema.parse(
          JSON.parse(await readFile(indexFile, "utf8")),
        ),
        etag: null,
      };
    },
    exists: async (pathname) => existsSync(file(pathname)),
    write,
    // A dry run is the only writer of its folder: no conflicts to check.
    writeIndex: (body) => write(modpackIndexPath(), body),
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

/** The slice of the Vercel Blob SDK the upload uses, so tests inject a fake. */
export interface ModpackBlobApi {
  get: BlobClient["get"];
  /** Whether `pathname` is stored. */
  exists(pathname: string): Promise<boolean>;
  /**
   * Writes `pathname`: over anything stored when `allowOverwrite`, only over
   * the blob with ETag `ifMatch` when given (`BlobPreconditionFailedError`
   * otherwise), and only when nothing is stored when neither is set.
   */
  put(
    pathname: string,
    body: Uint8Array,
    options: { contentType: string; allowOverwrite?: true; ifMatch?: string },
  ): Promise<void>;
}

export const vercelModpackBlobApi: ModpackBlobApi = {
  get: vercelBlobClient.get,
  async exists(pathname) {
    try {
      await head(pathname);
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  },
  async put(pathname, body, options) {
    await put(
      pathname,
      Buffer.from(body.buffer, body.byteOffset, body.byteLength),
      {
        access: "private",
        addRandomSuffix: false,
        contentType: options.contentType,
        ...(options.ifMatch !== undefined
          ? { ifMatch: options.ifMatch }
          : { allowOverwrite: options.allowOverwrite ?? false }),
      },
    );
  },
};

/**
 * The private Vercel Blob store. Credentials come from the environment, as
 * for the MCP server (`lib/mcp/blob.ts`): the SDK resolves them itself.
 */
export function blobModpackStore(
  api: ModpackBlobApi = vercelModpackBlobApi,
): ModpackStore {
  return {
    description: "Vercel Blob",
    // From origin: the CDN cache can serve the index an earlier upload
    // replaced for about a minute.
    readIndex: () => readModpackIndexFromOrigin(api),
    exists: (pathname) => api.exists(pathname),
    write: (pathname, body, contentType) =>
      api.put(pathname, body, { contentType, allowOverwrite: true }),
    async writeIndex(body, etag) {
      const pathname = modpackIndexPath();
      const contentType = "application/json";
      if (etag !== null) {
        await api.put(pathname, body, { contentType, ifMatch: etag });
        return;
      }
      try {
        await api.put(pathname, body, { contentType });
      } catch (err) {
        // Writing a new blob fails when one appeared since the read: the
        // same conflict as a stale ETag.
        if (!(err instanceof BlobPreconditionFailedError)) {
          if (await api.exists(pathname).catch(() => false)) {
            throw new BlobPreconditionFailedError();
          }
        }
        throw err;
      }
    },
  };
}

/**
 * Mod count per status, every status listed. The block list's synthetic mod
 * (`block-list`) isn't one of the pack's mods.
 */
export function countModStatuses(data: ModpackData): Record<ModStatus, number> {
  const counts: Record<ModStatus, number> = {
    ok: 0,
    "no-blocks": 0,
    "skipped-undistributable": 0,
    "skipped-too-large": 0,
    failed: 0,
  };
  for (const mod of data.mods) {
    if (mod.key !== BLOCK_LIST_MOD_KEY) counts[mod.status] += 1;
  }
  return counts;
}
