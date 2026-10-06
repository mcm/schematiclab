import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import { CAMO_BLOCK_IDS } from "../../camo/camo-blocks.generated";
import {
  CAMO_WRITE_VERSIONS,
  camoWriteReason,
  isCamoWritable,
} from "../../camo/write-versions";
import { modpackDataPath, modpackIndexPath } from "../../modpacks/paths";
import { clearModpackCache, encodeModpackData } from "../../modpacks/reader";
import { createModpackRegistry } from "../../modpacks/registry";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndex,
  type ModpackIndexVersion,
} from "../../modpacks/schema";
import { createBlockRegistry } from "../../blockdata/registry";
import { srgbToOklab } from "../../render/block-appearance";
import {
  oklabToHex,
  searchBlocksTool,
  splitShapeQuery,
  suggestPaletteTool,
} from "../block-tools";
import {
  CAMO_FRAME_IDS,
  isKnownBlockEntityBlock,
  modpackShapePack,
  serverShapePack,
  type CamoOption,
} from "../camo-options";
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

function version(
  key: string,
  minecraftVersion: string,
  fileId: number,
): ModpackIndexVersion {
  return {
    key,
    packFileId: fileId,
    displayVersion: key,
    minecraftVersion,
    loader: "neoforge",
    modCount: 2,
    uploadedAt: "2026-10-01T00:00:00.000Z",
  };
}

function appearance(r: number, g: number, b: number) {
  const oklab = srgbToOklab(r, g, b);
  const hex = oklabToHex(oklab);
  return { hex, oklab, dominant: [{ hex, share: 1 }], variance: 0.1 };
}

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

const MODS = [
  {
    key: "cf-1",
    name: "Create",
    curseForgeProjectId: 328085,
    curseForgeFileId: 1,
    fileName: "create.jar",
    namespaces: ["create"],
    status: "ok" as const,
    hasSwatches: false,
  },
  {
    key: "cf-2",
    name: "Copycats+",
    curseForgeProjectId: 968398,
    curseForgeFileId: 2,
    fileName: "copycats.jar",
    namespaces: ["copycats"],
    status: "ok" as const,
    hasSwatches: false,
  },
];

const BRASS = appearance(200, 160, 70);

const CREATE_BLOCKS = [
  block("create:brass_block", "cf-1", { appearance: BRASS }),
  block("create:brass_casing", "cf-1", {
    appearance: appearance(180, 130, 60),
  }),
  // Brass-coloured but not a full cube: never a camo material.
  block("create:brass_funnel", "cf-1", {
    kind: "unknown",
    fullCube: false,
    appearance: appearance(201, 160, 70),
  }),
  block("create:copycat_step", "cf-1", {
    properties: {
      facing: ["north", "south", "west", "east"],
      half: ["top", "bottom"],
      waterlogged: ["true", "false"],
    },
    defaults: { facing: "north", half: "bottom", waterlogged: "false" },
    kind: "unknown",
    fullCube: false,
    camo: { slots: 1 },
  }),
];

const COPYCAT_BLOCKS = [
  block("copycats:copycat_block", "cf-2", {
    appearance: appearance(150, 150, 150),
    camo: { slots: 1 },
  }),
  block("copycats:copycat_stairs", "cf-2", {
    properties: {
      facing: ["north", "south", "west", "east"],
      half: ["top", "bottom"],
      shape: [
        "straight",
        "inner_left",
        "inner_right",
        "outer_left",
        "outer_right",
      ],
      waterlogged: ["true", "false"],
    },
    defaults: {
      facing: "north",
      half: "bottom",
      shape: "straight",
      waterlogged: "false",
    },
    kind: "unknown",
    fullCube: false,
    appearance: appearance(150, 150, 150),
    camo: { slots: 1 },
  }),
];

function pack(
  slug: string,
  v: ModpackIndexVersion,
  blocks: ModpackBlock[],
  extra: Partial<ModpackData> = {},
): ModpackData {
  return {
    formatVersion: MODPACK_FORMAT_VERSION,
    slug,
    name: slug,
    curseForgeProjectId: null,
    version: v,
    mods: MODS,
    blocks: [...blocks].sort((a, b) => a.id.localeCompare(b.id)),
    runtimeBlockSources: [],
    ...extra,
  };
}

const V1211 = version("cf-11", "1.21.1", 11);
const V1201 = version("cf-12", "1.20.1", 12);
const VPLAIN = version("cf-13", "1.21.1", 13);
const PACKS = [
  pack("camo-pack", V1211, [...CREATE_BLOCKS, ...COPYCAT_BLOCKS]),
  pack("old-camo-pack", V1201, [...CREATE_BLOCKS, ...COPYCAT_BLOCKS]),
  pack("plain-pack", VPLAIN, [CREATE_BLOCKS[0], CREATE_BLOCKS[1]]),
];

const INDEX: ModpackIndex = {
  formatVersion: MODPACK_FORMAT_VERSION,
  packs: PACKS.map((p) => ({
    slug: p.slug,
    name: p.name,
    curseForgeProjectId: null,
    versions: [p.version],
  })),
};

