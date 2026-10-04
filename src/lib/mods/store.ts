// IndexedDB persistence for loaded CurseForge mods.
//
// Stores parsed output only (never the jar). Metadata and assets live in
// separate object stores so listing loaded mods doesn't pull every texture
// Blob into memory. One file per (CurseForge mod, Minecraft version): records
// are keyed `${modId}:${gameVersion}`, so `putLoadedMod` replaces only a file
// of the same mod for the same version.
//
// v2 adds the `namespaceMappings` store (see `mappings.ts`). It lives in this
// DB rather than a separate one so a single upgrade path covers everything.
//
// v3 deduplicates assets across files. Textures (PNG bytes), models and
// blockstates (canonical JSON) are stored once in the `blobs` store, keyed by
// kind + SHA-256; per-file `assets` records only hold those hashes. Blobs
// nobody references any more are deleted when a file is replaced or removed.
// The upgrade rekeys v1/v2 `mods` records by their first declared game
// version and parks their old assets in `legacyAssets`: hashing needs
// `crypto.subtle` and `Blob.arrayBuffer()`, which can't be awaited inside the
// versionchange transaction. `getDb` then converts parked records before
// handing out the connection. A record that fails to convert stays parked
// (and readable) and is retried on the next open.

import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from "idb";

import { forEachLimit } from "./for-each-limit";
import type { TemplateCube } from "../render/camo/shape-pack";
import type {
  LoadedModAssets,
  LoadedModMeta,
  NamespaceMapping,
  ProviderData,
} from "./types";

export const MODS_DB_NAME = "schematiclab-mods";
export const MODS_DB_VERSION = 3;

/** Per-file asset record: the `LoadedModAssets` shape with blob hashes. */
interface StoredModAssets {
  /** Block id → blob hash of its blockstate JSON. */
  blockstates: Record<string, string>;
  /** `<ns>:<path>` → blob hash of its model JSON. */
  models: Record<string, string>;
  /** `<ns>:<path>` → blob hash of its PNG. */
  textures: Record<string, string>;
  /** Small and rarely shared, so kept inline. */
  textureMeta: Record<string, unknown>;
  /** FramedBlocks templates, kept inline like `textureMeta`. */
  templates?: Record<string, TemplateCube[]>;
  /** Generated-block provider data, kept inline like `textureMeta`. */
  providerData?: ProviderData;
  /** Item ids, kept inline like `textureMeta`. */
  items?: string[];
}

interface ModsDB extends DBSchema {
  mods: {
    key: string;
    value: LoadedModMeta;
    indexes: { modId: number };
  };
  assets: {
    key: string;
    value: StoredModAssets;
  };
  /** Hash → PNG `Blob` or parsed JSON value. */
  blobs: {
    key: string;
    value: unknown;
  };
  /** Pre-v3 asset records awaiting conversion, keyed like `mods`. */
  legacyAssets: {
    key: string;
    value: LoadedModAssets;
  };
  namespaceMappings: {
    key: string;
    value: NamespaceMapping;
  };
}

const WRITE_STORES = ["mods", "assets", "blobs", "legacyAssets"] as const;

type WriteTx = IDBPTransaction<
  ModsDB,
  ("mods" | "assets" | "blobs" | "legacyAssets")[],
  "readwrite"
>;

