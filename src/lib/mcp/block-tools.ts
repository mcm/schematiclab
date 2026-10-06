// `search_blocks` and `suggest_palette`: block ids of one Minecraft version
// (`lib/blockdata`), or of a modpack (its version's vanilla blocks plus its
// mod blocks), found by name and shape or ranked by OKLab distance to a
// colour. Vanilla colours come from `block-colors.json` (the vanilla asset
// bundle's version) and dominant colours and variance from the same bundle
// (`vanilla-appearance.ts`); ids renamed since a requested version are
// translated to the bundle's names to find their colour, but results always
// use the requested version's ids. Mod block appearances come from the pack.

import { z } from "zod";
import { type BlockData, type BlockInfo } from "../blockdata/load";
import {
  createBlockRegistry,
  normalizeBlockName,
  type BlockRegistry,
} from "../blockdata/registry";
import { isInvisibleBlockId } from "../invisible-blocks";
import type { DominantColor } from "../modpacks/appearance";
import type { ModpackBlocks } from "../modpacks/registry";
import { MOD_BLOCK_KINDS } from "../modpacks/schema";
import {
  oklabToSrgb,
  srgbToOklab,
  type BlockAppearance,
} from "../render/block-appearance";
import { BUNDLE_MINECRAFT_VERSION } from "../render/display-translation";
import { BlockState } from "../schemlib/blocks";
import { translateBlockState } from "../schemlib/data/translate";
import { materialForVersion } from "../shapes/generate";
import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/known-versions";
import type { MinecraftVersion } from "../schemlib/schematic-formats/version-mapping";
import {
  CAMO_MATERIAL_NOTE,
  CAMO_MATERIAL_RULE,
  camoOptions,
  framesOfShapes,
  modpackCamoFrames,
  modpackCamoMaterials,
  type CamoOption,
} from "./camo-options";
import { modpackInput } from "./input";
import { vanillaBlockColors } from "./render";
import { resolveToolBlocks } from "./tool-blocks";
import { defineTool, jsonResult, type McpDeps } from "./types";
import { vanillaBlockDescriptors } from "./vanilla-appearance";

export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_PALETTE_SIZE = 16;
export const DEFAULT_PALETTE_SIZE = 8;

const NAMESPACE = "minecraft:";
const VANILLA_MOD = "minecraft";

// minecraft-data's 1.13.2 blocks (1.12.2 and 1.13.x), which KNOWN_VERSIONS
// doesn't list.
const MINECRAFT_1_13_2: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 13, 2],
  dataVersion: 1631,
};

// 1.12.2's flattened block data → only the blocks 1.12.2 has, per source map.
const legacyCache = new WeakMap<
  ReadonlyMap<string, BlockInfo>,
  Map<string, BlockInfo>
>();

/**
 * `data` with only the blocks a schematic for `versionId` can hold. 1.12.2's
 * data is 1.13.2's flattened ids, so blocks added in 1.13 (stripped logs,
 * coral, cave air, ...) are dropped: those the Shape Generator can't write as
 * a Forge 1.12 state.
 */
export function blocksOfVersion(data: BlockData, versionId: string): BlockData {
  if (!data.translateOnExport) return data;
  let blocks = legacyCache.get(data.blocks);
  if (!blocks) {
    blocks = new Map();
    for (const [id, info] of data.blocks) {
      // Air is written as itself, but isn't a shape material.
      if (id === "minecraft:air") {
        blocks.set(id, info);
        continue;
      }
      const written = materialForVersion(
        { blockId: id, properties: info.defaults },
        versionId,
      );
      if (written.ok) blocks.set(id, info);
    }
    legacyCache.set(data.blocks, blocks);
  }
  return { ...data, blocks };
}

/** The blocks one call searches. */
export interface SearchScope {
  versionId: string;
  /** Vanilla blocks of the version (1.12.2: only those it has). */
  data: BlockData;
  /** Vanilla blocks, plus the pack's mod blocks with a modpack. */
  registry: BlockRegistry;
  modpack: ModpackBlocks | null;
}

