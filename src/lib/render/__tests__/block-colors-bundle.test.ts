import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { BlockAppearance } from "../block-appearance";

const FILE = join(
  __dirname,
  "../../../../public/minecraft-assets/block-colors.json",
);

describe("public/minecraft-assets/block-colors.json", () => {
  const colors = JSON.parse(readFileSync(FILE, "utf8")) as Record<
    string,
    BlockAppearance
  >;

  it("stays within its size budget", () => {
    expect(statSync(FILE).size).toBeLessThanOrEqual(150 * 1024);
  });

  it("maps namespaced block ids to { oklab, fullCube }", () => {
    const entries = Object.entries(colors);
    expect(entries.length).toBeGreaterThan(1000);
    for (const [id, appearance] of entries) {
      expect(id).toMatch(/^minecraft:[a-z0-9_/]+$/);
      expect(appearance.oklab).toHaveLength(3);
      expect(appearance.oklab[0]).toBeGreaterThanOrEqual(0);
      expect(appearance.oklab[0]).toBeLessThanOrEqual(1);
      expect(typeof appearance.fullCube).toBe("boolean");
    }
  });

  it("classifies well-known blocks", () => {
    expect(colors["minecraft:stone"].fullCube).toBe(true);
    expect(colors["minecraft:grass_block"].fullCube).toBe(true);
    expect(colors["minecraft:oak_stairs"].fullCube).toBe(false);
    expect(colors["minecraft:torch"].fullCube).toBe(false);
    // Stone is neutral grey; red wool is clearly red.
    expect(Math.abs(colors["minecraft:stone"].oklab[1])).toBeLessThan(0.01);
    expect(colors["minecraft:red_wool"].oklab[1]).toBeGreaterThan(0.1);
    // Default states, not the alphabetically first variant: a lit campfire
    // and a lit soul campfire (both "campfire_off" otherwise) differ.
    expect(colors["minecraft:soul_campfire"].oklab).not.toEqual(
      colors["minecraft:campfire"].oklab,
    );
  });
});
