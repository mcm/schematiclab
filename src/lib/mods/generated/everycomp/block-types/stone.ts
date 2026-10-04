// Stone and mud type data: vanilla types, child keys, blacklists and
// hardcoded finders.
//
// Port of Stone Zone (by MehVahdJukaar, Xel'Bayria and the Supplementaries
// Team, https://github.com/Xelbayria/Stone-Zone, branch 1.21, commit d17ed21,
// Supplementaries Team License): `VanillaStoneTypes`, `VanillaMudTypes`,
// `VanillaRockChildKeys`, `misc/HardcodedBlockType` (`BLACKLISTED_MODS`,
// `BLACKLISTED_STONETYPES`) and `api/intergration/CompatStoneType`.
//
// Worker-safe: no DOM access.

import { FinderList, type FinderSpec } from "./finder";

/** Stone Zone `VanillaRockChildKeys` (+ `"block"`, the stone / mud itself). */
export const ROCK_KEYS = {
  BLOCK: "block",
  STAIRS: "stairs",
  SLAB: "slab",
  WALL: "wall",
  BUTTON: "button",
  PRESSURE_PLATE: "pressure_plate",
  SMOOTH: "smooth",
  SMOOTH_STAIRS: "smooth_stairs",
  SMOOTH_SLAB: "smooth_slab",
  SMOOTH_WALL: "smooth_wall",
  COBBLESTONE: "cobblestone",
  MOSSY_COBBLESTONE: "mossy_cobblestone",
  POLISHED: "polished",
  POLISHED_STAIRS: "polished_stairs",
  POLISHED_SLAB: "polished_slab",
  POLISHED_WALL: "polished_wall",
  TILES: "tiles",
  TILE_STAIRS: "tile_stairs",
  TILE_SLAB: "tile_slab",
  TILE_WALL: "tile_wall",
  BRICKS: "bricks",
  BRICK_STAIRS: "brick_stairs",
  BRICK_SLAB: "brick_slab",
  BRICK_WALL: "brick_wall",
  CRACKED_BRICKS: "cracked_bricks",
  BRICK_TILES: "brick_tiles",
  MOSSY_BRICKS: "mossy_bricks",
  MOSSY_BRICK_SLAB: "mossy_brick_slab",
  MOSSY_BRICK_STAIRS: "mossy_brick_stairs",
  MOSSY_BRICK_WALL: "mossy_brick_wall",
} as const;

/** `VanillaStoneTypes`, in registration order (STONE is the default type). */
export const VANILLA_STONE_TYPES: readonly { id: string; block: string }[] = [
  "stone",
  "andesite",
  "granite",
  "tuff",
  "calcite",
  "blackstone",
  "sandstone",
  "deepslate",
].map((s) => ({ id: `minecraft:${s}`, block: `minecraft:${s}` }));

/** `VanillaMudTypes`. */
export const VANILLA_MUD_TYPES: readonly { id: string; block: string }[] = [
  { id: "minecraft:mud", block: "minecraft:mud" },
];

/** Stone Zone `HardcodedBlockType.BLACKLISTED_MODS` (stone and mud detection). */
export const SZ_BLACKLISTED_MODS: ReadonlySet<string> = new Set([
  "immersive_weathering",
  "chipped",
  "create_confectionery",
  "rgbblocks",
  "opalescence",
]);

/** Stone Zone `HardcodedBlockType.BLACKLISTED_STONETYPES`. */
export const SZ_BLACKLISTED_STONETYPES: ReadonlySet<string> = new Set([
  // is a terracotta
  "quark:shingles",
  // not a stonetype
  "outer_end:himmel",
  "quark:midori",
  "twigs:silt",
  "supplementaries:ash",
  "blue_skies:brumble",
  "nifty:concrete",
  "blocksyouneed_luna:bluestone",
  "blocksyouneed_luna:scorchcobble",
  "sullysmod:amber",
  "endergetic:eumus",
  "minecraft:mud",
  "enlightened_end:chorloam",
  // shouldn't be detected
  "desire:polished_stone",
  "desire:chiseled_stone",
  "create_dd:cut_stone",
  "stoneexpansion:cut_stone",
  "stoneexpansion:mossy_stone",
  "stoneexpansion:smooth_stone",
  "stoneexpansion:polished_stone",
  "minecraft:infested_stone",
  "ars_nouveau:sconce",
  // white texture only
  "rgbblocks:prismarine",
]);

const R = ROCK_KEYS;
const list = new FinderList();
const s = (ns: string, name: string) => list.add("stone", ns, name);

// Abyssal Decor
s("abyssal_decor", "blood_coral").main("rough_blood_coral");
s("abyssal_decor", "jade").main("rough_jade");

// Ars Nouveau
s("ars_nouveau", "sourcestone")
  .childBlock(R.BRICKS, "sourcestone_large_bricks")
  .childBlock(R.POLISHED, "polished_sconce");

// Koopa's Critters
s("koopascritters", "kopje_granite")
  .mainSuffix("_kc")
  .childBlockSuffix(R.SLAB, "_slab_kc")
  .childBlockSuffix(R.STAIRS, "_kc_stairs")
  .childBlockAffix(R.POLISHED, "polished_", "_kc")
  .childBlockAffix(R.POLISHED_STAIRS, "polished_", "_stairs_kc")
  .childBlockAffix(R.POLISHED_WALL, "polished_", "_wall_kc");

// Pokecube AIO
s("pokecube_legends", "ultra_darkstone").childBlock(
  R.COBBLESTONE,
  "ultra_dark_cobblestone",
);
s("pokecube_legends", "dusk_dolerite").childBlock(
  R.COBBLESTONE,
  "cobbled_dusk_dolerite",
);
s("pokecube_legends", "azure_sandstone");
s("pokecube_legends", "blackened_sandstone");
s("pokecube_legends", "crystallized_sandstone");
s("pokecube_legends", "meteorite").main("meteorite_block");

