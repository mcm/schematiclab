// The blocks a tool call may use: a Minecraft version's vanilla blocks, or,
// with a `modpack`, the pack's blocks (its Minecraft version's vanilla blocks
// plus its mod blocks). Every block-aware tool resolves its `version` and
// `modpack` inputs here, so they all check blocks the same way.

import {
  loadBlockData,
  type BlockData,
  type BlockInfo,
} from "../blockdata/load";
import { createBlockRegistry, type BlockRegistry } from "../blockdata/registry";
import { loadModpack, resolveModpack } from "../modpacks/reader";
import {
  createModpackRegistry,
  type ModpackBlocks,
} from "../modpacks/registry";
import type { ModpackData } from "../modpacks/schema";
import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/known-versions";
import type { McpDeps } from "./types";

export interface ToolBlocksArgs {
  version?: string;
  modpack?: string;
}

export interface ToolBlocks {
  /** The Minecraft version (the pack's with a modpack). */
  versionId: string;
  /** The version's vanilla block data. */
  data: BlockData;
  /** Vanilla blocks, layered with the pack's mod blocks with a modpack. */
  registry: BlockRegistry;
  /** The pack's blocks and mod block details; null without a modpack. */
  modpack: ModpackBlocks | null;
}

function checkVersion(versionId: string): string {
  if (!Object.hasOwn(KNOWN_VERSIONS, versionId)) {
    throw new Error(
      `Unknown Minecraft version '${versionId}'. Call list_versions for the supported versions.`,
    );
  }
  return versionId;
}

// Modpack registries per vanilla blocks and pack data (both cached
// upstream), so a pack's registry is built once per instance and reference.
const modpackCache = new WeakMap<
  ReadonlyMap<string, BlockInfo>,
  WeakMap<ModpackData, Map<string, ModpackBlocks>>
>();

/**
 * The blocks of `version`, or of `modpack` (a reference like
 * `all-the-mods-10@5678901`). With a modpack, `version` may be left out; one
 * that isn't the pack's Minecraft version is an error.
 */
export async function resolveToolBlocks(
  args: ToolBlocksArgs,
  deps: Pick<McpDeps, "fetch" | "blob">,
): Promise<ToolBlocks> {
  const version = args.version?.trim() || undefined;
  const ref = args.modpack?.trim() || undefined;

  if (ref === undefined) {
    if (version === undefined) {
      throw new Error("Give a version (or a modpack).");
    }
    const versionId = checkVersion(version);
    const data = await loadBlockData(versionId, { fetch: deps.fetch });
    return {
      versionId,
      data,
      registry: createBlockRegistry(data, versionId),
      modpack: null,
    };
  }

  if (!deps.blob) {
    throw new Error(
      "This server has no Blob store configured, so modpacks are unavailable.",
    );
  }
  const resolved = await resolveModpack(ref, deps.blob);
  const packVersion = resolved.version.minecraftVersion;
  if (version !== undefined && version !== packVersion) {
    throw new Error(
      `Modpack '${ref}' is Minecraft ${packVersion}; leave version out or pass ${packVersion}.`,
    );
  }
  if (!Object.hasOwn(KNOWN_VERSIONS, packVersion)) {
    throw new Error(
      `Modpack '${ref}' is Minecraft ${packVersion}, which this server has no block data for.`,
    );
  }
  const [data, pack] = await Promise.all([
    loadBlockData(packVersion, { fetch: deps.fetch }),
    loadModpack(resolved, deps.blob),
  ]);

  let byPack = modpackCache.get(data.blocks);
  if (!byPack) modpackCache.set(data.blocks, (byPack = new WeakMap()));
  let byRef = byPack.get(pack);
  if (!byRef) byPack.set(pack, (byRef = new Map()));
  let modpack = byRef.get(ref);
  if (!modpack) {
    const vanilla = createBlockRegistry(data, packVersion);
    modpack = createModpackRegistry(vanilla, pack, ref);
    byRef.set(ref, modpack);
  }
  return {
    versionId: packVersion,
    data,
    registry: modpack.registry,
    modpack,
  };
}
