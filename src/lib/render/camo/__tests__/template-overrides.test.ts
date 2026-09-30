import { describe, expect, it } from "vitest";

import {
  parseFramedTemplate,
  ShapePackError,
  validateShapePack,
  type ShapePack,
  type TemplateCube,
} from "../shape-pack";
import { applyTemplateOverrides, mergeTemplates } from "../template-overrides";

const ROTATE = {
  op: "rotate",
  axis: "y",
  origin: [8, 8, 8],
  angle: 45,
};

// Two uses of `framedblocks:bar` (two cubes each) in one rule, one of them
// under a post modifier, a vanilla-template piece and a bespoke piece.
const PACK: ShapePack = validateShapePack({
  formatVersion: 2,
  source: {
    mod: "framedblocks",
    repository: "https://example.invalid/FramedBlocks",
    commit: "abc",
    modVersion: "1.0",
    license: "LGPL-3.0",
  },
  blocks: {
    "framedblocks:framed_bar": [
      {
        pieces: [
          {
            slot: "camo",
            select: { from: [0, 0, 0], to: [8, 16, 16] },
            cull: ["down", "west"],
            faces: ["down", "up", "west"],
            template: { id: "framedblocks:bar", element: 0 },
          },
          {
            slot: "camo",
            select: { from: [8, 0, 0], to: [16, 16, 16] },
            cull: ["east"],
            faces: ["east"],
            template: { id: "framedblocks:bar", element: 1 },
          },
          {
            slot: "camo_two",
            select: { from: [0, 0, 0], to: [8, 16, 16] },
            transform: ["rotateY90"],
            faces: ["down", "up", "west"],
            ops: [ROTATE],
            template: { id: "framedblocks:bar", element: 0 },
          },
          {
            slot: "camo_two",
            select: { from: [8, 0, 0], to: [16, 16, 16] },
            transform: ["rotateY90"],
            faces: ["east"],
            ops: [ROTATE],
            template: { id: "framedblocks:bar", element: 1 },
          },
          { slot: "camo", select: { from: [0, 0, 0], to: [16, 8, 16] } },
        ],
      },
    ],
    "framedblocks:framed_other": [
      {
        when: { facing: "north" },
        pieces: [
          {
            slot: "camo",
            select: { from: [0, 0, 0], to: [16, 16, 4] },
            template: { id: "framedblocks:other", element: 0 },
          },
        ],
      },
    ],
  },
});

const ONE_CUBE: TemplateCube[] = [
  {
    box: { from: [2, 0, 2], to: [14, 10, 14] },
    faces: { down: true, up: false, north: true },
  },
];

describe("applyTemplateOverrides", () => {
  it("returns the pack itself when there are no templates", () => {
    expect(applyTemplateOverrides(PACK, {})).toBe(PACK);
  });

  it("returns the pack itself when no template matches a piece", () => {
    expect(
      applyTemplateOverrides(PACK, { "framedblocks:unused": ONE_CUBE }),
    ).toBe(PACK);
  });

  it("rebuilds every use of a template, keeping slot, transform and ops", () => {
    const result = applyTemplateOverrides(PACK, {
      "framedblocks:bar": ONE_CUBE,
    });
    const [rule] = result.blocks["framedblocks:framed_bar"];

    expect(rule.pieces).toEqual([
      {
        slot: "camo",
        select: { from: [2, 0, 2], to: [14, 10, 14] },
        offset: [0, 0, 0],
        transform: [],
        cull: ["down", "north"],
        faces: ["down", "up", "north"],
        ops: [],
        template: { id: "framedblocks:bar", element: 0 },
      },
      {
        slot: "camo_two",
        select: { from: [2, 0, 2], to: [14, 10, 14] },
        offset: [0, 0, 0],
        transform: ["rotateY90"],
        // A post modifier moves faces off their cull side.
        cull: [],
        faces: ["down", "up", "north"],
        ops: PACK.blocks["framedblocks:framed_bar"][0].pieces[2].ops,
        template: { id: "framedblocks:bar", element: 0 },
      },
      PACK.blocks["framedblocks:framed_bar"][0].pieces[4],
    ]);
    // Blocks without the template are shared, not copied.
    expect(result.blocks["framedblocks:framed_other"]).toBe(
      PACK.blocks["framedblocks:framed_other"],
    );
    expect(result.source).toEqual(PACK.source);
  });

  it("grows a use when the template gains cubes", () => {
    const three: TemplateCube[] = [
      ...ONE_CUBE,
      { box: { from: [0, 10, 0], to: [16, 16, 16] }, faces: { up: true } },
      { box: { from: [0, 0, 0], to: [1, 1, 1] }, faces: {} },
    ];
    const result = applyTemplateOverrides(PACK, {
      "framedblocks:other": three,
    });
    const [rule] = result.blocks["framedblocks:framed_other"];

    expect(rule.when).toEqual({ facing: "north" });
    expect(rule.pieces.map((piece) => piece.select)).toEqual(
      three.map((cube) => cube.box),
    );
    expect(rule.pieces.map((piece) => piece.template?.element)).toEqual([
      0, 1, 2,
    ]);
    expect(rule.pieces[1].cull).toEqual(["up"]);
    expect(rule.pieces[2].faces).toEqual([]);
  });

  it("keeps the rebuilt pack valid", () => {
    const result = applyTemplateOverrides(PACK, {
      "framedblocks:bar": ONE_CUBE,
    });
    expect(validateShapePack(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });
});

describe("mergeTemplates", () => {
  it("lets later mods win and skips mods without templates", () => {
    const other: TemplateCube[] = [
      { box: { from: [0, 0, 0], to: [16, 16, 16] }, faces: {} },
    ];
    expect(
      mergeTemplates([
        { templates: { "framedblocks:a": ONE_CUBE, "framedblocks:b": other } },
        {},
        { templates: { "framedblocks:a": other } },
      ]),
    ).toEqual({ "framedblocks:a": other, "framedblocks:b": other });
  });
});

describe("parseFramedTemplate", () => {
  it("reads cullable flags, model-style faces and swapped corners", () => {
    expect(
      parseFramedTemplate({
        elements: [
          {
            from: [16, 8, 16],
            to: [0, 0, 0],
            faces: { down: true, up: false },
          },
          {
            from: [4, 4, 4],
            to: [12, 12, 12],
            faces: { north: { cullface: "north" }, south: {} },
          },
        ],
      }),
    ).toEqual([
      {
        box: { from: [0, 0, 0], to: [16, 8, 16] },
        faces: { down: true, up: false },
      },
      {
        box: { from: [4, 4, 4], to: [12, 12, 12] },
        faces: { north: true, south: false },
      },
    ]);
  });

  it.each([
    [{}, "$.elements"],
    [{ elements: [{ from: [0, 0], to: [1, 1, 1], faces: {} }] }, "from"],
    [{ elements: [{ from: [0, 0, 0], to: [1, 1, 17], faces: {} }] }, "[0]"],
    [
      { elements: [{ from: [0, 0, 0], to: [1, 1, 1], faces: { top: true } }] },
      "faces",
    ],
    [
      { elements: [{ from: [0, 0, 0], to: [1, 1, 1], faces: { up: 1 } }] },
      "faces.up",
    ],
  ])("rejects %j", (json, path) => {
    expect(() => parseFramedTemplate(json)).toThrow(ShapePackError);
    expect(() => parseFramedTemplate(json)).toThrow(path);
  });
});
