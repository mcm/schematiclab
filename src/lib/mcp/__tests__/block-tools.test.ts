import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MINECRAFT_DATA_COMMIT,
  clearBlockDataCache,
} from "../../blockdata/load";
import { srgbToOklab } from "../../render/block-appearance";
import {
  MAX_PALETTE_SIZE,
  MAX_SEARCH_LIMIT,
  oklabToHex,
  parseHexColor,
  rankPalette,
  searchBlockIds,
  searchBlocksTool,
  suggestPaletteTool,
} from "../block-tools";
import { vanillaBlockColors } from "../render";
import { createMcpRequestHandler } from "../server";
import { runTool } from "../tools";
import type { McpDeps } from "../types";

const BLOCKDATA_FIXTURES = path.join(
  __dirname,
  "..",
  "..",
  "blockdata",
  "__tests__",
  "fixtures",
);
const fixture = (dir: string, name: string) =>
  readFileSync(path.join(dir, name), "utf8");

const mcmetaUrl = (version: string, file = "blocks") =>
  `https://cdn.jsdelivr.net/gh/misode/mcmeta@${version}-summary/${file}/data.min.json`;

// Trimmed real mcmeta summaries. The 1.21.4 one has every block without
// properties plus every stone, oak, log, glass, andesite and deepslate block.
const ROUTES: Record<string, string> = {
  [mcmetaUrl("1.21.4")]: fixture(
    path.join(__dirname, "fixtures"),
    "palette-mcmeta-1.21.4-blocks.json",
  ),
  [mcmetaUrl("1.20.1")]: fixture(
    BLOCKDATA_FIXTURES,
    "registry-mcmeta-1.20.1-blocks.json",
  ),
  [mcmetaUrl("1.20.1", "registries")]: fixture(
    BLOCKDATA_FIXTURES,
    "registry-mcmeta-1.20.1-registries.json",
  ),
  [`https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-data@${MINECRAFT_DATA_COMMIT}/data/pc/1.13.2/blocks.json`]:
    fixture(BLOCKDATA_FIXTURES, "minecraft-data-1.13.2-blocks.json"),
};

const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const body = ROUTES[String(input)];
  return body === undefined
    ? new Response("not found", { status: 404 })
    : new Response(body, { status: 200 });
});

