// Chisel 1.12 blocks that Unlimited Chisel Works rules recolour (`through`),
// and how their `variation` states map to blockstate variants.
//
// Variation order from Chisel for Minecraft 1.12.2
// (https://github.com/Chisel-Team/Chisel, branch 1.12/dev, commit a0df104):
// `Features.java` lists each block's variations, `BlockRegistry
// .splitVariationArray` splits them into blocks of 16 (`<name>`, `<name>1`,
// …), `ChiselModelRegistry.ChiselStateMapper` maps `variation=N` to the
// `<parent folder>.json` blockstate's variant named after the Nth variation
// (lower-cased, as `ModelResourceLocation` does), and UCW's
// `UCWJsonUtils.parseStateList` reads a Chisel block's states from metadata 0
// until a metadata repeats or names an empty slot. Chisel is licensed under
// the GNU General Public License v2.0; only these names are taken from it.
//
// The order lives only in Chisel's Java, so blocks outside this table (no UCW
// rule recolours them) aren't known.
//
// Worker-safe: no DOM access.

/** Chisel's namespace. */
export const CHISEL_NAMESPACE = "chisel";

interface ChiselFamily {
  /** Folder of the blockstate (`setParentFolder`, default: the block name). */
  folder: string;
  /** Every variation in order; `""` marks an unused slot. */
  variations: readonly string[];
}

// The 26 patterns most stone-like blocks start with, then six unused slots.
const STONE_PATTERNS = [
  "cracked",
  "bricks-soft",
  "bricks-cracked",
  "bricks-triple",
  "bricks-encased",
  "braid",
  "array",
  "tiles-large",
  "tiles-small",
  "chaotic-medium",
  "chaotic-small",
  "dent",
  "french-1",
  "french-2",
  "jellybean",
  "layers",
  "mosaic",
  "ornate",
  "panel",
  "road",
  "slanted",
  "zag",
  "circularct",
  "weaver",
  "bricks-chaotic",
  "cuts",
  "",
  "",
  "",
  "",
  "",
  "",
] as const;

const STONE_TAIL = [
  "bricks-solid",
  "bricks-small",
  "circular",
  "tiles-medium",
  "pillar",
  "twisted",
] as const;

const PLANK_PATTERNS = [
  "clean",
  "short",
  "fancy",
  "panel-nails",
  "double",
  "crate",
  "crate-fancy",
  "large",
  "vertical",
  "vertical-uneven",
  "parquet",
  "blinds",
  "crateex",
  "chaotic-hor",
  "chaotic",
] as const;

const GLASS_PATTERNS = [
  "panel",
  "framed",
  "framed_fancy",
  "streaks",
  "rough",
  "brick",
] as const;

const PLANK_WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark-oak"];

const DYE_COLORS = [
  "black",
  "red",
  "green",
  "brown",
  "blue",
  "purple",
  "cyan",
  "lightgray",
  "gray",
  "pink",
  "lime",
  "yellow",
  "lightblue",
  "magenta",
  "orange",
  "white",
];

/** Block name (before splitting into 16s) → family. */
const FAMILIES: ReadonlyMap<string, ChiselFamily> = new Map<
  string,
  ChiselFamily
>([
  [
    "bricks",
    {
      folder: "bricks",
      variations: [...STONE_PATTERNS, ...STONE_TAIL, "prism"],
    },
  ],
  [
    "cobblestone",
    {
      folder: "cobblestone",
      variations: [
        ...STONE_PATTERNS,
        ...STONE_TAIL,
        "prism",
        "emboss",
        "indent",
        "marker",
      ],
    },
  ],
  [
    "dirt",
    {
      folder: "dirt",
      variations: [
        "bricks",
        "netherbricks",
        "bricks3",
        "cobble",
        "reinforcedCobbleDirt",
        "reinforcedDirt",
        "happy",
        "bricks2",
        "bricks+dirt2",
        "hor",
        "vert",
        "layers",
        "vertical",
        "chunky",
        "horizontal",
        "plate",
      ],
    },
  ],
  [
    "prismarine",
    { folder: "prismarine", variations: [...STONE_PATTERNS, ...STONE_TAIL] },
  ],
  [
    "purpur",
    {
      folder: "purpur",
      variations: [...STONE_PATTERNS, ...STONE_TAIL, "prism"],
    },
  ],
  [
    "quartz",
    {
      folder: "quartz",
      variations: [
        ...STONE_PATTERNS.slice(0, 24),
        ...STONE_TAIL,
        "prism",
        "bricks-chaotic",
        "cuts",
      ],
    },
  ],
  [
    "sandstoneyellow",
    {
      folder: "sandstoneyellow",
      variations: [...STONE_PATTERNS, ...STONE_TAIL, "prism", "seamless"],
    },
  ],
  [
    "stonebrick",
    {
      folder: "stone",
      variations: [
        ...STONE_PATTERNS,
        "bricks-small",
        "tiles-medium",
        "pillar",
        "twisted",
        "prism",
        "largeornate",
        "poison",
        "sunken",
        "doubleslab",
        "doubleslab-seamless",
      ],
    },
  ],
  ...PLANK_WOODS.map((wood): [string, ChiselFamily] => [
    `planks-${wood}`,
    { folder: `planks-${wood}`, variations: PLANK_PATTERNS },
  ]),
  ...DYE_COLORS.map((color): [string, ChiselFamily] => [
    `glassdyed${color}`,
    { folder: `glass_stained/${color}`, variations: GLASS_PATTERNS },
  ]),
]);

/** One registered Chisel block (a slice of up to 16 variations). */
export interface ChiselBlock {
  /** Blockstate id the variants live in, e.g. `chisel:stone`. */
  blockstate: string;
  /**
   * Variant name per `variation` value, as UCW lists the block's states:
   * from 0 until the slice ends or names an unused slot.
   */
  variants: readonly string[];
}

const blockCache = new Map<string, ChiselBlock | null>();

/** The Chisel block `blockId` (e.g. `chisel:stonebrick1`), or null. */
export function chiselBlock(blockId: string): ChiselBlock | null {
  let block = blockCache.get(blockId);
  if (block !== undefined) return block;
  block = null;
  const match = /^chisel:(.*?)([1-9][0-9]*)?$/.exec(blockId);
  const family = match === null ? undefined : FAMILIES.get(match[1]);
  if (match !== null && family !== undefined) {
    const index = match[2] === undefined ? 0 : Number(match[2]);
    const slice = family.variations.slice(index * 16, index * 16 + 16);
    const end = slice.indexOf("");
    const names = end < 0 ? slice : slice.slice(0, end);
    if (names.length > 0) {
      block = {
        blockstate: `${CHISEL_NAMESPACE}:${family.folder}`,
        variants: names.map((name) => name.toLowerCase()),
      };
    }
  }
  blockCache.set(blockId, block);
  return block;
}

/**
 * The blockstate variant of `blockId[variation=…]`, or null when the block
 * or the value isn't known.
 */
export function chiselVariant(
  blockId: string,
  properties: Readonly<Record<string, string>>,
): { blockstate: string; variant: string } | null {
  const block = chiselBlock(blockId);
  if (block === null) return null;
  const value = properties.variation;
  if (value === undefined || !/^(0|[1-9][0-9]?)$/.test(value)) return null;
  const variant = block.variants[Number(value)];
  return variant === undefined
    ? null
    : { blockstate: block.blockstate, variant };
}
