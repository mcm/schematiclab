import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  srgbToOklab,
  type AppearanceSources,
} from "../../render/block-appearance";
import { rgbaPng, solidPng } from "../../render/__tests__/encode-png";
import { computeModAppearances } from "../mod-appearance";
import { parseModJar } from "../parse-mod-jar";
import {
  __resetVanillaAppearanceSourcesForTests,
  loadVanillaAppearanceSources,
} from "../vanilla-appearance-sources";

const CUBE = {
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: Object.fromEntries(
        ["down", "up", "north", "south", "west", "east"].map((face) => [
          face,
          { texture: `#${face}` },
        ]),
      ),
    },
  ],
};
const CUBE_ALL = {
  parent: "block/cube",
  textures: Object.fromEntries(
    ["particle", "down", "up", "north", "south", "west", "east"].map((v) => [
      v,
      "#all",
    ]),
  ),
};

/** Vanilla sources with `cube`/`cube_all` and a solid blue `block/stone`. */
const VANILLA: AppearanceSources = {
  getModel: (id) =>
    ({
      "minecraft:block/cube": CUBE,
      "minecraft:block/cube_all": CUBE_ALL,
    })[id],
  getTextureColor: (id) =>
    id === "minecraft:block/stone" ? { r: 0, g: 0, b: 1, a: 1 } : null,
};

function jar(files: Record<string, Uint8Array | object>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] =
      value instanceof Uint8Array ? value : strToU8(JSON.stringify(value));
  }
  return zipSync(entries);
}

const RED_OKLAB = srgbToOklab(255, 0, 0).map(
  (v) => Math.round(v * 1000) / 1000,
);

describe("computeModAppearances", () => {
  const input = {
    blockIds: ["a:red", "a:stone_like", "a:animated", "a:missing"],
    blockstates: {
      "a:red": { variants: { "": { model: "a:block/red" } } },
      "a:stone_like": { variants: { "": { model: "a:block/stone_like" } } },
      "a:animated": { variants: { "": { model: "a:block/animated" } } },
      "a:missing": { variants: { "": { model: "a:block/none" } } },
    },
    models: {
      "a:block/red": {
        parent: "minecraft:block/cube_all",
        textures: { all: "a:block/red" },
      },
      "a:block/stone_like": {
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/stone" },
      },
      "a:block/animated": {
        parent: "minecraft:block/cube_all",
        textures: { all: "a:block/animated" },
      },
    },
    textures: {
      "a:block/red": solidPng([255, 0, 0, 255]),
      // Red frame over a blue frame; only the first frame counts.
      "a:block/animated": rgbaPng(1, 2, [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ]),
    },
    textureMeta: { "a:block/animated": { animation: { frametime: 2 } } },
  };

  it("resolves vanilla parents and textures through the vanilla sources", () => {
    const appearances = computeModAppearances(input, VANILLA);
    expect(appearances["a:red"]).toEqual({ oklab: RED_OKLAB, fullCube: true });
    expect(appearances["a:animated"]).toEqual({
      oklab: RED_OKLAB,
      fullCube: true,
    });
    expect(appearances["a:stone_like"]!.oklab).toEqual(
      srgbToOklab(0, 0, 255).map((v) => Math.round(v * 1000) / 1000),
    );
    expect(appearances).not.toHaveProperty("a:missing");
  });

  it("omits blocks that need vanilla parents when vanilla is unavailable", () => {
    expect(computeModAppearances(input, null)).toEqual({});
  });

  it("ignores undecodable textures", () => {
    expect(
      computeModAppearances(
        {
          ...input,
          blockIds: ["a:red"],
          textures: { "a:block/red": new Uint8Array([1, 2, 3]) },
        },
        VANILLA,
      ),
    ).toEqual({});
  });
});

