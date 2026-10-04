import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import {
  type BlockRegistry,
  loadBlockRegistry,
} from "../../blockdata/registry";
import { BuildError } from "../errors";
import {
  AIR,
  type Material,
  MaterialResolver,
  hash01,
  isAirMaterial,
  pickEntry,
  validatePlacedState,
} from "../materials";
import type { MaterialSpec } from "../program";

const FIXTURES = path.join(__dirname, "../../blockdata/__tests__/fixtures");
const fixture = (name: string) =>
  readFileSync(path.join(FIXTURES, name), "utf8");
const mcmetaUrl = (version: string, file = "blocks") =>
  `https://cdn.jsdelivr.net/gh/misode/mcmeta@${version}-summary/${file}/data.min.json`;

// Trimmed real mcmeta summaries shared with the registry tests.
const ROUTES: Record<string, string> = {
  [mcmetaUrl("1.21.4")]: fixture("registry-mcmeta-1.21.4-blocks.json"),
  [mcmetaUrl("1.20.1")]: fixture("registry-mcmeta-1.20.1-blocks.json"),
  [mcmetaUrl("1.20.1", "registries")]: fixture(
    "registry-mcmeta-1.20.1-registries.json",
  ),
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

const ids = (m: Material) => m.entries.map((e) => e.id);

function resolveError(
  resolver: MaterialResolver,
  spec: unknown,
  at = "build[0].fill",
  variant?: string,
): BuildError {
  try {
    resolver.resolve(spec, at, variant);
  } catch (e) {
    if (e instanceof BuildError) return e;
    throw e;
  }
  throw new Error(`${JSON.stringify(spec)} resolved`);
}

describe("material forms", () => {
  it("resolves Cairn's roles, families and mix (test_materials_roles_families_mix)", () => {
    const m = new MaterialResolver(r1214, {
      roof: "spruce",
      wall: { mix: { cobblestone: 1, mossy_cobblestone: 1 } },
      trim: "stone_bricks",
    });
    expect(ids(m.resolve("@roof:stairs", "a"))).toEqual([
      "minecraft:spruce_stairs",
    ]);
    expect(ids(m.resolve("@trim:wall", "a"))).toEqual([
      "minecraft:stone_brick_wall",
    ]);
    expect(ids(m.resolve("@roof", "a"))).toEqual(["minecraft:spruce_planks"]);
    expect(ids(m.resolve("spruce:log", "a"))).toEqual(["minecraft:spruce_log"]);

    const wall = m.resolve("@wall", "a");
    const picked = new Set<string>();
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) picked.add(pickEntry(wall, 0, [x, 1, z]).id);
    }
    expect(picked).toEqual(
      new Set(["minecraft:cobblestone", "minecraft:mossy_cobblestone"]),
    );
    expect(m.notes).toEqual([]);
  });

  it("takes block ids with or without a namespace, and with states", () => {
    const m = new MaterialResolver(r1214);
    expect(m.resolve("stone_bricks", "a").entries).toEqual([
      { weight: 1, id: "minecraft:stone_bricks", states: {} },
    ]);
    expect(ids(m.resolve("minecraft:oak_planks", "a"))).toEqual([
      "minecraft:oak_planks",
    ]);
    expect(m.resolve("oak_stairs[facing=out, half=top]", "a").entries).toEqual([
      {
        weight: 1,
        id: "minecraft:oak_stairs",
        states: { facing: "out", half: "top" },
      },
    ]);
    expect(
      m.resolve("minecraft:oak_log[axis=X]", "a").entries[0].states,
    ).toEqual({ axis: "x" });
    expect(m.notes).toEqual([]);
  });

  it("adds a role's use-site states and variant to every entry", () => {
    const m = new MaterialResolver(r1214, {
      wall: { mix: { cobblestone: 3, mossy_stone_bricks: 1 } },
      roof: "spruce",
      cap: "@roof",
    });
    const stairs = m.resolve("@wall:stairs[half=top]", "a");
    expect(stairs.entries).toEqual([
      {
        weight: 3,
        id: "minecraft:cobblestone_stairs",
        states: { half: "top" },
      },
      {
        weight: 1,
        id: "minecraft:mossy_stone_brick_stairs",
        states: { half: "top" },
      },
    ]);
    expect(ids(m.resolve("@cap:slab", "a"))).toEqual(["minecraft:spruce_slab"]);
    // The operation's variant applies when the spec names none.
    expect(ids(m.resolve("@roof", "a", "stairs"))).toEqual([
      "minecraft:spruce_stairs",
    ]);
    // A role that already is the variant asked for stays as it is.
    const n = new MaterialResolver(r1214, { roof: "oak_stairs[half=top]" });
    expect(n.resolve("@roof:stairs", "a").entries).toEqual([
      { weight: 1, id: "minecraft:oak_stairs", states: { half: "top" } },
    ]);
  });

  it("resolves family:variant, and a wood name as its planks", () => {
    const m = new MaterialResolver(r1214, { frame: "cherry" });
    expect(ids(m.resolve("stone_bricks:wall", "a"))).toEqual([
      "minecraft:stone_brick_wall",
    ]);
    expect(ids(m.resolve("spruce:fence_gate", "a"))).toEqual([
      "minecraft:spruce_fence_gate",
    ]);
    expect(ids(m.resolve("spruce:planks", "a"))).toEqual([
      "minecraft:spruce_planks",
    ]);
    expect(ids(m.resolve("spruce:block", "a"))).toEqual([
      "minecraft:spruce_planks",
    ]);
    expect(ids(m.resolve("@frame", "a"))).toEqual(["minecraft:cherry_planks"]);
    expect(ids(m.resolve("@frame:door", "a"))).toEqual([
      "minecraft:cherry_door",
    ]);
    expect(m.notes).toEqual([]);
  });

  it("weights nested mixes by both weights", () => {
    const m = new MaterialResolver(r1214, {
      stone: { mix: { stone: 1, cobblestone: 3 } },
    });
    const mat = m.resolve({ mix: { "@stone": 2, glass: 1, "#": "x" } }, "a");
    expect(mat.entries.map((e) => [e.id, e.weight])).toEqual([
      ["minecraft:stone", 2],
      ["minecraft:cobblestone", 6],
      ["minecraft:glass", 1],
    ]);
  });

  it("resolves air (and its aliases) to air", () => {
    const m = new MaterialResolver(r1214, { gap: "air" });
    expect(isAirMaterial(m.resolve("air", "a"))).toBe(true);
    expect(isAirMaterial(m.resolve("@gap", "a"))).toBe(true);
    expect(ids(m.resolve("empty", "a"))).toEqual([AIR]);
    expect(isAirMaterial(m.resolve("stone", "a"))).toBe(false);
    expect(resolveError(m, "air[waterlogged=true]").message).toMatch(
      /air takes no block states/,
    );
  });
});

