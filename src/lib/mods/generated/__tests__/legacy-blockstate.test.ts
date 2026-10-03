import { describe, expect, it } from "vitest";

import {
  isLegacyBlockstate,
  legacyBlockstateRefs,
  legacyBlockstateVariant,
  legacyModelId,
  legacyVariantString,
  modernizeLegacyBlockstate,
  modernizeLegacyModAssets,
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

describe("isLegacyBlockstate", () => {
  const has = (id: string) =>
    ["minecraft:block/cube_all", "mod:block/a", "mod:b"].includes(id);

  it("is true for Forge files and unprefixed 1.12 model names", () => {
    expect(isLegacyBlockstate(CHISEL_STYLE, has)).toBe(true);
    expect(
      isLegacyBlockstate({ variants: { normal: { model: "mod:a" } } }, has),
    ).toBe(true);
    expect(
      isLegacyBlockstate({ variants: { "": { model: "cube_all" } } }, has),
    ).toBe(true);
  });

  it("is false for 1.13+ blockstates", () => {
    expect(
      isLegacyBlockstate({ variants: { "": { model: "mod:block/a" } } }, has),
    ).toBe(false);
    // An existing model without `block/` is read as written.
    expect(
      isLegacyBlockstate({ multipart: [{ apply: { model: "mod:b" } }] }, has),
    ).toBe(false);
    expect(isLegacyBlockstate(null, has)).toBe(false);
  });
});

describe("legacyBlockstateRefs", () => {
  it("lists models both ways and Forge variant textures", () => {
    const refs = legacyBlockstateRefs(FORGE_PROPERTIES);
    expect(refs.models.sort()).toEqual(["natura:block/cube", "natura:cube"]);
    expect(refs.textures.sort()).toEqual([
      "natura:blocks/bloodwood",
      "natura:blocks/ghostwood",
    ]);
  });
});

describe("modernizeLegacyBlockstate", () => {
  const none = () => false;

  it("draws each Forge property combination with its merged textures", () => {
    const modern = modernizeLegacyBlockstate(
      "natura:nether_planks",
      FORGE_PROPERTIES,
      none,
    )!;
    const variants = modern.blockstate.variants as Record<
      string,
      { model: string; y?: number; uvlock?: boolean }
    >;
    expect(Object.keys(variants)).toEqual([
      "facing=north,type=ghostwood",
      "facing=north,type=bloodwood",
      "facing=east,type=ghostwood",
      "facing=east,type=bloodwood",
    ]);
    const bloodEast = variants["facing=east,type=bloodwood"];
    expect(bloodEast).toMatchObject({ y: 90, uvlock: true });
    expect(modern.models[bloodEast.model]).toEqual({
      parent: "natura:block/cube",
      textures: { particle: "#all", all: "natura:blocks/bloodwood" },
    });
    expect(bloodEast.model).toMatch(
      /^natura:block\/legacy_variant\/nether_planks\/\d+$/,
    );
  });

  it('keeps explicit Forge keys but inventory, and names normal ""', () => {
    const modern = modernizeLegacyBlockstate(
      "mod:bricks",
      {
        forge_marker: 1,
        defaults: { model: "builtin/generated" },
        variants: {
          "color=white": [{ model: "mod:bricks_white" }],
          normal: [{ model: "mod:plain" }],
          inventory: [{}],
        },
      },
      none,
    )!;
    expect(modern.blockstate).toEqual({
      variants: {
        "color=white": { model: "mod:block/bricks_white" },
        "": { model: "mod:block/plain" },
      },
    });
    expect(modern.models).toEqual({});
  });

  it("adds block/ to a vanilla-format 1.12 file's models", () => {
    const modern = modernizeLegacyBlockstate(
      "minecraft:log",
      VANILLA_112,
      none,
    );
    expect(modern?.blockstate).toEqual({
      variants: {
        "axis=y,variant=oak": { model: "minecraft:block/oak_log" },
        "axis=x,variant=oak": {
          model: "minecraft:block/oak_log_side",
          x: 90,
          y: 90,
        },
        "": { model: "minecraft:block/unused" },
      },
    });
    const multipart = modernizeLegacyBlockstate(
      "mod:fence",
      { multipart: [{ when: { north: "true" }, apply: [{ model: "mod:f" }] }] },
      none,
    );
    expect(multipart?.blockstate).toEqual({
      multipart: [
        { when: { north: "true" }, apply: [{ model: "mod:block/f" }] },
      ],
    });
  });

  it("is null for 1.13+ blockstates", () => {
    expect(
      modernizeLegacyBlockstate(
        "mod:a",
        { variants: { "": { model: "mod:block/a" } } },
        none,
      ),
    ).toBeNull();
  });
});

describe("modernizeLegacyModAssets", () => {
  it("rewrites only 1.12 blockstates and adds their models", () => {
    const modern = { variants: { "": { model: "mod:block/a" } } };
    const assets = {
      blockstates: { "mod:a": modern, "mod:b": CHISEL_STYLE },
      models: { "mod:block/a": {} },
    };
    const out = modernizeLegacyModAssets(assets, () => false);
    expect(out.blockstates["mod:a"]).toBe(modern);
    expect(out.blockstates["mod:b"]).not.toBe(CHISEL_STYLE);
    expect(Object.keys(out.models).length).toBe(4);
    expect(assets.blockstates["mod:b"]).toBe(CHISEL_STYLE);
  });

  it("returns 1.13+ assets unchanged", () => {
    const assets = {
      blockstates: { "mod:a": { variants: { "": { model: "mod:block/a" } } } },
      models: {},
    };
    expect(modernizeLegacyModAssets(assets, () => false)).toBe(assets);
  });
});
