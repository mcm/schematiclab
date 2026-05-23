import { describe, expect, it } from "vitest";

import {
  getBlockCatalog,
  isCatalogedBlockId,
  searchBlockCatalog,
} from "../block-catalog";

describe("block-catalog", () => {
  it("includes common vanilla block ids without property suffixes", () => {
    const catalog = getBlockCatalog();
    expect(catalog).toContain("minecraft:stone");
    expect(catalog).toContain("minecraft:spruce_planks");
    expect(catalog).toContain("minecraft:air");
    // Property-bearing entries are stripped.
    expect(catalog).not.toContain("minecraft:grass_block[snowy=false]");
    expect(catalog).toContain("minecraft:grass_block");
  });

  it("is sorted and unique", () => {
    const catalog = getBlockCatalog();
    for (let i = 1; i < catalog.length; i += 1) {
      expect(catalog[i].localeCompare(catalog[i - 1])).toBeGreaterThan(0);
    }
  });

  it("ranks prefix matches above substring matches", () => {
    const results = searchBlockCatalog("oak_pl", 10);
    expect(results[0]).toBe("minecraft:oak_planks");
  });

  it("returns substring matches when no prefix match exists", () => {
    const results = searchBlockCatalog("planks", 20);
    expect(results).toContain("minecraft:oak_planks");
    expect(results).toContain("minecraft:spruce_planks");
  });

  it("treats the bare-name shortcut (without minecraft:) as prefix", () => {
    const results = searchBlockCatalog("stone", 50);
    // stone proper should appear among the prefix hits, not lost in the tail.
    expect(results.slice(0, 5)).toContain("minecraft:stone");
  });

  it("isCatalogedBlockId returns true for known ids, false otherwise", () => {
    expect(isCatalogedBlockId("minecraft:stone")).toBe(true);
    expect(isCatalogedBlockId("modname:not_a_real_block")).toBe(false);
  });
});
