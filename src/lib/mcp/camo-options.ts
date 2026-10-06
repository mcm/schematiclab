// Camo frames of a modpack for block search: the pack's FramedBlocks and
// copycat blocks that the camo shape packs (`public/camo-shapes/`, read from
// disk on the server) can draw, the vanilla shape each one gives, the camo
// materials the pack offers, and whether the server writes their camo for
// the pack's Minecraft version (`CAMO_WRITE_VERSIONS`).
//
// The mods decide what a frame accepts as camo with tags, config and block
// classes that aren't in the jar data, so materials are approximated: full
// cubes that aren't camo frames themselves or known block-entity blocks.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CAMO_BLOCK_IDS,
  DOUBLE_CAMO_BLOCK_IDS,
} from "../camo/camo-blocks.generated";
import { isCamoCapableBlockId } from "../camo/extract";
import { camoWriteReason } from "../camo/write-versions";
import { isInvisibleBlockId } from "../invisible-blocks";
import type { ModpackBlocks } from "../modpacks/registry";
import type { BlockAppearance } from "../render/block-appearance";
import { SHAPE_PACK_NAMESPACES } from "../render/camo/pack-loader";
import {
  matchShapeRule,
  validateShapePack,
  type ShapePack,
} from "../render/camo/shape-pack";
import { applyTemplateOverrides } from "../render/camo/template-overrides";

const SHAPE_PACK_DIR = path.join(process.cwd(), "public", "camo-shapes");

/** Says how camo materials are picked; results carry it. */
export const CAMO_MATERIAL_RULE = "approximate";

export const CAMO_MATERIAL_NOTE =
  "Camo materials are approximate: full-cube blocks that aren't camo frames or known block-entity blocks. The mods' own checks (tags, config) may refuse some.";

/**
 * The vanilla shape a camo frame takes, for the frames that are a camo
 * version of a vanilla shape. Other frames (slopes, panels, pillars...) are
 * never offered for a shape.
 */
const FRAME_KINDS: Readonly<Record<string, string>> = {
  "framedblocks:framed_cube": "block",
  "copycats:copycat_block": "block",
  "framedblocks:framed_stairs": "stairs",
  "copycats:copycat_stairs": "stairs",
  "framedblocks:framed_slab": "slab",
  "copycats:copycat_slab": "slab",
  "framedblocks:framed_wall": "wall",
  "copycats:copycat_wall": "wall",
  "framedblocks:framed_fence": "fence",
  "copycats:copycat_fence": "fence",
  "framedblocks:framed_fence_gate": "fence_gate",
  "copycats:copycat_fence_gate": "fence_gate",
  "framedblocks:framed_pane": "pane",
  "framedblocks:framed_bars": "pane",
  "copycats:copycat_pane": "pane",
  "framedblocks:framed_door": "door",
  "framedblocks:framed_iron_door": "door",
  "copycats:copycat_door": "door",
  "copycats:copycat_iron_door": "door",
  "framedblocks:framed_trapdoor": "trapdoor",
  "framedblocks:framed_iron_trapdoor": "trapdoor",
  "copycats:copycat_trapdoor": "trapdoor",
  "copycats:copycat_iron_trapdoor": "trapdoor",
  "framedblocks:framed_button": "button",
  "framedblocks:framed_stone_button": "button",
  "copycats:copycat_stone_button": "button",
  "copycats:copycat_wooden_button": "button",
  "framedblocks:framed_pressure_plate": "pressure_plate",
  "framedblocks:framed_stone_pressure_plate": "pressure_plate",
  "framedblocks:framed_gold_pressure_plate": "pressure_plate",
  "framedblocks:framed_iron_pressure_plate": "pressure_plate",
  "framedblocks:framed_obsidian_pressure_plate": "pressure_plate",
  "copycats:copycat_stone_pressure_plate": "pressure_plate",
  "copycats:copycat_wooden_pressure_plate": "pressure_plate",
  "copycats:copycat_light_weighted_pressure_plate": "pressure_plate",
  "copycats:copycat_heavy_weighted_pressure_plate": "pressure_plate",
};

/** The shape-bearing frame ids, for tests. */
export const CAMO_FRAME_IDS: readonly string[] = Object.keys(FRAME_KINDS);

