import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSchematic, type ParsedSchematicProjection } from "../../convert";
import { srgbToOklab } from "../block-appearance";
import {
  contactSheetLayout,
  drawContactSheet,
  tickStep,
} from "../contact-sheet";
import { isCamoCapableBlockId, placedCamoSlots } from "../../camo/extract";
import { averageHex, staticRenderColors } from "../static-render-colors";
import {
  buildVoxelModel,
  defaultPlanLevels,
  elevation,
  fadeHex,
  fallbackBlockColor,
  isoView,
  ISO_CORNERS,
  oklabToHex,
  planSlice,
  shadeHex,
  type VoxelModel,
} from "../static-views";

const BLOCK_COLORS: Record<string, string> = {
  "minecraft:stone": "#808080",
  "minecraft:oak_planks": "#a0784a",
  "minecraft:red_wool": "#a02020",
};

function projection(
  blocks: [string, [number, number, number]][],
  extra: Partial<ParsedSchematicProjection> = {},
): ParsedSchematicProjection {
  const ids = [...new Set(blocks.map(([id]) => id))];
  return {
    name: "Test",
    inputFormat: "Sponge[v2]",
    minecraftVersion: {
      platform: "java",
      versionNumber: [1, 20, 1],
      dataVersion: 3465,
    },
    totalBlocks: blocks.length,
    palette: ids.map((id) => ({
      blockState: id,
      blockId: id,
      properties: {},
      count: blocks.filter(([b]) => b === id).length,
    })),
    regions: [
      {
        origin: [0, 0, 0],
        size: [1, 1, 1],
        blocks: blocks.map(([id, pos]) => ({
          pos,
          paletteIndex: ids.indexOf(id),
        })),
        blockEntities: [],
      },
    ],
    ...extra,
  };
}

function model(blocks: [string, [number, number, number]][]): VoxelModel {
  const p = projection(blocks);
  return buildVoxelModel(
    p,
    (i) => BLOCK_COLORS[p.palette[i].blockId] ?? "#000000",
  );
}

const colorName = (m: VoxelModel, index: number) =>
  Object.keys(BLOCK_COLORS).find((id) => BLOCK_COLORS[id] === m.colors[index]);

describe("buildVoxelModel", () => {
  it("lets a later region's block, even air, replace an earlier one", () => {
    const p = projection([
      ["minecraft:stone", [0, 0, 0]],
      ["minecraft:stone", [5, 0, 0]],
      ["minecraft:oak_planks", [1, 0, 0]],
      ["minecraft:air", [5, 0, 0]],
    ]);
    const [region] = p.regions;
    p.regions = [
      { ...region, blocks: region.blocks.slice(0, 2) },
      { ...region, blocks: region.blocks.slice(2) },
    ];
    const m = buildVoxelModel(
      p,
      (i) => BLOCK_COLORS[p.palette[i].blockId] ?? "#000000",
    );
    // The air at x=5 clears the stone there, so the bounds shrink too.
    expect(m.size).toEqual([2, 1, 1]);
    expect(m.voxels.map((v) => [v.x, colorName(m, v.color)])).toEqual([
      [0, "minecraft:stone"],
      [1, "minecraft:oak_planks"],
    ]);
  });

  it("normalizes positions to the model's minimum and skips air", () => {
    const m = model([
      ["minecraft:stone", [10, 64, -5]],
      ["minecraft:air", [0, 0, 0]],
      ["minecraft:oak_planks", [12, 66, -3]],
    ]);
    expect(m.size).toEqual([3, 3, 3]);
    expect(m.voxels.map(({ x, y, z }) => [x, y, z])).toEqual([
      [0, 0, 0],
      [2, 2, 2],
    ]);
    expect(m.cells.get(0, 0, 0)).toBe(1);
    expect(m.cells.get(2, 2, 2)).toBe(2);
    expect(m.cells.get(1, 1, 1)).toBe(0);
    expect(m.cells.get(-1, 0, 0)).toBe(0);
    expect(m.colors).toEqual(["#808080", "#a0784a"]);
  });

  it("is empty when nothing is visible", () => {
    const m = model([["minecraft:air", [3, 3, 3]]]);
    expect(m.size).toEqual([0, 0, 0]);
    expect(m.voxels).toEqual([]);
  });

  it("lets a per-block colour override the palette colour", () => {
    const p = projection([
      ["minecraft:stone", [0, 0, 0]],
      ["minecraft:stone", [1, 0, 0]],
    ]);
    const m = buildVoxelModel(
      p,
      () => "#808080",
      (_region, pos) => (pos[0] === 1 ? "#ff0000" : undefined),
    );
    expect(m.voxels.map((v) => m.colors[v.color])).toEqual([
      "#808080",
      "#ff0000",
    ]);
  });
});

