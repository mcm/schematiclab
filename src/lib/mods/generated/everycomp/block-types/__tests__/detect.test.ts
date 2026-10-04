// Block-type detection against a synthetic world: hand-written block and
// item ids in the shape of the mods' registries; no mod assets are read.

import { describe, expect, it } from "vitest";

import {
  detectBlockTypes,
  mainChildKey,
  typeNameOf,
  vanillaBlockTypeIds,
} from "../detect";
import { javaHashMapOrder } from "../java-compat";
import type {
  BlockTypeChild,
  BlockTypeKind,
  BlockTypeRegistries,
  BlockTypeWorld,
  DetectedBlockType,
} from "../types";

const TREES = [
  "oak",
  "spruce",
  "birch",
  "jungle",
  "acacia",
  "cherry",
  "dark_oak",
  "mangrove",
];

/** Enough of vanilla 1.21.1 for the vanilla types and their children. */
function vanillaBlocks(): string[] {
  const out: string[] = [];
  for (const w of TREES) {
    out.push(
      `${w}_planks`,
      `${w}_log`,
      `${w}_wood`,
      `stripped_${w}_log`,
      `stripped_${w}_wood`,
      `${w}_leaves`,
      `${w}_slab`,
      `${w}_stairs`,
      `${w}_fence`,
      `${w}_fence_gate`,
      `${w}_door`,
      `${w}_trapdoor`,
      `${w}_button`,
      `${w}_pressure_plate`,
      `${w}_sign`,
      `${w}_wall_sign`,
      `${w}_hanging_sign`,
      `${w}_wall_hanging_sign`,
      w === "mangrove" ? "mangrove_propagule" : `${w}_sapling`,
    );
  }
  out.push(
    "bamboo_planks",
    "bamboo_block",
    "stripped_bamboo_block",
    "bamboo_sapling",
    "bamboo_slab",
    "azalea_leaves",
    "flowering_azalea_leaves",
  );
  for (const n of ["crimson", "warped"]) {
    out.push(
      `${n}_planks`,
      `${n}_stem`,
      `${n}_hyphae`,
      `stripped_${n}_stem`,
      `stripped_${n}_hyphae`,
    );
  }
  out.push(
    "stone",
    "stone_stairs",
    "stone_slab",
    "stone_button",
    "stone_pressure_plate",
    "smooth_stone",
    "smooth_stone_slab",
    "stone_bricks",
    "stone_brick_stairs",
    "stone_brick_slab",
    "stone_brick_wall",
    "cracked_stone_bricks",
    "mossy_stone_bricks",
    "mossy_stone_brick_slab",
    "mossy_stone_brick_stairs",
    "mossy_stone_brick_wall",
    "cobblestone",
    "andesite",
    "polished_andesite",
    "granite",
    "polished_granite",
    "diorite",
    "polished_diorite",
    "tuff",
    "tuff_bricks",
    "calcite",
    "blackstone",
    "sandstone",
    "deepslate",
    "deepslate_bricks",
    "end_stone",
    "end_stone_bricks",
    "prismarine",
    "prismarine_bricks",
    "mud",
    "mud_bricks",
    "mud_brick_stairs",
    "packed_mud",
    "amethyst_block",
    "amethyst_cluster",
    "budding_amethyst",
    "redstone_block",
    "redstone_ore",
    "redstone_wire",
    "iron_block",
    "iron_bars",
    "iron_trapdoor",
    "gold_block",
    "copper_block",
    "netherite_block",
    "emerald_block",
    "emerald_ore",
    "diamond_block",
    "diamond_ore",
    "lapis_block",
    "quartz_block",
    "quartz_stairs",
    "quartz_slab",
    "smooth_quartz",
    "coal_block",
    "coal_ore",
  );
  return out.map((b) => `minecraft:${b}`);
}

const VANILLA_ITEMS = [
  ...TREES.flatMap((w) => [`${w}_boat`, `${w}_chest_boat`]),
  "bamboo_raft",
  "bamboo_chest_raft",
  "amethyst_shard",
  "redstone",
  "iron_ingot",
  "iron_nugget",
  "gold_ingot",
  "gold_nugget",
  "copper_ingot",
  "netherite_ingot",
  "emerald",
  "diamond",
  "quartz",
  "lapis_lazuli",
  "coal",
].map((i) => `minecraft:${i}`);

