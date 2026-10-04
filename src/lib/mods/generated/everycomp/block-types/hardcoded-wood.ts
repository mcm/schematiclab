// Wood and leaves type data: vanilla types, ignored mods, hardcoded finders
// and leaves → wood mappings.
//
// Port of Moonlight Lib (by MehVahdJukaar, Xel'Bayria and the Supplementaries
// Team, https://github.com/MehVahdJukaar/Moonlight, branch 1.21, commit
// 72afa38, Supplementaries Team License): `VanillaWoodTypes`,
// `VanillaLeavesTypes`, `VanillaWoodChildKeys`, `WoodTypeRegistry.IGNORED_MODS`,
// `LeavesTypeRegistry.IGNORED_MODS` and `api/integration/HardcodedBlockTypes`.
// Every Compat (556d936) adds no finders, removers or mappings of its own.
//
// Worker-safe: no DOM access.

import { FinderList, type FinderSpec } from "./finder";

/** `VanillaWoodChildKeys`. */
export const WOOD_KEYS = {
  PLANKS: "planks",
  LOG: "log",
  LEAVES: "leaves",
  WOOD: "wood",
  STRIPPED_LOG: "stripped_log",
  STRIPPED_WOOD: "stripped_wood",
  SAPLING: "sapling",
  FENCE: "fence",
  BUTTON: "button",
  PRESSURE_PLATE: "pressure_plate",
  DOOR: "door",
  TRAPDOOR: "trapdoor",
  SIGN: "sign",
  STAIRS: "stairs",
  SLAB: "slab",
  FENCE_GATE: "fence_gate",
  HANGING_SIGN: "hanging_sign",
  WALL_HANGING_SIGN: "wall_hanging_sign",
  WALL_SIGN: "wall_sign",
  BOAT: "boat",
  CHEST_BOAT: "chest_boat",
  STICK: "stick",
} as const;

const K = WOOD_KEYS;

export interface VanillaWoodSpec {
  id: string;
  planks: string;
  log: string;
  /** Children the static initializer adds before `initializeChildrenBlocks`. */
  children?: [string, string][];
}

/** `VanillaWoodTypes`, in registration order (OAK is the default type). */
export const VANILLA_WOOD_TYPES: readonly VanillaWoodSpec[] = [
  ...["oak", "spruce", "birch", "jungle", "acacia", "cherry", "dark_oak"].map(
    (w) => ({
      id: `minecraft:${w}`,
      planks: `minecraft:${w}_planks`,
      log: `minecraft:${w}_log`,
    }),
  ),
  {
    id: "minecraft:mangrove",
    planks: "minecraft:mangrove_planks",
    log: "minecraft:mangrove_log",
    // MANGROVE.addChild("sapling", Blocks.MANGROVE_PROPAGULE)
    children: [[K.SAPLING, "minecraft:mangrove_propagule"]],
  },
  {
    id: "minecraft:bamboo",
    planks: "minecraft:bamboo_planks",
    log: "minecraft:bamboo_block",
    // BAMBOO.addChild("sapling", Blocks.BAMBOO_SAPLING); removeChild("wood")
    // is a no-op at that point.
    children: [[K.SAPLING, "minecraft:bamboo_sapling"]],
  },
  {
    id: "minecraft:crimson",
    planks: "minecraft:crimson_planks",
    log: "minecraft:crimson_stem",
  },
  {
    id: "minecraft:warped",
    planks: "minecraft:warped_planks",
    log: "minecraft:warped_stem",
  },
];

/** `VanillaLeavesTypes`, in registration order (OAK is the default type). */
export const VANILLA_LEAVES_TYPES: readonly { id: string; leaves: string }[] = [
  "oak",
  "spruce",
  "birch",
  "jungle",
  "acacia",
  "cherry",
  "dark_oak",
  "mangrove",
].map((w) => ({ id: `minecraft:${w}`, leaves: `minecraft:${w}_leaves` }));

/** `WoodTypeRegistry.IGNORED_MODS`: namespaces skipped by planks detection. */
export const WOOD_IGNORED_MODS: ReadonlySet<string> = new Set([
  "chipped",
  "compressedblocks",
  "securitycraft",
  "burnt",
  "absentbydesign",
  "immersive_weathering",
  "dynamictrees",
  "dt",
]);

/** `LeavesTypeRegistry.IGNORED_MODS`: namespaces skipped by leaves detection. */
export const LEAVES_IGNORED_MODS: ReadonlySet<string> = new Set([
  "securitycraft",
  "burnt",
  "dynamic_trees",
  "dynamictrees",
  "dt",
]);

// ── HardcodedBlockTypes: wood finders ─────────────────────────────────────

const wood = new FinderList();
const w = (ns: string, name: string) => wood.add("wood", ns, name);