describe("isoView", () => {
  it("draws the three visible faces of a lone block", () => {
    const view = isoView(model([["minecraft:stone", [0, 0, 0]]]), "south-east");
    expect(view.faces.map((f) => f.kind)).toEqual(["top", "right", "left"]);
    expect(view.bounds.maxX - view.bounds.minX).toBeCloseTo(
      2 * Math.cos(Math.PI / 6),
    );
    expect(view.bounds.maxY - view.bounds.minY).toBeCloseTo(2);
  });

  it("culls faces hidden by a neighbour", () => {
    const m = model([
      ["minecraft:stone", [0, 0, 0]],
      ["minecraft:stone", [0, 1, 0]],
      ["minecraft:stone", [1, 0, 0]],
    ]);
    const view = isoView(m, "south-east");
    // The bottom-west block keeps only its south face: the block above
    // covers its top and the block to the east its east face.
    expect(view.faces).toHaveLength(7);
  });

  it("paints back to front", () => {
    const m = model([
      ["minecraft:stone", [1, 0, 1]],
      ["minecraft:oak_planks", [0, 0, 0]],
    ]);
    const view = isoView(m, "south-east");
    // The planks (further from a south-east camera) come first.
    expect(colorName(m, view.faces[0].color)).toBe("minecraft:oak_planks");
    expect(colorName(m, view.faces.at(-1)!.color)).toBe("minecraft:stone");
    const fromNorthWest = isoView(m, "north-west");
    expect(colorName(m, fromNorthWest.faces[0].color)).toBe("minecraft:stone");
  });

  it("points the compass at north for every corner", () => {
    const m = model([["minecraft:stone", [0, 0, 0]]]);
    const north = Object.fromEntries(
      ISO_CORNERS.map((c) => [
        c,
        isoView(m, c).north.map((n) => Math.sign(Math.round(n * 100))),
      ]),
    );
    // Up-right from the south-east, down-right from the north-east, and so on.
    expect(north).toEqual({
      "south-east": [1, -1],
      "north-east": [1, 1],
      "north-west": [-1, 1],
      "south-west": [-1, -1],
    });
  });

  it("leaves out blocks above maxY, exposing the layer below", () => {
    const m = model([
      ["minecraft:stone", [0, 0, 0]],
      ["minecraft:oak_planks", [0, 1, 0]],
    ]);
    expect(
      isoView(m, "south-east").faces.filter((f) => f.kind === "top"),
    ).toHaveLength(1);
    const cut = isoView(m, "south-east", { maxY: 0 });
    expect(cut.faces.map((f) => colorName(m, f.color))).toEqual([
      "minecraft:stone",
      "minecraft:stone",
      "minecraft:stone",
    ]);
  });
});