describe("fallbacks and repair", () => {
  it("falls back from pale_oak on 1.20.1 and notes it", () => {
    const m = new MaterialResolver(r1201, { wall: "pale_oak", trim: "oak" });
    expect(ids(m.resolve("@wall", "build[0].fill"))).toEqual([
      "minecraft:birch_planks",
    ]);
    expect(ids(m.resolve("@wall:stairs", "build[1].fill"))).toEqual([
      "minecraft:birch_stairs",
    ]);
    expect(ids(m.resolve("pale_oak:door", "build[2].fill"))).toEqual([
      "minecraft:birch_door",
    ]);
    expect(ids(m.resolve("@trim", "build[3].fill"))).toEqual([
      "minecraft:oak_planks",
    ]);
    expect(m.notes).toEqual([
      {
        path: "palette.wall",
        message:
          "'pale_oak' does not exist in Minecraft 1.20.1; used minecraft:birch_planks",
      },
      {
        path: "palette.wall",
        message:
          "'pale_oak' does not exist in Minecraft 1.20.1; used minecraft:birch_stairs",
      },
      {
        path: "build[2].fill",
        message:
          "'pale_oak' does not exist in Minecraft 1.20.1; used minecraft:birch_door",
      },
    ]);
  });

  it("uses pale_oak itself on 1.21.4, without a note", () => {
    const m = new MaterialResolver(r1214, { wall: "pale_oak" });
    expect(ids(m.resolve("@wall", "a"))).toEqual(["minecraft:pale_oak_planks"]);
    expect(ids(m.resolve("@wall:stairs", "a"))).toEqual([
      "minecraft:pale_oak_stairs",
    ]);
    expect(m.notes).toEqual([]);
  });

  it("notes a missing variant's fallback", () => {
    const m = new MaterialResolver(r1214);
    expect(ids(m.resolve("stone_bricks:fence", "build[0].fill"))).toEqual([
      "minecraft:stone_brick_wall",
    ]);
    expect(ids(m.resolve("glass:stairs", "build[1].fill"))).toEqual([
      "minecraft:glass",
    ]);
    expect(m.notes.map((n) => n.path)).toEqual([
      "build[0].fill",
      "build[1].fill",
    ]);
    expect(m.notes[0].message).toMatch(
      /no fence; used minecraft:stone_brick_wall/,
    );
    expect(m.notes[1].message).toMatch(/no stairs; used full block/);
  });

  it("repairs sloppy names and notes the repair", () => {
    const m = new MaterialResolver(r1214, { window: "Glass Panes" });
    expect(ids(m.resolve("@window", "build[0].fill"))).toEqual([
      "minecraft:glass_pane",
    ]);
    expect(ids(m.resolve("stone_brick", "build[1].fill"))).toEqual([
      "minecraft:stone_bricks",
    ]);
    expect(ids(m.resolve("stone_brick:stairs", "build[2].fill"))).toEqual([
      "minecraft:stone_brick_stairs",
    ]);
    expect(m.notes).toEqual([
      {
        path: "palette.window",
        message: "repaired 'Glass Panes' -> 'minecraft:glass_pane'",
      },
      {
        path: "build[1].fill",
        message: "repaired 'stone_brick' -> 'minecraft:stone_bricks'",
      },
    ]);
  });

  it("notes each fallback once", () => {
    const m = new MaterialResolver(r1201);
    m.resolve("pale_oak", "a");
    m.resolve("pale_oak", "a");
    expect(m.notes).toHaveLength(1);
  });
});

