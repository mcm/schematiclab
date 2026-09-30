// Reactive in-memory registry of loaded CurseForge mods.
//
// Module-level state subscribed via `useSyncExternalStore`. Hydrates from the
// IndexedDB store once, on first access in the browser. If IndexedDB is
// unavailable (private mode, blocked storage) the registry keeps working
// in-memory only for the session and logs a single `console.warn`.
//
// The snapshot is an immutable array whose identity changes only when the set
// of loaded mods changes. Derived lookups (block ids, namespaces) are cached
// per snapshot.

import * as React from "react";

import * as store from "./store";
import type { LoadedModAssets, LoadedModMeta, ModBlock } from "./types";

export type LoadedModsSnapshot = readonly LoadedModMeta[];

export interface ModForBlock {
  key: string;
  modName: string;
}

interface Derived {
  blockIds: ReadonlySet<string>;
  blockToMod: ReadonlyMap<string, ModForBlock>;
  blocks: ReadonlyMap<string, ModBlock>;
  namespaces: ReadonlySet<string>;
}

const EMPTY: LoadedModsSnapshot = Object.freeze([]);

let mods: LoadedModsSnapshot = EMPTY;
let derived: { for: LoadedModsSnapshot; value: Derived } | null = null;
const listeners = new Set<() => void>();
// Assets for mods added this session. Serves reads while persistence is
// unavailable (and saves an IndexedDB round-trip otherwise).
const assetCache = new Map<string, LoadedModAssets>();
// Keys removed before hydration finished, so a slow hydrate can't resurrect them.
const removedKeys = new Set<string>();

let hydration: Promise<void> | null = null;
let persistenceDisabled = false;

function emit(next: LoadedModsSnapshot): void {
  if (next === mods) return;
  mods = next;
  listeners.forEach((listener) => {
    listener();
  });
}

function disablePersistence(error: unknown): void {
  if (persistenceDisabled) return;
  persistenceDisabled = true;
  console.warn(
    "Loaded mods will not persist: IndexedDB is unavailable. Mods stay loaded for this session only.",
    error,
  );
}

/** Merge `incoming` into `base`, keeping one file per CurseForge mod. */
function withMod(
  base: LoadedModsSnapshot,
  incoming: LoadedModMeta,
): LoadedModMeta[] {
  return [...base.filter((mod) => mod.modId !== incoming.modId), incoming];
}

function autoHydrate(): void {
  if (hydration === null && typeof window !== "undefined") {
    void hydrateLoadedMods();
  }
}

/**
 * Load persisted mods into the registry. Idempotent: runs once and resolves
 * the same promise on later calls. Never rejects.
 */
export function hydrateLoadedMods(): Promise<void> {
  if (hydration === null) {
    hydration = (async () => {
      let stored: LoadedModMeta[];
      try {
        stored = await store.listLoadedMods();
      } catch (error) {
        disablePersistence(error);
        return;
      }
      // Mods added during hydration win over stored files of the same mod.
      const sessionModIds = new Set(mods.map((mod) => mod.modId));
      const restored = stored.filter(
        (mod) => !removedKeys.has(mod.key) && !sessionModIds.has(mod.modId),
      );
      if (restored.length > 0) emit(Object.freeze([...restored, ...mods]));
    })();
  }
  return hydration;
}

export function subscribe(listener: () => void): () => void {
  autoHydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): LoadedModsSnapshot {
  autoHydrate();
  return mods;
}

function getServerSnapshot(): LoadedModsSnapshot {
  return EMPTY;
}