describe("parseModJar appearances", () => {
  const bytes = () =>
    jar({
      "assets/a/blockstates/red.json": {
        variants: { "": { model: "a:block/red" } },
      },
      "assets/a/models/block/red.json": {
        parent: "minecraft:block/cube_all",
        textures: { all: "a:block/red" },
      },
      "assets/a/textures/block/red.png": solidPng([255, 0, 0, 255]),
    });

  it("stores appearances on blocks when vanilla sources are available", () => {
    const result = parseModJar(bytes(), VANILLA);
    expect(result.appearancesComputed).toBe(true);
    expect(result.blocks[0].appearance).toEqual({
      oklab: RED_OKLAB,
      fullCube: true,
    });
  });

  it("reads 1.12 Forge blockstates and 1.12 vanilla texture names", () => {
    const result = parseModJar(
      jar({
        "assets/a/blockstates/planks.json": {
          forge_marker: 1,
          defaults: { model: "cube_all" },
          variants: {
            type: {
              red: { textures: { all: "a:blocks/red" } },
              stone: { textures: { all: "blocks/stone" } },
            },
          },
        },
        "assets/a/blockstates/plain.json": {
          forge_marker: 1,
          variants: { normal: [{ model: "a:plain" }] },
        },
        "assets/a/models/block/plain.json": {
          parent: "block/cube_all",
          textures: { all: "minecraft:blocks/stone" },
        },
        "assets/a/textures/blocks/red.png": solidPng([255, 0, 0, 255]),
        "assets/a/textures/blocks/unused.png": solidPng([0, 255, 0, 255]),
      }),
      VANILLA,
    );
    // The jar keeps what 1.12 blockstates use, though no `variants` entry
    // names a model.
    expect(Object.keys(result.textures)).toEqual(["a:blocks/red"]);
    expect(Object.keys(result.models)).toEqual(["a:block/plain"]);
    const appearance = (id: string) =>
      result.blocks.find((block) => block.id === id)?.appearance;
    expect(appearance("a:planks")).toEqual({
      oklab: RED_OKLAB,
      fullCube: true,
    });
    expect(appearance("a:plain")?.oklab).toEqual(
      srgbToOklab(0, 0, 255).map((v) => Math.round(v * 1000) / 1000),
    );
  });

  it("leaves appearance absent when textures can't be resolved", () => {
    const result = parseModJar(bytes());
    expect(result.appearancesComputed).toBe(false);
    expect(result.blocks[0]).not.toHaveProperty("appearance");
  });
});

describe("loadVanillaAppearanceSources", () => {
  afterEach(() => {
    __resetVanillaAppearanceSourcesForTests();
    vi.restoreAllMocks();
  });

  const bundle: Record<string, () => Response> = {
    "/minecraft-assets/models.json": () =>
      Response.json({ cube: CUBE, cube_all: CUBE_ALL }),
    "/minecraft-assets/atlas-uvs.json": () =>
      Response.json({ "block/stone": [0, 0, 1, 1] }),
    "/minecraft-assets/atlas.png": () =>
      new Response(solidPng([0, 0, 255, 255], 1)),
  };

  it("reads models and atlas colours from the bundle, once", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      bundle[String(url)](),
    );
    const sources = await loadVanillaAppearanceSources(fetchImpl as never);
    await loadVanillaAppearanceSources(fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sources!.getModel("minecraft:block/cube")).toEqual(CUBE);
    expect(sources!.getTextureColor("minecraft:block/stone")).toEqual({
      r: 0,
      g: 0,
      b: 1,
      a: 1,
    });
    expect(sources!.getTextureColor("minecraft:block/dirt")).toBeNull();
  });

  it("resolves null on failure and retries next time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => new Response("", { status: 404 }));
    expect(await loadVanillaAppearanceSources(failing as never)).toBeNull();

    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      bundle[String(url)](),
    );
    expect(
      await loadVanillaAppearanceSources(fetchImpl as never),
    ).not.toBeNull();
  });
});
