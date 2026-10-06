// Bare camo frames (no camo) take their look from their frame texture
// (SCHEM-149). Synthetic jars shaped like the real ones: frame blockstates
// point at a placeholder model (`minecraft:block/air`, or FramedBlocks'
// wrapper with only a `base_model`), FramedBlocks and Create ship their frame
// texture, and Copycats+ frames show Create's `copycat_base`.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearBlockDataCache } from "../../blockdata/load";
import { parseModJar } from "../../mods/parse-mod-jar";
import { clearSwatchSheetCache, showBlocksTool } from "../../mcp/show-blocks";
import { resolveToolBlocks } from "../../mcp/tool-blocks";
import { runTool } from "../../mcp/tools";
import type { McpDeps } from "../../mcp/types";
import { createFakeBlob, type FakeBlob } from "../../mcp/__tests__/fake-blob";
import { decodePng } from "../../render/block-appearance";
import { vanillaDescriptorSources } from "../appearance";
import { withCamoFrameLooks } from "../camo-frames";
import {
  extractModpack,
  type ModpackExtraction,
  type ModpackModSource,
} from "../extract";
import { encodeRgbaPng } from "../png";
import { publishModpack, type ModpackStore } from "../publish";
import { clearModpackCache, loadModpackIndex } from "../reader";
import type { ModpackBlock } from "../schema";

const ROOT = path.join(__dirname, "../../../..");
const NOW = new Date("2026-10-06T12:00:00.000Z");

const BLOCKS_JSON = readFileSync(
  path.join(
    ROOT,
    "src/lib/mcp/__tests__/fixtures/palette-mcmeta-1.21.4-blocks.json",
  ),
  "utf8",
);
const fetchStub = vi.fn(async (input: RequestInfo | URL) =>
  /misode\/mcmeta@[^/]+-summary\/blocks\/data\.min\.json$/.test(String(input))
    ? new Response(BLOCKS_JSON, { status: 200 })
    : new Response("not found", { status: 404 }),
);

type Rgb = [number, number, number];

const json = (value: unknown) => strToU8(JSON.stringify(value));

/** A 16×16 checkerboard of two colours: textured, unlike a flat colour. */
function checkerPng(a: Rgb, b: Rgb): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      data.set([...((x + y) % 2 === 0 ? a : b), 255], (y * 16 + x) * 4);
    }
  }
  return encodeRgbaPng(16, 16, data);
}

const COPYCAT_BASE: [Rgb, Rgb] = [
  [90, 95, 88],
  [173, 198, 169],
];
const FRAMED_BLOCK: [Rgb, Rgb] = [
  [133, 99, 57],
  [93, 71, 41],
];
const BRASS: [Rgb, Rgb] = [
  [200, 160, 70],
  [220, 180, 90],
];

const AIR = { variants: { "": { model: "minecraft:block/air" } } };

function createJar(): Uint8Array {
  return zipSync({
    "assets/create/textures/block/copycat_base.png": checkerPng(
      ...COPYCAT_BASE,
    ),
    "assets/create/textures/block/brass_block.png": checkerPng(...BRASS),
    "assets/create/models/block/copycat_base/block.json": json({
      parent: "block/cube_all",
      textures: { all: "create:block/copycat_base" },
    }),
    "assets/create/models/block/brass_block.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "create:block/brass_block" },
    }),
    "assets/create/blockstates/copycat_base.json": json({
      variants: { "": { model: "create:block/copycat_base/block" } },
    }),
    "assets/create/blockstates/brass_block.json": json({
      variants: { "": { model: "create:block/brass_block" } },
    }),
    "assets/create/blockstates/copycat_step.json": json(AIR),
    "assets/create/blockstates/copycat_panel.json": json(AIR),
  });
}

function copycatsJar(): Uint8Array {
  return zipSync({
    "assets/copycats/blockstates/copycat_stairs.json": json(AIR),
    "assets/copycats/blockstates/copycat_slab.json": json(AIR),
  });
}

