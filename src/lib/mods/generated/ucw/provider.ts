// The Unlimited Chisel Works generated-block provider: recognises
// `unlimitedchiselworks:` blocks through the rules read from UCW's jar and
// resolves them to their `from` / `through` states (`resolve.ts`).
//
// Worker-safe: no DOM access.

import type { ModBlock } from "../../types";
import type {
  GeneratedBlockFiles,
  GeneratedBlockProvider,
  GeneratedBlockResolution,
} from "../types";
import { generateUcwTexture } from "./recolour";
import {
  resolveUcwBlock,
  ucwBlockId,
  ucwFromStates,
  ucwMissingNamespaces,
  ucwRules,
  ucwRulesInOrder,
  ucwSourceBlock,
  ucwThroughProperties,
  ucwThroughState,
  type UcwRuleRef,
} from "./resolve";
import { UCW_MOD_NAME, UCW_NAMESPACE, type UcwBlockState } from "./rules";

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

function titleCase(id: string): string {
  const path = id.slice(id.indexOf(":") + 1);
  return path
    .slice(path.lastIndexOf("/") + 1)
    .split(/[_\-\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function displayName(blockId: string, files: GeneratedBlockFiles): string {
  return (
    files.blocks(namespaceOf(blockId)).get(blockId)?.displayName ??
    titleCase(blockId)
  );
}

/** The `ModBlock` UCW registers for `ref`'s `from` state `from`. */
function ucwModBlock(
  id: string,
  ref: UcwRuleRef,
  from: UcwBlockState,
  files: GeneratedBlockFiles,
): ModBlock {
  const through = ucwSourceBlock(ref.rule.through);
  const properties = Object.fromEntries(
    [...(ucwThroughProperties(ref.rule, files) ?? [])]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, values]) => [name, [...values].sort()]),
  );
  return {
    id,
    displayName: `${displayName(from.block, files)} (${displayName(through, files)})`,
    properties,
  };
}

function sourceNamespaces(ref: UcwRuleRef): string[] {
  const { rule } = ref;
  const namespaces = new Set(
    [rule.from, rule.through, rule.basedUpon, rule.overlay]
      .filter((source) => source !== undefined)
      .map((source) => namespaceOf(ucwSourceBlock(source))),
  );
  namespaces.delete("minecraft");
  return [...namespaces].sort();
}

export const UCW_PROVIDER: GeneratedBlockProvider = {
  namespace: UCW_NAMESPACE,
  modName: UCW_MOD_NAME,

  enumerate(files) {
    const data = ucwRules(files);
    if (data === null) return [];
    const blocks = new Map<string, ModBlock>();
    for (const ref of ucwRulesInOrder(data)) {
      if (ucwMissingNamespaces(ref, files).length > 0) continue;
      for (const [meta, from] of ucwFromStates(ref.rule.from, files)) {
        const id = ucwBlockId(ref.rule, meta);
        // The first rule registering an id wins.
        if (!blocks.has(id)) {
          blocks.set(id, ucwModBlock(id, ref, from.state, files));
        }
      }
    }
    return [...blocks.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  },

  resolve(id, properties, files): GeneratedBlockResolution {
    const resolution = resolveUcwBlock(id, properties, files);
    if (resolution.kind === "unrecognised") return resolution;
    if (resolution.kind === "needs-mods") {
      const { ref } = resolution;
      if (ref === undefined) {
        return {
          kind: "needs-mods",
          provider: UCW_NAMESPACE,
          namespaces: resolution.namespaces,
          sourceBlocks: [],
        };
      }
      const from = ucwSourceBlock(ref.rule.from);
      const through = ucwSourceBlock(ref.rule.through);
      const throughLoaded =
        namespaceOf(through) === "minecraft" ||
        files.blocks(namespaceOf(through)).has(through);
      return {
        kind: "needs-mods",
        provider: UCW_NAMESPACE,
        namespaces: resolution.namespaces,
        sourceBlocks: [...new Set([from, through])],
        ...(throughLoaded
          ? {
              fallback: {
                id: through,
                properties: ucwThroughState(id, ref.rule, properties, files, [])
                  .properties,
              },
            }
          : {}),
      };
    }
    // The blockstate, models and texture recipes (run by `generateTexture`)
    // are synthesised from the `through` block's in the preview story; until
    // then the block resolves without render output.
    return {
      kind: "resolved",
      provider: UCW_NAMESPACE,
      block: ucwModBlock(id, resolution, resolution.from, files),
      blockstate: null,
      models: {},
      textures: [],
      approximate: resolution.approximate,
      sourceNamespaces: sourceNamespaces(resolution),
      ...(resolution.warnings.length > 0
        ? { warnings: resolution.warnings }
        : {}),
    };
  },

  generateTexture(recipe, sources) {
    return generateUcwTexture(recipe, sources);
  },
};
