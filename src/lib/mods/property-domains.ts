// Fills in mod block-state property values that blockstate files leave out.
//
// A mod block's `properties` come from its blockstate JSON
// (`extractProperties`), which only names the values that pick a model: a
// multipart fence tests `north=true` but never `north=false`, and properties
// that don't change the model (`waterlogged`) don't appear at all. The real
// definitions live in class files, which are never loaded. This widens the
// observed values to a likely full set:
//
//   - values that are all `true`/`false` become both booleans;
//   - otherwise, the smallest vanilla value set for the same property name
//     that contains every observed value (`facing=[north]` → the four
//     horizontal directions), when exactly one is smallest.
//
// Stored `properties` stay as observed, since they're the only evidence of
// which values mattered; completion happens where they're read.
//
// Pure TS, no DOM, Worker-safe.

import { VANILLA_PROPERTY_DOMAINS } from "../schemlib/data/vanilla-property-domains.generated";

const BOOLEAN_VALUES: readonly string[] = ["false", "true"];

/** Whether some vanilla block has a property called `name`. */
export function isVanillaPropertyName(name: string): boolean {
  return Object.hasOwn(VANILLA_PROPERTY_DOMAINS, name);
}

/**
 * `observed` widened to the property's likely full value set. Observed values
 * keep their order and come first (the first one stays the fallback); added
 * values follow in vanilla order.
 */
export function completePropertyValues(
  name: string,
  observed: readonly string[],
): string[] {
  if (observed.length === 0) return [];
  const extend = (domain: readonly string[]): string[] => [
    ...observed,
    ...domain.filter((value) => !observed.includes(value)),
  ];
  if (observed.every((value) => BOOLEAN_VALUES.includes(value))) {
    return extend(BOOLEAN_VALUES);
  }
  if (!isVanillaPropertyName(name)) return [...observed];
  const supersets = VANILLA_PROPERTY_DOMAINS[name].filter((domain) =>
    observed.every((value) => domain.includes(value)),
  );
  if (supersets.length === 0) return [...observed];
  const smallest = Math.min(...supersets.map((domain) => domain.length));
  const candidates = supersets.filter((domain) => domain.length === smallest);
  return candidates.length === 1 ? extend(candidates[0]) : [...observed];
}

/** `completePropertyValues` applied to every property of a block. */
export function completeBlockProperties(
  properties: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, values]) => [
      name,
      completePropertyValues(name, values),
    ]),
  );
}
