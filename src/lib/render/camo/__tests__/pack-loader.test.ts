import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetShapePacksForTests, loadShapePacks } from "../pack-loader";

const PACK = {
  formatVersion: 2,
  source: {
    mod: "framedblocks",
    repository: "test",
    commit: "test",
    modVersion: "test",
    license: "test",
  },
  blocks: {},
};

beforeEach(() => {
  __resetShapePacksForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadShapePacks", () => {
  it("fetches nothing when no camo-capable mod is loaded", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadShapePacks(new Set())).toEqual([]);
    expect(await loadShapePacks(new Set(["create_like", "mekanism"]))).toEqual(
      [],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a loaded namespace's pack once", async () => {
    const fetchMock = vi.fn(async () => Response.json(PACK));
    vi.stubGlobal("fetch", fetchMock);
    const [pack] = await loadShapePacks(new Set(["framedblocks"]));
    expect(pack.source.mod).toBe("framedblocks");
    await loadShapePacks(new Set(["framedblocks"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/camo-shapes/framedblocks.json");
  });

  it("drops a pack with an unknown formatVersion", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json({ ...PACK, formatVersion: 3 }),
    );
    expect(await loadShapePacks(new Set(["framedblocks"]), fetchMock)).toEqual(
      [],
    );
  });

  it("retries after a failed fetch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json(PACK));
    const namespaces = new Set(["framedblocks"]);
    expect(await loadShapePacks(namespaces, fetchMock)).toEqual([]);
    expect(await loadShapePacks(namespaces, fetchMock)).toHaveLength(1);
  });
});
