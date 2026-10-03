// The generated-block providers and the loaded files they read.
//
// `getGeneratedBlockFiles` views the mod registry's files for one Minecraft
// version; `loadGeneratedBlockFiles` first reads their assets into memory so
// providers can see rule data, blockstates and models. Resolution is
// synchronous: callers that need assets await `loadGeneratedBlockFiles` once,
// then resolve as often as they like.
//
// Worker-safe: no DOM access.

import {
  getLoadedModAssets,
  getLoadedModFile,
  getModBlocksForVersion,
  getSnapshot,
  peekLoadedModAssets,
  type LoadedModsSnapshot,
} from "../registry";
import type { ModBlock } from "../types";
import type {
  GeneratedBlockFiles,
  GeneratedBlockProperties,
  GeneratedBlockProvider,
  GeneratedBlockResolution,
} from "./types";
import { UCW_PROVIDER } from "./ucw/provider";

// Built-in providers, one per namespace. Providers are added here.
const BUILTIN_PROVIDERS: readonly GeneratedBlockProvider[] = [UCW_PROVIDER];

let providers: ReadonlyMap<string, GeneratedBlockProvider> =
  byNamespace(BUILTIN_PROVIDERS);

let filesCache: {
  for: LoadedModsSnapshot;
  value: Map<string, GeneratedBlockFiles>;
} | null = null;

function byNamespace(
  list: readonly GeneratedBlockProvider[],
): ReadonlyMap<string, GeneratedBlockProvider> {
  return new Map(list.map((provider) => [provider.namespace, provider]));
}

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** The provider generating blocks in `namespace`, or null. */
export function getGeneratedBlockProvider(
  namespace: string,
): GeneratedBlockProvider | null {
  return providers.get(namespace) ?? null;
}

/** Every registered provider. */
export function getGeneratedBlockProviders(): readonly GeneratedBlockProvider[] {
  return [...providers.values()];
}

function buildFiles(
  snapshot: LoadedModsSnapshot,
  gameVersion: string,
): GeneratedBlockFiles {
  const files = snapshot.filter((mod) => mod.gameVersion === gameVersion);
  const fileForNamespace = (namespace: string) => {
    for (const mod of snapshot) {
      if (!mod.namespaces.includes(namespace)) continue;
      const file = getLoadedModFile(mod.modId, gameVersion);
      if (file?.namespaces.includes(namespace)) return file;
    }
    return null;
  };
  return {
    gameVersion,
    files,
    fileForNamespace,
    blocks: (namespace) => getModBlocksForVersion(namespace, gameVersion),
    assets: (file) => peekLoadedModAssets(file.key),
    providerData(providerNamespace) {
      const file = fileForNamespace(providerNamespace);
      if (file === null) return undefined;
      return peekLoadedModAssets(file.key)?.providerData?.[providerNamespace];
    },
  };
}

/**
 * The files loaded for `gameVersion`, with whatever assets are already in
 * memory. Stable identity per registry snapshot and version.
 */
export function getGeneratedBlockFiles(
  gameVersion: string,
): GeneratedBlockFiles {
  const snapshot = getSnapshot();
  if (filesCache?.for !== snapshot) {
    filesCache = { for: snapshot, value: new Map() };
  }
  let files = filesCache.value.get(gameVersion);
  if (files === undefined) {
    files = buildFiles(snapshot, gameVersion);
    filesCache.value.set(gameVersion, files);
  }
  return files;
}

/**
 * `getGeneratedBlockFiles` after reading every file's assets into memory
 * (files whose assets can't be read stay without them).
 */
export async function loadGeneratedBlockFiles(
  gameVersion: string,
): Promise<GeneratedBlockFiles> {
  const files = getGeneratedBlockFiles(gameVersion);
  await Promise.all(files.files.map((file) => getLoadedModAssets(file.key)));
  return getGeneratedBlockFiles(gameVersion);
}

/**
 * Resolve a block state through the provider of its namespace, against the
 * files loaded for `gameVersion`. `unrecognised` when no provider owns the
 * namespace or the provider doesn't know the block.
 */
export function resolveGeneratedBlock(
  id: string,
  properties: GeneratedBlockProperties,
  gameVersion: string,
): GeneratedBlockResolution {
  const provider = getGeneratedBlockProvider(namespaceOf(id));
  if (provider === null) return { kind: "unrecognised" };
  return provider.resolve(id, properties, getGeneratedBlockFiles(gameVersion));
}

/** Every block the providers can generate from the files for `gameVersion`. */
export function enumerateGeneratedBlocks(gameVersion: string): ModBlock[] {
  const files = getGeneratedBlockFiles(gameVersion);
  return [...providers.values()].flatMap((provider) =>
    provider.enumerate(files),
  );
}

// Test-only: replace the registered providers (null restores the built-ins).
export function __setGeneratedBlockProvidersForTests(
  list: readonly GeneratedBlockProvider[] | null,
): void {
  providers = byNamespace(list ?? BUILTIN_PROVIDERS);
  filesCache = null;
}