describe("errors", () => {
  it("reports unknown names at their path with suggestions", () => {
    const m = new MaterialResolver(r1214, { wall: "stone_brikcs" });
    const e = resolveError(m, "@wall", "build[0].fill");
    expect(e.path).toBe("palette.wall");
    expect(e.message).toBe(
      "unknown block/material 'stone_brikcs' in Minecraft 1.21.4. Did you mean: stone_bricks, stone_brick_slab, mossy_stone_bricks?",
    );
    expect(resolveError(m, "qwertyuiop").message).toBe(
      "unknown block/material 'qwertyuiop' in Minecraft 1.21.4.",
    );
    expect(resolveError(m, "stone_brikcs:stairs").message).toMatch(
      /Did you mean: stone_bricks/,
    );
  });

  it("names the defined roles for an unknown role", () => {
    const m = new MaterialResolver(r1214, { wall: "stone", "#": "comment" });
    const e = resolveError(m, "@roof");
    expect(e.path).toBe("build[0].fill");
    expect(e.message).toBe("palette has no role '@roof'. Defined roles: wall");
    expect(resolveError(m, "@toString").message).toMatch(/no role/);
    expect(resolveError(new MaterialResolver(r1214), "@x").message).toMatch(
      /Defined roles: \(none\)/,
    );
  });

  it("reports circular roles", () => {
    const m = new MaterialResolver(r1214, { a: "@b", b: "@a" });
    expect(resolveError(m, "@a").message).toBe(
      "palette references are circular: @a -> @b -> @a",
    );
  });

  it("rejects unknown variants and unparseable materials", () => {
    const m = new MaterialResolver(r1214);
    expect(resolveError(m, "stone:chiseled").message).toMatch(
      /unknown variant 'chiseled'\. Variants: block, stairs/,
    );
    expect(resolveError(m, "a:b:c").message).toMatch(/cannot parse material/);
    expect(resolveError(m, "oak_stairs[half=top").message).toMatch(
      /cannot parse material/,
    );
    expect(resolveError(m, "oak_stairs[half]").message).toMatch(
      /bad block state "half"/,
    );
    expect(resolveError(m, 42).message).toMatch(/must be a string/);
    expect(resolveError(m, { mix: {} }).message).toBe("empty mix");
    expect(resolveError(m, { mix: { stone: -1 } }).path).toBe(
      "build[0].fill.mix.stone",
    );
  });

  it("validates states for the target version", () => {
    const m = new MaterialResolver(r1214, { roof: "spruce" });
    expect(resolveError(m, "oak_stairs[half=middle]").message).toBe(
      "oak_stairs state 'half' cannot be 'middle'; allowed: top, bottom",
    );
    expect(resolveError(m, "stone[facing=north]").message).toBe(
      "stone has no block states, so 'facing' is not allowed",
    );
    expect(resolveError(m, "@roof:slab[half=top]").message).toMatch(
      /^spruce_slab has no state 'half'; its states are type, waterlogged/,
    );
    expect(resolveError(m, "oak_stairs[facing=sideways]").message).toMatch(
      /'facing' cannot be 'sideways'; allowed: \+x, -x/,
    );
    // Local directions are checked once they are world values.
    expect(
      m.resolve("oak_stairs[facing=in,shape=straight]", "a").entries[0].states,
    ).toEqual({ facing: "in", shape: "straight" });
    expect(m.resolve("oak_log[axis=z]", "a").entries[0].states).toEqual({
      axis: "z",
    });
    // A mix entry with states that don't fit fails at the mix entry.
    const mix: MaterialSpec = { mix: { "stone[axis=x]": 1, cobblestone: 1 } };
    expect(resolveError(m, mix).path).toBe(
      'build[0].fill.mix["stone[axis=x]"]',
    );
  });

  it("validates placed world states", () => {
    expect(
      validatePlacedState(r1214, "minecraft:oak_stairs", {
        facing: "north",
        half: "top",
      }),
    ).toBeNull();
    expect(validatePlacedState(r1214, "minecraft:stone", {})).toBeNull();
    expect(
      validatePlacedState(r1214, "minecraft:oak_stairs", { facing: "up" }),
    ).toMatch(/cannot be "up"/);
  });
});

