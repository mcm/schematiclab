// Reactive cache of the resolved generated blocks (with `appearance`) of the
// schematic on screen, for UI that reads block colours synchronously (the
// static renders). `requestGeneratedBlocks` loads them in the background
// (`render.ts`) and notifies subscribers once they're in; a registry change
// or another block set loads again.

import { getSnapshot, type LoadedModsSnapshot } from "../registry";
import type { ModBlock } from "../types";
import { isGeneratedBlockId, loadGeneratedBlockRender } from "./render";

interface Entry {
  key: string;
  snapshot: LoadedModsSnapshot;
  blocks: ReadonlyMap<string, ModBlock>;
}

let current: Entry | null = null;
let requested: { key: string; snapshot: LoadedModsSnapshot } | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function requestKey(gameVersion: string, ids: readonly string[]): string {
  return `${gameVersion}\n${ids.join("\n")}`;
}

/**
 * Load the generated blocks among `blockIds` for `gameVersion`, unless the
 * same set is already loaded (or loading) for the current mod registry.
 */
export function requestGeneratedBlocks(
  blockIds: Iterable<string>,
  gameVersion: string,
): void {
  const ids = [...new Set(blockIds)].filter(isGeneratedBlockId).sort();
  if (ids.length === 0) return;
  const key = requestKey(gameVersion, ids);
  const snapshot = getSnapshot();
  if (requested?.key === key && requested.snapshot === snapshot) return;
  const request = { key, snapshot };
  requested = request;
  void loadGeneratedBlockRender(ids, gameVersion)
    .then((render) => {
      if (requested !== request) return;
      current = { key, snapshot, blocks: render.blocks };
      revision++;
      for (const listener of listeners) listener();
    })
    .catch((err: unknown) => {
      console.warn("Could not load generated blocks.", err);
    });
}

/**
 * The resolved generated block `blockId` of the last load for `gameVersion`,
 * or undefined.
 */
export function getGeneratedBlock(
  blockId: string,
  gameVersion: string,
): ModBlock | undefined {
  if (current === null || !current.key.startsWith(`${gameVersion}\n`)) {
    return undefined;
  }
  return current.blocks.get(blockId);
}

/**
 * True once a load for `gameVersion` finished, so its files' assets are in
 * memory and resolving against them sees the loaded rules.
 */
export function generatedBlocksLoadedFor(gameVersion: string): boolean {
  return current !== null && current.key.startsWith(`${gameVersion}\n`);
}

export function subscribeGeneratedBlocks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever loaded generated blocks change (`useSyncExternalStore`). */
export function getGeneratedBlocksRevision(): number {
  return revision;
}

// Test-only: forget loaded blocks.
export function __resetGeneratedBlockStoreForTests(): void {
  current = null;
  requested = null;
  revision = 0;
}