export async function searchScope(
  args: { version?: string; modpack?: string },
  deps: McpDeps,
): Promise<SearchScope> {
  const blocks = await resolveToolBlocks(args, deps);
  const data = blocksOfVersion(blocks.data, blocks.versionId);
  return {
    versionId: blocks.versionId,
    data,
    // A pack's registry is cached with the pack; a version's is built from
    // its filtered blocks, so 1.12.2 rejects blocks it doesn't have.
    registry: blocks.modpack
      ? blocks.registry
      : createBlockRegistry(data, blocks.versionId),
    modpack: blocks.modpack,
  };
}

export function scopeNote(scope: SearchScope): string | undefined {
  const notes: string[] = [];
  if (scope.data.translateOnExport) {
    notes.push(
      "Ids are flattened (1.13+) names; schematic writers translate them to 1.12.2 blocks.",
    );
  }
  const runtime = scope.modpack?.data.runtimeBlockSources ?? [];
  if (runtime.length > 0) {
    notes.push(
      `This pack also registers blocks at runtime, which aren't listed: ${runtime.map((r) => r.name).join(", ")}.`,
    );
  }
  return notes.length > 0 ? notes.join(" ") : undefined;
}

export const versionInput = z
  .string()
  .optional()
  .describe(
    "The Minecraft version, as listed by list_versions. May be left out with a modpack (it is the pack's version).",
  );

// ── Shapes ─────────────────────────────────────────────────────────────────

/** Shape filters: every block kind, plus `full_cube`. */
export const SHAPES = [
  ...MOD_BLOCK_KINDS.filter((kind) => kind !== "unknown"),
  "full_cube",
] as const;
export type Shape = (typeof SHAPES)[number];

const shapeInput = z
  .array(z.enum(SHAPES))
  .min(1)
  .optional()
  .describe(
    "Only blocks of one of these shapes: a kind (stairs, slab, wall, fence, ...) or full_cube (fills the whole block space). Mod blocks whose shape is unclear (kind unknown) only match full_cube when they are full cubes.",
  );

/** Whether a block of `kind` matches any of `shapes`. */
export function matchesShape(
  kind: string,
  fullCube: boolean,
  shapes: ReadonlySet<Shape>,
): boolean {
  return shapes.has(kind as Shape) || (fullCube && shapes.has("full_cube"));
}

// ── Appearances ────────────────────────────────────────────────────────────

type Oklab = BlockAppearance["oklab"];

/** What a result says about a block besides its id. */
export interface BlockLook {
  kind: string;
  /** The mod's name, or `minecraft`. */
  mod: string;
  /** `low` for mod blocks whose shape evidence was unclear (kind `unknown`). */
  shapeConfidence: "high" | "low";
  fullCube: boolean;
  /**
   * False for a pack mod block with no look at all (no appearance, no
   * swatch: a block only a server's block list names); absent otherwise.
   */
  visualInfo?: false;
  oklab?: Oklab;
  hex?: string;
  dominant?: DominantColor[];
  variance?: number;
}

/**
 * What results say about a block without visual information: its name
 * doesn't say how it looks.
 */
export const NO_VISUAL_INFO_NOTE =
  "Blocks with visual_info: false have no visual information (no textures or colours were found for them); don't assume their look from their name.";

/** A vanilla block's colour data. */
export interface VanillaColor extends BlockAppearance {
  hex: string;
  dominant?: DominantColor[];
  variance?: number;
}

// Block id → colour, per block data source.
const colorCache = new WeakMap<
  ReadonlyMap<string, unknown>,
  Map<string, VanillaColor>
>();

/**
 * Colours for every block of `data`, keyed by the version's own ids. An id
 * the colour bundle lacks is translated to the bundle's version (default
 * state) and takes that block's colour.
 */
