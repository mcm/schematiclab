// Compat blocks a mod registers only when another mod is loaded, by block-id
// prefix. Their blockstates ship in the jar either way, so the upload drops
// the ones whose mod the pack lacks (`dropAbsentModCompatBlocks`).
//
// Hand-written: namespace → block-id prefix → the mod id the block needs.
// Update an entry when its mod changes its compat list.
//
// Pure. Imports carry their `.ts` extension so node's strip-types can load it.

export const COMPAT_BLOCK_PREFIXES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  // Dyenamics and Friends 2.2.2 (1.21.1): its `compat_packs/<modid>/` folders
  // and the prefixes of `assets/dyenamicsandfriends/blockstates/` (each
  // prefix names its compat pack's mod id, except `bumblezone_`).
  dyenamicsandfriends: {
    another_furniture_: "another_furniture",
    botanypots_: "botanypots",
    bumblezone_: "the_bumblezone",
    chalk_: "chalk",
    chromacarvings_: "chromacarvings",
    clayworks_: "clayworks",
    comforts_: "comforts",
    connectedglass_: "connectedglass",
    cookingforblockheads_: "cookingforblockheads",
    create_: "create",
    elevatorid_: "elevatorid",
    farmersdelight_: "farmersdelight",
    furnish_: "furnish",
    handcrafted_: "handcrafted",
    just_blahaj_: "just_blahaj",
    luminax_: "luminax",
    oreganized_: "oreganized",
    productivebees_: "productivebees",
    productivemetalworks_: "productivemetalworks",
    quark_: "quark",
    regions_unexplored_: "regions_unexplored",
    sleep_tight_: "sleep_tight",
    supplementaries_: "supplementaries",
    suppsquared_: "suppsquared",
  },
};

/** The compat-table entry a block id falls under. */
export interface CompatBlockRequirement {
  namespace: string;
  prefix: string;
  modId: string;
}

/** The entry for `id` (the longest matching prefix), else null. */
export function compatBlockRequirement(
  id: string,
  table: typeof COMPAT_BLOCK_PREFIXES = COMPAT_BLOCK_PREFIXES,
): CompatBlockRequirement | null {
  const colon = id.indexOf(":");
  const namespace = id.slice(0, colon);
  if (colon < 0 || !Object.hasOwn(table, namespace)) return null;
  const path = id.slice(colon + 1);
  let best: CompatBlockRequirement | null = null;
  for (const [prefix, modId] of Object.entries(table[namespace])) {
    if (
      path.startsWith(prefix) &&
      (best === null || prefix.length > best.prefix.length)
    ) {
      best = { namespace, prefix, modId };
    }
  }
  return best;
}

/** Compat blocks of one prefix left out because the pack lacks their mod. */
export interface DroppedCompatBlocks extends CompatBlockRequirement {
  count: number;
}

/**
 * Splits `blocks` into those kept and, per prefix, the count dropped because
 * `modIds` lacks the mod their prefix needs. Blocks under no prefix are kept.
 */
export function dropAbsentModCompatBlocks<T extends { id: string }>(
  blocks: readonly T[],
  modIds: ReadonlySet<string>,
  table: typeof COMPAT_BLOCK_PREFIXES = COMPAT_BLOCK_PREFIXES,
): { kept: T[]; dropped: DroppedCompatBlocks[] } {
  const kept: T[] = [];
  const dropped = new Map<string, DroppedCompatBlocks>();
  for (const block of blocks) {
    const needs = compatBlockRequirement(block.id, table);
    if (needs === null || modIds.has(needs.modId)) {
      kept.push(block);
      continue;
    }
    const key = `${needs.namespace}:${needs.prefix}`;
    const entry = dropped.get(key);
    if (entry === undefined) dropped.set(key, { ...needs, count: 1 });
    else entry.count += 1;
  }
  return { kept, dropped: [...dropped.values()] };
}
