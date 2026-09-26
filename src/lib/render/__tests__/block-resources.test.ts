import { beforeAll, describe, expect, it, vi } from "vitest";
import { Identifier, type Resources, type UV } from "deepslate";

import vanillaBlockstates from "../../../../public/minecraft-assets/blockstates.json";
import vanillaModels from "../../../../public/minecraft-assets/models.json";
import { MISSING_TEXTURE_ID } from "../atlas-layout";
import {
  assembleResources,
  blockstateModelRefs,
  createVanillaBlockData,
  type ModBlockAssets,
  type VanillaBlockData,
} from "../block-resources";

const MISSING_UV: UV = [0.5, 0.5, 0.75, 0.75];
const CASING_UV: UV = [0, 0.5, 0.25, 0.75];
const STONE_UV: UV = [0.25, 0, 0.5, 0.25];

const UV_MAP: Record<string, UV> = {
  [MISSING_TEXTURE_ID]: MISSING_UV,
  "create:block/casing": CASING_UV,
  "minecraft:block/stone": STONE_UV,
};
const ATLAS = { width: 4, height: 4 } as unknown as ImageData;

let vanilla: VanillaBlockData;

beforeAll(() => {
  vanilla = createVanillaBlockData(
    vanillaBlockstates as Record<string, unknown>,
    vanillaModels as Record<string, unknown>,
    ["minecraft:stone"],
  );
});

function assemble(mods: ModBlockAssets[]) {
  return assembleResources({ vanilla, mods, uvMap: UV_MAP, atlasImage: ATLAS });
}

const NO_CULL = {};

/** Distinct texture UV rects (`textureLimit`) used by a block's mesh. */
function meshTextureRects(resources: Resources, id: string): string[] {
  const name = Identifier.parse(id);
  const definition = resources.getBlockDefinition(name);
  if (definition === null) return [];
  const mesh = definition.getMesh(name, {}, resources, resources, NO_CULL);
  const rects = new Set<string>();
  for (const quad of mesh.quads) {
    rects.add(JSON.stringify(quad.v1.textureLimit));
  }
  return [...rects];
}

function quadCount(resources: Resources, id: string): number {
  const name = Identifier.parse(id);
  const definition = resources.getBlockDefinition(name);
  if (definition === null) return 0;
  return definition.getMesh(name, {}, resources, resources, NO_CULL).quads
    .length;
}

const CASING_MOD: ModBlockAssets = {
  blockstates: {
    "create:andesite_casing": {
      variants: { "": { model: "create:block/andesite_casing" } },
    },
  },
  models: {
    // Unprefixed parent resolves to minecraft:block/cube_all.
    "create:block/andesite_casing": {
      parent: "block/cube_all",
      textures: { all: "create:block/casing" },
    },
  },
};

describe("blockstateModelRefs", () => {
  it("collects variant and multipart models", () => {
    expect(
      blockstateModelRefs({
        variants: {
          "facing=north": { model: "a:block/x" },
          "facing=south": [{ model: "a:block/y" }, { model: "a:block/z" }],
        },
      }),
    ).toEqual(["a:block/x", "a:block/y"]);
    expect(
      blockstateModelRefs({
        multipart: [
          { apply: { model: "a:block/post" } },
          { when: { north: "true" }, apply: { model: "a:block/side" } },
        ],
      }),
    ).toEqual(["a:block/post", "a:block/side"]);
  });

  it("rejects forge_marker and malformed blockstates", () => {
    expect(
      blockstateModelRefs({ forge_marker: 1, defaults: { model: "x" } }),
    ).toBeNull();
    expect(blockstateModelRefs({ variants: { "": {} } })).toBeNull();
    expect(blockstateModelRefs(null)).toBeNull();
  });
});

