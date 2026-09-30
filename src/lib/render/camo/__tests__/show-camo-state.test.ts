import { afterEach, describe, expect, it, vi } from "vitest";

import { CamoTable } from "../camo-table";
import {
  __resetShowCamoForTests,
  getShowCamo,
  isCamoToggleVisible,
  setShowCamo,
  subscribeShowCamo,
} from "../show-camo-state";

const VANILLA = [{ blockId: "minecraft:stone" }];
const FRAMED = [...VANILLA, { blockId: "framedblocks:framed_slab" }];
const COPYCAT = [...VANILLA, { blockId: "create:copycat_panel" }];

describe("isCamoToggleVisible", () => {
  it.each([
    ["no mod, no camo block", VANILLA, [], false],
    ["mod loaded, no camo block", VANILLA, ["framedblocks"], false],
    ["camo block, no mod loaded", FRAMED, [], false],
    ["camo block, other mod loaded", FRAMED, ["copycats"], false],
    ["camo block, its mod loaded", FRAMED, ["framedblocks"], true],
    ["Create copycat, Create loaded", COPYCAT, ["create"], true],
  ])("%s", (_name, palette, namespaces, expected) => {
    expect(isCamoToggleVisible(palette, new Set(namespaces))).toBe(expected);
  });
});

describe("show camo store", () => {
  afterEach(() => __resetShowCamoForTests());

  it("defaults to on and notifies on change only", () => {
    expect(getShowCamo()).toBe(true);
    const listener = vi.fn();
    subscribeShowCamo(listener);
    setShowCamo(true);
    expect(listener).not.toHaveBeenCalled();
    setShowCamo(false);
    expect(getShowCamo()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("CamoTable.framesOnly", () => {
  it("keeps indices and empties every slot", () => {
    const table = new CamoTable();
    const index = table.add("framedblocks:framed_slab", { type: "bottom" }, [
      {
        slot: "camo",
        kind: "block",
        state: { name: "minecraft:stone", properties: {} },
      },
    ]);
    const frames = table.framesOnly();
    expect(frames.get(index)).toEqual({
      blockId: "framedblocks:framed_slab",
      properties: { type: "bottom" },
      slots: [{ slot: "camo", kind: "empty", state: null }],
    });
    expect(table.get(index)?.slots[0].kind).toBe("block");
    expect(table.framesOnly()).toBe(frames);
    const next = table.add("framedblocks:framed_cube", {}, []);
    expect(table.framesOnly()).not.toBe(frames);
    expect(table.framesOnly().get(next)?.blockId).toBe(
      "framedblocks:framed_cube",
    );
  });
});
