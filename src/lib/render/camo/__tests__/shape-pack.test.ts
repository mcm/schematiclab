import { describe, expect, it } from "vitest";

import {
  SHAPE_PACK_FORMAT_VERSION,
  ShapePackError,
  matchShapeRule,
  validateShapePack,
  type ShapeRule,
} from "../shape-pack";

const SOURCE = {
  mod: "framedblocks",
  repository: "https://github.com/XFactHD/FramedBlocks",
  commit: "0123456789abcdef",
  modVersion: "10.6.2",
  license: "LGPL-3.0",
};

function pack(blocks: unknown, overrides: object = {}) {
  return {
    formatVersion: SHAPE_PACK_FORMAT_VERSION,
    source: SOURCE,
    blocks,
    ...overrides,
  };
}

const SLAB_PIECE = {
  slot: "camo",
  select: { from: [0, 0, 0], to: [16, 8, 16] },
};

describe("validateShapePack", () => {
  it("accepts a pack and fills in piece defaults", () => {
    const result = validateShapePack(
      pack({
        "framedblocks:framed_slab": [
          { when: { top: "false" }, pieces: [SLAB_PIECE] },
          {
            pieces: [
              {
                ...SLAB_PIECE,
                offset: [0, 8, 0],
                transform: ["flipY"],
                cull: ["up"],
              },
            ],
          },
        ],
      }),
    );
    expect(result.source).toEqual(SOURCE);
    expect(result.blocks["framedblocks:framed_slab"]).toEqual([
      {
        when: { top: "false" },
        pieces: [{ ...SLAB_PIECE, offset: [0, 0, 0], transform: [], cull: [] }],
      },
      {
        pieces: [
          {
            ...SLAB_PIECE,
            offset: [0, 8, 0],
            transform: ["flipY"],
            cull: ["up"],
          },
        ],
      },
    ]);
  });

  it.each([
    [
      "an unknown format version",
      pack({}, { formatVersion: 2 }),
      "formatVersion",
    ],
    [
      "a missing source field",
      pack({}, { source: { ...SOURCE, commit: "" } }),
      "source.commit",
    ],
    ["a non-namespaced id", pack({ slab: [] }), 'blocks["slab"]'],
    [
      "a box outside the block",
      pack({
        "a:b": [
          {
            pieces: [
              { ...SLAB_PIECE, select: { from: [0, 0, 0], to: [16, 17, 16] } },
            ],
          },
        ],
      }),
      "pieces[0].select",
    ],
    [
      "an inverted box",
      pack({
        "a:b": [
          {
            pieces: [
              { ...SLAB_PIECE, select: { from: [8, 0, 0], to: [4, 8, 16] } },
            ],
          },
        ],
      }),
      "pieces[0].select",
    ],
    [
      "an unknown transform",
      pack({
        "a:b": [{ pieces: [{ ...SLAB_PIECE, transform: ["rotateY45"] }] }],
      }),
      "transform[0]",
    ],
    [
      "an unknown cull direction",
      pack({ "a:b": [{ pieces: [{ ...SLAB_PIECE, cull: ["top"] }] }] }),
      "cull[0]",
    ],
    [
      "a missing slot",
      pack({ "a:b": [{ pieces: [{ select: SLAB_PIECE.select }] }] }),
      "pieces[0].slot",
    ],
  ])("rejects %s", (_name, json, path) => {
    expect(() => validateShapePack(json)).toThrow(ShapePackError);
    expect(() => validateShapePack(json)).toThrow(path);
  });
});

describe("matchShapeRule", () => {
  const rules: ShapeRule[] = [
    { when: { facing: "north|south", top: "true" }, pieces: [] },
    { when: { facing: "east" }, pieces: [] },
    { pieces: [] },
  ];

  it("returns the first rule whose properties all match", () => {
    expect(matchShapeRule(rules, { facing: "south", top: "true" })).toBe(
      rules[0],
    );
    expect(matchShapeRule(rules, { facing: "east", top: "true" })).toBe(
      rules[1],
    );
    expect(matchShapeRule(rules, { facing: "south", top: "false" })).toBe(
      rules[2],
    );
  });

  it("returns null when no rule matches", () => {
    expect(matchShapeRule(rules.slice(0, 2), { facing: "west" })).toBeNull();
    expect(
      matchShapeRule([{ when: { constructor: "x" }, pieces: [] }], {}),
    ).toBeNull();
  });
});
