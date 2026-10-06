import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import {
  modFileSwatchesPath,
  modpackDataPath,
  modpackIndexPath,
} from "../../modpacks/paths";
import { encodeRgbaPng } from "../../modpacks/png";
import { clearModpackCache, encodeModpackData } from "../../modpacks/reader";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndex,
} from "../../modpacks/schema";
import {
  decodePng,
  srgbToOklab,
  type RgbaImage,
} from "../../render/block-appearance";
import { oklabToHex } from "../block-tools";
import {
  blockSheetLayout,
  blockSheetScale,
  isoCellPoint,
  type Rect,
  type Vec3,
} from "../block-sheet";
import { MAX_RENDER_EDGE } from "../render";
import {
  MAX_SHOW_BLOCKS,
  clearSwatchSheetCache,
  showBlocksTool,
} from "../show-blocks";
import { runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-06T12:00:00.000Z");

// 1.21.4 blocks stand in for every version's block list.
const BLOCKS_JSON = readFileSync(
  path.join(__dirname, "fixtures", "palette-mcmeta-1.21.4-blocks.json"),
  "utf8",
);
const fetchStub = vi.fn(async (input: RequestInfo | URL) =>
  /misode\/mcmeta@[^/]+-summary\/blocks\/data\.min\.json$/.test(String(input))
    ? new Response(BLOCKS_JSON, { status: 200 })
    : new Response("not found", { status: 404 }),
);

const VERSION = {
  key: "cf-11",
  packFileId: 11,
  displayVersion: "1.0",
  minecraftVersion: "1.21.1",
  loader: "neoforge" as const,
  modCount: 3,
  uploadedAt: "2026-10-01T00:00:00.000Z",
};

const INDEX: ModpackIndex = {
  formatVersion: MODPACK_FORMAT_VERSION,
  packs: [
    {
      slug: "camo-pack",
      name: "Camo Pack",
      curseForgeProjectId: null,
      versions: [VERSION],
    },
  ],
};

type Rgb = [number, number, number];
const BRASS: Rgb = [200, 160, 70];
const GREY: Rgb = [150, 150, 150];
const TEAL: Rgb = [30, 150, 170];

function appearance([r, g, b]: Rgb) {
  const oklab = srgbToOklab(r, g, b);
  const hex = oklabToHex(oklab);
  return { hex, oklab, dominant: [{ hex, share: 1 }], variance: 0 };
}

// A sheet of solid 16×16 swatches, left to right.
function sheet(colors: Rgb[]): Uint8Array {
  const width = 16 * colors.length;
  const data = new Uint8Array(width * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colors[Math.floor(x / 16)];
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return encodeRgbaPng(width, 16, data);
}

const swatch = (file: string, index: number) => {
  const rect: [number, number, number, number] = [index * 16, 0, 16, 16];
  return { file, faces: { top: rect, side: rect, bottom: rect } };
};

function block(
  id: string,
  mod: string,
  extra: Partial<ModpackBlock> = {},
): ModpackBlock {
  return {
    id,
    mod,
    displayName: id,
    properties: {},
    defaults: {},
    kind: "block",
    fullCube: true,
    ...extra,
  };
}

const mod = (key: string, name: string, namespace: string) => ({
  key,
  name,
  curseForgeProjectId: null,
  curseForgeFileId: null,
  fileName: `${namespace}.jar`,
  namespaces: [namespace],
  status: "ok" as const,
  hasSwatches: true,
});

const STAIRS_PROPERTIES = {
  facing: ["north", "south", "west", "east"],
  half: ["top", "bottom"],
  shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
  waterlogged: ["true", "false"],
};
const STAIRS_DEFAULTS = {
  facing: "north",
  half: "bottom",
  shape: "straight",
  waterlogged: "false",
};

const PACK: ModpackData = {
  formatVersion: MODPACK_FORMAT_VERSION,
  slug: "camo-pack",
  name: "Camo Pack",
  curseForgeProjectId: null,
  version: VERSION,
  mods: [
    mod("cf-1", "Create", "create"),
    mod("cf-2", "Copycats+", "copycats"),
    mod("cf-3", "Teal Blocks", "teal"),
  ],
  blocks: [
    block("copycats:copycat_block", "cf-2", {
      appearance: appearance(GREY),
      swatch: swatch("cf-2", 0),
      camo: { slots: 1 },
    }),
    block("copycats:copycat_stairs", "cf-2", {
      properties: STAIRS_PROPERTIES,
      defaults: STAIRS_DEFAULTS,
      kind: "unknown",
      fullCube: false,
      appearance: appearance(GREY),
      swatch: swatch("cf-2", 0),
      camo: { slots: 1 },
    }),
    block("create:brass_block", "cf-1", {
      appearance: appearance(BRASS),
      swatch: swatch("cf-1", 0),
    }),
    block("create:brass_stairs_like", "cf-1", {
      properties: STAIRS_PROPERTIES,
      defaults: STAIRS_DEFAULTS,
      kind: "stairs",
      fullCube: false,
      appearance: appearance(BRASS),
      swatch: swatch("cf-1", 0),
    }),
    // A colour but no swatch: drawn flat.
    block("create:no_swatch", "cf-1", { appearance: appearance(BRASS) }),
    block("teal:teal_block", "cf-3", {
      appearance: appearance(TEAL),
      swatch: swatch("cf-3", 0),
    }),
  ],
  runtimeBlockSources: [],
};

let blob: FakeBlob;
beforeEach(() => {
  clearModpackCache();
  clearBlockDataCache();
  clearSwatchSheetCache();
  fetchStub.mockClear();
  blob = createFakeBlob(() => NOW);
  const put = (pathname: string, body: Uint8Array) =>
    blob.objects.set(pathname, { body, uploadedAt: NOW });
  put(modpackIndexPath(), new TextEncoder().encode(JSON.stringify(INDEX)));
  put(modpackDataPath("camo-pack", VERSION.key), encodeModpackData(PACK));
  put(modFileSwatchesPath("cf-1"), sheet([BRASS]));
  put(modFileSwatchesPath("cf-2"), sheet([GREY]));
  put(modFileSwatchesPath("cf-3"), sheet([TEAL]));
});

function makeDeps(): McpDeps {
  return { fetch: fetchStub as never, now: () => NOW, blob };
}

interface Shown {
  version: string;
  modpack?: string;
  blocks: {
    id: string;
    mod: string;
    kind: string;
    hex?: string;
    dominant?: { hex: string; share: number }[];
    variance?: number;
    properties?: Record<string, string>;
    camo?: { id: string; mod: string; kind: string; hex?: string };
    writable?: boolean;
    reason?: string;
  }[];
  not_found: { id: string; did_you_mean: string[] }[];
  camo_material_rule?: string;
  note?: string;
}

async function show(args: Record<string, unknown>) {
  const result: CallToolResult = await runTool(
    showBlocksTool,
    args,
    makeDeps(),
  );
  if (result.isError) {
    throw new Error(JSON.stringify(result.content));
  }
  const image = result.content.find((c) => c.type === "image");
  if (image?.type !== "image") throw new Error("no image");
  expect(image.mimeType).toBe("image/png");
  const png = decodePng(Buffer.from(image.data, "base64"));
  if (!png) throw new Error("PNG didn't decode");
  return { png, data: result.structuredContent as unknown as Shown };
}

function pixel(image: RgbaImage, [x, y]: [number, number]): number[] {
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [...image.data.subarray(i, i + 4)];
}

// A layout point of the sheet of `count` blocks, in PNG pixels.
function at(count: number, [x, y]: [number, number]): [number, number] {
  const scale = blockSheetScale(blockSheetLayout(count));
  return [x * scale, y * scale];
}

const centre = (rect: Rect): [number, number] => [
  rect.x + rect.width / 2,
  rect.y + rect.height / 2,
];

function cell(count: number, card: number, index: number): Rect {
  return blockSheetLayout(count).cards[card].cells[index].rect;
}

function isoPixel(
  image: RgbaImage,
  count: number,
  card: number,
  p: Vec3,
  view: "front-left" | "back-right" = "front-left",
) {
  const index = view === "front-left" ? 0 : 1;
  return pixel(
    image,
    at(count, isoCellPoint(cell(count, card, index), view, p)),
  );
}

describe("show_blocks with a modpack", () => {
  it("draws a solid-colour mod block from its swatches", async () => {
    const { png, data } = await show({
      blocks: ["create:brass_block"],
      modpack: "camo-pack",
    });
    const layout = blockSheetLayout(1);
    expect(Math.max(png.width, png.height)).toBeLessThanOrEqual(
      MAX_RENDER_EDGE,
    );
    expect(png.width).toBe(Math.floor(layout.width * blockSheetScale(layout)));
    expect(png.height).toBe(
      Math.floor(layout.height * blockSheetScale(layout)),
    );
    // Flat top face (cell 2) and side face (cell 3).
    expect(pixel(png, at(1, centre(cell(1, 0, 2))))).toEqual([...BRASS, 255]);
    expect(pixel(png, at(1, centre(cell(1, 0, 3))))).toEqual([...BRASS, 255]);
    // The isometric views' top faces are unshaded; their sides are darker.
    expect(isoPixel(png, 1, 0, [0.5, 1, 0.5])).toEqual([...BRASS, 255]);
    expect(isoPixel(png, 1, 0, [0.5, 1, 0.5], "back-right")).toEqual([
      ...BRASS,
      255,
    ]);
    const side = isoPixel(png, 1, 0, [0.5, 0.5, 1]);
    expect(side[0]).toBeLessThan(BRASS[0]);

    expect(data).toMatchObject({
      version: "1.21.1",
      modpack: "camo-pack",
      not_found: [],
      blocks: [
        {
          id: "create:brass_block",
          mod: "Create",
          kind: "block",
          hex: appearance(BRASS).hex,
          dominant: [{ hex: appearance(BRASS).hex, share: 1 }],
          variance: 0,
        },
      ],
    });
  });

  it("reads only the requested blocks' swatch sheets, once per instance", async () => {
    await show({
      blocks: ["create:brass_block", "minecraft:stone"],
      modpack: "camo-pack",
    });
    const swatchReads = () =>
      blob.calls
        .filter((c) => c.method === "get")
        .map((c) => c.args[0])
        .filter((p) => String(p).startsWith("mod-files/"));
    expect(swatchReads()).toEqual([modFileSwatchesPath("cf-1")]);
    await show({ blocks: ["create:brass_block"], modpack: "camo-pack" });
    expect(swatchReads()).toEqual([modFileSwatchesPath("cf-1")]);
  });

  it("draws a confident kind's shape", async () => {
    const { png, data } = await show({
      blocks: ["create:brass_block", "create:brass_stairs_like"],
      modpack: "camo-pack",
    });
    expect(data.blocks.map((b) => b.kind)).toEqual(["block", "stairs"]);
    // Above a bottom stairs' lower step, south of its upper step (north):
    // the cube's top, but the stairs' riser, shaded.
    const point: Vec3 = [0.5, 1, 0.8];
    expect(isoPixel(png, 2, 0, point)).toEqual([...BRASS, 255]);
    expect(isoPixel(png, 2, 1, point)).not.toEqual([...BRASS, 255]);
  });

  it("lists ids the pack lacks under not_found and draws the rest", async () => {
    const { png, data } = await show({
      blocks: ["create:brass_blok", "minecraft:stone"],
      modpack: "camo-pack",
    });
    expect(data.not_found).toHaveLength(1);
    expect(data.not_found[0].id).toBe("create:brass_blok");
    expect(data.not_found[0].did_you_mean[0]).toBe("create:brass_block");
    expect(data.blocks.map((b) => b.id)).toEqual(["minecraft:stone"]);
    expect(data.note).toContain("create:brass_blok");
    // One card.
    const layout = blockSheetLayout(1);
    expect(png.height).toBe(
      Math.floor(layout.height * blockSheetScale(layout)),
    );
  });

  it("draws a block without swatches in its flat colour", async () => {
    const { png, data } = await show({
      blocks: ["create:no_swatch"],
      modpack: "camo-pack",
    });
    const [r, g, b] = pixel(png, at(1, centre(cell(1, 0, 2))));
    const hex = appearance(BRASS).hex;
    expect(
      `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
    ).toBe(hex);
    expect(data.note).toContain("No face swatches for create:no_swatch");
  });

  it("draws camo pairs as the frame's shape in the camo's swatches", async () => {
    const { png, data } = await show({
      blocks: [
        { frame: "copycats:copycat_block", camo: "create:brass_block" },
        { frame: "copycats:copycat_stairs", camo: "create:brass_block" },
        { frame: "copycats:copycat_stairs", camo: "create:brass_blok" },
      ],
      modpack: "camo-pack",
    });
    expect(data.not_found.map((n) => n.id)).toEqual(["create:brass_blok"]);
    expect(data.blocks).toMatchObject([
      {
        id: "copycats:copycat_block",
        kind: "block",
        camo: { id: "create:brass_block", mod: "Create" },
        writable: true,
      },
      {
        id: "copycats:copycat_stairs",
        kind: "stairs",
        camo: { id: "create:brass_block" },
        writable: true,
      },
    ]);
    expect(data.camo_material_rule).toBe("approximate");
    // Camo swatches, not the grey frame's.
    expect(pixel(png, at(2, centre(cell(2, 0, 2))))).toEqual([...BRASS, 255]);
    expect(pixel(png, at(2, centre(cell(2, 1, 2))))).toEqual([...BRASS, 255]);
    const point: Vec3 = [0.5, 1, 0.8];
    expect(isoPixel(png, 2, 0, point)).toEqual([...BRASS, 255]);
    expect(isoPixel(png, 2, 1, point)).not.toEqual([...BRASS, 255]);
  });

  it("rejects a frame that isn't camo-capable", async () => {
    const result = await runTool(
      showBlocksTool,
      {
        blocks: [{ frame: "create:brass_block", camo: "minecraft:stone" }],
        modpack: "camo-pack",
      },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
  });
});

describe("show_blocks with a version", () => {
  it("draws vanilla blocks from the bundle's swatches", async () => {
    const { png, data } = await show({
      blocks: [
        "minecraft:stone",
        "minecraft:oak_stairs[facing=east]",
        "minecraft:stone_brick",
      ],
      version: "1.21.4",
    });
    expect(Math.max(png.width, png.height)).toBeLessThanOrEqual(
      MAX_RENDER_EDGE,
    );
    expect(data.blocks).toMatchObject([
      { id: "minecraft:stone", mod: "minecraft", kind: "block" },
      {
        id: "minecraft:oak_stairs",
        properties: { facing: "east" },
        kind: "stairs",
      },
    ]);
    expect(data.blocks[0].hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(data.not_found).toEqual([
      expect.objectContaining({
        id: "minecraft:stone_brick",
        did_you_mean: expect.arrayContaining(["minecraft:stone_bricks"]),
      }),
    ]);
    // Stone is grey: its flat top's channels are close together.
    const [r, g, b] = pixel(png, at(2, centre(cell(2, 0, 2))));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(16);
  });

  it("returns an error for a known block with a bad state", async () => {
    const result = await runTool(
      showBlocksTool,
      { blocks: ["minecraft:oak_stairs[facing=up]"], version: "1.21.4" },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
  });

  it("fits 16 blocks under MAX_RENDER_EDGE and takes no more", async () => {
    const blocks = Array.from({ length: MAX_SHOW_BLOCKS }, () => "stone");
    const { png, data } = await show({ blocks, version: "1.21.4" });
    expect(data.blocks).toHaveLength(MAX_SHOW_BLOCKS);
    expect(Math.max(png.width, png.height)).toBeLessThanOrEqual(
      MAX_RENDER_EDGE,
    );
    expect(
      showBlocksTool.inputSchema.safeParse({
        blocks: [...blocks, "stone"],
        version: "1.21.4",
      }).success,
    ).toBe(false);
  });
});
