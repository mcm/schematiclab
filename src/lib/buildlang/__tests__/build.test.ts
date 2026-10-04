import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBlockDataCache,
  MINECRAFT_DATA_COMMIT,
} from "../../blockdata/load";
import {
  type ParsedSchematicProjection,
  parseSchematic,
  type SchematicFormatId,
  serializeSchematic,
  SUPPORTED_FORMATS,
} from "../../convert";
import { renderProjectionPng } from "../../mcp/render";
import { compileProgram } from "../build";

const FIXTURES = path.join(__dirname, "../../blockdata/__tests__/fixtures");
const MCMETA = "https://cdn.jsdelivr.net/gh/misode/mcmeta";
const RESPONSES: Record<string, string> = {
  [`${MCMETA}@1.21.4-summary/blocks/data.min.json`]:
    "registry-mcmeta-1.21.4-blocks.json",
  [`${MCMETA}@1.20.1-summary/blocks/data.min.json`]:
    "registry-mcmeta-1.20.1-blocks.json",
  [`${MCMETA}@1.20.1-summary/registries/data.min.json`]:
    "registry-mcmeta-1.20.1-registries.json",
  [`${MCMETA}@1.16.2-summary/blocks/data.min.json`]:
    "mcmeta-1.16.2-blocks.json",
  [`${MCMETA}@1.16.2-summary/registries/data.min.json`]:
    "mcmeta-1.16.2-registries.json",
  [`https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-data@${MINECRAFT_DATA_COMMIT}/data/pc/1.13.2/blocks.json`]:
    "minecraft-data-1.13.2-blocks.json",
};
const fetch = vi.fn(async (input: RequestInfo | URL) => {
  const file = RESPONSES[String(input)];
  return file === undefined
    ? new Response("not found", { status: 404 })
    : new Response(readFileSync(path.join(FIXTURES, file), "utf8"), {
        status: 200,
      });
});
const deps = { fetch };

beforeEach(() => clearBlockDataCache());

// A stone floor with an L of stairs on it: the stairs' corner shape is only
// set by post-processing, so it shows the projection holds the final blocks.
const PORCH = {
  name: "porch",
  size: [4, 2, 3],
  palette: { floor: "stone" },
  build: [
    { box: { size: ["~", 1, "~"], do: [{ fill: "@floor" }] } },
    {
      box: {
        at: [0, 1, 0],
        size: [4, 1, 1],
        do: [{ fill: { material: "oak_stairs", facing: "-z" } }],
      },
    },
    {
      box: {
        at: [0, 1, 1],
        size: [1, 1, 2],
        do: [{ fill: { material: "oak_stairs", facing: "-x" } }],
      },
    },
  ],
};

/** Every placement as `x,y,z block-state`, sorted. */
function blockSet(projection: ParsedSchematicProjection): string[] {
  const out: string[] = [];
  for (const region of projection.regions) {
    for (const { pos, paletteIndex } of region.blocks) {
      const [ox, oy, oz] = region.origin;
      const state = projection.palette[paletteIndex].blockState;
      out.push(`${pos[0] - ox},${pos[1] - oy},${pos[2] - oz} ${state}`);
    }
  }
  return out.sort();
}

function exportAndParse(
  projection: ParsedSchematicProjection,
  outputFormat: SchematicFormatId,
  targetVersion: string,
): ParsedSchematicProjection {
  const exported = serializeSchematic({
    schematic: projection,
    inputFilename: projection.name,
    outputFormat,
    targetVersion,
  });
  if (!exported.ok) throw new Error(exported.error);
  const parsed = parseSchematic(exported.bytes);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.schematic;
}

