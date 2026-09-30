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

/** Property name → allowed values, first value is the fallback. */
export type ModBlockProperties = Record<string, string[]>;

export type ModNamespaceMapping =
  | { kind: "unmapped" }
  // The mod's file for the target version.
  | { kind: "target"; blocks: Record<string, ModBlockProperties> }
  // A replacement mod: `oldns:path` is rewritten to `newNamespace:path`.
  | {
      kind: "replace";
      newNamespace: string;
      blocks: Record<string, ModBlockProperties>;
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
  | "mod-not-available";

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
 * Best-effort fit of `properties` to a block's known property values:
 * unknown properties are dropped, unknown values become the first listed
 * value, and properties the source lacks stay unset.
 */
export function fitProperties(
  blockId: string,
  properties: Record<string, string>,
  known: ModBlockProperties,
): { properties: Record<string, string>; warnings: string[] } {
  const out: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(properties)) {
    const values = Object.hasOwn(known, name) ? known[name] : undefined;
    if (values === undefined) {
      warnings.push(`${blockId} has no property "${name}"; dropped.`);
      continue;
    }
    if (values.length > 0 && !values.includes(value)) {
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
  sourceBlockId: string,
  sourceProperties: Record<string, string>,
  missingMessage: string,
): ModdedResolution {
  if (!Object.hasOwn(blocks, blockId)) {
    return {
      status: "resolved",
      blockId: sourceBlockId,
      properties: { ...sourceProperties },
      problem: { reason: "missing-block", warnings: [missingMessage] },
    };
  }
  const fitted = fitProperties(blockId, properties, blocks[blockId]);
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
        blockId,
        properties,
        `${blockId} doesn't exist in the target version of the mod.`,
      );
    case "replace": {
      const rewritten = `${mapping.newNamespace}:${path}`;
      return validateAgainst(
        rewritten,
        properties,
        mapping.blocks,
        blockId,
        properties,
        `${rewritten} doesn't exist in the replacement mod.`,
      );
    }
  }
}
