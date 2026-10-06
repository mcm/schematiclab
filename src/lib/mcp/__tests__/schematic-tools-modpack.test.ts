import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import { defaultCamoSlots } from "../../camo/extract";
import { withCamoMaterials } from "../../camo/materials";
import { writeCamoChoice } from "../../camo/write";
import {
  parseSchematic,
  serializeSchematic,
  type ParsedSchematicProjection,
} from "../../convert";
import { modpackDataPath, modpackIndexPath } from "../../modpacks/paths";
import { clearModpackCache, encodeModpackData } from "../../modpacks/reader";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndex,
} from "../../modpacks/schema";
import {
  KNOWN_VERSIONS,
  type MinecraftVersion,
} from "../../schemlib/schematic-formats/version-mapping";
import {
  MAX_WARNINGS,
  convertSchematicTool,
  inspectSchematicTool,
  renderSchematicTool,
  type InspectResult,
} from "../schematic-tools";
import { runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-06T12:00:00.000Z");

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
    block("create:brass_block"),
    block("create:copycat_step", {
      properties: {
        facing: ["north", "south", "west", "east"],
        half: ["top", "bottom"],
      },
      kind: "unknown",
      fullCube: false,
      camo: { slots: 1 },
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
  return {
    fetch: fetchStub as never,
    now: () => NOW,
    blob,
    blobStoreId: "store_store",
  };
}

interface Entry {
  blockId: string;
  properties?: Record<string, string>;
  count?: number;
}

// One block per placement, `count` placements per entry, in a row along x.
function projectionOf(
  entries: Entry[],
  minecraftVersion: MinecraftVersion = KNOWN_VERSIONS["1.21.4"],
): ParsedSchematicProjection {
  const placements: { pos: [number, number, number]; paletteIndex: number }[] =
    [];
  entries.forEach(({ count = 1 }, i) => {
    for (let n = 0; n < count; n++) {
      placements.push({ pos: [placements.length, 0, 0], paletteIndex: i });
    }
  });
  return {
    name: "modded",
    inputFormat: "Sponge[v2]",
    minecraftVersion,
    totalBlocks: placements.length,
    palette: entries.map(({ blockId, properties = {}, count = 1 }) => {
      const props = Object.entries(properties);
      return {
        blockState:
          props.length === 0
            ? blockId
            : `${blockId}[${props.map(([k, v]) => `${k}=${v}`).join(",")}]`,
        blockId,
        properties,
        count,
      };
    }),
    regions: [
      {
        origin: [0, 0, 0],
        size: [Math.max(1, placements.length), 1, 1],
        blocks: placements,
        blockEntities: [],
      },
    ],
  };
}

// The schematic as Sponge v2 bytes, the way an agent would pass it.
function schematicArgs(
  projection: ParsedSchematicProjection,
  version = "1.21.4",
) {
  const serialized = serializeSchematic({
    schematic: projection,
    inputFilename: "modded.json",
    outputFormat: "Sponge[v2]",
    targetVersion: version,
  });
  if (!serialized.ok) throw new Error(serialized.error);
  return {
    base64: Buffer.from(serialized.bytes).toString("base64"),
    filename: serialized.filename,
  };
}

function structured<T>(result: CallToolResult): T {
  expect(result.isError).toBeFalsy();
  return result.structuredContent as T;
}

// A copycat step holding a brass camo, plus one in-pack and one missing mod
// block and a vanilla block.
function moddedSchematic(): ParsedSchematicProjection {
  const step = { facing: "north", half: "bottom" };
  const projection = projectionOf([
    { blockId: "create:brass_block", count: 3 },
    { blockId: "create:not_a_block", count: 2 },
    { blockId: "minecraft:stone" },
    { blockId: "create:copycat_step", properties: step },
  ]);
  const [slot] = defaultCamoSlots("create:copycat_step", step);
  const nbt = writeCamoChoice("create:copycat_step", step, undefined, {
    [slot]: { blockId: "create:brass_block", properties: {} },
  });
  projection.regions[0].blockEntities.push({ pos: [6, 0, 0], nbt: nbt! });
  projection.palette = withCamoMaterials(
    projection.palette,
    projection.regions,
  );
  return projection;
}

describe("inspect_schematic with a modpack", () => {
  it("marks each palette row and lists the missing states", async () => {
    const result = structured<InspectResult>(
      await runTool(
        inspectSchematicTool,
        { ...schematicArgs(moddedSchematic()), modpack: "test-pack" },
        makeDeps(),
      ),
    );
    const row = (state: string) =>
      result.palette.find((r) => r.block_state === state);
    expect(row("create:brass_block")).toMatchObject({
      count: 3,
      mod: "Create",
      in_modpack: true,
    });
    expect(row("create:not_a_block")).toMatchObject({
      count: 2,
      mod: "create",
      in_modpack: false,
    });
    expect(row("minecraft:stone")).toMatchObject({
      mod: "minecraft",
      in_modpack: true,
    });
    expect(row("create:copycat_step[facing=north,half=bottom]")).toEqual({
      block_state: "create:copycat_step[facing=north,half=bottom]",
      count: 1,
      mod: "Create",
      in_modpack: true,
      camo_materials: [
        { block_state: "create:brass_block", count: 1, in_modpack: true },
      ],
    });
    expect(result.missing_from_modpack).toEqual({
      block_states: [{ block_state: "create:not_a_block", count: 2 }],
      states_not_listed: 0,
    });
    expect(result.note).toBeUndefined();
  });

  it("is unchanged without a modpack", async () => {
    const result = structured<InspectResult>(
      await runTool(
        inspectSchematicTool,
        schematicArgs(moddedSchematic()),
        makeDeps(),
      ),
    );
    expect(result.missing_from_modpack).toBeUndefined();
    for (const row of result.palette) {
      expect(Object.keys(row).sort()).toEqual(["block_state", "count"]);
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("lists at most 50 missing states, plus how many more", async () => {
    const entries = Array.from({ length: MAX_WARNINGS + 7 }, (_, i) => ({
      blockId: `othermod:block_${i}`,
    }));
    const result = structured<InspectResult>(
      await runTool(
        inspectSchematicTool,
        { ...schematicArgs(projectionOf(entries)), modpack: "test-pack" },
        makeDeps(),
      ),
    );
    expect(result.missing_from_modpack?.block_states).toHaveLength(
      MAX_WARNINGS,
    );
    expect(result.missing_from_modpack?.states_not_listed).toBe(7);
  });

  it("compares a schematic of another version after translation", async () => {
    const projection = projectionOf(
      [{ blockId: "minecraft:grass" }, { blockId: "create:brass_block" }],
      KNOWN_VERSIONS["1.20.1"],
    );
    const result = structured<InspectResult>(
      await runTool(
        inspectSchematicTool,
        { ...schematicArgs(projection, "1.20.1"), modpack: "test-pack" },
        makeDeps(),
      ),
    );
    expect(result.minecraft_version).toBe("1.20.1");
    // 1.20.3 renamed grass to short_grass; the pack (1.21.4) has the latter.
    expect(
      result.palette.find((r) => r.block_state === "minecraft:grass"),
    ).toMatchObject({
      in_modpack: true,
      translated_state: "minecraft:short_grass",
    });
    expect(result.missing_from_modpack?.block_states).toEqual([]);
    expect(result.note).toContain("after translation to 1.21.4");
  });

  it("fails for an unknown modpack", async () => {
    const result = await runTool(
      inspectSchematicTool,
      { ...schematicArgs(moddedSchematic()), modpack: "no-such-pack" },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
  });
});

interface ConvertResult {
  url: string;
  minecraft_version: string;
  warnings: string[];
  note?: string;
}

// The bytes of the file `convert_schematic` wrote.
function written(): Uint8Array {
  const outputs = [...blob.objects.entries()].filter(
    ([key]) => !key.startsWith("modpacks/"),
  );
  expect(outputs).toHaveLength(1);
  return outputs[0][1].body;
}

describe("convert_schematic with a modpack", () => {
  it("warns about each missing state and converts the same", async () => {
    const args = {
      ...schematicArgs(moddedSchematic()),
      output_format: "Litematic",
    };
    const withPack = structured<ConvertResult>(
      await runTool(
        convertSchematicTool,
        { ...args, modpack: "test-pack" },
        makeDeps(),
      ),
    );
    expect(withPack.warnings).toEqual([
      "create:not_a_block: not in modpack 'test-pack' (2 blocks).",
    ]);
    expect(withPack.note).toBeUndefined();
    const packBytes = written();

    blob.objects.clear();
    const plain = structured<ConvertResult>(
      await runTool(convertSchematicTool, args, makeDeps()),
    );
    expect(plain.warnings).toEqual([]);
    const parsedWith = parseSchematic(packBytes);
    const parsedPlain = parseSchematic(written());
    if (!parsedWith.ok || !parsedPlain.ok) throw new Error("unreadable");
    expect(parsedWith.schematic.palette).toEqual(parsedPlain.schematic.palette);
    expect(parsedWith.schematic.regions).toEqual(parsedPlain.schematic.regions);
  });

  it("caps translation and modpack warnings together at 50", async () => {
    const entries = Array.from({ length: MAX_WARNINGS + 3 }, (_, i) => ({
      blockId: `othermod:block_${i}`,
    }));
    const result = structured<ConvertResult>(
      await runTool(
        convertSchematicTool,
        {
          ...schematicArgs(projectionOf(entries)),
          output_format: "Sponge[v3]",
          modpack: "test-pack",
        },
        makeDeps(),
      ),
    );
    expect(result.warnings).toHaveLength(MAX_WARNINGS + 1);
    expect(result.warnings.at(-1)).toBe("…and 3 more warnings.");
  });

  it("notes a schematic of another version", async () => {
    const projection = projectionOf(
      [{ blockId: "minecraft:stone" }, { blockId: "othermod:thing" }],
      KNOWN_VERSIONS["1.20.1"],
    );
    const result = structured<ConvertResult>(
      await runTool(
        convertSchematicTool,
        {
          ...schematicArgs(projection, "1.20.1"),
          output_format: "Sponge[v3]",
          modpack: "test-pack",
        },
        makeDeps(),
      ),
    );
    expect(result.minecraft_version).toBe("1.20.1");
    expect(result.warnings).toEqual([
      "othermod:thing: not in modpack 'test-pack' (1 block).",
    ]);
    expect(result.note).toContain(
      "compared with the pack after translation to 1.21.4",
    );
  });
});

describe("render_schematic with a modpack", () => {
  it("counts missing states after translation, as inspect_schematic does", async () => {
    const projection = projectionOf(
      [
        { blockId: "minecraft:air" },
        { blockId: "minecraft:grass" },
        { blockId: "othermod:thing" },
      ],
      KNOWN_VERSIONS["1.20.1"],
    );
    const result = await runTool(
      renderSchematicTool,
      { ...schematicArgs(projection, "1.20.1"), modpack: "test-pack" },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    const summary = result.content.find((c) => c.type === "text");
    const text = summary?.type === "text" ? summary.text : "";
    // grass is short_grass in the pack's 1.21.4; air never counts.
    expect(text).toContain("1 block state not in test-pack (othermod:thing).");
    expect(text).toContain(
      "compared with the pack after translation to 1.21.4",
    );
  });
});
