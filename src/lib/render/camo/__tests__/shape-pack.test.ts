import { describe, expect, it } from "vitest";

import {
  DIRECTIONS,
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
        pieces: [
          {
            ...SLAB_PIECE,
            offset: [0, 0, 0],
            transform: [],
            cull: [],
            faces: [...DIRECTIONS],
            ops: [],
          },
        ],
      },
      {
        pieces: [
          {
            ...SLAB_PIECE,
            offset: [0, 8, 0],
            transform: ["flipY"],
            cull: ["up"],
            faces: [...DIRECTIONS],
            ops: [],
          },
        ],
      },
    ]);
  });

  it("accepts quad ops and fills in their defaults", () => {
    const ops = [
      { op: "cut", edge: "south", lengths: [16, 0] },
      { op: "cutTopBottom", from: [0, 0], to: [16, 8] },
      { op: "cutSide", from: [0, 0], to: [16, 8] },
      { op: "cutSide", edge: "up", lengthCW: 16, lengthCCW: 0 },
      { op: "cutCopycat", edge: "east", offsets: [2, 2] },
      { op: "cutPrismTriangle", up: true, back: false },
      { op: "cutPrismTriangle", edge: "north", back: true },
      { op: "cutSmallTriangle", edge: "up" },
      { op: "makeHorizontalSlope", rightEdge: true, angle: 45 },
      { op: "makeVerticalSlope", topEdge: false, angle: 45 },
      { op: "makeVerticalSlope", edge: "west", angle: 22.5 },
      { op: "rotate", axis: "y", origin: [8, 8, 8], angle: 30 },
      { op: "scaleFace", factor: 0.5, origin: [8, 16, 8] },
      { op: "setPosition", position: 8 },
      { op: "setPosition", positions: [16, 8, 8, 16] },
      { op: "offset", direction: "down", amount: 4 },
      {
        op: "updateUV",
        ops: [
          { op: "slope", face: "up", input: "b", from: [0, 16], to: [0, 8] },
          { op: "translate", by: [0, -8, 0] },
          { op: "scale", pivot: [16, 16, 16], factors: [1, 2, 1] },
        ],
      },
    ];
    const result = validateShapePack(
      pack({
        "copycats:copycat_slope": [
          { pieces: [{ ...SLAB_PIECE, faces: ["up", "north"], ops }] },
        ],
      }),
    );
    const [piece] = result.blocks["copycats:copycat_slope"][0].pieces;
    expect(piece.faces).toEqual(["up", "north"]);
    expect(piece.ops).toEqual(
      ops.map((op) =>
        op.op === "rotate"
          ? { ...op, rescale: false, scaleMult: [1, 1, 1] }
          : op,
      ),
    );
  });

  it.each([
    [
      "an unknown format version",
      pack({}, { formatVersion: SHAPE_PACK_FORMAT_VERSION + 1 }),
      "formatVersion",
    ],
    [
      "the previous format version",
      pack({}, { formatVersion: 1 }),
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
      "an unknown face",
      pack({ "a:b": [{ pieces: [{ ...SLAB_PIECE, faces: ["top"] }] }] }),
      "faces[0]",
    ],
    [
      "an unknown quad op",
      pack({ "a:b": [{ pieces: [{ ...SLAB_PIECE, ops: [{ op: "bend" }] }] }] }),
      "ops[0].op",
    ],
    [
      "a quad op with a bad field",
      pack({
        "a:b": [
          {
            pieces: [
              {
                ...SLAB_PIECE,
                ops: [{ op: "cut", edge: "south", lengths: [16] }],
              },
            ],
          },
        ],
      }),
      "ops[0].lengths",
    ],
    [
      "a vertical-quad prism cut towards up",
      pack({
        "a:b": [
          {
            pieces: [
              {
                ...SLAB_PIECE,
                ops: [{ op: "cutPrismTriangle", edge: "up", back: true }],
              },
            ],
          },
        ],
      }),
      "ops[0].edge",
    ],
    [
      "a bad nested op",
      pack({
        "a:b": [
          {
            pieces: [
              {
                ...SLAB_PIECE,
                ops: [
                  {
                    op: "updateUV",
                    ops: [{ op: "translate", by: [0, "8", 0] }],
                  },
                ],
              },
            ],
          },
        ],
      }),
      "ops[0].ops[0].by",
    ],
    [
      "an empty slope input range",
      pack({
        "a:b": [
          {
            pieces: [
              {
                ...SLAB_PIECE,
                ops: [
                  {
                    op: "slope",
                    face: "up",
                    input: "b",
                    from: [4, 4],
                    to: [0, 16],
                  },
                ],
              },
            ],
          },
        ],
      }),
      "ops[0].from",
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
