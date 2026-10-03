// Modded-block validation and rewrite for the version-mapping pass.
//
// The Version Mapping panel describes each non-`minecraft` namespace in the
// schematic as a `ModNamespaceMapping` (plain data, structured-cloneable, so
// it crosses into the convert worker as-is). `resolveModdedState` turns one
// source block state into the state the apply pass should write, plus the
// reason it needs the user's attention, if any. Preview and apply share it so
// they can't disagree.
//
// Namespaces absent from the context (and `minecraft`) take the vanilla path.
//
// Pure TS, no DOM, Worker-safe.

import {
  completePropertyValues,
  isVanillaPropertyName,
} from "../mods/property-domains";

/** Property name → allowed values, first value is the fallback. */
export type ModBlockProperties = Record<string, string[]>;

/**
 * A block a generated-block provider (`mods/generated/`) knows in the target
 * version: resolved from the loaded files (with the generated block's
 * properties), or recognised but missing source mods (`message` says which
 * to load).
 */
export type GeneratedMappingBlock =
  | { kind: "resolved"; properties: ModBlockProperties }
  | { kind: "sources-missing"; message: string };

export type ModNamespaceMapping =
  | { kind: "unmapped" }
  // The mod's file for the target version. `sourceBlocks` holds the mapped
  // mod's file for the schematic's version, when loaded. `generated` holds
  // the namespace's generated blocks (e.g. Unlimited Chisel Works), which
  // the file itself doesn't list, by block id.
  | {
      kind: "target";
      blocks: Record<string, ModBlockProperties>;
      sourceBlocks?: Record<string, ModBlockProperties>;
      generated?: Record<string, GeneratedMappingBlock>;
    }
  // A replacement mod: `oldns:path` is rewritten to `newNamespace:path`.
  | {
      kind: "replace";
      newNamespace: string;
      blocks: Record<string, ModBlockProperties>;
      sourceBlocks?: Record<string, ModBlockProperties>;
    }
  // The user declined a replacement.
  | { kind: "keep" }
  // The target file isn't loaded yet.
  | { kind: "pending" };

/** Namespace → mapping. */
export type ModMappingContext = Record<string, ModNamespaceMapping>;

export type ModdedProblemReason =
  | "missing-block"
  | "invalid-state"
  | "mod-unmapped"
  | "mod-not-available"
  | "generated-sources-missing";

export type ModdedResolution =
  | { status: "vanilla" }
  | { status: "pending" }
  | {
      status: "resolved";
      blockId: string;
      properties: Record<string, string>;
      // Absent when the state carries over cleanly.
      problem?: { reason: ModdedProblemReason; warnings: string[] };
    };

function namespaceAndPath(blockId: string): [string, string] {
  const colon = blockId.indexOf(":");
  if (colon < 0) return ["minecraft", blockId];
  return [blockId.slice(0, colon), blockId.slice(colon + 1)];
}

/**
 * Best-effort fit of `properties` to a block's known property values.
 *
 * `known` and `source` come from blockstate files, which only list the
 * properties and values that pick a model, so they're treated as partial
 * evidence (see `property-domains.ts`). `source` is the block in the mod's
 * file for the schematic's version, or null when that isn't loaded.
 *
 * - A property `known` lacks is dropped only when `source` lists it (it
 *   mattered before and is gone now) or, without `source`, when no vanilla
 *   block has a property of that name. Otherwise it's kept as-is.
 * - A value outside the completed `known` values becomes the first known
 *   value, unless `source` exists and doesn't list that value either.
 * - Properties the source lacks stay unset.
 */
