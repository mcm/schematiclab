import { describe, expect, it } from "vitest";

import {
  atlasTextureColors,
  averageTextureColor,
  blockAppearance,
  combineFaceColors,
  decodePng,
  defaultStateModels,
  defaultTint,
  firstFrameRegion,
  isFullCubeModel,
  linearSrgbToOklab,
  resolveModel,
  resolveTextureRef,
  srgbToLinear,
  srgbToOklab,
  vanillaBlockColors,
  vanillaModelLookup,
  type AppearanceSources,
  type RgbaImage,
  type TextureColor,
} from "../block-appearance";
import { encodePng, rgbaPng } from "./encode-png";

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

function image(width: number, height: number, pixels: number[][]): RgbaImage {
  return { width, height, data: new Uint8Array(pixels.flat()) };
}

function solid(r: number, g: number, b: number, a = 1): TextureColor {
  const lr = srgbToLinear(r) * a;
  const lg = srgbToLinear(g) * a;
  const lb = srgbToLinear(b) * a;
  return { r: lr, g: lg, b: lb, a };
}

function expectOklab(
  actual: readonly number[] | undefined,
  expected: readonly number[],
  digits = 3,
): void {
  expect(actual).toBeDefined();
  actual!.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
}

const CUBE = {
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        down: { texture: "#down" },
        up: { texture: "#up" },
        north: { texture: "#north" },
        south: { texture: "#south" },
        west: { texture: "#west" },
        east: { texture: "#east" },
      },
    },
  ],
};
const CUBE_ALL = {
  parent: "block/cube",
  textures: {
    particle: "#all",
    down: "#all",
    up: "#all",
    north: "#all",
    south: "#all",
    west: "#all",
    east: "#all",
  },
};
const CUBE_COLUMN = {
  parent: "minecraft:block/cube",
  textures: {
    particle: "#side",
    down: "#end",
    up: "#end",
    north: "#side",
    south: "#side",
    west: "#side",
    east: "#side",
  },
};
const SLAB = {
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 8, 16],
      faces: { up: { texture: "#top" }, down: { texture: "#top" } },
    },
  ],
};

function sources(
  models: Record<string, unknown>,
  textures: Record<string, TextureColor>,
): AppearanceSources {
  return {
    getModel: (id) => models[id],
    getTextureColor: (id) => textures[id] ?? null,
  };
}

