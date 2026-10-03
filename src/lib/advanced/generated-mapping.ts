// Generated blocks (e.g. Unlimited Chisel Works) for the version-mapping
// context. A generated block isn't in its mod's file, so without this the
// mapping pass would report it `missing-block`; here each provider resolves
// the schematic's generated block ids against the files loaded for the
// target version, as plain data for `buildModMappingContext`.
//
// Pure TS, no DOM. Reads the generated-block registry, so call it on the
// main thread after `loadGeneratedBlockFiles(targetVersionId)`.

import { generatedNeedsModsMessage } from "../mods/generated/labels";
import {
  getGeneratedBlockProvider,
  resolveGeneratedBlock,
} from "../mods/generated/registry";
import type { GeneratedMappingBlock } from "./mod-mapping";

/** Namespace → block id → what its provider knows about it. */
export type GeneratedMappingBlocks = Record<
  string,
  Record<string, GeneratedMappingBlock>
>;

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** Whether a generated-block provider owns `blockId`'s namespace. */
export function hasGeneratedBlockProvider(blockId: string): boolean {
  return getGeneratedBlockProvider(namespaceOf(blockId)) !== null;
}

/**
 * Resolve every provider-owned id of `blockIds` against the files loaded
 * for `gameVersion`. Ids the provider doesn't recognise are left out (they
 * stay `missing-block`). `modNameFor` names a namespace's mod in messages.
 */
export function generatedMappingBlocks(
  blockIds: Iterable<string>,
  gameVersion: string,
  modNameFor?: (namespace: string) => string,
): GeneratedMappingBlocks {
  const out: GeneratedMappingBlocks = {};
  for (const id of new Set(blockIds)) {
    const namespace = namespaceOf(id);
    const provider = getGeneratedBlockProvider(namespace);
    if (provider === null) continue;
    // Whether a block resolves depends on its id only; the placement's
    // properties pick a state of the resolved block.
    const resolution = resolveGeneratedBlock(id, {}, gameVersion);
    let block: GeneratedMappingBlock;
    if (resolution.kind === "resolved") {
      block = { kind: "resolved", properties: resolution.block.properties };
    } else if (resolution.kind === "needs-mods") {
      block = {
        kind: "sources-missing",
        message: generatedNeedsModsMessage(
          resolution,
          provider.modName,
          gameVersion,
          modNameFor,
        ),
      };
    } else {
      continue;
    }
    (out[namespace] ??= {})[id] = block;
  }
  return out;
}
