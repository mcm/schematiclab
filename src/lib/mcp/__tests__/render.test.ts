import { readFileSync } from "node:fs";
import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { parseSchematic, type ParsedSchematicProjection } from "../../convert";
import { decodePng, type RgbaImage } from "../../render/block-appearance";
import {
  fallbackBlockColor,
  oklabToHex,
  shadeHex,
} from "../../render/static-views";
import {
  MAX_RENDER_EDGE,
  MAX_RENDER_FACE_CELLS,
  renderProjectionPng,
  vanillaBlockColors,
} from "../render";

const FIXTURES = path.join(__dirname, "../../__tests__/fixtures");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// `COLORS.page` in `render/contact-sheet.ts`.
const PAGE = [0xee, 0xf0, 0xf4];

function parseFixture(name: string): ParsedSchematicProjection {
  const result = parseSchematic(
    new Uint8Array(readFileSync(path.join(FIXTURES, name))),
  );
  if (!result.ok) throw new Error(result.error);
  return result.schematic;
}

function decode(png: Uint8Array): RgbaImage {
  const image = decodePng(png);
  if (image === null) throw new Error("not a readable PNG");
  return image;
}

function pixel(image: RgbaImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

function distinctColors(image: RgbaImage): Set<number> {
  const colors = new Set<number>();
  for (let i = 0; i < image.data.length; i += 4) {
    colors.add(
      (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2],
    );
  }
  return colors;
}

function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

function singleBlock(blockId: string): ParsedSchematicProjection {
  return {
    name: "one block",
    inputFormat: "Sponge[v2]",
    minecraftVersion: {
      platform: "java",
      versionNumber: [1, 21, 4],
      dataVersion: 4189,
    },
    totalBlocks: 1,
    palette: [{ blockState: blockId, blockId, properties: {}, count: 1 }],
    regions: [
      {
        origin: [0, 0, 0],
        size: [1, 1, 1],
        blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
        blockEntities: [],
      },
    ],
  };
}

describe("renderProjectionPng", () => {
  // The largest fixture: a 1.12 Building Gadgets template.
  const fixture = parseFixture("example_bg0_schematic.txt");

  it("renders a fixture as a PNG no larger than the edge limit", () => {
    const { png, width, height } = renderProjectionPng(fixture);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    // IHDR width and height.
    expect(view.getUint32(16)).toBe(width);
    expect(view.getUint32(20)).toBe(height);
    expect(Math.max(width, height)).toBe(MAX_RENDER_EDGE);
    expect(Math.min(width, height)).toBeGreaterThan(0);

    const image = decode(png);
    expect([image.width, image.height]).toEqual([width, height]);
    expect(distinctColors(image).size).toBeGreaterThan(1);
  });

  it("draws the header text with the bundled font", () => {
    const { png, width, height } = renderProjectionPng(fixture, {
      name: "Header check",
    });
    expect(GlobalFonts.has("Geist")).toBe(true);
    const image = decode(png);
    const scale = Math.max(width, height) / MAX_RENDER_EDGE;
    // The header band: below the top margin, above the first panel.
    let ink = 0;
    for (let y = Math.ceil(10 * scale); y < Math.floor(42 * scale); y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = pixel(image, x, y);
        if (r !== PAGE[0] || g !== PAGE[1] || b !== PAGE[2]) ink++;
      }
    }
    expect(ink).toBeGreaterThan(100);
  });

  it("colours blocks from block-colors.json", () => {
    const stone = vanillaBlockColors()["minecraft:stone"];
    expect(stone).toBeDefined();
    const image = decode(
      renderProjectionPng(singleBlock("minecraft:stone")).png,
    );
    expect(distinctColors(image)).toContain(hexToInt(oklabToHex(stone.oklab)));
  });

  it("uses fallbackBlockColor for blocks without colour data", () => {
    const id = "minecraft:not_a_real_block";
    expect(vanillaBlockColors()[id]).toBeUndefined();
    const { png, width, height } = renderProjectionPng(singleBlock(id));
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_RENDER_EDGE);
    expect(distinctColors(decode(png))).toContain(
      hexToInt(fallbackBlockColor(id)),
    );
  });

  it("draws blocks as their sub-block shapes", () => {
    const slab = (type: string): ParsedSchematicProjection => {
      const projection = singleBlock("minecraft:oak_slab");
      projection.palette[0].properties = { type };
      return projection;
    };
    // Same block, same colour: only the shape differs. Count the pixels of
    // the iso views' shaded east faces: half as tall on a slab, though the
    // views scale the smaller slab up to fill their panels.
    const colored = (type: string) => {
      const image = decode(renderProjectionPng(slab(type)).png);
      const block = hexToInt(
        shadeHex(
          oklabToHex(vanillaBlockColors()["minecraft:oak_slab"].oklab),
          0.62,
        ),
      );
      let count = 0;
      for (let i = 0; i < image.data.length; i += 4) {
        const c =
          (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
        if (c === block) count++;
      }
      return count;
    };
    const half = colored("bottom");
    const full = colored("double");
    expect(half).toBeGreaterThan(0);
    expect(half / full).toBeLessThan(0.9);
  });

  it("rejects a few blocks spread too far apart to render", () => {
    const far = singleBlock("minecraft:stone");
    far.totalBlocks = 2;
    far.palette[0].count = 2;
    far.regions.push({
      origin: [30_000_000, 0, 30_000_000],
      size: [1, 1, 1],
      blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
      blockEntities: [],
    });
    expect(() => renderProjectionPng(far)).toThrow(/too far apart to render/);
  });

  it("renders a span at the face limit", () => {
    const side = Math.sqrt(MAX_RENDER_FACE_CELLS);
    const wide = singleBlock("minecraft:stone");
    wide.totalBlocks = 2;
    wide.palette[0].count = 2;
    wide.regions.push({
      origin: [side - 1, 0, side - 1],
      size: [1, 1, 1],
      blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
      blockEntities: [],
    });
    expect(renderProjectionPng(wide).png.length).toBeGreaterThan(0);
  });
});