describe("elevation", () => {
  // An L: stone at the origin, planks south of it, wool on top of the planks.
  const m = model([
    ["minecraft:stone", [0, 0, 0]],
    ["minecraft:oak_planks", [0, 0, 1]],
    ["minecraft:red_wool", [0, 1, 1]],
    ["minecraft:stone", [1, 0, 0]],
  ]);
  const names = (grid: ReturnType<typeof elevation>) =>
    [...grid.cells].map((c) => (c < 0 ? null : colorName(m, c)));

  it("shows the front from the south, y up", () => {
    const grid = elevation(m, "front");
    expect([grid.width, grid.height]).toEqual([2, 2]);
    expect(names(grid)).toEqual([
      "minecraft:red_wool",
      null,
      "minecraft:oak_planks",
      "minecraft:stone",
    ]);
    expect(grid.nearness[2]).toBe(1);
    expect(grid.nearness[3]).toBe(0);
  });

  it("shows the side from the east, south on the left", () => {
    const grid = elevation(m, "side");
    expect([grid.width, grid.height]).toEqual([2, 2]);
    expect(names(grid)).toEqual([
      "minecraft:red_wool",
      null,
      "minecraft:oak_planks",
      "minecraft:stone",
    ]);
  });

  it("shows the top with north up and nearness by height", () => {
    const grid = elevation(m, "top");
    expect([grid.width, grid.height]).toEqual([2, 2]);
    expect(names(grid)).toEqual([
      "minecraft:stone",
      "minecraft:stone",
      "minecraft:red_wool",
      null,
    ]);
    expect([...grid.nearness]).toEqual([0, 0, 1, 0]);
  });
});

describe("planSlice", () => {
  it("shows the layer, with the layer below where it is empty", () => {
    const m = model([
      ["minecraft:stone", [0, 0, 0]],
      ["minecraft:stone", [1, 0, 0]],
      ["minecraft:oak_planks", [0, 1, 0]],
    ]);
    const grid = planSlice(m, 1);
    expect([...grid.cells].map((c) => colorName(m, c))).toEqual([
      "minecraft:oak_planks",
      "minecraft:stone",
    ]);
    expect([...grid.below!]).toEqual([0, 1]);
  });
});

describe("defaultPlanLevels", () => {
  it("picks the layers above the densest lower and upper layers", () => {
    const blocks: [string, [number, number, number]][] = [];
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) {
        blocks.push(["minecraft:stone", [x, 1, z]]);
        blocks.push(["minecraft:stone", [x, 6, z]]);
      }
    }
    blocks.push(["minecraft:stone", [0, 0, 0]], ["minecraft:stone", [0, 9, 0]]);
    expect(defaultPlanLevels(model(blocks))).toEqual([2, 7]);
  });

  it("prefers a floor over the slightly bigger foundation under it", () => {
    const blocks: [string, [number, number, number]][] = [];
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        blocks.push(["minecraft:stone", [x, 0, z]]);
        if (x > 0) blocks.push(["minecraft:oak_planks", [x, 1, z]]);
      }
    }
    blocks.push(["minecraft:stone", [0, 3, 0]]);
    expect(defaultPlanLevels(model(blocks))[0]).toBe(2);
  });

  it("stays inside a flat model", () => {
    expect(defaultPlanLevels(model([["minecraft:stone", [0, 0, 0]]]))).toEqual([
      0, 0,
    ]);
  });
});

