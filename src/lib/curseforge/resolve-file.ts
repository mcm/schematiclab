// Resolve a mod's file for a Minecraft version, preferring the loader of the
// mod's loaded source-version file (SCHEM-57). Settled answers are memoised
// for the session; errors aren't, so a retry re-queries.

import type { LoadedModMeta } from "../mods/types";
import {
  CurseForgeRequestError,
  fetchCurseForgeModFiles,
  pickDownloadableFile,
} from "./client";
import type { CurseForgeModFile, ModLoader } from "./types";

export interface ResolveModFileParams {
  modId: number;
  gameVersion: string;
  /** Loader of the mod's loaded source-version file; null when none. */
  preferredLoader: ModLoader | null;
}

export type ResolvedModFile =
  | {
      status: "available";
      file: CurseForgeModFile;
      /** Loader the file was chosen for; null when it can't be told. */
      loader: ModLoader | null;
      /** True when the file doesn't list `preferredLoader`. */
      loaderFallback: boolean;
    }
  | { status: "unavailable" }
  | { status: "error"; message: string };

type SettledResult = Exclude<ResolvedModFile, { status: "error" }>;

const cache = new Map<string, SettledResult>();

function cacheKey(params: ResolveModFileParams): string {
  return `${params.modId}:${params.gameVersion}:${params.preferredLoader ?? ""}`;
}

/** Forget memoised results (tests). */
export function clearResolvedModFileCache(): void {
  cache.clear();
}

/**
 * Find the newest downloadable file of `modId` for `gameVersion`: first for
 * `preferredLoader`, then for any loader. Resolves to a tagged result; only
 * rejects when `signal` aborts.
 */
export async function resolveModFileForVersion(
  params: ResolveModFileParams,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedModFile> {
  const key = cacheKey(params);
  const cached = cache.get(key);
  if (cached) return cached;

  const { modId, gameVersion, preferredLoader } = params;
  let result: SettledResult;
  try {
    let file: CurseForgeModFile | null = null;
    if (preferredLoader !== null) {
      file = pickDownloadableFile(
        await fetchCurseForgeModFiles(
          { modId, gameVersion, loader: preferredLoader },
          signal,
          fetchImpl,
        ),
      );
    }
    if (file === null) {
      file = pickDownloadableFile(
        await fetchCurseForgeModFiles(
          { modId, gameVersion, loader: null },
          signal,
          fetchImpl,
        ),
      );
    }
    if (file === null) {
      result = { status: "unavailable" };
    } else if (
      preferredLoader !== null &&
      file.loaders.includes(preferredLoader)
    ) {
      result = {
        status: "available",
        file,
        loader: preferredLoader,
        loaderFallback: false,
      };
    } else {
      result = {
        status: "available",
        file,
        loader: file.loaders[0] ?? null,
        loaderFallback: preferredLoader !== null,
      };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      status: "error",
      message:
        err instanceof CurseForgeRequestError
          ? err.message
          : "Could not list mod files.",
    };
  }
  cache.set(key, result);
  return result;
}

/**
 * Loader of `modId`'s loaded file for `sourceVersion` (the schematic's
 * version), or null when no such file is loaded.
 */
export function preferredLoaderFor(
  mods: readonly LoadedModMeta[],
  modId: number,
  sourceVersion: string | null,
): ModLoader | null {
  if (sourceVersion === null) return null;
  const source =
    mods.find(
      (mod) => mod.modId === modId && mod.gameVersion === sourceVersion,
    ) ??
    mods.find(
      (mod) => mod.modId === modId && mod.gameVersions.includes(sourceVersion),
    );
  return source?.loader ?? null;
}
