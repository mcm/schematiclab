// Adds a CurseForge mod: pick a file, download the jar, parse it in the
// worker, then register + persist it. In-flight and failed loads live in a
// small module-level store (keyed by CurseForge mod id) subscribed via
// `useSyncExternalStore`, so progress survives tab switches and a second Add
// for the same mod is ignored while one is running.
//
// Nothing is persisted until parsing succeeds with at least one block.

import * as React from "react";

import {
  downloadModJar,
  fetchCurseForgeModFiles,
  pickDownloadableFile,
} from "../curseforge/client";
import type { ModLoader } from "../curseforge/types";
import { parseModJarInWorker } from "./mod-jar-client";
import { addLoadedMod } from "./registry";
import { loadedModKey, toLoadedModAssets, type LoadedModMeta } from "./types";

export interface ModLoadRequest {
  mod: {
    id: number;
    name: string;
    slug: string;
    logoThumbnailUrl: string | null;
  };
  /** Minecraft version (KNOWN_VERSIONS key form) to pick a file for. */
  gameVersion: string;
  loader: ModLoader | null;
}

export type ModLoadState =
  | { phase: "resolving" }
  | { phase: "downloading"; received: number; total: number | null }
  | { phase: "extracting" }
  | { phase: "saving" }
  | { phase: "error"; message: string };

export interface ModLoadEntry {
  request: ModLoadRequest;
  state: ModLoadState;
}

export type ModLoadsSnapshot = ReadonlyMap<number, ModLoadEntry>;

export interface ModLoadDeps {
  fetchFiles: typeof fetchCurseForgeModFiles;
  download: typeof downloadModJar;
  parse: typeof parseModJarInWorker;
  add: typeof addLoadedMod;
  now: () => number;
}

const DEFAULT_DEPS: ModLoadDeps = {
  fetchFiles: fetchCurseForgeModFiles,
  download: downloadModJar,
  parse: parseModJarInWorker,
  add: addLoadedMod,
  now: Date.now,
};

const EMPTY: ModLoadsSnapshot = new Map();

let loads: ModLoadsSnapshot = EMPTY;
const listeners = new Set<() => void>();

function setEntry(modId: number, entry: ModLoadEntry | null): void {
  const next = new Map(loads);
  if (entry === null) {
    if (!next.delete(modId)) return;
  } else {
    next.set(modId, entry);
  }
  loads = next;
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getModLoads(): ModLoadsSnapshot {
  return loads;
}

function getServerSnapshot(): ModLoadsSnapshot {
  return EMPTY;
}

export function useModLoads(): ModLoadsSnapshot {
  return React.useSyncExternalStore(subscribe, getModLoads, getServerSnapshot);
}

/** Forget a failed load (e.g. the user dismissed its error). */
export function dismissModLoad(modId: number): void {
  if (loads.get(modId)?.state.phase === "error") setEntry(modId, null);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== "" ? err.message : fallback;
}

/**
 * Load a mod. No-op if a load for the same mod is already running; retries a
 * failed one. Never rejects — failures land in the entry's `error` state.
 */
export async function startModLoad(
  request: ModLoadRequest,
  deps: ModLoadDeps = DEFAULT_DEPS,
): Promise<void> {
  const modId = request.mod.id;
  const existing = loads.get(modId);
  if (existing !== undefined && existing.state.phase !== "error") return;

  const update = (state: ModLoadState) => setEntry(modId, { request, state });
  const fail = (message: string) => update({ phase: "error", message });

  update({ phase: "resolving" });

  let files;
  try {
    files = await deps.fetchFiles({
      modId,
      gameVersion: request.gameVersion,
      loader: request.loader,
    });
  } catch (err) {
    fail(errorMessage(err, "Could not list mod files."));
    return;
  }
  const file = pickDownloadableFile(files);
  if (file === null) {
    fail(`No downloadable file for ${request.gameVersion}`);
    return;
  }

  let bytes: Uint8Array;
  let lastPercent = -1;
  try {
    bytes = await deps.download(modId, file.id, ({ received, total }) => {
      // Re-render only when the visible percentage changes.
      const percent =
        total === null ? received >> 18 : Math.floor((received / total) * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      update({ phase: "downloading", received, total });
    });
  } catch (err) {
    fail(errorMessage(err, "Download failed."));
    return;
  }

  update({ phase: "extracting" });
  let parsed;
  try {
    parsed = await deps.parse(bytes);
  } catch (err) {
    fail(`Could not read the mod jar: ${errorMessage(err, "parse error")}`);
    return;
  }
  if (parsed.blocks.length === 0) {
    fail("This mod file doesn't contain any blocks.");
    return;
  }

  update({ phase: "saving" });
  const meta: LoadedModMeta = {
    key: loadedModKey(modId, file.id),
    modId,
    modName: request.mod.name,
    modSlug: request.mod.slug,
    logoUrl: request.mod.logoThumbnailUrl,
    fileId: file.id,
    fileDisplayName: file.displayName || file.fileName,
    gameVersions: file.gameVersions,
    loader:
      request.loader ?? (file.loaders.length === 1 ? file.loaders[0] : null),
    namespaces: parsed.namespaces,
    blocks: parsed.blocks,
    warnings: parsed.warnings,
    loadedAt: deps.now(),
  };
  try {
    await deps.add(meta, toLoadedModAssets(parsed));
  } catch (err) {
    fail(errorMessage(err, "Could not save the mod."));
    return;
  }
  setEntry(modId, null);
}

/** "Downloading 42%", "Extracting", … for an in-flight load. */
export function describeModLoadState(state: ModLoadState): string {
  switch (state.phase) {
    case "resolving":
      return "Finding file";
    case "downloading":
      if (state.total === null) {
        return `Downloading ${(state.received / (1024 * 1024)).toFixed(1)} MB`;
      }
      return `Downloading ${Math.min(
        100,
        Math.floor((state.received / state.total) * 100),
      )}%`;
    case "extracting":
      return "Extracting";
    case "saving":
      return "Saving";
    case "error":
      return state.message;
  }
}

// Test-only: reset module state between tests.
export function __resetModLoadsForTests(): void {
  loads = EMPTY;
  listeners.clear();
}