let dbPromise: Promise<IDBPDatabase<ModsDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ModsDB>> {
  if (dbPromise === null) {
    dbPromise = (async () => {
      if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB is not available");
      }
      const db = await openDB<ModsDB>(MODS_DB_NAME, MODS_DB_VERSION, {
        async upgrade(db, oldVersion, _newVersion, tx) {
          if (oldVersion < 1) {
            const mods = db.createObjectStore("mods", { keyPath: "key" });
            mods.createIndex("modId", "modId");
            db.createObjectStore("assets");
          }
          if (oldVersion < 2) {
            db.createObjectStore("namespaceMappings", { keyPath: "namespace" });
          }
          if (oldVersion < 3) {
            db.createObjectStore("blobs");
            db.createObjectStore("legacyAssets");
            // Only IDB requests may be awaited here, or the upgrade
            // transaction auto-commits.
            await rekeyLegacyMods(tx);
          }
        },
      });
      await convertLegacyAssets(db);
      return db;
    })();
    // Don't cache a failed open — a later call may succeed (e.g. after the
    // user unblocks storage). The rejection still reaches the first caller.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** The game version assigned to a pre-v3 record: its first declared one. */
function legacyGameVersion(meta: LoadedModMeta): string {
  return meta.gameVersions[0] ?? "unknown";
}

// v1/v2 kept one file per mod, keyed `${modId}:${fileId}`, with its full
// assets inline. Rekey each by (modId, gameVersion) and park its assets.
async function rekeyLegacyMods(
  tx: IDBPTransaction<
    ModsDB,
    ("mods" | "assets" | "blobs" | "legacyAssets" | "namespaceMappings")[],
    "versionchange"
  >,
): Promise<void> {
  const mods = tx.objectStore("mods");
  // Typed as the v3 shape, but v1/v2 records hold full `LoadedModAssets`.
  const assets = tx.objectStore("assets");
  const legacy = tx.objectStore("legacyAssets");
  const metas = await mods.getAll();
  const oldAssets = await Promise.all(
    metas.map(
      (meta) => assets.get(meta.key) as Promise<LoadedModAssets | undefined>,
    ),
  );
  await mods.clear();
  await assets.clear();
  for (const [i, meta] of metas.entries()) {
    const gameVersion = legacyGameVersion(meta);
    const key = `${meta.modId}:${gameVersion}`;
    await mods.put({ ...meta, key, gameVersion });
    const old = oldAssets[i];
    if (old !== undefined) await legacy.put(old, key);
  }
}

async function convertLegacyAssets(db: IDBPDatabase<ModsDB>): Promise<void> {
  const keys = await db.getAllKeys("legacyAssets");
  for (const key of keys) {
    try {
      const legacy = await db.get("legacyAssets", key);
      if (legacy === undefined) continue;
      const hashed = await hashAssets(legacy);
      const tx = db.transaction([...WRITE_STORES], "readwrite");
      await writeAssets(tx, key, hashed);
      await tx.done;
    } catch (error) {
      console.warn("Could not convert stored assets for mod %s.", key, error);
    }
  }
}

/**
 * JSON with object keys sorted at every level, so equal values serialize
 * (and hash) identically regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]]),
    );
  });
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

interface HashedAssets {
  record: StoredModAssets;
  /** Hash → value for every blob `record` references. */
  blobs: Map<string, unknown>;
}

// Textures hashed at once; each holds its bytes in memory until hashed.
const HASH_CONCURRENCY = 8;

async function hashAssets(assets: LoadedModAssets): Promise<HashedAssets> {
  const blobs = new Map<string, unknown>();
  const encoder = new TextEncoder();
  const hashJson = async (
    entries: Record<string, unknown>,
  ): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    await Promise.all(
      Object.entries(entries).map(async ([id, value]) => {
        const hash = `json:${await sha256Hex(encoder.encode(canonicalJson(value)))}`;
        out[id] = hash;
        blobs.set(hash, value);
      }),
    );
    return out;
  };
  const textures: Record<string, string> = {};
  await forEachLimit(
    Object.entries(assets.textures),
    HASH_CONCURRENCY,
    async ([id, blob]) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hash = `png:${await sha256Hex(bytes)}`;
      textures[id] = hash;
      blobs.set(hash, blob);
    },
  );
  return {
    record: {
      blockstates: await hashJson(assets.blockstates),
      models: await hashJson(assets.models),
      textures,
      textureMeta: assets.textureMeta,
      ...(assets.templates ? { templates: assets.templates } : {}),
      ...(assets.providerData ? { providerData: assets.providerData } : {}),
      ...(assets.items ? { items: assets.items } : {}),
    },
    blobs,
  };
}

function referencedHashes(record: StoredModAssets): Set<string> {
  return new Set([
    ...Object.values(record.blockstates),
    ...Object.values(record.models),
    ...Object.values(record.textures),
  ]);
}

// Delete each of `candidates` that no remaining asset record references.
async function collectGarbage(
  tx: WriteTx,
  candidates: Iterable<string>,
): Promise<void> {
  const pending = new Set(candidates);
  if (pending.size === 0) return;
  for (const record of await tx.objectStore("assets").getAll()) {
    for (const hash of referencedHashes(record)) pending.delete(hash);
  }
  const blobs = tx.objectStore("blobs");
  await Promise.all([...pending].map((hash) => blobs.delete(hash)));
}

// Replace the asset record at `key`, adding missing blobs and dropping blobs
// only the previous record referenced.
async function writeAssets(
  tx: WriteTx,
  key: string,
  hashed: HashedAssets,
): Promise<void> {
  const assets = tx.objectStore("assets");
  const blobs = tx.objectStore("blobs");
  const previous = await assets.get(key);
  await Promise.all(
    [...hashed.blobs].map(async ([hash, value]) => {
      if ((await blobs.getKey(hash)) === undefined) {
        await blobs.put(value, hash);
      }
    }),
  );
  await assets.put(hashed.record, key);
  await tx.objectStore("legacyAssets").delete(key);
  if (previous !== undefined) {
    const kept = referencedHashes(hashed.record);
    await collectGarbage(
      tx,
      [...referencedHashes(previous)].filter((hash) => !kept.has(hash)),
    );
  }
}

