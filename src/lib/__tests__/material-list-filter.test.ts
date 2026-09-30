import { describe, expect, it } from "vitest";

import {
  filterPaletteRows,
  namespaceOf,
  namespaceOptions,
  pruneSelection,
  unmappedSelection,
} from "../material-list-filter";

const palette = [
  { blockId: "minecraft:stone" },
  { blockId: "minecraft:stone" },
  { blockId: "dirt" },
  { blockId: "zeta:block" },
  { blockId: "create:casing" },
  { blockId: "create:shaft" },
];

const all = () => true;

describe("namespaceOf", () => {
  it("returns the prefix, or minecraft when there is none", () => {
    expect(namespaceOf("create:casing")).toBe("create");
    expect(namespaceOf("minecraft:stone")).toBe("minecraft");
    expect(namespaceOf("stone")).toBe("minecraft");
  });
});

describe("namespaceOptions", () => {
  it("lists every namespace with counts and mapping status, minecraft first", () => {
    expect(namespaceOptions(palette, new Map([["create", {}]]))).toEqual([
      { namespace: "minecraft", blockStateCount: 3, mapped: null },
      { namespace: "create", blockStateCount: 2, mapped: true },
      { namespace: "zeta", blockStateCount: 1, mapped: false },
    ]);
  });

  it("is empty for an empty palette", () => {
    expect(namespaceOptions([], new Map())).toEqual([]);
  });
});

describe("unmappedSelection", () => {
  it("selects exactly the unmapped non-minecraft namespaces", () => {
    const options = namespaceOptions(palette, new Map([["create", {}]]));
    expect([...unmappedSelection(options)]).toEqual(["zeta"]);
  });

  it("is empty when everything is mapped", () => {
    const options = namespaceOptions(
      palette,
      new Map([
        ["create", {}],
        ["zeta", {}],
      ]),
    );
    expect(unmappedSelection(options).size).toBe(0);
  });
});

describe("pruneSelection", () => {
  const options = namespaceOptions(palette, new Map());

  it("keeps the same set when every namespace is still present", () => {
    const selection = new Set(["create", "minecraft"]);
    expect(pruneSelection(selection, options)).toBe(selection);
  });

  it("drops namespaces that left the palette", () => {
    expect([...pruneSelection(new Set(["create", "gone"]), options)]).toEqual([
      "create",
    ]);
  });
});

describe("filterPaletteRows", () => {
  it("keeps every row for an empty selection", () => {
    expect(filterPaletteRows(palette, new Set(), all)).toEqual(palette);
  });

  it("keeps only rows in selected namespaces", () => {
    expect(
      filterPaletteRows(palette, new Set(["create", "zeta"]), all).map(
        (e) => e.blockId,
      ),
    ).toEqual(["zeta:block", "create:casing", "create:shaft"]);
  });

  it("treats unprefixed ids as minecraft", () => {
    expect(
      filterPaletteRows(palette, new Set(["minecraft"]), all).map(
        (e) => e.blockId,
      ),
    ).toEqual(["minecraft:stone", "minecraft:stone", "dirt"]);
  });

  it("ANDs the namespace selection with the search predicate", () => {
    expect(
      filterPaletteRows(palette, new Set(["create", "minecraft"]), (e) =>
        e.blockId.includes("s"),
      ).map((e) => e.blockId),
    ).toEqual([
      "minecraft:stone",
      "minecraft:stone",
      "create:casing",
      "create:shaft",
    ]);
    expect(
      filterPaletteRows(palette, new Set(["zeta"]), (e) =>
        e.blockId.includes("casing"),
      ),
    ).toEqual([]);
  });
});
