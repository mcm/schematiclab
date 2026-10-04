// Gem, metal, crystal and dust type data: vanilla types, child keys,
// blacklists and hardcoded finders.
//
// Port of Gems Realm (by Xelbayria, https://github.com/Xelbayria/Gems-Realm,
// branch 1.21.1, commit 66b66be, Supplementaries Team License — credit
// MehVahdJukaar, Xel'Bayria and the Supplementaries Team):
// `VanillaGemTypes`, `VanillaMetalTypes`, `VanillaCrystalTypes`,
// `VanillaDustTypes`, the `Vanilla*ChildKeys`, `misc/HardcodedBlockType`
// (blacklists) and `api/intergration/Compat{Crystal,Dust,Metal,Gem}Type`.
//
// Worker-safe: no DOM access.

import { FinderList, type FinderSpec } from "./finder";

/** Gems Realm `VanillaRockChildKeys` and the per-kind extra keys. */
export const GR_KEYS = {
  BLOCK: "block",
  RAW_BLOCK: "raw_block",
  STAIRS: "stairs",
  SLAB: "slab",
  WALL: "wall",
  FENCE: "fence",
  CHISELED: "chiseled",
  BRICKS: "bricks",
  BRICK_STAIRS: "brick_stairs",
  BRICK_SLAB: "brick_slab",
  BRICK_WALL: "brick_wall",
  BRICK_TILES: "brick_tiles",
  CRACKED_BRICKS: "cracked_bricks",
  MOSSY_BRICKS: "mossy_bricks",
  MOSSY_BRICK_SLAB: "mossy_brick_slab",
  MOSSY_BRICK_STAIRS: "mossy_brick_stairs",
  MOSSY_BRICK_WALL: "mossy_brick_wall",
  SMOOTH: "smooth",
  SMOOTH_STAIRS: "smooth_stairs",
  SMOOTH_SLAB: "smooth_slab",
  SMOOTH_WALL: "smooth_wall",
  // VanillaMetalChildKeys
  TRAPDOOR: "trapdoor",
  LAMP: "lamp",
  CHAIN: "chain",
  ANVIL: "anvil",
  BARS: "bars",
  INGOT: "ingot",
  NUGGET: "nugget",
  // VanillaGemChildKeys
  GEM: "gem",
  // VanillaCrystalChildKeys
  CLUSTER: "cluster",
  GLINTED_CLUSTER: "glinted_cluster",
  BUDDING: "budding",
  SHARD: "shard",
  // VanillaDustChildKeys
  DUST: "dust",
} as const;

const vanilla = (names: string[]) =>
  names.map((n) => ({ id: `minecraft:${n}`, block: `minecraft:${n}_block` }));

/** `VanillaGemTypes` (EMERALD is the default type). */
export const VANILLA_GEM_TYPES = vanilla([
  "emerald",
  "diamond",
  "lapis",
  "quartz",
]);
/** `VanillaMetalTypes` (IRON is the default type). */
export const VANILLA_METAL_TYPES = vanilla(["iron", "gold", "copper"]);
/** `VanillaCrystalTypes`. */
export const VANILLA_CRYSTAL_TYPES = vanilla(["amethyst"]);
/** `VanillaDustTypes`. */
export const VANILLA_DUST_TYPES = vanilla(["redstone"]);

/** Gems Realm `HardcodedBlockType.BLACKLISTED_MODS` (gem, crystal, dust). */
export const GR_BLACKLISTED_MODS: ReadonlySet<string> = new Set([
  "immersive_weathering",
  "chipped",
  "create_confectionery",
]);

/** `BLACKLISTED_DUST_MODS` (marked TEMP in the source). */
export const GR_BLACKLISTED_DUST_MODS: ReadonlySet<string> = new Set(["gtceu"]);

export const GR_BLACKLISTED_METALTYPES: ReadonlySet<string> = new Set([
  "ms:blaze",
  "atlantis:raw_ancient_metal",
  "advancednetherite:netherite_diamond",
  "advancednetherite:netherite_emerald",
  "gtceu:magnetic_steel",
  "gtceu:magnetic_samarium",
  "gtceu:magnetic_neodymium",
  "gtceu:magnetic_iron",
]);