let blob: FakeBlob;
beforeEach(() => {
  clearModpackCache();
  clearBlockDataCache();
  blob = createFakeBlob(() => NOW);
  blob.objects.set(modpackIndexPath(), {
    body: new TextEncoder().encode(JSON.stringify(INDEX)),
    uploadedAt: NOW,
  });
  for (const p of PACKS) {
    blob.objects.set(modpackDataPath(p.slug, p.version.key), {
      body: encodeModpackData(p),
      uploadedAt: NOW,
    });
  }
});

function makeDeps(): McpDeps {
  return { fetch: fetchStub as never, now: () => NOW, blob };
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

interface CamoData {
  results?: { id: string }[];
  blocks?: { id: string }[];
  camo_options?: CamoOption[];
  camo_material_rule?: string;
  note?: string;
}

async function call(
  tool: typeof searchBlocksTool | typeof suggestPaletteTool,
  args: Record<string, unknown>,
): Promise<CamoData> {
  const result = await runTool(
    tool as typeof searchBlocksTool,
    args,
    makeDeps(),
  );
  if (result.isError) throw new Error(text(result));
  return result.structuredContent as unknown as CamoData;
}

describe("camo options in search_blocks", () => {
  it("offers a copycat stairs with a brass camo on a 1.21.1 pack", async () => {
    const data = await call(searchBlocksTool, {
      query: "brass",
      modpack: "camo-pack",
      shape: ["stairs"],
    });
    expect(data.camo_material_rule).toBe("approximate");
    expect(data.camo_options).toEqual([
      {
        frame: "copycats:copycat_stairs",
        kind: "stairs",
        slots: 1,
        writable: true,
        camo: "create:brass_block",
        camo_hex: BRASS.hex,
      },
      {
        frame: "copycats:copycat_stairs",
        kind: "stairs",
        slots: 1,
        writable: true,
        camo: "create:brass_casing",
        camo_hex: appearance(180, 130, 60).hex,
      },
    ]);
    expect(data.note).toMatch(/approximate/);
  });

  it("reads the shape from the query when no plain block has it", async () => {
    const data = await call(searchBlocksTool, {
      query: "brass_stairs",
      modpack: "camo-pack",
    });
    expect(data.results).toEqual([]);
    expect(data.camo_options?.[0]).toMatchObject({
      frame: "copycats:copycat_stairs",
      camo: "create:brass_block",
    });
    // A vanilla stairs matches by name, so no camo is offered.
    const oak = await call(searchBlocksTool, {
      query: "oak_stairs",
      modpack: "camo-pack",
    });
    expect(oak.results?.[0].id).toBe("minecraft:oak_stairs");
    expect(oak.camo_options).toBeUndefined();
  });

  it("offers a copycat step for the step shape", async () => {
    const data = await call(searchBlocksTool, {
      query: "brass",
      modpack: "camo-pack",
      shape: ["step"],
    });
    expect(data.camo_options?.[0]).toEqual({
      frame: "create:copycat_step",
      kind: "step",
      slots: 1,
      writable: true,
      camo: "create:brass_block",
      camo_hex: BRASS.hex,
    });
    expect(
      data.camo_options!.every((o) => o.frame === "create:copycat_step"),
    ).toBe(true);
    // From the query alone.
    const named = await call(searchBlocksTool, {
      query: "brass_step",
      modpack: "camo-pack",
    });
    expect(named.camo_options?.[0]).toMatchObject({
      frame: "create:copycat_step",
      camo: "create:brass_block",
    });
  });

  it("lists bare frames when no material matches", async () => {
    const data = await call(searchBlocksTool, {
      query: "zzz",
      modpack: "camo-pack",
      shape: ["stairs", "full_cube"],
    });
    expect(data.camo_options).toEqual([
      expect.objectContaining({
        frame: "copycats:copycat_block",
        kind: "block",
      }),
      expect.objectContaining({ frame: "copycats:copycat_stairs" }),
    ]);
    expect(data.camo_options!.every((o) => o.camo === undefined)).toBe(true);
  });

  it("offers nothing on a pack without camo mods, or without a shape", async () => {
    const plain = await call(searchBlocksTool, {
      query: "brass",
      modpack: "plain-pack",
      shape: ["stairs"],
    });
    expect(plain.camo_options).toBeUndefined();
    expect(plain.camo_material_rule).toBeUndefined();
    const noShape = await call(searchBlocksTool, {
      query: "brass",
      modpack: "camo-pack",
    });
    expect(noShape.camo_options).toBeUndefined();
  });

  it("marks camo on a 1.20.1 pack as not writable", async () => {
    const data = await call(searchBlocksTool, {
      query: "brass",
      modpack: "old-camo-pack",
      shape: ["stairs"],
    });
    expect(data.camo_options?.length).toBeGreaterThan(0);
    for (const option of data.camo_options!) {
      expect(option.writable).toBe(false);
      expect(option.reason).toMatch(/isn't verified for Minecraft 1\.20\.1/);
    }
  });
});

describe("camo options in suggest_palette", () => {
  it("pairs the frames with the materials nearest the colour", async () => {
    const data = await call(suggestPaletteTool, {
      color: BRASS.hex,
      modpack: "camo-pack",
      shape: ["stairs"],
    });
    expect(data.camo_material_rule).toBe("approximate");
    expect(data.camo_options?.[0]).toMatchObject({
      frame: "copycats:copycat_stairs",
      kind: "stairs",
      writable: true,
      camo: "create:brass_block",
      camo_hex: BRASS.hex,
      distance: 0,
    });
    // Not a full cube, not a material.
    expect(
      data.camo_options!.some((o) => o.camo === "create:brass_funnel"),
    ).toBe(false);
  });

  it("pairs copycat steps with the nearest materials", async () => {
    const data = await call(suggestPaletteTool, {
      color: BRASS.hex,
      modpack: "camo-pack",
      shape: ["step"],
    });
    expect(data.camo_options?.[0]).toMatchObject({
      frame: "create:copycat_step",
      kind: "step",
      writable: true,
      camo: "create:brass_block",
      distance: 0,
    });
  });

  it("offers nothing without a shape or camo mods", async () => {
    const noShape = await call(suggestPaletteTool, {
      color: BRASS.hex,
      modpack: "camo-pack",
    });
    expect(noShape.camo_options).toBeUndefined();
    const plain = await call(suggestPaletteTool, {
      color: BRASS.hex,
      modpack: "plain-pack",
      shape: ["stairs"],
    });
    expect(plain.camo_options).toBeUndefined();
  });
});

describe("camo frames and materials", () => {
  it("offers only frames that save camo and have a shape-pack rule", () => {
    for (const id of CAMO_FRAME_IDS) {
      expect(CAMO_BLOCK_IDS).toContain(id);
      const ns = id.slice(0, id.indexOf(":"));
      expect(serverShapePack(ns)?.blocks[id]?.length).toBeGreaterThan(0);
    }
  });

  it("applies a pack's FramedBlocks templates to the shape pack", () => {
    const vanilla = createBlockRegistry(
      { sourceVersion: "1.21.1", blocks: new Map() } as never,
      "1.21.1",
    );
    const cube = {
      box: { from: [0, 0, 0], to: [16, 4, 16] },
      faces: { down: true },
    } as const;
    const data = pack("framed", V1211, [], {
      framedTemplates: {
        "framedblocks:bookshelf": [
          { box: { from: [0, 0, 0], to: [16, 4, 16] }, faces: { down: true } },
        ],
      },
    });
    const modpack = createModpackRegistry(vanilla, data, "framed");
    const base = serverShapePack("framedblocks")!;
    const overridden = modpackShapePack(modpack, "framedblocks")!;
    const id = "framedblocks:framed_bookshelf";
    expect(overridden.blocks[id]).not.toEqual(base.blocks[id]);
    expect(
      overridden.blocks[id][0].pieces.filter(
        (p) => p.template?.id === "framedblocks:bookshelf",
      ),
    ).toEqual([
      expect.objectContaining({
        select: cube.box,
        template: { id: "framedblocks:bookshelf", element: 0 },
      }),
    ]);
    // Without templates the pack is the shared one.
    const plain = createModpackRegistry(vanilla, pack("p", V1211, []), "p");
    expect(modpackShapePack(plain, "framedblocks")).toBe(base);
  });

  it("knows vanilla block-entity blocks", () => {
    expect(isKnownBlockEntityBlock("minecraft:furnace")).toBe(true);
    expect(isKnownBlockEntityBlock("minecraft:red_shulker_box")).toBe(true);
    expect(isKnownBlockEntityBlock("minecraft:stone")).toBe(false);
  });

  it("writes camo only for versions with a fixture", () => {
    expect(CAMO_WRITE_VERSIONS).toEqual({
      framedblocks: ["1.21.1", "26.1.2"],
      create: ["1.21.1"],
      copycats: ["1.21.1"],
    });
    expect(isCamoWritable("framedblocks", "26.1.2")).toBe(true);
    expect(isCamoWritable("create", "26.1.2")).toBe(false);
    expect(camoWriteReason("create", "26.1.2")).toMatch(
      /isn't verified for Minecraft 26\.1\.2.*1\.21\.1/,
    );
  });

  it("splits a shape word off a query", () => {
    expect(splitShapeQuery("brass_stairs")).toEqual({
      material: "brass",
      shape: "stairs",
    });
    expect(splitShapeQuery("create:Brass Slab")).toEqual({
      material: "create:brass",
      shape: "slab",
    });
    expect(splitShapeQuery("brass_steps")).toEqual({
      material: "brass",
      shape: "step",
    });
    expect(splitShapeQuery("brass")).toEqual({ material: "brass" });
    expect(splitShapeQuery("stairs")).toEqual({ material: "stairs" });
  });
});
