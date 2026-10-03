// Reactive in-memory registry of loaded CurseForge mods.
//
// Module-level state subscribed via `useSyncExternalStore`. Hydrates from the
// IndexedDB store once, on first access in the browser. If IndexedDB is
// unavailable (private mode, blocked storage) the registry keeps working
// in-memory only for the session and logs a single `console.warn`.
//
// The registry holds at most one file per (CurseForge mod, Minecraft version),
// so a mod's source-version and target-version files can be loaded side by
// side. The snapshot is an immutable array whose identity changes only when
// the set of loaded files changes. Derived lookups (block ids, namespaces,
// per-version blocks, preview files) are cached per snapshot.

import * as React from "react";

import * as store from "./store";
import type { LoadedModAssets, LoadedModMeta, ModBlock } from "./types";

export type LoadedModsSnapshot = readonly LoadedModMeta[];

export interface ModForBlock {
  key: string;
  modName: string;
}

interface BlockLookup {
  blockToMod: ReadonlyMap<string, ModForBlock>;
  blocks: ReadonlyMap<string, ModBlock>;
}

interface Derived extends BlockLookup {
  blockIds: ReadonlySet<string>;
  // Some mod has files for more than one game version loaded.
  multiVersionMods: boolean;
  namespaces: ReadonlySet<string>;
}

const EMPTY: LoadedModsSnapshot = Object.freeze([]);

let mods: LoadedModsSnapshot = EMPTY;
let derived: { for: LoadedModsSnapshot; value: Derived } | null = null;
// Per-snapshot caches keyed by version id (and namespace for blocks).
let previewFiles: {
  for: LoadedModsSnapshot;
  value: Map<string | null, LoadedModsSnapshot>;
} | null = null;
let versionBlocks: {
  for: LoadedModsSnapshot;
  value: Map<string, ReadonlyMap<string, ModBlock>>;
} | null = null;
let versionBlockLookups: {
  for: LoadedModsSnapshot;
  value: Map<string, BlockLookup>;
} | null = null;
const listeners = new Set<() => void>();
// Assets for mods added this session. Serves reads while persistence is
// unavailable (and saves an IndexedDB round-trip otherwise).
const assetCache = new Map<string, LoadedModAssets>();
// Keys removed before hydration finished, so a slow hydrate can't resurrect them.
const removedKeys = new Set<string>();
// Bumped by `removeAllLoadedMods`, so a hydrate or a mod load that started
// earlier drops everything it read.
let clearGeneration = 0;
const unloadAllListeners = new Set<() => void>();

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

function sameFileSlot(a: LoadedModMeta, b: LoadedModMeta): boolean {
  return a.modId === b.modId && a.gameVersion === b.gameVersion;
}

