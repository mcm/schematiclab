import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BlockState,
  Identifier,
  SpecialRenderers,
  type Resources,
  type UV,
} from "deepslate";

import vanillaBlockstates from "../../../../public/minecraft-assets/blockstates.json";
import vanillaModels from "../../../../public/minecraft-assets/models.json";
import { MISSING_TEXTURE_ID, TRANSPARENT_TEXTURE_ID } from "../atlas-layout";
import {
  assembleResources,
  blockstateModelRefs,
  createVanillaBlockData,
  type ModBlockAssets,
  type VanillaBlockData,
} from "../block-resources";

const MISSING_UV: UV = [0.5, 0.5, 0.75, 0.75];
const TRANSPARENT_UV: UV = [0.75, 0.75, 1, 1];
const CASING_UV: UV = [0, 0.5, 0.25, 0.75];
const STONE_UV: UV = [0.25, 0, 0.5, 0.25];
const GLASS_UV: UV = [0.75, 0, 1, 0.25];

const GENERATED_UV: UV = [0.5, 0, 0.75, 0.25];
const GENERATED_TEXTURE =
  "ucw_generated:ucw_ucw_natura_nether_planks_0/chisel/blocks/planks-oak/clean";

const UV_MAP: Record<string, UV> = {
  [GENERATED_TEXTURE]: GENERATED_UV,
  [MISSING_TEXTURE_ID]: MISSING_UV,
  [TRANSPARENT_TEXTURE_ID]: TRANSPARENT_UV,
  "create:block/casing": CASING_UV,
  "minecraft:block/stone": STONE_UV,
  "minecraft:block/black_stained_glass": GLASS_UV,
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it("uses only the first weighted choice, as deepslate renders", () => {
    expect(
      blockstateModelRefs({
        multipart: [
          { apply: [{ model: "a:block/post" }, { model: "a:block/post2" }] },
          {
            when: { north: "true" },
            apply: [{ model: "a:block/side" }, { model: "a:block/side2" }],
          },
        ],
      }),
    ).toEqual(["a:block/post", "a:block/side"]);
    // A malformed later choice is never meshed, so it doesn't reject the file.
    expect(
      blockstateModelRefs({
        multipart: [{ apply: [{ model: "a:block/post" }, {}] }],
      }),
    ).toEqual(["a:block/post"]);
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

  it("renders a provider-generated block with its generated texture", () => {
    const id = "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0";
    const model = `unlimitedchiselworks:block/ucw_generated/x/variation_0`;
    const generated: ModBlockAssets = {
      blockstates: { [id]: { variants: { "variation=0": { model } } } },
      models: {
        [model]: {
          parent: "minecraft:block/cube_all",
          textures: { all: GENERATED_TEXTURE },
        },
      },
    };
    const { resources, placeholderBlocks } = assembleResources({
      vanilla,
      mods: [CASING_MOD],
      generated: [generated],
      uvMap: UV_MAP,
      atlasImage: ATLAS,
    });
    expect(placeholderBlocks).toEqual([]);
    const name = Identifier.parse(id);
    const mesh = resources
      .getBlockDefinition(name)!
      .getMesh(name, { variation: "0" }, resources, resources, NO_CULL);
    expect(mesh.quads).toHaveLength(6);
    expect(
      new Set(mesh.quads.map((quad) => JSON.stringify(quad.v1.textureLimit))),
    ).toEqual(new Set([JSON.stringify(GENERATED_UV)]));
    expect(resources.getBlockFlags(name)).toEqual({ opaque: false });
    // Mod blocks still render alongside.
    expect(quadCount(resources, "create:andesite_casing")).toBe(6);
  });

  it("renders a generated block whose texture failed as the placeholder", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = "unlimitedchiselworks:broken_0";
    const { placeholderBlocks } = assembleResources({
      vanilla,
      mods: [],
      generated: [
        {
          blockstates: { [id]: { variants: { "": { model: "u:block/b" } } } },
          models: {
            "u:block/b": {
              parent: "minecraft:block/cube_all",
              textures: { all: "ucw_generated:never_generated" },
            },
          },
        },
      ],
      uvMap: UV_MAP,
      atlasImage: ATLAS,
    });
    expect(placeholderBlocks).toEqual([id]);
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
  });

  it("renders unknown vanilla ids as the opaque placeholder cube", () => {
    const { resources } = assemble([]);
    // Renamed to `short_grass` in 1.20.3, so absent from the bundle.
    const grass = Identifier.parse("minecraft:grass");
    expect(resources.getBlockDefinition(grass)).toBe(
      resources.getBlockDefinition(Identifier.parse("create:unknown")),
    );
    expect(meshTextureRects(resources, "minecraft:grass")).toEqual([
      JSON.stringify(MISSING_UV),
    ]);
    expect(resources.getBlockFlags(grass)).toEqual({ opaque: true });
  });

  it("meshes vanilla models that use sprite-object textures", () => {
    const { resources } = assemble([]);
    // `black_stained_glass` uses `{ sprite, force_translucent }` (1.21.4+).
    expect(quadCount(resources, "minecraft:black_stained_glass")).toBe(6);
    expect(
      meshTextureRects(resources, "minecraft:black_stained_glass"),
    ).toEqual([JSON.stringify(GLASS_UV)]);
  });

  it("renders a mod model that uses sprite-object textures", () => {
    const { resources, placeholderBlocks } = assemble([
      {
        blockstates: {
          "create:glassy": {
            variants: { "": { model: "create:block/glassy" } },
          },
        },
        models: {
          "create:block/glassy": {
            parent: "block/cube_all",
            textures: {
              all: { sprite: "create:block/casing", force_translucent: true },
            },
          },
        },
      },
    ]);
    expect(placeholderBlocks).toEqual([]);
    expect(meshTextureRects(resources, "create:glassy")).toEqual([
      JSON.stringify(CASING_UV),
    ]);
  });

  it("falls back to the missing texture for unknown texture ids", () => {
    const { resources } = assemble([]);
    expect(
      resources.getTextureUV(Identifier.parse("create:block/nope")),
    ).toEqual(MISSING_UV);
  });

  describe("superseded entity textures", () => {
    const CELLS: Record<string, UV> = {
      transparent: TRANSPARENT_UV,
      missing: MISSING_UV,
    };

    /**
     * Which atlas cells deepslate's block-entity mesh samples. Each face's
     * `textureLimit` is a sub-rect of the cell its texture maps to.
     */
    function specialMeshCells(
      resources: Resources,
      id: string,
      properties: Record<string, string>,
    ): string[] {
      const mesh = SpecialRenderers.getBlockMesh(
        new BlockState(Identifier.parse(id), properties),
        undefined,
        resources,
        NO_CULL,
      );
      expect(mesh.quads.length).toBeGreaterThan(0);
      const cells = new Set<string>();
      for (const quad of mesh.quads) {
        const limit = quad.v1.textureLimit;
        if (limit === undefined) {
          cells.add("untextured");
          continue;
        }
        const [u0, v0, u1, v1] = limit;
        const cell = Object.entries(CELLS).find(
          ([, [x0, y0, x1, y1]]) =>
            u0 >= x0 && v0 >= y0 && u1 <= x1 && v1 <= y1,
        );
        cells.add(cell?.[0] ?? "other");
      }
      return [...cells];
    }

    it("hides deepslate's bed and sign entity meshes", () => {
      const { resources } = assemble([]);
      expect(
        specialMeshCells(resources, "minecraft:red_bed", {
          facing: "south",
          occupied: "false",
          part: "foot",
        }),
      ).toEqual(["transparent"]);
      expect(
        specialMeshCells(resources, "minecraft:oak_hanging_sign", {
          attached: "false",
          rotation: "0",
        }),
      ).toEqual(["transparent"]);
    });

    it("keeps other missing entity textures visible", () => {
      const { resources } = assemble([]);
      expect(
        specialMeshCells(resources, "minecraft:chest", {
          facing: "north",
          type: "single",
        }),
      ).toEqual(["missing"]);
    });

    it("uses the texture when the atlas has it", () => {
      const bedUv: UV = [0, 0, 0.25, 0.25];
      const { resources } = assembleResources({
        vanilla,
        mods: [],
        uvMap: { ...UV_MAP, "minecraft:entity/bed/red": bedUv },
        atlasImage: ATLAS,
      });
      expect(
        resources.getTextureUV(Identifier.parse("minecraft:entity/bed/red")),
      ).toEqual(bedUv);
    });

    it("falls back to the missing texture without a transparent cell", () => {
      const { [TRANSPARENT_TEXTURE_ID]: _transparent, ...uvMap } = UV_MAP;
      const { resources } = assembleResources({
        vanilla,
        mods: [],
        uvMap,
        atlasImage: ATLAS,
      });
      expect(
        resources.getTextureUV(Identifier.parse("minecraft:entity/signs/oak")),
      ).toEqual(MISSING_UV);
    });
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
      "model whose shape deepslate can't flatten",
      {
        blockstates: {
          "m:bad": { variants: { "": { model: "m:block/bad" } } },
        },
        // `flatten` throws assigning inherited textures onto a string.
        models: { "m:block/bad": { parent: "block/cube_all", textures: "x" } },
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
      vi.spyOn(console, "warn").mockImplementation(() => {});
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
    },
  );

  it("sizes the shader pixel inset by the atlas's larger dimension", () => {
    const atlasImage = { width: 64, height: 256 } as unknown as ImageData;
    const { resources } = assembleResources({
      vanilla,
      mods: [],
      uvMap: UV_MAP,
      atlasImage,
    });
    expect(resources.getPixelSize?.()).toBe(1 / 256);
  });

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
