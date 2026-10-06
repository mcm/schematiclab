import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng, type RgbaImage } from "../../render/block-appearance";
import {
  appearanceRecord,
  describeBlockAppearance,
  describeModBlocks,
  describeVanillaBlocks,
  MAX_SWATCH_SHEET_BYTES,
  packSwatches,
  vanillaDescriptorSources,
  type DescriptorSources,
  type SwatchBlock,
} from "../appearance";
import { encodeRgbaPng } from "../png";
import { modBlockAppearanceSchema } from "../schema";

type Rgba = readonly [number, number, number, number];

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

const png = (img: RgbaImage) => encodeRgbaPng(img.width, img.height, img.data);
const solid = (rgba: Rgba, size = 16) => image(size, size, () => rgba);

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const WHITE: Rgba = [255, 255, 255, 255];

const ASSETS = path.join(process.cwd(), "public", "minecraft-assets");
const vanillaModels = JSON.parse(
  readFileSync(path.join(ASSETS, "models.json"), "utf8"),
) as Record<string, unknown>;

/** Vanilla models only; vanilla textures aren't needed for these tests. */
const vanillaModelsOnly: DescriptorSources = vanillaDescriptorSources({
  models: vanillaModels,
  atlas: { width: 1, height: 1, data: new Uint8Array(4) },
  uvs: {},
});

/** One mod block `test:<name>` with a single-variant blockstate. */
function modBlock(
  name: string,
  model: Record<string, unknown>,
  textures: Record<string, RgbaImage>,
  textureMeta: Record<string, unknown> = {},
) {
  const id = `test:${name}`;
  return describeModBlocks(
    {
      blockIds: [id],
      blockstates: {
        [id]: { variants: { "": { model: `test:block/${name}` } } },
      },
      models: { [`test:block/${name}`]: model },
      textures: Object.fromEntries(
        Object.entries(textures).map(([k, v]) => [k, png(v)]),
      ),
      textureMeta,
    },
    vanillaModelsOnly,
  )[id];
}

const cubeAll = (texture: string) => ({
  parent: "minecraft:block/cube_all",
  textures: { all: texture },
});

function pixelAt(img: RgbaImage, x: number, y: number): number[] {
  const o = (y * img.width + x) * 4;
  return [...img.data.subarray(o, o + 4)];
}

function everyPixel(img: RgbaImage, rgba: Rgba): boolean {
  for (let i = 0; i < img.width * img.height; i++) {
    if (!rgba.every((v, c) => img.data[i * 4 + c] === v)) return false;
  }
  return true;
}

