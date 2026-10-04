import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MINECRAFT_DATA_COMMIT, clearBlockDataCache } from "../load";
import {
  type BlockRegistry,
  loadBlockRegistry,
  normalizeBlockName,
  similarity,
} from "../registry";

const FIXTURES = path.join(__dirname, "fixtures");
const fixture = (name: string) =>
  readFileSync(path.join(FIXTURES, name), "utf8");

const mcmetaUrl = (version: string, file = "blocks") =>
  `https://cdn.jsdelivr.net/gh/misode/mcmeta@${version}-summary/${file}/data.min.json`;

// Trimmed real mcmeta summaries (woods, stone bricks, glass, torches…).
const ROUTES: Record<string, string> = {
  [mcmetaUrl("1.21.4")]: fixture("registry-mcmeta-1.21.4-blocks.json"),
  [mcmetaUrl("1.20.1")]: fixture("registry-mcmeta-1.20.1-blocks.json"),
  [mcmetaUrl("1.20.1", "registries")]: fixture(
    "registry-mcmeta-1.20.1-registries.json",
  ),
  [`https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-data@${MINECRAFT_DATA_COMMIT}/data/pc/1.13.2/blocks.json`]:
    fixture("minecraft-data-1.13.2-blocks.json"),
};

const fetch = vi.fn(async (input: RequestInfo | URL) => {
  const body = ROUTES[String(input)];
  return body === undefined
    ? new Response("not found", { status: 404 })
    : new Response(body, { status: 200 });
});

let r1214: BlockRegistry;
let r1201: BlockRegistry;

beforeAll(async () => {
  clearBlockDataCache();
  r1214 = await loadBlockRegistry("1.21.4", { fetch });
  r1201 = await loadBlockRegistry("1.20.1", { fetch });
});

describe("lookups", () => {
  it("answers exists, properties and defaults with or without a namespace", () => {
    expect(r1214.exists("minecraft:oak_stairs")).toBe(true);
    expect(r1214.exists("oak_stairs")).toBe(true);
    expect(r1214.exists("minecraft:stone")).toBe(true);
    expect(r1214.exists("minecraft:nope")).toBe(false);
    expect(r1214.exists("othermod:oak_stairs")).toBe(false);
    expect(r1201.exists("minecraft:pale_oak_planks")).toBe(false);
    expect(r1201.exists("minecraft:stone")).toBe(true);
    expect(r1214.properties("minecraft:oak_stairs")?.half).toEqual([
      "top",
      "bottom",
    ]);
    expect(r1214.properties("minecraft:stone")).toEqual({});
    expect(r1214.properties("minecraft:nope")).toBeUndefined();
    expect(r1214.defaults("minecraft:oak_stairs")).toEqual({
      facing: "north",
      half: "bottom",
      shape: "straight",
      waterlogged: "false",
    });
    expect(r1214.defaults("minecraft:nope")).toBeUndefined();
  });

  it("labels 1.12.2 with its own version while using 1.13.2 data", async () => {
    const r = await loadBlockRegistry("1.12.2", { fetch });
    expect(r.version).toBe("1.12.2");
    expect(r.exists("minecraft:granite")).toBe(true);
  });
});

describe("validateState", () => {
  it("names the property and its allowed values for a bad value", () => {
    const result = r1214.validateState("minecraft:oak_stairs[facing=up]");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("facing");
    expect(result.error).toContain("north, south, west, east");
    expect(result.error).toContain('"up"');
  });

  it("accepts a valid state and fills in defaults", () => {
    expect(
      r1214.validateState("minecraft:oak_stairs[ half=top , facing=east]"),
    ).toEqual({
      ok: true,
      id: "minecraft:oak_stairs",
      properties: { half: "top", facing: "east" },
      state: {
        facing: "east",
        half: "top",
        shape: "straight",
        waterlogged: "false",
      },
    });
    expect(r1214.validateState("stone")).toEqual({
      ok: true,
      id: "minecraft:stone",
      properties: {},
      state: {},
    });
    expect(r1214.validateState("minecraft:stone[]").ok).toBe(true);
  });

  it("rejects unknown blocks with suggestions", () => {
    const result = r1214.validateState("minecraft:oak_stair");
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Did you mean: minecraft:oak_stairs"),
    });
    expect(r1201.validateState("minecraft:pale_oak_planks")).toEqual({
      ok: false,
      error: expect.stringContaining("in Minecraft 1.20.1"),
    });
    expect(r1214.validateState("othermod:stone").ok).toBe(false);
  });

  it("rejects unknown, repeated and malformed properties", () => {
    const errorOf = (state: string) => {
      const result = r1214.validateState(state);
      return result.ok ? null : result.error;
    };
    expect(errorOf("minecraft:oak_stairs[color=red]")).toMatch(
      /no property "color"; its properties are facing, half, shape, waterlogged/,
    );
    expect(errorOf("minecraft:stone[facing=up]")).toMatch(/no properties/);
    expect(errorOf("minecraft:oak_stairs[half=top,half=bottom]")).toMatch(
      /set twice/,
    );
    expect(errorOf("minecraft:oak_stairs[half]")).toMatch(/Cannot parse/);
    expect(errorOf("minecraft:oak_stairs[half=]")).toMatch(/Cannot parse/);
    expect(errorOf("Oak Stairs")).toMatch(/Cannot parse/);
    expect(errorOf("minecraft:oak_stairs[half=top")).toMatch(/Cannot parse/);
  });
});