interface WorldSpec {
  blocks?: string[];
  items?: string[];
  /** Extra loaded namespaces (block namespaces are always loaded). */
  mods?: string[];
  blockstates?: Record<string, unknown>;
  models?: Record<string, unknown>;
}

function world(spec: WorldSpec = {}): BlockTypeWorld {
  const blockIds = [...vanillaBlocks(), ...(spec.blocks ?? [])];
  const blocks = new Set(blockIds);
  const items = new Set([...blockIds, ...VANILLA_ITEMS, ...(spec.items ?? [])]);
  const mods = new Set([
    ...blockIds.map((b) => b.split(":")[0]),
    ...(spec.items ?? []).map((i) => i.split(":")[0]),
    ...(spec.mods ?? []),
  ]);
  return {
    blockIds,
    hasBlock: (id) => blocks.has(id),
    hasItem: (id) => items.has(id),
    isModLoaded: (ns) => mods.has(ns),
    blockstate: (id) => spec.blockstates?.[id],
    model: (id) => spec.models?.[id],
  };
}

function type(
  r: BlockTypeRegistries,
  kind: BlockTypeKind,
  id: string,
): DetectedBlockType {
  const t = r.byKind.get(kind)?.get(id);
  if (!t) throw new Error(`no ${kind} type ${id}`);
  return t;
}

const has = (r: BlockTypeRegistries, kind: BlockTypeKind, id: string) =>
  r.byKind.get(kind)?.has(id) ?? false;

function children(t: DetectedBlockType): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of t.children) out[k] = childLabel(v);
  return out;
}

const childLabel = (c: BlockTypeChild) => (c.item ? `item ${c.id}` : c.id);

describe("helpers", () => {
  it("typeNameOf takes the path after the last slash", () => {
    expect(typeNameOf("tfc:wood/maple")).toBe("maple");
    expect(typeNameOf("biomesoplenty:fir")).toBe("fir");
    expect(typeNameOf("oak")).toBe("oak");
  });

  it("mainChildKey follows each type's mainChild()", () => {
    expect(mainChildKey("wood")).toBe("planks");
    expect(mainChildKey("leaves")).toBe("leaves");
    for (const k of ["stone", "mud", "gem", "metal", "crystal", "dust"]) {
      expect(mainChildKey(k as BlockTypeKind)).toBe("block");
    }
  });

  it("vanillaBlockTypeIds lists the vanilla types, default first", () => {
    expect(vanillaBlockTypeIds("wood")).toEqual([
      ...TREES.map((w) => `minecraft:${w}`),
      "minecraft:bamboo",
      "minecraft:crimson",
      "minecraft:warped",
    ]);
    expect(vanillaBlockTypeIds("leaves")).toHaveLength(8);
    expect(vanillaBlockTypeIds("stone")[0]).toBe("minecraft:stone");
    expect(vanillaBlockTypeIds("mud")).toEqual(["minecraft:mud"]);
    expect(vanillaBlockTypeIds("gem")[0]).toBe("minecraft:emerald");
    expect(vanillaBlockTypeIds("metal")[0]).toBe("minecraft:iron");
    expect(vanillaBlockTypeIds("crystal")).toEqual(["minecraft:amethyst"]);
    expect(vanillaBlockTypeIds("dust")).toEqual(["minecraft:redstone"]);
  });

  it("javaHashMapOrder matches java.util.HashMap iteration", () => {
    // Checked against java 21 HashMap.keySet().
    const order = (keys: string[]) =>
      javaHashMapOrder(keys.map((k) => [k, 0] as const)).map(([k]) => k);
    expect(order(["stripped_log", "wood", "stripped_wood"])).toEqual([
      "stripped_log",
      "stripped_wood",
      "wood",
    ]);
    expect(
      order(["slab", "stairs", "polished", "polished_stairs", "polished_wall"]),
    ).toEqual([
      "polished",
      "polished_wall",
      "stairs",
      "polished_stairs",
      "slab",
    ]);
  });
});