export function blockColorsForVersion(
  data: BlockData,
): Map<string, VanillaColor> {
  const cached = colorCache.get(data.blocks);
  if (cached) return cached;
  const colors = vanillaBlockColors();
  const descriptors = vanillaBlockDescriptors();
  const out = new Map<string, VanillaColor>();
  for (const id of data.blocks.keys()) {
    const bundleId = vanillaBundleId(data, id);
    if (!bundleId) continue;
    const appearance = colors[bundleId];
    const descriptor = descriptors.get(bundleId);
    out.set(id, {
      ...appearance,
      hex: oklabToHex(appearance.oklab),
      ...(descriptor && {
        dominant: descriptor.dominant,
        variance: descriptor.variance,
      }),
    });
  }
  colorCache.set(data.blocks, out);
  return out;
}

/**
 * The vanilla asset bundle's id of `id`, a block of `data`: itself, or its
 * default state translated to the bundle's version. Undefined when the
 * bundle has no colour for it.
 */
export function vanillaBundleId(
  data: BlockData,
  id: string,
): string | undefined {
  const colors = vanillaBlockColors();
  if (Object.hasOwn(colors, id)) return id;
  const info = data.blocks.get(id);
  if (!info) return undefined;
  const from = Object.hasOwn(KNOWN_VERSIONS, data.sourceVersion)
    ? KNOWN_VERSIONS[data.sourceVersion]
    : MINECRAFT_1_13_2;
  const translated = translateBlockState(
    new BlockState({ Name: id, Properties: info.defaults }),
    from,
    BUNDLE_MINECRAFT_VERSION,
  ).Name;
  return Object.hasOwn(colors, translated) ? translated : undefined;
}

/** Kind, mod, shape and colour of a block of `scope`. */
export function lookOf(scope: SearchScope, id: string): BlockLook {
  const mod = scope.modpack?.modBlock(id);
  if (mod) {
    const appearance = mod.appearance;
    return {
      kind: mod.kind,
      mod: mod.mod.name,
      shapeConfidence: mod.kind === "unknown" ? "low" : "high",
      fullCube: mod.fullCube,
      ...(!appearance && !mod.swatch && { visualInfo: false as const }),
      ...(appearance && {
        oklab: appearance.oklab,
        hex: appearance.hex,
        dominant: appearance.dominant,
        variance: appearance.variance,
      }),
    };
  }
  const color = blockColorsForVersion(scope.data).get(id);
  return {
    kind: scope.registry.kind(id),
    mod: VANILLA_MOD,
    shapeConfidence: "high",
    fullCube: color?.fullCube ?? false,
    ...(color && {
      oklab: color.oklab,
      hex: color.hex,
      ...(color.dominant && { dominant: color.dominant }),
      ...(color.variance !== undefined && { variance: color.variance }),
    }),
  };
}

const dominantOutput = z
  .array(z.object({ hex: z.string(), share: z.number() }))
  .optional();

// Fields every result has besides its id and the tool's own.
const lookOutputShape = {
  kind: z.string(),
  mod: z.string(),
  shape_confidence: z.enum(["high", "low"]),
  full_cube: z.boolean(),
  visual_info: z.literal(false).optional(),
  dominant: dominantOutput,
  variance: z.number().optional(),
};

// ── Camo options ───────────────────────────────────────────────────────────

/** Most camo materials one search or palette pairs with the frames. */
const MAX_CAMO_MATERIALS = 3;

const camoOptionOutput = z.object({
  frame: z.string(),
  kind: z.string(),
  slots: z.number(),
  writable: z.boolean(),
  reason: z.string().optional(),
  camo: z.string().optional(),
  camo_hex: z.string().optional(),
  distance: z.number().optional(),
});

// Fields both tools add when they return camo options.
const camoOutputShape = {
  camo_options: z.array(camoOptionOutput).optional(),
  camo_material_rule: z.literal(CAMO_MATERIAL_RULE).optional(),
};

// A query's trailing shape word (`brass_stairs`), with the shape it names.
const SHAPE_WORDS: readonly [string, Shape][] = [
  ["pressure_plates", "pressure_plate"],
  ["pressure_plate", "pressure_plate"],
  ["fence_gates", "fence_gate"],
  ["fence_gate", "fence_gate"],
  ["trapdoors", "trapdoor"],
  ["trapdoor", "trapdoor"],
  ["buttons", "button"],
  ["button", "button"],
  ["stairs", "stairs"],
  ["stair", "stairs"],
  ["slabs", "slab"],
  ["slab", "slab"],
  ["steps", "step"],
  ["step", "step"],
  ["walls", "wall"],
  ["wall", "wall"],
  ["fences", "fence"],
  ["fence", "fence"],
  ["panes", "pane"],
  ["pane", "pane"],
  ["doors", "door"],
  ["door", "door"],
];

