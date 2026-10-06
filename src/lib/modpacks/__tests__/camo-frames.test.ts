import { describe, expect, it } from "vitest";
import { createBlockRegistry } from "../../blockdata/registry";
import { CAMO_BLOCK_PROPERTIES } from "../../camo/block-properties.generated";
import { CAMO_FRAME_KINDS } from "../../camo/frame-kinds";
import { serverShapePack } from "../../mcp/camo-options";
import { matchShapeRule } from "../../render/camo/shape-pack";
import { withCamoFrameState } from "../camo-frames";
import type { ModpackBlock } from "../schema";

const STAIRS = {
  facing: ["north", "east", "south", "west"],
  half: ["top", "bottom"],
  shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
  waterlogged: ["true", "false"],
};

const vanilla = createBlockRegistry(
  {
    sourceVersion: "1.21.1",
    translateOnExport: false,
    blocks: new Map([
      [
        "minecraft:oak_stairs",
        {
          properties: STAIRS,
          defaults: {
            facing: "north",
            half: "bottom",
            shape: "straight",
            waterlogged: "false",
          },
        },
      ],
    ]),
  },
  "1.21.1",
);
const noVanilla = createBlockRegistry(
  { sourceVersion: "1.21.1", translateOnExport: false, blocks: new Map() },
  "1.21.1",
);

// As uploaded from a jar whose blockstate has only a "" variant.
function placeholder(id: string): ModpackBlock {
  return {
    id,
    mod: "cf-1",
    displayName: id,
    properties: {},
    defaults: {},
    kind: "block",
    fullCube: true,
  };
}

describe("withCamoFrameState", () => {
  it("gives every camo block with shape rules a default state they match", () => {
    let checked = 0;
    for (const id of Object.keys(CAMO_BLOCK_PROPERTIES)) {
      const rules = serverShapePack(id.slice(0, id.indexOf(":")))?.blocks[id];
      if (!rules) continue;
      for (const registry of [vanilla, noVanilla]) {
        const block = withCamoFrameState(placeholder(id), registry);
        expect(matchShapeRule(rules, block.defaults), id).not.toBeNull();
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("takes properties from the fixtures, kinds from the vanilla shape", () => {
    const stairs = withCamoFrameState(
      placeholder("framedblocks:framed_stairs"),
      vanilla,
    );
    expect(stairs).toMatchObject({
      kind: "stairs",
      fullCube: false,
      defaults: { facing: "north", half: "bottom", shape: "straight" },
    });
    expect(stairs.properties.facing).toEqual(
      expect.arrayContaining(["north", "east", "south", "west"]),
    );
    for (const [id, kind] of Object.entries(CAMO_FRAME_KINDS)) {
      const block = withCamoFrameState(placeholder(id), vanilla);
      expect([block.kind, block.fullCube], id).toEqual([
        kind,
        kind === "block",
      ]);
    }
    // Frames without a vanilla shape are `unknown`.
    expect(
      withCamoFrameState(placeholder("framedblocks:framed_slope"), vanilla),
    ).toMatchObject({ kind: "unknown", fullCube: false });
  });

  it("keeps the jar's values and valid defaults, and leaves other blocks alone", () => {
    const block = withCamoFrameState(
      {
        ...placeholder("create:copycat_step"),
        properties: { facing: ["south"], extra: ["a", "b"] },
        defaults: { facing: "south", extra: "b" },
      },
      vanilla,
    );
    expect(block.properties.extra).toEqual(["a", "b"]);
    expect(block.defaults).toMatchObject({ facing: "south", extra: "b" });
    const plain = placeholder("create:brass_block");
    expect(withCamoFrameState(plain, vanilla)).toBe(plain);
  });
});
