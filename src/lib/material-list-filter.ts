// Pure helpers behind the Material List's namespace multi-select filter.

export interface NamespaceOption {
  namespace: string;
  /** Distinct palette block states in this namespace. */
  blockStateCount: number;
  /** Whether the namespace has a project mapping; `null` for `minecraft`. */
  mapped: boolean | null;
}

/** The namespace of a block id; ids without one are vanilla. */
export function namespaceOf(blockId: string): string {
  const colon = blockId.indexOf(":");
  return colon === -1 ? "minecraft" : blockId.slice(0, colon);
}

/**
 * Every namespace in `palette` (`minecraft` included) with its block-state
 * count and mapping status, `minecraft` first and the rest sorted.
 */
export function namespaceOptions(
  palette: readonly { blockId: string }[],
  mappings: ReadonlyMap<string, unknown>,
): NamespaceOption[] {
  const counts = new Map<string, number>();
  for (const entry of palette) {
    const namespace = namespaceOf(entry.blockId);
    counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([namespace, blockStateCount]) => ({
      namespace,
      blockStateCount,
      mapped: namespace === "minecraft" ? null : mappings.has(namespace),
    }))
    .sort((a, b) =>
      a.namespace === "minecraft"
        ? -1
        : b.namespace === "minecraft"
          ? 1
          : a.namespace < b.namespace
            ? -1
            : a.namespace > b.namespace
              ? 1
              : 0,
    );
}

/** The unmapped (non-`minecraft`) namespaces among `options`. */
export function unmappedSelection(
  options: readonly NamespaceOption[],
): ReadonlySet<string> {
  return new Set(
    options.filter((o) => o.mapped === false).map((o) => o.namespace),
  );
}

/**
 * `selection` without namespaces no longer in `options`. Returns `selection`
 * itself when nothing dropped out, so it can be compared by identity.
 */
export function pruneSelection(
  selection: ReadonlySet<string>,
  options: readonly NamespaceOption[],
): ReadonlySet<string> {
  const present = new Set(options.map((o) => o.namespace));
  for (const namespace of selection) {
    if (!present.has(namespace)) {
      return new Set([...selection].filter((ns) => present.has(ns)));
    }
  }
  return selection;
}

/**
 * Rows whose namespace is selected (an empty selection keeps every row) and
 * that match the search predicate.
 */
export function filterPaletteRows<T extends { blockId: string }>(
  palette: readonly T[],
  selection: ReadonlySet<string>,
  matchesSearch: (entry: T) => boolean,
): T[] {
  return palette.filter(
    (entry) =>
      (selection.size === 0 || selection.has(namespaceOf(entry.blockId))) &&
      matchesSearch(entry),
  );
}