describe("vanilla types", () => {
  const r = detectBlockTypes(world());

  it("registers vanilla types first, in registration order", () => {
    expect([...r.byKind.get("wood")!.keys()].slice(0, 11)).toEqual(
      vanillaBlockTypeIds("wood"),
    );
    expect([...r.byKind.get("leaves")!.keys()]).toEqual([
      ...vanillaBlockTypeIds("leaves"),
      "minecraft:azalea",
      "minecraft:flowering_azalea",
    ]);
  });

  it("processes registries by priority (addons 110, wood 100, leaves 99)", () => {
    expect([...r.byKind.keys()]).toEqual([
      "stone",
      "mud",
      "crystal",
      "dust",
      "metal",
      "gem",
      "wood",
      "leaves",
    ]);
  });

  it("fills oak's children", () => {
    expect(children(type(r, "wood", "minecraft:oak"))).toEqual({
      planks: "minecraft:oak_planks",
      log: "minecraft:oak_log",
      leaves: "minecraft:oak_leaves",
      wood: "minecraft:oak_wood",
      stripped_log: "minecraft:stripped_oak_log",
      stripped_wood: "minecraft:stripped_oak_wood",
      slab: "minecraft:oak_slab",
      stairs: "minecraft:oak_stairs",
      fence: "minecraft:oak_fence",
      fence_gate: "minecraft:oak_fence_gate",
      door: "minecraft:oak_door",
      trapdoor: "minecraft:oak_trapdoor",
      button: "minecraft:oak_button",
      pressure_plate: "minecraft:oak_pressure_plate",
      hanging_sign: "minecraft:oak_hanging_sign",
      wall_hanging_sign: "minecraft:oak_wall_hanging_sign",
      sign: "minecraft:oak_sign",
      wall_sign: "minecraft:oak_wall_sign",
      boat: "item minecraft:oak_boat",
      chest_boat: "item minecraft:oak_chest_boat",
      sapling: "item minecraft:oak_sapling",
    });
    expect(type(r, "wood", "minecraft:oak").bambooLike).toBe(false);
  });

  it("keeps the static sapling children of mangrove and bamboo", () => {
    const mangrove = type(r, "wood", "minecraft:mangrove");
    expect([...mangrove.children.keys()][0]).toBe("sapling");
    expect(mangrove.children.get("sapling")).toEqual({
      id: "minecraft:mangrove_propagule",
    });
    const bamboo = type(r, "wood", "minecraft:bamboo");
    // bamboo_sapling has no item, so the item lookup cannot replace it.
    expect(bamboo.children.get("sapling")).toEqual({
      id: "minecraft:bamboo_sapling",
    });
    expect(bamboo.bambooLike).toBe(true);
    expect(childLabel(bamboo.children.get("boat")!)).toBe(
      "item minecraft:bamboo_raft",
    );
    expect(childLabel(bamboo.children.get("chest_boat")!)).toBe(
      "item minecraft:bamboo_chest_raft",
    );
    expect(bamboo.children.get("stripped_log")?.id).toBe(
      "minecraft:stripped_bamboo_block",
    );
    expect(bamboo.children.has("wood")).toBe(false);
  });

  it("finds stems and hyphae for nether woods", () => {
    const c = children(type(r, "wood", "minecraft:crimson"));
    expect(c.log).toBe("minecraft:crimson_stem");
    expect(c.wood).toBe("minecraft:crimson_hyphae");
    expect(c.stripped_log).toBe("minecraft:stripped_crimson_stem");
    expect(c.stripped_wood).toBe("minecraft:stripped_crimson_hyphae");
  });

  it("links vanilla leaves to vanilla woods; azalea has no wood", () => {
    expect(r.leavesToWood.get("minecraft:oak")).toBe("minecraft:oak");
    expect(r.leavesToWood.get("minecraft:dark_oak")).toBe("minecraft:dark_oak");
    expect(r.leavesToWood.has("minecraft:azalea")).toBe(false);
    expect(children(type(r, "leaves", "minecraft:oak"))).toEqual({
      leaves: "minecraft:oak_leaves",
      log: "minecraft:oak_log",
      sapling: "minecraft:oak_sapling",
    });
  });

  it("detects the extra vanilla stones and not mud as a stone", () => {
    expect([...r.byKind.get("stone")!.keys()]).toEqual([
      ...vanillaBlockTypeIds("stone"),
      "minecraft:diorite",
      "minecraft:end_stone",
      "minecraft:prismarine",
    ]);
    const stone = children(type(r, "stone", "minecraft:stone"));
    expect(stone).toMatchObject({
      block: "minecraft:stone",
      stairs: "minecraft:stone_stairs",
      smooth: "minecraft:smooth_stone",
      smooth_slab: "minecraft:smooth_stone_slab",
      bricks: "minecraft:stone_bricks",
      brick_stairs: "minecraft:stone_brick_stairs",
      cracked_bricks: "minecraft:cracked_stone_bricks",
      mossy_bricks: "minecraft:mossy_stone_bricks",
      mossy_brick_slab: "minecraft:mossy_stone_brick_slab",
    });
    // The "cobblestone" special case for minecraft:stone is unreachable.
    expect(stone.cobblestone).toBeUndefined();
  });

  it("fills vanilla mud", () => {
    expect(children(type(r, "mud", "minecraft:mud"))).toEqual({
      block: "minecraft:mud",
      bricks: "minecraft:mud_bricks",
      brick_stairs: "minecraft:mud_brick_stairs",
      packed: "minecraft:packed_mud",
    });
  });

  it("detects netherite as a metal and blacklists coal/redstone gems", () => {
    expect([...r.byKind.get("metal")!.keys()]).toEqual([
      "minecraft:iron",
      "minecraft:gold",
      "minecraft:copper",
      "minecraft:netherite",
    ]);
    expect(children(type(r, "metal", "minecraft:iron"))).toEqual({
      block: "minecraft:iron_block",
      trapdoor: "minecraft:iron_trapdoor",
      bars: "minecraft:iron_bars",
      ingot: "item minecraft:iron_ingot",
      nugget: "item minecraft:iron_nugget",
    });
    expect([...r.byKind.get("gem")!.keys()]).toEqual(
      vanillaBlockTypeIds("gem"),
    );
    expect(children(type(r, "gem", "minecraft:quartz"))).toMatchObject({
      block: "minecraft:quartz_block",
      stairs: "minecraft:quartz_stairs",
      slab: "minecraft:quartz_slab",
      smooth: "minecraft:smooth_quartz",
      gem: "item minecraft:quartz",
    });
    expect(children(type(r, "crystal", "minecraft:amethyst"))).toEqual({
      cluster: "minecraft:amethyst_cluster",
      budding: "minecraft:budding_amethyst",
      block: "minecraft:amethyst_block",
      shard: "item minecraft:amethyst_shard",
    });
    expect(children(type(r, "dust", "minecraft:redstone"))).toEqual({
      block: "minecraft:redstone_block",
    });
  });
});

