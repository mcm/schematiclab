import { describe, expect, it } from "vitest";

import {
  parseSchematic,
  serializeSchematic,
  type ParsedSchematicProjection,
  type SchematicFormatId,
} from "../../convert";
import {
  buildShapePreview,
  buildShapeProjection,
  defaultShapeName,
  materialForVersion,
  MAX_SHAPE_BLOCKS,
  parseMaterial,
  type ShapeSpec,
} from "../generate";

// Every block's position as "x,y,z", moved so the smallest corner is 0,0,0.
function blockPositions(
  projection: ParsedSchematicProjection,
  blockId: string,
): string[] {
  const positions: [number, number, number][] = [];
  for (const region of projection.regions) {
    for (const block of region.blocks) {
      if (projection.palette[block.paletteIndex].blockId !== blockId) continue;
      positions.push([
        region.origin[0] + block.pos[0],
        region.origin[1] + block.pos[1],
        region.origin[2] + block.pos[2],
      ]);
    }
  }
  const min = [0, 1, 2].map((i) => Math.min(...positions.map((p) => p[i])));
  return positions.map((p) => p.map((v, i) => v - min[i]).join(",")).sort();
}

const SPHERE: ShapeSpec = {
  shape: "ellipsoid",
  width: 5,
  height: 5,
  depth: 5,
  material: "minecraft:stone_bricks",
  versionId: "1.20.1",
};

describe("parseMaterial", () => {
  it("defaults the namespace and reads properties", () => {
    expect(parseMaterial(" Oak_Log[axis=x] ")).toEqual({
      ok: true,
      material: { blockId: "minecraft:oak_log", properties: { axis: "x" } },
    });
    expect(parseMaterial("create:andesite_casing")).toEqual({
      ok: true,
      material: { blockId: "create:andesite_casing", properties: {} },
    });
  });

  it("rejects malformed ids, properties and air", () => {
    expect(parseMaterial("").ok).toBe(false);
    expect(parseMaterial("not a block").ok).toBe(false);
    expect(parseMaterial("minecraft:oak_log[axis]").ok).toBe(false);
    expect(parseMaterial("air").ok).toBe(false);
  });
});

describe("buildShapeProjection", () => {
  it("builds a one-material projection of the shape", () => {
    const result = buildShapeProjection(SPHERE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { projection } = result;
    expect(projection.minecraftVersion.versionNumber).toEqual([1, 20, 1]);
    expect(projection.palette).toEqual([
      {
        blockState: "minecraft:stone_bricks",
        blockId: "minecraft:stone_bricks",
        properties: {},
        count: projection.totalBlocks,
      },
    ]);
    expect(projection.regions[0].size).toEqual([5, 5, 5]);
    expect(projection.regions[0].blocks).toHaveLength(projection.totalBlocks);
    expect(projection.name).toBe("stone_bricks_ellipsoid_5x5x5");
  });

  it("writes properties into the block state in sorted order", () => {
    const result = buildShapeProjection({
      ...SPHERE,
      material: "oak_stairs[half=top,facing=east]",
    });
    expect(result.ok && result.projection.palette[0].blockState).toBe(
      "minecraft:oak_stairs[facing=east,half=top]",
    );
  });

  it("rejects vanilla blocks the version doesn't have", () => {
    const result = buildShapeProjection({
      ...SPHERE,
      material: "minecraft:copper_block",
      versionId: "1.16.5",
    });
    expect(result).toEqual({
      ok: false,
      error: "minecraft:copper_block isn't a block in Minecraft 1.16.5.",
    });
  });

  it("accepts mod blocks as typed", () => {
    const result = buildShapeProjection({
      ...SPHERE,
      material: "create:andesite_casing",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects shapes over the block limit", () => {
    const result = buildShapeProjection({
      ...SPHERE,
      shape: "cuboid",
      width: 256,
      height: 256,
      depth: 256,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(MAX_SHAPE_BLOCKS.toLocaleString("en-US"));
  });

  it("writes 1.12.2 shapes with Forge 1.12 block states", () => {
    const result = buildShapeProjection({
      ...SPHERE,
      material: "minecraft:granite",
      versionId: "1.12.2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.palette[0].blockState).toBe(
      "minecraft:stone[variant=granite]",
    );
    const exported = serializeSchematic({
      schematic: result.projection,
      inputFilename: "granite.litematic",
      outputFormat: "Litematic",
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const parsed = parseSchematic(exported.bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schematic.minecraftVersion.versionNumber).toEqual([1, 12, 2]);
    expect(parsed.schematic.palette.map((e) => e.blockState)).toContain(
      "minecraft:stone[variant=granite]",
    );
  });

  it("keeps 1.12.2 block properties the material sets", () => {
    const parsed = parseMaterial("oak_log[axis=x]");
    if (!parsed.ok) throw new Error(parsed.error);
    const written = materialForVersion(parsed.material, "1.12.2");
    expect(written.ok && written.state.toString()).toBe(
      "minecraft:log[axis=x,variant=oak]",
    );
    const mod = materialForVersion(
      { blockId: "chisel:marble", properties: { variation: "3" } },
      "1.12.2",
    );
    expect(mod.ok && mod.state.toString()).toBe("chisel:marble[variation=3]");
  });

  const formats: SchematicFormatId[] = [
    "Litematic",
    "Sponge[v1]",
    "Sponge[v2]",
    "Sponge[v3]",
    "Structure",
    "StructurizeBlueprint",
  ];
  it.each(formats)("round-trips through %s", (format) => {
    const spec: ShapeSpec = { ...SPHERE, hollow: true, versionId: "1.19.4" };
    const result = buildShapeProjection(spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const exported = serializeSchematic({
      schematic: result.projection,
      inputFilename: `${defaultShapeName(spec)}.out`,
      outputFormat: format,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.filename.startsWith("stone_bricks_hollow_ellipsoid")).toBe(
      true,
    );
    const parsed = parseSchematic(exported.bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const blocks = parsed.schematic.palette.filter(
      (e) => e.blockId === "minecraft:stone_bricks",
    );
    expect(blocks.reduce((n, e) => n + e.count, 0)).toBe(
      result.projection.totalBlocks,
    );
    expect(blockPositions(parsed.schematic, "minecraft:stone_bricks")).toEqual(
      blockPositions(result.projection, "minecraft:stone_bricks"),
    );
  });
});

describe("buildShapePreview", () => {
  it("leaves out the schematic of shapes over the preview limit", () => {
    const full = buildShapeProjection(SPHERE);
    if (!full.ok) throw new Error(full.error);
    const total = full.projection.totalBlocks;
    expect(buildShapePreview(SPHERE, total)).toEqual({
      ok: true,
      totalBlocks: total,
      size: [5, 5, 5],
      projection: full.projection,
    });
    expect(buildShapePreview(SPHERE, total - 1)).toEqual({
      ok: true,
      totalBlocks: total,
      size: [5, 5, 5],
      projection: null,
    });
  });

  it("reports why a shape can't be built", () => {
    expect(buildShapePreview({ ...SPHERE, material: "air" }, 10).ok).toBe(
      false,
    );
  });
});
