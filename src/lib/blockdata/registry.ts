// Block registry over one version's loaded block data: block state
// validation, shape kinds, material families (a base material → its stairs,
// slab, wall…) and repair of sloppy block names ("Glass Panes",
// "minecraft:Planks"). Name rules, families and aliases follow Cairn's
// `registry.py`, checked against the version's data instead of a fixed
// 1.21.4 list.
//
// Every id this module returns is `minecraft:`-prefixed. Mod blocks are not
// covered: an id in another namespace never exists here.
//
// Imports carry their `.ts` extension so node's strip-types can load this
// file (see `load.ts`).

import { loadBlockData } from "./load.ts";
import type { BlockData, BlockDataDeps } from "./load.ts";

export type BlockKind =
  | "air"
  | "block"
  | "stairs"
  | "slab"
  | "wall"
  | "fence"
  | "fence_gate"
  | "door"
  | "trapdoor"
  | "pane"
  | "log"
  | "pillar"
  | "button"
  | "pressure_plate"
  | "lever"
  | "bed"
  | "torch"
  | "wall_torch"
  | "lantern"
  | "carpet"
  | "chest"
  | "sign"
  | "banner"
  | "pot"
  | "leaves"
  | "plant"
  | "flat"
  | "glass";

export const FAMILY_VARIANTS = [
  "block",
  "stairs",
  "slab",
  "wall",
  "fence",
  "fence_gate",
  "door",
  "trapdoor",
  "log",
  "pillar",
  "button",
  "pressure_plate",
] as const;

export type FamilyVariant = (typeof FAMILY_VARIANTS)[number];

export type Family = Partial<Record<FamilyVariant, string>>;

export interface VariantResult {
  id: string;
  /** Set when a fallback was used, describing it. */
  note?: string;
}

export type RepairResult =
  | { id: string; note?: string }
  | { id: null; suggestions: string[] };

export type StateValidation =
  | {
      ok: true;
      id: string;
      /** The properties the state names. */
      properties: Record<string, string>;
      /** Every property of the block: the defaults overlaid with `properties`. */
      state: Record<string, string>;
    }
  | { ok: false; error: string };

export interface BlockRegistry {
  /** The Minecraft version the registry was built for. */
  version: string;
  exists(id: string): boolean;
  /** Property name → allowed values, or undefined for an unknown block. */
  properties(id: string): Record<string, string[]> | undefined;
  /** Property name → default value, or undefined for an unknown block. */
  defaults(id: string): Record<string, string> | undefined;
  /** Checks a full block state such as `minecraft:oak_stairs[half=top]`. */
  validateState(state: string): StateValidation;
  kind(id: string): BlockKind;
  family(base: string): Family;
  /** One variant of a material family, falling back with a note. */
  variant(base: string, variant: string): VariantResult | null;
  repair(raw: string): RepairResult;
  /** Up to `n` known block ids whose names are close to `name`. */
  suggest(name: string, n?: number): string[];
}

const NAMESPACE = "minecraft:";

// Common LLM mistakes → block path (T2BM's repairer, as extended by Cairn).
const ALIASES: Record<string, string> = {
  planks: "oak_planks",
  wood_planks: "oak_planks",
  wooden_planks: "oak_planks",
  log: "oak_log",
  wood: "oak_log",
  door: "oak_door",
  wooden_door: "oak_door",
  stairs: "oak_stairs",
  slab: "oak_slab",
  fence: "oak_fence",
  trapdoor: "oak_trapdoor",
  bed: "red_bed",
  carpet: "white_carpet",
  wool: "white_wool",
  concrete: "white_concrete",
  glass_panes: "glass_pane",
  window: "glass_pane",
  pane: "glass_pane",
  stone_brick: "stone_bricks",
  brick: "bricks",
  brick_block: "bricks",
  cobble: "cobblestone",
  mossy_cobble: "mossy_cobblestone",
  grass: "grass_block",
  leaves: "oak_leaves",
  terracota: "terracotta",
  light: "lantern",
  iron_ingot: "iron_block",
  thatch: "hay_block",
  straw: "hay_block",
  empty: "air",
  nothing: "air",
  void: "air",
};

const WOODS = new Set([
  "oak",
  "spruce",
  "birch",
  "jungle",
  "acacia",
  "dark_oak",
  "mangrove",
  "cherry",
  "pale_oak",
  "bamboo",
  "crimson",
  "warped",
]);

