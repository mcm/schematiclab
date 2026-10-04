import { describe, expect, it } from "vitest";

import {
  buildShapeGrid,
  MAX_THICKNESS,
  SHAPE_KINDS,
  voxelIndex,
  type ShapeOptions,
  type VoxelGrid,
} from "../shapes";

function at(grid: VoxelGrid, x: number, y: number, z: number): boolean {
  return grid.filled[voxelIndex(grid.size, x, y, z)] === 1;
}

function layerCount(grid: VoxelGrid, y: number): number {
  let n = 0;
  for (let z = 0; z < grid.size[2]; z++) {
    for (let x = 0; x < grid.size[0]; x++) if (at(grid, x, y, z)) n++;
  }
  return n;
}

// Rows of the y layer, `#` for filled.
function layer(grid: VoxelGrid, y: number): string[] {
  const rows: string[] = [];
  for (let z = 0; z < grid.size[2]; z++) {
    let row = "";
    for (let x = 0; x < grid.size[0]; x++) row += at(grid, x, y, z) ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

describe("buildShapeGrid", () => {
  it("fills a cuboid", () => {
    const grid = buildShapeGrid({
      shape: "cuboid",
      width: 3,
      height: 4,
      depth: 5,
    });
    expect(grid.size).toEqual([3, 4, 5]);
    expect(grid.count).toBe(60);
  });

  it("hollows a cuboid into a closed shell", () => {
    const grid = buildShapeGrid({
      shape: "cuboid",
      width: 5,
      height: 5,
      depth: 5,
      hollow: true,
    });
    expect(grid.count).toBe(125 - 27);
    expect(at(grid, 2, 2, 2)).toBe(false);
    expect(at(grid, 0, 2, 2)).toBe(true);
  });

  it("hollows with a thicker wall", () => {
    const grid = buildShapeGrid({
      shape: "cuboid",
      width: 7,
      height: 7,
      depth: 7,
      hollow: true,
      thickness: 2,
    });
    expect(grid.count).toBe(343 - 27);
  });

  it("draws a symmetric sphere", () => {
    const grid = buildShapeGrid({
      shape: "ellipsoid",
      width: 7,
      height: 7,
      depth: 7,
    });
    expect(layer(grid, 3)).toEqual([
      "..###..",
      ".#####.",
      "#######",
      "#######",
      "#######",
      ".#####.",
      "..###..",
    ]);
    expect(layer(grid, 0)).toEqual(layer(grid, 6));
    expect(at(grid, 0, 0, 0)).toBe(false);
  });

  it("puts a dome's widest layer at the bottom", () => {
    const grid = buildShapeGrid({
      shape: "dome",
      width: 9,
      height: 5,
      depth: 9,
    });
    for (let y = 1; y < 5; y++) {
      expect(layerCount(grid, y)).toBeLessThanOrEqual(layerCount(grid, y - 1));
    }
    expect(layerCount(grid, 4)).toBeGreaterThan(0);
    expect(at(grid, 4, 0, 0)).toBe(true);
  });

  it("orients a cylinder along its axis", () => {
    const base: ShapeOptions = {
      shape: "cylinder",
      width: 5,
      height: 8,
      depth: 5,
    };
    const upright = buildShapeGrid(base);
    for (let y = 0; y < 8; y++) {
      expect(layer(upright, y)).toEqual(layer(upright, 0));
    }
    expect(at(upright, 0, 0, 0)).toBe(false);

    const tunnel = buildShapeGrid({
      ...base,
      width: 8,
      height: 5,
      axis: "x",
    });
    for (let x = 0; x < 8; x++) {
      expect(at(tunnel, x, 0, 0)).toBe(false);
      expect(at(tunnel, x, 2, 2)).toBe(true);
    }
  });

  it("steps a pyramid in by one block per layer", () => {
    const grid = buildShapeGrid({
      shape: "pyramid",
      width: 9,
      height: 5,
      depth: 9,
    });
    expect([0, 1, 2, 3, 4].map((y) => layerCount(grid, y))).toEqual([
      81, 49, 25, 9, 1,
    ]);
  });

  it("keeps a tapering shape's full height", () => {
    for (const shape of ["cone", "pyramid"] as const) {
      const grid = buildShapeGrid({ shape, width: 10, height: 20, depth: 10 });
      expect(layerCount(grid, 19)).toBeGreaterThan(0);
      expect(layerCount(grid, 19)).toBeLessThanOrEqual(4);
    }
  });

  it("fills every shape's bounding box on each axis", () => {
    for (const shape of SHAPE_KINDS) {
      const grid = buildShapeGrid({ shape, width: 6, height: 9, depth: 4 });
      const span = [new Set<number>(), new Set<number>(), new Set<number>()];
      for (let y = 0; y < 9; y++) {
        for (let z = 0; z < 4; z++) {
          for (let x = 0; x < 6; x++) {
            if (!at(grid, x, y, z)) continue;
            span[0].add(x);
            span[1].add(y);
            span[2].add(z);
          }
        }
      }
      expect(
        span.map((s) => s.size),
        shape,
      ).toEqual([6, 9, 4]);
    }
  });

  it("handles one-block dimensions", () => {
    for (const shape of SHAPE_KINDS) {
      const grid = buildShapeGrid({ shape, width: 1, height: 1, depth: 1 });
      expect(grid.count, shape).toBe(1);
    }
  });

  it("rejects out-of-range dimensions and thickness", () => {
    expect(() =>
      buildShapeGrid({ shape: "cuboid", width: 0, height: 1, depth: 1 }),
    ).toThrow(/Width/);
    expect(() =>
      buildShapeGrid({ shape: "cuboid", width: 1, height: 257, depth: 1 }),
    ).toThrow(/Height/);
    expect(() =>
      buildShapeGrid({ shape: "cuboid", width: 1, height: 1, depth: 1.5 }),
    ).toThrow(/Depth/);
    expect(() =>
      buildShapeGrid({
        shape: "cuboid",
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        thickness: 0,
      }),
    ).toThrow(/thickness/);
    expect(() =>
      buildShapeGrid({
        shape: "cuboid",
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        thickness: MAX_THICKNESS + 1,
      }),
    ).toThrow(/thickness/);
  });

  it("leaves the shape solid when the wall is thicker than its core", () => {
    const options: ShapeOptions = {
      shape: "ellipsoid",
      width: 9,
      height: 7,
      depth: 9,
    };
    const solid = buildShapeGrid(options);
    const thick = buildShapeGrid({
      ...options,
      hollow: true,
      thickness: MAX_THICKNESS,
    });
    expect(thick.count).toBe(solid.count);
    expect(thick.filled).toEqual(solid.filled);
  });
});
