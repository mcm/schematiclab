// Small Java/Minecraft semantics the block-type ports rely on.
//
// - `idWithOptionalNamespace`: Moonlight `Utils.idWithOptionalNamespace`
//   (Moonlight Lib by MehVahdJukaar, Xel'Bayria and the Supplementaries Team,
//   https://github.com/MehVahdJukaar/Moonlight, branch 1.21, commit 72afa38,
//   Supplementaries Team License).
// - `javaReplace`: `String.replace(CharSequence, CharSequence)` (literal,
//   every occurrence).
// - `javaHashMapOrder`: the iteration order of a `java.util.HashMap<String,…>`
//   filled with default capacity. The finders' `childNames` is a HashMap, so
//   the order Moonlight adds a finder's children in (which decides BiMap
//   collisions) is the HashMap's, not the source order.
//
// Worker-safe: no DOM access.

export const MINECRAFT = "minecraft";

/** `ResourceLocation.parse`: `path` alone means `minecraft:path`. */
export function parseId(id: string): { namespace: string; path: string } {
  const colon = id.indexOf(":");
  if (colon < 0) return { namespace: MINECRAFT, path: id };
  return { namespace: id.slice(0, colon), path: id.slice(colon + 1) };
}

/** `ResourceLocation.parse(id).toString()`. */
export function normalizeId(id: string): string {
  const { namespace, path } = parseId(id);
  return `${namespace}:${path}`;
}

/** `Utils.idWithOptionalNamespace`: an id with `:` as is, else in `namespace`. */
export function idWithOptionalNamespace(id: string, namespace: string): string {
  return id.includes(":") ? normalizeId(id) : `${namespace}:${id}`;
}

/** Java `String.replace(target, replacement)`: literal, every occurrence. */
export function javaReplace(
  s: string,
  target: string,
  replacement: string,
): string {
  return s.split(target).join(replacement);
}

/** Java `String.hashCode()` (UTF-16 code units, int32 overflow). */
export function javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Entries in the order a default `HashMap<String, V>` iterates them after
 * putting them in this order: by bucket (`hash ^ hash >>> 16`, masked by the
 * table size), then insertion order within a bucket. A repeated key keeps its
 * first position and takes the last value, as `put` does.
 */
export function javaHashMapOrder<V>(
  entries: readonly (readonly [string, V])[],
): [string, V][] {
  const map = new Map<string, V>();
  for (const [k, v] of entries) map.set(k, v);
  let capacity = 16;
  while (map.size > capacity * 0.75) capacity *= 2;
  return [...map]
    .map((entry, index) => {
      const h = javaStringHashCode(entry[0]);
      return { entry, index, bucket: (h ^ (h >>> 16)) & (capacity - 1) };
    })
    .sort((a, b) => a.bucket - b.bucket || a.index - b.index)
    .map(({ entry }) => entry);
}