/** Merge `incoming` into `base`, keeping one file per (mod, game version). */
function withMod(
  base: LoadedModsSnapshot,
  incoming: LoadedModMeta,
): LoadedModMeta[] {
  return [...base.filter((mod) => !sameFileSlot(mod, incoming)), incoming];
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
      const generation = clearGeneration;
      let stored: LoadedModMeta[];
      try {
        stored = await store.listLoadedMods();
      } catch (error) {
        disablePersistence(error);
        return;
      }
      if (generation !== clearGeneration) return;
      // Files added during hydration win over stored files in the same slot.
      const restored = stored.filter(
        (file) =>
          !removedKeys.has(file.key) &&
          !mods.some((mod) => sameFileSlot(mod, file)),
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
 * Changes whenever every mod is unloaded. A load snapshots it when it starts
 * and passes it to `addLoadedMod(s)`, so a load that outlives "Unload all"
 * doesn't bring its file back.
 */
export function getUnloadGeneration(): number {
  return clearGeneration;
}

/** Call `listener` each time every mod is unloaded (even when none were). */
export function onUnloadAll(listener: () => void): () => void {
  unloadAllListeners.add(listener);
  return () => {
    unloadAllListeners.delete(listener);
  };
}

export interface AddLoadedModsOptions {
  /** `getUnloadGeneration()` when the load started; stale → nothing is added. */
  generation?: number;
}

/**
 * Register a loaded mod file and persist it. Replaces only a loaded file of
 * the same CurseForge mod for the same game version. Resolves once persisted
 * (or immediately when running in-memory only); persistence failures fall back to in-memory with a warning.
 * Resolves to false, without adding anything, when every mod was unloaded
 * since `options.generation`.
 */
export function addLoadedMod(
  meta: LoadedModMeta,
  assets: LoadedModAssets,
  options?: AddLoadedModsOptions,
): Promise<boolean> {
  return addLoadedMods([{ meta, assets }], options);
}

/**
 * `addLoadedMod` for many files at once: the registry changes (and
 * subscribers, like the 3D preview's atlas rebuild, run) once for the whole
 * batch. Later entries win over earlier ones for the same
 * (CurseForge mod, game version) slot.
 */
export async function addLoadedMods(
  entries: readonly { meta: LoadedModMeta; assets: LoadedModAssets }[],
  options: AddLoadedModsOptions = {},
): Promise<boolean> {
  if (
    options.generation !== undefined &&
    options.generation !== clearGeneration
  ) {
    return false;
  }
  if (entries.length === 0) return true;
  let next: LoadedModMeta[] = [...mods];
  for (const { meta, assets } of entries) {
    for (const mod of next) {
      if (sameFileSlot(mod, meta) && mod.key !== meta.key) {
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
    if (persistenceDisabled) break;
    // Skip files a later entry (or a removal since) replaced.
    if (!mods.some((mod) => mod.key === meta.key)) continue;
    try {
      await store.putLoadedMod(meta, assets);
    } catch (error) {
      disablePersistence(error);
    }
  }
  return true;
}

/**
 * Unload one mod file (other versions of the same mod stay loaded) and delete
 * it from persistent storage.
 */
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

/**
 * Unload every mod file and delete them all from persistent storage.
 * Namespace mappings are kept.
 */
export async function removeAllLoadedMods(): Promise<void> {
  clearGeneration++;
  for (const mod of mods) removedKeys.add(mod.key);
  assetCache.clear();
  emit(EMPTY);
  unloadAllListeners.forEach((listener) => {
    listener();
  });

  if (persistenceDisabled) return;
  try {
    await store.removeAllLoadedMods();
  } catch (error) {
    disablePersistence(error);
  }
}

/**
 * Replace a loaded file's metadata in place (same key, same position) and
 * persist it. No-op when that file is no longer loaded.
 */
export async function updateLoadedModMeta(meta: LoadedModMeta): Promise<void> {
  const index = mods.findIndex((mod) => mod.key === meta.key);
  if (index < 0) return;
  emit(Object.freeze(mods.map((mod, i) => (i === index ? meta : mod))));

  if (persistenceDisabled) return;
  try {
    await store.updateLoadedModMeta(meta);
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

/**
 * Render assets for a loaded mod file if they're already in memory (added
 * this session or read by `getLoadedModAssets`), else null.
 */
export function peekLoadedModAssets(key: string): LoadedModAssets | null {
  if (!mods.some((mod) => mod.key === key)) return null;
  return assetCache.get(key) ?? null;
}

function indexBlocks(
  mod: LoadedModMeta,
  blockToMod: Map<string, ModForBlock>,
  blocks: Map<string, ModBlock>,
): void {
  const owner: ModForBlock = { key: mod.key, modName: mod.modName };
  for (const block of mod.blocks) {
    blockToMod.set(block.id, owner);
    blocks.set(block.id, block);
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
    indexBlocks(mod, blockToMod, blocks);
  }
  const value: Derived = {
    blockIds: new Set(blockToMod.keys()),
    multiVersionMods:
      new Set(snapshot.map((mod) => mod.modId)).size !== snapshot.length,
    blockToMod,
    blocks,
    namespaces,
  };
  derived = { for: snapshot, value };
  return value;
}

/** The loaded file of `modId` for `gameVersion`, or null. */
export function getLoadedModFile(
  modId: number,
  gameVersion: string,
): LoadedModMeta | null {
  return (
    getSnapshot().find(
      (mod) => mod.modId === modId && mod.gameVersion === gameVersion,
    ) ?? null
  );
}

/**
 * Blocks in `namespace` from files loaded for `gameVersion`, keyed by block
 * id. Stable identity per snapshot.
 */
export function getModBlocksForVersion(
  namespace: string,
  gameVersion: string,
): ReadonlyMap<string, ModBlock> {
  const snapshot = getSnapshot();
  if (versionBlocks?.for !== snapshot) {
    versionBlocks = { for: snapshot, value: new Map() };
  }
  const cacheKey = `${gameVersion}\u0000${namespace}`;
  const cached = versionBlocks.value.get(cacheKey);
  if (cached !== undefined) return cached;
  const prefix = `${namespace}:`;
  const blocks = new Map<string, ModBlock>();
  for (const mod of snapshot) {
    if (mod.gameVersion !== gameVersion) continue;
    for (const block of mod.blocks) {
      if (block.id.startsWith(prefix)) blocks.set(block.id, block);
    }
  }
  versionBlocks.value.set(cacheKey, blocks);
  return blocks;
}

/**
 * The files the 3D preview renders: exactly one per mod, the one loaded for
 * `sourceVersionId` if any, else the most recently loaded. Ordered like the
 * snapshot (oldest first). Stable identity per snapshot and version.
 */
export function getPreviewModFiles(
  sourceVersionId: string | null,
): LoadedModsSnapshot {
  const snapshot = getSnapshot();
  if (previewFiles?.for !== snapshot) {
    previewFiles = { for: snapshot, value: new Map() };
  }
  const cached = previewFiles.value.get(sourceVersionId);
  if (cached !== undefined) return cached;
  const chosen = new Map<number, LoadedModMeta>();
  for (const mod of snapshot) {
    const current = chosen.get(mod.modId);
    if (
      current === undefined ||
      (current.gameVersion !== sourceVersionId &&
        (mod.gameVersion === sourceVersionId ||
          mod.loadedAt >= current.loadedAt))
    ) {
      chosen.set(mod.modId, mod);
    }
  }
  const picked = new Set(chosen.values());
  const value = Object.freeze(snapshot.filter((mod) => picked.has(mod)));
  previewFiles.value.set(sourceVersionId, value);
  return value;
}

/** Block ids provided by loaded mods. Stable identity per snapshot. */
export function getLoadedModBlockIds(): ReadonlySet<string> {
  return getDerived().blockIds;
}

/**
 * Block lookups that prefer, per mod, the file `getPreviewModFiles` picks for
 * `gameVersion` (the file loaded for that version, else the most recently
 * loaded). Blocks only other files of the mod provide still resolve, as in the
 * version-agnostic lookup. Cached per snapshot and version.
 */
function getBlockLookup(gameVersion: string | null | undefined): BlockLookup {
  const base = getDerived();
  if (gameVersion == null) return base;
  // One file per mod: nothing to disambiguate.
  if (!base.multiVersionMods) return base;
  const snapshot = getSnapshot();
  if (versionBlockLookups?.for !== snapshot) {
    versionBlockLookups = { for: snapshot, value: new Map() };
  }
  const cached = versionBlockLookups.value.get(gameVersion);
  if (cached !== undefined) return cached;
  const blockToMod = new Map(base.blockToMod);
  const blocks = new Map(base.blocks);
  for (const mod of getPreviewModFiles(gameVersion)) {
    indexBlocks(mod, blockToMod, blocks);
  }
  const value: BlockLookup = { blockToMod, blocks };
  versionBlockLookups.value.set(gameVersion, value);
  return value;
}

/**
 * The loaded mod file providing `id`, or null for vanilla/unknown blocks.
 * With `gameVersion`, prefers that version's file of the owning mod (falling
 * back like `getPreviewModFiles`); without it, the last file in the snapshot.
 */
export function getModForBlockId(
  id: string,
  gameVersion?: string | null,
): ModForBlock | null {
  return getBlockLookup(gameVersion).blockToMod.get(id) ?? null;
}

/**
 * The loaded mod block definition for `id`, or null for vanilla/unknown.
 * `gameVersion` picks the file as in `getModForBlockId`.
 */
export function getLoadedModBlock(
  id: string,
  gameVersion?: string | null,
): ModBlock | null {
  return getBlockLookup(gameVersion).blocks.get(id) ?? null;
}

/** Asset namespaces provided by loaded mods. Stable identity per snapshot. */
export function getLoadedNamespaces(): ReadonlySet<string> {
  return getDerived().namespaces;
}

// Test-only: reset module state between tests.
export function __resetLoadedModsForTests(): void {
  mods = EMPTY;
  derived = null;
  previewFiles = null;
  versionBlocks = null;
  versionBlockLookups = null;
  listeners.clear();
  unloadAllListeners.clear();
  assetCache.clear();
  removedKeys.clear();
  clearGeneration = 0;
  hydration = null;
  persistenceDisabled = false;
}