// A wood missing from an older version → the closest-looking older wood.
// Chains end at oak, which every version has.
const WOOD_FALLBACKS: Record<string, string> = {
  pale_oak: "birch",
  cherry: "birch",
  mangrove: "jungle",
  bamboo: "oak",
  crimson: "dark_oak",
  warped: "dark_oak",
};

// A missing variant → the variant that keeps the build looking right.
const VARIANT_FALLBACKS: Partial<Record<FamilyVariant, FamilyVariant>> = {
  pillar: "block",
  log: "block",
  wall: "fence",
  fence: "wall",
  fence_gate: "fence",
  trapdoor: "slab",
};

const PLANTS = new Set([
  "grass",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "dandelion",
  "poppy",
  "blue_orchid",
  "allium",
  "azure_bluet",
  "oxeye_daisy",
  "cornflower",
  "lily_of_the_valley",
  "sunflower",
  "lilac",
  "rose_bush",
  "peony",
  "sweet_berry_bush",
]);

/** Lowercases, drops `minecraft:` and turns spaces and dashes into `_`. */
export function normalizeBlockName(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (s.startsWith(NAMESPACE)) s = s.slice(NAMESPACE.length);
  return s.replace(/[\s-]+/g, "_");
}

// The block path of a `minecraft:` id (or a bare path), or null for another
// namespace.
function pathOf(id: string): string | null {
  if (id.startsWith(NAMESPACE)) return id.slice(NAMESPACE.length);
  return id.includes(":") ? null : id;
}

function isVariant(value: string): value is FamilyVariant {
  return (FAMILY_VARIANTS as readonly string[]).includes(value);
}

/** The shape class of a block id, from its name (and `axis` for pillars). */
function kindOf(path: string, hasAxis: boolean): BlockKind {
  if (path === "air" || path.endsWith("_air")) return "air";
  if (path.endsWith("_stairs")) return "stairs";
  if (path.endsWith("_slab")) return "slab";
  if (path.endsWith("_pane") || path === "iron_bars") return "pane";
  if (path.endsWith("_fence_gate")) return "fence_gate";
  if (path.endsWith("_fence")) return "fence";
  if (path.endsWith("_wall") && !path.includes("wall_")) return "wall";
  if (path.endsWith("_trapdoor")) return "trapdoor";
  if (path.endsWith("_door")) return "door";
  if (path.endsWith("_bed")) return "bed";
  if (path.endsWith("_carpet")) return "carpet";
  if (path.endsWith("wall_torch")) return "wall_torch";
  if (path === "torch" || path.endsWith("_torch")) return "torch";
  if (
    path === "lantern" ||
    (path.endsWith("_lantern") &&
      path !== "sea_lantern" &&
      path !== "jack_o_lantern")
  ) {
    return "lantern";
  }
  if (path.endsWith("_button")) return "button";
  if (path.endsWith("_pressure_plate")) return "pressure_plate";
  if (path === "lever") return "lever";
  if (path === "chest" || path === "trapped_chest" || path === "ender_chest") {
    return "chest";
  }
  if (path.endsWith("_sign")) return "sign";
  if (path.endsWith("_banner")) return "banner";
  if (path === "flower_pot" || path.startsWith("potted_")) return "pot";
  if (path.endsWith("_leaves")) return "leaves";
  if (
    PLANTS.has(path) ||
    path.endsWith("_tulip") ||
    path.endsWith("_sapling")
  ) {
    return "plant";
  }
  if (path === "ladder" || path === "vine") return "flat";
  if (
    path === "glass" ||
    path === "tinted_glass" ||
    path.endsWith("_stained_glass")
  ) {
    return "glass";
  }
  if (/_(log|wood|stem|hyphae)$/.test(path)) return "log";
  if (hasAxis) return "pillar";
  return "block";
}

// Candidate stems for building variant names from a base material name.
function stems(base: string): string[] {
  const out = [base];
  for (const suffix of ["_planks", "_block", "s"]) {
    if (base.endsWith(suffix)) out.push(base.slice(0, -suffix.length));
  }
  // stone_bricks → stone_brick, deepslate_tiles → deepslate_tile
  if (base.endsWith("_bricks") || base.endsWith("_tiles")) {
    out.push(base.slice(0, -1));
  }
  for (const suffix of ["_log", "_wood", "_stem", "_hyphae"]) {
    if (base.endsWith(suffix)) out.push(base.slice(0, -suffix.length));
  }
  return [...new Set(out)];
}