/** All loaded mod files, oldest first. */
export async function listLoadedMods(): Promise<LoadedModMeta[]> {
  const db = await getDb();
  const mods = await db.getAll("mods");
  return mods.sort((a, b) => a.loadedAt - b.loadedAt);
}

export async function getModAssets(
  key: string,
): Promise<LoadedModAssets | null> {
  const db = await getDb();
  const tx = db.transaction(["assets", "blobs", "legacyAssets"], "readonly");
  const record = await tx.objectStore("assets").get(key);
  if (record === undefined) {
    const legacy = await tx.objectStore("legacyAssets").get(key);
    await tx.done;
    return legacy ?? null;
  }
  const blobs = tx.objectStore("blobs");
  const missing: string[] = [];
  const resolve = async <T>(
    hashes: Record<string, string>,
  ): Promise<Record<string, T>> => {
    const out: Record<string, T> = {};
    await Promise.all(
      Object.entries(hashes).map(async ([id, hash]) => {
        const value = await blobs.get(hash);
        if (value !== undefined) out[id] = value as T;
        else missing.push(hash);
      }),
    );
    return out;
  };
  const [blockstates, models, textures] = await Promise.all([
    resolve<unknown>(record.blockstates),
    resolve<unknown>(record.models),
    resolve<Blob>(record.textures),
  ]);
  await tx.done;
  if (missing.length > 0) {
    console.warn(
      `Stored assets for mod ${key} reference missing blobs: ${[...new Set(missing)].join(", ")}`,
    );
  }
  return {
    blockstates,
    models,
    textures,
    textureMeta: record.textureMeta,
    ...(record.templates ? { templates: record.templates } : {}),
    ...(record.providerData ? { providerData: record.providerData } : {}),
    ...(record.items ? { items: record.items } : {}),
  };
}

/**
 * Persist a loaded mod file, replacing the file of the same mod for the same
 * game version (files for other versions are kept).
 */
export async function putLoadedMod(
  meta: LoadedModMeta,
  assets: LoadedModAssets,
): Promise<void> {
  const hashed = await hashAssets(assets);
  const db = await getDb();
  const tx = db.transaction([...WRITE_STORES], "readwrite");
  await tx.objectStore("mods").put(meta);
  await writeAssets(tx, meta.key, hashed);
  await tx.done;
}

/**
 * Replace a stored file's metadata, keeping its assets. No-op when the file
 * is no longer stored (it was removed meanwhile).
 */
export async function updateLoadedModMeta(meta: LoadedModMeta): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("mods", "readwrite");
  const mods = tx.objectStore("mods");
  if ((await mods.get(meta.key)) !== undefined) await mods.put(meta);
  await tx.done;
}

/** Delete a mod file and every blob no other file references. */
export async function removeLoadedMod(key: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([...WRITE_STORES], "readwrite");
  const assets = tx.objectStore("assets");
  const previous = await assets.get(key);
  await tx.objectStore("mods").delete(key);
  await assets.delete(key);
  await tx.objectStore("legacyAssets").delete(key);
  if (previous !== undefined) {
    await collectGarbage(tx, referencedHashes(previous));
  }
  await tx.done;
}

/** Delete every mod file and all blobs. Namespace mappings are kept. */
export async function removeAllLoadedMods(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([...WRITE_STORES], "readwrite");
  await Promise.all(WRITE_STORES.map((name) => tx.objectStore(name).clear()));
  await tx.done;
}

/** All persisted namespace → CurseForge project mappings. */
export async function listNamespaceMappings(): Promise<NamespaceMapping[]> {
  const db = await getDb();
  return db.getAll("namespaceMappings");
}

export async function putNamespaceMapping(
  mapping: NamespaceMapping,
): Promise<void> {
  const db = await getDb();
  await db.put("namespaceMappings", mapping);
}

export async function removeNamespaceMapping(namespace: string): Promise<void> {
  const db = await getDb();
  await db.delete("namespaceMappings", namespace);
}

// Test-only: every stored blob hash.
export async function __listBlobKeysForTests(): Promise<string[]> {
  const db = await getDb();
  return db.getAllKeys("blobs");
}

// Test-only: close and forget the cached connection.
export async function __resetModStoreForTests(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (pending === null) return;
  try {
    (await pending).close();
  } catch {
    // Open failed; nothing to close.
  }
}
