import { describe, expect, it } from "vitest";

import { fitProperties, resolveModdedState } from "../mod-mapping";

// Immersive Engineering's multipart fence blockstate only tests `=true`, and
// never mentions `waterlogged`.
const FENCE = {
  east: ["true"],
  north: ["true"],
  south: ["true"],
  west: ["true"],
};
const FENCE_STATE = {
  east: "false",
  north: "true",
  south: "false",
  waterlogged: "false",
  west: "false",
};

describe("fitProperties", () => {
  it("keeps states blockstate files can't fully describe", () => {
    expect(fitProperties("ie:steel_fence", FENCE_STATE, FENCE, FENCE)).toEqual({
      properties: FENCE_STATE,
      warnings: [],
    });
    // Without the source file, vanilla property names are kept.
    expect(fitProperties("ie:steel_fence", FENCE_STATE, FENCE)).toEqual({
      properties: FENCE_STATE,
      warnings: [],
    });
  });

  it("drops a property the source file shows mattered", () => {
    expect(
      fitProperties(
        "mod:pipe",
        { north: "true", lit: "true" },
        { north: ["true"] },
        { north: ["true"], lit: ["true"] },
      ),
    ).toEqual({
      properties: { north: "true" },
      warnings: ['mod:pipe has no property "lit"; dropped.'],
    });
  });

  it("drops unknown non-vanilla properties without the source file", () => {
    expect(fitProperties("mod:pipe", { glow: "on", lit: "true" }, {})).toEqual({
      properties: { lit: "true" },
      warnings: ['mod:pipe has no property "glow"; dropped.'],
    });
  });

  it("replaces a value only with evidence it no longer exists", () => {
    const known = { mode: ["a", "b"] };
    expect(fitProperties("mod:m", { mode: "c" }, known)).toEqual({
      properties: { mode: "a" },
      warnings: ["mod:m has no mode=c; using mode=a."],
    });
    expect(
      fitProperties("mod:m", { mode: "c" }, known, { mode: ["a", "b", "c"] }),
    ).toEqual({
      properties: { mode: "a" },
      warnings: ["mod:m has no mode=c; using mode=a."],
    });
    // The source file never listed `c` either, so it never picked a model.
    expect(
      fitProperties("mod:m", { mode: "c" }, known, { mode: ["a", "b"] }),
    ).toEqual({ properties: { mode: "c" }, warnings: [] });
  });

  it("judges values against the completed vanilla value set", () => {
    expect(
      fitProperties("mod:m", { facing: "west" }, { facing: ["north"] }),
    ).toEqual({ properties: { facing: "west" }, warnings: [] });
    expect(
      fitProperties("mod:m", { facing: "up" }, { facing: ["north"] }),
    ).toEqual({
      properties: { facing: "north" },
      warnings: ["mod:m has no facing=up; using facing=north."],
    });
  });
});

describe("resolveModdedState", () => {
  it("uses the source block from sourceBlocks", () => {
    const resolution = resolveModdedState(
      "ie:steel_fence",
      { ...FENCE_STATE, lit: "true" },
      {
        ie: {
          kind: "target",
          blocks: { "ie:steel_fence": FENCE },
          sourceBlocks: { "ie:steel_fence": { ...FENCE, lit: ["true"] } },
        },
      },
    );
    expect(resolution).toEqual({
      status: "resolved",
      blockId: "ie:steel_fence",
      properties: FENCE_STATE,
      problem: {
        reason: "invalid-state",
        warnings: ['ie:steel_fence has no property "lit"; dropped.'],
      },
    });
  });
});
