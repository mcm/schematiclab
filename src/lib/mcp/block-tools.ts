// `search_blocks` and `suggest_palette`: block ids of one Minecraft version
// (`lib/blockdata`), found by name or ranked by OKLab distance to a colour.
// Colours come from `block-colors.json` (the vanilla asset bundle's version);
// ids renamed since a requested version are translated to the bundle's names
// to find their colour, but results always use the requested version's ids.

import { z } from "zod";
import {
  loadBlockData,
  type BlockData,
  type BlockInfo,
} from "../blockdata/load";
import {
  createBlockRegistry,
  normalizeBlockName,
  type BlockRegistry,
} from "../blockdata/registry";
import { isInvisibleBlockId } from "../invisible-blocks";
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
import { vanillaBlockColors } from "./render";
import { defineTool, jsonResult, type McpDeps } from "./types";

export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_PALETTE_SIZE = 16;
export const DEFAULT_PALETTE_SIZE = 8;

const NAMESPACE = "minecraft:";

// minecraft-data's 1.13.2 blocks (1.12.2 and 1.13.x), which KNOWN_VERSIONS
// doesn't list.
const MINECRAFT_1_13_2: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 13, 2],
  dataVersion: 1631,
};

function checkVersion(raw: string): string {
  const versionId = raw.trim();
  if (!Object.hasOwn(KNOWN_VERSIONS, versionId)) {
    throw new Error(
      `Unknown Minecraft version '${versionId}'. Call list_versions for the supported versions.`,
    );
  }
  return versionId;
}

interface VersionBlocks {
  versionId: string;
  data: BlockData;
  registry: BlockRegistry;
}

// 1.12.2's flattened block data → only the blocks 1.12.2 has, per source map.
const legacyCache = new WeakMap<
  ReadonlyMap<string, BlockInfo>,
  Map<string, BlockInfo>
>();

/**
 * `data` with only the blocks a schematic for `versionId` can hold. 1.12.2's
 * data is 1.13.2's flattened ids, so blocks added in 1.13 (stripped logs,
 * coral, ...) are dropped: those the Shape Generator can't write as a Forge
 * 1.12 state.
 */
