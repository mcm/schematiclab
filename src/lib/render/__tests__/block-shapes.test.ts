import { describe, expect, it } from "vitest";
import { blockShape, type BlockBox } from "../block-shapes";

const px = (n: number) => n / 16;

// Sorted, so tests don't depend on the order boxes are listed in.
const shape = (blockId: string, properties: Record<string, string> = {}) =>
  blockShape(blockId, properties)
    ?.map((b) => [...b])
    .sort((a, b) => a.join().localeCompare(b.join()));

const sorted = (boxes: BlockBox[]) =>
  boxes.map((b) => [...b]).sort((a, b) => a.join().localeCompare(b.join()));

const volume = (boxes: readonly BlockBox[]) =>
  boxes.reduce(
    (sum, [x0, y0, z0, x1, y1, z1]) => sum + (x1 - x0) * (y1 - y0) * (z1 - z0),
    0,
  );

describe("blockShape", () => {
  it("keeps every other block a full cube", () => {
    expect(blockShape("minecraft:stone", {})).toBeNull();
    expect(
      blockShape("minecraft:oak_fence_gate", { facing: "north" }),
    ).toBeNull();
    expect(
      blockShape("minecraft:oak_wall_sign", { facing: "north" }),
    ).toBeNull();
  });

  describe("stairs", () => {
    it("puts the step on the facing side, above a bottom slab", () => {
      expect(
        shape("minecraft:oak_stairs", {
          facing: "north",
          half: "bottom",
          shape: "straight",
        }),
      ).toEqual(
        sorted([
          [0, 0, 0, 1, 0.5, 1],
          [0, 0.5, 0, 1, 1, 0.5],
        ]),
      );
      expect(
        shape("minecraft:oak_stairs", { facing: "east", half: "bottom" }),
      ).toEqual(
        sorted([
          [0, 0, 0, 1, 0.5, 1],
          [0.5, 0.5, 0, 1, 1, 1],
        ]),
      );
    });

    it("flips upside-down stairs", () => {
      expect(
        shape("minecraft:stone_brick_stairs", {
          facing: "south",
          half: "top",
          shape: "straight",
        }),
      ).toEqual(
        sorted([
          [0, 0.5, 0, 1, 1, 1],
          [0, 0, 0.5, 1, 0.5, 1],
        ]),
      );
    });

    it("keeps one quarter on outer corners", () => {
      // Left of north is west, right is east.
      expect(
        shape("minecraft:oak_stairs", { facing: "north", shape: "outer_left" }),
      ).toContainEqual([0, 0.5, 0, 0.5, 1, 0.5]);
      expect(
        shape("minecraft:oak_stairs", {
          facing: "north",
          shape: "outer_right",
        }),
      ).toContainEqual([0.5, 0.5, 0, 1, 1, 0.5]);
      expect(
        volume(
          blockShape("minecraft:oak_stairs", {
            facing: "north",
            shape: "outer_left",
          })!,
        ),
      ).toBeCloseTo(0.625);
    });

    it("adds a quarter on inner corners", () => {
      const boxes = blockShape("minecraft:oak_stairs", {
        facing: "north",
        shape: "inner_left",
      })!;
      expect(volume(boxes)).toBeCloseTo(0.875);
      expect(sorted(boxes)).toContainEqual([0, 0.5, 0.5, 0.5, 1, 1]);
      expect(
        sorted(
          blockShape("minecraft:oak_stairs", {
            facing: "north",
            shape: "inner_right",
          })!,
        ),
      ).toContainEqual([0.5, 0.5, 0.5, 1, 1, 1]);
    });
  });

  describe("slabs", () => {
    it("fills the bottom, the top or the whole block", () => {
      expect(shape("minecraft:oak_slab", { type: "bottom" })).toEqual([
        [0, 0, 0, 1, 0.5, 1],
      ]);
      expect(shape("minecraft:oak_slab", { type: "top" })).toEqual([
        [0, 0.5, 0, 1, 1, 1],
      ]);
      expect(blockShape("minecraft:oak_slab", { type: "double" })).toBeNull();
    });
  });

  describe("fences, panes and walls", () => {
    it("draws a fence post with two rails per connection", () => {
      expect(shape("minecraft:oak_fence", {})).toEqual([
        [px(6), 0, px(6), px(10), 1, px(10)],
      ]);
      const boxes = shape("minecraft:oak_fence", {
        north: "true",
        east: "true",
        south: "false",
        west: "false",
      })!;
      expect(boxes).toHaveLength(5);
      expect(boxes).toContainEqual([px(7), px(6), 0, px(9), px(9), px(6)]);
      expect(boxes).toContainEqual([px(10), px(12), px(7), 1, px(15), px(9)]);
    });

    it("draws panes and iron bars as a thin post and full-height arms", () => {
      expect(
        shape("minecraft:glass_pane", { east: "true", west: "true" }),
      ).toEqual(
        sorted([
          [px(7), 0, px(7), px(9), 1, px(9)],
          [0, 0, px(7), px(7), 1, px(9)],
          [px(9), 0, px(7), 1, 1, px(9)],
        ]),
      );
      expect(shape("minecraft:iron_bars", { north: "true" })).toHaveLength(2);
    });

    it("draws wall posts and low or tall sides", () => {
      expect(
        shape("minecraft:cobblestone_wall", {
          up: "true",
          north: "low",
          south: "tall",
          east: "none",
          west: "none",
        }),
      ).toEqual(
        sorted([
          [px(4), 0, px(4), px(12), 1, px(12)],
          [px(5), 0, 0, px(11), px(14), px(4)],
          [px(5), 0, px(12), px(11), 1, 1],
        ]),
      );
      // No post: the sides meet in the middle.
      expect(
        shape("minecraft:cobblestone_wall", {
          up: "false",
          east: "low",
          west: "low",
        }),
      ).toEqual(
        sorted([
          [0, 0, px(5), 0.5, px(14), px(11)],
          [0.5, 0, px(5), 1, px(14), px(11)],
        ]),
      );
      // 1.13–1.15 walls use booleans.
      expect(
        shape("minecraft:cobblestone_wall", { up: "true", north: "true" }),
      ).toContainEqual([px(5), 0, 0, px(11), px(14), px(4)]);
    });
  });

  describe("doors and trapdoors", () => {
    it("puts a closed door against the side opposite its facing", () => {
      expect(
        shape("minecraft:oak_door", { facing: "north", open: "false" }),
      ).toEqual([[0, 0, px(13), 1, 1, 1]]);
      expect(
        shape("minecraft:oak_door", { facing: "east", open: "false" }),
      ).toEqual([[0, 0, 0, px(3), 1, 1]]);
    });

    it("swings an open door to its hinge side", () => {
      expect(
        shape("minecraft:oak_door", {
          facing: "north",
          open: "true",
          hinge: "right",
        }),
      ).toEqual([[px(13), 0, 0, 1, 1, 1]]);
      expect(
        shape("minecraft:oak_door", {
          facing: "north",
          open: "true",
          hinge: "left",
        }),
      ).toEqual([[0, 0, 0, px(3), 1, 1]]);
    });

    it("lays closed trapdoors flat and stands open ones up", () => {
      expect(
        shape("minecraft:oak_trapdoor", { half: "bottom", open: "false" }),
      ).toEqual([[0, 0, 0, 1, px(3), 1]]);
      expect(
        shape("minecraft:iron_trapdoor", { half: "top", open: "false" }),
      ).toEqual([[0, px(13), 0, 1, 1, 1]]);
      expect(
        shape("minecraft:oak_trapdoor", { facing: "west", open: "true" }),
      ).toEqual([[px(13), 0, 0, 1, 1, 1]]);
    });
  });

  it("draws carpets one pixel thick", () => {
    expect(shape("minecraft:red_carpet")).toEqual([[0, 0, 0, 1, px(1), 1]]);
    expect(shape("minecraft:moss_carpet")).toEqual([[0, 0, 0, 1, px(1), 1]]);
  });
});
