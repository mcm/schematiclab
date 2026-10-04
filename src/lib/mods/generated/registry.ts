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
import type { LoadedModMeta, ModBlock } from "../types";
import type {
  GeneratedBlockFiles,
  GeneratedBlockProperties,
  GeneratedBlockProvider,
  GeneratedBlockResolution,
  GeneratedVanillaAssets,
} from "./types";
import {
  EVERYCOMP_PROVIDER,
  GEMSREALM_PROVIDER,
  STONEZONE_PROVIDER,
} from "./everycomp/provider";
import { UCW_PROVIDER } from "./ucw/provider";
import { loadGeneratedVanillaAssets } from "./vanilla-assets";

// Built-in providers, one per namespace. Providers are added here.
const BUILTIN_PROVIDERS: readonly GeneratedBlockProvider[] = [
  UCW_PROVIDER,
  EVERYCOMP_PROVIDER,
  STONEZONE_PROVIDER,
  GEMSREALM_PROVIDER,
];

let providers: ReadonlyMap<string, GeneratedBlockProvider> =
  byNamespace(BUILTIN_PROVIDERS);

// Vanilla assets once `loadGeneratedBlockFiles` has read them.
let vanillaAssets: GeneratedVanillaAssets | null = null;
let loadVanilla: () => Promise<GeneratedVanillaAssets | null> = () =>
  loadGeneratedVanillaAssets();

// Bumped when `loadGeneratedBlockFiles` brings assets into memory that
// weren't there before, so UI reading sync results (catalog, enumeration)
// can re-render.
let filesRevision = 0;
const loadedSignatures = new Map<string, string>();
const filesListeners = new Set<() => void>();

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
    get vanilla() {
      return vanillaAssets;
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
 * `getGeneratedBlockFiles` after reading every file's assets and the vanilla
 * assets into memory (files whose assets can't be read stay without them).
 */
export async function loadGeneratedBlockFiles(
  gameVersion: string,
): Promise<GeneratedBlockFiles> {
  const files = getGeneratedBlockFiles(gameVersion);
  const [vanilla] = await Promise.all([
    vanillaAssets ?? loadVanilla(),
    ...files.files.map((file) => getLoadedModAssets(file.key)),
  ]);
  vanillaAssets = vanilla;
  const loaded = getGeneratedBlockFiles(gameVersion);
  const signature = generatedAssetsSignature(loaded);
  if (signature !== loadedSignatures.get(gameVersion)) {
    loadedSignatures.set(gameVersion, signature);
    filesRevision++;
    for (const listener of filesListeners) listener();
  }
  return loaded;
}

/**
 * Which of `files`' assets are in memory: changes whenever results computed
 * from `files` may change (e.g. a file's rule data was read since).
 */
export function generatedAssetsSignature(files: GeneratedBlockFiles): string {
  const loaded = files.files
    .filter((file) => files.assets(file) !== null)
    .map((file) => file.key);
  return `${files.vanilla ? "vanilla" : "-"}|${loaded.join("|")}`;
}

/** Notified when `loadGeneratedBlockFiles` read new assets. */
export function subscribeGeneratedBlockFiles(listener: () => void): () => void {
  filesListeners.add(listener);
  return () => {
    filesListeners.delete(listener);
  };
}

/** Changes whenever `subscribeGeneratedBlockFiles` listeners are notified. */
export function getGeneratedBlockFilesRevision(): number {
  return filesRevision;
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

/** The blocks one provider can generate from the files of a version. */
export interface GeneratedBlockSet {
  provider: GeneratedBlockProvider;
  /** The loaded file providing the provider's namespace, or null. */
  file: LoadedModMeta | null;
  /** Sorted by id. */
  blocks: readonly ModBlock[];
}

// Enumerations per files view, redone when its in-memory assets change.
const enumerations = new WeakMap<
  GeneratedBlockFiles,
  { signature: string; value: readonly GeneratedBlockSet[] }
>();

/**
 * Per provider, every block it can generate from the files for
 * `gameVersion` (with the assets in memory; `loadGeneratedBlockFiles`
 * first). Providers that generate nothing are left out. Cached until the
 * files or their in-memory assets change.
 */
export function enumerateGeneratedBlockSets(
  gameVersion: string,
): readonly GeneratedBlockSet[] {
  const files = getGeneratedBlockFiles(gameVersion);
  const signature = generatedAssetsSignature(files);
  const cached = enumerations.get(files);
  if (cached?.signature === signature) return cached.value;
  const value = [...providers.values()]
    .map((provider) => ({
      provider,
      file: files.fileForNamespace(provider.namespace),
      blocks: provider.enumerate(files),
    }))
    .filter((set) => set.blocks.length > 0);
  enumerations.set(files, { signature, value });
  return value;
}

/**
 * The enumerated generated block `id` for `gameVersion` and its provider, or
 * null.
 */
export function getEnumeratedGeneratedBlock(
  id: string,
  gameVersion: string,
): { provider: GeneratedBlockProvider; block: ModBlock } | null {
  const provider = getGeneratedBlockProvider(namespaceOf(id));
  if (provider === null) return null;
  const set = enumerateGeneratedBlockSets(gameVersion).find(
    (s) => s.provider === provider,
  );
  const block = set?.blocks.find((b) => b.id === id);
  return block === undefined ? null : { provider, block };
}

/** Every block the providers can generate from the files for `gameVersion`. */
export function enumerateGeneratedBlocks(gameVersion: string): ModBlock[] {
  return enumerateGeneratedBlockSets(gameVersion).flatMap((set) => set.blocks);
}

// Test-only: replace the registered providers (null restores the built-ins).
export function __setGeneratedBlockProvidersForTests(
  list: readonly GeneratedBlockProvider[] | null,
): void {
  providers = byNamespace(list ?? BUILTIN_PROVIDERS);
  filesCache = null;
}

// Test-only: replace the vanilla asset loader (null restores the bundle's)
// and forget loaded vanilla assets.
export function __setGeneratedVanillaLoaderForTests(
  loader: (() => Promise<GeneratedVanillaAssets | null>) | null,
): void {
  loadVanilla = loader ?? (() => loadGeneratedVanillaAssets());
  vanillaAssets = null;
  loadedSignatures.clear();
}