export const GR_BLACKLISTED_GEMTYPES: ReadonlySet<string> = new Set([
  "minecraft:redstone",
  "minecraft:coal",
  ...[
    "aluminium",
    "bismuth",
    "bronze",
    "holmium",
    "iridium",
    "lead",
    "lithium",
    "magnesium",
    "matizium",
    "nickel",
    "orichalcum",
    "osmium",
    "palintinium",
    "palladium",
    "pelenium",
    "platinum",
    "silicium",
    "silver",
    "tin",
    "titanium",
    "uranium",
    "xernium",
    "yurium",
    "zinc",
    "chloronium",
    "cobalt",
    "maradonyx",
    "sulfur",
    "tungsten",
    "chrome",
    "carnotite",
    "ilmenite",
    "pyrite",
    "seaborgium",
  ].map((m) => `crystalcraft_unlimited_java:${m}`),
  "shadowlands:goo",
  "landsoficaria:sliver",
]);

export const GR_BLACKLISTED_CRYSTALTYPES: ReadonlySet<string> = new Set();

export const GR_BLACKLISTED_DUSTTYPES: ReadonlySet<string> = new Set([
  "betterend:ender",
]);

const G = GR_KEYS;
const CCU = "crystalcraft_unlimited_java";

// ── CompatCrystalType ─────────────────────────────────────────────────────

const crystal = new FinderList();
const c = (id: string, path?: string) => crystal.add("crystal", id, path);

c("outer_end:rose_crystal").mainSuffix("");
c("outer_end:mint_crystal").mainSuffix("");
c("outer_end:cobalt_crystal").mainSuffix("");
c("excessive_building:prismarine_crystal").childItem(
  G.SHARD,
  "minecraft:prismarine_crystals",
);
c("divinerpg", "olivine").childItem(G.SHARD, "olivine");
c("biomesoplenty:rose_quartz");
c(`${CCU}:aura_quartz`).childBlock(G.CLUSTER, "aura_crystal");
c("geodes:echo")
  .childItem(G.SHARD, "minecraft:echo_shard")
  .childBlock(G.BUDDING, "budding_echo_block");
c("geodes:lapis_crystal").childBlock(G.CLUSTER, "lapis_cluster");
c("geodes:gypsum_crystal");
c("geodes:diamond_crystal");
c("geodes:quartz_crystal");
c("geodes:emerald_crystal");

export const CRYSTAL_FINDERS: readonly FinderSpec[] = crystal.specs;

// ── CompatDustType ────────────────────────────────────────────────────────

const dust = new FinderList();
dust
  .add("dust", "more_ores_more_gems:gunpowder")
  .childItem(G.DUST, "minecraft:gunpowder");
dust.add("dust", "atlantis:aquatic_power").mainSuffix("_stone");
for (const x of [
  "ikegamini",
  "ikegamonium",
  "ikegamium",
  "simonium",
  "simoganium",
  "chloronium",
  "whitestone",
  "blackstone",
  "sulfur",
]) {
  dust.add("dust", `${CCU}:${x}`).childItem(G.DUST, x);
}

export const DUST_FINDERS: readonly FinderSpec[] = dust.specs;

// ── CompatMetalType ───────────────────────────────────────────────────────

const metal = new FinderList();
const m = (id: string, path?: string) => metal.add("metal", id, path);

m("minecraft:netherite")
  .when((loaded) => loaded("oreganized"))
  .childItem(G.NUGGET, "oreganized:netherite_nugget");
m("minecraft:netherite")
  .when((loaded) => loaded("caverns_and_chasms"))
  .childItem(G.NUGGET, "caverns_and_chasms:netherite_nugget");
m("etcetera", "bismuth")
  .when((loaded) => loaded("spelunkery"))
  .childItem(G.NUGGET, "spelunkery:bismuth_nugget");
m("architects_palette", "unobtanium").childItem(G.INGOT, "unobtanium");
m("architects_palette", "sunmetal").childItem(G.INGOT, "sunmetal_brick");
m("architects_palette", "entwine").childItem(G.INGOT, "sunmetal_rod");
m("create_aquatic_ambitions", "prismarine_alloy").childItem(
  G.INGOT,
  "prismarine_alloy",
);
m("techreborn", "iridium_reinforced_tungstensteel")
  .mainSuffix("_storage_block")
  .childBlockSuffix(G.SLAB, "_storage_block_slab")
  .childBlockSuffix(G.STAIRS, "_storage_block_stairs")
  .childBlockSuffix(G.WALL, "_storage_block_wall");
m("dustrial_decor", "cast_iron").childItemSuffix(G.INGOT, "_billet");
m("dustrial_decor", "industrial_iron").childItemSuffix(G.INGOT, "_billet");