export function blocksOfVersion(data: BlockData, versionId: string): BlockData {
  if (!data.translateOnExport) return data;
  let blocks = legacyCache.get(data.blocks);
  if (!blocks) {
    blocks = new Map();
    for (const [id, info] of data.blocks) {
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

async function versionBlocks(
  raw: string,
  deps: McpDeps,
): Promise<VersionBlocks> {
  const versionId = checkVersion(raw);
  const data = blocksOfVersion(
    await loadBlockData(versionId, { fetch: deps.fetch }),
    versionId,
  );
  return { versionId, data, registry: createBlockRegistry(data, versionId) };
}

const versionNote = (data: BlockData) =>
  data.translateOnExport
    ? "Ids are flattened (1.13+) names; schematic writers translate them to 1.12.2 blocks."
    : undefined;

// ── search_blocks ──────────────────────────────────────────────────────────

export interface BlockSearchHit {
  id: string;
  kind: string;
}

/**
 * Block ids whose path contains `query` (normalised like the registry's name
 * repair): the exact id, then prefix matches, then matches at a word start,
 * then any other substring, each group shortest first, then by id.
 */
export function searchBlockIds(ids: Iterable<string>, query: string): string[] {
  const needle = normalizeBlockName(query);
  if (needle === "") return [];
  const ranked: { id: string; path: string; rank: number }[] = [];
  for (const id of ids) {
    if (!id.startsWith(NAMESPACE)) continue;
    const path = id.slice(NAMESPACE.length);
    const at = path.indexOf(needle);
    if (at < 0) continue;
    const rank =
      path === needle ? 0 : at === 0 ? 1 : path.includes(`_${needle}`) ? 2 : 3;
    ranked.push({ id, path, rank });
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path),
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
      "Part of a block name, e.g. 'oak' or 'stone brick'. minecraft: may be left off; spaces count as underscores.",
    ),
  version: z
    .string()
    .describe("The Minecraft version, as listed by list_versions."),
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
    "Find block ids that exist in a Minecraft version by name. Prefix matches come before other matches; each result has its kind (block, stairs, slab, wall, log, pane, ...). When nothing matches, returns close names instead.",
  inputSchema: searchBlocksInput,
  outputSchema: z.object({
    version: z.string(),
    query: z.string(),
    results: z.array(z.object({ id: z.string(), kind: z.string() })),
    total_matches: z.number(),
    did_you_mean: z.array(z.string()).optional(),
    note: z.string().optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    const { versionId, data, registry } = await versionBlocks(
      args.version,
      deps,
    );
    const matches = searchBlockIds(data.blocks.keys(), args.query);
    const results: BlockSearchHit[] = matches
      .slice(0, args.limit ?? DEFAULT_SEARCH_LIMIT)
      .map((id) => ({ id, kind: registry.kind(id) }));
    return jsonResult({
      version: versionId,
      query: args.query,
      results,
      total_matches: matches.length,
      ...(matches.length === 0
        ? { did_you_mean: registry.suggest(args.query) }
        : {}),
      ...(versionNote(data) ? { note: versionNote(data) } : {}),
    });
  },
});

// ── suggest_palette ────────────────────────────────────────────────────────

type Oklab = BlockAppearance["oklab"];

// Block id → colour, per block data source.
const colorCache = new WeakMap<
  ReadonlyMap<string, unknown>,
  Map<string, BlockAppearance>
>();

/**
 * Colours for every block of `data`, keyed by the version's own ids. An id
 * the colour bundle lacks is translated to the bundle's version (default
 * state) and takes that block's colour.
 */
export function blockColorsForVersion(
  data: BlockData,
): Map<string, BlockAppearance> {
  const cached = colorCache.get(data.blocks);
  if (cached) return cached;
  const colors = vanillaBlockColors();
  const from = Object.hasOwn(KNOWN_VERSIONS, data.sourceVersion)
    ? KNOWN_VERSIONS[data.sourceVersion]
    : MINECRAFT_1_13_2;
  const out = new Map<string, BlockAppearance>();
  for (const [id, info] of data.blocks) {
    let appearance = Object.hasOwn(colors, id) ? colors[id] : undefined;
    if (!appearance) {
      const translated = translateBlockState(
        new BlockState({ Name: id, Properties: info.defaults }),
        from,
        BUNDLE_MINECRAFT_VERSION,
      ).Name;
      if (Object.hasOwn(colors, translated)) appearance = colors[translated];
    }
    if (appearance) out.set(id, appearance);
  }
  colorCache.set(data.blocks, out);
  return out;
}

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

export interface PaletteEntry {
  id: string;
  kind: string;
  hex: string;
  distance: number;
  full_cube: boolean;
}

export interface RankPaletteOptions {
  n: number;
  fullCubeOnly?: boolean;
  /** The reference block, left out along with blocks of the same colour. */
  exclude?: string;
}

const colorKey = (oklab: Oklab) => oklab.join(",");

/**
 * The `n` coloured, visible blocks closest to `target`, nearest first. Each
 * colour is listed once, so a material's stairs, slabs and walls (which share
 * its colour) don't crowd out other materials; on a tie full cubes come
 * first, then shorter ids. Infested blocks look exactly like their base block
 * and are left out.
 */
export function rankPalette(
  target: Oklab,
  colors: ReadonlyMap<string, BlockAppearance>,
  registry: BlockRegistry,
  { n, fullCubeOnly = false, exclude }: RankPaletteOptions,
): PaletteEntry[] {
  const ranked: { id: string; appearance: BlockAppearance; d: number }[] = [];
  for (const [id, appearance] of colors) {
    if (id === exclude || isInvisibleBlockId(id)) continue;
    if (id.startsWith(`${NAMESPACE}infested_`)) continue;
    if (fullCubeOnly && !appearance.fullCube) continue;
    ranked.push({ id, appearance, d: oklabDistance(target, appearance.oklab) });
  }
  ranked.sort(
    (a, b) =>
      a.d - b.d ||
      Number(b.appearance.fullCube) - Number(a.appearance.fullCube) ||
      a.id.length - b.id.length ||
      a.id.localeCompare(b.id),
  );
  const excluded = exclude === undefined ? undefined : colors.get(exclude);
  const seen = new Set(excluded ? [colorKey(excluded.oklab)] : []);
  const out: PaletteEntry[] = [];
  for (const { id, appearance, d } of ranked) {
    if (out.length >= n) break;
    const key = colorKey(appearance.oklab);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      kind: registry.kind(id),
      hex: oklabToHex(appearance.oklab),
      distance: Math.round(d * 1000) / 1000,
      full_cube: appearance.fullCube,
    });
  }
  return out;
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
  version: z
    .string()
    .describe("The Minecraft version, as listed by list_versions."),
  n: z
    .number()
    .int()
    .min(1)
    .max(MAX_PALETTE_SIZE)
    .optional()
    .describe(
      `How many blocks to return, 1 to ${MAX_PALETTE_SIZE}. Defaults to ${DEFAULT_PALETTE_SIZE}.`,
    ),
  full_cube_only: z
    .boolean()
    .optional()
    .describe(
      "Only suggest blocks that fill the whole cube (no slabs, stairs, plants, ...).",
    ),
});

export const suggestPaletteTool = defineTool({
  name: "suggest_palette",
  title: "Suggest a palette",
  description:
    "Suggest blocks of a Minecraft version whose average colour is closest to a hex colour or to another block, ranked by OKLab distance (smaller is closer). Each colour is listed once (a material's stairs, slabs and walls share its colour, so find those with search_blocks). Each result has its kind, hex colour and whether it is a full cube.",
  inputSchema: suggestPaletteInput,
  outputSchema: z.object({
    version: z.string(),
    target: z.object({
      hex: z.string(),
      reference_block: z.string().optional(),
    }),
    blocks: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        hex: z.string(),
        distance: z.number(),
        full_cube: z.boolean(),
      }),
    ),
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
    // Check the colour before loading any data.
    const colorTarget = hasColor ? parseHexColor(args.color!) : undefined;
    const { versionId, data, registry } = await versionBlocks(
      args.version,
      deps,
    );
    const colors = blockColorsForVersion(data);

    let target: Oklab;
    let reference: string | undefined;
    if (colorTarget) {
      target = colorTarget;
    } else {
      const raw = args.reference_block!.trim();
      const checked = registry.validateState(raw.replace(/\[.*$/, ""));
      if (!checked.ok) throw new Error(checked.error);
      reference = checked.id;
      const appearance = colors.get(reference);
      if (!appearance) {
        throw new Error(
          `${reference} has no colour data (it may be invisible or have no texture); pick another reference_block or give a color.`,
        );
      }
      target = appearance.oklab;
    }

    const blocks = rankPalette(target, colors, registry, {
      n: args.n ?? DEFAULT_PALETTE_SIZE,
      fullCubeOnly: args.full_cube_only,
      exclude: reference,
    });
    return jsonResult({
      version: versionId,
      target: {
        hex: oklabToHex(target),
        ...(reference ? { reference_block: reference } : {}),
      },
      blocks,
      ...(versionNote(data) ? { note: versionNote(data) } : {}),
    });
  },
});