describe("wood and leaves detection", () => {
  const bop = (p: string) => `biomesoplenty:${p}`;
  const r = detectBlockTypes(
    world({
      blocks: [
        ...[
          "fir_planks",
          "fir_log",
          "fir_wood",
          "stripped_fir_log",
          "stripped_fir_wood",
          "fir_leaves",
          "fir_slab",
          "fir_stairs",
          "fir_door",
          "fir_sapling",
          "origin_leaves",
          "hanging_fir_leaves",
        ].map(bop),
        "mymod:glow_planks",
        "mymod:glow_stem",
        "mymod:glow_hyphae",
        "mymod:stripped_glow_stem",
        "mymod:planks_cedar",
        "mymod:cedar_log",
        "mymod:big_dark_oak_leaves",
        "mymod:pile_leaves",
        "mymod:slabby_planks",
        "mymod:slabby_log",
        "mymod:busy_planks",
        "mymod:busy_log",
        "othermod:fir_leaves",
        "chipped:teak_planks",
        "chipped:teak_log",
      ],
      items: [bop("fir_boat"), bop("fir_chest_boat")],
      blockstates: {
        "mymod:pile_leaves": {
          variants: { "layers=1": { model: "mymod:block/pile" } },
        },
        "mymod:slabby_planks": {
          variants: {
            "type=bottom": { model: "mymod:block/slabby" },
            "type=top": { model: "mymod:block/slabby_top" },
          },
        },
        "mymod:busy_planks": {
          variants: { "a=1,b=1,c=1": { model: "mymod:block/busy" } },
        },
      },
    }),
  );

  it("detects a BOP-like wood with its children", () => {
    const fir = type(r, "wood", bop("fir"));
    expect(children(fir)).toEqual({
      planks: bop("fir_planks"),
      log: bop("fir_log"),
      leaves: bop("fir_leaves"),
      wood: bop("fir_wood"),
      stripped_log: bop("stripped_fir_log"),
      stripped_wood: bop("stripped_fir_wood"),
      slab: bop("fir_slab"),
      stairs: bop("fir_stairs"),
      door: bop("fir_door"),
      boat: `item ${bop("fir_boat")}`,
      chest_boat: `item ${bop("fir_chest_boat")}`,
      sapling: `item ${bop("fir_sapling")}`,
    });
    expect(fir.namespace).toBe("biomesoplenty");
    expect(fir.typeName).toBe("fir");
  });

  it("detects stem woods and planks_ prefixes", () => {
    expect(children(type(r, "wood", "mymod:glow"))).toMatchObject({
      log: "mymod:glow_stem",
      wood: "mymod:glow_hyphae",
      stripped_log: "mymod:stripped_glow_stem",
    });
    expect(type(r, "wood", "mymod:cedar").children.get("planks")?.id).toBe(
      "mymod:planks_cedar",
    );
  });

  it("rejects slabs, blocks with >2 properties and ignored mods", () => {
    expect(has(r, "wood", "mymod:slabby")).toBe(false);
    expect(has(r, "wood", "mymod:busy")).toBe(false);
    expect(has(r, "wood", "chipped:teak")).toBe(false);
  });

  it("detects leaves, skipping hanging_ and non-leaves shapes", () => {
    expect(has(r, "leaves", bop("fir"))).toBe(true);
    expect(has(r, "leaves", bop("hanging_fir"))).toBe(false);
    expect(has(r, "leaves", "mymod:pile")).toBe(false);
    // Leaves use the block registry: the sapling block, not the item.
    expect(children(type(r, "leaves", bop("fir")))).toEqual({
      leaves: bop("fir_leaves"),
      log: bop("fir_log"),
      sapling: bop("fir_sapling"),
    });
  });

  it("links leaves: exact id, mapping, same path, last endsWith match", () => {
    expect(r.leavesToWood.get(bop("fir"))).toBe(bop("fir"));
    expect(r.leavesToWood.get(bop("origin"))).toBe("minecraft:oak");
    expect(r.leavesToWood.get("othermod:fir")).toBe(bop("fir"));
    expect(r.leavesToWood.get("mymod:big_dark_oak")).toBe("minecraft:dark_oak");
  });

  it("computes leaves LOG before the leaves → wood link", () => {
    // big_dark_oak links to minecraft:dark_oak but gets no dark oak log.
    expect(type(r, "leaves", "mymod:big_dark_oak").children.has("log")).toBe(
      false,
    );
  });
});

