// Lazily computes block appearances for mod files loaded before appearances
// existed (their `ModBlock`s lack `appearance`). The first call for such a file
// reads its stored models and textures, computes appearances in the mod-jar
// worker, then updates the registry and persists the new metadata, so later
// sessions never recompute. Files loaded since then already have
// `appearancesComputed` set and return immediately.

import { forEachLimit } from "./for-each-limit";
import { computeModAppearancesInWorker } from "./mod-jar-client";
import {
  getLoadedModAssets,
  getSnapshot,
  updateLoadedModMeta,
} from "./registry";
import type { LoadedModMeta } from "./types";

export interface AppearanceBackfillDeps {
  compute: typeof computeModAppearancesInWorker;
  now?: () => number;
}

const DEFAULT_DEPS: AppearanceBackfillDeps = {
  compute: computeModAppearancesInWorker,
};

// A loaded file across metadata updates. The backfill's own registry update
// keeps it; a replacement (even of the same CurseForge file) gets a new
// `loadedAt`, so it starts its own computation.
function fileIdentity(meta: LoadedModMeta): string {
  return `${meta.fileId}:${meta.loadedAt}`;
}

// Keyed by file key.
interface Backfill {
  identity: string;
  promise: Promise<LoadedModMeta | null>;
}
const inFlight = new Map<string, Backfill>();

// Files whose last backfill was incomplete (no vanilla bundle), by key. The
// registry update it made re-triggers callers, so wait before retrying
// instead of recomputing in a loop.
const RETRY_AFTER_MS = 60_000;
const incomplete = new Map<string, { identity: string; at: number }>();

// Textures read at once; each holds its bytes in memory until computed.
const READ_CONCURRENCY = 8;

/**
 * The loaded file `key` with block appearances computed, or null when it isn't
 * loaded. Concurrent calls for one file share a single computation. Never
 * rejects: on failure the file's current metadata is returned unchanged, and
 * the next call tries again (after `RETRY_AFTER_MS` when the result was only
 * incomplete).
 */
export function ensureModAppearances(
  key: string,
  deps: AppearanceBackfillDeps = DEFAULT_DEPS,
): Promise<LoadedModMeta | null> {
  const meta = getSnapshot().find((mod) => mod.key === key) ?? null;
  if (meta === null || meta.appearancesComputed === true) {
    return Promise.resolve(meta);
  }
  const identity = fileIdentity(meta);
  const now = (deps.now ?? Date.now)();
  const last = incomplete.get(key);
  if (last?.identity === identity && now - last.at < RETRY_AFTER_MS) {
    return Promise.resolve(meta);
  }
  const running = inFlight.get(key);
  if (running?.identity === identity) return running.promise;
  const entry: Backfill = {
    identity,
    promise: backfill(meta, deps).finally(() => {
      if (inFlight.get(key) === entry) inFlight.delete(key);
    }),
  };
  inFlight.set(key, entry);
  return entry.promise;
}

async function backfill(
  meta: LoadedModMeta,
  deps: AppearanceBackfillDeps,
): Promise<LoadedModMeta> {
  try {
    const assets = await getLoadedModAssets(meta.key);
    if (assets === null) return meta;
    const textures: Record<string, Uint8Array> = {};
    await forEachLimit(
      Object.entries(assets.textures),
      READ_CONCURRENCY,
      async ([id, blob]) => {
        textures[id] = new Uint8Array(await blob.arrayBuffer());
      },
    );
    const { appearances, complete } = await deps.compute({
      blockIds: meta.blocks.map((block) => block.id),
      blockstates: assets.blockstates,
      models: assets.models,
      textures,
      textureMeta: assets.textureMeta,
    });

    // The file may have been removed or replaced while we computed.
    const current = getSnapshot().find((mod) => mod.key === meta.key);
    if (current === undefined || fileIdentity(current) !== fileIdentity(meta)) {
      return current ?? meta;
    }
    if (complete) {
      incomplete.delete(meta.key);
    } else {
      incomplete.set(meta.key, {
        identity: fileIdentity(meta),
        at: (deps.now ?? Date.now)(),
      });
    }
    const next: LoadedModMeta = {
      ...meta,
      blocks: meta.blocks.map((block) =>
        Object.hasOwn(appearances, block.id)
          ? { ...block, appearance: appearances[block.id] }
          : block,
      ),
      // Without the vanilla bundle, retry next time rather than persisting a
      // partial result as final.
      appearancesComputed: complete,
    };
    await updateLoadedModMeta(next);
    return next;
  } catch (err) {
    console.warn("Could not compute block colours for %s.", meta.modName, err);
    return meta;
  }
}

// Test-only: forget in-flight computations.
export function __resetAppearanceBackfillForTests(): void {
  inFlight.clear();
  incomplete.clear();
}
