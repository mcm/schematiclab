import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import { loadBlockRegistry } from "../../blockdata/registry";
import { compileForRegistry, compileProgram } from "../../buildlang/build";
import type { ParsedSchematicProjection } from "../../convert";
import { modpackDataPath, modpackIndexPath } from "../../modpacks/paths";
import { clearModpackCache, encodeModpackData } from "../../modpacks/reader";
import { createModpackRegistry } from "../../modpacks/registry";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndex,
} from "../../modpacks/schema";
import { checkBuildTool, compileBuildTool } from "../build-tools";
import { generateShapeTool } from "../generate-shape";
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

const FACINGS = ["north", "south", "west", "east"];
const BOOLEANS = ["true", "false"];

const PACK: ModpackData = {
  formatVersion: MODPACK_FORMAT_VERSION,
  slug: "test-pack",
  name: "Test Pack",
  curseForgeProjectId: null,
  version: VERSION,
  mods: [
    {
      key: "cf-1",
      name: "Example Mod",
      curseForgeProjectId: 1,
      curseForgeFileId: 1,
      fileName: "example.jar",
      namespaces: ["examplemod"],
      status: "ok",
      hasSwatches: false,
    },
  ],
  blocks: [
    block("examplemod:brass_block"),
    // Named like nothing the name rules know, but confidently stairs.
    block("examplemod:brass_steps", {
      properties: {
        facing: FACINGS,
        half: ["top", "bottom"],
        shape: [
          "straight",
          "inner_left",
          "inner_right",
          "outer_left",
          "outer_right",
        ],
        waterlogged: BOOLEANS,
      },
      defaults: {
        facing: "north",
        half: "bottom",
        shape: "straight",
        waterlogged: "false",
      },
      kind: "stairs",
      fullCube: false,
    }),
    block("examplemod:brass_railing", {
      properties: {
        north: BOOLEANS,
        east: BOOLEANS,
        south: BOOLEANS,
        west: BOOLEANS,
        waterlogged: BOOLEANS,
      },
      defaults: {
        north: "false",
        east: "false",
        south: "false",
        west: "false",
        waterlogged: "false",
      },
      kind: "fence",
      fullCube: false,
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

function texts(result: CallToolResult): string[] {
  return result.content.flatMap((c) => (c.type === "text" ? [c.text] : []));
}

async function packRegistry() {
  const vanilla = await loadBlockRegistry("1.21.4", { fetch: fetchStub });
  return createModpackRegistry(vanilla, PACK, "test-pack").registry;
}

/** Block id and properties at a cell of a one-region projection. */
function stateAt(
  projection: ParsedSchematicProjection,
  pos: [number, number, number],
) {
  const placed = projection.regions[0].blocks.find(
    (b) => b.pos[0] === pos[0] && b.pos[1] === pos[1] && b.pos[2] === pos[2],
  );
  if (!placed) return undefined;
  const entry = projection.palette[placed.paletteIndex];
  return { id: entry.blockId, properties: entry.properties };
}

const program = (palette: Record<string, unknown>, build: unknown[]) => ({
  name: "Modded",
  size: [4, 2, 4],
  palette,
  build,
});

describe("build-language materials with a modpack", () => {
  it("compiles a mod block of the pack by its namespaced id", async () => {
    const built = compileForRegistry(
      program({ body: "examplemod:brass_block" }, [
        { box: { size: [2, 1, 1], do: [{ fill: "@body" }] } },
        {
          block: {
            material: "examplemod:brass_steps[half=top]",
            at: [3, 0, 0],
          },
        },
        {
          block: {
            material: { mix: { "examplemod:brass_block": 1 } },
            at: [3, 1, 0],
          },
        },
      ]),
      "1.21.4",
      await packRegistry(),
    );
    expect(built.errors).toEqual([]);
    expect(built.projection).not.toBeNull();
    expect(stateAt(built.projection!, [0, 0, 0])?.id).toBe(
      "examplemod:brass_block",
    );
    expect(stateAt(built.projection!, [3, 0, 0])).toEqual({
      id: "examplemod:brass_steps",
      properties: expect.objectContaining({ half: "top" }),
    });
    expect(stateAt(built.projection!, [3, 1, 0])?.id).toBe(
      "examplemod:brass_block",
    );
  });

  it("errors at the program path for a mod id or state the pack lacks", async () => {
    const registry = await packRegistry();
    const missing = compileForRegistry(
      program({ body: "examplemod:brass_blok" }, [
        { box: { do: [{ fill: "@body" }] } },
      ]),
      "1.21.4",
      registry,
    );
    expect(missing.errors).toContainEqual({
      path: "palette.body",
      message: expect.stringMatching(
        /unknown block\/material 'examplemod:brass_blok'.*Did you mean: examplemod:brass_block/,
      ),
    });

    const otherMod = compileForRegistry(
      program({}, [
        { box: { do: [{ fill: "stone" }] } },
        { block: { material: "create:brass_block", at: [0, 1, 0] } },
      ]),
      "1.21.4",
      registry,
    );
    expect(otherMod.errors).toContainEqual({
      path: "build[1].block",
      message: expect.stringContaining(
        "unknown block/material 'create:brass_block'",
      ),
    });

    const badState = compileForRegistry(
      program({}, [
        { block: { material: "examplemod:brass_steps[half=middle]" } },
      ]),
      "1.21.4",
      registry,
    );
    expect(badState.errors).toContainEqual({
      path: "build[0].block",
      message: expect.stringContaining(
        "brass_steps state 'half' cannot be 'middle'",
      ),
    });
  });

  it("keeps family:variant materials", async () => {
    const built = compileForRegistry(
      program({ roof: "oak:stairs" }, [
        { block: { material: "@roof", at: [0, 0, 0] } },
      ]),
      "1.21.4",
      await packRegistry(),
    );
    expect(built.errors).toEqual([]);
    expect(stateAt(built.projection!, [0, 0, 0])?.id).toBe(
      "minecraft:oak_stairs",
    );
  });

  it("gives mod stairs corner shapes and joins mod fences", async () => {
    const built = compileForRegistry(
      program({}, [
        // An L of stairs, as in the vanilla postprocess test.
        {
          box: {
            size: [3, 1, 1],
            do: [
              { fill: { material: "examplemod:brass_steps", facing: "-z" } },
            ],
          },
        },
        {
          box: {
            at: [0, 0, 1],
            size: [1, 1, 2],
            do: [
              { fill: { material: "examplemod:brass_steps", facing: "-x" } },
            ],
          },
        },
        {
          box: {
            at: [0, 1, 0],
            size: [3, 1, 1],
            do: [{ fill: "examplemod:brass_railing" }],
          },
        },
      ]),
      "1.21.4",
      await packRegistry(),
    );
    expect(built.errors).toEqual([]);
    const projection = built.projection!;
    expect(stateAt(projection, [0, 0, 0])?.properties.shape).toBe("inner_left");
    expect(stateAt(projection, [1, 0, 0])?.properties.shape).toBe("straight");
    expect(stateAt(projection, [1, 1, 0])?.properties).toMatchObject({
      east: "true",
      west: "true",
      north: "false",
      south: "false",
    });
  });

  it("without a modpack, mod ids are rejected as before", async () => {
    const built = await compileProgram(
      program({ body: "examplemod:brass_block" }, [
        { box: { do: [{ fill: "@body" }] } },
      ]),
      "1.21.4",
      { fetch: fetchStub },
    );
    expect(built.errors).toContainEqual({
      path: "palette.body",
      message: expect.stringContaining("unknown variant 'brass_block'"),
    });
  });
});

describe("compile_build and check_build with a modpack", () => {
  const modded = program({ body: "examplemod:brass_block" }, [
    { box: { size: [2, 2, 2], do: [{ fill: "@body" }] } },
  ]);

  it("compile_build accepts the pack's mod blocks", async () => {
    const result = await runTool(
      compileBuildTool,
      {
        program: modded,
        version: "1.21.4",
        modpack: "test-pack",
        render: false,
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      valid: true,
      errors: 0,
      block_count: 8,
    });
  });

  it("check_build reports a block the pack lacks at its path", async () => {
    const result = await runTool(
      checkBuildTool,
      {
        program: program({ body: "examplemod:copper_block" }, [
          { box: { do: [{ fill: "@body" }] } },
        ]),
        version: "1.21.4",
        modpack: "test-pack",
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ errors: 1 });
    expect(texts(result)[0]).toMatch(
      /palette\.body.*unknown block\/material 'examplemod:copper_block'/,
    );
  });
});

describe("generate_shape materials with a modpack", () => {
  const shape = (material: string, modpack?: string) =>
    runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 1,
        height: 1,
        depth: 1,
        material,
        version: "1.21.4",
        output_format: "Sponge[v2]",
        ...(modpack && { modpack }),
      },
      makeDeps(),
    );

  it("accepts a mod block of the pack with valid states", async () => {
    const result = await shape(
      "examplemod:brass_steps[facing=east]",
      "test-pack",
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      block_state: "examplemod:brass_steps[facing=east]",
    });
  });

  it("rejects a mod block the pack lacks, naming close pack ids", async () => {
    const result = await shape("examplemod:brass_blocks", "test-pack");
    expect(result.isError).toBe(true);
    expect(texts(result)[0]).toMatch(
      /Unknown block "examplemod:brass_blocks" in modpack 'test-pack'.*Did you mean: examplemod:brass_block/,
    );
  });

  it("rejects a state the mod block doesn't have", async () => {
    const result = await shape(
      "examplemod:brass_steps[facing=up]",
      "test-pack",
    );
    expect(result.isError).toBe(true);
    expect(texts(result)[0]).toContain('property "facing" cannot be "up"');
  });

  it("without a modpack, writes mod ids as typed", async () => {
    const result = await shape("create:brass_stairs[facing=up]");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      block_state: "create:brass_stairs[facing=up]",
    });
  });
});
