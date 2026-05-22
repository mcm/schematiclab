// Per-block specs that tell `scripts/generate-forge-1.12-flatten.mts` how to
// turn each variation in PrismarineJS minecraft-data's pc/1.12/blocks.json
// into a canonical Forge BlockState string.
//
// Why this exists: BG0 (Building Gadgets 1.12) templates serialize blocks as
// Forge's IBlockState NBT — e.g. `minecraft:planks[variant=spruce]`. To bridge
// those into the post-flatten universe we need the same "id:metadata → flat
// state" mapping that legacy.json provides, but keyed by the Forge name+props
// form rather than the bare numeric id.
//
// Per-block decoders fall into a handful of shapes ("kinds"). The shape tells
// codegen how to read the variation's metadata field and produce a property
// map. We bias toward declarative specs so adding a missing block is one line.

export type BlockSpec =
  | { kind: "stateless" }
  | { kind: "variants"; prop: string; values: readonly string[] }
  | {
      kind: "variants_with_stage";
      prop: string;
      values: readonly string[];
      stageProp: string;
    }
  | { kind: "leaves"; variants: readonly string[] }
  | { kind: "double_plant" }
  | { kind: "connected" }
  | { kind: "connected_variant"; prop: string; values: readonly string[] }
  | { kind: "quartz_block" }
  | { kind: "slab"; prop: string; values: readonly string[] }
  | { kind: "double_slab"; prop: string; values: readonly string[] }
  | { kind: "slab_seamless"; prop: string; values: readonly string[] }
  | { kind: "double_slab_seamless"; prop: string; values: readonly string[] }
  | { kind: "log"; variants: readonly string[] }
  | { kind: "stairs" }
  | { kind: "door" }
  | { kind: "trapdoor" }
  | { kind: "fence_gate" }
  | { kind: "facing4" }
  | { kind: "facing4_horizontal" }
  | { kind: "facing6" }
  | { kind: "facing6_powered" }
  | { kind: "torch" }
  | { kind: "piston" }
  | { kind: "piston_head" }
  | { kind: "repeater"; powered: boolean }
  | { kind: "comparator"; powered: boolean }
  | { kind: "int_prop"; prop: string; max: number; base?: number }
  | { kind: "cocoa" }
  | { kind: "end_portal_frame" }
  | { kind: "hopper" }
  | { kind: "rail"; powered: boolean; withDir6: boolean }
  | { kind: "bed" }
  | { kind: "skull" }
  | { kind: "button" }
  | { kind: "lever" }
  | { kind: "pressure_plate" }
  | { kind: "pressure_plate_weighted" }
  | { kind: "tripwire_hook" }
  | { kind: "tripwire" }
  | { kind: "axis_only" }
  | { kind: "anvil" }
  | { kind: "brewing_stand" }
  | { kind: "structure_block" }
  | { kind: "vine" }
  | { kind: "portal" };

/** Codegen looks up this map by mc-data block name. Anything not listed is
 *  treated as `{ kind: "stateless" }` (just the bare name, no properties). */