function makeDeps(): McpDeps {
  return {
    fetch: fetchStub as never,
    now: () => new Date("2026-10-04T12:00:00Z"),
    blob: null,
  };
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

interface SearchData {
  version: string;
  results: { id: string; kind: string }[];
  total_matches: number;
  did_you_mean?: string[];
  note?: string;
}

interface PaletteData {
  version: string;
  target: { hex: string; reference_block?: string };
  blocks: {
    id: string;
    kind: string;
    hex: string;
    distance: number;
    full_cube: boolean;
  }[];
  note?: string;
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

function versionIds(version: string): Set<string> {
  const body = JSON.parse(ROUTES[mcmetaUrl(version)]) as Record<
    string,
    unknown
  >;
  return new Set(Object.keys(body).map((id) => `minecraft:${id}`));
}

beforeEach(() => {
  clearBlockDataCache();
  fetchStub.mockClear();
});

describe("searchBlockIds", () => {
  const ids = [
    "minecraft:stone_bricks",
    "minecraft:stone",
    "minecraft:cobblestone",
    "minecraft:smooth_stone",
    "minecraft:stone_brick_stairs",
    "minecraft:redstone_wire",
    "othermod:stone",
  ];

  it("puts the exact id first, then prefixes, then word starts, then substrings", () => {
    expect(searchBlockIds(ids, "stone")).toEqual([
      "minecraft:stone",
      "minecraft:stone_bricks",
      "minecraft:stone_brick_stairs",
      "minecraft:smooth_stone",
      "minecraft:cobblestone",
      "minecraft:redstone_wire",
    ]);
  });

  it("normalises the query like block names", () => {
    expect(searchBlockIds(ids, "Minecraft:Stone Brick")).toEqual([
      "minecraft:stone_bricks",
      "minecraft:stone_brick_stairs",
    ]);
    expect(searchBlockIds(ids, "  ")).toEqual([]);
  });
});

describe("search_blocks", () => {
  it("returns ids of the version with their kinds, prefix matches first", async () => {
    const data = await search({ query: "oak", version: "1.21.4" });
    expect(data.version).toBe("1.21.4");
    const ids = data.results.map((r) => r.id);
    const firstSubstring = ids.findIndex(
      (id) => !id.startsWith("minecraft:oak"),
    );
    expect(firstSubstring).toBeGreaterThan(0);
    expect(
      ids.slice(firstSubstring).every((id) => !id.startsWith("minecraft:oak")),
    ).toBe(true);
    expect(data.results).toContainEqual({
      id: "minecraft:oak_stairs",
      kind: "stairs",
    });
    expect(data.results).toContainEqual({
      id: "minecraft:oak_log",
      kind: "log",
    });
    expect(data.results).toContainEqual({
      id: "minecraft:oak_slab",
      kind: "slab",
    });
    expect(data.total_matches).toBeGreaterThan(data.results.length);
    expect(data.results).toHaveLength(20);
    const known = versionIds("1.21.4");
    for (const id of ids) expect(known).toContain(id);
  });

  it("only returns blocks the version has", async () => {
    const data = await search({ query: "pale_oak", version: "1.20.1" });
    expect(data.results).toEqual([]);
    expect(data.total_matches).toBe(0);
    const oak = await search({ query: "oak_planks", version: "1.20.1" });
    expect(oak.results.map((r) => r.id)).not.toContain(
      "minecraft:pale_oak_planks",
    );
    expect(oak.results[0]).toEqual({
      id: "minecraft:oak_planks",
      kind: "block",
    });
  });

  it("suggests close names when nothing matches", async () => {
    const data = await search({ query: "stone_brik", version: "1.21.4" });
    expect(data.results).toEqual([]);
    expect(data.did_you_mean).toContain("minecraft:stone_bricks");
  });

  it("honours limit up to 50 and rejects more", async () => {
    const data = await search({
      query: "_",
      version: "1.21.4",
      limit: MAX_SEARCH_LIMIT,
    });
    expect(data.results).toHaveLength(MAX_SEARCH_LIMIT);
    const one = await search({ query: "stone", version: "1.21.4", limit: 1 });
    expect(one.results).toEqual([{ id: "minecraft:stone", kind: "block" }]);
    expect(
      searchBlocksTool.inputSchema.safeParse({
        query: "stone",
        version: "1.21.4",
        limit: MAX_SEARCH_LIMIT + 1,
      }).success,
    ).toBe(false);
  });

  it("notes that 1.12.2 ids are flattened", async () => {
    const data = await search({ query: "granite", version: "1.12.2" });
    expect(data.results.map((r) => r.id)).toContain("minecraft:granite");
    expect(data.note).toMatch(/flattened/);
  });

  it("keeps air in 1.12.2", async () => {
    const data = await search({ query: "air", version: "1.12.2" });
    const ids = data.results.map((r) => r.id);
    expect(ids).toContain("minecraft:air");
    expect(ids).not.toContain("minecraft:cave_air");
  });

  it("leaves blocks added in 1.13 out of 1.12.2", async () => {
    const legacy = await search({ query: "turtle", version: "1.12.2" });
    expect(legacy.results).toEqual([]);
    const modern = await search({ query: "turtle", version: "1.13.1" });
    expect(modern.results.map((r) => r.id)).toEqual(["minecraft:turtle_egg"]);
    const result = await runTool(
      suggestPaletteTool,
      { reference_block: "minecraft:turtle_egg", version: "1.12.2" },
      makeDeps(),
    );
    expect(text(result)).toMatch(
      /^Unknown block "minecraft:turtle_egg" in Minecraft 1\.12\.2\./,
    );
  });

  it("rejects an unknown version without fetching", async () => {
    const result = await runTool(
      searchBlocksTool,
      { query: "stone", version: "1.99" },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "Unknown Minecraft version '1.99'. Call list_versions for the supported versions.",
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("colour helpers", () => {
  it("reads hex colours", () => {
    expect(parseHexColor("#7a7a7a")).toEqual(srgbToOklab(122, 122, 122));
    expect(parseHexColor("7A7A7A")).toEqual(srgbToOklab(122, 122, 122));
    expect(parseHexColor("#fff")).toEqual(srgbToOklab(255, 255, 255));
    expect(() => parseHexColor("grey")).toThrow(
      'Cannot read colour "grey"; expected a hex colour such as #7a7a7a.',
    );
  });

  it("writes OKLab as hex", () => {
    expect(oklabToHex(srgbToOklab(122, 122, 122))).toBe("#7a7a7a");
  });
});

describe("suggest_palette", () => {
  it("ranks blocks by OKLab distance to a colour: #7a7a7a on 1.21.4 includes stone", async () => {
    const data = await palette({
      color: "#7a7a7a",
      version: "1.21.4",
      n: MAX_PALETTE_SIZE,
    });
    expect(data.target).toEqual({ hex: "#7a7a7a" });
    expect(data.blocks).toHaveLength(MAX_PALETTE_SIZE);
    const ids = data.blocks.map((b) => b.id);
    expect(ids).toContain("minecraft:stone");
    const distances = data.blocks.map((b) => b.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));

    const colors = vanillaBlockColors();
    const target = parseHexColor("#7a7a7a");
    const stone = data.blocks.find((b) => b.id === "minecraft:stone")!;
    expect(stone).toMatchObject({ kind: "block", full_cube: true });
    expect(stone.hex).toBe(oklabToHex(colors["minecraft:stone"].oklab));
    expect(stone.distance).toBeCloseTo(
      Math.hypot(
        ...colors["minecraft:stone"].oklab.map((v, i) => v - target[i]),
      ),
      3,
    );

    const known = versionIds("1.21.4");
    for (const id of ids) expect(known).toContain(id);

    const short = await palette({ color: "#7a7a7a", version: "1.21.4" });
    expect(short.blocks).toEqual(data.blocks.slice(0, 8));
  });

  it("lists each colour once, preferring the full cube, and skips infested blocks", async () => {
    const data = await palette({
      color: "#7a7a7a",
      version: "1.21.4",
      n: MAX_PALETTE_SIZE,
    });
    const ids = data.blocks.map((b) => b.id);
    // stone_slab, stone_button and infested_stone share stone's colour.
    expect(ids).not.toContain("minecraft:stone_slab");
    expect(ids).not.toContain("minecraft:stone_button");
    expect(ids.some((id) => id.startsWith("minecraft:infested_"))).toBe(false);
    const hexes = data.blocks.map((b) => b.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("lists colours that round to the same hex once", () => {
    // Two OKLab triples that differ past the hex's precision.
    const grey = srgbToOklab(122, 122, 122);
    const nudged: typeof grey = [grey[0] + 1e-9, grey[1], grey[2]];
    expect(nudged).not.toEqual(grey);
    expect(oklabToHex(nudged)).toBe(oklabToHex(grey));
    const colors = new Map([
      ["minecraft:a", { oklab: grey, fullCube: true }],
      ["minecraft:b", { oklab: nudged, fullCube: true }],
      ["minecraft:c", { oklab: srgbToOklab(0, 0, 0), fullCube: true }],
    ]);
    const registry = { kind: () => "block" } as never;
    const ids = (exclude?: string) =>
      rankPalette(grey, colors as never, registry, { n: 3, exclude }).map(
        (b) => b.id,
      );
    expect(ids()).toEqual(["minecraft:a", "minecraft:c"]);
    expect(ids("minecraft:a")).toEqual(["minecraft:c"]);
  });

  it("keeps to full cubes with full_cube_only and returns at most n", async () => {
    const data = await palette({
      color: "#7a7a7a",
      version: "1.21.4",
      n: MAX_PALETTE_SIZE,
      full_cube_only: true,
    });
    expect(data.blocks).toHaveLength(MAX_PALETTE_SIZE);
    expect(data.blocks.every((b) => b.full_cube)).toBe(true);
    const all = await palette({
      color: "#7a7a7a",
      version: "1.21.4",
      n: MAX_PALETTE_SIZE,
    });
    expect(all.blocks.some((b) => !b.full_cube)).toBe(true);
    expect(
      suggestPaletteTool.inputSchema.safeParse({
        color: "#7a7a7a",
        version: "1.21.4",
        n: MAX_PALETTE_SIZE + 1,
      }).success,
    ).toBe(false);
  });

  it("uses a reference block's colour and leaves out blocks of that colour", async () => {
    const data = await palette({
      reference_block: "minecraft:pale_oak_planks",
      version: "1.21.4",
      n: 3,
    });
    expect(data.target).toEqual({
      hex: oklabToHex(vanillaBlockColors()["minecraft:pale_oak_planks"].oklab),
      reference_block: "minecraft:pale_oak_planks",
    });
    const ids = data.blocks.map((b) => b.id);
    expect(ids).toHaveLength(3);
    for (const same of ["planks", "slab", "stairs"]) {
      expect(ids).not.toContain(`minecraft:pale_oak_${same}`);
    }
    expect(data.blocks[0].distance).toBeGreaterThan(0);
  });

  it("is an error naming the version for a reference block the version lacks", async () => {
    const result = await runTool(
      suggestPaletteTool,
      { reference_block: "minecraft:pale_oak_planks", version: "1.20.1" },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^Unknown block "minecraft:pale_oak_planks" in Minecraft 1\.20\.1\./,
    );
  });

  it("finds colours for ids renamed since the requested version", async () => {
    // 1.20.1's "grass" is 1.20.3's "short_grass".
    const data = await palette({
      reference_block: "grass",
      version: "1.20.1",
      n: 1,
    });
    expect(data.target.reference_block).toBe("minecraft:grass");
    const colors = vanillaBlockColors();
    expect(data.target.hex).toBe(
      oklabToHex(colors["minecraft:short_grass"].oklab),
    );
  });

  it("only suggests blocks of the requested version", async () => {
    const data = await palette({
      reference_block: "minecraft:birch_planks",
      version: "1.20.1",
      n: MAX_PALETTE_SIZE,
    });
    const body = JSON.parse(ROUTES[mcmetaUrl("1.20.1", "registries")]) as {
      block: string[];
    };
    const known = new Set(body.block.map((id) => `minecraft:${id}`));
    for (const block of data.blocks) expect(known).toContain(block.id);
    expect(data.blocks.map((b) => b.id)).not.toContain(
      "minecraft:pale_oak_planks",
    );
  });

  it("needs exactly one of color and reference_block", async () => {
    for (const args of [
      { version: "1.21.4" },
      { version: "1.21.4", color: "#000", reference_block: "stone" },
    ]) {
      const result = await runTool(suggestPaletteTool, args, makeDeps());
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        "Give exactly one of color or reference_block.",
      );
    }
  });

  it("is an error for a block without colour data", async () => {
    const result = await runTool(
      suggestPaletteTool,
      { reference_block: "air", version: "1.21.4" },
      makeDeps(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^minecraft:air has no colour data/);
  });
});

describe("over MCP", () => {
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  it("lists both tools and returns results that pass the SDK's validation", async () => {
    const handler = createMcpRequestHandler(makeDeps());
    const client = new Client({ name: "test", version: "0.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
        fetch: (input, init) => handler(new Request(input, init)),
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["search_blocks", "suggest_palette"]),
    );

    const found = await client.callTool({
      name: "search_blocks",
      arguments: { query: "stone", version: "1.21.4", limit: 3 },
    });
    expect(found.isError).toBeFalsy();
    expect(found.structuredContent).toMatchObject({
      results: [{ id: "minecraft:stone", kind: "block" }, {}, {}],
    });

    const suggested = await client.callTool({
      name: "suggest_palette",
      arguments: { color: "#7a7a7a", version: "1.21.4", n: 4 },
    });
    expect(suggested.isError).toBeFalsy();
    expect(
      (suggested.structuredContent as unknown as PaletteData).blocks,
    ).toHaveLength(4);

    const tooMany = await client.callTool({
      name: "search_blocks",
      arguments: { query: "stone", version: "1.21.4", limit: 51 },
    });
    expect(tooMany.isError).toBe(true);
  });
});