describe("decodePng", () => {
  it("decodes RGBA8 with every filter type", () => {
    const pixels = [
      [10, 20, 30, 255],
      [200, 100, 50, 128],
      [0, 255, 0, 0],
      [90, 80, 70, 60],
      [1, 2, 3, 4],
      [250, 240, 230, 220],
    ];
    for (const filter of [0, 1, 2, 3, 4] as const) {
      const decoded = decodePng(rgbaPng(3, 2, pixels, filter));
      expect(decoded).toEqual({
        width: 3,
        height: 2,
        data: new Uint8Array(pixels.flat()),
      });
    }
  });

  it("decodes 4-bit palette images with tRNS alpha", () => {
    // Two pixels per byte: indices 0,1 then 1,0.
    const decoded = decodePng(
      encodePng({
        width: 2,
        height: 2,
        colorType: 3,
        depth: 4,
        scanlines: new Uint8Array([0x01, 0x10]),
        palette: [255, 0, 0, 0, 0, 255],
        transparency: [128],
      }),
    );
    expect([...decoded!.data]).toEqual([
      ...[255, 0, 0, 128],
      ...[0, 0, 255, 255],
      ...[0, 0, 255, 255],
      ...[255, 0, 0, 128],
    ]);
  });

  it("decodes greyscale, greyscale+alpha, RGB and 16-bit images", () => {
    const grey1 = decodePng(
      encodePng({
        width: 2,
        height: 1,
        colorType: 0,
        depth: 1,
        scanlines: new Uint8Array([0b10000000]),
      }),
    );
    expect([...grey1!.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);

    const greyAlpha = decodePng(
      encodePng({
        width: 1,
        height: 1,
        colorType: 4,
        scanlines: new Uint8Array([100, 50]),
      }),
    );
    expect([...greyAlpha!.data]).toEqual([100, 100, 100, 50]);

    // RGB with a tRNS colour key: the second pixel is transparent.
    const rgb = decodePng(
      encodePng({
        width: 2,
        height: 1,
        colorType: 2,
        scanlines: new Uint8Array([1, 2, 3, 4, 5, 6]),
        transparency: [0, 4, 0, 5, 0, 6],
      }),
    );
    expect([...rgb!.data]).toEqual([1, 2, 3, 255, 4, 5, 6, 0]);

    const deep = decodePng(
      encodePng({
        width: 1,
        height: 1,
        colorType: 6,
        depth: 16,
        scanlines: new Uint8Array([
          0xff, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
        ]),
      }),
    );
    expect([...deep!.data]).toEqual([255, 128, 0, 255]);
  });

  it("returns null for non-PNG, truncated or interlaced input", () => {
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
    const png = rgbaPng(1, 1, [RED]);
    expect(decodePng(png.subarray(0, 40))).toBeNull();
    const interlaced = png.slice();
    interlaced[8 + 8 + 12] = 1; // IHDR interlace byte
    expect(decodePng(interlaced)).toBeNull();
  });
});

describe("colour maths", () => {
  it("converts sRGB to OKLab", () => {
    expectOklab(srgbToOklab(255, 255, 255), [1, 0, 0]);
    expectOklab(srgbToOklab(0, 0, 0), [0, 0, 0]);
    expectOklab(srgbToOklab(255, 0, 0), [0.628, 0.2249, 0.1258]);
    expectOklab(linearSrgbToOklab(0, 0, 1), [0.452, -0.0325, -0.3115]);
  });

  it("linearises sRGB channels", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBe(1);
    expect(srgbToLinear(128)).toBeCloseTo(0.2159, 4);
  });

  it("weights pixels by alpha, so transparent pixels don't dilute the colour", () => {
    const color = averageTextureColor(image(2, 1, [RED, CLEAR]));
    expect(color.a).toBeCloseTo(0.5);
    expectOklab(
      combineFaceColors([color]) ?? undefined,
      srgbToOklab(255, 0, 0),
    );
  });

  it("averages a region only", () => {
    const img = image(2, 2, [RED, BLUE, BLUE, BLUE]);
    expect(averageTextureColor(img, [0, 0, 1, 1])).toEqual(solid(255, 0, 0));
    expect(averageTextureColor(img, [5, 5, 1, 1])).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("weights faces equally regardless of texture size", () => {
    const big = averageTextureColor(image(2, 2, [RED, RED, RED, RED]));
    const small = averageTextureColor(image(1, 1, [BLUE]));
    const mixed = combineFaceColors([big, small])!;
    // Equal parts linear red and blue.
    expectOklab(mixed, linearSrgbToOklab(0.5, 0, 0.5));
  });

  it("returns null when every face is transparent", () => {
    expect(combineFaceColors([])).toBeNull();
    expect(combineFaceColors([{ r: 0, g: 0, b: 0, a: 0 }])).toBeNull();
  });

  it("picks the first frame of animated textures", () => {
    expect(firstFrameRegion(16, 64)).toEqual([0, 0, 16, 64]);
    expect(firstFrameRegion(16, 64, { animation: {} })).toEqual([0, 0, 16, 16]);
    expect(
      firstFrameRegion(32, 64, { animation: { width: 16, height: 8 } }),
    ).toEqual([0, 0, 16, 8]);
  });
});

describe("models", () => {
  it("detects single full cubes", () => {
    expect(isFullCubeModel(CUBE.elements)).toBe(true);
    // Overlay layers on the same cube (grass block) still count.
    expect(isFullCubeModel([...CUBE.elements, ...CUBE.elements])).toBe(true);
    expect(isFullCubeModel(SLAB.elements)).toBe(false);
    expect(isFullCubeModel([...CUBE.elements, ...SLAB.elements])).toBe(false);
    expect(isFullCubeModel([])).toBe(false);
    expect(isFullCubeModel(null)).toBe(false);
  });

  it("picks the default state's models", () => {
    expect(
      defaultStateModels({
        variants: {
          "facing=north": [{ model: "a:block/x" }, { model: "a:block/y" }],
          "facing=south": { model: "a:block/z" },
        },
      }),
    ).toEqual(["a:block/x"]);
    expect(
      defaultStateModels({
        multipart: [
          { apply: { model: "block/post" } },
          { when: { north: "true" }, apply: { model: "block/side" } },
        ],
      }),
    ).toEqual(["minecraft:block/post"]);
    expect(
      defaultStateModels({
        multipart: [{ when: { up: "true" }, apply: [{ model: "a:block/up" }] }],
      }),
    ).toEqual(["a:block/up"]);
    expect(defaultStateModels(null)).toEqual([]);
    expect(defaultStateModels({ variants: {} })).toEqual([]);
  });

  it("picks the variant matching the default properties", () => {
    const sensor = {
      variants: {
        "power=0,sculk_sensor_phase=active": { model: "a:block/active" },
        "power=0,sculk_sensor_phase=inactive": { model: "a:block/inactive" },
      },
    };
    const defaults = { power: "0", sculk_sensor_phase: "inactive" };
    expect(defaultStateModels(sensor, defaults)).toEqual(["a:block/inactive"]);
    // Without defaults (mods), or when nothing matches, the first variant.
    expect(defaultStateModels(sensor)).toEqual(["a:block/active"]);
    expect(defaultStateModels(sensor, { power: "3" })).toEqual([
      "a:block/active",
    ]);
    // Keys may name only some properties, or none.
    expect(
      defaultStateModels(
        {
          variants: {
            "lit=false": { model: "a:block/off" },
            "lit=true": { model: "a:block/on" },
          },
        },
        { facing: "north", lit: "true" },
      ),
    ).toEqual(["a:block/on"]);
    expect(
      defaultStateModels(
        { variants: { "": { model: "a:block/only" } } },
        { facing: "north" },
      ),
    ).toEqual(["a:block/only"]);
  });

  it("picks the multipart parts matching the default properties", () => {
    const pane = {
      multipart: [
        { apply: { model: "a:block/post" } },
        { when: { north: "true" }, apply: { model: "a:block/side" } },
        { when: { north: "false" }, apply: { model: "a:block/noside" } },
        { when: { east: "!false" }, apply: { model: "a:block/east" } },
        {
          when: { OR: [{ north: "true" }, { east: "low|tall" }] },
          apply: { model: "a:block/or" },
        },
        {
          when: { AND: [{ north: "false" }, { east: "false" }] },
          apply: { model: "a:block/and" },
        },
      ],
    };
    expect(defaultStateModels(pane, { north: "false", east: "false" })).toEqual(
      ["a:block/post", "a:block/noside", "a:block/and"],
    );
    expect(defaultStateModels(pane, { north: "true", east: "tall" })).toEqual([
      "a:block/post",
      "a:block/side",
      "a:block/east",
      "a:block/or",
    ]);
    // No matching part: fall back to the unconditional parts / first part.
    expect(
      defaultStateModels(
        {
          multipart: [{ when: { up: "true" }, apply: { model: "a:block/up" } }],
        },
        { up: "false" },
      ),
    ).toEqual(["a:block/up"]);
  });

  it("merges texture variables down the parent chain", () => {
    const models = {
      "minecraft:block/cube": CUBE,
      "minecraft:block/cube_all": CUBE_ALL,
      "a:block/x": {
        parent: "minecraft:block/cube_all",
        textures: { all: "a:block/x" },
      },
    };
    const resolved = resolveModel(
      "a:block/x",
      (id) => models[id as keyof typeof models],
    )!;
    expect(resolved.elements).toBe(CUBE.elements);
    expect(resolveTextureRef("#north", resolved.textures)).toBe("a:block/x");
    expect(resolveTextureRef({ sprite: "block/y" }, {})).toBe(
      "minecraft:block/y",
    );
    expect(resolveTextureRef("#missing", resolved.textures)).toBeNull();
    expect(resolveTextureRef("#a", { a: "#b", b: "#a" })).toBeNull();
    expect(resolveModel("a:block/none", () => undefined)).toBeNull();
  });

  it("treats a missing parent as unresolved, except builtin parents", () => {
    const models: Record<string, unknown> = {
      "a:block/orphan": { parent: "a:block/gone", textures: { all: "a:t" } },
      "a:block/entity": {
        parent: "builtin/entity",
        textures: { particle: "a:t" },
      },
    };
    expect(resolveModel("a:block/orphan", (id) => models[id])).toBeNull();
    expect(resolveModel("a:block/entity", (id) => models[id])).toEqual({
      textures: { particle: "a:t" },
      elements: null,
    });
  });

  it("stops on parent cycles", () => {
    const models: Record<string, unknown> = {
      "a:block/x": { parent: "a:block/y", textures: { all: "a:t" } },
      "a:block/y": { parent: "a:block/x" },
    };
    expect(resolveModel("a:block/x", (id) => models[id])).toEqual({
      textures: { all: "a:t" },
      elements: null,
    });
  });
});

describe("blockAppearance", () => {
  const models = {
    "minecraft:block/cube": CUBE,
    "minecraft:block/cube_all": CUBE_ALL,
    "minecraft:block/cube_column": CUBE_COLUMN,
  };

  it("averages every face of a full cube equally", () => {
    const appearance = blockAppearance(
      "a:log",
      { variants: { "axis=y": { model: "a:block/log" } } },
      sources(
        {
          ...models,
          "a:block/log": {
            parent: "minecraft:block/cube_column",
            textures: { side: "a:block/log_side", end: "a:block/log_top" },
          },
        },
        {
          "a:block/log_side": solid(255, 0, 0),
          "a:block/log_top": solid(0, 0, 255),
        },
      ),
    );
    expect(appearance!.fullCube).toBe(true);
    // Four red sides and two blue ends.
    expectOklab(appearance!.oklab, linearSrgbToOklab(4 / 6, 0, 2 / 6));
  });

  it("marks partial shapes and multipart blocks as not full cubes", () => {
    const slab = blockAppearance(
      "a:slab",
      { variants: { "": { model: "a:block/slab" } } },
      sources(
        { "a:block/slab": { ...SLAB, textures: { top: "a:block/t" } } },
        { "a:block/t": solid(255, 0, 0) },
      ),
    );
    expect(slab).toEqual({ oklab: [0.628, 0.225, 0.126], fullCube: false });

    const partSources = sources(
      {
        ...models,
        "a:block/cube": {
          parent: "block/cube_all",
          textures: { all: "a:block/t" },
        },
        "a:block/post": { ...SLAB, textures: { top: "a:block/t" } },
      },
      { "a:block/t": solid(255, 0, 0) },
    );
    const fence = blockAppearance(
      "a:fence",
      {
        multipart: [
          { apply: { model: "a:block/post" } },
          { apply: { model: "a:block/post" } },
        ],
      },
      partSources,
    );
    expect(fence!.fullCube).toBe(false);

    // A full-cube part with overlay parts (chiseled bookshelf slots) is still
    // a full cube, unless one of its parts can't be resolved.
    const overlaid = blockAppearance(
      "a:shelf",
      {
        multipart: [
          { apply: { model: "a:block/cube" } },
          { apply: { model: "a:block/post" } },
        ],
      },
      partSources,
    );
    expect(overlaid!.fullCube).toBe(true);
    const unresolved = blockAppearance(
      "a:shelf",
      {
        multipart: [
          { apply: { model: "a:block/cube" } },
          { apply: { model: "a:block/missing" } },
        ],
      },
      partSources,
    );
    expect(unresolved!.fullCube).toBe(false);
  });

  it("uses the variant matching the default properties", () => {
    const blockstate = {
      variants: {
        "phase=active": { model: "a:block/blue" },
        "phase=inactive": { model: "a:block/red" },
      },
    };
    const colored = sources(
      {
        ...models,
        "a:block/blue": { parent: "block/cube_all", textures: { all: "a:b" } },
        "a:block/red": { parent: "block/cube_all", textures: { all: "a:r" } },
      },
      { "a:b": solid(0, 0, 255), "a:r": solid(255, 0, 0) },
    );
    expect(blockAppearance("a:x", blockstate, colored)!.oklab).toEqual(
      blockAppearance(
        "a:x",
        { variants: { "": { model: "a:block/blue" } } },
        colored,
      )!.oklab,
    );
    expect(
      blockAppearance("a:x", blockstate, colored, { phase: "inactive" })!.oklab,
    ).toEqual([0.628, 0.225, 0.126]);
  });

  it("applies the default tint to tinted faces", () => {
    const appearance = blockAppearance(
      "a:leaves",
      { variants: { "": { model: "a:block/leaves" } } },
      sources(
        {
          "a:block/leaves": {
            textures: { all: "a:block/grey" },
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: { up: { texture: "all", tintindex: 0 } },
              },
            ],
          },
        },
        { "a:block/grey": solid(255, 255, 255) },
      ),
    );
    const tint = defaultTint("a:leaves");
    expectOklab(
      appearance!.oklab,
      srgbToOklab(tint >> 16, (tint >> 8) & 0xff, tint & 0xff),
    );
    expect(defaultTint("minecraft:grass_block")).not.toBe(tint);
    expect(defaultTint("minecraft:water")).toBe(0x3f76e4);
  });

  it("falls back to texture variables for models without elements", () => {
    const appearance = blockAppearance(
      "a:chest",
      { variants: { "": { model: "a:block/chest" } } },
      sources(
        { "a:block/chest": { textures: { particle: "a:block/planks" } } },
        { "a:block/planks": solid(0, 0, 255) },
      ),
    );
    expect(appearance!.fullCube).toBe(false);
    expectOklab(appearance!.oklab, srgbToOklab(0, 0, 255));
  });

  it("is undefined when models or textures can't be resolved", () => {
    const state = { variants: { "": { model: "a:block/x" } } };
    expect(blockAppearance("a:x", state, sources({}, {}))).toBeUndefined();
    expect(
      blockAppearance(
        "a:x",
        state,
        sources(
          {
            ...models,
            "a:block/x": { parent: "block/cube_all", textures: { all: "a:t" } },
          },
          {},
        ),
      ),
    ).toBeUndefined();
  });
});