// Vanilla blocks with a block entity (chests, furnaces, spawners...): not
// offered as camo materials, since the mods don't take most of them.
const BLOCK_ENTITY_BLOCKS: ReadonlySet<string> = new Set(
  [
    "barrel",
    "beacon",
    "bee_nest",
    "beehive",
    "blast_furnace",
    "brewing_stand",
    "calibrated_sculk_sensor",
    "campfire",
    "chain_command_block",
    "chest",
    "chiseled_bookshelf",
    "command_block",
    "comparator",
    "conduit",
    "crafter",
    "creaking_heart",
    "daylight_detector",
    "decorated_pot",
    "dispenser",
    "dropper",
    "enchanting_table",
    "end_gateway",
    "end_portal",
    "ender_chest",
    "furnace",
    "hopper",
    "jigsaw",
    "jukebox",
    "lectern",
    "moving_piston",
    "repeating_command_block",
    "sculk_catalyst",
    "sculk_sensor",
    "sculk_shrieker",
    "shulker_box",
    "smoker",
    "soul_campfire",
    "spawner",
    "structure_block",
    "suspicious_gravel",
    "suspicious_sand",
    "test_block",
    "test_instance_block",
    "trapped_chest",
    "trial_spawner",
    "vault",
  ].map((name) => `minecraft:${name}`),
);
const BLOCK_ENTITY_SUFFIXES = [
  "_banner",
  "_bed",
  "_head",
  "_shulker_box",
  "_sign",
  "_skull",
];

/** Whether `id` is a vanilla block known to have a block entity. */
export function isKnownBlockEntityBlock(id: string): boolean {
  return (
    BLOCK_ENTITY_BLOCKS.has(id) ||
    (id.startsWith("minecraft:") &&
      BLOCK_ENTITY_SUFFIXES.some((suffix) => id.endsWith(suffix)))
  );
}

// ── Shape packs ────────────────────────────────────────────────────────────

const shapePacks = new Map<string, ShapePack | null>();

/**
 * The shape pack of `namespace` from `public/camo-shapes/`, read once per
 * instance; null when there is none or it is invalid.
 */
export function serverShapePack(namespace: string): ShapePack | null {
  if (shapePacks.has(namespace)) return shapePacks.get(namespace)!;
  let pack: ShapePack | null = null;
  if (SHAPE_PACK_NAMESPACES.includes(namespace)) {
    try {
      pack = validateShapePack(
        JSON.parse(
          readFileSync(path.join(SHAPE_PACK_DIR, `${namespace}.json`), "utf8"),
        ),
      );
    } catch (err) {
      console.warn("Ignoring camo shape pack %s", namespace, err);
    }
  }
  shapePacks.set(namespace, pack);
  return pack;
}

// Namespace → shape pack with the pack's own templates, per modpack.
const modpackPackCache = new WeakMap<
  ModpackBlocks,
  Map<string, ShapePack | null>
>();

/**
 * The shape pack of `namespace` as `modpack` draws it: the jars'
 * FramedBlocks templates replace the pack's pieces of the same template.
 */
export function modpackShapePack(
  modpack: ModpackBlocks,
  namespace: string,
): ShapePack | null {
  let packs = modpackPackCache.get(modpack);
  if (!packs) modpackPackCache.set(modpack, (packs = new Map()));
  if (packs.has(namespace)) return packs.get(namespace)!;
  const base = serverShapePack(namespace);
  const pack =
    base && applyTemplateOverrides(base, modpack.data.framedTemplates ?? {});
  packs.set(namespace, pack);
  return pack;
}

// ── Frames ─────────────────────────────────────────────────────────────────

export interface CamoFrame {
  id: string;
  namespace: string;
  /** The vanilla shape it takes (`stairs`, `block`...), or `unknown`. */
  kind: string;
  /** Camo slots: 2 for FramedBlocks double blocks. */
  slots: number;
  writable: boolean;
  /** Why it isn't writable. */
  reason?: string;
}

const CAMO_BLOCKS: ReadonlySet<string> = new Set(CAMO_BLOCK_IDS);
const DOUBLE_CAMO_BLOCKS: ReadonlySet<string> = new Set(DOUBLE_CAMO_BLOCK_IDS);

const frameCache = new WeakMap<ModpackBlocks, readonly CamoFrame[]>();

/**
 * The pack's camo frames: its camo-capable blocks that save camo and whose
 * default state has a rule in their namespace's shape pack. Sorted by id.
 */
