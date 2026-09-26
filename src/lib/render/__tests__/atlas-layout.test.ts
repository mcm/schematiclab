import { afterEach, describe, expect, it, vi } from "vitest";

import vanillaRects from "../../../../public/minecraft-assets/atlas-uvs.json";
import {
  CELL_SIZE,
  MISSING_TEXTURE_ID,
  findFreeCell,
  planAtlas,
  qualifyId,
  vanillaUvMap,
  type PixelRect,
} from "../atlas-layout";

const VANILLA = vanillaRects as unknown as Record<string, PixelRect>;

// Frozen copy of the pre-mod UV conversion in `minecraft-resources.ts`.
function legacyUvMap(
  rects: Record<string, PixelRect>,
  atlasW: number,
  atlasH: number,
): Record<string, [number, number, number, number]> {
  const uvMap: Record<string, [number, number, number, number]> = {};
  for (const [path, rect] of Object.entries(rects)) {
    const [x, y, w, h] = rect;
    const frame = Math.min(w, h);
    uvMap[`minecraft:${path}`] = [
      x / atlasW,
      y / atlasH,
      (x + frame) / atlasW,
      (y + frame) / atlasH,
    ];
  }
  return uvMap;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("qualifyId", () => {
  it("defaults unprefixed references to minecraft", () => {
    expect(qualifyId("block/cube_all")).toBe("minecraft:block/cube_all");
    expect(qualifyId(":block/stone")).toBe("minecraft:block/stone");
  });

  it("keeps explicit namespaces", () => {
    expect(qualifyId("create:block/casing")).toBe("create:block/casing");
    expect(qualifyId("minecraft:block/stone")).toBe("minecraft:block/stone");
  });
});

describe("vanillaUvMap", () => {
  it("normalizes rects and keeps only the first animation frame", () => {
    const uv = vanillaUvMap(
      { "block/stone": [16, 32, 16, 16], "block/water_still": [0, 0, 16, 512] },
      1024,
      1024,
    );
    expect(uv["minecraft:block/stone"]).toEqual([
      16 / 1024,
      32 / 1024,
      32 / 1024,
      48 / 1024,
    ]);
    expect(uv["minecraft:block/water_still"]).toEqual([
      0,
      0,
      16 / 1024,
      16 / 1024,
    ]);
  });
});

describe("findFreeCell", () => {
  it("returns the last unoccupied cell", () => {
    expect(
      findFreeCell(
        [
          [0, 0, 32, 16],
          [16, 16, 16, 16],
        ],
        32,
        32,
      ),
    ).toEqual([0, 16, 16, 16]);
  });

  it("treats partially covered cells as occupied", () => {
    expect(findFreeCell([[0, 0, 17, 17]], 32, 32)).toBeNull();
  });
});

describe("planAtlas", () => {
  it("vanilla-only: same size and identical UVs to the legacy conversion", () => {
    const plan = planAtlas({
      baseWidth: 1024,
      baseHeight: 1024,
      vanillaRects: VANILLA,
      modTextures: [],
    });
    expect(plan.width).toBe(1024);
    expect(plan.height).toBe(1024);
    expect(plan.placements).toEqual([]);
    const { [MISSING_TEXTURE_ID]: missingUv, ...rest } = plan.uvMap;
    expect(rest).toEqual(legacyUvMap(VANILLA, 1024, 1024));
    // The missing texture reuses free space inside the vanilla atlas.
    expect(missingUv).toBeDefined();
    const [mx, my] = plan.missing;
    expect(findFreeCell(Object.values(VANILLA), 1024, 1024)).toEqual([
      mx,
      my,
      CELL_SIZE,
      CELL_SIZE,
    ]);
  });

  it("shelf-packs mod textures below the vanilla atlas", () => {
    const plan = planAtlas({
      baseWidth: 64,
      baseHeight: 64,
      vanillaRects: { "block/stone": [0, 0, 16, 16] },
      modTextures: [
        { id: "m:block/a", width: 16, height: 16 },
        { id: "m:block/b", width: 32, height: 32 },
        { id: "m:block/c", width: 16, height: 16 },
        { id: "m:block/d", width: 16, height: 16 },
        { id: "m:block/e", width: 16, height: 16 },
      ],
    });
    const dest = Object.fromEntries(plan.placements.map((p) => [p.id, p.dest]));
    // Tallest first on the first shelf, then left-to-right.
    expect(dest["m:block/b"]).toEqual([0, 64, 32, 32]);
    expect(dest["m:block/a"]).toEqual([32, 64, 16, 16]);
    expect(dest["m:block/c"]).toEqual([48, 64, 16, 16]);
    expect(dest["m:block/d"]).toEqual([0, 96, 16, 16]);
    expect(dest["m:block/e"]).toEqual([16, 96, 16, 16]);
    for (const p of plan.placements) {
      expect(p.dest[1]).toBeGreaterThanOrEqual(64);
    }
    // 64 + 32 + 16 = 112 → next power of two.
    expect(plan.width).toBe(64);
    expect(plan.height).toBe(128);
    // Vanilla UVs are renormalized against the grown atlas.
    expect(plan.uvMap["minecraft:block/stone"]).toEqual([
      0,
      0,
      16 / 64,
      16 / 128,
    ]);
    expect(plan.uvMap["m:block/b"]).toEqual([0, 64 / 128, 32 / 64, 96 / 128]);
  });

  it("uses only the first frame of animated textures", () => {
    const plan = planAtlas({
      baseWidth: 64,
      baseHeight: 64,
      vanillaRects: {},
      modTextures: [{ id: "m:block/anim", width: 16, height: 128 }],
    });
    expect(plan.placements).toEqual([
      { id: "m:block/anim", source: [0, 0, 16, 16], dest: [0, 64, 16, 16] },
    ]);
  });

  it("packs the missing texture when the vanilla atlas is full", () => {
    const plan = planAtlas({
      baseWidth: 16,
      baseHeight: 16,
      vanillaRects: { "block/stone": [0, 0, 16, 16] },
      modTextures: [],
    });
    expect(plan.missing).toEqual([0, 16, 16, 16]);
    expect(plan.height).toBe(32);
    expect(plan.uvMap[MISSING_TEXTURE_ID]).toEqual([0, 0.5, 1, 1]);
  });

  it("downscales large mod textures to 16×16 on overflow with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const modTextures = Array.from({ length: 8 }, (_, i) => ({
      id: `m:block/hd${i}`,
      width: 64,
      height: 64,
    }));
    modTextures.push({ id: "m:block/small", width: 8, height: 8 });
    const plan = planAtlas({
      baseWidth: 128,
      baseHeight: 128,
      vanillaRects: {},
      modTextures,
      maxSize: 256,
    });
    expect(plan.downscaled).toBe(true);
    expect(plan.dropped).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(plan.width).toBeLessThanOrEqual(256);
    expect(plan.height).toBeLessThanOrEqual(256);
    for (const p of plan.placements) {
      if (p.id === "m:block/small") {
        expect(p.dest.slice(2)).toEqual([8, 8]);
      } else {
        expect(p.source).toEqual([0, 0, 64, 64]);
        expect(p.dest.slice(2)).toEqual([16, 16]);
      }
    }
  });

  it("drops overflowing textures without claiming a downscale when none are oversized", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const modTextures = Array.from({ length: 5 }, (_, i) => ({
      id: `m:block/t${i}`,
      width: 16,
      height: 16,
    }));
    const plan = planAtlas({
      baseWidth: 32,
      baseHeight: 32,
      vanillaRects: {},
      modTextures,
      maxSize: 64,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toMatch(/downscaled/);
    expect(warn.mock.calls[0][0]).toMatch(/1 texture\(s\) did not fit/);
    expect(plan.downscaled).toBe(false);
    expect(plan.placements).toHaveLength(4);
    expect(plan.dropped).toEqual(["m:block/t4"]);
    expect(plan.uvMap["m:block/t4"]).toBeUndefined();
    expect(plan.height).toBe(64);
  });

  it("drops textures that still overflow after downscaling", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const modTextures = Array.from({ length: 9 }, (_, i) => ({
      id: `m:block/t${i}`,
      width: 16,
      height: 16,
    }));
    modTextures.push({ id: "m:block/hd", width: 64, height: 64 });
    const plan = planAtlas({
      baseWidth: 64,
      baseHeight: 32,
      vanillaRects: {},
      modTextures,
      maxSize: 64,
    });
    expect(plan.downscaled).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/downscaled to 16×16/);
    expect(warn.mock.calls[0][0]).toMatch(/2 texture\(s\) still did not fit/);
    expect(plan.placements).toHaveLength(8);
    expect(plan.dropped).toHaveLength(2);
  });

  it("keeps the atlas width when downscaling a texture wider than the base", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const modTextures = Array.from({ length: 8 }, (_, i) => ({
      id: `m:block/t${i}`,
      width: 16,
      height: 16,
    }));
    // A 64-wide strip widens the atlas to 64; downscaling it must not shrink
    // the retry back to the 32-wide base (4 free cells instead of 8).
    modTextures.push({ id: "m:block/strip", width: 64, height: 16 });
    const plan = planAtlas({
      baseWidth: 32,
      baseHeight: 32,
      vanillaRects: {},
      modTextures,
      maxSize: 64,
    });
    expect(plan.downscaled).toBe(true);
    expect(plan.width).toBe(64);
    expect(plan.placements).toHaveLength(8);
    expect(plan.dropped).toHaveLength(1);
  });

  it("does not warn when everything fits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    planAtlas({
      baseWidth: 64,
      baseHeight: 64,
      vanillaRects: {},
      modTextures: [{ id: "m:block/a", width: 32, height: 32 }],
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