/** No blockstate reaches `framed_block`: frames are wrappers of a base model. */
function framedJar(): Uint8Array {
  const wrapper = {
    "neoforge:definition_type": "framedblocks:wrapper",
    base_model: { model: "framedblocks:block/framed_cube" },
  };
  return zipSync({
    "assets/framedblocks/textures/block/framed_block.png": checkerPng(
      ...FRAMED_BLOCK,
    ),
    "assets/framedblocks/blockstates/framed_stairs.json": json(wrapper),
    "assets/framedblocks/blockstates/framed_slab.json": json(wrapper),
  });
}

// Vanilla models (`cube_all`) for the jars' parents; no vanilla textures.
const vanilla = vanillaDescriptorSources({
  models: JSON.parse(
    readFileSync(
      path.join(ROOT, "public/minecraft-assets/models.json"),
      "utf8",
    ),
  ) as Record<string, unknown>,
  atlas: { width: 1, height: 1, data: new Uint8Array(4) },
  uvs: {},
});

function mod(id: number, name: string, bytes: Uint8Array): ModpackModSource {
  return {
    name,
    fileName: `${name}.jar`,
    curseForgeProjectId: id,
    curseForgeFileId: id * 100,
    size: bytes.length,
    read: async () => bytes,
  };
}

async function extract(mods: ModpackModSource[]): Promise<ModpackExtraction> {
  return extractModpack(
    {
      name: "Frame Looks",
      displayVersion: "1.0",
      minecraftVersion: "1.21.1",
      loader: "neoforge",
      curseForgeProjectId: 9200,
      packFileId: 777,
      mods,
      hasKubeJs: false,
      warnings: [],
    },
    { vanilla, now: () => NOW },
  );
}

function fakeBlobStore(blob: FakeBlob): ModpackStore {
  return {
    description: "fake Blob",
    readIndex() {
      clearModpackCache();
      return loadModpackIndex(blob);
    },
    exists: async (pathname) => blob.objects.has(pathname),
    async write(pathname, body) {
      blob.objects.set(pathname, { body, uploadedAt: NOW });
    },
  };
}

// Copycats+ first: Create's texture isn't read yet when it's extracted.
const MODS = () => [
  mod(2, "copycats", copycatsJar()),
  mod(1, "create", createJar()),
  mod(3, "framedblocks", framedJar()),
];

let blob: FakeBlob;
let extraction: ModpackExtraction;

beforeEach(async () => {
  clearModpackCache();
  clearBlockDataCache();
  clearSwatchSheetCache();
  blob = createFakeBlob(() => NOW);
  extraction = await extract(MODS());
  await publishModpack(fakeBlobStore(blob), extraction);
  clearModpackCache();
});

function deps(): McpDeps {
  return { fetch: fetchStub as never, now: () => NOW, blob };
}

const REF = "frame-looks";

function stored(id: string): ModpackBlock {
  const block = extraction.data.blocks.find((b) => b.id === id);
  if (block === undefined) throw new Error(`no ${id}`);
  return block;
}