describe("kind", () => {
  it.each([
    ["minecraft:stone", "block"],
    ["minecraft:oak_planks", "block"],
    ["minecraft:oak_stairs", "stairs"],
    ["minecraft:stone_brick_slab", "slab"],
    ["minecraft:cobblestone_wall", "wall"],
    ["minecraft:spruce_fence", "fence"],
    ["minecraft:spruce_fence_gate", "fence_gate"],
    ["minecraft:spruce_door", "door"],
    ["minecraft:spruce_trapdoor", "trapdoor"],
    ["minecraft:glass_pane", "pane"],
    ["minecraft:white_stained_glass_pane", "pane"],
    ["minecraft:iron_bars", "pane"],
    ["minecraft:spruce_log", "log"],
    ["minecraft:stripped_spruce_wood", "log"],
    ["minecraft:quartz_pillar", "pillar"],
    ["minecraft:hay_block", "pillar"],
    ["minecraft:basalt", "pillar"],
    ["minecraft:chain", "block"],
    ["minecraft:nether_portal", "block"],
    ["minecraft:oak_button", "button"],
    ["minecraft:stone_pressure_plate", "pressure_plate"],
    ["minecraft:red_bed", "bed"],
    ["minecraft:torch", "torch"],
    ["minecraft:soul_torch", "torch"],
    ["minecraft:redstone_torch", "torch"],
    ["minecraft:wall_torch", "wall_torch"],
    ["minecraft:redstone_wall_torch", "wall_torch"],
    ["minecraft:lantern", "lantern"],
    ["minecraft:soul_lantern", "lantern"],
    ["minecraft:sea_lantern", "block"],
    ["minecraft:jack_o_lantern", "block"],
    ["minecraft:white_carpet", "carpet"],
    ["minecraft:moss_carpet", "carpet"],
    ["minecraft:air", "air"],
    ["minecraft:cave_air", "air"],
    ["minecraft:lever", "lever"],
    ["minecraft:chest", "chest"],
    ["minecraft:oak_sign", "sign"],
    ["minecraft:oak_wall_sign", "sign"],
    ["minecraft:potted_poppy", "pot"],
    ["minecraft:oak_leaves", "leaves"],
    ["minecraft:poppy", "plant"],
    ["minecraft:oak_sapling", "plant"],
    ["minecraft:ladder", "flat"],
    ["minecraft:glass", "glass"],
    ["minecraft:white_stained_glass", "glass"],
  ])("%s is %s", (id, expected) => {
    expect(r1214.kind(id)).toBe(expected);
  });

  it("accepts bare paths", () => {
    expect(r1214.kind("oak_stairs")).toBe("stairs");
  });

  it("finds every kind among the fixture's blocks", () => {
    const kinds = new Set(
      [
        "stone",
        "oak_stairs",
        "oak_slab",
        "cobblestone_wall",
        "oak_fence",
        "oak_fence_gate",
        "oak_door",
        "oak_trapdoor",
        "glass_pane",
        "oak_log",
        "quartz_pillar",
        "oak_button",
        "oak_pressure_plate",
        "red_bed",
        "torch",
        "wall_torch",
        "lantern",
        "white_carpet",
      ].map((id) => {
        expect(r1214.exists(id)).toBe(true);
        return r1214.kind(id);
      }),
    );
    expect(kinds.size).toBe(18);
  });
});

