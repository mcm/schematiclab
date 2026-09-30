// Pure helper: which mod namespaces a schematic uses, and how much.

export interface SchematicNamespace {
  namespace: string;
  /** Distinct palette block states in this namespace. */
  blockStateCount: number;
  /** Placed blocks in this namespace. */
  blockCount: number;
}

/**
 * The non-`minecraft` namespaces in `palette` with their block-state and
 * block counts, sorted by namespace. Ids without a namespace are vanilla.
 * (Invisible blocks are all `minecraft:`-namespaced, so they're skipped too.)
 */
export function detectSchematicNamespaces(
  palette: readonly { blockId: string; count: number }[],
): SchematicNamespace[] {
  const byNamespace = new Map<string, SchematicNamespace>();
  for (const entry of palette) {
    const colon = entry.blockId.indexOf(":");
    if (colon < 0) continue;
    const namespace = entry.blockId.slice(0, colon);
    if (namespace === "minecraft") continue;
    let summary = byNamespace.get(namespace);
    if (summary === undefined) {
      summary = { namespace, blockStateCount: 0, blockCount: 0 };
      byNamespace.set(namespace, summary);
    }
    summary.blockStateCount += 1;
    summary.blockCount += entry.count;
  }
  return [...byNamespace.values()].sort((a, b) =>
    a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0,
  );
}

/**
 * The namespaces in `detected` that have no project mapping. A mapped
 * namespace never counts, even if its mod failed to load.
 */
export function unmappedNamespaces(
  detected: readonly SchematicNamespace[],
  mappings: ReadonlyMap<string, unknown>,
): SchematicNamespace[] {
  return detected.filter((entry) => !mappings.has(entry.namespace));
}
