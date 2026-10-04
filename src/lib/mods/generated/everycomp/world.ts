// The block-type world of one Minecraft version as the Every Compat family
// sees it: every registered block (vanilla, then the loaded files' blocks),
// approximate item and mod-loaded checks, and blockstate/model lookups. The
// detected block types (`detectBlockTypes`) are cached per files view and
// recomputed when the files' in-memory assets change.
//
// Worker-safe: no DOM access.

import { KNOWN_VERSIONS } from "../../../schemlib/schematic-formats/known-versions";
import { vanillaBlocksForVersion } from "../../../schemlib/data/vanilla-blocks";
import { generatedModelLookup } from "../model-lookup";
import { generatedAssetsSignature } from "../registry";
import type { GeneratedBlockFiles } from "../types";
import { detectBlockTypes } from "./block-types/detect";
import type { BlockTypeRegistries, BlockTypeWorld } from "./block-types/types";

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** The loaded mods' namespaces for `files` (plus `minecraft`). */
export function loadedNamespaces(files: GeneratedBlockFiles): Set<string> {
  const namespaces = new Set<string>(["minecraft"]);
  for (const file of files.files) {
    for (const namespace of file.namespaces) namespaces.add(namespace);
  }
  return namespaces;
}

/** `BlockTypeWorld` over the files loaded for one version. */
export function buildBlockTypeWorld(
  files: GeneratedBlockFiles,
): BlockTypeWorld {
  const version = KNOWN_VERSIONS[files.gameVersion];
  const vanilla =
    version === undefined ? [] : [...vanillaBlocksForVersion(version)].sort();
  const blockIds: string[] = [...vanilla];
  const blocks = new Set<string>(vanilla);
  const items = new Set<string>(vanilla);
  for (const file of files.files) {
    for (const block of [...file.blocks].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    )) {
      if (!blocks.has(block.id)) {
        blocks.add(block.id);
        blockIds.push(block.id);
      }
      items.add(block.id);
    }
    for (const item of files.assets(file)?.items ?? []) items.add(item);
  }
  const namespaces = loadedNamespaces(files);
  const models = generatedModelLookup(files);
  return {
    blockIds,
    hasBlock: (id) => blocks.has(id),
    hasItem: (id) => items.has(id),
    isModLoaded: (namespace) => namespaces.has(namespace),
    blockstate(id) {
      const namespace = namespaceOf(id);
      if (namespace === "minecraft") return files.vanilla?.blockstate(id);
      const file = files.fileForNamespace(namespace);
      const blockstates =
        file === null ? undefined : files.assets(file)?.blockstates;
      return blockstates !== undefined && Object.hasOwn(blockstates, id)
        ? blockstates[id]
        : undefined;
    },
    model: models,
  };
}

const cache = new WeakMap<
  GeneratedBlockFiles,
  { signature: string; world: BlockTypeWorld; registries: BlockTypeRegistries }
>();

/** The detected block types of `files` (cached until its assets change). */
export function blockTypeRegistries(files: GeneratedBlockFiles): {
  world: BlockTypeWorld;
  registries: BlockTypeRegistries;
} {
  const signature = generatedAssetsSignature(files);
  const cached = cache.get(files);
  if (cached?.signature === signature) return cached;
  const world = buildBlockTypeWorld(files);
  const value = { signature, world, registries: detectBlockTypes(world) };
  cache.set(files, value);
  return value;
}
