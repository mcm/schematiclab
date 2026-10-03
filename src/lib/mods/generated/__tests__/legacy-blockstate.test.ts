import { describe, expect, it } from "vitest";

import {
  legacyBlockstateVariant,
  legacyModelId,
  legacyVariantString,
} from "../legacy-blockstate";

// Shaped like Chisel 1.12's `planks-oak.json`: named variants, one-entry
// lists, `defaults` model.
const CHISEL_STYLE = {
  forge_marker: 1,
  defaults: { model: "cube_all" },
  variants: {
    blinds: [{ textures: { all: "chisel:blocks/planks-oak/blinds" } }],
    double: [
      {
        model: "cube_column",
        textures: {
          side: "chisel:blocks/planks-oak/double-side",
          end: "chisel:blocks/planks-oak/double-top",
        },
      },
    ],
    reinforceddirt: [{ textures: { all: "chisel:blocks/dirt/reinforced" } }],
  },
};

// Forge property objects, like Natura's nether planks.
const FORGE_PROPERTIES = {
  forge_marker: 1,
  defaults: { model: "natura:cube", textures: { particle: "#all" } },
  variants: {
    inventory: [{}],
    type: {
      ghostwood: { textures: { all: "natura:blocks/ghostwood" } },
      bloodwood: { textures: { all: "natura:blocks/bloodwood" }, y: 90 },
    },
    facing: { north: {}, east: { y: 90, uvlock: true } },
  },
};

const VANILLA_112 = {
  variants: {
    "axis=y,variant=oak": { model: "oak_log" },
    "axis=x,variant=oak": { model: "oak_log_side", x: 90, y: 90 },
    normal: { model: "unused" },
  },
};

describe("legacyVariantString", () => {
  it("sorts properties and names the stateless variant normal", () => {
    expect(legacyVariantString({ variant: "oak", axis: "y" })).toBe(
      "axis=y,variant=oak",
    );
    expect(legacyVariantString({})).toBe("normal");
  });
});

describe("legacyModelId", () => {
  it("adds the block/ prefix 1.12 blockstates imply", () => {
    expect(legacyModelId("cube_all")).toBe("minecraft:block/cube_all");
    expect(legacyModelId("chisel:cube_ctm")).toBe("chisel:block/cube_ctm");
  });
});

describe("legacyBlockstateVariant", () => {
  it("applies Forge defaults to a named variant", () => {
    expect(legacyBlockstateVariant(CHISEL_STYLE, "blinds")).toEqual({
      model: "minecraft:block/cube_all",
      textures: { all: "chisel:blocks/planks-oak/blinds" },
    });
    expect(legacyBlockstateVariant(CHISEL_STYLE, "double")).toEqual({
      model: "minecraft:block/cube_column",
      textures: {
        side: "chisel:blocks/planks-oak/double-side",
        end: "chisel:blocks/planks-oak/double-top",
      },
    });
  });

  it("lower-cases the variant like ModelResourceLocation", () => {
    expect(
      legacyBlockstateVariant(CHISEL_STYLE, "reinforcedDirt")?.textures,
    ).toEqual({ all: "chisel:blocks/dirt/reinforced" });
  });

  it("merges Forge property objects in variant order", () => {
    expect(
      legacyBlockstateVariant(FORGE_PROPERTIES, "facing=east,type=bloodwood"),
    ).toEqual({
      model: "natura:block/cube",
      textures: { particle: "#all", all: "natura:blocks/bloodwood" },
      y: 90,
      uvlock: true,
    });
  });

  it("matches a partial state against vanilla keys", () => {
    expect(legacyBlockstateVariant(VANILLA_112, "variant=oak")).toEqual({
      model: "minecraft:block/oak_log",
      textures: {},
    });
    expect(legacyBlockstateVariant(VANILLA_112, "axis=x,variant=oak")).toEqual({
      model: "minecraft:block/oak_log_side",
      textures: {},
      x: 90,
      y: 90,
    });
  });

  it("is null for unknown variants and modern blockstates without a model", () => {
    expect(legacyBlockstateVariant(CHISEL_STYLE, "nope")).toBeNull();
    expect(legacyBlockstateVariant(FORGE_PROPERTIES, "type=nope")).toBeNull();
    expect(legacyBlockstateVariant({ multipart: [] }, "normal")).toBeNull();
    expect(
      legacyBlockstateVariant({ variants: { normal: [{}] } }, "normal"),
    ).toBeNull();
    expect(legacyBlockstateVariant(null, "normal")).toBeNull();
  });
});