describe("wood finders", () => {
  it("builds bamboo-like woods from finders", () => {
    const r = detectBlockTypes(
      world({
        blocks: [
          "abundant_atmosphere:red_bamboo_planks",
          "abundant_atmosphere:red_bamboo_block",
          "abundant_atmosphere:stripped_red_bamboo_block",
          "dungeonsdelight:wormwood_planks",
          "dungeonsdelight:wormroots_block",
        ],
        items: [
          "abundant_atmosphere:red_bamboo_raft",
          "abundant_atmosphere:red_bamboo_boat",
        ],
      }),
    );
    const red = type(r, "wood", "abundant_atmosphere:red_bamboo");
    expect(red.bambooLike).toBe(true);
    expect(children(red)).toMatchObject({
      stripped_log: "abundant_atmosphere:stripped_red_bamboo_block",
      planks: "abundant_atmosphere:red_bamboo_planks",
      log: "abundant_atmosphere:red_bamboo_block",
      boat: "item abundant_atmosphere:red_bamboo_raft",
    });
    // Finder children come first in the BiMap.
    expect([...red.children.keys()][0]).toBe("stripped_log");
    const worm = type(r, "wood", "dungeonsdelight:wormwood");
    expect(worm.bambooLike).toBe(true);
    expect(worm.children.get("log")?.id).toBe(
      "dungeonsdelight:wormroots_block",
    );
  });

  it("adds finder children in HashMap order; one block per key", () => {
    const ne = (p: string) => `nourished_end:${p}`;
    const r = detectBlockTypes(
      world({
        blocks: [
          ne("cerulean_planks"),
          ne("cerulean_stem_thick"),
          ne("cerulean_stem_stripped"),
          ne("cerulean_hyphae"),
        ],
      }),
    );
    const t = type(r, "wood", ne("cerulean"));
    // WOOD and STRIPPED_WOOD both name cerulean_hyphae; HashMap order puts
    // stripped_wood first, so wood never gets it.
    expect(children(t)).toMatchObject({
      stripped_log: ne("cerulean_stem_stripped"),
      stripped_wood: ne("cerulean_hyphae"),
    });
    expect(t.children.has("wood")).toBe(false);
  });

  it("gates finders on loaded mods and their own conditions", () => {
    const blocks = [
      "ars_nouveau:archwood_planks",
      "ars_nouveau:blue_archwood_log",
      "ars_nouveau:blue_archwood_leaves",
    ];
    const r = detectBlockTypes(world({ blocks }));
    expect(
      type(r, "wood", "ars_nouveau:archwood").children.get("leaves")?.id,
    ).toBe("ars_nouveau:blue_archwood_leaves");
    const skipped = detectBlockTypes(
      world({ blocks, mods: ["archwood_good"] }),
    );
    expect(has(skipped, "wood", "ars_nouveau:archwood")).toBe(false);
    // Not loaded at all: no finder types.
    expect(has(r, "wood", "undergarden:ancient_root")).toBe(false);
  });

  it("maps finder leaves through equivalentWood", () => {
    const pc = (p: string) => `pokecube_legends:${p}`;
    const r = detectBlockTypes(
      world({
        blocks: [pc("aged_planks"), pc("aged_log"), pc("dyna_leaves_pink")],
      }),
    );
    expect(type(r, "leaves", pc("dyna_pink")).children.get("leaves")?.id).toBe(
      pc("dyna_leaves_pink"),
    );
    expect(r.leavesToWood.get(pc("dyna_pink"))).toBe(pc("aged"));
  });

  it("switches Aether mappings when Aether Redux is loaded", () => {
    const blocks = [
      "aether:skyroot_planks",
      "aether:skyroot_log",
      "aether:crystal_leaves",
      "aether_redux:crystal_planks",
      "aether_redux:crystal_log",
    ];
    const without = detectBlockTypes(
      world({ blocks: blocks.filter((b) => !b.startsWith("aether_redux")) }),
    );
    expect(without.leavesToWood.get("aether:crystal")).toBe("aether:skyroot");
    const withRedux = detectBlockTypes(world({ blocks }));
    expect(withRedux.leavesToWood.get("aether:crystal")).toBe(
      "aether_redux:crystal",
    );
  });
});

