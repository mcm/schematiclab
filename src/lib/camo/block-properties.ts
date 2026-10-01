// Block-state properties of camo blocks (block-properties.generated.ts), and
// carrying a swapped block's properties over to a camo block.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import { completePropertyValues } from "../mods/property-domains";
import { CAMO_BLOCK_PROPERTIES } from "./block-properties.generated";

const completed = new Map<string, Record<string, string[]>>();

/**
 * Every state property of a camo block and its values, or undefined for
 * blocks without camo data. The fixtures only sample values (north and east
 * facings), so they're widened like a mod block's.
 */
export function camoBlockProperties(
  blockId: string,
): Readonly<Record<string, readonly string[]>> | undefined {
  if (!Object.hasOwn(CAMO_BLOCK_PROPERTIES, blockId)) return undefined;
  let properties = completed.get(blockId);
  if (properties === undefined) {
    properties = Object.fromEntries(
      Object.entries(CAMO_BLOCK_PROPERTIES[blockId]).map(([name, values]) => [
        name,
        completePropertyValues(name, values),
      ]),
    );
    completed.set(blockId, properties);
  }
  return properties;
}

/**
 * The properties of `source` that `targetBlockId` also has with the same
 * value allowed, e.g. a modded stairs' facing/half/shape/waterlogged for
 * framedblocks:framed_stairs. Empty when the target isn't a camo block.
 */
export function carryCamoBlockProperties(
  source: Readonly<Record<string, string>>,
  targetBlockId: string,
): Record<string, string> {
  const domains = camoBlockProperties(targetBlockId);
  if (domains === undefined) return {};
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        Object.hasOwn(domains, name) && domains[name].includes(value),
    ),
  );
}
