import { describe, expect, it } from "vitest";

import {
  camoBlockProperties,
  carryCamoBlockProperties,
} from "../block-properties";

describe("carryCamoBlockProperties", () => {
  it("carries a modded stairs' properties over to framed stairs", () => {
    expect(
      carryCamoBlockProperties(
        {
          facing: "west",
          half: "top",
          shape: "outer_left",
          waterlogged: "true",
          color: "white",
        },
        "framedblocks:framed_stairs",
      ),
    ).toEqual({
      facing: "west",
      half: "top",
      shape: "outer_left",
      waterlogged: "true",
    });
  });

  it("drops values the target doesn't allow", () => {
    expect(
      carryCamoBlockProperties(
        { facing: "up", waterlogged: "false" },
        "framedblocks:framed_stairs",
      ),
    ).toEqual({ waterlogged: "false" });
  });

  it("carries nothing to blocks that aren't camo blocks", () => {
    expect(
      carryCamoBlockProperties({ facing: "north" }, "minecraft:oak_stairs"),
    ).toEqual({});
    expect(
      carryCamoBlockProperties({ facing: "north" }, "create:copycat_base"),
    ).toEqual({});
  });
});

describe("camoBlockProperties", () => {
  it("widens the fixtures' sampled values", () => {
    const stairs = camoBlockProperties("copycats:copycat_stairs");
    expect(stairs?.facing).toEqual(
      expect.arrayContaining(["north", "south", "west", "east"]),
    );
    expect(stairs?.waterlogged).toEqual(
      expect.arrayContaining(["true", "false"]),
    );
  });
});
