import { describe, expect, it } from "vitest";

import { toNbtCompoundValue, type NbtCompoundValue } from "../../nbt-value";
import * as nbt from "../../schemlib/nbt";
import { fromSnbt } from "../../schemlib/snbt";
import { extractCamoSlots, isCamoCapableBlockId } from "../extract";

function be(snbt: string): NbtCompoundValue {
  const tag = fromSnbt(snbt);
  if (!(tag instanceof nbt.Compound))
    throw new Error(`not a compound: ${snbt}`);
  return toNbtCompoundValue(tag);
}

const OAK_LOG = `{Name:"minecraft:oak_log",Properties:{axis:"y"}}`;
const CHERRY_LOG = `{Name:"minecraft:cherry_log",Properties:{axis:"x"}}`;
const BASE = `{Name:"create:copycat_base"}`;
const oak = { name: "minecraft:oak_log", properties: { axis: "y" } };
const cherry = { name: "minecraft:cherry_log", properties: { axis: "x" } };

describe("isCamoCapableBlockId", () => {
  it.each([
    "framedblocks:framed_cube",
    "framedblocks:framed_double_slab",
    "copycats:copycat_slab",
    "copycats:copycat_block",
    "create:copycat_panel",
    "create:copycat_step",
  ])("accepts %s", (id) => {
    expect(isCamoCapableBlockId(id)).toBe(true);
  });

  it.each([
    "minecraft:stone",
    "create:cogwheel",
    "create:copycat",
    "minecraft:framedblocks_cube",
  ])("rejects %s", (id) => {
    expect(isCamoCapableBlockId(id)).toBe(false);
  });
});

describe("extractCamoSlots: FramedBlocks", () => {
  it("reads camo as a block slot", () => {
    const nbtValue = be(
      `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:block",state:${OAK_LOG}}}`,
    );
    expect(extractCamoSlots("framedblocks:framed_cube", {}, nbtValue)).toEqual([
      { slot: "camo", state: oak, kind: "block" },
    ]);
  });

  it("reads camo and camo_two in order on a double block", () => {
    const nbtValue = be(
      `{id:"framedblocks:framed_double_tile",camo_two:{type:"framedblocks:block",state:${CHERRY_LOG}},camo:{type:"framedblocks:block",state:{Name:"minecraft:stone"}}}`,
    );
    expect(
      extractCamoSlots("framedblocks:framed_double_slab", {}, nbtValue),
    ).toEqual([
      {
        slot: "camo",
        state: { name: "minecraft:stone", properties: {} },
        kind: "block",
      },
      { slot: "camo_two", state: cherry, kind: "block" },
    ]);
  });

  it("gives kind empty for framedblocks:empty", () => {
    const nbtValue = be(
      `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:empty"},camo_two:{type:"framedblocks:empty"}}`,
    );
    expect(
      extractCamoSlots("framedblocks:framed_double_slab", {}, nbtValue),
    ).toEqual([
      { slot: "camo", state: null, kind: "empty" },
      { slot: "camo_two", state: null, kind: "empty" },
    ]);
  });

  it("gives kind fluid with the fluid id as name", () => {
    const nbtValue = be(
      `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:fluid",fluid:"minecraft:water",flow_dir:"down"}}`,
    );
    expect(extractCamoSlots("framedblocks:framed_cube", {}, nbtValue)).toEqual([
      {
        slot: "camo",
        state: { name: "minecraft:water", properties: {} },
        kind: "fluid",
      },
    ]);
  });

  it("mixes a block camo with an empty camo_two", () => {
    const nbtValue = be(
      `{camo:{type:"framedblocks:block",state:${OAK_LOG}},camo_two:{type:"framedblocks:empty"}}`,
    );
    expect(
      extractCamoSlots("framedblocks:framed_double_slab", {}, nbtValue),
    ).toEqual([
      { slot: "camo", state: oak, kind: "block" },
      { slot: "camo_two", state: null, kind: "empty" },
    ]);
  });
});

describe("extractCamoSlots: single-state copycats", () => {
  it("reads Material from a Create copycat (1.21.1 Item.count)", () => {
    const nbtValue = be(
      `{id:"create:copycat",EnableCT:1b,Material:${OAK_LOG},Item:{id:"minecraft:oak_log",count:1}}`,
    );
    expect(
      extractCamoSlots("create:copycat_panel", { facing: "up" }, nbtValue),
    ).toEqual([{ slot: "material", state: oak, kind: "block" }]);
  });

  it("reads Material from a 1.20.1 copycat (Item.Count)", () => {
    const nbtValue = be(
      `{id:"create:copycat",EnableCT:1b,Material:${OAK_LOG},Item:{id:"minecraft:oak_log",Count:1b}}`,
    );
    expect(extractCamoSlots("create:copycat_step", {}, nbtValue)).toEqual([
      { slot: "material", state: oak, kind: "block" },
    ]);
  });

  it("reads Material from a Copycats+ single-state copycat", () => {
    const nbtValue = be(
      `{id:"copycats:copycat",EnableCT:1b,Material:${CHERRY_LOG},Item:{id:"minecraft:cherry_log",count:1}}`,
    );
    expect(extractCamoSlots("copycats:copycat_block", {}, nbtValue)).toEqual([
      { slot: "material", state: cherry, kind: "block" },
    ]);
  });

  it("gives kind empty for create:copycat_base", () => {
    const nbtValue = be(
      `{id:"create:copycat",EnableCT:1b,Material:${BASE},Item:{}}`,
    );
    expect(extractCamoSlots("create:copycat_panel", {}, nbtValue)).toEqual([
      { slot: "material", state: null, kind: "empty" },
    ]);
  });
});