export function useLoadedMods(): LoadedModsSnapshot {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Register a loaded mod file and persist it. Replaces any loaded file of the
 * same CurseForge mod. Resolves once persisted (or immediately when running
 * in-memory only); persistence failures fall back to in-memory with a warning.
 */
export function addLoadedMod(
  meta: LoadedModMeta,
  assets: LoadedModAssets,
): Promise<void> {
  return addLoadedMods([{ meta, assets }]);
}

/**
 * `addLoadedMod` for many files at once: the registry changes (and
 * subscribers, like the 3D preview's atlas rebuild, run) once for the whole
 * batch. Later entries win over earlier ones for the same CurseForge mod.
 */
export async function addLoadedMods(
  entries: readonly { meta: LoadedModMeta; assets: LoadedModAssets }[],
): Promise<void> {
  if (entries.length === 0) return;
  let next: LoadedModMeta[] = [...mods];
  for (const { meta, assets } of entries) {
    for (const mod of next) {
      if (mod.modId === meta.modId && mod.key !== meta.key) {
        assetCache.delete(mod.key);
        removedKeys.add(mod.key);
      }
    }
    removedKeys.delete(meta.key);
    assetCache.set(meta.key, assets);
    next = withMod(next, meta);
  }
  emit(Object.freeze(next));

  for (const { meta, assets } of entries) {
    if (persistenceDisabled) return;
    // Skip files a later entry (or a removal since) replaced.
    if (!mods.some((mod) => mod.key === meta.key)) continue;
    try {
      await store.putLoadedMod(meta, assets);
    } catch (error) {
      disablePersistence(error);
    }
  }
}

/** Unload a mod file and delete it from persistent storage. */
export async function removeLoadedMod(key: string): Promise<void> {
  assetCache.delete(key);
  removedKeys.add(key);
  if (mods.some((mod) => mod.key === key)) {
    emit(Object.freeze(mods.filter((mod) => mod.key !== key)));
  }

  if (persistenceDisabled) return;
  try {
    await store.removeLoadedMod(key);
  } catch (error) {
    disablePersistence(error);
  }
}

/** Render assets for a loaded mod file, or null if it isn't loaded. */
export async function getLoadedModAssets(
  key: string,
): Promise<LoadedModAssets | null> {
  if (!mods.some((mod) => mod.key === key)) return null;
  const cached = assetCache.get(key);
  if (cached !== undefined) return cached;
  if (persistenceDisabled) return null;
  try {
    const assets = await store.getModAssets(key);
    if (assets !== null) assetCache.set(key, assets);
    return assets;
  } catch (error) {
    disablePersistence(error);
    return null;
  }
}

function getDerived(): Derived {
  const snapshot = getSnapshot();
  if (derived?.for === snapshot) return derived.value;
  const blockToMod = new Map<string, ModForBlock>();
  const blocks = new Map<string, ModBlock>();
  const namespaces = new Set<string>();
  for (const mod of snapshot) {
    for (const ns of mod.namespaces) namespaces.add(ns);
    const owner: ModForBlock = { key: mod.key, modName: mod.modName };
    for (const block of mod.blocks) {
      blockToMod.set(block.id, owner);
      blocks.set(block.id, block);
    }
  }
  const value: Derived = {
    blockIds: new Set(blockToMod.keys()),
    blockToMod,
    blocks,
    namespaces,
  };
  derived = { for: snapshot, value };
  return value;
}

/** Block ids provided by loaded mods. Stable identity per snapshot. */
export function getLoadedModBlockIds(): ReadonlySet<string> {
  return getDerived().blockIds;
}

/** The loaded mod providing `id`, or null for vanilla/unknown blocks. */
export function getModForBlockId(id: string): ModForBlock | null {
  return getDerived().blockToMod.get(id) ?? null;
}

/** The loaded mod block definition for `id`, or null for vanilla/unknown. */
export function getLoadedModBlock(id: string): ModBlock | null {
  return getDerived().blocks.get(id) ?? null;
}

/** Asset namespaces provided by loaded mods. Stable identity per snapshot. */
export function getLoadedNamespaces(): ReadonlySet<string> {
  return getDerived().namespaces;
}

// Test-only: reset module state between tests.
export function __resetLoadedModsForTests(): void {
  mods = EMPTY;
  derived = null;
  listeners.clear();
  assetCache.clear();
  removedKeys.clear();
  hydration = null;
  persistenceDisabled = false;
}