// The Undergarden
w("undergarden", "ancient_root").log("ancient_root");

// Shroomcraft
w("shroomcraft", "shroomwood")
  .mainSuffix("_planks")
  .log("stripped_mushroom_stem")
  .childBlock(K.WOOD, "stripped_mushroom_hyphae");
for (const c of ["blue", "orange", "purple"]) {
  w("shroomcraft", `${c}_shroomwood`)
    .mainSuffix("_planks")
    .log(`${c}_mushroom_stem`)
    .childBlock(K.STRIPPED_LOG, `stripped_${c}_mushroom_stem`)
    .childBlock(K.STRIPPED_WOOD, `stripped_${c}_mushroom_hyphae`);
}

// Abundant Atmosphere
w("abundant_atmosphere", "red_bamboo")
  .log("red_bamboo_block")
  .childBlock(K.STRIPPED_LOG, "stripped_red_bamboo_block");

// Dungeon's Delight
w("dungeonsdelight", "wormwood").bambooLike(true).log("wormroots_block");

// Sniffed Out
w("sniffed_out", "vessel")
  .log("crude_vessel_stem")
  .childBlock(K.WOOD, "crude_vessel_cuticle")
  .childBlock(K.STRIPPED_WOOD, "stripped_vessel_cuticle");

// Mofu's Better End
w("mofus_better_end_", "weepingstar").childBlockSuffix(K.LEAVES, "_leaf");
w("mofus_better_end_", "frost_root").mainSuffix("_plank");

// Burnt (HardcodedBlockTypes.BURNT)
w("burnt", "smoldering_bamboo").logSuffix("_block");

// Caverns-And-Chasms
w("caverns_and_chasms", "azalea").childBlockSuffix(K.LEAVES, "_leaves");

// The Outer End
w("outer_end", "azure")
  .childBlockSuffix(K.WOOD, "_pith")
  .childBlockSuffix(K.STRIPPED_WOOD, "_stripped_pith");

// Deeper And Darker
w("deeperdarker", "bloom")
  .log("blooming_stem")
  .childBlock(K.STRIPPED_LOG, "stripped_blooming_stem");

// Blocks +
w("blocksplus", "chorus");
w("blocksplus", "bamboo");
w("blocksplus", "mushroom");

// Integrated Dynamics
w("integrateddynamics", "menril");

// Domum Ornamentum
w("domum_ornamentum", "cactus")
  .main("green_cactus_extra")
  .log("minecraft:cactus");
w("domum_ornamentum", "cactus_extra")
  .main("cactus_extra")
  .log("minecraft:cactus");

// Jaden's Nether Expansion
w("netherexp", "claret")
  .log("cerebrage_claret_stem")
  .childBlock(K.WOOD, "cerebrage_claret_hyphae");

// Piglin Ruins
w("piglin_ruins", "ominous").log("ominous_stalk_block");

// Unusual End
w("unusualend", "chorus_nest")
  .main("chorus_nest_planks")
  .log("chorus_cane_block")
  .childBlock(K.STRIPPED_LOG, "stripped_chorus_cane_block")
  .childBlock(K.FENCE, "chorus_nest_mosaic_fence");

// Spectrum
for (const c of ["ivory", "slate", "ebony", "chestnut"]) {
  w("spectrum", `${c}_noxwood`)
    .log(`${c}_noxcap_stem`)
    .childBlock(K.STRIPPED_LOG, `stripped_${c}_noxcap_stem`)
    .childBlock(K.WOOD, `${c}_noxcap_hyphae`)
    .childBlock(K.STRIPPED_WOOD, `stripped_${c}_noxcap_hyphae`);
}

// Ars Nouveau (skipped when archwood_good is loaded)
w("ars_nouveau", "archwood")
  .when((loaded) => !loaded("archwood_good"))
  .log("blue_archwood_log")
  .childBlock(K.STRIPPED_LOG, "stripped_blue_archwood_log")
  .childBlock(K.WOOD, "blue_archwood_wood")
  .childBlock(K.STRIPPED_WOOD, "stripped_blue_archwood_wood")
  .childBlock(K.LEAVES, "blue_archwood_leaves")
  .childBlock(K.SAPLING, "blue_archwood_sapling");

// Blue Skies
w("blue_skies", "crystallized");

// Darker Depths
w("darkerdepths", "petrified");

// Pokecube Legends
w("pokecube_legends", "concrete");

// Terraqueous
for (const c of ["storm_cloud", "light_cloud", "dense_cloud"]) {
  w("terraqueous", c).main(c).log(`${c}_column`);
}

// Rats
w("rats", "pirat");

// Oh The Biomes You'll Go
w("byg", "embur").main("embur_pedu").log("embur_pedu_top");

