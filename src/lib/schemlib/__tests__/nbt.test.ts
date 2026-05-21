import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { readFileSync } from "node:fs";

import * as nbt from "../nbt";

// Bytes literal helper — turns "010203" into Uint8Array([1, 2, 3]).
const b = (hex: string): Uint8Array => {
  const clean = hex.replace(/\s/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
};

// Concatenate hex bytes with ASCII strings — closer to Python's b"\x08\x00\x03foo\x00\x03bar\x00".
const concat = (...parts: (Uint8Array | string)[]): Uint8Array => {
  const chunks = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : p));
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

// Tag → (repr, bytes) test fixtures. Mirrors `nbt_tag_tests` in test_nbt.py.
type TagCase = { name: string; tag: nbt.NbtTag; repr: string; bytes: Uint8Array };
const nbtTagTests: TagCase[] = [
  { name: "Byte", tag: new nbt.Byte(1), repr: "Byte(1)", bytes: b("01") },
  { name: "Short", tag: new nbt.Short(1), repr: "Short(1)", bytes: b("0001") },
  { name: "Int", tag: new nbt.Int(1), repr: "Int(1)", bytes: b("00000001") },
  { name: "Long", tag: new nbt.Long(1n), repr: "Long(1)", bytes: b("0000000000000001") },
  { name: "Float", tag: new nbt.Float(1.0), repr: "Float(1)", bytes: b("3f800000") },
  { name: "Double", tag: new nbt.Double(1.0), repr: "Double(1)", bytes: b("3ff0000000000000") },
  { name: "String", tag: new nbt.String("foo"), repr: 'String("foo")', bytes: concat(b("0003"), "foo") },
  {
    name: "ByteArray",
    tag: new nbt.ByteArray([1, 2, 3]),
    repr: "ByteArray([1, 2, 3])",
    bytes: b("00000003010203"),
  },
  {
    name: "IntArray",
    tag: new nbt.IntArray([1, 2, 3]),
    repr: "IntArray([1, 2, 3])",
    bytes: b("00000003000000010000000200000003"),
  },
  {
    name: "LongArray",
    tag: new nbt.LongArray([1n, 2n, 3n]),
    repr: "LongArray([1, 2, 3])",
    bytes: b(
      "00000003" +
        "0000000000000001" +
        "0000000000000002" +
        "0000000000000003",
    ),
  },
  { name: "empty List", tag: new nbt.List([]), repr: "List([])", bytes: b("0000000000") },
  {
    name: "Int List",
    tag: new nbt.List([new nbt.Int(1), new nbt.Int(2), new nbt.Int(3)]),
    repr: "List([Int(1), Int(2), Int(3)])",
    bytes: b("0300000003000000010000000200000003"),
  },
  {
    name: "Compound",
    tag: new nbt.Compound({ foo: new nbt.String("bar") }),
    repr: 'Compound({"foo": String("bar")})',
    bytes: concat(b("08"), b("0003"), "foo", b("0003"), "bar", b("00")),
  },
  {
    name: "Named",
    tag: new nbt.Named({ "": new nbt.Compound({ foo: new nbt.String("bar") }) }),
    repr: 'Named({"": Compound({"foo": String("bar")})})',
    bytes: concat(b("0a"), b("0000"), b("08"), b("0003"), "foo", b("0003"), "bar", b("00")),
  },
];

describe("NbtTag toString (repr)", () => {
  it.each(nbtTagTests)("$name", ({ tag, repr }) => {
    expect(tag.toString()).toBe(repr);
  });
});

describe("NbtTag round-trip", () => {
  it.each(nbtTagTests)("$name -> fromBytes", ({ tag, bytes }) => {
    const cls = tag.constructor as unknown as { fromBytes(b: Uint8Array): nbt.NbtTag };
    const parsed = cls.fromBytes(bytes);
    expect(parsed.equals(tag)).toBe(true);
  });

  it.each(nbtTagTests)("$name -> toBytes", ({ tag, bytes }) => {
    expect(tag.toBytes()).toEqual(bytes);
  });
});

describe("List", () => {
  it("from_bytes with invalid item type throws", () => {
    // First byte (0xa3 = 163) is an unregistered tag type id.
    expect(() => nbt.List.fromBytes(b("a30000000300000001000000020000000300"))).toThrow();
  });
});

describe("Compound", () => {
  it("from_bytes with invalid item type throws", () => {
    expect(() => nbt.Compound.fromBytes(concat(b("a3"), b("0003"), "foo"))).toThrow();
  });
});

describe("Named", () => {
  it("only one key is allowed", () => {
    expect(
      () =>
        new nbt.Named({
          foo: new nbt.Compound({}),
          bar: new nbt.Compound({}),
        }),
    ).toThrow();
  });
});

describe("loadNbtFromBytes", () => {
  it("parses a Named root", () => {
    const named = nbt.loadNbtFromBytes(
      concat(b("0a"), b("0000"), b("08"), b("0003"), "foo", b("0003"), "bar", b("00")),
    );
    expect(named.equals(new nbt.Named({ "": new nbt.Compound({ foo: new nbt.String("bar") }) }))).toBe(true);
  });
});

describe("loadNbtFromBytes (file fixture)", () => {
  it("reads the one_stone_block.litematic fixture", () => {
    const fixturePath = path.resolve(
      __dirname,
      "../../../../../schemlib/tests/schematics/one_stone_block.litematic",
    );
    const buf = readFileSync(fixturePath);
    const named = nbt.loadNbtFromBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const metadata = named.get("Metadata") as nbt.Compound | undefined;
    expect(metadata).toBeDefined();
    const name = metadata!.get("Name") as nbt.StringTag | undefined;
    expect(name).toBeDefined();
    expect(name!.value).toBe("One Stone Block");
  });
});

describe("tag type registry", () => {
  const knownIds: Array<[number, unknown]> = [
    [1, nbt.Byte],
    [2, nbt.Short],
    [3, nbt.Int],
    [4, nbt.Long],
    [5, nbt.Float],
    [6, nbt.Double],
    [7, nbt.ByteArray],
    [8, nbt.StringTag],
    [9, nbt.NbtList],
    [10, nbt.Compound],
    [11, nbt.IntArray],
    [12, nbt.LongArray],
  ];

  it.each(knownIds)("id %i is registered", (id, cls) => {
    expect(nbt._tagTypeRegistry.get(id as number)).toBe(cls);
    expect((cls as { tagTypeId: number }).tagTypeId).toBe(id);
  });

  it("overwriting tag type throws", () => {
    expect(() => nbt.registerTagType(1, nbt.Int)).toThrow();
  });

  it("from_buff on base NbtTag throws (no implementation)", () => {
    expect(() => nbt.NbtTag.fromReader(new nbt.BinaryReader(new Uint8Array(0)))).toThrow();
  });
});
