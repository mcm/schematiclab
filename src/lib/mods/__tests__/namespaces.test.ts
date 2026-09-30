import { describe, expect, it } from "vitest";

import { detectSchematicNamespaces, unmappedNamespaces } from "../namespaces";

describe("detectSchematicNamespaces", () => {
  it("counts non-minecraft namespaces sorted, skipping vanilla and unnamespaced ids", () => {
    expect(
      detectSchematicNamespaces([
        { blockId: "minecraft:stone", count: 10 },
        { blockId: "minecraft:air", count: 100 },
        { blockId: "stone", count: 1 },
        { blockId: "zeta:block", count: 2 },
        { blockId: "create:casing", count: 5 },
        { blockId: "create:casing", count: 3 },
        { blockId: "create:shaft", count: 1 },
      ]),
    ).toEqual([
      { namespace: "create", blockStateCount: 3, blockCount: 9 },
      { namespace: "zeta", blockStateCount: 1, blockCount: 2 },
    ]);
  });

  it("returns nothing for a vanilla palette", () => {
    expect(
      detectSchematicNamespaces([{ blockId: "minecraft:dirt", count: 1 }]),
    ).toEqual([]);
  });
});

describe("unmappedNamespaces", () => {
  const detected = [
    { namespace: "create", blockStateCount: 3, blockCount: 9 },
    { namespace: "zeta", blockStateCount: 1, blockCount: 2 },
  ];

  it("drops namespaces that have a mapping", () => {
    expect(
      unmappedNamespaces(detected, new Map([["create", { modId: 1 }]])),
    ).toEqual([{ namespace: "zeta", blockStateCount: 1, blockCount: 2 }]);
  });

  it("returns nothing once every namespace is mapped", () => {
    expect(
      unmappedNamespaces(
        detected,
        new Map([
          ["create", { modId: 1 }],
          ["zeta", { modId: 2 }],
        ]),
      ),
    ).toEqual([]);
  });
});