describe("TerraFirmaCraft paths", () => {
  const tfc = (p: string) => `tfc:${p}`;
  const r = detectBlockTypes(
    world({
      blocks: [
        "wood/planks/maple",
        "wood/log/maple",
        "wood/wood/maple",
        "wood/stripped_log/maple",
        "wood/stripped_wood/maple",
        "wood/planks/maple_stairs",
        "wood/planks/maple_slab",
        "wood/leaves/maple",
        "wood/sapling/maple",
        "wood/twig/maple",
        "rock/raw/granite",
        "rock/raw/granite_stairs",
        "rock/bricks/granite",
        "rock/bricks/granite_stairs",
        "rock/cracked_bricks/granite",
        "rock/smooth/granite",
        "metal/block/copper",
      ].map(tfc),
      items: [tfc("metal/ingot/copper")],
    }),
  );

  it("detects TFC woods from wood/planks/<x>", () => {
    expect(children(type(r, "wood", tfc("maple")))).toEqual({
      planks: tfc("wood/planks/maple"),
      log: tfc("wood/log/maple"),
      leaves: tfc("wood/leaves/maple"),
      wood: tfc("wood/wood/maple"),
      stripped_log: tfc("wood/stripped_log/maple"),
      stripped_wood: tfc("wood/stripped_wood/maple"),
      slab: tfc("wood/planks/maple_slab"),
      stairs: tfc("wood/planks/maple_stairs"),
      sapling: `item ${tfc("wood/sapling/maple")}`,
      stick: tfc("wood/twig/maple"),
    });
  });

  it("detects TFC stones from rock/bricks/<x>", () => {
    // As in Java: the `rock/raw/<x><_suffix>` candidate comes before the
    // `rock/<prefix>/<x>` ones, so smooth, cracked bricks and brick stairs
    // resolve to the raw stone / raw stairs, which the BiMap already holds
    // under "block" / "stairs", and are dropped.
    expect(children(type(r, "stone", tfc("granite")))).toEqual({
      block: tfc("rock/raw/granite"),
      stairs: tfc("rock/raw/granite_stairs"),
      bricks: tfc("rock/bricks/granite"),
    });
  });

  it("detects TFC metals from metal/block/<x>", () => {
    expect(children(type(r, "metal", tfc("copper")))).toEqual({
      block: tfc("metal/block/copper"),
      ingot: `item ${tfc("metal/ingot/copper")}`,
    });
  });
});

