// Pure, dep-free helper for "should this block id be skipped before any
// downstream rendering / counting." Lives in its own module so callers (the
// editor-state edit ops, the swap mutator, the material list) can import it
// without dragging in the deepslate runtime that `minecraft-resources.ts`
// pulls in. Keeping this module dep-free is what keeps deepslate out of the
// `/` route's initial chunk (see US-017).

const INVISIBLE_BLOCK_IDS = new Set<string>([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:structure_void",
]);

export function isInvisibleBlockId(blockId: string): boolean {
  return INVISIBLE_BLOCK_IDS.has(blockId);
}