// Nethers Exoticism
w("nethers_exoticism", "jabuticaba")
  .main("jaboticaba_planks")
  .log("jabuticaba_log");

// My Nether's Delight
w("mynethersdelight", "powdery")
  .bambooLike(true)
  .logSuffix("_block")
  .childBlockAffix(K.STRIPPED_LOG, "stripped_", "_block");

// Nourished End
w("nourished_end", "verdant")
  .logSuffix("_stalk")
  .childBlock(K.WOOD, "verdant_hyphae");
w("nourished_end", "cerulean")
  .logSuffix("_stem_thick")
  .childBlockSuffix(K.STRIPPED_LOG, "_stem_stripped")
  .childBlockSuffix(K.WOOD, "_hyphae")
  .childBlockSuffix(K.STRIPPED_WOOD, "_hyphae");

// Gardens Of The Dead
w("gardens_of_the_dead", "whistlecane")
  .bambooLike(true)
  .main("whistlecane_planks")
  .log("whistlecane_block")
  .childItem(K.STICK, "whistlecane");

w("blazingbamboo", "blazing_bamboo")
  .main("blazingbamboo:blazing_bamboo_planks")
  .log("blazingbamboo:blazing_bamboo_bundle");

// Luminous Nether
w("luminous_nether", "mushroom")
  .main("mushroom_planks")
  .log("goldenstem")
  .childBlock(K.STRIPPED_LOG, "shredded_stem")
  .childBlock(K.WOOD, "goldmushroom")
  .childBlock(K.SAPLING, "golden_mushroom")
  .childItem(K.STICK, "whistlecane");

// Desolation
w("desolation", "charred").log("charredlog");

// Dawn Of Time Builder
w("dawnoftimebuilder", "waxed_oak")
  .log("waxed_oak_log_stripped")
  .main("waxed_oak_planks");
w("dawnoftimebuilder", "charred_spruce")
  .log("charred_spruce_log_stripped")
  .main("charred_spruce_planks");

// Habitat
w("habitat", "fairy_ring_mushroom")
  .main("fairy_ring_mushroom_planks")
  .log("enhanced_fairy_ring_mushroom_stem");

// Ecologics
w("ecologics", "flowering_azalea").childBlock(
  K.LEAVES,
  "minecraft:flowering_azalea_leaves",
);
w("ecologics", "azalea").childBlock(K.LEAVES, "minecraft:azalea_leaves");

// Quark
w("quark", "azalea").childBlock(K.LEAVES, "minecraft:azalea_leaves");

/** `HardcodedBlockTypes` wood finders, in `addSimpleFinder` order. */
export const WOOD_FINDERS: readonly FinderSpec[] = wood.specs;

// ── HardcodedBlockTypes: leaves finders ───────────────────────────────────

const leaves = new FinderList();
const l = (ns: string, name: string) =>
  leaves.add("leaves", ns, name).mainSuffix("_leaves");

// No Man's Land
l("nomansland", "autumnal_oak").childBlock(K.LOG, "minecraft:oak_log");
l("nomansland", "frosted").childBlock(K.LOG, "pine_log");
l("nomansland", "pale_cherry").childBlock(K.LOG, "minecraft:cherry_log");
l("nomansland", "red_maple").childBlock(K.LOG, "maple_log");
l("nomansland", "yellow_birch").childBlock(K.LOG, "minecraft:birch_log");

// Oh The Biomes We've Gone
l("biomeswevegone", "flowering_palo_verde").childBlock(K.LOG, "palo_verde_log");

// Environmental
for (const c of ["pink", "blue", "purple", "white"]) {
  l("environmental", `${c}_wisteria`).childBlock(K.LOG, "wisteria_log");
}

// Ecologics
l("ecologics", "coconut").childBlock(K.SAPLING, "coconut_seedling");

// Pokecube Legends
for (const c of ["pastel_pink", "pink", "red"]) {
  l("pokecube_legends", `dyna_${c}`)
    .main(`dyna_leaves_${c}`)
    .equivalentWood("pokecube_legends:aged");
}

/** `HardcodedBlockTypes` leaves finders, in `addSimpleFinder` order. */
export const LEAVES_FINDERS: readonly FinderSpec[] = leaves.specs;

// ── HardcodedBlockTypes: leaves → wood mappings ───────────────────────────

/**
 * `addLeavesToWoodMapping(leaves, wood)` calls in source order (a later put
 * on the same leaves id replaces the earlier one). The Aether entries depend
 * on whether Aether Redux is loaded, so this is a function of the loaded mods.
 * Finder `equivalentWood` mappings are added by `detect.ts`.
 */