/**
 * Ratcliff/Obershelp similarity (Python's `difflib.SequenceMatcher.ratio`):
 * twice the matched characters over the total length.
 */
export function similarity(a: string, b: string): number {
  const total = a.length + b.length;
  return total === 0
    ? 1
    : (2 * matchedChars(a, 0, a.length, b, 0, b.length)) / total;
}

function matchedChars(
  a: string,
  alo: number,
  ahi: number,
  b: string,
  blo: number,
  bhi: number,
): number {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  // runs[j] = length of the common run ending at a[i - 1], b[j - 1].
  let runs = new Array<number>(bhi - blo + 1).fill(0);
  for (let i = alo; i < ahi; i++) {
    const next = new Array<number>(bhi - blo + 1).fill(0);
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const size = runs[j - blo] + 1;
      next[j - blo + 1] = size;
      if (size > bestSize) {
        bestI = i - size + 1;
        bestJ = j - size + 1;
        bestSize = size;
      }
    }
    runs = next;
  }
  if (bestSize === 0) return 0;
  return (
    bestSize +
    matchedChars(a, alo, bestI, b, blo, bestJ) +
    matchedChars(a, bestI + bestSize, ahi, b, bestJ + bestSize, bhi)
  );
}

const STATE_PATTERN = /^([a-z0-9_.-]+:)?([a-z0-9_./-]+)(?:\[([^\]]*)\])?$/;

