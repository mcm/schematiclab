import { describe, expect, it, vi } from "vitest";

import { forEachLimit } from "../for-each-limit";

describe("forEachLimit", () => {
  it("visits every item with at most `limit` in flight", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      seen.push(n);
      active -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("rejects invalid limits instead of skipping every item", async () => {
    const fn = vi.fn(async () => {});
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      await expect(forEachLimit([1], limit, fn)).rejects.toThrow(RangeError);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("starts no new items after a failure", async () => {
    const fn = vi.fn(async (n: number) => {
      if (n === 1) throw new Error("boom");
    });
    await expect(forEachLimit([1, 2, 3, 4], 1, fn)).rejects.toThrow("boom");
    // Let any stray runner continue before checking.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