const MOMG_INGOT_SELF = new Set([
  "crimsonite",
  "skysteel",
  "titanium_quartz",
  "tungsten",
]);
for (const x of [
  "adamantite",
  "aetherium",
  "antimony",
  "bromine",
  "crimsonite",
  "electrum",
  "lead",
  "magnesium",
  "monel",
  "neptunium",
  "nickel",
  "nitrol",
  "osmium",
  "platinum",
  "rhodium",
  "shadowite",
  "shadowsteel",
  "sliver",
  "skysteel",
  "steel",
  "thalassium",
  "thorium",
  "tin",
  "titanium",
  "titanium_quartz",
  "tungsten",
  "uranium",
  "uranium_234",
  "uranium_238",
  "urantherium",
  "volcagmium",
]) {
  const f = m(`more_ores_more_gems:${x}`);
  if (MOMG_INGOT_SELF.has(x)) f.childItemSuffix(G.INGOT, "");
}

m("unusualend:pearlescent");
m("seadwellers:depth");
m("ms", "refined_quartz").main("resources/refined_quartz_block");
m("ms", "cast_iron").main("resources/cast_iron_block");

m(CCU, "radium").main("radium_reactor").childItem(G.INGOT, "radium");
m(CCU, "neon_meteorite").main("neon").childItem(G.INGOT, "neon_meteorite");
m(CCU, "withered_steel")
  .main("wither_block")
  .childItem(G.INGOT, "withered_steel");
m(CCU, "meteorite").main("meteorite");
for (const x of [
  "orichalcum",
  "aluminium",
  "titanium",
  "uranium",
  "bronze",
  "silver",
  "platinum",
  "mythril",
  "adamantite",
  "plutonium",
  "unoptanium",
  "crimson_gold",
  "tin",
  "iridium",
  "steel",
  "nickel",
  "zinc",
  "lead",
  "brass",
  "tungsten",
  "rose_gold",
  "chrome",
  "magnesium",
  "bismuth",
  "electrum",
  "matizium",
  "yurium",
  "xernium",
  "palladium",
  "purple_gold",
  "green_gold",
  "cupronickel",
  "pelenium",
  "maradonyx",
  "palintinium",
  "lithium",
  "silicium",
  "technetium",
  "ruthenium",
  "rhodium",
  "cadmium",
  "tantalum",
  "holmium",
  "osmium",
  "neptunium",
  "galaxite",
  "pyrite",
  "seaborgium",
  "ilmenite",
  "cobalt",
  "carnotite",
  "antimony",
  "alnico",
  "aluminium_bronze",
  "amalgam",
  "cast_iron",
  "duralumin",
  "german_silver",
  "hss",
  "inconel",
  "nordic_gold",
  "pewter",
  "rene_41",
  "stainless_steel",
  "stellite",
  "titanium_alloy",
  "zamak",
  "zircaloy",
]) {
  m(CCU, x).childItem(G.INGOT, x);
}
for (const x of [
  "hydro_pottasium",
  "americium",
  "thorium",
  "pottasium",
  "indium",
  "scandium",
  "vanadium",
  "manganese",
  "yttrium",
  "zirconium",
  "niobium",
  "molybdenum",
  "europium",
  "calcium",
]) {
  m(CCU, x);
}

export const METAL_FINDERS: readonly FinderSpec[] = metal.specs;

// ── CompatGemType ─────────────────────────────────────────────────────────

const gem = new FinderList();
const g = (id: string, path?: string) => gem.add("gem", id, path);