/**
 * The material part of a search query and the shape its last word names:
 * `brass_stairs` → `brass` and `stairs`; `brass` → `brass` alone.
 */
export function splitShapeQuery(query: string): {
  material: string;
  shape?: Shape;
} {
  const raw = query.trim().toLowerCase();
  const colon = raw.indexOf(":");
  const prefix = raw.slice(0, colon + 1);
  const name = normalizeBlockName(raw.slice(colon + 1));
  for (const [word, shape] of SHAPE_WORDS) {
    if (name.endsWith(`_${word}`)) {
      return { material: prefix + name.slice(0, -word.length - 1), shape };
    }
  }
  return { material: prefix + name };
}

/** The pack's camo materials with their colours. */
export function camoMaterialsOf(
  scope: SearchScope & { modpack: ModpackBlocks },
) {
  return modpackCamoMaterials(scope.modpack, blockColorsForVersion(scope.data));
}

// ── search_blocks ──────────────────────────────────────────────────────────

export interface BlockSearchHit {
  id: string;
  kind: string;
  mod: string;
  shape_confidence: "high" | "low";
  full_cube: boolean;
  visual_info?: false;
  hex?: string;
  dominant?: DominantColor[];
  variance?: number;
}

export interface SearchBlockIdsOptions {
  /** Match ids of every namespace, not only `minecraft:`. */
  anyNamespace?: boolean;
}

/**
 * Block ids whose path contains `query` (normalised like the registry's name
 * repair): the exact id, then prefix matches, then matches at a word start,
 * then any other substring, each group shortest first, then by id
 * (`minecraft:` first). With `anyNamespace`, a `namespace:` query keeps to
 * that namespace (`create:` alone lists all of its blocks).
 */
export function searchBlockIds(
  ids: Iterable<string>,
  query: string,
  { anyNamespace = false }: SearchBlockIdsOptions = {},
): string[] {
  const raw = query.trim().toLowerCase();
  const colon = raw.indexOf(":");
  // An explicit namespace keeps to it; otherwise vanilla, or every namespace.
  let namespace = anyNamespace ? undefined : NAMESPACE;
  if (colon >= 0) {
    namespace = `${normalizeBlockName(raw.slice(0, colon))}:`;
    if (namespace === ":" || (!anyNamespace && namespace !== NAMESPACE)) {
      return [];
    }
  }
  const needle = normalizeBlockName(raw.slice(colon + 1));
  // Only `namespace:` alone lists a whole namespace.
  if (needle === "" && (colon < 0 || !anyNamespace)) return [];
  const ranked: { id: string; path: string; rank: number; mod: number }[] = [];
  for (const id of ids) {
    const sep = id.indexOf(":");
    const ns = id.slice(0, sep + 1);
    if (namespace !== undefined && ns !== namespace) continue;
    const path = id.slice(sep + 1);
    const at = path.indexOf(needle);
    if (at < 0) continue;
    const rank =
      path === needle ? 0 : at === 0 ? 1 : path.includes(`_${needle}`) ? 2 : 3;
    ranked.push({ id, path, rank, mod: ns === NAMESPACE ? 0 : 1 });
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path) ||
        a.mod - b.mod ||
        a.id.localeCompare(b.id),
    )
    .map((hit) => hit.id);
}

// Far longer than any block name; bounds the work one query costs.
const MAX_QUERY_LENGTH = 200;

const searchBlocksInput = z.object({
  query: z
    .string()
    .max(MAX_QUERY_LENGTH)
    .describe(
      "Part of a block name, e.g. 'oak' or 'stone brick'. minecraft: may be left off; spaces count as underscores. With a modpack, every namespace is searched; 'create:brass' keeps to one mod and 'create:' lists all of its blocks.",
    ),
  version: versionInput,
  modpack: modpackInput,
  shape: shapeInput,
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .optional()
    .describe(
      `Most results to return, 1 to ${MAX_SEARCH_LIMIT}. Defaults to ${DEFAULT_SEARCH_LIMIT}.`,
    ),
});

