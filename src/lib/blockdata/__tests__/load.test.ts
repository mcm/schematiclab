import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCK_DATA_TIMEOUT_MS,
  MAX_BLOCK_DATA_BYTES,
  MINECRAFT_DATA_COMMIT,
  clearBlockDataCache,
  loadBlockData,
  parseMcmetaBlocks,
  parseMinecraftDataBlocks,
} from "../load";
import { checkAllBlockData } from "../check";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/known-versions";

const FIXTURES = path.join(__dirname, "fixtures");
const fixture = (name: string) =>
  readFileSync(path.join(FIXTURES, name), "utf8");

const MINECRAFT_DATA = fixture("minecraft-data-1.13.2-blocks.json");
const MCMETA_1_21_4 = fixture("mcmeta-1.21.4-blocks.json");
const MCMETA_1_16_2 = fixture("mcmeta-1.16.2-blocks.json");
const REGISTRIES_1_16_2 = fixture("mcmeta-1.16.2-registries.json");

const MINECRAFT_DATA_URL = `https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-data@${MINECRAFT_DATA_COMMIT}/data/pc/1.13.2/blocks.json`;
const mcmetaUrl = (version: string, file = "blocks") =>
  `https://cdn.jsdelivr.net/gh/misode/mcmeta@${version}-summary/${file}/data.min.json`;

// A fetch stub serving `routes` by URL; anything else is a 404.
function stubFetch(routes: Record<string, string>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = routes[url];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  });
}

beforeEach(() => clearBlockDataCache());
afterEach(() => vi.useRealTimers());

describe("loadBlockData", () => {
  it("loads the exact version's mcmeta summary for 1.14 and later", async () => {
    const fetch = stubFetch({ [mcmetaUrl("1.21.4")]: MCMETA_1_21_4 });
    const data = await loadBlockData("1.21.4", { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe(mcmetaUrl("1.21.4"));
    expect(data.sourceVersion).toBe("1.21.4");
    expect(data.translateOnExport).toBe(false);
    expect(data.blocks.get("minecraft:stone")).toEqual({
      properties: {},
      defaults: {},
    });
    expect(data.blocks.get("minecraft:oak_stairs")).toEqual({
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
    });
    expect(data.blocks.get("minecraft:creaking_heart")?.defaults).toMatchObject(
      { axis: "y" },
    );
    expect(
      [...data.blocks.keys()].every((id) => id.startsWith("minecraft:")),
    ).toBe(true);
  });

  it("fills property-less blocks from the registries when the summary leaves them out", async () => {
    const fetch = stubFetch({
      [mcmetaUrl("1.16.2")]: MCMETA_1_16_2,
      [mcmetaUrl("1.16.2", "registries")]: REGISTRIES_1_16_2,
    });
    const data = await loadBlockData("1.16.2", { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect([...data.blocks.keys()].sort()).toEqual([
      "minecraft:air",
      "minecraft:netherite_block",
      "minecraft:note_block",
      "minecraft:oak_leaves",
      "minecraft:oak_stairs",
      "minecraft:stone",
    ]);
    expect(data.blocks.get("minecraft:netherite_block")).toEqual({
      properties: {},
      defaults: {},
    });
    expect(data.blocks.get("minecraft:oak_leaves")?.defaults).toEqual({
      distance: "7",
      persistent: "false",
    });
  });

  it("loads minecraft-data 1.13.2 at the pinned commit for 1.13.x", async () => {
    const fetch = stubFetch({ [MINECRAFT_DATA_URL]: MINECRAFT_DATA });
    const data = await loadBlockData("1.13.1", { fetch });
    expect(String(fetch.mock.calls[0][0])).toBe(MINECRAFT_DATA_URL);
    expect(data.sourceVersion).toBe("1.13.2");
    expect(data.translateOnExport).toBe(false);
    expect(data.blocks.get("minecraft:air")).toEqual({
      properties: {},
      defaults: {},
    });
    expect(data.blocks.get("minecraft:oak_stairs")?.defaults).toEqual({
      facing: "north",
      half: "bottom",
      shape: "straight",
      waterlogged: "false",
    });
    expect(data.blocks.get("minecraft:note_block")).toEqual({
      properties: {
        instrument: [
          "harp",
          "basedrum",
          "snare",
          "hat",
          "bass",
          "flute",
          "bell",
          "guitar",
          "chime",
          "xylophone",
        ],
        note: Array.from({ length: 25 }, (_, i) => String(i)),
        powered: ["true", "false"],
      },
      defaults: { instrument: "harp", note: "0", powered: "false" },
    });
    expect(data.blocks.get("minecraft:oak_leaves")?.defaults).toEqual({
      distance: "7",
      persistent: "false",
    });
    expect(data.blocks.get("minecraft:redstone_wire")?.defaults).toEqual({
      east: "none",
      north: "none",
      power: "0",
      south: "none",
      west: "none",
    });
    expect(data.blocks.get("minecraft:snow")?.defaults).toEqual({
      layers: "1",
    });
    expect(data.blocks.get("minecraft:turtle_egg")?.defaults).toEqual({
      eggs: "1",
      hatch: "0",
    });
  });

  it("uses 1.13.2 data for 1.12.2 and asks for translation on export", async () => {
    const fetch = stubFetch({ [MINECRAFT_DATA_URL]: MINECRAFT_DATA });
    const data = await loadBlockData("1.12.2", { fetch });
    expect(data.sourceVersion).toBe("1.13.2");
    expect(data.translateOnExport).toBe(true);
    expect(data.blocks.has("minecraft:granite")).toBe(true);
  });

  it.each(["1.14.4", "1.99", "../../evil", "__proto__", "constructor", ""])(
    "rejects %j without fetching",
    async (version) => {
      const fetch = stubFetch({});
      await expect(loadBlockData(version, { fetch })).rejects.toThrow(
        /Unknown Minecraft version/,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("caches per version and shares one in-flight fetch", async () => {
    const fetch = stubFetch({
      [mcmetaUrl("1.21.4")]: MCMETA_1_21_4,
      [MINECRAFT_DATA_URL]: MINECRAFT_DATA,
    });
    const [a, b] = await Promise.all([
      loadBlockData("1.21.4", { fetch }),
      loadBlockData("1.21.4", { fetch }),
    ]);
    expect(a.blocks).toBe(b.blocks);
    await loadBlockData("1.21.4", { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);

    // 1.12.2 and 1.13.1 read the same file once.
    const old = await loadBlockData("1.12.2", { fetch });
    const newer = await loadBlockData("1.13.1", { fetch });
    expect(old.blocks).toBe(newer.blocks);
    expect(old.translateOnExport).toBe(true);
    expect(newer.translateOnExport).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("drops a failed load from the cache so the next call retries", async () => {
    const fetch = stubFetch({});
    await expect(loadBlockData("1.21.4", { fetch })).rejects.toThrow(
      /HTTP 404/,
    );
    const ok = stubFetch({ [mcmetaUrl("1.21.4")]: MCMETA_1_21_4 });
    const data = await loadBlockData("1.21.4", { fetch: ok });
    expect(data.blocks.size).toBeGreaterThan(0);
  });

  it("times out after 10 seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const load = loadBlockData("1.21.4", { fetch });
    const settled = expect(load).rejects.toThrow(/timed out after 10 s/);
    await vi.advanceTimersByTimeAsync(BLOCK_DATA_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await settled;
  });

  it("times out a body that stalls after the headers", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      async () =>
        new Response(new ReadableStream({ start() {} }), { status: 200 }),
    );
    const load = loadBlockData("1.21.4", { fetch });
    const settled = expect(load).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(BLOCK_DATA_TIMEOUT_MS);
    await settled;
  });

  it("rejects a response whose content-length is over 5 MB", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(MAX_BLOCK_DATA_BYTES + 1) },
        }),
    );
    await expect(loadBlockData("1.21.4", { fetch })).rejects.toThrow(
      /over 5 MB/,
    );
  });

  it("rejects a streamed body over 5 MB without a content-length", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let pulled = 0;
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled++;
              controller.enqueue(chunk);
            },
          }),
          { status: 200 },
        ),
    );
    await expect(loadBlockData("1.21.4", { fetch })).rejects.toThrow(
      /over 5 MB/,
    );
    expect(pulled).toBeLessThan(10);
  });

  it("rejects malformed JSON shapes", async () => {
    const fetch = stubFetch({ [mcmetaUrl("1.21.4")]: "[1, 2]" });
    await expect(loadBlockData("1.21.4", { fetch })).rejects.toThrow(
      /Malformed block data/,
    );
  });
});