const MOMG = "more_ores_more_gems";
const momgGems: [string, ((f: ReturnType<typeof g>) => void)?][] = [
  ["amethyst"],
  ["ametrine"],
  ["aquamarine"],
  ["autunite_235", (f) => f.childItemSuffix(G.GEM, "_gemstone")],
  ["autunite_238", (f) => f.childItemSuffix(G.GEM, "_gemstone")],
  ["black_fluorite", (f) => f.childItem(G.GEM, "fluorite_black_color")],
  ["black_opal"],
  ["blood_fluorite"],
  ["carnelian"],
  ["citrine"],
  ["ekanite"],
  ["fire_opal", (f) => f.childItemSuffix(G.GEM, "_gemstone")],
  ["fluorescent_fluorite"],
  ["gray_opal"],
  ["green_fluorite", (f) => f.childItem(G.GEM, "fluorite_green_color")],
  ["heliodor"],
  ["jade"],
  ["lemonite"],
  ["luminous_gem"],
  ["mysticrain_quartz"],
  ["opalized_quartz"],
  ["orange_fluorite", (f) => f.childItem(G.GEM, "fluorite_orange_color")],
  ["orange_pink_fluorite", (f) => f.childItem(G.GEM, "fluorite_orange_pink")],
  ["padparadscha"],
  ["peridot"],
  ["pink_fluorite", (f) => f.childItem(G.GEM, "fluorite_pink_color")],
  ["pink_opal"],
  ["purple_fluorite", (f) => f.childItem(G.GEM, "fluorite_purple_color")],
  ["purple_green_fluorite", (f) => f.childItem(G.GEM, "fluorite_purple_green")],
  ["rainbow_fluorite", (f) => f.childItem(G.GEM, "fluorite_rainbow_color")],
  ["rare_sapphire"],
  ["ruby_pack"],
  ["sapphire"],
  ["sunflare_gem"],
  ["tanzanite"],
  ["topaz"],
  ["ussingite"],
  ["weird_frost_opal", (f) => f.childItem(G.GEM, "memory_opal")],
  ["white_crystal"],
  ["white_fluorite", (f) => f.childItem(G.GEM, "fluorite_white_clear")],
  ["white_opal"],
  ["ytt_fluorite", (f) => f.childItem(G.GEM, "fluorite_yttrium")],
];
for (const [x, configure] of momgGems) {
  const f = g(`${MOMG}:${x}`);
  configure?.(f);
}

g("atlantis", "aquamarine").childItemSuffix(G.GEM, "_gem");
g("shadowlands", "neon").main("neon_gem_block");
g("shadowlands", "fire").main("fire_gem_block");

for (let num = 1; num < 15; num++) {
  if (num === 13) continue; // doesn't exist
  const f = g(CCU, `zircon_${num}`);
  if ([1, 4, 6, 9].includes(num)) f.main(`zircon_block_${num}`);
}

for (const [x, block] of [
  ["bixbite", "bixite_block"],
  ["pearl_item", "pearl_block"],
  ["pink_catseye", "pink_tigerseye_block"],
  ["brown_catseye", "tigerseye_block"],
  ["dark_blue_diamond", "blue_diamond"],
  ["solar_diamond", "solar_block"],
  ["eclipse_diamond", "eclipse_block"],
  ["snowflake_obsidian", "snowflake_block"],
  ["matrix_opal", "matrix_block"],
  ["medusa_quartz", "medusa_block"],
  ["dragon_scale", "dragon_block"],
  ["watermelon_tourmaline", "watermelon_block"],
  ["orange_star_sapphire", "orange_star_block"],
  ["australian_sapphire", "rare_sapphire_block"],
  ["saphire", "sapphire_block"],
  ["sapphire", "blue_sapphire_block"],
  ["green_star_sapphire", "green_star_sapphire_block_2"],
  ["dark_green_star_sapphire", "green_star_sapphire_block"],
  ["rare_sapphire", "rare_sapphire_block_recipe"],
]) {
  g(CCU, x).main(block);
}

for (const x of [
  "angerite",
  "black_pearl",
  "blue_pearl",
  "brown_pearl",
  "dark_blue_pearl",
  "green_pearl",
  "olive_pearl",
  "orange_pearl",
  "pink_pearl",
  "purple_pearl",
  "red_pearl",
  "white_pearl",
  "yellow_pearl",
  "purple_catseye",
  "white_catseye",
  "red_catseye",
  "orange_catseye",
  "yellow_catseye",
  "black_catseye",
  "blue_catseye",
  "crystal",
  "cyber_crystal",
  "corrupted_cyber_crystal",
  "yellow_diamond",
  "olive_diamond",
  "green_diamond",
  "brown_diamond",
  "shadow_diamond",
  "raspberry_diamond",
  "maroon_diamond",
  "anti_humoranium",
  "sunset_jasper",
  "zebra_jasper",
  "pitambari_neelam",
  "ice_opal",
  "peacock",
  "peacock_topaz",
  "smoky_quartz",
  "soul_quartz",
  "ghoul_quartz",
  "blood_quartz",
  "star_sapphire",
  "rare_star_sapphire",
  "yellow_star_sapphire",
  "purple_star_sapphire",
  "pink_star_sapphire",
  "iris_agate",
  "painite",
  "rainbow_opal",
  "rose_quartz",
  "star_ruby",
  "titanium_quartz",
  "umbranova",
]) {
  g(CCU, x);
}

export const GEM_FINDERS: readonly FinderSpec[] = gem.specs;