export const FORGE_1_12_SPECS: Record<string, BlockSpec> = (() => {
  // Wood variant orderings (used by planks, log, leaves, wooden_slab, ...).
  const WOOD4 = ["oak", "spruce", "birch", "jungle"] as const;
  const WOOD6 = [...WOOD4, "acacia", "dark_oak"] as const;
  const WOOD_LOG2 = ["acacia", "dark_oak"] as const;
  const COLORS16 = [
    "white",
    "orange",
    "magenta",
    "light_blue",
    "yellow",
    "lime",
    "pink",
    "gray",
    "silver",
    "cyan",
    "purple",
    "blue",
    "brown",
    "green",
    "red",
    "black",
  ] as const;

  // Stairs share an encoding (facing 0-3 in low bits, half=top at bit 2).
  const stairs: BlockSpec = { kind: "stairs" };

  // Doors share an encoding (lower half: facing+open, upper half: hinge).
  // The lower-half/upper-half disambiguation lives in the codegen template.
  const door: BlockSpec = { kind: "door" };

  // Fence/wall/glass-pane connection state isn't stored in metadata — it's
  // computed at render time. So fences are effectively single-state in 1.12;
  // the Forge string `[east=true,...]` is just runtime-decorative. We map all
  // those forms to the bare metadata 0.
  const connected: BlockSpec = { kind: "connected" };

  return {
    // ── Variant-only blocks ──────────────────────────────────────────────
    stone: {
      kind: "variants",
      prop: "variant",
      values: [
        "stone",
        "granite",
        "smooth_granite",
        "diorite",
        "smooth_diorite",
        "andesite",
        "smooth_andesite",
      ],
    },
    dirt: {
      kind: "variants",
      prop: "variant",
      values: ["dirt", "coarse_dirt", "podzol"],
    },
    sand: { kind: "variants", prop: "variant", values: ["sand", "red_sand"] },
    sapling: {
      kind: "variants_with_stage",
      prop: "type",
      values: [...WOOD6],
      stageProp: "stage",
    }, // bit 3 = stage
    planks: { kind: "variants", prop: "variant", values: [...WOOD6] },
    leaves: { kind: "leaves", variants: [...WOOD4] }, // bits 0-1 variant, bit 2 = decayable=false, bit 3 = check_decay=true
    leaves2: { kind: "leaves", variants: [...WOOD_LOG2] },
    sponge: { kind: "variants", prop: "wet", values: ["false", "true"] },
    sandstone: {
      kind: "variants",
      prop: "type",
      values: ["sandstone", "chiseled_sandstone", "smooth_sandstone"],
    },
    red_sandstone: {
      kind: "variants",
      prop: "type",
      values: [
        "red_sandstone",
        "chiseled_red_sandstone",
        "smooth_red_sandstone",
      ],
    },
    tallgrass: {
      kind: "variants",
      prop: "type",
      values: ["dead_bush", "tall_grass", "fern"],
    },
    wool: { kind: "variants", prop: "color", values: [...COLORS16] },
    yellow_flower: { kind: "stateless" }, // dandelion only — type prop has 1 value
    red_flower: {
      kind: "variants",
      prop: "type",
      values: [
        "poppy",
        "blue_orchid",
        "allium",
        "houstonia",
        "red_tulip",
        "orange_tulip",
        "white_tulip",
        "pink_tulip",
        "oxeye_daisy",
      ],
    },
    double_plant: { kind: "double_plant" }, // low bits = variant, bit 3 = upper half flag
    stained_glass: { kind: "variants", prop: "color", values: [...COLORS16] },
    stained_glass_pane: {
      kind: "variants",
      prop: "color",
      values: [...COLORS16],
    },
    stained_hardened_clay: {
      kind: "variants",
      prop: "color",
      values: [...COLORS16],
    },
    carpet: { kind: "variants", prop: "color", values: [...COLORS16] },
    concrete: { kind: "variants", prop: "color", values: [...COLORS16] },
    concrete_powder: { kind: "variants", prop: "color", values: [...COLORS16] },
    cobblestone_wall: {
      kind: "connected_variant",
      prop: "variant",
      values: ["cobblestone", "mossy_cobblestone"],
    },
    prismarine: {
      kind: "variants",
      prop: "variant",
      values: ["prismarine", "prismarine_bricks", "dark_prismarine"],
    },
    monster_egg: {
      kind: "variants",
      prop: "variant",
      values: [
        "stone",
        "cobblestone",
        "stone_brick",
        "mossy_brick",
        "cracked_brick",
        "chiseled_brick",
      ],
    },
    stonebrick: {
      kind: "variants",
      prop: "variant",
      values: [
        "stonebrick",
        "mossy_stonebrick",
        "cracked_stonebrick",
        "chiseled_stonebrick",
      ],
    },
    quartz_block: { kind: "quartz_block" }, // 0/1 = block/chiseled (no axis), 2-4 = axis y/x/z (lines)

    // ── Slabs (variant + half) ───────────────────────────────────────────
    wooden_slab: { kind: "slab", prop: "variant", values: [...WOOD6] },
    double_wooden_slab: {
      kind: "double_slab",
      prop: "variant",
      values: [...WOOD6],
    },
    stone_slab: {
      kind: "slab_seamless",
      prop: "variant",
      values: [
        "stone",
        "sandstone",
        "wood_old",
        "cobblestone",
        "brick",
        "stone_brick",
        "nether_brick",
        "quartz",
      ],
    },
    double_stone_slab: {
      kind: "double_slab_seamless",
      prop: "variant",
      values: [
        "stone",
        "sandstone",
        "wood_old",
        "cobblestone",
        "brick",
        "stone_brick",
        "nether_brick",
        "quartz",
      ],
    },
    stone_slab2: { kind: "slab", prop: "variant", values: ["red_sandstone"] },
    double_stone_slab2: {
      kind: "double_slab",
      prop: "variant",
      values: ["red_sandstone"],
    },
    purpur_slab: { kind: "slab", prop: "variant", values: ["default"] },
    purpur_double_slab: {
      kind: "double_slab",
      prop: "variant",
      values: ["default"],
    },

    // ── Logs (variant + axis) ────────────────────────────────────────────
    log: { kind: "log", variants: [...WOOD4] }, // ids 0-3 axis=y, 4-7 axis=x, 8-11 axis=z, 12-15 axis=none (bark)
    log2: { kind: "log", variants: [...WOOD_LOG2] },

    // ── Stairs (all share the same metadata encoding) ────────────────────
    oak_stairs: stairs,
    spruce_stairs: stairs,
    birch_stairs: stairs,
    jungle_stairs: stairs,
    acacia_stairs: stairs,
    dark_oak_stairs: stairs,
    stone_stairs: stairs,
    sandstone_stairs: stairs,
    red_sandstone_stairs: stairs,
    brick_stairs: stairs,
    stone_brick_stairs: stairs,
    nether_brick_stairs: stairs,
    quartz_stairs: stairs,
    purpur_stairs: stairs,

    // ── Doors ────────────────────────────────────────────────────────────
    wooden_door: door,
    spruce_door: door,
    birch_door: door,
    jungle_door: door,
    acacia_door: door,
    dark_oak_door: door,
    iron_door: door,

    // ── Trapdoors (facing 0-3 in low bits, open=bit 2, top=bit 3) ────────
    trapdoor: { kind: "trapdoor" },
    iron_trapdoor: { kind: "trapdoor" },

    // ── Fences / walls / panes (connection state computed at runtime) ────
    fence: connected,
    spruce_fence: connected,
    birch_fence: connected,
    jungle_fence: connected,
    acacia_fence: connected,
    dark_oak_fence: connected,
    nether_brick_fence: connected,
    iron_bars: connected,
    glass_pane: connected,

    // ── Gates / buttons / pressure plates ────────────────────────────────
    fence_gate: { kind: "fence_gate" },
    spruce_fence_gate: { kind: "fence_gate" },
    birch_fence_gate: { kind: "fence_gate" },
    jungle_fence_gate: { kind: "fence_gate" },
    acacia_fence_gate: { kind: "fence_gate" },
    dark_oak_fence_gate: { kind: "fence_gate" },

    // ── Single-property facing blocks ────────────────────────────────────
    ladder: { kind: "facing4" }, // 2-5 = N/S/W/E
    wall_sign: { kind: "facing4" }, // 2-5
    chest: { kind: "facing4" }, // 2-5
    trapped_chest: { kind: "facing4" },
    ender_chest: { kind: "facing4" },
    furnace: { kind: "facing4" },
    lit_furnace: { kind: "facing4" },
    pumpkin: { kind: "facing4_horizontal" }, // 0-3 = S/W/N/E
    lit_pumpkin: { kind: "facing4_horizontal" },

    // ── Torches (5 facings) ──────────────────────────────────────────────
    torch: { kind: "torch" },
    redstone_torch: { kind: "torch" },
    unlit_redstone_torch: { kind: "torch" },

    // ── Pistons ──────────────────────────────────────────────────────────
    piston: { kind: "piston" },
    sticky_piston: { kind: "piston" },
    piston_head: { kind: "piston_head" },
    piston_extension: { kind: "piston_head" },

    // ── Repeaters / comparators ──────────────────────────────────────────
    unpowered_repeater: { kind: "repeater", powered: false },
    powered_repeater: { kind: "repeater", powered: true },
    unpowered_comparator: { kind: "comparator", powered: false },
    powered_comparator: { kind: "comparator", powered: true },

    // ── Redstone wire / fire / cake / cocoa ──────────────────────────────
    redstone_wire: { kind: "int_prop", prop: "power", max: 15 },
    fire: { kind: "int_prop", prop: "age", max: 15 },
    cake: { kind: "int_prop", prop: "bites", max: 6 },
    cocoa: { kind: "cocoa" }, // facing in low bits + age in upper bits
    farmland: { kind: "int_prop", prop: "moisture", max: 7 },
    cauldron: { kind: "int_prop", prop: "level", max: 3 },
    water: { kind: "int_prop", prop: "level", max: 15 },
    flowing_water: { kind: "int_prop", prop: "level", max: 15 },
    lava: { kind: "int_prop", prop: "level", max: 15 },
    flowing_lava: { kind: "int_prop", prop: "level", max: 15 },

    // ── Crop ages ────────────────────────────────────────────────────────
    wheat: { kind: "int_prop", prop: "age", max: 7 },
    carrots: { kind: "int_prop", prop: "age", max: 7 },
    potatoes: { kind: "int_prop", prop: "age", max: 7 },
    beetroots: { kind: "int_prop", prop: "age", max: 3 },
    melon_stem: { kind: "int_prop", prop: "age", max: 7 },
    pumpkin_stem: { kind: "int_prop", prop: "age", max: 7 },
    nether_wart: { kind: "int_prop", prop: "age", max: 3 },
    reeds: { kind: "int_prop", prop: "age", max: 15 },
    chorus_flower: { kind: "int_prop", prop: "age", max: 5 },

    // ── Misc directional ─────────────────────────────────────────────────
    end_portal_frame: { kind: "end_portal_frame" }, // facing 0-3 + eye=bit 2
    end_rod: { kind: "facing6" }, // 0-5
    hopper: { kind: "hopper" }, // 0-5 facing + enabled bit
    dropper: { kind: "facing6_powered" }, // 0-5 facing + triggered bit 3
    dispenser: { kind: "facing6_powered" },
    observer: { kind: "facing6_powered" }, // 0-5 facing + powered bit 3
    rail: { kind: "rail", powered: false, withDir6: true },
    golden_rail: { kind: "rail", powered: true, withDir6: false },
    detector_rail: { kind: "rail", powered: true, withDir6: false },
    activator_rail: { kind: "rail", powered: true, withDir6: false },

    // ── Banner / sign (rotation 0-15) ────────────────────────────────────
    standing_banner: { kind: "int_prop", prop: "rotation", max: 15 },
    wall_banner: { kind: "facing4" }, // 2-5
    standing_sign: { kind: "int_prop", prop: "rotation", max: 15 },

    // ── Beds ─────────────────────────────────────────────────────────────
    bed: { kind: "bed" }, // facing in low bits, occupied=bit 2, part=bit 3

    // ── Skulls / heads / flowerpot ───────────────────────────────────────
    skull: { kind: "skull" }, // facing 1-5; nodrop bit 3
    flower_pot: { kind: "stateless" }, // contents in TE in 1.12
    daylight_detector: { kind: "int_prop", prop: "power", max: 15 },
    daylight_detector_inverted: { kind: "int_prop", prop: "power", max: 15 },

    // ── Buttons / levers ─────────────────────────────────────────────────
    stone_button: { kind: "button" },
    wooden_button: { kind: "button" },
    lever: { kind: "lever" },
    stone_pressure_plate: { kind: "pressure_plate" },
    wooden_pressure_plate: { kind: "pressure_plate" },
    light_weighted_pressure_plate: { kind: "pressure_plate_weighted" },
    heavy_weighted_pressure_plate: { kind: "pressure_plate_weighted" },
    tripwire_hook: { kind: "tripwire_hook" },
    tripwire: { kind: "tripwire" },

    // ── Glazed terracotta / hay / bone / muscle ──────────────────────────
    hay_block: { kind: "axis_only" },
    bone_block: { kind: "axis_only" },
    purpur_pillar: { kind: "axis_only" },

    // Glazed terracotta (16 variants × 4 facings).
    white_glazed_terracotta: { kind: "facing4_horizontal" },
    orange_glazed_terracotta: { kind: "facing4_horizontal" },
    magenta_glazed_terracotta: { kind: "facing4_horizontal" },
    light_blue_glazed_terracotta: { kind: "facing4_horizontal" },
    yellow_glazed_terracotta: { kind: "facing4_horizontal" },
    lime_glazed_terracotta: { kind: "facing4_horizontal" },
    pink_glazed_terracotta: { kind: "facing4_horizontal" },
    gray_glazed_terracotta: { kind: "facing4_horizontal" },
    silver_glazed_terracotta: { kind: "facing4_horizontal" },
    cyan_glazed_terracotta: { kind: "facing4_horizontal" },
    purple_glazed_terracotta: { kind: "facing4_horizontal" },
    blue_glazed_terracotta: { kind: "facing4_horizontal" },
    brown_glazed_terracotta: { kind: "facing4_horizontal" },
    green_glazed_terracotta: { kind: "facing4_horizontal" },
    red_glazed_terracotta: { kind: "facing4_horizontal" },
    black_glazed_terracotta: { kind: "facing4_horizontal" },

    // ── Anvil / brewing / cauldron-like ──────────────────────────────────
    anvil: { kind: "anvil" }, // facing in low bits, damage in upper
    brewing_stand: { kind: "brewing_stand" }, // 3 bit flags

    // ── Command block / structure block ──────────────────────────────────
    command_block: { kind: "facing6_powered" },
    repeating_command_block: { kind: "facing6_powered" },
    chain_command_block: { kind: "facing6_powered" },
    structure_block: { kind: "structure_block" },

    // ── Frosted ice ──────────────────────────────────────────────────────
    frosted_ice: { kind: "int_prop", prop: "age", max: 3 },

    // ── Chorus plant (connection state, like fence) ──────────────────────
    chorus_plant: connected,

    // ── Vine (4 connection flags) ────────────────────────────────────────
    vine: { kind: "vine" },

    // ── Snow layer ───────────────────────────────────────────────────────
    snow_layer: { kind: "int_prop", prop: "layers", max: 7, base: 1 },

    // ── Portal / nether portal ───────────────────────────────────────────
    portal: { kind: "portal" },

    // ── Mob spawner (variant in TE, no metadata) ─────────────────────────
    mob_spawner: { kind: "stateless" },
    monster_spawner: { kind: "stateless" },
    noteblock: { kind: "stateless" },
    jukebox: {
      kind: "variants",
      prop: "has_record",
      values: ["false", "true"],
    },
  };
})();