describe("describeBlockAppearance", () => {
  it("gives a solid colour one dominant colour and no variance", () => {
    const d = modBlock("red", cubeAll("test:block/red"), {
      "test:block/red": solid(RED),
    })!;
    expect(d.hex).toBe("#ff0000");
    expect(d.dominant).toEqual([{ hex: "#ff0000", share: 1 }]);
    expect(d.variance).toBe(0);
    for (const face of [d.faces.top, d.faces.side, d.faces.bottom]) {
      expect(face).not.toBeNull();
      expect(face!.width).toBe(16);
      expect(everyPixel(face!, RED)).toBe(true);
    }
    expect(modBlockAppearanceSchema.parse(appearanceRecord(d))).toBeTruthy();
  });

  it("gives a two-colour checkerboard two half shares and high variance", () => {
    const d = modBlock("checker", cubeAll("test:block/checker"), {
      "test:block/checker": image(16, 16, (x, y) =>
        (x + y) % 2 === 0 ? BLACK : WHITE,
      ),
    })!;
    expect(d.dominant).toHaveLength(2);
    expect(d.dominant.map((c) => c.hex).sort()).toEqual(["#000000", "#ffffff"]);
    for (const c of d.dominant) expect(c.share).toBeCloseTo(0.5, 2);
    expect(d.variance).toBeGreaterThan(0.8);
  });

  it("caps dominant colours at three and their shares sum to ~1", () => {
    const colours: Rgba[] = [RED, BLUE, BLACK, WHITE, [0, 255, 0, 255]];
    const d = modBlock("stripes", cubeAll("test:block/stripes"), {
      "test:block/stripes": image(20, 20, (x) => colours[x % 5]),
    })!;
    expect(d.dominant.length).toBeLessThanOrEqual(3);
    const sum = d.dominant.reduce((n, c) => n + c.share, 0);
    expect(sum).toBeCloseTo(1, 2);
    expect(d.variance).toBeGreaterThan(0);
    expect(d.variance).toBeLessThanOrEqual(1);
  });

  it("gives a column block different top and side swatches", () => {
    const d = modBlock(
      "pillar",
      {
        parent: "minecraft:block/cube_column",
        textures: { end: "test:block/end", side: "test:block/side" },
      },
      { "test:block/end": solid(RED), "test:block/side": solid(BLUE) },
    )!;
    expect(everyPixel(d.faces.top!, RED)).toBe(true);
    expect(everyPixel(d.faces.bottom!, RED)).toBe(true);
    expect(everyPixel(d.faces.side!, BLUE)).toBe(true);
    // Four sides against two ends.
    expect(d.dominant[0].hex).toBe("#0000ff");
    expect(d.dominant[0].share).toBeCloseTo(2 / 3, 2);
  });

  it("uses the first frame of an animated texture", () => {
    const d = modBlock(
      "lava",
      cubeAll("test:block/lava"),
      { "test:block/lava": image(16, 32, (_, y) => (y < 16 ? RED : BLUE)) },
      { "test:block/lava": { animation: { frametime: 2 } } },
    )!;
    expect(everyPixel(d.faces.side!, RED)).toBe(true);
    expect(d.dominant).toEqual([{ hex: "#ff0000", share: 1 }]);
  });

  it("scales textures that aren't 16×16 and keeps transparent pixels", () => {
    const big = modBlock("big", cubeAll("test:block/big"), {
      "test:block/big": image(32, 32, (x) => (x < 16 ? RED : [0, 0, 0, 0])),
    })!;
    const side = big.faces.side!;
    expect([side.width, side.height]).toEqual([16, 16]);
    expect(pixelAt(side, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(side, 15, 15)).toEqual([0, 0, 0, 0]);
    // Transparent pixels don't count towards the colours.
    expect(big.dominant).toEqual([{ hex: "#ff0000", share: 1 }]);

    const small = modBlock("small", cubeAll("test:block/small"), {
      "test:block/small": image(8, 8, (x) => (x < 4 ? RED : BLUE)),
    })!;
    expect(pixelAt(small.faces.top!, 7, 3)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(small.faces.top!, 8, 3)).toEqual([0, 0, 255, 255]);
  });

  it("tints faces with a tintindex", () => {
    const d = modBlock(
      "grass",
      {
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: { up: { texture: "#top", tintindex: 0 } },
          },
        ],
        textures: { top: "test:block/white" },
      },
      { "test:block/white": solid(WHITE) },
    )!;
    // test:grass is tinted with the grass colour.
    expect(d.hex).toBe("#91bd59");
    expect(pixelAt(d.faces.top!, 0, 0)).toEqual([0x91, 0xbd, 0x59, 255]);
    expect(d.faces.side).toBeNull();
  });

  it("prefers an unrotated variant when there are no defaults", () => {
    const sources: DescriptorSources = {
      getModel: (id) =>
        id === "test:block/log"
          ? {
              parent: "minecraft:block/cube_column",
              textures: { end: "test:block/end", side: "test:block/side" },
            }
          : vanillaModelsOnly.getModel(id),
      getTexture: (id) =>
        id === "test:block/end"
          ? { image: solid(RED), region: [0, 0, 16, 16] }
          : { image: solid(BLUE), region: [0, 0, 16, 16] },
    };
    const blockstate = {
      variants: {
        "axis=x": { model: "test:block/log", x: 90, y: 90 },
        "axis=y": { model: "test:block/log" },
        "axis=z": { model: "test:block/log", x: 90 },
      },
    };
    const d = describeBlockAppearance("test:log", blockstate, sources)!;
    expect(everyPixel(d.faces.top!, RED)).toBe(true);
    // With defaults pointing at a lying log, its side faces up.
    const lying = describeBlockAppearance("test:log", blockstate, sources, {
      axis: "z",
    })!;
    expect(everyPixel(lying.faces.top!, BLUE)).toBe(true);
    expect(everyPixel(lying.faces.bottom!, BLUE)).toBe(true);
  });

  it("returns undefined when nothing resolves", () => {
    expect(
      modBlock("missing", cubeAll("test:block/missing"), {}),
    ).toBeUndefined();
  });
});