describe("vanilla bundle", () => {
  // A 2×4 atlas: a red 2×2 sprite on top of a 2×2 blue/clear strip.
  const atlas = image(2, 4, [RED, RED, RED, RED, BLUE, CLEAR, BLUE, CLEAR]);
  const uvs = {
    "block/red": [0, 0, 2, 2],
    "block/strip": [0, 2, 1, 2],
    "block/bad": "nope",
  };

  it("looks up textures in the atlas, using an animation's first frame", () => {
    const colors = atlasTextureColors(atlas, uvs);
    expect(colors("minecraft:block/red")).toEqual(solid(255, 0, 0));
    // [0, 2, 1, 2] is a 1-wide, 2-tall strip: only its first 1×1 frame counts.
    expect(colors("minecraft:block/strip")).toEqual(solid(0, 0, 255));
    expect(colors("minecraft:block/bad")).toBeNull();
    expect(colors("minecraft:block/missing")).toBeNull();
    expect(colors("a:block/red")).toBeNull();
  });

  it("looks up models by their path under models/block", () => {
    const lookup = vanillaModelLookup({ stone: { a: 1 } });
    expect(lookup("minecraft:block/stone")).toEqual({ a: 1 });
    expect(lookup("minecraft:item/stone")).toBeUndefined();
    expect(lookup("minecraft:block/constructor")).toBeUndefined();
  });

  it("builds block-colors.json entries for resolvable blocks", () => {
    const colors = vanillaBlockColors(
      {
        red_block: { variants: { "": { model: "minecraft:block/red_block" } } },
        air: { variants: { "": { model: "minecraft:block/air" } } },
      },
      {
        cube: CUBE,
        cube_all: CUBE_ALL,
        red_block: { parent: "block/cube_all", textures: { all: "block/red" } },
        air: { textures: { particle: "block/missing" } },
      },
      atlas,
      uvs,
    );
    expect(colors).toEqual({
      "minecraft:red_block": { oklab: [0.628, 0.225, 0.126], fullCube: true },
    });
  });
});