describe("colours", () => {
  it("round-trips OKLab to sRGB hex", () => {
    expect(oklabToHex(srgbToOklab(0x12, 0x80, 0xfe))).toBe("#1280fe");
    expect(oklabToHex([1, 0, 0])).toBe("#ffffff");
    expect(oklabToHex([0, 0, 0])).toBe("#000000");
  });

  it("gives unknown blocks a stable colour", () => {
    expect(fallbackBlockColor("mod:thing")).toBe(
      fallbackBlockColor("mod:thing"),
    );
    expect(fallbackBlockColor("mod:thing")).toMatch(/^#[0-9a-f]{6}$/);
    expect(fallbackBlockColor("mod:thing")).not.toBe(
      fallbackBlockColor("mod:other"),
    );
  });

  it("shades and fades", () => {
    expect(shadeHex("#804020", 0.5)).toBe("#402010");
    expect(fadeHex("#000000", 0.5)).toBe("#808080");
  });

  function camoFixture(name: string) {
    const bytes = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../__tests__/fixtures", name)),
    );
    const parsed = parseSchematic(bytes);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.schematic;
  }

  // Each placement's filled camo slots, from its block entity.
  function filledCamos(schematic: ParsedSchematicProjection) {
    return schematic.regions.flatMap((region, regionIndex) =>
      region.blocks.flatMap(({ pos, paletteIndex }) => {
        const entry = schematic.palette[paletteIndex];
        if (!isCamoCapableBlockId(entry.blockId)) return [];
        const nbt = region.blockEntities.find(
          (be) => be.pos.join() === pos.join(),
        )?.nbt;
        const camos = placedCamoSlots(entry.blockId, entry.properties, nbt)
          .map((slot) => slot.state?.name)
          .filter((id): id is string => id !== undefined);
        return camos.length === 0
          ? []
          : [{ regionIndex, pos, paletteIndex, camos }];
      }),
    );
  }

  it.each(["framed_blocks_minimal_nbt.nbt", "framed_covered_1.nbt"])(
    "colours camo blocks by their camo, blending a double block's two (%s)",
    (fixture) => {
      const schematic = camoFixture(fixture);
      const colors = staticRenderColors(schematic, () => undefined);
      const placed = filledCamos(schematic);
      expect(placed.length).toBeGreaterThan(0);
      if (fixture === "framed_covered_1.nbt") {
        expect(placed.some(({ camos }) => new Set(camos).size === 2)).toBe(
          true,
        );
      }
      for (const { regionIndex, pos, paletteIndex, camos } of placed) {
        expect(colors.colorAt(regionIndex, pos, paletteIndex)).toBe(
          averageHex(camos.map(fallbackBlockColor)),
        );
      }
    },
  );

  it("averages hex colours", () => {
    expect(averageHex([])).toBeUndefined();
    expect(averageHex(["#102030"])).toBe("#102030");
    expect(averageHex(["#000000", "#ff8040"])).toBe("#804020");
  });
});

describe("contact sheet", () => {
  const m = model([
    ["minecraft:stone", [0, 0, 0]],
    ["minecraft:oak_planks", [3, 4, 2]],
  ]);

  it("lays out four iso views, three elevations, two plans and a cutaway", () => {
    const layout = contactSheetLayout(m, {
      name: "Pavilion",
      planLevels: [1, 3],
    });
    expect(layout.title).toBe("Pavilion");
    expect(layout.subtitle).toBe(
      "bounds [4, 5, 3] (x,y,z)  |  2 blocks  |  front = +z (south)",
    );
    expect(layout.panels.map((p) => p.title)).toEqual([
      "ISO 1",
      "ISO 2",
      "ISO 3",
      "ISO 4",
      "FRONT",
      "RIGHT SIDE",
      "TOP",
      "PLAN y=1",
      "PLAN y=3",
      "CUTAWAY",
    ]);
    const cutaway = layout.panels.at(-1)!;
    expect(cutaway.kind === "iso" && cutaway.maxY).toBe(1);
    for (const panel of layout.panels) {
      expect(panel.rect.x + panel.rect.width).toBeLessThanOrEqual(layout.width);
      expect(panel.rect.y + panel.rect.height).toBeLessThanOrEqual(
        layout.height,
      );
    }
  });

  it("draws every panel", () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "measureText"
            ? () => ({ width: 10 })
            : (...args: unknown[]) => {
                calls.push(`${String(prop)}:${args.length}`);
              },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const layout = contactSheetLayout(m, { name: "Pavilion" });
    drawContactSheet(ctx, m, layout);
    expect(calls.filter((c) => c.startsWith("fill:")).length).toBeGreaterThan(
      0,
    );
    expect(calls.filter((c) => c === "clip:0")).toHaveLength(
      layout.panels.length,
    );
  });

  it("spaces axis labels at least 24px apart", () => {
    expect(tickStep(20)).toBe(2);
    expect(tickStep(5)).toBe(5);
    expect(tickStep(0.3)).toBe(100);
  });
});
