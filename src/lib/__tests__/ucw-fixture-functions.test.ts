// Layout and command builders of `pnpm gen:ucw-fixture-functions`
// (`scripts/ucw-fixtures/layout.ts`), on hand-written rules shaped like UCW's
// bundled `ucwdefs/chisel/natura.json`.

import { describe, expect, it } from "vitest";

import {
  clearCommand,
  fixtureArea,
  fixtureFunction,
  ruleCommands,
  structureBlockCommand,
  structureBlockNbt,
} from "../../../scripts/ucw-fixtures/layout.ts";
import { parseUcwRuleFile } from "../mods/generated/ucw/rules";

function rule(from: string, through: string) {
  const warnings: string[] = [];
  const file = parseUcwRuleFile(
    "chisel/test.json",
    {
      modid: ["chisel"],
      blocks: [
        {
          from: { block: from, iterate: ["type"] },
          through: { block: through, iterate: ["variation"] },
          based_upon: { state: "minecraft:planks#variant=oak" },
          mode: "plank",
        },
      ],
    },
    warnings,
  );
  expect(warnings).toEqual([]);
  return file!.rules[0];
}

const NETHER = rule("natura:nether_planks", "chisel:planks-oak");

describe("fixtureArea", () => {
  it("is 17 × rules × 16 from the execution position", () => {
    expect(fixtureArea(5)).toEqual({
      min: [0, 0, 0],
      max: [16, 4, 15],
      size: [17, 5, 16],
    });
  });

  it("rejects no rules and more layers than a structure block saves", () => {
    expect(() => fixtureArea(0)).toThrow();
    expect(fixtureArea(32).size).toEqual([17, 32, 16]);
    expect(() => fixtureArea(33)).toThrow(/32³/);
  });

  it("is cleared with one fill", () => {
    expect(clearCommand(fixtureArea(5))).toBe(
      "fill ~ ~ ~ ~16 ~4 ~15 minecraft:air",
    );
  });
});

describe("ruleCommands", () => {
  it("places the from block and 16 variations per from meta", () => {
    const commands = ruleCommands(NETHER, 2);
    expect(commands).toHaveLength(16 * 17);
    expect(commands.slice(0, 3)).toEqual([
      "setblock ~ ~2 ~ natura:nether_planks 0",
      "setblock ~1 ~2 ~ unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0 0",
      "setblock ~2 ~2 ~ unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0 1",
    ]);
    expect(commands[16]).toBe(
      "setblock ~16 ~2 ~ unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0 15",
    );
    expect(commands[17]).toBe("setblock ~ ~2 ~1 natura:nether_planks 1");
    expect(commands.at(-1)).toBe(
      "setblock ~16 ~2 ~15 unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_15 15",
    );
  });

  it("uses layer 0 as the execution height", () => {
    expect(ruleCommands(NETHER, 0)[0]).toBe(
      "setblock ~ ~ ~ natura:nether_planks 0",
    );
  });
});

describe("structure block", () => {
  it("saves exactly the area from one block west of it", () => {
    const area = fixtureArea(5);
    expect(structureBlockNbt(area)).toBe(
      '{mode:"SAVE",name:"ucw_1_12_2",posX:1,posY:0,posZ:0,sizeX:17,sizeY:5,sizeZ:16,ignoreEntities:1b}',
    );
    expect(structureBlockCommand(area)).toBe(
      `setblock ~-1 ~ ~ minecraft:structure_block 0 replace ${structureBlockNbt(area)}`,
    );
  });
});

describe("fixtureFunction", () => {
  it("clears first, places every layer, then the structure block", () => {
    const overworld = rule("natura:overworld_planks", "chisel:planks-oak");
    const lines = fixtureFunction([NETHER, overworld], ["Header"])
      .trimEnd()
      .split("\n");
    expect(lines[0]).toBe("# Header");
    expect(lines[1]).toBe("fill ~ ~ ~ ~16 ~1 ~15 minecraft:air");
    const setblocks = lines.filter((line) => line.startsWith("setblock "));
    expect(setblocks).toHaveLength(2 * 16 * 17 + 1);
    expect(setblocks).toContain(
      "setblock ~5 ~1 ~3 unlimitedchiselworks:chisel_planks_oak_natura_overworld_planks_3 4",
    );
    expect(lines.at(-2)).toMatch(
      /^setblock ~-1 ~ ~ minecraft:structure_block 0 replace .*sizeY:2,/,
    );
    expect(lines.at(-1)).toMatch(/^tellraw @s /);
  });
});