describe("packSwatches", () => {
  it("returns null without swatches", () => {
    expect(packSwatches([{ id: "test:a", faces: { top: null } }])).toBeNull();
  });

  it("lays swatches into one PNG and shares identical ones", () => {
    const sheet = packSwatches([
      { id: "test:a", faces: { top: solid(RED), side: solid(RED) } },
      { id: "test:b", faces: { side: solid(BLUE), bottom: null } },
    ])!;
    expect(sheet.uvs).toEqual({
      "test:a": { top: [0, 0, 16, 16], side: [0, 0, 16, 16] },
      "test:b": { side: [16, 0, 16, 16] },
    });
    const decoded = decodePng(sheet.png)!;
    expect([decoded.width, decoded.height]).toEqual([32, 16]);
    expect([sheet.width, sheet.height]).toEqual([32, 16]);
    expect(pixelAt(decoded, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(decoded, 20, 15)).toEqual([0, 0, 255, 255]);
  });

  it("keeps a 2,000-block mod under 4 MB", () => {
    // Worst case: three different faces per block, each pure noise, which
    // PNG can't compress (real textures take a fraction of this).
    let seed = 1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed >> 15;
    };
    const noise = () =>
      image(16, 16, () => [
        random() & 0xff,
        random() & 0xff,
        random() & 0xff,
        255,
      ]);
    const blocks: SwatchBlock[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `test:block_${i}`,
      faces: { top: noise(), side: noise(), bottom: noise() },
    }));
    const sheet = packSwatches(blocks)!;
    expect(Object.keys(sheet.uvs)).toHaveLength(2000);
    expect(sheet.png.length).toBeLessThan(MAX_SWATCH_SHEET_BYTES);
    const decoded = decodePng(sheet.png)!;
    const [x, y] = sheet.uvs["test:block_1999"].bottom!;
    const got = pixelAt(decoded, x + 5, y + 7);
    const want = pixelAt(blocks[1999].faces.bottom!, 5, 7);
    got.forEach((v, c) => expect(Math.abs(v - want[c])).toBeLessThan(16));
  });

  it("keeps real textures exact", () => {
    const sheet = packSwatches([
      {
        id: "test:a",
        faces: { side: image(16, 16, (x, y) => [x * 16, y * 16, 7, 255]) },
      },
    ])!;
    expect(pixelAt(decodePng(sheet.png)!, 15, 3)).toEqual([240, 48, 7, 255]);
  });
});

describe("vanilla descriptors", () => {
  const blockstates = JSON.parse(
    readFileSync(path.join(ASSETS, "blockstates.json"), "utf8"),
  ) as Record<string, unknown>;
  const uvs = JSON.parse(
    readFileSync(path.join(ASSETS, "atlas-uvs.json"), "utf8"),
  ) as Record<string, unknown>;
  const atlas = decodePng(readFileSync(path.join(ASSETS, "atlas.png")))!;
  const pick = (paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, blockstates[p]]));
  const bundle = {
    blockstates: pick(["stone", "oak_log", "glass", "lava"]),
    models: vanillaModels,
    atlas,
    uvs,
  };

  it("describes vanilla blocks from the bundle", () => {
    const out = describeVanillaBlocks(bundle, { oak_log: { axis: "y" } });
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(["minecraft:stone", "minecraft:oak_log"]),
    );
    const stone = out["minecraft:stone"];
    expect(stone.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(stone.variance).toBeLessThan(0.3);
    const log = out["minecraft:oak_log"];
    expect(log.faces.top!.data).not.toEqual(log.faces.side!.data);
    // Glass keeps its transparent pixels.
    const glass = out["minecraft:glass"].faces.side!;
    expect(glass.data.some((_, i) => i % 4 === 3 && glass.data[i] === 0)).toBe(
      true,
    );
  });

  it("gives a mod block with a vanilla texture the vanilla descriptor", () => {
    const vanilla = vanillaDescriptorSources(bundle);
    const mod = describeModBlocks(
      {
        blockIds: ["test:stone"],
        blockstates: {
          "test:stone": { variants: { "": { model: "test:block/stone" } } },
        },
        models: { "test:block/stone": cubeAll("minecraft:block/stone") },
        textures: {},
        textureMeta: {},
      },
      vanilla,
    )["test:stone"];
    const stone = describeVanillaBlocks(bundle)["minecraft:stone"];
    expect(mod).toEqual(stone);
  });
});
