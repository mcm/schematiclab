// Adds a CurseForge mod: pick a file, download the jar, parse it in the
// worker, then register + persist it. In-flight and failed loads live in a
// small module-level store (keyed by `modLoadKey(modId, gameVersion)`)
// subscribed via `useSyncExternalStore`, so progress survives tab switches, a
// second Add for the same mod and version is ignored while one is running,
// and a mod's source-version and target-version files load concurrently.
//
// Nothing is persisted until parsing succeeds with at least one block (or,
// for generated-block mods, rules that generate one).
// `registerModJar` (parse + register) is shared with modpack loads
// (`load-modpack.ts`). Once a file is registered, its namespaces that have no
// project mapping yet are mapped to its mod (existing mappings are never
// overwritten).

import * as React from "react";

import {
  downloadModJar,
  fetchCurseForgeModFiles,
  pickDownloadableFile,
} from "../curseforge/client";
import type { ModLoader } from "../curseforge/types";
import { providerDataGeneratesBlocks } from "./generated/jar-data";
import { autoMapNamespaces } from "./mappings";
import { parseModJarInWorker } from "./mod-jar-client";
import { addLoadedMod, getUnloadGeneration } from "./registry";
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

/** Keyed by `modLoadKey(modId, gameVersion)`. */
export type ModLoadsSnapshot = ReadonlyMap<string, ModLoadEntry>;

/** Load key for a (mod, game version); equals the loaded file's key. */
export const modLoadKey = loadedModKey;

export interface ModLoadDeps {
  fetchFiles: typeof fetchCurseForgeModFiles;
  download: typeof downloadModJar;
  parse: typeof parseModJarInWorker;
  add: typeof addLoadedMod;
  mapNamespaces: typeof autoMapNamespaces;
  now: () => number;
}

const DEFAULT_DEPS: ModLoadDeps = {
  fetchFiles: fetchCurseForgeModFiles,
  download: downloadModJar,
  parse: parseModJarInWorker,
  add: addLoadedMod,
  mapNamespaces: autoMapNamespaces,
  now: Date.now,
};

const EMPTY: ModLoadsSnapshot = new Map();

let loads: ModLoadsSnapshot = EMPTY;
const listeners = new Set<() => void>();

function setEntry(key: string, entry: ModLoadEntry | null): void {
  const next = new Map(loads);
  if (entry === null) {
    if (!next.delete(key)) return;
  } else {
    next.set(key, entry);
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
export function dismissModLoad(modId: number, gameVersion: string): void {
  const key = modLoadKey(modId, gameVersion);
  if (loads.get(key)?.state.phase === "error") setEntry(key, null);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== "" ? err.message : fallback;
}

/**
 * Load a mod's file for `request.gameVersion`. No-op if a load for the same
 * mod and version is already running; retries a failed one. Never rejects —
 * failures land in the entry's `error` state.
 */
export async function startModLoad(
  request: ModLoadRequest,
  deps: ModLoadDeps = DEFAULT_DEPS,
): Promise<void> {
  const modId = request.mod.id;
  const key = modLoadKey(modId, request.gameVersion);
  const existing = loads.get(key);
  if (existing !== undefined && existing.state.phase !== "error") return;

  const update = (state: ModLoadState) => setEntry(key, { request, state });
  const fail = (message: string) => update({ phase: "error", message });
  // "Unload all" while this load runs drops its file.
  const generation = getUnloadGeneration();

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
  let meta: LoadedModMeta;
  try {
    meta = await registerModJar(
      bytes,
      {
        modId,
        modName: request.mod.name,
        modSlug: request.mod.slug,
        logoUrl: request.mod.logoThumbnailUrl,
        fileId: file.id,
        fileDisplayName: file.displayName || file.fileName,
        gameVersion: request.gameVersion,
        gameVersions: file.gameVersions,
        loader:
          request.loader ??
          (file.loaders.length === 1 ? file.loaders[0] : null),
      },
      deps,
      () => update({ phase: "saving" }),
      generation,
    );
  } catch (err) {
    if (err instanceof ModJarError && err.code === "unloaded") {
      setEntry(key, null);
      return;
    }
    fail(errorMessage(err, "Could not save the mod."));
    return;
  }
  await mapModNamespaces([meta], deps);
  setEntry(key, null);
}

/**
 * Map each registered file's namespaces that have no project mapping yet to
 * its mod. The files are loaded either way; a mapping failure only costs a
 * manual map.
 */
export async function mapModNamespaces(
  files: readonly LoadedModMeta[],
  deps: Pick<ModLoadDeps, "mapNamespaces">,
): Promise<void> {
  for (const meta of files) {
    try {
      await deps.mapNamespaces(meta.namespaces, meta, meta.loadedAt);
    } catch (err) {
      console.warn("Could not map mod namespaces.", err);
    }
  }
}

/** A mod file's CurseForge metadata; the rest of `LoadedModMeta` comes from the jar. */
export type ModFileInfo = Omit<
  LoadedModMeta,
  | "key"
  | "namespaces"
  | "blocks"
  | "warnings"
  | "appearancesComputed"
  | "providerDataRead"
  | "loadedAt"
>;

/** A `registerModJar` failure; `message` is user-facing. */
export class ModJarError extends Error {
  constructor(
    message: string,
    readonly code: "parse" | "no_blocks" | "save" | "unloaded",
  ) {
    super(message);
    this.name = "ModJarError";
  }
}

/**
 * Parse a mod jar in the worker, then register + persist it. Shared by
 * CurseForge adds and modpack loads. Rejects with `ModJarError`; nothing is
 * registered unless the jar has at least one block, or (code `unloaded`) when
 * every mod was unloaded since `generation` (`getUnloadGeneration()`).
 * Resolves to the registered file's metadata. `bytes` may be detached
 * (transferred to the worker).
 */
export async function registerModJar(
  bytes: Uint8Array,
  info: ModFileInfo,
  deps: Pick<ModLoadDeps, "parse" | "add" | "now">,
  onSaving?: () => void,
  generation?: number,
): Promise<LoadedModMeta> {
  let parsed;
  try {
    parsed = await deps.parse(bytes);
  } catch (err) {
    throw new ModJarError(
      `Could not read the mod jar: ${errorMessage(err, "parse error")}`,
      "parse",
    );
  }
  if (
    parsed.blocks.length === 0 &&
    !providerDataGeneratesBlocks(parsed.providerData)
  ) {
    throw new ModJarError(
      "This mod file doesn't contain any blocks.",
      "no_blocks",
    );
  }

  onSaving?.();
  const providerDataRead = Object.keys(parsed.providerData ?? {}).sort();
  const meta: LoadedModMeta = {
    ...info,
    key: loadedModKey(info.modId, info.gameVersion),
    namespaces: parsed.namespaces,
    blocks: parsed.blocks,
    warnings: parsed.warnings,
    appearancesComputed: parsed.appearancesComputed === true,
    ...(providerDataRead.length > 0 ? { providerDataRead } : {}),
    loadedAt: deps.now(),
  };
  let added: boolean;
  try {
    added = await deps.add(meta, toLoadedModAssets(parsed), { generation });
  } catch (err) {
    throw new ModJarError(errorMessage(err, "Could not save the mod."), "save");
  }
  if (!added) {
    throw new ModJarError(
      "Every mod was unloaded while this one was loading.",
      "unloaded",
    );
  }
  return meta;
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
