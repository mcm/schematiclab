import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetVanillaBlockColorsForTests,
  loadVanillaBlockColors,
} from "../vanilla-block-colors";

afterEach(() => {
  __resetVanillaBlockColorsForTests();
  vi.restoreAllMocks();
});

const COLORS = { "minecraft:stone": { oklab: [0.6, 0, 0], fullCube: true } };

describe("loadVanillaBlockColors", () => {
  it("fetches block-colors.json once", async () => {
    const fetchImpl = vi.fn(async () => Response.json(COLORS));
    expect(await loadVanillaBlockColors(fetchImpl)).toEqual(COLORS);
    expect(await loadVanillaBlockColors(fetchImpl)).toEqual(COLORS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/minecraft-assets/block-colors.json",
    );
  });

  it("resolves null on failure and retries later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => new Response("", { status: 404 }));
    expect(await loadVanillaBlockColors(failing)).toBeNull();
    const working = vi.fn(async () => Response.json(COLORS));
    expect(await loadVanillaBlockColors(working)).toEqual(COLORS);
  });
});