describe("mix picks", () => {
  const m = () =>
    new MaterialResolver(r1214).resolve(
      { mix: { cobblestone: 3, mossy_cobblestone: 1 } },
      "a",
    );
  const grid = (seed: number) => {
    const mat = m();
    const out: string[] = [];
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) out.push(pickEntry(mat, seed, [x, 0, z]).id);
    }
    return out;
  };

  it("is deterministic from seed and world position", () => {
    expect(grid(7)).toEqual(grid(7));
    expect(pickEntry(m(), 1, [3, 4, 5])).toEqual(pickEntry(m(), 1, [3, 4, 5]));
  });

  it("changes when the seed changes", () => {
    expect(grid(7)).not.toEqual(grid(8));
    expect(grid(0)).not.toEqual(grid(1));
  });

  it("follows the weights", () => {
    const picks = grid(0);
    const mossy = picks.filter((id) => id === "minecraft:mossy_cobblestone");
    // 1 in 4 of 256 cells, give or take.
    expect(mossy.length).toBeGreaterThan(40);
    expect(mossy.length).toBeLessThan(90);
  });

  it("hashes into [0, 1) with documented, stable values", () => {
    // Golden values: a change here changes every mix and choose pick.
    expect(hash01(0, 0, 0, 0)).toBe(0.19301192603965256);
    expect(hash01(42, 1, 2, 3)).toBe(0.9819954405848075);
    expect(hash01(0, 1, 2, 3)).not.toBe(hash01(0, 3, 2, 1));
    expect(hash01("12", 3)).not.toBe(hash01(1, 23));
    for (let i = 0; i < 1000; i++) {
      const h = hash01(i, -i, i * 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});
