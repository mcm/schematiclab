import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import { createBlockRegistry } from "../../blockdata/registry";
import { defaultCamoSlots } from "../../camo/extract";
import { writeCamoChoice } from "../../camo/write";
import {
  serializeSchematic,
  type ParsedSchematicProjection,
} from "../../convert";
import { modpackDataPath, modpackIndexPath } from "../../modpacks/paths";
import { clearModpackCache, encodeModpackData } from "../../modpacks/reader";
import { createModpackRegistry } from "../../modpacks/registry";
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
import { fallbackBlockColor, shadeHex } from "../../render/static-views";
import { compileBuildTool } from "../build-tools";
import { generateShapeTool } from "../generate-shape";
import {
  modpackRenderSource,
  renderProjectionPng,
  statesNotInModpack,
} from "../render";
import { renderSchematicTool } from "../schematic-tools";
import { runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const FIXTURES = path.join(__dirname, "../../__tests__/fixtures");

const BLOCKS_URL =
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json";
const BLOCKS_JSON = readFileSync(
  path.join(__dirname, "fixtures", "palette-mcmeta-1.21.4-blocks.json"),
  "utf8",
);

const fetchStub = vi.fn(async (input: RequestInfo | URL) =>
  String(input) === BLOCKS_URL
    ? new Response(BLOCKS_JSON, { status: 200 })
    : new Response("not found", { status: 404 }),
);

const VERSION = {
  key: "cf-5678901",
  packFileId: 5678901,
  displayVersion: "1.0",
  minecraftVersion: "1.21.4",
  loader: "neoforge" as const,
  modCount: 1,
  uploadedAt: "2026-10-01T00:00:00.000Z",
};

const INDEX: ModpackIndex = {
  formatVersion: MODPACK_FORMAT_VERSION,
  packs: [
    {
      slug: "test-pack",
      name: "Test Pack",
      curseForgeProjectId: null,
      versions: [VERSION],
    },
  ],
};

function appearance(r: number, g: number, b: number) {
  const oklab = srgbToOklab(r, g, b);
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return { hex, oklab, dominant: [{ hex, share: 1 }], variance: 0.1 };
}

function block(id: string, extra: Partial<ModpackBlock> = {}): ModpackBlock {
  return {
    id,
    mod: "cf-1",
    displayName: id,
    properties: {},
    defaults: {},
    kind: "block",
    fullCube: true,
    ...extra,
  };
}

const BRASS = appearance(201, 161, 71);
const PLATE = appearance(31, 151, 171);
const STEP = appearance(90, 90, 90);
const SLAB_PROPERTIES = {
  type: ["top", "bottom", "double"],
  waterlogged: ["true", "false"],
};

const PACK: ModpackData = {
  formatVersion: MODPACK_FORMAT_VERSION,
  slug: "test-pack",
  name: "Test Pack",
  curseForgeProjectId: null,
  version: VERSION,
  mods: [
    {
      key: "cf-1",
      name: "Create",
      curseForgeProjectId: 328085,
      curseForgeFileId: 1,
      fileName: "create.jar",
      namespaces: ["create"],
      status: "ok",
      hasSwatches: false,
    },
  ],
  blocks: [
    block("create:brass_block", { appearance: BRASS }),
    block("create:copycat_step", {
      properties: {
        facing: ["north", "south", "west", "east"],
        half: ["top", "bottom"],
      },
      kind: "unknown",
      fullCube: false,
      appearance: STEP,
      camo: { slots: 1 },
    }),
    // Named like nothing in `blockShape`, but confidently a slab.
    block("create:plate", {
      properties: SLAB_PROPERTIES,
      kind: "slab",
      fullCube: false,
      appearance: PLATE,
    }),
    // Same look, a full cube.
    block("create:plate_block", { appearance: PLATE }),
    // Named like a slab, but its kind is unclear: drawn as a full cube.
    block("create:odd_slab", {
      properties: SLAB_PROPERTIES,
      kind: "unknown",
      fullCube: false,
      appearance: PLATE,
    }),
  ],
  runtimeBlockSources: [],
};

let blob: FakeBlob;
beforeEach(() => {
  clearModpackCache();
  clearBlockDataCache();
  fetchStub.mockClear();
  blob = createFakeBlob(() => NOW);
  blob.objects.set(modpackIndexPath(), {
    body: new TextEncoder().encode(JSON.stringify(INDEX)),
    uploadedAt: NOW,
  });
  blob.objects.set(modpackDataPath("test-pack", VERSION.key), {
    body: encodeModpackData(PACK),
    uploadedAt: NOW,
  });
});

function makeDeps(): McpDeps {
  return { fetch: fetchStub as never, now: () => NOW, blob };
}

// The pack over a vanilla registry that only has stone.
function packBlocks() {
  const vanilla = createBlockRegistry(
    {
      sourceVersion: "1.21.4",
      translateOnExport: false,
      blocks: new Map([["minecraft:stone", { properties: {}, defaults: {} }]]),
    },
    "1.21.4",
  );
  return createModpackRegistry(vanilla, PACK, "test-pack");
}

function projectionOf(
  entries: { blockId: string; properties?: Record<string, string> }[],
): ParsedSchematicProjection {
  return {
    name: "modded",
    inputFormat: "Sponge[v2]",
    minecraftVersion: {
      platform: "java",
      versionNumber: [1, 21, 4],
      dataVersion: 4189,
    },
    totalBlocks: entries.length,
    palette: entries.map(({ blockId, properties = {} }) => {
      const props = Object.entries(properties);
      return {
        blockState:
          props.length === 0
            ? blockId
            : `${blockId}[${props.map(([k, v]) => `${k}=${v}`).join(",")}]`,
        blockId,
        properties,
        count: 1,
      };
    }),
    regions: [
      {
        origin: [0, 0, 0],
        size: [entries.length * 2, 1, 1],
        blocks: entries.map((_, i) => ({
          pos: [i * 2, 0, 0] as [number, number, number],
          paletteIndex: i,
        })),
        blockEntities: [],
      },
    ],
  };
}

function decode(png: Uint8Array): RgbaImage {
  const image = decodePng(png);
  if (image === null) throw new Error("not a readable PNG");
  return image;
}

function colorCounts(png: Uint8Array): Map<number, number> {
  const image = decode(png);
  const counts = new Map<number, number>();
  for (let i = 0; i < image.data.length; i += 4) {
    const c =
      (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return counts;
}

const hexToInt = (hex: string) => parseInt(hex.slice(1), 16);

function imageOf(result: CallToolResult): Uint8Array {
  const image = result.content.find((c) => c.type === "image");
  if (image?.type !== "image") throw new Error("expected an image");
  return new Uint8Array(Buffer.from(image.data, "base64"));
}

describe("renderProjectionPng with a modpack", () => {
  it("colours a mod block with its pack colour, not the hashed fallback", () => {
    const projection = projectionOf([{ blockId: "create:brass_block" }]);
    const appearance = modpackRenderSource(packBlocks());
    const colors = colorCounts(
      renderProjectionPng(projection, { appearance }).png,
    );
    expect(colors.has(hexToInt(BRASS.hex))).toBe(true);
    expect(colors.has(hexToInt(fallbackBlockColor("create:brass_block")))).toBe(
      false,
    );

    // Without the pack: the fallback.
    const plain = colorCounts(renderProjectionPng(projection).png);
    expect(plain.has(hexToInt(fallbackBlockColor("create:brass_block")))).toBe(
      true,
    );
    expect(plain.has(hexToInt(BRASS.hex))).toBe(false);
  });

  it("colours a camo block with its camo's pack colour", () => {
    const blockId = "create:copycat_step";
    const properties = { facing: "north", half: "bottom" };
    const [slot] = defaultCamoSlots(blockId, properties);
    expect(slot).toBeDefined();
    const nbt = writeCamoChoice(blockId, properties, undefined, {
      [slot]: { blockId: "create:brass_block", properties: {} },
    });
    expect(nbt).toBeDefined();
    const projection = projectionOf([{ blockId, properties }]);
    projection.regions[0].blockEntities.push({ pos: [0, 0, 0], nbt: nbt! });
    const colors = colorCounts(
      renderProjectionPng(projection, {
        appearance: modpackRenderSource(packBlocks()),
      }).png,
    );
    expect(colors.has(hexToInt(BRASS.hex))).toBe(true);
  });

  it("draws confident kinds as their shapes, and unclear ones as cubes", () => {
    const appearance = modpackRenderSource(packBlocks());
    // Pixels of the iso views' shaded east faces, as in render.test.ts.
    const east = hexToInt(shadeHex(PLATE.hex, 0.62));
    const count = (blockId: string) =>
      colorCounts(
        renderProjectionPng(
          projectionOf([
            { blockId, properties: { type: "bottom", waterlogged: "false" } },
          ]),
          { appearance },
        ).png,
      ).get(east) ?? 0;
    const slab = count("create:plate");
    const cube = count("create:plate_block");
    expect(slab).toBeGreaterThan(0);
    expect(slab / cube).toBeLessThan(0.9);
    expect(count("create:odd_slab")).toBe(cube);
  });

  it("draws a copycat step as a step", () => {
    const appearance = modpackRenderSource(packBlocks());
    const north = { facing: "north", half: "bottom" };
    expect(appearance.shape?.("create:copycat_step", north)).toEqual([
      [0, 0, 0, 1, 0.5, 0.5],
    ]);
    // Pixels of the iso views' shaded east faces, as above.
    const east = (properties: Record<string, string>) =>
      colorCounts(
        renderProjectionPng(
          projectionOf([{ blockId: "create:copycat_step", properties }]),
          { appearance },
        ).png,
      ).get(hexToInt(shadeHex(STEP.hex, 0.62))) ?? 0;
    // Without `half` it has no step shape: a full cube.
    const cube = east({ facing: "north" });
    expect(east(north)).toBeGreaterThan(0);
    expect(east(north)).toBeLessThan(cube);
  });

  it("lists the block states the pack lacks", () => {
    const projection = projectionOf([
      { blockId: "create:brass_block" },
      { blockId: "minecraft:stone" },
      { blockId: "create:not_a_block" },
      { blockId: "othermod:thing" },
    ]);
    expect(statesNotInModpack(projection, packBlocks())).toEqual([
      "create:not_a_block",
      "othermod:thing",
    ]);
  });
});

describe("render_schematic", () => {
  function schematicArgs(projection: ParsedSchematicProjection) {
    const serialized = serializeSchematic({
      schematic: projection,
      inputFilename: "modded.json",
      outputFormat: "Sponge[v2]",
      targetVersion: "1.21.4",
    });
    if (!serialized.ok) throw new Error(serialized.error);
    return {
      base64: Buffer.from(serialized.bytes).toString("base64"),
      filename: serialized.filename,
    };
  }

  it("is byte-identical to before without a modpack", async () => {
    const result = await runTool(
      renderSchematicTool,
      {
        base64: readFileSync(
          path.join(FIXTURES, "example_bg0_schematic.txt"),
        ).toString("base64"),
        filename: "example_bg0_schematic.txt",
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    // The sha256 of the PNG before modpack rendering existed.
    expect(createHash("sha256").update(imageOf(result)).digest("hex")).toBe(
      "05d0ca0ac5f982c598688d7e17e8241bc1dd8ccccada1bf5578d02e224d64ba0",
    );
  });

  it("uses the pack's colours and counts the states it lacks", async () => {
    const args = schematicArgs(
      projectionOf([
        { blockId: "create:brass_block" },
        { blockId: "minecraft:stone" },
        { blockId: "create:not_a_block" },
      ]),
    );
    const result = await runTool(
      renderSchematicTool,
      { ...args, modpack: "test-pack" },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(colorCounts(imageOf(result)).has(hexToInt(BRASS.hex))).toBe(true);
    const summary = result.content.find((c) => c.type === "text");
    expect(summary?.type === "text" && summary.text).toContain(
      "1 block state not in test-pack (create:not_a_block).",
    );

    const none = await runTool(
      renderSchematicTool,
      {
        ...schematicArgs(projectionOf([{ blockId: "create:brass_block" }])),
        modpack: "test-pack",
      },
      makeDeps(),
    );
    const text = none.content.find((c) => c.type === "text");
    expect(text?.type === "text" && text.text).toContain(
      "Every block state is in test-pack.",
    );
  });

  it("fails for an unknown modpack", async () => {
    const result = await runTool(
      renderSchematicTool,
      {
        ...schematicArgs(projectionOf([{ blockId: "minecraft:stone" }])),
        modpack: "no-such-pack",
      },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
  });
});

describe("build tools render with the modpack", () => {
  it("compile_build", async () => {
    const result = await runTool(
      compileBuildTool,
      {
        program: {
          name: "Brass cube",
          size: [2, 2, 2],
          // A bare name only one mod has is repaired to its mod id.
          palette: { body: "brass_block" },
          build: [{ box: { do: [{ fill: "@body" }] } }],
        },
        version: "1.21.4",
        modpack: "test-pack",
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    const colors = colorCounts(imageOf(result));
    expect(colors.has(hexToInt(BRASS.hex))).toBe(true);
    expect(colors.has(hexToInt(fallbackBlockColor("create:brass_block")))).toBe(
      false,
    );
  });

  it("generate_shape", async () => {
    const result = await runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 2,
        height: 2,
        depth: 2,
        material: "create:brass_block",
        version: "1.21.4",
        output_format: "Sponge[v2]",
        render: true,
        modpack: "test-pack",
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(colorCounts(imageOf(result)).has(hexToInt(BRASS.hex))).toBe(true);
  });

  it("generate_shape rejects a modpack of another version", async () => {
    const result = await runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 1,
        height: 1,
        depth: 1,
        material: "stone",
        version: "1.20.1",
        output_format: "Sponge[v2]",
        modpack: "test-pack",
      },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
    const first = result.content[0];
    expect(first?.type === "text" && first.text).toContain(
      "Modpack 'test-pack' is Minecraft 1.21.4",
    );
  });
});
