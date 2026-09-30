// Loads every mod from a locally installed CurseForge modpack: the user picks
// the instance folder, `minecraftinstance.json` supplies each jar's
// CurseForge ids, and each jar goes through the same parse + register path as
// a mod added from the Mods tab (`registerModJar`). Jars are read from disk;
// one listed in the manifest but missing from `mods/` is downloaded from
// CurseForge instead.
//
// Mods run one at a time (the jar worker is single-threaded anyway, and it
// keeps at most one jar in memory). Mods without blocks are skipped quietly;
// files already loaded are skipped without re-parsing. One modpack load runs
// at a time; its progress lives in a module-level store subscribed via
// `useSyncExternalStore`.

import * as React from "react";

import { downloadModJar } from "../curseforge/client";
import { ModJarError, registerModJar, type ModLoadDeps } from "./load-mod";
import { parseModJarInWorker } from "./mod-jar-client";
import {
  MODPACK_MANIFEST_NAME,
  locateModpackFiles,
  parseMinecraftInstance,
  type ModpackMod,
} from "./modpack-instance";
import { addLoadedMod, getSnapshot, hydrateLoadedMods } from "./registry";
import { loadedModKey } from "./types";

/** Local jars larger than this are skipped rather than read into memory. */
export const MAX_LOCAL_JAR_BYTES = 256 * 1024 * 1024;

/** A file picked from the modpack folder. */
export interface ModpackFile {
  /** Path relative to the picked folder's parent, `/`-separated. */
  path: string;
  file: Blob;
}

export interface ModpackLoadFailure {
  modName: string;
  message: string;
}

export interface ModpackLoadProgress {
  packName: string;
  /** Mods listed in the manifest (enabled jars only). */
  total: number;
  processed: number;
  /** Mod currently being read, while running. */
  current: string | null;
  loaded: number;
  alreadyLoaded: number;
  noBlocks: number;
  failures: ModpackLoadFailure[];
}

export type ModpackLoadState =
  | { status: "reading" }
  | ({ status: "running" | "done" | "cancelled" } & ModpackLoadProgress)
  | { status: "error"; message: string };

export interface ModpackLoadDeps extends Pick<
  ModLoadDeps,
  "download" | "parse" | "add" | "now"
> {
  /** Keys of mod files already loaded (after hydration). */
  loadedKeys: () => Promise<ReadonlySet<string>>;
}

const DEFAULT_DEPS: ModpackLoadDeps = {
  download: downloadModJar,
  parse: parseModJarInWorker,
  add: addLoadedMod,
  now: Date.now,
  loadedKeys: async () => {
    await hydrateLoadedMods();
    return new Set(getSnapshot().map((mod) => mod.key));
  },
};

let state: ModpackLoadState | null = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function setState(next: ModpackLoadState | null): void {
  state = next;
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

export function getModpackLoad(): ModpackLoadState | null {
  return state;
}

function getServerSnapshot(): ModpackLoadState | null {
  return null;
}

export function useModpackLoad(): ModpackLoadState | null {
  return React.useSyncExternalStore(
    subscribe,
    getModpackLoad,
    getServerSnapshot,
  );
}

function isActive(current: ModpackLoadState | null): boolean {
  return current?.status === "reading" || current?.status === "running";
}

/** Stop the running modpack load after the current mod. */
export function cancelModpackLoad(): void {
  controller?.abort();
}

/** Forget a finished, cancelled or failed modpack load. */
export function dismissModpackLoad(): void {
  if (!isActive(state)) setState(null);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== "" ? err.message : fallback;
}

async function readJar(
  mod: ModpackMod,
  jar: Blob | undefined,
  deps: ModpackLoadDeps,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (jar === undefined) {
    // Not on disk (deleted, or not synced yet): fetch the exact file the
    // manifest names.
    return deps.download(mod.modId, mod.fileId, () => {}, signal);
  }
  if (jar.size > MAX_LOCAL_JAR_BYTES) {
    throw new Error(
      `The jar is larger than ${MAX_LOCAL_JAR_BYTES / (1024 * 1024)} MB.`,
    );
  }
  return new Uint8Array(await jar.arrayBuffer());
}

/**
 * Load every mod in a CurseForge instance folder. No-op while another
 * modpack load runs. Never rejects: problems land in the store's state.
 */
export async function startModpackLoad(
  files: readonly ModpackFile[],
  deps: ModpackLoadDeps = DEFAULT_DEPS,
): Promise<void> {
  if (isActive(state)) return;
  const abort = new AbortController();
  controller = abort;
  setState({ status: "reading" });

  const located = locateModpackFiles(files);
  if (located === null) {
    setState({
      status: "error",
      message: `No ${MODPACK_MANIFEST_NAME} in that folder. Pick a CurseForge instance folder (the one containing mods/).`,
    });
    return;
  }

  let instance;
  try {
    instance = parseMinecraftInstance(
      JSON.parse(await located.manifest.file.text()),
    );
  } catch (err) {
    setState({
      status: "error",
      message:
        err instanceof SyntaxError
          ? `${MODPACK_MANIFEST_NAME} isn't valid JSON.`
          : errorMessage(err, `Could not read ${MODPACK_MANIFEST_NAME}.`),
    });
    return;
  }

  const loadedKeys = await deps.loadedKeys();
  let progress: ModpackLoadProgress = {
    packName: instance.name,
    total: instance.mods.length,
    processed: 0,
    current: null,
    loaded: 0,
    alreadyLoaded: 0,
    noBlocks: 0,
    failures: [],
  };
  const update = (patch: Partial<ModpackLoadProgress>) => {
    progress = { ...progress, ...patch };
    setState({ status: "running", ...progress });
  };
  update({});

  for (const mod of instance.mods) {
    if (abort.signal.aborted) break;
    if (loadedKeys.has(loadedModKey(mod.modId, mod.fileId))) {
      update({
        processed: progress.processed + 1,
        alreadyLoaded: progress.alreadyLoaded + 1,
      });
      continue;
    }
    update({ current: mod.name });

    let outcome: Partial<ModpackLoadProgress>;
    try {
      const bytes = await readJar(
        mod,
        located.jars.get(mod.fileName)?.file,
        deps,
        abort.signal,
      );
      await registerModJar(
        bytes,
        {
          modId: mod.modId,
          modName: mod.name,
          modSlug: mod.slug,
          logoUrl: mod.logoUrl,
          fileId: mod.fileId,
          fileDisplayName: mod.fileDisplayName,
          gameVersions: mod.gameVersions,
          loader: mod.loader,
        },
        deps,
      );
      outcome = { loaded: progress.loaded + 1 };
    } catch (err) {
      if (abort.signal.aborted) break;
      outcome =
        err instanceof ModJarError && err.code === "no_blocks"
          ? { noBlocks: progress.noBlocks + 1 }
          : {
              failures: [
                ...progress.failures,
                {
                  modName: mod.name,
                  message: errorMessage(err, "Could not load the mod."),
                },
              ],
            };
    }
    update({ ...outcome, processed: progress.processed + 1 });
  }

  if (controller === abort) controller = null;
  setState({
    status: abort.signal.aborted ? "cancelled" : "done",
    ...progress,
    current: null,
  });
}

// Test-only: reset module state between tests.
export function __resetModpackLoadForTests(): void {
  state = null;
  controller = null;
  listeners.clear();
}
