// IndexedDB persistence for loaded CurseForge mods.
//
// Stores parsed output only (never the jar). Metadata and assets live in
// separate object stores so listing loaded mods doesn't pull every texture
// Blob into memory. One active file per CurseForge mod: `putLoadedMod`
// deletes any other file of the same mod in the same transaction.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { LoadedModAssets, LoadedModMeta } from "./types";

export const MODS_DB_NAME = "schematiclab-mods";
export const MODS_DB_VERSION = 1;

interface ModsDB extends DBSchema {
  mods: {
    key: string;
    value: LoadedModMeta;
    indexes: { modId: number };
  };
  assets: {
    key: string;
    value: LoadedModAssets;
  };
}

let dbPromise: Promise<IDBPDatabase<ModsDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ModsDB>> {
  if (dbPromise === null) {
    dbPromise = (async () => {
      if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB is not available");
      }
      return openDB<ModsDB>(MODS_DB_NAME, MODS_DB_VERSION, {
        upgrade(db) {
          const mods = db.createObjectStore("mods", { keyPath: "key" });
          mods.createIndex("modId", "modId");
          db.createObjectStore("assets");
        },
      });
    })();
    // Don't cache a failed open — a later call may succeed (e.g. after the
    // user unblocks storage). The rejection still reaches the first caller.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** All loaded mods, oldest first. */
export async function listLoadedMods(): Promise<LoadedModMeta[]> {
  const db = await getDb();
  const mods = await db.getAll("mods");
  return mods.sort((a, b) => a.loadedAt - b.loadedAt);
}

export async function getModAssets(
  key: string,
): Promise<LoadedModAssets | null> {
  const db = await getDb();
  return (await db.get("assets", key)) ?? null;
}

/**
 * Persist a loaded mod file, replacing any other file of the same mod.
 * Resolves to the keys of the replaced records.
 */
export async function putLoadedMod(
  meta: LoadedModMeta,
  assets: LoadedModAssets,
): Promise<string[]> {
  const db = await getDb();
  const tx = db.transaction(["mods", "assets"], "readwrite");
  const mods = tx.objectStore("mods");
  const assetStore = tx.objectStore("assets");
  const existing = await mods.index("modId").getAllKeys(meta.modId);
  const replaced = existing.filter((key) => key !== meta.key);
  for (const key of replaced) {
    await mods.delete(key);
    await assetStore.delete(key);
  }
  await mods.put(meta);
  await assetStore.put(assets, meta.key);
  await tx.done;
  return replaced;
}

export async function removeLoadedMod(key: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["mods", "assets"], "readwrite");
  await tx.objectStore("mods").delete(key);
  await tx.objectStore("assets").delete(key);
  await tx.done;
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
