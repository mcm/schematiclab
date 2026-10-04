// Asset-based stand-ins for the runtime checks the block-type detection
// makes in Java (block classes, block-state property counts, items).
//
// The Java checks are in Moonlight Lib (MehVahdJukaar, Xel'Bayria and the
// Supplementaries Team, https://github.com/MehVahdJukaar/Moonlight, branch
// 1.21, commit 72afa38, Supplementaries Team License):
// `WoodTypeRegistry.detectTypeFromBlock` (`getProperties().size() <= 2`,
// `instanceof SlabBlock`) and `LeavesTypeRegistry.detectTypeFromBlock`
// (`instanceof LeavesBlock`). We only have blockstate and model JSON, which
// list the properties that pick a model, not every property, so each check
// below is a heuristic; the comments say how.
//
// Worker-safe: no DOM access.

import { MINECRAFT, normalizeId, parseId } from "./java-compat";
import type { BlockTypeWorld } from "./types";

/** Property name → values seen in a blockstate JSON (variants or multipart). */
export function blockstateProperties(
  blockstate: unknown,
): Map<string, Set<string>> {
  const props = new Map<string, Set<string>>();
  const add = (name: string, value: string) => {
    let values = props.get(name);
    if (!values) props.set(name, (values = new Set()));
    for (const v of value.split("|")) values.add(v);
  };
  if (!isObject(blockstate)) return props;
  const variants = blockstate.variants;
  if (isObject(variants)) {
    for (const key of Object.keys(variants)) {
      for (const part of key.split(",")) {
        const eq = part.indexOf("=");
        if (eq > 0) add(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      }
    }
  }
  const visitWhen = (when: unknown) => {
    if (!isObject(when)) return;
    for (const [name, value] of Object.entries(when)) {
      if ((name === "OR" || name === "AND") && Array.isArray(value)) {
        value.forEach(visitWhen);
      } else {
        add(name, String(value));
      }
    }
  };
  if (Array.isArray(blockstate.multipart)) {
    for (const part of blockstate.multipart) {
      if (isObject(part)) visitWhen(part.when);
    }
  }
  return props;
}

/** Every model id a blockstate JSON references, normalized (`ns:block/x`). */
export function blockstateModels(blockstate: unknown): string[] {
  const out = new Set<string>();
  const visit = (apply: unknown) => {
    for (const a of Array.isArray(apply) ? apply : [apply]) {
      if (isObject(a) && typeof a.model === "string") {
        out.add(normalizeId(a.model));
      }
    }
  };
  if (isObject(blockstate)) {
    if (isObject(blockstate.variants)) {
      Object.values(blockstate.variants).forEach(visit);
    }
    if (Array.isArray(blockstate.multipart)) {
      for (const part of blockstate.multipart) {
        if (isObject(part)) visit(part.apply);
      }
    }
  }
  return [...out];
}

/** `model` and its parents, normalized, nearest first (cycle-safe). */
export function modelChain(world: BlockTypeWorld, model: string): string[] {
  const chain: string[] = [];
  let id: string | undefined = normalizeId(model);
  while (id && !chain.includes(id) && chain.length < 32) {
    chain.push(id);
    const json = world.model(id);
    id =
      isObject(json) && typeof json.parent === "string"
        ? normalizeId(json.parent)
        : undefined;
  }
  return chain;
}

function anyModelReaches(
  world: BlockTypeWorld,
  blockstate: unknown,
  parents: ReadonlySet<string>,
): boolean {
  return blockstateModels(blockstate).some((m) =>
    modelChain(world, m).some((id) => parents.has(id)),
  );
}

const SLAB_MODELS: ReadonlySet<string> = new Set([
  "minecraft:block/slab",
  "minecraft:block/slab_top",
]);

/**
 * Planks check: Java requires at most 2 block-state properties and not a
 * `SlabBlock`. Approximation: the property names the blockstate JSON
 * mentions (a lower bound: properties that never change the model, such as
 * `waterlogged`, are invisible), and a slab is a block whose `type` property
 * takes `bottom`/`top`/`double` or whose model chain reaches
 * `minecraft:block/slab(_top)`. A block without a blockstate passes.
 */
export function passesPlanksBlockCheck(
  world: BlockTypeWorld,
  blockId: string,
): boolean {
  const blockstate = world.blockstate(blockId);
  if (blockstate === undefined) return true;
  const props = blockstateProperties(blockstate);
  if (props.size > 2) return false;
  const type = props.get("type");
  if (type && (type.has("bottom") || type.has("top") || type.has("double"))) {
    return false;
  }
  return !anyModelReaches(world, blockstate, SLAB_MODELS);
}

/** Vanilla 1.21.1 `LeavesBlock`s. */
const VANILLA_LEAVES: ReadonlySet<string> = new Set(
  [
    "oak",
    "spruce",
    "birch",
    "jungle",
    "acacia",
    "cherry",
    "dark_oak",
    "mangrove",
    "azalea",
    "flowering_azalea",
  ].map((x) => `minecraft:${x}_leaves`),
);

/** Properties a `LeavesBlock` (or a full-cube subclass) would not have. */
const NON_LEAVES_PROPERTIES: ReadonlySet<string> = new Set([
  "facing",
  "half",
  "type",
  "layers",
  "axis",
  "shape",
  "hinge",
  "open",
  "rotation",
  "face",
  "attached",
  "hanging",
  "north",
  "east",
  "south",
  "west",
  "up",
  "down",
]);

/** Parents of non-cube shapes (carpets, piles, plants, slabs…). */
const NON_LEAVES_MODELS: ReadonlySet<string> = new Set([
  "minecraft:block/slab",
  "minecraft:block/slab_top",
  "minecraft:block/stairs",
  "minecraft:block/carpet",
  "minecraft:block/cross",
  "minecraft:block/tinted_cross",
  "minecraft:block/flower_pot_cross",
  "minecraft:block/thin_block",
  "minecraft:block/pressure_plate_up",
  "minecraft:block/button",
  "minecraft:block/fence_post",
  "minecraft:block/wall_post",
  "minecraft:block/template_wall_post",
]);

/**
 * `baseBlock instanceof LeavesBlock`. Approximation: vanilla leaves by id;
 * for mod blocks, rejected when the blockstate uses a property no leaves
 * block has (facing, half, type, layers, connections…) or when a model's
 * parent chain reaches a non-cube vanilla parent (carpet, cross, slab…).
 * Leaves subclasses with extra state (fruit `age`) still pass. A block
 * without a blockstate passes.
 */
export function isLeavesBlock(world: BlockTypeWorld, blockId: string): boolean {
  if (parseId(blockId).namespace === MINECRAFT) {
    return VANILLA_LEAVES.has(blockId);
  }
  const blockstate = world.blockstate(blockId);
  if (blockstate === undefined) return true;
  for (const name of blockstateProperties(blockstate).keys()) {
    if (NON_LEAVES_PROPERTIES.has(name)) return false;
  }
  return !anyModelReaches(world, blockstate, NON_LEAVES_MODELS);
}

/**
 * Vanilla 1.21.1 blocks without an item, among the ids the detection looks
 * up as items (saplings, boats, gems, dusts…). `BlockTypeWorld.hasItem`
 * assumes every block has an item; these are the exceptions that matter
 * here (e.g. `minecraft:bamboo_sapling` must not replace bamboo's sapling).
 */
const VANILLA_ITEMLESS_BLOCKS: ReadonlySet<string> = new Set(
  [
    "air",
    "cave_air",
    "void_air",
    "water",
    "lava",
    "fire",
    "soul_fire",
    "bamboo_sapling",
    "bubble_column",
    "moving_piston",
    "piston_head",
    "redstone_wire",
    "tripwire",
    "nether_portal",
    "end_portal",
    "end_gateway",
    "frosted_ice",
    "kelp_plant",
    "tall_seagrass",
    "cocoa",
    "carrots",
    "potatoes",
    "beetroots",
    "sweet_berry_bush",
    "cave_vines",
    "cave_vines_plant",
    "weeping_vines_plant",
    "twisting_vines_plant",
    "pumpkin_stem",
    "melon_stem",
    "attached_pumpkin_stem",
    "attached_melon_stem",
    "torchflower_crop",
    "pitcher_crop",
    "big_dripleaf_stem",
    "wall_torch",
    "soul_wall_torch",
    "redstone_wall_torch",
    "water_cauldron",
    "lava_cauldron",
    "powder_snow_cauldron",
  ].map((x) => `minecraft:${x}`),
);

const VANILLA_ITEMLESS_PATTERN =
  /^minecraft:(?:potted_\w+|\w+_wall_sign|\w+_wall_hanging_sign|\w+_wall_banner|\w+_wall_head|\w+_wall_skull|\w+_wall_fan|\w+_candle_cake)$/;

/** `BuiltInRegistries.ITEM.containsKey(id)`, from `world.hasItem`. */
export function hasItem(world: BlockTypeWorld, id: string): boolean {
  if (VANILLA_ITEMLESS_BLOCKS.has(id) || VANILLA_ITEMLESS_PATTERN.test(id)) {
    return false;
  }
  return world.hasItem(id);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