describe("parsers", () => {
  it("rejects an mcmeta default outside the property's values", () => {
    expect(() =>
      parseMcmetaBlocks({ stone: [{ lit: ["true", "false"] }, { lit: "no" }] }),
    ).toThrow(/no valid default/);
    expect(() => parseMcmetaBlocks({ stone: [{}] })).toThrow(
      /not \[properties, defaults\]/,
    );
  });

  it("keeps namespaced ids as they are", () => {
    const blocks = parseMcmetaBlocks({ "minecraft:stone": [{}, {}] });
    expect([...blocks.keys()]).toEqual(["minecraft:stone"]);
  });

  it("rejects minecraft-data blocks whose state ids don't match their states", () => {
    expect(() =>
      parseMinecraftDataBlocks([
        {
          name: "lever",
          minStateId: 0,
          maxStateId: 2,
          defaultState: 0,
          states: [{ name: "powered", type: "bool", num_values: 2 }],
        },
      ]),
    ).toThrow(/inconsistent state ids/);
    expect(() =>
      parseMinecraftDataBlocks([
        {
          name: "thing",
          minStateId: 0,
          maxStateId: 1,
          defaultState: 0,
          states: [{ name: "kind", type: "enum", num_values: 2 }],
        },
      ]),
    ).toThrow(/no values/);
  });
});

describe("checkAllBlockData", () => {
  it("loads every KNOWN_VERSIONS key and reports the failures", async () => {
    const versions = Object.keys(KNOWN_VERSIONS);
    const routes: Record<string, string> = {
      [MINECRAFT_DATA_URL]: MINECRAFT_DATA,
    };
    for (const version of versions) {
      if (version !== "26.1") routes[mcmetaUrl(version)] = MCMETA_1_21_4;
    }
    const fetch = stubFetch(routes);
    const lines: string[] = [];
    const failures = await checkAllBlockData({ fetch }, (line) =>
      lines.push(line),
    );
    expect(failures).toEqual([{ version: "26.1", error: expect.any(String) }]);
    expect(failures[0].error).toMatch(/HTTP 404/);
    expect(lines).toHaveLength(versions.length);
    expect(lines.filter((l) => l.startsWith("ok "))).toHaveLength(
      versions.length - 1,
    );
    expect(lines).toContainEqual(expect.stringMatching(/^FAIL 26\.1: /));
  });
});