describe("assembleResources", () => {
  it("renders a mod block whose model parents a vanilla model", () => {
    const { resources, placeholderBlocks } = assemble([CASING_MOD]);
    expect(placeholderBlocks).toEqual([]);
    expect(quadCount(resources, "create:andesite_casing")).toBe(6);
    expect(meshTextureRects(resources, "create:andesite_casing")).toEqual([
      JSON.stringify(CASING_UV),
    ]);
    expect(
      resources.getBlockModel(Identifier.parse("create:block/andesite_casing")),
    ).not.toBeNull();
  });

  it("does not mutate the stored mod model JSON", () => {
    const models = structuredClone(CASING_MOD.models);
    assemble([CASING_MOD]);
    expect(CASING_MOD.models).toEqual(models);
  });

  it("keeps vanilla blocks and flags as before", () => {
    const { resources } = assemble([CASING_MOD]);
    expect(meshTextureRects(resources, "minecraft:stone")).toEqual([
      JSON.stringify(STONE_UV),
    ]);
    expect(
      resources.getBlockFlags(Identifier.parse("minecraft:stone")),
    ).toEqual({ opaque: true });
    expect(
      resources.getBlockFlags(Identifier.parse("minecraft:glass")),
    ).toEqual({ opaque: false });
    expect(
      resources.getBlockDefinition(Identifier.parse("minecraft:not_a_block")),
    ).toBeNull();
  });

  it("falls back to the missing texture for unknown texture ids", () => {
    const { resources } = assemble([]);
    expect(
      resources.getTextureUV(Identifier.parse("create:block/nope")),
    ).toEqual(MISSING_UV);
  });

  const placeholderCases: Array<[string, ModBlockAssets]> = [
    [
      "custom loader model",
      {
        blockstates: {
          "m:obj": { variants: { "": { model: "m:block/obj" } } },
        },
        models: {
          "m:block/obj": { loader: "forge:obj", model: "m:models/x.obj" },
        },
      },
    ],
    [
      "model inheriting from a loader model",
      {
        blockstates: {
          "m:child": { variants: { "": { model: "m:block/child" } } },
        },
        models: {
          "m:block/base": { loader: "neoforge:composite" },
          "m:block/child": { parent: "m:block/base" },
        },
      },
    ],
    [
      "missing texture",
      {
        blockstates: {
          "m:tex": { variants: { "": { model: "m:block/tex" } } },
        },
        models: {
          "m:block/tex": {
            parent: "minecraft:block/cube_all",
            textures: { all: "m:block/absent" },
          },
        },
      },
    ],
    [
      "unresolvable model",
      {
        blockstates: {
          "m:gone": { variants: { "": { model: "m:block/gone" } } },
        },
        models: {},
      },
    ],
    [
      "missing parent",
      {
        blockstates: {
          "m:orphan": { variants: { "": { model: "m:block/orphan" } } },
        },
        models: { "m:block/orphan": { parent: "m:block/nowhere" } },
      },
    ],
    [
      "cyclic parents",
      {
        blockstates: { "m:loop": { variants: { "": { model: "m:block/a" } } } },
        models: {
          "m:block/a": { parent: "m:block/b" },
          "m:block/b": { parent: "m:block/a" },
        },
      },
    ],
    [
      "model without geometry",
      {
        blockstates: {
          "m:tile": { variants: { "": { model: "m:block/tile" } } },
        },
        models: { "m:block/tile": { parent: "builtin/entity" } },
      },
    ],
    [
      "forge_marker blockstate",
      {
        blockstates: {
          "m:old": { forge_marker: 1, defaults: { model: "m:block/x" } },
        },
        models: {},
      },
    ],
  ];

  it.each(placeholderCases)(
    "renders a placeholder cube for a %s",
    (_label, mod) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { resources, placeholderBlocks } = assemble([mod]);
      const [id] = Object.keys(mod.blockstates);
      expect(placeholderBlocks).toEqual([id]);
      expect(quadCount(resources, id)).toBe(6);
      expect(meshTextureRects(resources, id)).toEqual([
        JSON.stringify(MISSING_UV),
      ]);
      expect(resources.getBlockFlags(Identifier.parse(id))).toEqual({
        opaque: true,
      });
      warn.mockRestore();
    },
  );

  it("renders a placeholder for modded ids with no blockstate (e.g. mod removed)", () => {
    const { resources } = assemble([]);
    expect(quadCount(resources, "create:andesite_casing")).toBe(6);
    expect(meshTextureRects(resources, "create:andesite_casing")).toEqual([
      JSON.stringify(MISSING_UV),
    ]);
  });

  it("ignores mod assets in the minecraft namespace", () => {
    const { resources } = assemble([
      {
        blockstates: {
          "minecraft:stone": { variants: { "": { model: "m:block/x" } } },
        },
        models: { "minecraft:block/cube_all": { elements: [] } },
      },
    ]);
    expect(meshTextureRects(resources, "minecraft:stone")).toEqual([
      JSON.stringify(STONE_UV),
    ]);
  });
});