export function fitProperties(
  blockId: string,
  properties: Record<string, string>,
  known: ModBlockProperties,
  source: ModBlockProperties | null = null,
): { properties: Record<string, string>; warnings: string[] } {
  const out: Record<string, string> = {};
  const warnings: string[] = [];
  const sourceValues = (name: string): string[] | undefined =>
    source !== null && Object.hasOwn(source, name)
      ? completePropertyValues(name, source[name])
      : undefined;
  for (const [name, value] of Object.entries(properties)) {
    const observed = Object.hasOwn(known, name) ? known[name] : undefined;
    if (observed === undefined) {
      const dropped =
        source !== null
          ? sourceValues(name) !== undefined
          : !isVanillaPropertyName(name);
      if (dropped) {
        warnings.push(`${blockId} has no property "${name}"; dropped.`);
      } else {
        out[name] = value;
      }
      continue;
    }
    const values = completePropertyValues(name, observed);
    const evidence =
      source === null || (sourceValues(name)?.includes(value) ?? false);
    if (values.length > 0 && !values.includes(value) && evidence) {
      out[name] = values[0];
      warnings.push(
        `${blockId} has no ${name}=${value}; using ${name}=${values[0]}.`,
      );
      continue;
    }
    out[name] = value;
  }
  return { properties: out, warnings };
}

function validateAgainst(
  blockId: string,
  properties: Record<string, string>,
  blocks: Record<string, ModBlockProperties>,
  sourceBlocks: Record<string, ModBlockProperties> | undefined,
  sourceBlockId: string,
  sourceProperties: Record<string, string>,
  missingMessage: string,
  generated?: Record<string, GeneratedMappingBlock>,
): ModdedResolution {
  // A generated block isn't in the mod's file; its provider knows it.
  const generatedBlock =
    generated !== undefined && Object.hasOwn(generated, blockId)
      ? generated[blockId]
      : undefined;
  let known: ModBlockProperties;
  if (Object.hasOwn(blocks, blockId)) {
    known = blocks[blockId];
  } else if (generatedBlock?.kind === "resolved") {
    known = generatedBlock.properties;
  } else {
    const problem =
      generatedBlock?.kind === "sources-missing"
        ? {
            reason: "generated-sources-missing" as const,
            warnings: [generatedBlock.message],
          }
        : { reason: "missing-block" as const, warnings: [missingMessage] };
    return {
      status: "resolved",
      blockId: sourceBlockId,
      properties: { ...sourceProperties },
      problem,
    };
  }
  const source =
    sourceBlocks !== undefined && Object.hasOwn(sourceBlocks, sourceBlockId)
      ? sourceBlocks[sourceBlockId]
      : null;
  const fitted = fitProperties(blockId, properties, known, source);
  return {
    status: "resolved",
    blockId,
    properties: fitted.properties,
    ...(fitted.warnings.length > 0
      ? { problem: { reason: "invalid-state", warnings: fitted.warnings } }
      : {}),
  };
}

export function resolveModdedState(
  blockId: string,
  properties: Record<string, string>,
  context: ModMappingContext,
): ModdedResolution {
  const [namespace, path] = namespaceAndPath(blockId);
  if (namespace === "minecraft" || !Object.hasOwn(context, namespace)) {
    return { status: "vanilla" };
  }
  const mapping = context[namespace];
  const unchanged = (reason: ModdedProblemReason, warning: string) =>
    ({
      status: "resolved",
      blockId,
      properties: { ...properties },
      problem: { reason, warnings: [warning] },
    }) satisfies ModdedResolution;

  switch (mapping.kind) {
    case "pending":
      return { status: "pending" };
    case "unmapped":
      return unchanged(
        "mod-unmapped",
        `Namespace "${namespace}" isn't mapped to a mod.`,
      );
    case "keep":
      return unchanged(
        "mod-not-available",
        `"${namespace}" has no file for the target version.`,
      );
    case "target":
      return validateAgainst(
        blockId,
        properties,
        mapping.blocks,
        mapping.sourceBlocks,
        blockId,
        properties,
        `${blockId} doesn't exist in the target version of the mod.`,
        mapping.generated,
      );
    case "replace": {
      const rewritten = `${mapping.newNamespace}:${path}`;
      return validateAgainst(
        rewritten,
        properties,
        mapping.blocks,
        mapping.sourceBlocks,
        blockId,
        properties,
        `${rewritten} doesn't exist in the replacement mod.`,
      );
    }
  }
}