export const searchBlocksTool = defineTool({
  name: "search_blocks",
  title: "Search blocks",
  description:
    "Find block ids that exist in a Minecraft version, or in a modpack (its version's vanilla blocks plus its mods' blocks), by name and optionally shape. Prefix matches come before other matches. Each result has its kind (block, stairs, slab, wall, log, pane, ..., or unknown for mod blocks whose shape is unclear) with shape_confidence, the mod it comes from (minecraft for vanilla), whether it is a full cube, and when its textures are known its average colour (hex), up to 3 dominant colours with their shares and texture variance (0 flat to 1 busy). Some modpack blocks have no visual information at all (visual_info: false, no colour fields): the server only knows they exist, so don't assume their look from their name. When nothing matches, returns close names instead. With a modpack that has camo blocks (FramedBlocks, Copycats+, Create copycats) and a shape (or a query ending in one, like brass_stairs, when no plain block matches), camo_options also lists camo frames of that shape, each holding a camo material whose name matches the query (camo, camo_hex), with writable false and a reason where the server can't write that camo for the pack's Minecraft version. When the user names a modpack, pass its ref (from list_modpacks) as modpack. Names don't say how a block looks: check candidates with show_blocks.",
  inputSchema: searchBlocksInput,
  outputSchema: z.object({
    version: z.string(),
    modpack: z.string().optional(),
    query: z.string(),
    results: z.array(
      z.object({
        id: z.string(),
        ...lookOutputShape,
        hex: z.string().optional(),
      }),
    ),
    total_matches: z.number(),
    did_you_mean: z.array(z.string()).optional(),
    ...camoOutputShape,
    note: z.string().optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    const scope = await searchScope(args, deps);
    const ids = scope.modpack
      ? [
          ...scope.data.blocks.keys(),
          ...scope.modpack.modBlocks().map((b) => b.id),
        ]
      : scope.data.blocks.keys();
    const named = searchBlockIds(ids, args.query, {
      anyNamespace: scope.modpack !== null,
    });
    const shapes = args.shape ? new Set(args.shape) : undefined;
    const matches = named
      .map((id) => ({ id, look: lookOf(scope, id) }))
      .filter(
        ({ look }) => !shapes || matchesShape(look.kind, look.fullCube, shapes),
      );
    const results: BlockSearchHit[] = matches
      .slice(0, args.limit ?? DEFAULT_SEARCH_LIMIT)
      .map(({ id, look }) => searchHit(id, look));

    const notes: string[] = [];
    const versionNote = scopeNote(scope);
    if (versionNote) notes.push(versionNote);
    if (results.some((hit) => hit.visual_info === false)) {
      notes.push(NO_VISUAL_INFO_NOTE);
    }
    if (shapes && named.length > 0 && matches.length === 0) {
      notes.push(
        `${named.length} block${named.length === 1 ? "" : "s"} match the name, but none has shape ${[...shapes].join(" or ")}.`,
      );
    }

    // Camo frames of the shape asked for, or of the shape the query names
    // when no plain block has it (`brass_stairs` → stairs).
    const split = splitShapeQuery(args.query);
    let camoShapes: ReadonlySet<string> | undefined = shapes;
    if (
      !camoShapes &&
      split.shape &&
      !matches.some(({ look }) => look.kind === split.shape)
    ) {
      camoShapes = new Set([split.shape]);
    }
    let camo: CamoOption[] | undefined;
    if (scope.modpack && camoShapes) {
      const frames = framesOfShapes(
        modpackCamoFrames(scope.modpack),
        camoShapes,
      );
      if (frames.length > 0) {
        const materials = camoMaterialsOf({ ...scope, modpack: scope.modpack });
        const materialIds = searchBlockIds(materials.keys(), split.material, {
          anyNamespace: true,
        })
          .slice(0, MAX_CAMO_MATERIALS)
          .map((id) => materials.get(id)!);
        camo = camoOptions(
          frames,
          materialIds,
          args.limit ?? DEFAULT_SEARCH_LIMIT,
        );
        notes.push(
          materialIds.length > 0
            ? `camo_options are camo frames of the shape holding a matching material (camo). ${CAMO_MATERIAL_NOTE}`
            : `camo_options are camo frames of the shape; no camo material matches "${split.material}", so pick one (a full-cube block) with search_blocks or suggest_palette. ${CAMO_MATERIAL_NOTE}`,
        );
      }
    }
    return jsonResult({
      version: scope.versionId,
      ...(scope.modpack ? { modpack: scope.modpack.ref } : {}),
      query: args.query,
      results,
      total_matches: matches.length,
      ...(named.length === 0
        ? { did_you_mean: scope.registry.suggest(args.query) }
        : {}),
      ...(camo
        ? { camo_options: camo, camo_material_rule: CAMO_MATERIAL_RULE }
        : {}),
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    });
  },
});

function searchHit(id: string, look: BlockLook): BlockSearchHit {
  return {
    id,
    kind: look.kind,
    mod: look.mod,
    shape_confidence: look.shapeConfidence,
    full_cube: look.fullCube,
    ...(look.visualInfo === false && { visual_info: false }),
    ...(look.hex !== undefined && { hex: look.hex }),
    ...(look.dominant !== undefined && { dominant: look.dominant }),
    ...(look.variance !== undefined && { variance: look.variance }),
  };
}

// ── suggest_palette ────────────────────────────────────────────────────────

export function oklabDistance(a: Oklab, b: Oklab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function oklabToHex(oklab: Oklab): string {
  return `#${oklabToSrgb(...oklab)
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rrggbb`, `rrggbb` or `#rgb` → OKLab. */
export function parseHexColor(raw: string): Oklab {
  const match = HEX_COLOR.exec(raw.trim());
  if (!match) {
    throw new Error(
      `Cannot read colour "${raw}"; expected a hex colour such as #7a7a7a.`,
    );
  }
  const hex =
    match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  return srgbToOklab(r, g, b);
}

/**
 * A block's colour for ranking. Without `kind`, the registry's kind is used;
 * without `mod`, it is vanilla.
 */
export interface PaletteColor extends BlockAppearance {
  hex?: string;
  dominant?: DominantColor[];
  variance?: number;
  kind?: string;
  mod?: string;
  shapeConfidence?: "high" | "low";
}

export interface PaletteEntry {
  id: string;
  kind: string;
  mod: string;
  shape_confidence: "high" | "low";
  hex: string;
  distance: number;
  full_cube: boolean;
  dominant?: DominantColor[];
  variance?: number;
}

export interface RankPaletteOptions {
  n: number;
  /** The same as `shapes: {"full_cube"}`. */
  fullCubeOnly?: boolean;
  /** Only blocks of one of these shapes. */
  shapes?: ReadonlySet<Shape>;
  /** The reference block, left out along with blocks of the same colour. */
  exclude?: string;
}

/**
 * The `n` coloured, visible blocks closest to `target`, nearest first. Each
 * colour (as hex) is listed once, so a material's stairs, slabs and walls (which share
 * its colour) don't crowd out other materials; on a tie full cubes come
 * first, then shorter ids. Infested blocks look exactly like their base block
 * and are left out.
 */
export function rankPalette(
  target: Oklab,
  colors: ReadonlyMap<string, PaletteColor>,
  registry: Pick<BlockRegistry, "kind">,
  { n, fullCubeOnly = false, shapes, exclude }: RankPaletteOptions,
): PaletteEntry[] {
  const wanted =
    shapes ?? (fullCubeOnly ? new Set<Shape>(["full_cube"]) : undefined);
  const kindOf = (id: string, color: PaletteColor) =>
    color.kind ?? registry.kind(id);
  const ranked: { id: string; color: PaletteColor; d: number }[] = [];
  for (const [id, color] of colors) {
    if (id === exclude || isInvisibleBlockId(id)) continue;
    if (id.startsWith(`${NAMESPACE}infested_`)) continue;
    if (wanted && !matchesShape(kindOf(id, color), color.fullCube, wanted)) {
      continue;
    }
    ranked.push({ id, color, d: oklabDistance(target, color.oklab) });
  }
  ranked.sort(
    (a, b) =>
      a.d - b.d ||
      Number(b.color.fullCube) - Number(a.color.fullCube) ||
      a.id.length - b.id.length ||
      a.id.localeCompare(b.id),
  );
  const hexOf = (color: PaletteColor) => color.hex ?? oklabToHex(color.oklab);
  const excluded = exclude === undefined ? undefined : colors.get(exclude);
  // Keyed by the hex returned: distinct OKLab triples can round to one hex.
  const seen = new Set(excluded ? [hexOf(excluded)] : []);
  const out: PaletteEntry[] = [];
  for (const { id, color, d } of ranked) {
    if (out.length >= n) break;
    const hex = hexOf(color);
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push({
      id,
      kind: kindOf(id, color),
      mod: color.mod ?? VANILLA_MOD,
      shape_confidence: color.shapeConfidence ?? "high",
      hex,
      distance: Math.round(d * 1000) / 1000,
      full_cube: color.fullCube,
      ...(color.dominant !== undefined && { dominant: color.dominant }),
      ...(color.variance !== undefined && { variance: color.variance }),
    });
  }
  return out;
}

// Vanilla plus mod colours, per pack.
const packColorCache = new WeakMap<
  ModpackBlocks,
  ReadonlyMap<string, PaletteColor>
>();

/**
 * Colours of every block of `scope`. Camo blocks are left out: they look
 * like whatever camo they hold, not like their frame texture.
 */
function paletteColors(scope: SearchScope): ReadonlyMap<string, PaletteColor> {
  const vanilla = blockColorsForVersion(scope.data);
  const pack = scope.modpack;
  if (!pack) return vanilla;
  const cached = packColorCache.get(pack);
  if (cached) return cached;
  const colors = new Map<string, PaletteColor>(vanilla);
  for (const block of pack.modBlocks()) {
    if (!block.appearance || block.camo) continue;
    colors.set(block.id, {
      oklab: block.appearance.oklab,
      fullCube: block.fullCube,
      hex: block.appearance.hex,
      dominant: block.appearance.dominant,
      variance: block.appearance.variance,
      kind: block.kind,
      mod: block.mod.name,
      shapeConfidence: block.kind === "unknown" ? "low" : "high",
    });
  }
  packColorCache.set(pack, colors);
  return colors;
}

const suggestPaletteInput = z.object({
  color: z
    .string()
    .optional()
    .describe(
      "Target colour as hex, e.g. #7a7a7a. Give this or reference_block.",
    ),
  reference_block: z
    .string()
    .optional()
    .describe(
      "A block id whose colour is the target, e.g. minecraft:oak_planks. Give this or color; the block and blocks of exactly its colour (its stairs, slabs, ...) are left out of the results.",
    ),
  version: versionInput,
  modpack: modpackInput,
  n: z
    .number()
    .int()
    .min(1)
    .max(MAX_PALETTE_SIZE)
    .optional()
    .describe(
      `How many blocks to return, 1 to ${MAX_PALETTE_SIZE}. Defaults to ${DEFAULT_PALETTE_SIZE}.`,
    ),
  shape: shapeInput,
  full_cube_only: z
    .boolean()
    .optional()
    .describe(
      'Only suggest blocks that fill the whole cube (no slabs, stairs, plants, ...). The same as shape: ["full_cube"].',
    ),
});

export const suggestPaletteTool = defineTool({
  name: "suggest_palette",
  title: "Suggest a palette",
  description:
    "Suggest blocks of a Minecraft version, or of a modpack (its version's vanilla blocks plus its mods' blocks), whose average colour is closest to a hex colour or to another block, ranked by OKLab distance (smaller is closer), optionally only of some shapes. Each colour is listed once (a material's stairs, slabs and walls share its colour, so find those with search_blocks or a shape filter). Each result has its kind with shape_confidence, its mod (minecraft for vanilla), hex colour, up to 3 dominant colours with their shares, texture variance (0 flat to 1 busy) and whether it is a full cube. Modpack blocks without visual information (visual_info: false in search_blocks and show_blocks) are never suggested and can't be a reference_block; don't assume their look from their name. With a modpack that has camo blocks and a shape, camo_options also lists camo frames of that shape holding the camo materials nearest the colour (camo, camo_hex, distance), with writable false and a reason where the server can't write that camo for the pack's Minecraft version. When the user names a modpack, pass its ref (from list_modpacks) as modpack. Check the picks with show_blocks before building with them.",
  inputSchema: suggestPaletteInput,
  outputSchema: z.object({
    version: z.string(),
    modpack: z.string().optional(),
    target: z.object({
      hex: z.string(),
      reference_block: z.string().optional(),
    }),
    blocks: z.array(
      z.object({
        id: z.string(),
        ...lookOutputShape,
        hex: z.string(),
        distance: z.number(),
      }),
    ),
    ...camoOutputShape,
    note: z.string().optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    const hasColor = args.color !== undefined && args.color.trim() !== "";
    const hasReference =
      args.reference_block !== undefined && args.reference_block.trim() !== "";
    if (hasColor === hasReference) {
      throw new Error("Give exactly one of color or reference_block.");
    }
    if (args.full_cube_only && args.shape) {
      throw new Error(
        'Give shape or full_cube_only, not both (full_cube_only is shape: ["full_cube"]).',
      );
    }
    // Check the colour before loading any data.
    const colorTarget = hasColor ? parseHexColor(args.color!) : undefined;
    const scope = await searchScope(args, deps);
    const colors = paletteColors(scope);

    let target: Oklab;
    let reference: string | undefined;
    if (colorTarget) {
      target = colorTarget;
    } else {
      const raw = args.reference_block!.trim();
      const checked = scope.registry.validateState(raw.replace(/\[.*$/, ""));
      if (!checked.ok) throw new Error(checked.error);
      reference = checked.id;
      const look = colors.get(reference) ?? lookOf(scope, reference);
      if ("visualInfo" in look && look.visualInfo === false) {
        throw new Error(
          `${reference} has no visual information (visual_info: false), so it has no colour to match; pick another reference_block or give a color. Don't assume its look from its name.`,
        );
      }
      if (!look.oklab) {
        throw new Error(
          `${reference} has no colour data (it may be invisible or have no texture); pick another reference_block or give a color.`,
        );
      }
      target = look.oklab;
    }

    const n = args.n ?? DEFAULT_PALETTE_SIZE;
    const shapes = args.shape
      ? new Set(args.shape)
      : args.full_cube_only
        ? new Set<Shape>(["full_cube"])
        : undefined;
    const blocks = rankPalette(target, colors, scope.registry, {
      n,
      shapes,
      exclude: reference,
    });

    // Camo frames of the shape, holding the materials nearest the target.
    let camo: CamoOption[] | undefined;
    if (scope.modpack && shapes) {
      const frames = framesOfShapes(modpackCamoFrames(scope.modpack), shapes);
      if (frames.length > 0) {
        const materials = rankPalette(
          target,
          camoMaterialsOf({ ...scope, modpack: scope.modpack }),
          scope.registry,
          { n: MAX_CAMO_MATERIALS, exclude: reference },
        );
        camo = camoOptions(frames, materials, n);
      }
    }
    const notes = [scopeNote(scope)];
    if (camo) {
      notes.push(
        `camo_options are camo frames of the shape holding the camo materials nearest the colour. ${CAMO_MATERIAL_NOTE}`,
      );
    }
    const note = notes.filter(Boolean).join(" ");
    return jsonResult({
      version: scope.versionId,
      ...(scope.modpack ? { modpack: scope.modpack.ref } : {}),
      target: {
        hex: oklabToHex(target),
        ...(reference ? { reference_block: reference } : {}),
      },
      blocks,
      ...(camo
        ? { camo_options: camo, camo_material_rule: CAMO_MATERIAL_RULE }
        : {}),
      ...(note ? { note } : {}),
    });
  },
});