// Sundries
for (const x of [
  "green_marble",
  "white_marble",
  "pink_granodiorite",
  "black_granite",
  "black_marble",
  "pink_marble",
]) {
  s("sundries", x);
}

// Blocks You Need - Luna
s("blocksyouneed_luna", "sodalite");
s("blocksyouneed_luna", "sunstone")
  .childBlockSuffix(R.BRICKS, "_bricks_ornate")
  .childBlockSuffix(R.BRICK_STAIRS, "_bricks_stairs")
  .childBlockSuffix(R.BRICK_SLAB, "_bricks_slab")
  .childBlockSuffix(R.BRICK_WALL, "_bricks_wall");
s("blocksyouneed_luna", "glance")
  .childBlockSuffix(R.BRICK_STAIRS, "_bricks_stairs")
  .childBlockSuffix(R.BRICK_SLAB, "_bricks_slab")
  .childBlockSuffix(R.BRICK_WALL, "_bricks_wall");

// Marioverse
s("marioverse", "deep_fungal");
s("marioverse", "amethyst")
  .when((loaded) => !loaded("gemsrealm"))
  .main("minecraft:amethyst_block");

// The Twilight Forest
s("twilightforest", "deadrock");
s("twilightforest", "mazestone").childBlockSuffix(R.BRICKS, "_brick");

// Nature's Spirit (kaolin)
for (const c of [
  "white",
  "light_gray",
  "gray",
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "cyan",
  "light_blue",
  "blue",
  "purple",
  "magenta",
  "pink",
]) {
  s("natures_spirit", `${c}_kaolin`);
}

// Galosphere
s("galosphere", "pink_salt");
s("galosphere", "rose_pink_salt");
s("galosphere", "pastel_pink_salt");

// Aerial Hell
s("aerialhell", "dark_lunatic_stone");
s("aerialhell", "slippery_sand_stone");
s("aerialhell", "lunatic_stone");
s("aerialhell", "volucite_stone");
s("aerialhell", "smoky_quartz").mainSuffix("_block");
s("aerialhell", "aerial_netherrack")
  .childBlock(R.BRICKS, "golden_nether_bricks")
  .childBlock(R.BRICK_STAIRS, "golden_nether_bricks_stairs")
  .childBlock(R.BRICK_SLAB, "golden_nether_bricks_slab")
  .childBlock(R.BRICK_WALL, "golden_nether_bricks_wall");

// Rocky Minerals
s("rockymineral", "worn_granite");

// Project-Red Exploration
s("projectred_exploration", "marble").childBlockSuffix(R.BRICKS, "_brick");

// Atmospheric
for (const x of ["ivory", "peach", "persimmon", "saffron"]) {
  s("atmospheric", `${x}_travertine`);
}

// Arts-And-Crafts
s("arts_and_crafts", "white_chalk");

// Oh The Biomes We've Gone
for (const x of [
  "white_sandstone",
  "blue_sandstone",
  "black_sandstone",
  "purple_sandstone",
  "pink_sandstone",
  "windswept_sandstone",
  "red_rock",
]) {
  s("biomeswevegone", x);
}

// What Is Stone
for (const x of [
  "white_granite",
  "white_limestone",
  "arkosic_sandstone",
  "black_marble",
  "grey_limestone",
  "anthracite",
]) {
  s("what_is_stone", x);
}

// BetterEnd
for (const x of [
  "azure_jadestone",
  "sandy_jadestone",
  "virid_jadestone",
  "sulphuric_rock",
]) {
  s("betterend", x);
}

// Create
for (const x of [
  "limestone",
  "asurine",
  "crimsite",
  "ochrum",
  "veridium",
  "scoria",
  "scorchia",
]) {
  s("create", x);
}

// Create Dreams & Desires
for (const x of ["gabbro", "aethersite", "potassic", "weathered_limestone"]) {
  s("create_dd", x);
}

// Bountiful Fares
s("bountifulfares", "feldspar").mainSuffix("_block");

// Aether Redux
s("aether_redux", "driftshale");

// Deep Aether
s("deep_aether", "clorite");
s("deep_aether", "raw_clorite");

// Alex's Caves (sic: "alexscave")
s("alexscave", "limestone");

// Enlightened End
s("enlightened_end", "void_shale");

// Quark
s("quark", "soul_sandstone");

// Nature's Spirit
s("natures_spirit", "pink_sandstone");
for (const c of [
  "white",
  "light_gray",
  "gray",
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "cyan",
  "light_blue",
  "blue",
  "purple",
  "magenta",
  "pink",
]) {
  s("natures_spirit", `${c}_chalk`);
}
s("natures_spirit", "bleached_chalk").when((loaded) =>
  loaded("arts_and_crafts"),
);

// Regions Unexplored
s("regions_unexplored", "argillite");

// Biomes O' Plenty
s("biomesoplenty", "black_sandstone");
s("biomesoplenty", "orange_sandstone");
s("biomesoplenty", "white_sandstone");

/** `CompatStoneType` stone finders, in `addSimpleFinder` order. */
export const STONE_FINDERS: readonly FinderSpec[] = list.specs;

const mud = new FinderList();
mud.add("mud", "deeperdarker:sculk_grime");
mud.add("mud", "enlightened_end:chorloam");

/** `CompatStoneType` mud finders, in `addSimpleFinder` order. */
export const MUD_FINDERS: readonly FinderSpec[] = mud.specs;