describe("Stone Zone", () => {
  const m = (p: string) => `mymod:${p}`;
  const r = detectBlockTypes(
    world({
      blocks: [
        ...[
          "marble",
          "marble_bricks",
          "marble_brick_stairs",
          "cracked_marble_bricks",
          "polished_marble",
          "polished_marble_slab",
          "marble_stairs",
          "slate_stone",
          "slate_stone_bricks",
          "cedar",
          "cedar_bricks",
          "cedar_log",
          "basalt_brick",
          "peat_mud",
          "peat_mud_bricks",
          "packed_peat_mud",
        ].map(m),
        "chipped:onyx",
        "chipped:onyx_bricks",
        "quark:shingles",
        "quark:shingles_bricks",
        "create:limestone",
        "marioverse:deep_fungal",
      ],
    }),
  );

  it("detects x_bricks + x stones with their children", () => {
    expect(children(type(r, "stone", m("marble")))).toEqual({
      block: m("marble"),
      stairs: m("marble_stairs"),
      polished: m("polished_marble"),
      polished_slab: m("polished_marble_slab"),
      bricks: m("marble_bricks"),
      brick_stairs: m("marble_brick_stairs"),
      cracked_bricks: m("cracked_marble_bricks"),
    });
  });

  it("handles x_stone_bricks and the x_brick quirk", () => {
    expect(has(r, "stone", m("slate_stone"))).toBe(true);
    // "basalt_brick" loses a char ("basal"), so nothing is found.
    expect(has(r, "stone", m("basalt"))).toBe(false);
    expect(has(r, "stone", m("basal"))).toBe(false);
  });

  it("skips wood-like stones, blacklisted types and mods", () => {
    expect(has(r, "stone", m("cedar"))).toBe(false);
    expect(has(r, "stone", "quark:shingles")).toBe(false);
    expect(has(r, "stone", "chipped:onyx")).toBe(false);
  });

  it("runs stone finders for loaded mods, with their conditions", () => {
    expect(has(r, "stone", "create:limestone")).toBe(true);
    expect(
      type(r, "stone", "marioverse:amethyst").children.get("block")?.id,
    ).toBe("minecraft:amethyst_block");
    const withGr = detectBlockTypes(
      world({ blocks: ["marioverse:deep_fungal"], mods: ["gemsrealm"] }),
    );
    expect(has(withGr, "stone", "marioverse:amethyst")).toBe(false);
  });

  it("detects muds from x_mud_bricks", () => {
    expect(children(type(r, "mud", m("peat_mud")))).toEqual({
      block: m("peat_mud"),
      bricks: m("peat_mud_bricks"),
      packed: m("packed_peat_mud"),
    });
    expect(has(r, "stone", m("peat_mud"))).toBe(false);
  });
});

