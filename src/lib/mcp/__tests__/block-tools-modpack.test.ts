import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import { modpackDataPath, modpackIndexPath } from "../../modpacks/paths";
import { clearModpackCache, encodeModpackData } from "../../modpacks/reader";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndex,
} from "../../modpacks/schema";
import { srgbToOklab } from "../../render/block-appearance";
import {
  oklabToHex,
  searchBlockIds,
  searchBlocksTool,
  suggestPaletteTool,
} from "../block-tools";
import { runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-06T12:00:00.000Z");

const BLOCKS_URL =
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json";
// Every 1.21.4 block without properties plus every stone, oak, log, glass,
// andesite and deepslate block.
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

const STAIRS_PROPERTIES = {
  facing: ["north", "south", "west", "east"],
  half: ["top", "bottom"],
  shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
  waterlogged: ["true", "false"],
};

function appearance(r: number, g: number, b: number, variance = 0.1) {
  const oklab = srgbToOklab(r, g, b);
  const hex = oklabToHex(oklab);
  return { hex, oklab, dominant: [{ hex, share: 1 }], variance };
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

// A grey next to stone (#7d7d7d), unlike any vanilla block's exact colour.
const CUT_ANDESITE = appearance(124, 126, 125, 0.05);

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
    block("create:andesite_casing", { appearance: appearance(150, 140, 120) }),
    block("create:brass_block", { appearance: appearance(200, 160, 70) }),
    block("create:brass_casing", { appearance: appearance(180, 130, 60) }),
    block("create:copycat_step", {
      properties: {
        facing: ["north", "south", "west", "east"],
        half: ["top", "bottom"],
      },
      kind: "unknown",
      fullCube: false,
      appearance: CUT_ANDESITE,
      camo: { slots: 1 },
    }),
    block("create:cut_andesite", { appearance: CUT_ANDESITE }),
    block("create:cut_andesite_stairs", {
      properties: STAIRS_PROPERTIES,
      defaults: {
        facing: "north",
        half: "bottom",
        shape: "straight",
        waterlogged: "false",
      },
      kind: "stairs",
      fullCube: false,
      appearance: appearance(124, 126, 125, 0.05),
    }),
    block("create:fluid_pipe", {
      kind: "unknown",
      fullCube: false,
      appearance: appearance(120, 122, 121),
    }),
    // No texture data.
    block("create:shaft", { kind: "unknown", fullCube: false }),
    // Only a block list names it: a bare full cube.
    block("create:bare_casing", { kind: "unknown" }),
    // Face swatches but no colour: it has visual information.
    block("create:swatch_only_casing", {
      swatch: {
        file: "cf-1",
        faces: { top: [0, 0, 16, 16], side: [0, 0, 16, 16] },
      },
    }),
  ],
  runtimeBlockSources: [
    {
      kind: "kubejs",
      name: "kubejs",
      message: "KubeJS startup scripts can register blocks.",
    },
  ],
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

function text(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

interface Look {
  id: string;
  kind: string;
  mod: string;
  shape_confidence: "high" | "low";
  full_cube: boolean;
  visual_info?: false;
  hex?: string;
  dominant?: { hex: string; share: number }[];
  variance?: number;
}

interface SearchData {
  version: string;
  modpack?: string;
  results: Look[];
  total_matches: number;
  did_you_mean?: string[];
  note?: string;
}

interface PaletteData {
  version: string;
  modpack?: string;
  target: { hex: string; reference_block?: string };
  blocks: (Look & { hex: string; distance: number })[];
}

async function search(args: Record<string, unknown>): Promise<SearchData> {
  const result = await runTool(searchBlocksTool, args, makeDeps());
  if (result.isError) throw new Error(text(result));
  return result.structuredContent as unknown as SearchData;
}

async function palette(args: Record<string, unknown>): Promise<PaletteData> {
  const result = await runTool(suggestPaletteTool, args, makeDeps());
  if (result.isError) throw new Error(text(result));
  return result.structuredContent as unknown as PaletteData;
}

const PACK_IDS = new Set(PACK.blocks.map((b) => b.id));
const VANILLA_IDS = new Set(
  Object.keys(JSON.parse(BLOCKS_JSON) as object).map((id) => `minecraft:${id}`),
);
const inPack = (id: string) => PACK_IDS.has(id) || VANILLA_IDS.has(id);

describe("searchBlockIds across namespaces", () => {
  const ids = [
    "minecraft:andesite",
    "create:cut_andesite",
    "create:andesite_casing",
    "othermod:andesite",
  ];

  it("searches every namespace with anyNamespace, vanilla first on a tie", () => {
    expect(searchBlockIds(ids, "andesite", { anyNamespace: true })).toEqual([
      "minecraft:andesite",
      "othermod:andesite",
      "create:andesite_casing",
      "create:cut_andesite",
    ]);
    expect(searchBlockIds(ids, "andesite")).toEqual(["minecraft:andesite"]);
  });

  it("keeps to a namespace given in the query", () => {
    const any = { anyNamespace: true };
    expect(searchBlockIds(ids, "create:andesite", any)).toEqual([
      "create:andesite_casing",
      "create:cut_andesite",
    ]);
    expect(searchBlockIds(ids, "minecraft:andesite", any)).toEqual([
      "minecraft:andesite",
    ]);
    expect(searchBlockIds(ids, "create:", any)).toEqual([
      "create:cut_andesite",
      "create:andesite_casing",
    ]);
    expect(searchBlockIds(ids, "create:andesite")).toEqual([]);
    expect(searchBlockIds(ids, "create:")).toEqual([]);
    expect(searchBlockIds(ids, ":", any)).toEqual([]);
  });
});

describe("search_blocks with a modpack", () => {
  it("finds vanilla and mod blocks by name, with mod, colours and shape confidence", async () => {
    const data = await search({ query: "andesite", modpack: "test-pack" });
    expect(data.version).toBe("1.21.4");
    expect(data.modpack).toBe("test-pack");
    const ids = data.results.map((r) => r.id);
    expect(ids[0]).toBe("minecraft:andesite");
    expect(ids).toEqual(
      expect.arrayContaining([
        "minecraft:andesite_stairs",
        "create:cut_andesite",
        "create:cut_andesite_stairs",
        "create:andesite_casing",
      ]),
    );
    for (const id of ids) expect(inPack(id)).toBe(true);

    const cut = data.results.find((r) => r.id === "create:cut_andesite")!;
    expect(cut).toEqual({
      id: "create:cut_andesite",
      kind: "block",
      mod: "Create",
      shape_confidence: "high",
      full_cube: true,
      hex: CUT_ANDESITE.hex,
      dominant: CUT_ANDESITE.dominant,
      variance: 0.05,
    });
    const andesite = data.results.find((r) => r.id === "minecraft:andesite")!;
    expect(andesite).toMatchObject({
      kind: "block",
      mod: "minecraft",
      shape_confidence: "high",
      full_cube: true,
    });
    expect(andesite.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(andesite.dominant!.length).toBeGreaterThan(0);
    expect(andesite.variance).toBeGreaterThan(0);
    expect(data.note).toMatch(/registers blocks at runtime.*kubejs/);
  });

  it("marks unclear mod shapes low confidence and leaves out unknown colours", async () => {
    const data = await search({ query: "create:", modpack: "test-pack" });
    expect(data.total_matches).toBe(PACK.blocks.length);
    const shaft = data.results.find((r) => r.id === "create:shaft")!;
    expect(shaft).toEqual({
      id: "create:shaft",
      kind: "unknown",
      mod: "Create",
      shape_confidence: "low",
      full_cube: false,
      visual_info: false,
    });
  });

  it("says visual_info: false only for mod blocks with no appearance and no swatch", async () => {
    const data = await search({ query: "casing", modpack: "test-pack" });
    const byId = new Map(data.results.map((r) => [r.id, r]));
    expect(byId.get("create:bare_casing")).toEqual({
      id: "create:bare_casing",
      kind: "unknown",
      mod: "Create",
      shape_confidence: "low",
      full_cube: true,
      visual_info: false,
    });
    expect(byId.get("create:swatch_only_casing")).not.toHaveProperty(
      "visual_info",
    );
    expect(byId.get("create:andesite_casing")).not.toHaveProperty(
      "visual_info",
    );
    expect(byId.get("create:andesite_casing")!.hex).toBeDefined();
    expect(data.note).toContain(
      "Blocks with visual_info: false have no visual information",
    );

    const coloured = await search({ query: "brass", modpack: "test-pack" });
    for (const r of coloured.results)
      expect(r).not.toHaveProperty("visual_info");
    expect(coloured.note ?? "").not.toContain("visual_info");
    const vanilla = await search({ query: "stone", version: "1.21.4" });
    for (const r of vanilla.results)
      expect(r).not.toHaveProperty("visual_info");
  });

  it('returns only stairs for shape: ["stairs"]', async () => {
    const data = await search({
      query: "andesite",
      modpack: "test-pack",
      shape: ["stairs"],
    });
    expect(data.results.map((r) => r.id).sort()).toEqual([
      "create:cut_andesite_stairs",
      "minecraft:andesite_stairs",
      "minecraft:polished_andesite_stairs",
    ]);
    expect(data.results.every((r) => r.kind === "stairs")).toBe(true);
    expect(data.total_matches).toBe(3);
  });

  it("filters by full_cube and several shapes", async () => {
    const data = await search({
      query: "andesite",
      modpack: "test-pack",
      shape: ["full_cube", "slab"],
    });
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.full_cube || r.kind === "slab").toBe(true);
    }
    expect(data.results.map((r) => r.id)).toContain("create:cut_andesite");
    expect(data.results.map((r) => r.id)).toContain("minecraft:andesite_slab");
  });

  it("says when the name matches but no block has the shape", async () => {
    const data = await search({
      query: "brass",
      modpack: "test-pack",
      shape: ["stairs"],
    });
    expect(data.results).toEqual([]);
    expect(data.did_you_mean).toBeUndefined();
    expect(data.note).toMatch(/2 blocks match the name, but none has shape/);
  });

  it("has no result for an id the pack lacks, and suggests pack blocks", async () => {
    const data = await search({
      query: "create:brass_stairs",
      modpack: "test-pack",
    });
    expect(data.results).toEqual([]);
    expect(data.total_matches).toBe(0);
    expect(data.did_you_mean!.length).toBeGreaterThan(0);
    for (const id of data.did_you_mean!) expect(inPack(id)).toBe(true);
    expect(data.did_you_mean).toContain("create:brass_casing");
  });

  it("checks version against the pack and needs a version or a modpack", async () => {
    const same = await search({
      query: "andesite",
      version: "1.21.4",
      modpack: "test-pack",
    });
    expect(same.results.length).toBeGreaterThan(0);
    const wrong = await runTool(
      searchBlocksTool,
      { query: "andesite", version: "1.20.1", modpack: "test-pack" },
      makeDeps(),
    );
    expect(text(wrong)).toBe(
      "Modpack 'test-pack' is Minecraft 1.21.4; leave version out or pass 1.21.4.",
    );
    const neither = await runTool(
      searchBlocksTool,
      { query: "andesite" },
      makeDeps(),
    );
    expect(text(neither)).toBe("Give a version (or a modpack).");
  });

  it("adds the new fields to vanilla results without a modpack", async () => {
    const data = await search({ query: "andesite", version: "1.21.4" });
    expect(data.modpack).toBeUndefined();
    expect(data.results.every((r) => r.mod === "minecraft")).toBe(true);
    expect(data.results.map((r) => r.id)).not.toContain("create:cut_andesite");
    const stairs = await search({
      query: "andesite",
      version: "1.21.4",
      shape: ["stairs"],
    });
    expect(stairs.results.map((r) => r.id)).toEqual([
      "minecraft:andesite_stairs",
      "minecraft:polished_andesite_stairs",
    ]);
  });
});

describe("suggest_palette with a modpack", () => {
  it("ranks mod blocks with vanilla blocks by colour", async () => {
    const data = await palette({
      color: CUT_ANDESITE.hex,
      modpack: "test-pack",
      n: 6,
    });
    expect(data.modpack).toBe("test-pack");
    expect(data.blocks[0]).toEqual({
      id: "create:cut_andesite",
      kind: "block",
      mod: "Create",
      shape_confidence: "high",
      hex: CUT_ANDESITE.hex,
      distance: 0,
      full_cube: true,
      dominant: CUT_ANDESITE.dominant,
      variance: 0.05,
    });
    const ids = data.blocks.map((b) => b.id);
    expect(ids).toContain("minecraft:stone");
    // Camo blocks look like their camo, not their frame.
    expect(ids).not.toContain("create:copycat_step");
    for (const id of ids) expect(inPack(id)).toBe(true);
    const stone = data.blocks.find((b) => b.id === "minecraft:stone")!;
    expect(stone.mod).toBe("minecraft");
    expect(stone.dominant!.length).toBeGreaterThan(0);
    expect(stone.variance).toBeGreaterThan(0);

    const vanilla = await palette({
      color: CUT_ANDESITE.hex,
      version: "1.21.4",
      n: 6,
    });
    expect(vanilla.blocks.map((b) => b.id)).not.toContain(
      "create:cut_andesite",
    );
  });

  it("filters by shape, with full_cube_only as an alias of full_cube", async () => {
    const stairs = await palette({
      color: CUT_ANDESITE.hex,
      modpack: "test-pack",
      shape: ["stairs"],
      n: 4,
    });
    expect(stairs.blocks.every((b) => b.kind === "stairs")).toBe(true);
    expect(stairs.blocks[0].id).toBe("create:cut_andesite_stairs");

    const viaShape = await palette({
      color: "#7a7a7a",
      modpack: "test-pack",
      shape: ["full_cube"],
      n: 10,
    });
    const viaAlias = await palette({
      color: "#7a7a7a",
      modpack: "test-pack",
      full_cube_only: true,
      n: 10,
    });
    expect(viaAlias).toEqual(viaShape);
    expect(viaShape.blocks.every((b) => b.full_cube)).toBe(true);
    // fluid_pipe is closer to #7a7a7a than cut_andesite but isn't a cube.
    expect(viaShape.blocks.map((b) => b.id)).not.toContain("create:fluid_pipe");

    const both = await runTool(
      suggestPaletteTool,
      {
        color: "#7a7a7a",
        modpack: "test-pack",
        full_cube_only: true,
        shape: ["stairs"],
      },
      makeDeps(),
    );
    expect(text(both)).toMatch(/^Give shape or full_cube_only, not both/);
  });

  it("takes a mod block as reference_block", async () => {
    const data = await palette({
      reference_block: "create:brass_block",
      modpack: "test-pack",
      n: 3,
    });
    expect(data.target.reference_block).toBe("create:brass_block");
    expect(data.target.hex).toBe(oklabToHex(appearance(200, 160, 70).oklab));
    expect(data.blocks.map((b) => b.id)).not.toContain("create:brass_block");

    const unknown = await runTool(
      suggestPaletteTool,
      { reference_block: "create:brass_stairs", modpack: "test-pack" },
      makeDeps(),
    );
    expect(text(unknown)).toMatch(
      /^Unknown block "create:brass_stairs" in modpack 'test-pack'/,
    );
    const noColour = await runTool(
      suggestPaletteTool,
      { reference_block: "create:shaft", modpack: "test-pack" },
      makeDeps(),
    );
    expect(text(noColour)).toMatch(
      /^create:shaft has no visual information \(visual_info: false\)/,
    );
  });

  it("never picks a block without visual information", async () => {
    for (const color of ["#000000", "#7a7a7a", "#ff00ff", "#ffffff"]) {
      for (const shape of [undefined, ["full_cube"]]) {
        const data = await palette({
          color,
          modpack: "test-pack",
          n: 16,
          ...(shape && { shape }),
        });
        const ids = data.blocks.map((b) => b.id);
        expect(ids).not.toContain("create:bare_casing");
        expect(ids).not.toContain("create:shaft");
        for (const b of data.blocks)
          expect(b).not.toHaveProperty("visual_info");
      }
    }
  });
});