function hexOf([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

describe("parseModJar", () => {
  it("keeps the frame texture when no blockstate reaches it", () => {
    const parsed = parseModJar(framedJar());
    expect(Object.keys(parsed.textures)).toContain(
      "framedblocks:block/framed_block",
    );
  });
});

describe("upload", () => {
  it("describes bare frames from the frame texture their jar ships", () => {
    for (const [id, colours, key] of [
      ["framedblocks:framed_stairs", FRAMED_BLOCK, "cf-300"],
      ["framedblocks:framed_slab", FRAMED_BLOCK, "cf-300"],
      ["create:copycat_step", COPYCAT_BASE, "cf-100"],
      ["create:copycat_panel", COPYCAT_BASE, "cf-100"],
    ] as const) {
      const block = stored(id);
      expect(block.appearance, id).toBeDefined();
      expect(block.appearance!.dominant.map((d) => d.hex).sort(), id).toEqual(
        colours.map(hexOf).sort(),
      );
      expect(block.appearance!.variance, id).toBeGreaterThan(0.1);
      expect(block.swatch?.file, id).toBe(key);
      expect(Object.keys(block.swatch!.faces).sort(), id).toEqual([
        "bottom",
        "side",
        "top",
      ]);
    }
    // Their own models still win: brass and copycat_base aren't frames.
    expect(stored("create:brass_block").appearance?.dominant).toHaveLength(2);
    // Copycats+ ships no texture: nothing is stored for it.
    expect(stored("copycats:copycat_stairs").appearance).toBeUndefined();
    expect(stored("copycats:copycat_stairs").swatch).toBeUndefined();
  });
});

describe("withCamoFrameLooks", () => {
  it("gives Copycats+ frames copycat_base's look, keeping its swatch file", () => {
    const blocks = withCamoFrameLooks(extraction.data.blocks);
    const base = blocks.find((b) => b.id === "create:copycat_base")!;
    const stairs = blocks.find((b) => b.id === "copycats:copycat_stairs")!;
    expect(stairs.appearance).toEqual(base.appearance);
    expect(stairs.swatch).toEqual(base.swatch);
    expect(stairs.swatch?.file).toBe("cf-100");
    // Blocks that aren't frames, and frames with a look, are unchanged.
    for (const id of ["create:brass_block", "framedblocks:framed_stairs"]) {
      expect(blocks.find((b) => b.id === id)).toBe(stored(id));
    }
  });

  it("leaves frames bare when the pack lacks the texture's block", () => {
    const blocks = extraction.data.blocks.filter(
      (b) => b.id !== "create:copycat_base",
    );
    const stairs = withCamoFrameLooks(blocks).find(
      (b) => b.id === "copycats:copycat_stairs",
    )!;
    expect(stairs.appearance).toBeUndefined();
    expect(stairs.swatch).toBeUndefined();
  });

  it("applies when the pack is read", async () => {
    const blocks = await resolveToolBlocks({ modpack: REF }, deps());
    const stairs = blocks.modpack!.modBlock("copycats:copycat_stairs");
    expect(stairs?.swatch?.file).toBe("cf-100");
    expect(stairs?.appearance?.hex).toBe(
      stored("create:copycat_base").appearance?.hex,
    );
  });
});

function text(result: CallToolResult): string {
  const first = result.content.find((c) => c.type === "text");
  return first?.type === "text" ? first.text : "";
}

function imageOf(result: CallToolResult) {
  const image = result.content.find((c) => c.type === "image");
  if (image?.type !== "image") throw new Error("expected an image");
  const png = decodePng(new Uint8Array(Buffer.from(image.data, "base64")));
  if (png === null) throw new Error("undecodable PNG");
  return png;
}

function countPixels(
  image: { width: number; height: number; data: Uint8Array },
  [r, g, b]: Rgb,
): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (
      image.data[i] === r &&
      image.data[i + 1] === g &&
      image.data[i + 2] === b
    ) {
      count++;
    }
  }
  return count;
}

describe("show_blocks", () => {
  it("draws bare copycat and framed frames with textured faces", async () => {
    for (const [id, colours] of [
      ["copycats:copycat_stairs", COPYCAT_BASE],
      ["create:copycat_step", COPYCAT_BASE],
      ["framedblocks:framed_stairs", FRAMED_BLOCK],
    ] as const) {
      const result = await runTool(
        showBlocksTool,
        { blocks: [id], modpack: REF },
        deps(),
      );
      expect(result.isError, text(result)).toBeFalsy();
      const content = result.structuredContent as {
        blocks: { id: string; hex?: string }[];
        note?: string;
      };
      expect(content.note ?? "", id).not.toMatch(/No face swatches/);
      expect(content.blocks[0].hex, id).toBeDefined();
      // Both checker colours appear unshaded in the flat face panels; a
      // flat stand-in colour would show neither.
      const image = imageOf(result);
      for (const colour of colours) {
        expect(countPixels(image, colour), `${id} ${colour}`).toBeGreaterThan(
          100,
        );
      }
    }
  });
});