describe("compileProgram", () => {
  it("returns the problems, the projection and the report", async () => {
    const built = await compileProgram(PORCH, "1.21.4", deps);
    expect(built.errors).toEqual([]);
    expect(built.warnings).toEqual([]);
    expect(built.notes).toEqual([]);
    expect(built.report).toMatch(/^# Build report: porch\n/);
    expect(built.report).toContain("blocks placed 18");
    expect(built.analysis?.blockCount).toBe(18);

    const projection = built.projection!;
    expect(projection.name).toBe("porch");
    expect(projection.minecraftVersion.versionNumber).toEqual([1, 21, 4]);
    expect(projection.totalBlocks).toBe(18);
    expect(projection.regions).toHaveLength(1);
    expect(projection.regions[0].origin).toEqual([0, 0, 0]);
    expect(projection.regions[0].size).toEqual([4, 2, 3]);
    expect(projection.regions[0].blockEntities).toEqual([]);
    expect(projection.palette.reduce((n, e) => n + e.count, 0)).toBe(18);
    // Full states, with the corner shape post-processing set.
    expect(blockSet(projection)).toContain(
      "0,1,0 minecraft:oak_stairs[facing=north,half=bottom,shape=inner_left,waterlogged=false]",
    );
    expect(blockSet(projection)).toContain("1,0,1 minecraft:stone");
    const stone = projection.palette.find(
      (e) => e.blockId === "minecraft:stone",
    );
    expect(stone).toMatchObject({ properties: {}, count: 12 });
  });

  it("is deterministic", async () => {
    const a = await compileProgram(PORCH, "1.21.4", deps);
    const b = await compileProgram(PORCH, "1.21.4", deps);
    expect(blockSet(a.projection!)).toEqual(blockSet(b.projection!));
    expect(a.report).toBe(b.report);
  });

  it("reports an invalid program without compiling it", async () => {
    const built = await compileProgram(
      { name: "bad", size: [4, 300, 3], build: [] },
      "1.21.4",
      deps,
    );
    expect(built.projection).toBeNull();
    expect(built.analysis).toBeNull();
    expect(built.errors.map((e) => e.path)).toEqual(["size[1]"]);
    expect(built.report).toContain("# Build report: bad\n");
    expect(built.report).toContain("- size[1]: ");
    const unnamed = await compileProgram(null, "1.21.4", deps);
    expect(unnamed.report).toMatch(/^# Build report: untitled\n/);
  });

  it("keeps what it built when an operation fails", async () => {
    const built = await compileProgram(
      { ...PORCH, build: [...PORCH.build, { fill: "diamond_blok" }] },
      "1.21.4",
      deps,
    );
    expect(built.errors.map((e) => e.path)).toEqual(["build[3].fill"]);
    expect(built.projection?.totalBlocks).toBe(18);
    expect(built.report).toContain("- build[3].fill: ");
  });

  it("throws for a version it has no block data for", async () => {
    await expect(compileProgram(PORCH, "1.99.9", deps)).rejects.toThrow(
      /Unknown Minecraft version/,
    );
  });
});

describe("export", () => {
  it("re-parses Sponge v2 and Litematic exports to the same blocks", async () => {
    const { projection } = await compileProgram(PORCH, "1.21.4", deps);
    const expected = blockSet(projection!);
    for (const format of ["Sponge[v2]", "Litematic"] as const) {
      const parsed = exportAndParse(projection!, format, "1.21.4");
      expect(blockSet(parsed), format).toEqual(expected);
    }
  });

  // Building Gadgets formats only hold their own range of versions.
  const versionFor = (format: SchematicFormatId) =>
    format === "BuildingGadgets[1.12]"
      ? "1.12.2"
      : format === "BuildingGadgets[1.14.4-1.19.3]"
        ? "1.16.2"
        : format === "BuildingGadgets2[1.20+]"
          ? "1.20.1"
          : "1.21.4";

  it.each(SUPPORTED_FORMATS.filter((id) => id !== "JSON"))(
    "writes every block to %s",
    async (format) => {
      const version = versionFor(format);
      const built = await compileProgram(PORCH, version, deps);
      expect(built.errors).toEqual([]);
      const parsed = exportAndParse(built.projection!, format, version);
      // Building Gadgets 1.12 templates keep block ids only.
      const ids = (p: ParsedSchematicProjection) =>
        blockSet(p).map((b) => b.replace(/\[.*\]$/, ""));
      expect(ids(parsed)).toEqual(ids(built.projection!));
    },
  );

  it("writes 1.12.2 builds as Forge 1.12 states through the flatten table", async () => {
    const built = await compileProgram(
      { ...PORCH, palette: { floor: "granite" } },
      "1.12.2",
      deps,
    );
    expect(built.errors).toEqual([]);
    const projection = built.projection!;
    expect(projection.minecraftVersion.versionNumber).toEqual([1, 12, 2]);
    const states = projection.palette.map((e) => e.blockState);
    expect(states).toContain("minecraft:stone[variant=granite]");
    // 1.12 metadata has no stair shape (the game works it out on load), so
    // the corner and the straight north stairs share one palette entry.
    expect(states).toEqual([
      "minecraft:stone[variant=granite]",
      "minecraft:oak_stairs[facing=north,half=bottom,shape=straight]",
      "minecraft:oak_stairs[facing=west,half=bottom,shape=straight]",
    ]);
    expect(projection.palette.map((e) => e.count)).toEqual([12, 4, 2]);
    expect(projection.totalBlocks).toBe(18);
    const parsed = exportAndParse(projection, "Litematic", "1.12.2");
    expect(parsed.minecraftVersion.versionNumber).toEqual([1, 12, 2]);
    expect(blockSet(parsed)).toEqual(blockSet(projection));
  });

  it("drops 1.12.2 blocks with no Forge 1.12 state, with an error at their operation", async () => {
    const built = await compileProgram(
      {
        size: [2, 1, 1],
        build: [
          { block: { at: [0, 0, 0], material: "stone" } },
          { block: { at: [1, 0, 0], material: "turtle_egg" } },
        ],
      },
      "1.12.2",
      deps,
    );
    expect(built.errors).toEqual([
      {
        path: "build[1].block",
        message: expect.stringMatching(/turtle_egg.*no Minecraft 1\.12\.2/),
      },
    ]);
    expect(blockSet(built.projection!)).toEqual([
      "0,0,0 minecraft:stone[variant=stone]",
    ]);
    expect(built.report).toContain("- build[1].block: ");
  });
});

describe("render", () => {
  it("renders the projection as a PNG contact sheet", async () => {
    for (const version of ["1.21.4", "1.12.2"]) {
      const { projection } = await compileProgram(PORCH, version, deps);
      const { png } = renderProjectionPng(projection!, { name: "porch" });
      expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });
});