export function createBlockRegistry(
  data: BlockData,
  version: string = data.sourceVersion,
): BlockRegistry {
  const { blocks } = data;
  const paths = [...blocks.keys()].flatMap((id) => pathOf(id) ?? []);
  const known = new Set(paths);
  const families = new Map<string, Family>();

  const info = (id: string) => {
    const path = pathOf(id.trim());
    return path === null ? undefined : blocks.get(NAMESPACE + path);
  };
  const has = (path: string) => known.has(path);
  const full = (path: string) => NAMESPACE + path;

  function suggest(name: string, n = 3): string[] {
    const target = normalizeBlockName(name);
    return paths
      .map((path) => ({ path, score: similarity(target, path) }))
      .filter((c) => c.score >= 0.6)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, n)
      .map((c) => full(c.path));
  }

  function unknownBlock(id: string): string {
    const hints = suggest(id);
    const hint = hints.length > 0 ? ` Did you mean: ${hints.join(", ")}?` : "";
    return `Unknown block "${id}" in Minecraft ${version}.${hint}`;
  }

  function validateState(raw: string): StateValidation {
    const text = raw.trim();
    const match = STATE_PATTERN.exec(text);
    if (!match) {
      return {
        ok: false,
        error: `Cannot parse block state "${raw}"; expected namespace:id[property=value,...].`,
      };
    }
    const [, namespace = NAMESPACE, path, list] = match;
    const id = namespace + path;
    const block = namespace === NAMESPACE ? blocks.get(id) : undefined;
    if (!block) return { ok: false, error: unknownBlock(id) };

    const properties: Record<string, string> = {};
    const names = Object.keys(block.properties);
    for (const pair of list?.trim() ? list.split(",") : []) {
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (eq < 0 || !name || !value) {
        return {
          ok: false,
          error: `Cannot parse "${pair.trim()}" in "${raw}"; expected property=value.`,
        };
      }
      if (!Object.prototype.hasOwnProperty.call(block.properties, name)) {
        return {
          ok: false,
          error:
            names.length === 0
              ? `${id} has no properties, so "${name}" is not allowed.`
              : `${id} has no property "${name}"; its properties are ${names.join(", ")}.`,
        };
      }
      if (Object.prototype.hasOwnProperty.call(properties, name)) {
        return {
          ok: false,
          error: `Property "${name}" is set twice in "${raw}".`,
        };
      }
      const allowed = block.properties[name];
      if (!allowed.includes(value)) {
        return {
          ok: false,
          error: `${id} property "${name}" cannot be "${value}"; allowed values for ${name}: ${allowed.join(", ")}.`,
        };
      }
      properties[name] = value;
    }
    return {
      ok: true,
      id,
      properties,
      state: { ...block.defaults, ...properties },
    };
  }

  function kind(id: string): BlockKind {
    const path = id.trim().replace(/^[^:]*:/, "");
    const axis = info(id)?.properties.axis;
    // Logs and pillars stand upright; nether portals and chains only take
    // x and z, or are not solid.
    const upright = axis?.includes("y") === true && path !== "chain";
    return kindOf(path, upright);
  }

  function family(rawBase: string): Family {
    const base = normalizeBlockName(rawBase);
    const cached = families.get(base);
    if (cached) return cached;
    const fam: Family = {};
    if (WOODS.has(base) || has(`${base}_planks`)) {
      if (has(`${base}_planks`)) fam.block = full(`${base}_planks`);
      const log = [`${base}_log`, `${base}_stem`, `${base}_block`].find(has);
      if (log) {
        fam.log = full(log);
        fam.pillar = full(log);
      }
    } else if (has(base)) {
      fam.block = full(base);
    }
    const baseStems = stems(base);
    for (const v of FAMILY_VARIANTS) {
      if (v === "block" || fam[v]) continue;
      const found = baseStems.map((stem) => `${stem}_${v}`).find(has);
      if (found) fam[v] = full(found);
    }
    if (!fam.pillar && fam.block) {
      // Many stones have a pillar-ish block.
      for (const stem of baseStems) {
        const found = [
          `${stem}_pillar`,
          `chiseled_${base}`,
          `${stem}_log`,
        ].find(has);
        if (found) {
          fam.pillar = full(found);
          break;
        }
      }
    }
    families.set(base, fam);
    return fam;
  }

  function variant(rawBase: string, rawVariant: string): VariantResult | null {
    const base = normalizeBlockName(rawBase);
    const name = normalizeBlockName(rawVariant);
    // "planks" is how people ask for a wood's full block.
    const v = name === "planks" ? "block" : name;
    if (!isVariant(v)) return null;
    const fam = family(base);
    const hit = fam[v];
    if (hit) return { id: hit };

    if (Object.keys(fam).length === 0 && WOODS.has(base)) {
      // A wood this version doesn't have yet: use an older one.
      const older = WOOD_FALLBACKS[base] ?? "oak";
      const result = variant(older, v);
      if (!result) return null;
      const why = `'${base}' does not exist in Minecraft ${version}; used ${result.id}`;
      return {
        id: result.id,
        note: result.note ? `${why} (${result.note})` : why,
      };
    }
    if (v === "block") return null;
    const fallback = VARIANT_FALLBACKS[v];
    const alternative = fallback ? fam[fallback] : undefined;
    if (alternative) {
      return {
        id: alternative,
        note: `'${base}' has no ${name}; used ${alternative}`,
      };
    }
    if (fam.block) {
      return {
        id: fam.block,
        note: `'${base}' has no ${name}; used full block ${fam.block}`,
      };
    }
    return null;
  }

  function repair(raw: string): RepairResult {
    const s = normalizeBlockName(raw);
    if (has(s)) {
      const id = full(s);
      return raw === s || raw === id
        ? { id }
        : { id, note: `normalized '${raw}' -> '${id}'` };
    }
    const repaired = (path: string, why = "") => ({
      id: full(path),
      note: `repaired '${raw}' -> '${full(path)}'${why}`,
    });
    if (Object.prototype.hasOwnProperty.call(ALIASES, s) && has(ALIASES[s])) {
      return repaired(ALIASES[s]);
    }
    // Plural and singular slips.
    const slip = [
      s.replace(/s+$/, ""),
      s.replace(/es$/, ""),
      `${s}s`,
      s.replace("_blocks", "_block"),
    ].find(has);
    if (slip) return repaired(slip);
    // Missing wood or colour prefix (T2BM's "incomplete name").
    const prefixed = [`oak_${s}`, `white_${s}`].find(has);
    if (prefixed) return repaired(prefixed, " (missing prefix)");
    return { id: null, suggestions: suggest(s) };
  }

  return {
    version,
    exists: (id) => info(id) !== undefined,
    properties: (id) => info(id)?.properties,
    defaults: (id) => info(id)?.defaults,
    validateState,
    kind,
    family,
    variant,
    repair,
    suggest,
  };
}

/** Loads a version's block data (cached) and wraps it in a registry. */
export async function loadBlockRegistry(
  version: string,
  deps: BlockDataDeps,
): Promise<BlockRegistry> {
  return createBlockRegistry(await loadBlockData(version, deps), version);
}