describe("family and variant", () => {
  it("builds a wood family", () => {
    expect(r1214.family("spruce")).toEqual({
      block: "minecraft:spruce_planks",
      log: "minecraft:spruce_log",
      pillar: "minecraft:spruce_log",
      stairs: "minecraft:spruce_stairs",
      slab: "minecraft:spruce_slab",
      fence: "minecraft:spruce_fence",
      fence_gate: "minecraft:spruce_fence_gate",
      door: "minecraft:spruce_door",
      trapdoor: "minecraft:spruce_trapdoor",
      button: "minecraft:spruce_button",
      pressure_plate: "minecraft:spruce_pressure_plate",
    });
  });

  it("builds a stone family from a plural base", () => {
    expect(r1214.family("minecraft:stone_bricks")).toEqual({
      block: "minecraft:stone_bricks",
      stairs: "minecraft:stone_brick_stairs",
      slab: "minecraft:stone_brick_slab",
      wall: "minecraft:stone_brick_wall",
      pillar: "minecraft:chiseled_stone_bricks",
    });
    expect(r1214.family("quartz_block")).toMatchObject({
      block: "minecraft:quartz_block",
      stairs: "minecraft:quartz_stairs",
      pillar: "minecraft:quartz_pillar",
    });
  });

  it("returns an empty family for unknown materials", () => {
    expect(r1214.family("unobtainium")).toEqual({});
    expect(r1201.family("pale_oak")).toEqual({});
  });

  it("resolves variants", () => {
    expect(r1214.variant("spruce", "stairs")).toEqual({
      id: "minecraft:spruce_stairs",
    });
    expect(r1214.variant("spruce", "planks")).toEqual({
      id: "minecraft:spruce_planks",
    });
    expect(r1214.variant("pale_oak", "planks")).toEqual({
      id: "minecraft:pale_oak_planks",
    });
    expect(r1214.variant("stone_bricks", "wall")).toEqual({
      id: "minecraft:stone_brick_wall",
    });
  });

  it("falls back to an older wood with a note when the version lacks it", () => {
    const result = r1201.variant("pale_oak", "planks");
    expect(result?.id).toBe("minecraft:birch_planks");
    expect(result?.note).toMatch(/pale_oak.*1\.20\.1.*minecraft:birch_planks/);
    expect(r1201.variant("pale_oak", "stairs")?.id).toBe(
      "minecraft:birch_stairs",
    );
  });

  it("falls back to a related variant with a note", () => {
    expect(r1214.variant("stone_bricks", "fence")).toEqual({
      id: "minecraft:stone_brick_wall",
      note: "'stone_bricks' has no fence; used minecraft:stone_brick_wall",
    });
    expect(r1214.variant("spruce", "wall")).toEqual({
      id: "minecraft:spruce_fence",
      note: "'spruce' has no wall; used minecraft:spruce_fence",
    });
    expect(r1214.variant("stone_bricks", "door")).toEqual({
      id: "minecraft:stone_bricks",
      note: "'stone_bricks' has no door; used full block minecraft:stone_bricks",
    });
  });

  it("returns null when nothing fits", () => {
    expect(r1214.variant("unobtainium", "stairs")).toBeNull();
    expect(r1214.variant("unobtainium", "block")).toBeNull();
    expect(r1214.variant("spruce", "chimney")).toBeNull();
  });
});

describe("repair", () => {
  it.each([
    ["Glass Panes", "minecraft:glass_pane"],
    ["minecraft:Planks", "minecraft:oak_planks"],
    ["Red Bed", "minecraft:red_bed"],
    ["stone-bricks", "minecraft:stone_bricks"],
    ["Stone Brick", "minecraft:stone_bricks"],
    ["cobble", "minecraft:cobblestone"],
    ["torches", "minecraft:torch"],
    ["leaves", "minecraft:oak_leaves"],
    ["stairs", "minecraft:oak_stairs"],
    ["carpet", "minecraft:white_carpet"],
  ])("repairs %j to %s", (raw, id) => {
    const result = r1214.repair(raw);
    expect(result.id).toBe(id);
    expect("note" in result && result.note).toContain(id);
  });

  it("adds a missing prefix", () => {
    expect(r1214.repair("sapling")).toEqual({
      id: "minecraft:oak_sapling",
      note: "repaired 'sapling' -> 'minecraft:oak_sapling' (missing prefix)",
    });
  });

  it("leaves exact ids without a note", () => {
    expect(r1214.repair("minecraft:glass_pane")).toEqual({
      id: "minecraft:glass_pane",
    });
    expect(r1214.repair("glass_pane")).toEqual({ id: "minecraft:glass_pane" });
  });

  it("prefers a real block over an alias", () => {
    // 1.20.1 still has the `grass` plant (short_grass since 1.20.3).
    expect(r1201.repair("grass").id).toBe("minecraft:grass");
    expect(r1214.repair("grass").id).toBe("minecraft:grass_block");
  });

  it("returns up to 3 suggestions for an unknown name", () => {
    const result = r1214.repair("spruse stares");
    expect(result.id).toBeNull();
    if (result.id !== null) return;
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
    expect(result.suggestions[0]).toBe("minecraft:spruce_stairs");
    expect(r1214.repair("zzzzzzzz")).toEqual({ id: null, suggestions: [] });
  });

  it("doesn't score names too long to match anything", () => {
    // Scoring 8 MB against every path would take minutes (and time out).
    expect(r1214.suggest("spruce_stairs".repeat(600_000))).toEqual([]);
    expect(r1214.suggest("spruse stares")).toContain("minecraft:spruce_stairs");
  });

  it("ignores inherited object keys", () => {
    expect(r1214.repair("__proto__").id).toBeNull();
    expect(r1214.repair("constructor").id).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizes names", () => {
    expect(normalizeBlockName("  Minecraft:Dark Oak-Planks ")).toBe(
      "dark_oak_planks",
    );
  });

  it("matches difflib's ratio", () => {
    // difflib.SequenceMatcher(None, a, b).ratio() values.
    expect(similarity("abcd", "bcde")).toBeCloseTo(0.75);
    expect(similarity("spruse_stares", "spruce_stairs")).toBeCloseTo(
      0.8461538462,
    );
    expect(similarity("", "")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });
});
