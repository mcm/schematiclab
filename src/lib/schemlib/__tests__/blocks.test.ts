import { describe, it, expect } from "vitest";

import * as nbt from "../nbt";
import * as blocks from "../blocks";

// ── Tiny replacements for fauxfactory.gen_integer / gen_alpha ──────────────
// We don't pull in faker; these mirror the (-128, 127) integers and short
// alpha strings used in test_blocks.py.
const genInt = (min = -128, max = 127): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const genAlpha = (length = 10): string => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

// ── Block ──────────────────────────────────────────────────────────────────

describe("Block", () => {
  it("name is blockstate name", () => {
    const blockName = genAlpha();
    const block = new blocks.Block(
      new blocks.BlockPos(0, 0, 0),
      new blocks.BlockState({ Name: blockName }),
    );
    expect(block.name).toBe(blockName);
  });
});

// ── BlockPos ───────────────────────────────────────────────────────────────

describe("BlockPos", () => {
  it("ORIGIN equals (0,0,0)", () => {
    expect(blocks.BlockPos.ORIGIN.equals(new blocks.BlockPos(0, 0, 0))).toBe(true);
  });

  it("constructs from a tuple", () => {
    expect(blocks.BlockPos.from([0, 0, 0]).equals(new blocks.BlockPos(0, 0, 0))).toBe(true);
  });

  it("adds another BlockPos", () => {
    const p1 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const p2 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const expected = new blocks.BlockPos(p1.x + p2.x, p1.y + p2.y, p1.z + p2.z);
    expect(p1.add(p2).equals(expected)).toBe(true);
  });

  it("adds a tuple", () => {
    const p1 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const p2: [number, number, number] = [genInt(), genInt(), genInt()];
    const expected = new blocks.BlockPos(p1.x + p2[0], p1.y + p2[1], p1.z + p2[2]);
    expect(p1.add(p2).equals(expected)).toBe(true);
  });

  it("subtracts another BlockPos", () => {
    const p1 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const p2 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const expected = new blocks.BlockPos(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
    expect(p1.sub(p2).equals(expected)).toBe(true);
  });

  it("subtracts a tuple", () => {
    const p1 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const p2: [number, number, number] = [genInt(), genInt(), genInt()];
    const expected = new blocks.BlockPos(p1.x - p2[0], p1.y - p2[1], p1.z - p2[2]);
    expect(p1.sub(p2).equals(expected)).toBe(true);
  });

  it("unpacks via astuple", () => {
    const p1 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const [x, y, z] = p1.astuple();
    expect(x).toBe(p1.x);
    expect(y).toBe(p1.y);
    expect(z).toBe(p1.z);
  });

  it("astuple returns the expected tuple", () => {
    const p1 = new blocks.BlockPos(genInt(), genInt(), genInt());
    expect(p1.astuple()).toEqual([p1.x, p1.y, p1.z]);
  });

  it("equals a tuple", () => {
    const p1: [number, number, number] = [genInt(), genInt(), genInt()];
    const p2 = new blocks.BlockPos(p1[0], p1[1], p1[2]);
    expect(p2.equals(p1)).toBe(true);
  });

  it("equals a specialized subclass", () => {
    class SpecialBlockPos extends blocks.BlockPos {}

    const p1 = new blocks.BlockPos(genInt(), genInt(), genInt());
    const p2 = new SpecialBlockPos(p1.x, p1.y, p1.z);
    expect(p1.equals(p2)).toBe(true);
    expect(p2.equals(p1)).toBe(true);
  });
});

// ── BlockState ─────────────────────────────────────────────────────────────

type BlockstateCase = {
  str: string;
  expected: blocks.BlockState;
  expectedStr?: string;
};

const blockstateStrings: BlockstateCase[] = [
  {
    str: "minecraft:air",
    expected: new blocks.BlockState({ Name: "minecraft:air" }),
  },
  {
    str: "minecraft:stone[]",
    expected: new blocks.BlockState({ Name: "minecraft:stone" }),
    expectedStr: "minecraft:stone",
  },
  {
    str: "minecraft:oak_slab[type=top]",
    expected: new blocks.BlockState({
      Name: "minecraft:oak_slab",
      Properties: { type: "top" },
    }),
  },
  {
    str: 'minecraft:stone_stairs[half="bottom", facing="east"]',
    expected: new blocks.BlockState({
      Name: "minecraft:stone_stairs",
      Properties: { half: "bottom", facing: "east" },
    }),
    expectedStr: "minecraft:stone_stairs[facing=east,half=bottom]",
  },
];

const invalidBlockstates = ["foo[", "minecraft:foo["];

describe("BlockState.fromString", () => {
  it.each(blockstateStrings)("parses '$str'", ({ str, expected }) => {
    expect(blocks.BlockState.fromString(str).equals(expected)).toBe(true);
  });
});

describe("BlockState.toString", () => {
  it.each(blockstateStrings)("serializes '$str'", ({ str, expected, expectedStr }) => {
    expect(expected.toString()).toBe(expectedStr ?? str);
  });
});

describe("BlockState.equals", () => {
  it.each(blockstateStrings)("equals its source string '$str'", ({ str, expected }) => {
    expect(expected.equals(str)).toBe(true);
  });
});

describe("BlockState.fromString invalid input", () => {
  it.each(invalidBlockstates)("'%s' throws", (invalid) => {
    expect(() => blocks.BlockState.fromString(invalid)).toThrow(
      `${invalid} is an invalid blockstate representation`,
    );
  });
});

// JS Maps key on identity for objects — divergence from Python where
// pydantic models compose `__hash__` from `__str__`. We emulate the Python
// test by using `.toString()` as the map key.
describe("BlockState as map key (via toString)", () => {
  it("is usable as a dict key via toString", () => {
    const airBlock = new blocks.BlockState({ Name: "minecraft:air" });
    const stoneBlock = new blocks.BlockState({ Name: "minecraft:stone" });

    const d = new Map<string, number>();
    d.set(airBlock.toString(), 0);
    expect(d.get(airBlock.toString())).toBe(0);
    expect(d.has(stoneBlock.toString())).toBe(false);
  });
});

describe("BlockState as compound", () => {
  it("Name is a String tag when constructed from a string", () => {
    const airBlock = new blocks.BlockState({ Name: "minecraft:air" });
    const compound = nbt.modelToCompound(airBlock);
    expect(compound.get("Name")).toBeInstanceOf(nbt.StringTag);
  });

  it("Name is a String tag when constructed from a String tag", () => {
    const airBlock = new blocks.BlockState({ Name: new nbt.StringTag("minecraft:air") });
    const compound = nbt.modelToCompound(airBlock);
    expect(compound.get("Name")).toBeInstanceOf(nbt.StringTag);
  });

  it("skips empty Properties", () => {
    const airBlock = new blocks.BlockState({ Name: "minecraft:air" });
    expect(
      nbt
        .modelToCompound(airBlock)
        .equals(new nbt.Compound({ Name: new nbt.StringTag("minecraft:air") })),
    ).toBe(true);
  });

  it("includes non-empty Properties", () => {
    const airBlock = new blocks.BlockState({
      Name: "minecraft:air",
      Properties: { foo: "bar" },
    });
    const expected = new nbt.Compound({
      Name: new nbt.StringTag("minecraft:air"),
      Properties: new nbt.Compound({ foo: new nbt.StringTag("bar") }),
    });
    expect(nbt.modelToCompound(airBlock).equals(expected)).toBe(true);
  });
});
