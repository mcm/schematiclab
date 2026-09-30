// Run an async callback over items with at most `limit` in flight at once, so
// hashing or reading hundreds of textures doesn't start every `arrayBuffer()`
// together. Rejects with the first error, like `Promise.all`.

export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}