describe("Gems Realm", () => {
  const m = (p: string) => `mymod:${p}`;
  const base: WorldSpec = {
    blocks: [
      ...[
        "tin_block",
        "tin_bars",
        "ruby_block",
        "ruby_ore",
        "ruby_stairs",
        "jade_block",
        "jade_cluster",
        "budding_jade",
        "sulfur_block",
      ].map(m),
      "gtceu:cobalt_block",
      "betterend:ender_block",
    ],
    items: [
      m("tin_ingot"),
      m("tin_nugget"),
      m("ruby"),
      m("jade_shard"),
      m("sulfur_dust"),
      "gtceu:cobalt_dust",
      "betterend:ender_dust",
    ],
  };
  const r = detectBlockTypes(world(base));

  it("detects a metal with ingot items", () => {
    expect(children(type(r, "metal", m("tin")))).toEqual({
      block: m("tin_block"),
      bars: m("tin_bars"),
      ingot: `item ${m("tin_ingot")}`,
      nugget: `item ${m("tin_nugget")}`,
    });
    expect(has(r, "gem", m("tin"))).toBe(false);
  });

  it("detects a gem with ore and gem item", () => {
    expect(children(type(r, "gem", m("ruby")))).toEqual({
      block: m("ruby_block"),
      stairs: m("ruby_stairs"),
      gem: `item ${m("ruby")}`,
    });
    expect(has(r, "metal", m("ruby"))).toBe(false);
  });

  it("detects a crystal with cluster, budding and shard", () => {
    expect(children(type(r, "crystal", m("jade")))).toEqual({
      cluster: m("jade_cluster"),
      budding: m("budding_jade"),
      block: m("jade_block"),
      shard: `item ${m("jade_shard")}`,
    });
  });

  it("detects a dust; blacklisted dust mods and types are skipped", () => {
    expect(type(r, "dust", m("sulfur")).children.get("block")?.id).toBe(
      m("sulfur_block"),
    );
    expect(has(r, "dust", "gtceu:cobalt")).toBe(false);
    expect(has(r, "dust", "betterend:ender")).toBe(false);
  });

  it("uses techreborn's storage_ infix for every Gems Realm type", () => {
    const tr = detectBlockTypes(
      world({
        ...base,
        blocks: [
          ...base.blocks!,
          "techreborn:peridot_storage_block",
          "techreborn:peridot_storage_stairs",
        ],
        items: [...base.items!, "techreborn:peridot_gem"],
      }),
    );
    expect(children(type(tr, "gem", "techreborn:peridot"))).toEqual({
      block: "techreborn:peridot_storage_block",
      stairs: "techreborn:peridot_storage_stairs",
    });
    // The static infix also hides mymod:ruby_stairs.
    expect(type(tr, "gem", m("ruby")).children.has("stairs")).toBe(false);
  });

  it("runs gem/metal finders for loaded mods", () => {
    const gr = detectBlockTypes(
      world({
        blocks: [
          "more_ores_more_gems:blockof_topaz",
          "architects_palette:sunmetal_block",
        ],
        items: [
          "architects_palette:sunmetal_brick",
          "oreganized:netherite_nugget",
        ],
      }),
    );
    expect(
      type(gr, "gem", "more_ores_more_gems:topaz").children.get("block")?.id,
    ).toBe("more_ores_more_gems:blockof_topaz");
    expect(
      children(type(gr, "metal", "architects_palette:sunmetal")),
    ).toMatchObject({
      block: "architects_palette:sunmetal_block",
      ingot: "item architects_palette:sunmetal_brick",
    });
    // Finders run before detection: the oreganized finder (gated on
    // oreganized being loaded) registers netherite with its nugget first.
    expect(children(type(gr, "metal", "minecraft:netherite"))).toEqual({
      nugget: "item oreganized:netherite_nugget",
      block: "minecraft:netherite_block",
      ingot: "item minecraft:netherite_ingot",
    });
  });
});
