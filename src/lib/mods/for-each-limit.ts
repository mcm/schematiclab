// Run an async callback over items with at most `limit` in flight at once, so
// hashing or reading hundreds of textures doesn't start every `arrayBuffer()`
// together. Rejects with the first error, like `Promise.all`; no new items
// start after a failure.

export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`forEachLimit: limit must be a positive integer`);
  }
  let next = 0;
  let failed = false;
  const run = async (): Promise<void> => {
    while (!failed && next < items.length) {
      try {
        await fn(items[next++]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}
