import { describe, it, expect } from "vitest";

import * as nbt from "../nbt";
import * as snbt from "../snbt";

// Mirrors `test_snbt_tag_values` in test_snbt.py.
type TagCase = {
  name: string;
  snbtValue: string;
  tagValue: nbt.NbtTag;
  serializedValue?: string;
};

const tagCases: TagCase[] = [
  { name: "snbt_byte_1", snbtValue: "34B", tagValue: new nbt.Byte(34) },
  { name: "snbt_byte_2", snbtValue: "-20B", tagValue: new nbt.Byte(-20) },
  { name: "snbt_short_1", snbtValue: "31415S", tagValue: new nbt.Short(31415) },
  {
    name: "snbt_short_2",
    snbtValue: "-27183S",
    tagValue: new nbt.Short(-27183),
  },
  {
    name: "snbt_integer",
    snbtValue: "31415926",
    tagValue: new nbt.Int(31415926),
  },
  {
    name: "snbt_long",
    snbtValue: "31415926L",
    tagValue: new nbt.Long(31415926n),
  },
  {
    name: "snbt_float",
    snbtValue: "3.1415926F",
    tagValue: new nbt.Float(3.1415926),
  },
  {
    name: "snbt_double",
    snbtValue: "3.1415926",
    tagValue: new nbt.Double(3.1415926),
    serializedValue: "3.1415926D",
  },
  {
    name: "snbt_string_1",
    snbtValue: String.raw`"Call me \"Ishmael\""`,
    tagValue: new nbt.StringTag(`Call me "Ishmael"`),
  },
  {
    name: "snbt_string_2",
    snbtValue: `"Call me 'Ishmael'"`,
    tagValue: new nbt.StringTag("Call me 'Ishmael'"),
  },
  {
    name: "snbt_list",
    snbtValue: "[3.2D,64.5D,129.5D]",
    tagValue: new nbt.NbtList([
      new nbt.Double(3.2),
      new nbt.Double(64.5),
      new nbt.Double(129.5),
    ]),
  },
  {
    name: "snbt_compound",
    snbtValue: "{X:3,Y:64,Z:129}",
    tagValue: new nbt.Compound({
      X: new nbt.Int(3),
      Y: new nbt.Int(64),
      Z: new nbt.Int(129),
    }),
  },
  {
    name: "snbt_byte_array",
    snbtValue: "[B;1B,2B,3B]",
    tagValue: new nbt.ByteArray([1, 2, 3]),
  },
  {
    name: "snbt_int_array",
    snbtValue: "[I;1,2,3]",
    tagValue: new nbt.IntArray([1, 2, 3]),
  },
  {
    name: "snbt_long_array",
    snbtValue: "[L;1L,2L,3L]",
    tagValue: new nbt.LongArray([1n, 2n, 3n]),
  },
];

describe("fromSnbt", () => {
  it.each(tagCases)("parses $name", ({ snbtValue, tagValue }) => {
    const parsed = snbt.fromSnbt(snbtValue);
    expect(parsed.equals(tagValue)).toBe(true);
  });
});

describe("toSnbt", () => {
  it.each(tagCases)(
    "serializes $name",
    ({ snbtValue, tagValue, serializedValue }) => {
      expect(snbt.toSnbt(tagValue)).toBe(serializedValue ?? snbtValue);
    },
  );
});

// Mirrors `test_snbt_string_values` — a full Compound round-trip.
const stringCases = [
  {
    snbtStr: '{Pos:[1d,2d,3d],Tags:["a","b"]}',
    tagValue: new nbt.Compound({
      Pos: new nbt.NbtList([
        new nbt.Double(1.0),
        new nbt.Double(2.0),
        new nbt.Double(3.0),
      ]),
      Tags: new nbt.NbtList([new nbt.StringTag("a"), new nbt.StringTag("b")]),
    }),
    serializedValue: '{Pos:[1.0D,2.0D,3.0D],Tags:["a","b"]}',
  },
];

describe("SNBT string round-trips", () => {
  it.each(stringCases)(
    "serializes $snbtStr",
    ({ tagValue, serializedValue, snbtStr }) => {
      expect(snbt.toSnbt(tagValue)).toBe(serializedValue ?? snbtStr);
    },
  );
  it.each(stringCases)("parses $snbtStr", ({ snbtStr, tagValue }) => {
    expect(snbt.fromSnbt(snbtStr).equals(tagValue)).toBe(true);
  });
});