export function modpackCamoFrames(
  modpack: ModpackBlocks,
): readonly CamoFrame[] {
  const cached = frameCache.get(modpack);
  if (cached) return cached;
  const frames: CamoFrame[] = [];
  const seen = new Set<string>();
  for (const block of modpack.data.blocks) {
    const { id } = block;
    if (seen.has(id) || !isCamoCapableBlockId(id) || !CAMO_BLOCKS.has(id)) {
      continue;
    }
    seen.add(id);
    const namespace = id.slice(0, id.indexOf(":"));
    const rules = modpackShapePack(modpack, namespace)?.blocks[id];
    if (!rules || matchShapeRule(rules, block.defaults) === null) continue;
    const reason = camoWriteReason(namespace, modpack.minecraftVersion);
    frames.push({
      id,
      namespace,
      kind: Object.hasOwn(FRAME_KINDS, id) ? FRAME_KINDS[id] : "unknown",
      slots: DOUBLE_CAMO_BLOCKS.has(id) ? 2 : 1,
      writable: reason === undefined,
      ...(reason !== undefined && { reason }),
    });
  }
  frames.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  frameCache.set(modpack, frames);
  return frames;
}

/**
 * The frames that take one of `shapes`: their kind, or `full_cube` for
 * full-block frames. Writable frames first.
 */
export function framesOfShapes(
  frames: readonly CamoFrame[],
  shapes: ReadonlySet<string>,
): CamoFrame[] {
  return frames
    .filter(
      (f) =>
        shapes.has(f.kind) || (f.kind === "block" && shapes.has("full_cube")),
    )
    .sort((a, b) => Number(b.writable) - Number(a.writable));
}

// ── Materials ──────────────────────────────────────────────────────────────

export interface CamoMaterial extends BlockAppearance {
  id: string;
  hex: string;
}

const materialCache = new WeakMap<
  ModpackBlocks,
  ReadonlyMap<string, CamoMaterial>
>();

/**
 * The pack's camo materials with their colours: vanilla (`vanilla`, the
 * version's colours) and mod blocks that are full cubes, aren't
 * camo-capable and aren't known block-entity blocks.
 */
export function modpackCamoMaterials(
  modpack: ModpackBlocks,
  vanilla: ReadonlyMap<string, BlockAppearance & { hex: string }>,
): ReadonlyMap<string, CamoMaterial> {
  const cached = materialCache.get(modpack);
  if (cached) return cached;
  const materials = new Map<string, CamoMaterial>();
  const add = (id: string, color: BlockAppearance & { hex: string }) => {
    if (
      !color.fullCube ||
      isCamoCapableBlockId(id) ||
      isKnownBlockEntityBlock(id) ||
      isInvisibleBlockId(id) ||
      id.startsWith("minecraft:infested_")
    ) {
      return;
    }
    materials.set(id, {
      id,
      oklab: color.oklab,
      fullCube: true,
      hex: color.hex,
    });
  };
  for (const [id, color] of vanilla) add(id, color);
  for (const block of modpack.modBlocks()) {
    if (!block.appearance || block.camo) continue;
    add(block.id, { ...block.appearance, fullCube: block.fullCube });
  }
  materialCache.set(modpack, materials);
  return materials;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface CamoOption {
  frame: string;
  kind: string;
  slots: number;
  writable: boolean;
  reason?: string;
  /** The camo material, when one matched the query or colour. */
  camo?: string;
  /** The material's average colour. */
  camo_hex?: string;
  /** OKLab distance of the material to suggest_palette's target. */
  distance?: number;
}

/**
 * Each frame with each material (best material first), or the bare frames
 * when no material matched; at most `limit`.
 */
export function camoOptions(
  frames: readonly CamoFrame[],
  materials: readonly { id: string; hex: string; distance?: number }[],
  limit: number,
): CamoOption[] {
  const bare = (frame: CamoFrame): CamoOption => ({
    frame: frame.id,
    kind: frame.kind,
    slots: frame.slots,
    writable: frame.writable,
    ...(frame.reason !== undefined && { reason: frame.reason }),
  });
  const options =
    materials.length === 0
      ? frames.map(bare)
      : materials.flatMap((material) =>
          frames.map((frame) => ({
            ...bare(frame),
            camo: material.id,
            camo_hex: material.hex,
            ...(material.distance !== undefined && {
              distance: material.distance,
            }),
          })),
        );
  return options.slice(0, limit);
}