describe("extractCamoSlots: multi-state copycats", () => {
  it("reads each material_data part as its own slot", () => {
    const nbtValue = be(
      `{id:"copycats:multistate_copycat",material_data:{top:{material:${CHERRY_LOG},enableCT:1b,consumedItem:{id:"minecraft:cherry_log",count:1}},bottom:{material:${OAK_LOG},enableCT:1b,consumedItem:{id:"minecraft:oak_log",count:1}}}}`,
    );
    expect(
      extractCamoSlots(
        "copycats:copycat_slab",
        { axis: "y", type: "double" },
        nbtValue,
      ),
    ).toEqual([
      { slot: "bottom", state: oak, kind: "block" },
      { slot: "top", state: cherry, kind: "block" },
    ]);
  });

  it("gives kind empty for a create:copycat_base part", () => {
    const nbtValue = be(
      `{material_data:{top:{material:${OAK_LOG},enableCT:1b,consumedItem:{id:"minecraft:oak_log",Count:1b}},bottom:{material:${BASE},enableCT:1b,consumedItem:{}}}}`,
    );
    expect(
      extractCamoSlots(
        "copycats:copycat_slab",
        { axis: "y", type: "double" },
        nbtValue,
      ),
    ).toEqual([
      { slot: "bottom", state: null, kind: "empty" },
      { slot: "top", state: oak, kind: "block" },
    ]);
  });

  it("keeps parts the table doesn't know, after the known ones", () => {
    const nbtValue = be(
      `{material_data:{extra:{material:${CHERRY_LOG}},shaft:{material:${OAK_LOG}},cogwheel:{material:${BASE}}}}`,
    );
    expect(
      extractCamoSlots("copycats:copycat_cogwheel", { axis: "y" }, nbtValue),
    ).toEqual([
      { slot: "cogwheel", state: null, kind: "empty" },
      { slot: "shaft", state: oak, kind: "block" },
      { slot: "extra", state: cherry, kind: "block" },
    ]);
  });

  it.each([
    [
      "copycats:copycat_slab",
      { axis: "y", type: "top", waterlogged: "false" },
      ["top"],
    ],
    ["copycats:copycat_slab", { axis: "x", type: "double" }, ["bottom", "top"]],
    [
      "copycats:copycat_board",
      {
        up: "true",
        down: "false",
        north: "true",
        east: "false",
        south: "false",
        west: "true",
      },
      ["up", "north", "west"],
    ],
    [
      "copycats:copycat_byte",
      { top_northeast: "true", bottom_southwest: "true" },
      ["top_northeast", "bottom_southwest"],
    ],
    [
      "copycats:copycat_byte_panel",
      { facing: "up", bottom_left: "true", top_right: "true" },
      ["bottom_left", "top_right"],
    ],
    [
      "copycats:copycat_half_layer",
      { axis: "x", half: "top", positive_layers: "4", negative_layers: "0" },
      ["positive_layers"],
    ],
    [
      "copycats:copycat_vertical_half_layer",
      { facing: "north", positive_layers: "2", negative_layers: "6" },
      ["positive_layers", "negative_layers"],
    ],
    [
      "copycats:copycat_stacked_half_layer",
      { facing: "east", positive_layers: "0", negative_layers: "8" },
      ["negative_layers"],
    ],
    ["copycats:copycat_cogwheel", { axis: "z" }, ["cogwheel", "shaft"]],
    ["copycats:copycat_large_cogwheel", { axis: "x" }, ["cogwheel", "shaft"]],
  ])(
    "a legacy plain Material on %s fills the enabled parts",
    (blockId, properties, parts) => {
      const nbtValue = be(
        `{id:"create:copycat",EnableCT:1b,Material:${OAK_LOG},Item:{id:"minecraft:oak_log",Count:1b}}`,
      );
      expect(extractCamoSlots(blockId, properties, nbtValue)).toEqual(
        parts.map((slot) => ({ slot, state: oak, kind: "block" })),
      );
    },
  );

  it("gives every enabled part kind empty for a legacy copycat_base", () => {
    const nbtValue = be(`{id:"create:copycat",Material:${BASE},Item:{}}`);
    expect(
      extractCamoSlots("copycats:copycat_slab", { type: "double" }, nbtValue),
    ).toEqual([
      { slot: "bottom", state: null, kind: "empty" },
      { slot: "top", state: null, kind: "empty" },
    ]);
  });

  it("gives each legacy part its own state object", () => {
    const nbtValue = be(`{Material:${OAK_LOG}}`);
    const [bottom, top] = extractCamoSlots(
      "copycats:copycat_slab",
      { type: "double" },
      nbtValue,
    );
    expect(bottom.state).not.toBe(top.state);
  });
});

describe("extractCamoSlots: no camo data", () => {
  it("returns [] for a block that isn't camo-capable", () => {
    const nbtValue = be(`{id:"minecraft:chest",Material:${OAK_LOG}}`);
    expect(extractCamoSlots("minecraft:chest", {}, nbtValue)).toEqual([]);
  });

  it("returns [] without a block entity", () => {
    expect(extractCamoSlots("create:copycat_panel", {}, undefined)).toEqual([]);
  });

  it("returns [] for a block entity with no camo keys", () => {
    expect(
      extractCamoSlots("framedblocks:framed_cube", {}, be(`{glowing:0b}`)),
    ).toEqual([]);
  });
});