export function leavesToWoodMappings(
  isModLoaded: (modId: string) => boolean,
): [string, string][] {
  const m: [string, string][] = [];
  const add = (leavesId: string, woodId: string) => m.push([leavesId, woodId]);
  const ns = (namespace: string, leavesName: string, woodName: string) =>
    add(`${namespace}:${leavesName}`, `${namespace}:${woodName}`);

  ns("biomeswevegone", "araucaria", "pine");
  ns("biomeswevegone", "holly_berry", "holly");
  for (const x of [
    "firecracker",
    "yucca",
    "ripe_yucca",
    "flowering_yucca",
    "orchard",
    "ripe_orchard",
    "flowering_orchard",
  ]) {
    add(`biomeswevegone:${x}`, "minecraft:oak");
  }

  add("luminous_nether:ash", "luminous_nether:withered");

  add("fruitfulfun:apple", "minecraft:oak");
  add("fruitfulfun:pomegranate", "minecraft:jungle");
  for (const x of [
    "grapefruit",
    "lemon",
    "tangerine",
    "lime",
    "citron",
    "pomelo",
    "orange",
  ]) {
    ns("fruitfulfun", x, "citrus");
  }

  ns("environmental", "cheerful_plum", "plum");
  ns("environmental", "moody_plum", "plum");

  add("biomesoplenty:origin", "minecraft:oak");

  ns("blue_skies", "crystallized", "crystallized");
  ns("blue_skies", "crescent_fruit", "dusk");

  const azaleas: [string, string][] = [
    ["blue", "azule_azalea"],
    ["orange", "tecal_azalea"],
    ["pink", "bright_azalea"],
    ["purple", "walnut_azalea"],
    ["red", "roze_azalea"],
    ["white", "titanium_azalea"],
    ["yellow", "fiss_azalea"],
  ];
  for (const [colour, woodName] of azaleas) {
    ns("colorfulazaleas", `${colour}_azalea`, woodName);
    ns("colorfulazaleas", `${colour}_blooming_azalea`, woodName);
    ns("colorfulazaleas", `${colour}_flowering_azalea`, woodName);
  }

  ns("regions_unexplored", "bamboo", "bamboo");

  ns("twilightforest", "beanstalk", "twilight_oak");
  ns("twilightforest", "thorn", "twilight_oak");

  add("ulterlands:souldrained", "minecraft:oak");

  const redux = isModLoaded("aether_redux");
  const skyrootOrCrystal = redux ? "aether_redux:crystal" : "aether:skyroot";
  const skyrootOrGlacia = redux ? "aether_redux:glacia" : "aether:skyroot";
  add("aether:crystal", skyrootOrCrystal);
  add("aether:crystal_fruit", skyrootOrCrystal);
  ns("aether", "golden_oak", "skyroot");
  add("aether:holiday", skyrootOrGlacia);
  add("aether:decorated_holiday", skyrootOrGlacia);
  add("aether:crystal", skyrootOrCrystal);
  add("aether:crystal_fruit", skyrootOrCrystal);
  ns("aether", "gilded_oak", "skyroot");
  add("aether_redux:gilded_oak", "aether:skyroot");
  add("aether_redux:blighted_skyroot", "aether:skyroot");
  add("aether_genesis:purple_crystal", skyrootOrCrystal);
  add("aether_genesis:purple_crystal_fruit", skyrootOrCrystal);
  for (const x of [
    "crystal_skyroot",
    "enchanted_skyroot",
    "skyroot_pine",
    "blue_skyroot_pine",
    "wyndcaps_holiday_tree",
  ]) {
    add(`ancient_aether:${x}`, "aether:skyroot");
  }

  ns("autumnity", "yellow_maple", "maple");
  ns("autumnity", "orange_maple", "maple");
  ns("autumnity", "red_maple", "maple");

  add("alexscaves:ancient", "minecraft:jungle");
  return m;
}

/**
 * `AxeItem.STRIPPABLES` in 1.21.1 (vanilla pairs only). Approximation: Fabric
 * mods can add entries through `StrippableBlockRegistry`, and NeoForge mods
 * strip through tool actions instead; neither is visible to us.
 */
export const VANILLA_STRIPPABLES: ReadonlyMap<string, string> = new Map([
  ...[
    "oak",
    "spruce",
    "birch",
    "jungle",
    "acacia",
    "cherry",
    "dark_oak",
    "mangrove",
  ].flatMap((x): [string, string][] => [
    [`minecraft:${x}_wood`, `minecraft:stripped_${x}_wood`],
    [`minecraft:${x}_log`, `minecraft:stripped_${x}_log`],
  ]),
  ...["crimson", "warped"].flatMap((x): [string, string][] => [
    [`minecraft:${x}_stem`, `minecraft:stripped_${x}_stem`],
    [`minecraft:${x}_hyphae`, `minecraft:stripped_${x}_hyphae`],
  ]),
  ["minecraft:bamboo_block", "minecraft:stripped_bamboo_block"],
]);
