import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import { extractCamoSlots } from "../../camo/extract";
import { splitCamoMaterial } from "../../camo/material-syntax";
import {
  parseSchematic,
  type ParsedSchematicProjection,
  type SchematicFormatId,
} from "../../convert";
import { modpackDataPath, modpackIndexPath } from "../../modpacks/paths";
import { clearModpackCache, encodeModpackData } from "../../modpacks/reader";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndex,
  type ModpackIndexVersion,
} from "../../modpacks/schema";
import { srgbToOklab } from "../../render/block-appearance";
import { staticRenderColors } from "../../render/static-render-colors";
import { oklabToHex } from "../../render/static-views";
import { compileBuildTool, checkBuildTool } from "../build-tools";
import { generateShapeTool } from "../generate-shape";
import { resolveToolBlocks } from "../tool-blocks";
import { modpackRenderSource } from "../render";
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

function version(minecraftVersion: string): ModpackIndexVersion {
  return {
    key: `v-${minecraftVersion}`,
    packFileId: null,
    displayVersion: minecraftVersion,
    minecraftVersion,
    loader: "neoforge",
    modCount: 2,
    uploadedAt: "2026-10-01T00:00:00.000Z",
  };
}

const BRASS_HEX = oklabToHex(srgbToOklab(200, 160, 70));
const BRASS = {
  hex: BRASS_HEX,
  oklab: srgbToOklab(200, 160, 70),
  dominant: [{ hex: BRASS_HEX, share: 1 }],
  variance: 0.1,
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

const MODS: ModpackData["mods"] = [
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
  {
    key: "cf-2",
    name: "FramedBlocks",
    curseForgeProjectId: 441647,
    curseForgeFileId: 2,
    fileName: "framedblocks.jar",
    namespaces: ["framedblocks"],
    status: "ok",
    hasSwatches: false,
  },
];

const BLOCKS: ModpackBlock[] = [
  block("create:brass_block", "cf-1", { appearance: BRASS }),
  block("framedblocks:framed_cube", "cf-2", {
    properties: { solid: ["false", "true"] },
    defaults: { solid: "false" },
    camo: { slots: 1 },
  }),
  block("framedblocks:framed_stairs", "cf-2", {
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
    kind: "stairs",
    fullCube: false,
    camo: { slots: 1 },
  }),
  block("framedblocks:framed_double_slab", "cf-2", {
    camo: { slots: 2 },
  }),
];

function pack(slug: string, minecraftVersion: string): ModpackData {
  return {
    formatVersion: MODPACK_FORMAT_VERSION,
    slug,
    name: slug,
    curseForgeProjectId: null,
    version: version(minecraftVersion),
    mods: MODS,
    blocks: BLOCKS,
    runtimeBlockSources: [],
  };
}

const PACKS = [pack("camo-pack", "1.21.1"), pack("old-pack", "1.20.1")];

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

function texts(result: CallToolResult): string[] {
  return result.content.flatMap((c) => (c.type === "text" ? [c.text] : []));
}

/** The schematic the last call wrote, parsed back. */
function writtenProjection(): ParsedSchematicProjection {
  const written = [...blob.objects].filter(([p]) => !p.startsWith("modpacks/"));
  expect(written).toHaveLength(1);
  const parsed = parseSchematic(written[0][1].body);
  if (!parsed.ok) throw new Error(parsed.error);
  blob.objects.delete(written[0][0]);
  return parsed.schematic;
}

/** Each placed frame's camo, read back with `extractCamoSlots`. */
function camoOfFrames(projection: ParsedSchematicProjection, frame: string) {
  const out: { slot: string; name?: string }[][] = [];
  for (const region of projection.regions) {
    const nbtAt = new Map(
      region.blockEntities.map((be) => [be.pos.join(","), be.nbt]),
    );
    for (const placed of region.blocks) {
      const entry = projection.palette[placed.paletteIndex];
      if (entry.blockId !== frame) continue;
      out.push(
        extractCamoSlots(
          entry.blockId,
          entry.properties,
          nbtAt.get(placed.pos.join(",")),
        ).map(({ slot, state }) => ({ slot, name: state?.name })),
      );
    }
  }
  return out;
}

const STAIRS = "framedblocks:framed_stairs";
const BRASS_STAIRS = `${STAIRS}{camo=create:brass_block}`;

const stairsProgram = (material: string) => ({
  name: "Brass stairs",
  size: [3, 1, 1],
  build: [
    {
      box: { size: [3, 1, 1], do: [{ fill: { material, facing: "-z" } }] },
    },
  ],
});

describe("camo material syntax", () => {
  it("splits a frame and its camo, keeping commas inside states", () => {
    expect(
      splitCamoMaterial(
        "framedblocks:framed_double_slab{camo=oak_log[axis=x,foo=bar], camo_two=stone}",
      ),
    ).toEqual({
      ok: true,
      value: {
        frame: "framedblocks:framed_double_slab",
        camo: { camo: "oak_log[axis=x,foo=bar]", camo_two: "stone" },
      },
    });
    expect(splitCamoMaterial("stone")).toEqual({
      ok: true,
      value: { frame: "stone" },
    });
    for (const bad of [
      "framed_cube{camo=stone",
      "framed_cube{camo_two=stone}",
      "framed_cube{look=stone}",
      "{camo=stone}",
      "framed_cube{camo=stone,camo=dirt}",
    ]) {
      expect(splitCamoMaterial(bad).ok).toBe(false);
    }
  });
});

describe("camo materials in compile_build", () => {
  for (const format of ["Litematic", "Structure"] as SchematicFormatId[]) {
    it(`writes FramedBlocks stairs with a camo on 1.21.1 (${format})`, async () => {
      const result = await runTool(
        compileBuildTool,
        {
          program: stairsProgram(BRASS_STAIRS),
          version: "1.21.1",
          modpack: "camo-pack",
          output_format: format,
          render: false,
        },
        makeDeps(),
      );
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        errors: 0,
        block_count: 3,
      });
      const projection = writtenProjection();
      expect(camoOfFrames(projection, STAIRS)).toEqual([
        [{ slot: "camo", name: "create:brass_block" }],
        [{ slot: "camo", name: "create:brass_block" }],
        [{ slot: "camo", name: "create:brass_block" }],
      ]);
      const stairs = projection.palette.find((e) => e.blockId === STAIRS);
      expect(stairs?.properties.facing).toBe("north");
      expect(stairs?.camoMaterials).toEqual([
        expect.objectContaining({
          kind: "block",
          blockId: "create:brass_block",
          count: 3,
        }),
      ]);
    });
  }

  it("lists camo blocks in the report's materials", async () => {
    const result = await runTool(
      checkBuildTool,
      {
        program: stairsProgram(BRASS_STAIRS),
        version: "1.21.1",
        modpack: "camo-pack",
      },
      makeDeps(),
    );
    expect(texts(result)[0]).toContain(
      "framedblocks:framed_stairs{camo=create:brass_block} x3",
    );
  });

  it("writes both camos of a double block", async () => {
    const result = await runTool(
      compileBuildTool,
      {
        program: {
          name: "Double",
          size: [1, 1, 1],
          palette: {
            slab: "framedblocks:framed_double_slab{camo=create:brass_block,camo_two=stone}",
          },
          build: [{ block: { material: "@slab" } }],
        },
        version: "1.21.1",
        modpack: "camo-pack",
        output_format: "Structure",
        render: false,
      },
      makeDeps(),
    );
    expect(result.structuredContent).toMatchObject({ errors: 0 });
    expect(
      camoOfFrames(writtenProjection(), "framedblocks:framed_double_slab"),
    ).toEqual([
      [
        { slot: "camo", name: "create:brass_block" },
        { slot: "camo_two", name: "minecraft:stone" },
      ],
    ]);
  });

  it("checks the frame and camo like other materials", async () => {
    const errorsOf = async (material: string) => {
      const result = await runTool(
        checkBuildTool,
        {
          program: stairsProgram(material),
          version: "1.21.1",
          modpack: "camo-pack",
        },
        makeDeps(),
      );
      return texts(result)[0];
    };
    expect(await errorsOf(`${STAIRS}{camo=create:brass_blok}`)).toMatch(
      /unknown block\/material 'create:brass_blok'.*Did you mean: create:brass_block/,
    );
    // A camo frame isn't a camo material.
    expect(await errorsOf(`${STAIRS}{camo=framedblocks:framed_cube}`)).toMatch(
      /framedblocks:framed_cube isn't a camo material in 'camo-pack'/,
    );
    // Not a full cube.
    expect(await errorsOf(`${STAIRS}{camo=oak_stairs}`)).toMatch(
      /minecraft:oak_stairs isn't a camo material/,
    );
    expect(await errorsOf("stone{camo=create:brass_block}")).toContain(
      "minecraft:stone doesn't hold a camo",
    );
    expect(
      await errorsOf(`${STAIRS}{camo=create:brass_block,camo_two=stone}`),
    ).toContain("camo_two is only for double blocks");
  });

  it("refuses camo for a 1.20.1 pack, naming the verified versions", async () => {
    const result = await runTool(
      checkBuildTool,
      {
        program: stairsProgram(BRASS_STAIRS),
        version: "1.20.1",
        modpack: "old-pack",
      },
      makeDeps(),
    );
    expect(result.structuredContent).toMatchObject({ errors: 1 });
    expect(texts(result)[0]).toMatch(
      /Writing framedblocks camo isn't verified for Minecraft 1\.20\.1.*it is for 1\.21\.1, 26\.1\.2/,
    );
  });

  it("refuses camo without a modpack", async () => {
    const result = await runTool(
      checkBuildTool,
      { program: stairsProgram(`stone{camo=dirt}`), version: "1.21.1" },
      makeDeps(),
    );
    expect(texts(result)[0]).toContain("need a modpack");
  });

  it("renders camo frames in their camo's colour", async () => {
    const result = await runTool(
      compileBuildTool,
      {
        program: stairsProgram(BRASS_STAIRS),
        version: "1.21.1",
        modpack: "camo-pack",
        output_format: "Litematic",
        render: false,
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    const projection = writtenProjection();
    const { modpack } = await resolveToolBlocks(
      { modpack: "camo-pack" },
      makeDeps(),
    );
    const source = modpackRenderSource(modpack!);
    const colors = staticRenderColors(projection, (id) =>
      source.appearance(id),
    );
    const placed = projection.regions[0].blocks[0];
    expect(colors.colorAt(0, placed.pos, placed.paletteIndex)).toBe(BRASS_HEX);
  });
});

describe("camo materials in generate_shape", () => {
  const shape = (
    material: string,
    modpack: string | undefined,
    format = "Litematic",
    minecraftVersion = "1.21.1",
  ) =>
    runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 2,
        height: 1,
        depth: 1,
        material,
        version: minecraftVersion,
        output_format: format,
        ...(modpack && { modpack }),
      },
      makeDeps(),
    );

  for (const format of ["Litematic", "Structure"]) {
    it(`writes a camo on every frame (${format})`, async () => {
      const result = await shape(
        `${STAIRS}[facing=east]{camo=create:brass_block}`,
        "camo-pack",
        format,
      );
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        block_state: `${STAIRS}[facing=east]`,
        camo: expect.stringContaining("camo=create:brass_block"),
      });
      expect(camoOfFrames(writtenProjection(), STAIRS)).toEqual([
        [{ slot: "camo", name: "create:brass_block" }],
        [{ slot: "camo", name: "create:brass_block" }],
      ]);
    });
  }

  it("refuses a 1.20.1 pack", async () => {
    const result = await shape(BRASS_STAIRS, "old-pack", "Litematic", "1.20.1");
    expect(result.isError).toBe(true);
    expect(texts(result)[0]).toContain(
      "Writing framedblocks camo isn't verified for Minecraft 1.20.1",
    );
  });

  it("refuses bad camos and a camo without a modpack", async () => {
    const material = await shape(
      `${STAIRS}{camo=framedblocks:framed_cube}`,
      "camo-pack",
    );
    expect(texts(material)[0]).toContain("isn't a camo material");
    const unknown = await shape(
      `${STAIRS}{camo=create:brass_blok}`,
      "camo-pack",
    );
    expect(texts(unknown)[0]).toMatch(/Unknown block "create:brass_blok"/);
    const noPack = await shape(BRASS_STAIRS, undefined);
    expect(noPack.isError).toBe(true);
    expect(texts(noPack)[0]).toContain("needs a modpack");
  });
});
