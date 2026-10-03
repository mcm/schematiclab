import { describe, expect, it } from "vitest";

import type { ResolvedModel } from "../../../../render/block-appearance";
import { ucwSourceTexture, UCW_MISSING_TEXTURE } from "../source-texture";

const cube = (faces: Record<string, unknown>) => ({
  from: [0, 0, 0],
  to: [16, 16, 16],
  faces,
});

function input(
  model: ResolvedModel | null,
  overrides: Partial<Parameters<typeof ucwSourceTexture>[0]> = {},
) {
  return {
    blockId: "natura:nether_planks",
    properties: { type: "ghostwood" },
    modelNamespace: "natura",
    model,
    ...overrides,
  };
}

describe("ucwSourceTexture", () => {
  it("uses a model's only texture", () => {
    const model: ResolvedModel = {
      textures: {
        all: "natura:blocks/nether/planks_ghostwood",
        particle: "#all",
      },
      elements: [cube({ north: { texture: "#all", cullface: "north" } })],
    };
    expect(ucwSourceTexture(input(model))).toBe(
      "natura:blocks/nether/planks_ghostwood",
    );
  });

  it("uses the first north-culled face of a multi-texture model", () => {
    const model: ResolvedModel = {
      textures: {
        particle: "natura:blocks/skewed",
        side: "natura:blocks/side",
        top: "natura:blocks/top",
        alias: "#side",
      },
      elements: [
        cube({
          up: { texture: "#top", cullface: "up" },
          // No cullface: a general quad, not returned for NORTH.
          north: { texture: "#top" },
        }),
        cube({
          // EnumFacing order: down before north.
          north: { texture: "#top", cullface: "north" },
          down: { texture: "alias", cullface: "north" },
        }),
      ],
    };
    expect(ucwSourceTexture(input(model))).toBe("natura:blocks/side");
  });

  it("falls back to the first texture without a north-culled face", () => {
    const model: ResolvedModel = {
      textures: { a: "x:blocks/a", b: "x:blocks/b" },
      elements: [cube({ up: { texture: "#a", cullface: "up" } })],
    };
    expect(ucwSourceTexture(input(model))).toBe("x:blocks/a");
  });

  it("gives missingno for an unresolved north face or no model", () => {
    const model: ResolvedModel = {
      textures: { a: "x:blocks/a", b: "x:blocks/b" },
      elements: [cube({ north: { texture: "#nope", cullface: "north" } })],
    };
    expect(ucwSourceTexture(input(model))).toBe(UCW_MISSING_TEXTURE);
    expect(ucwSourceTexture(input(null))).toBe(UCW_MISSING_TEXTURE);
    expect(ucwSourceTexture(input({ textures: {}, elements: null }))).toBe(
      UCW_MISSING_TEXTURE,
    );
  });

  it("normalises unprefixed texture ids to minecraft", () => {
    const model: ResolvedModel = {
      textures: { all: "blocks/planks_oak" },
      elements: null,
    };
    expect(ucwSourceTexture(input(model))).toBe("minecraft:blocks/planks_oak");
  });

  it("names Forestry and ExtraTrees planks after their variant", () => {
    expect(
      ucwSourceTexture(
        input(null, {
          blockId: "forestry:planks.0",
          properties: { variant: "larch" },
          modelNamespace: "forestry",
        }),
      ),
    ).toBe("forestry:blocks/wood/planks.larch");
    expect(
      ucwSourceTexture(
        input(null, {
          blockId: "extratrees:planks.1",
          properties: { variant: "fir" },
          modelNamespace: "extratrees",
        }),
      ),
    ).toBe("extratrees:blocks/planks/fir");
    // Not planks, or no variant: the generic rules apply.
    expect(
      ucwSourceTexture(
        input(null, {
          blockId: "forestry:logs.0",
          properties: { variant: "larch" },
          modelNamespace: "forestry",
        }),
      ),
    ).toBe(UCW_MISSING_TEXTURE);
    expect(
      ucwSourceTexture(
        input(null, {
          blockId: "forestry:planks.0",
          properties: {},
          modelNamespace: "forestry",
        }),
      ),
    ).toBe(UCW_MISSING_TEXTURE);
  });
});
