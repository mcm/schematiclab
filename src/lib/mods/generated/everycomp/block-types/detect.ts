// Block-type detection for the Every Compat family: which wood, leaves,
// stone, mud, crystal, dust, metal and gem types exist in a set of loaded
// mods, and which blocks/items each type has as children.
//
// Port of:
// - Moonlight Lib (by MehVahdJukaar, Xel'Bayria and the Supplementaries Team,
//   https://github.com/MehVahdJukaar/Moonlight, branch 1.21, commit 72afa38):
//   `core/set/BlockSetInternal` (registry order), `api/set/BlockTypeRegistry`
//   (`buildAll`, `register`, `finalizeAndFreeze`), `api/set/BlockType`
//   (`addChild`, `findRelatedEntry`, `getTypeName`), `api/set/wood/WoodType`,
//   `WoodTypeRegistry`, `api/set/leaves/LeavesType`, `LeavesTypeRegistry`.
// - Stone Zone (same authors, https://github.com/Xelbayria/Stone-Zone, branch
//   1.21, commit d17ed21): `api/set/RockType`, `stone/StoneType(Registry)`,
//   `mud/MudType(Registry)`.
// - Gems Realm (by Xelbayria, https://github.com/Xelbayria/Gems-Realm, branch
//   1.21.1, commit 66b66be): `api/set/RockType`, `gem/GemType(Registry)`,
//   `metal/MetalType(Registry)`, `crystal/CrystalType(Registry)`,
//   `dust/DustType(Registry)`.
// All under the Supplementaries Team License. Every Compat (commit 556d936)
// only consumes these registries.
//
// Lifecycle (BlockSetInternal.initializeBlockSets): every registry runs
// `buildAll` (vanilla types, then hardcoded finders in add order, then
// `detectTypeFromBlock` over every block in registry order; the first
// registration of an id wins), then every registry runs `finalizeAndFreeze`
// (`initializeChildrenBlocks` on each type, then `initializeChildrenItems`
// on each). Registries are sorted by `priority()` descending, ties in
// registration order (Moonlight registers wood, leaves; Stone Zone stone, mud;
// Gems Realm crystal, dust, metal, gem): all six addon registries are 110,
// wood 100, leaves 99, so the order is stone, mud, crystal, dust, metal, gem,
// wood, leaves. Since every build runs before any finalize and no detection
// reads another registry, the order only matters for leaves: its
// `finalizeAndFreeze` links leaves to wood types after wood is built.
//
// Runtime-only Java checks are approximated from assets in
// `approximations.ts`; the rest is noted where it happens.
//
// Worker-safe: no DOM access.

import {
  hasItem,
  isLeavesBlock,
  passesPlanksBlockCheck,
} from "./approximations";
import type { FinderRef, FinderSpec } from "./finder";
import {
  CRYSTAL_FINDERS,
  DUST_FINDERS,
  GEM_FINDERS,
  GR_BLACKLISTED_CRYSTALTYPES,
  GR_BLACKLISTED_DUST_MODS,
  GR_BLACKLISTED_DUSTTYPES,
  GR_BLACKLISTED_GEMTYPES,
  GR_BLACKLISTED_METALTYPES,
  GR_BLACKLISTED_MODS,
  GR_KEYS,
  METAL_FINDERS,
  VANILLA_CRYSTAL_TYPES,
  VANILLA_DUST_TYPES,
  VANILLA_GEM_TYPES,
  VANILLA_METAL_TYPES,
} from "./gems";
import {
  LEAVES_FINDERS,
  LEAVES_IGNORED_MODS,
  leavesToWoodMappings,
  VANILLA_LEAVES_TYPES,
  VANILLA_STRIPPABLES,
  VANILLA_WOOD_TYPES,
  WOOD_FINDERS,
  WOOD_IGNORED_MODS,
  WOOD_KEYS,
} from "./hardcoded-wood";
import {
  javaHashMapOrder,
  javaReplace,
  MINECRAFT,
  parseId,
} from "./java-compat";
import {
  MUD_FINDERS,
  ROCK_KEYS,
  STONE_FINDERS,
  SZ_BLACKLISTED_MODS,
  SZ_BLACKLISTED_STONETYPES,
  VANILLA_MUD_TYPES,
  VANILLA_STONE_TYPES,
} from "./stone";
import type {
  BlockTypeChild,
  BlockTypeKind,
  BlockTypeRegistries,
  BlockTypeWorld,
  DetectedBlockType,
} from "./types";

// ── Public helpers ────────────────────────────────────────────────────────

/** `BlockType.getTypeName`: the id's path after the last `/`. */
export function typeNameOf(id: string): string {
  const { path } = parseId(id);
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The child key of each kind's `mainChild()`: wood → planks, leaves →
 * leaves; Stone Zone's `RockType` and Gems Realm's `RockType` store the
 * stone / mud / gem / metal / crystal / dust block under `"block"`
 * (`VanillaStoneChildKeys.STONE`, `VanillaMudChildKeys.MUD` and Gems Realm's
 * `BLOCK` are all `"block"`).
 */
export function mainChildKey(kind: BlockTypeKind): string {
  switch (kind) {
    case "wood":
      return WOOD_KEYS.PLANKS;
    case "leaves":
      return WOOD_KEYS.LEAVES;
    default:
      return "block";
  }
}

/** The vanilla types of a kind, in registration order (default type first). */
export function vanillaBlockTypeIds(kind: BlockTypeKind): string[] {
  return VANILLA_TABLES[kind].map((v) => v.id);
}

const VANILLA_TABLES: Record<BlockTypeKind, readonly { id: string }[]> = {
  wood: VANILLA_WOOD_TYPES,
  leaves: VANILLA_LEAVES_TYPES,
  stone: VANILLA_STONE_TYPES,
  mud: VANILLA_MUD_TYPES,
  gem: VANILLA_GEM_TYPES,
  metal: VANILLA_METAL_TYPES,
  crystal: VANILLA_CRYSTAL_TYPES,
  dust: VANILLA_DUST_TYPES,
};

// ── Types and children ────────────────────────────────────────────────────

class MutableBlockType implements DetectedBlockType {
  readonly namespace: string;
  /** Full id path (may contain `/`). */
  readonly path: string;
  readonly typeName: string;
  readonly children = new Map<string, BlockTypeChild>();
  bambooLike?: boolean;

  constructor(
    readonly kind: BlockTypeKind,
    readonly id: string,
    /** `mainChild()` block (planks, leaves, stone, …). */
    readonly main: string,
    /** Wood only: `WoodType.log`. */
    readonly log?: string,
  ) {
    const parsed = parseId(id);
    this.namespace = parsed.namespace;
    this.path = parsed.path;
    this.typeName = typeNameOf(id);
  }

  /**
   * `BlockType.addChild` on a `HashBiMap<String, Object>`: null is ignored;
   * the same object already under the key is a no-op; an object already
   * bound to another key throws inside a try/catch (so the earlier key
   * keeps it); otherwise the key is put, replacing its old value in place.
   */
  addChild(key: string, child: BlockTypeChild | undefined): void {
    if (!child) return;
    const current = this.children.get(key);
    if (current && sameChild(current, child)) return;
    for (const [k, v] of this.children) {
      if (k !== key && sameChild(v, child)) return;
    }
    this.children.set(key, child);
  }

  /**
   * `getBlockOfThis(key)`: the child if it is a block, or the block of a
   * `BlockItem` (approximated: an item child whose id is also a block).
   */
  blockOf(ctx: Ctx, key: string): string | undefined {
    const child = this.children.get(key);
    if (!child) return undefined;
    if (!child.item) return child.id;
    return ctx.world.hasBlock(child.id) ? child.id : undefined;
  }
}

function sameChild(a: BlockTypeChild, b: BlockTypeChild): boolean {
  return a.id === b.id && !a.item === !b.item;
}

interface Ctx {
  world: BlockTypeWorld;
  /** `PlatHelper.isModLoaded`; `minecraft` is always loaded. */
  loaded(modId: string): boolean;
  hasBlock(id: string): boolean;
  hasItem(id: string): boolean;
  /** Gems Realm `RockType.childInfix` (static, set by techreborn blocks). */
  grChildInfix: string;
}

type Registry = "block" | "item";

/** `Utils.findFirstInRegistry` over block or item ids. */
function findFirst(
  ctx: Ctx,
  ids: readonly string[],
  registry: Registry,
): BlockTypeChild | undefined {
  for (const id of ids) {
    if (registry === "block" ? ctx.hasBlock(id) : ctx.hasItem(id)) {
      return registry === "item" ? { id, item: true } : { id };
    }
  }
  return undefined;
}

const firstBlock = (ctx: Ctx, ids: readonly string[]) =>
  findFirst(ctx, ids, "block")?.id;

const isTfc = (namespace: string) => namespace === "tfc" || namespace === "afc";

// ── Registry definitions ──────────────────────────────────────────────────

interface KindDef {
  kind: BlockTypeKind;
  priority: number;
  vanilla(): MutableBlockType[];
  finders: readonly FinderSpec[];
  /** The finder's default main-block lookup. */
  defaultMain(ctx: Ctx, id: string): string | undefined;
  detect(
    ctx: Ctx,
    types: ReadonlyMap<string, MutableBlockType>,
    blockId: string,
  ): MutableBlockType | undefined;
  initializeChildrenBlocks(ctx: Ctx, t: MutableBlockType): void;
  initializeChildrenItems(ctx: Ctx, t: MutableBlockType): void;
}

// ── Moonlight wood ────────────────────────────────────────────────────────

/** `WoodType.makeKnownIDConventionsAffix`. */
function woodIdConventionsAffix(
  namespace: string,
  path: string,
  prefixOrInfix: string,
  suffix: string,
  alternate: string | undefined,
): string[] {
  const noneEmpty = prefixOrInfix !== "" && suffix !== "";
  const prefix_ = prefixOrInfix ? `${prefixOrInfix}_` : "";
  const _infix = prefixOrInfix ? `_${prefixOrInfix}` : "";
  const _suffix = suffix ? `_${suffix}` : "";
  const out = [
    path + _infix + _suffix,
    path + _suffix + _infix,
    prefix_ + path + _suffix,
  ];
  if (alternate !== undefined) out.push(alternate + _infix + _suffix);
  if (noneEmpty && alternate !== undefined) {
    out.push(prefix_ + alternate + _suffix);
  }
  // For things like grimwood_wood -> grimwood
  if (path.endsWith(suffix)) out.push(prefix_ + path);
  return out.map((p) => `${namespace}:${p}`);
}

/** `WoodType.makeKnownIDConventions`. */
function woodIdConventions(id: string, ...affixes: string[]): string[] {
  const { namespace, path } = parseId(id);
  return affixes.flatMap((a) => [
    ...woodIdConventionsAffix(namespace, path, "", a, undefined),
    ...woodIdConventionsAffix(namespace, path, a, "", undefined),
  ]);
}

const findLog = (ctx: Ctx, id: string) =>
  firstBlock(ctx, woodIdConventions(id, "log", "stem", "stalk", "hyphae"));
const findPlanks = (ctx: Ctx, id: string) =>
  firstBlock(ctx, woodIdConventions(id, "planks", "plank"));

/** `WoodType.defaultIsBambooLike`: the last path segment contains "bamboo". */
export function defaultIsBambooLike(id: string): boolean {
  return typeNameOf(id).includes("bamboo");
}

function newWood(
  id: string,
  planks: string,
  log: string,
  bambooLike = defaultIsBambooLike(id),
): MutableBlockType {
  const t = new MutableBlockType("wood", id, planks, log);
  t.bambooLike = bambooLike;
  return t;
}

/** `WoodType.findRelatedEntry(prefixOrInfix, suffix, reg)` (5 candidates). */
function woodRelated(
  ctx: Ctx,
  t: MutableBlockType,
  infix: string,
  suffix: string,
  registry: Registry,
): BlockTypeChild | undefined {
  const s = suffix ? `_${suffix}` : "";
  const { namespace: ns, path: p } = t;
  return findFirst(
    ctx,
    [
      `${ns}:${p}_${infix}${s}`,
      `${ns}:${infix}_${p}${s}`,
      `${ns}:${p}_planks_${infix}${s}`,
      `${ns}:wood/planks/${p}_${infix}`,
      `${ns}:wood/${infix}${s}/${p}`,
    ],
    registry,
  );
}

/** `WoodType.findLogWithAffix`. */
function findLogWithAffix(
  ctx: Ctx,
  t: MutableBlockType,
  prefix: string,
  suffix: string,
): string | undefined {
  if (isTfc(t.namespace)) {
    const prefix_ = prefix ? `${prefix}_` : "";
    const tfc = `${t.namespace}:wood/${prefix_}${suffix}/${t.path}`;
    if (ctx.hasBlock(tfc)) return tfc;
  }
  return firstBlock(
    ctx,
    woodIdConventionsAffix(
      t.namespace,
      t.path,
      prefix,
      suffix,
      parseId(t.log!).path,
    ),
  );
}

/** `WoodType.findLogRelatedBlock`. */
function findLogRelatedBlock(
  ctx: Ctx,
  t: MutableBlockType,
  prefix: string,
  suffixes: readonly string[],
): BlockTypeChild | undefined {
  for (const s of suffixes) {
    const b = findLogWithAffix(ctx, t, prefix, s);
    if (b) return { id: b };
  }
  return undefined;
}

/**
 * `WoodType.findStrippedLog`: the first named child `AxeItem.STRIPPABLES`
 * maps (vanilla pairs only, see `VANILLA_STRIPPABLES`), else the names as
 * suffixes of `stripped` log-like ids.
 */
function findStrippedLog(
  ctx: Ctx,
  t: MutableBlockType,
  names: readonly string[],
): BlockTypeChild | undefined {
  for (const v of names) {
    const b = t.blockOf(ctx, v);
    const stripped = b ? VANILLA_STRIPPABLES.get(b) : undefined;
    if (stripped && stripped !== b) return { id: stripped };
  }
  return findLogRelatedBlock(ctx, t, "stripped", names);
}

const K = WOOD_KEYS;

const WOOD: KindDef = {
  kind: "wood",
  priority: 100,
  vanilla: () =>
    VANILLA_WOOD_TYPES.map((v) => {
      const t = newWood(v.id, v.planks, v.log);
      for (const [key, id] of v.children ?? []) t.addChild(key, { id });
      return t;
    }),
  // The registry constructor's own `minecraft:bamboo` finder is dead code:
  // vanilla bamboo is registered first. Not ported.
  finders: WOOD_FINDERS,
  defaultMain: findPlanks,
  detect(ctx, types, blockId) {
    const { namespace, path } = parseId(blockId);
    // TerraFirmaCraft & ArborFirmaCraft
    if (isTfc(namespace)) {
      if (path.includes("wood/planks/")) {
        const log = `${namespace}:${javaReplace(path, "planks", "log")}`;
        if (ctx.hasBlock(log)) {
          const id = `${namespace}:${javaReplace(path, "wood/planks/", "")}`;
          return newWood(id, blockId, log);
        }
      }
      return undefined;
    }
    let name: string | undefined;
    if (path.endsWith("_planks")) name = path.slice(0, -"_planks".length);
    else if (path.startsWith("planks_")) name = path.slice("planks_".length);
    else if (path.endsWith("_plank")) name = path.slice(0, -"_plank".length);
    else if (path.startsWith("plank_")) name = path.slice("plank_".length);
    if (name === undefined || WOOD_IGNORED_MODS.has(namespace)) return;
    // `getProperties().size() <= 2 && !(baseBlock instanceof SlabBlock)`:
    // approximated from the blockstate, see approximations.ts.
    if (!passesPlanksBlockCheck(ctx.world, blockId)) return undefined;
    const id = `${namespace}:${javaReplace(name, "/", "_")}`;
    const log = findLog(ctx, id);
    if (log && !types.has(id)) return newWood(id, blockId, log);
    return undefined;
  },
  initializeChildrenBlocks(ctx, t) {
    const related = (key: string) => woodRelated(ctx, t, key, "", "block");
    t.addChild(K.PLANKS, { id: t.main });
    t.addChild(K.LOG, { id: t.log! });
    t.addChild(K.LEAVES, related("leaves"));
    t.addChild(
      K.WOOD,
      findLogRelatedBlock(ctx, t, "", ["wood", "hyphae", "bark"]),
    );
    t.addChild(
      K.STRIPPED_LOG,
      findStrippedLog(ctx, t, [K.LOG, "stem", "stalk"]),
    );
    t.addChild(
      K.STRIPPED_WOOD,
      findStrippedLog(ctx, t, [K.WOOD, "hyphae", "bark"]),
    );
    t.addChild(K.SLAB, related("slab"));
    t.addChild(K.STAIRS, related("stairs"));
    const fence = related("fence");
    t.addChild(K.FENCE, fence);
    t.addChild(K.FENCE_GATE, related("fence_gate"));
    t.addChild(K.DOOR, related("door"));
    t.addChild(K.TRAPDOOR, related("trapdoor"));
    t.addChild(K.BUTTON, related("button"));
    t.addChild(K.PRESSURE_PLATE, related("pressure_plate"));
    t.addChild(K.HANGING_SIGN, related("hanging_sign"));
    t.addChild(K.WALL_HANGING_SIGN, related("wall_hanging_sign"));
    t.addChild(K.SIGN, related("sign"));
    t.addChild(K.WALL_SIGN, related("wall_sign"));
    if (isTfc(t.namespace)) {
      t.addChild(K.SIGN, woodRelated(ctx, t, "sign", "", "block"));
      t.addChild(
        K.HANGING_SIGN,
        woodRelated(ctx, t, "hanging_sign/wrought_sign", "", "block"),
      );
    }
    // CompatHandler.DIAGONALFENCES
    if (fence && ctx.loaded("diagonalfences")) {
      const diagonal = `diagonalfences:${javaReplace(fence.id, ":", "/")}`;
      if (ctx.hasBlock(diagonal)) {
        t.addChild("diagonalfences:fence", { id: diagonal });
      }
    }
  },
  initializeChildrenItems(ctx, t) {
    const relatedItem = (...names: string[]) => {
      for (const n of names) {
        const item = woodRelated(ctx, t, n, "", "item");
        if (item) return item;
      }
      return undefined;
    };
    if (t.bambooLike) {
      t.addChild(K.BOAT, relatedItem("raft", "boat"));
      t.addChild(K.CHEST_BOAT, relatedItem("chest_raft", "chest_boat"));
    } else {
      t.addChild(K.BOAT, relatedItem("boat", "raft"));
      t.addChild(K.CHEST_BOAT, relatedItem("chest_boat", "chest_raft"));
    }
    t.addChild(K.SAPLING, woodRelated(ctx, t, "sapling", "", "item"));
    if (isTfc(t.namespace)) {
      t.addChild(K.STICK, woodRelated(ctx, t, "twig", "", "block"));
      t.addChild(K.BOAT, woodRelated(ctx, t, "boat", "", "block"));
    }
  },
};

// ── Moonlight leaves ──────────────────────────────────────────────────────

/** `BlockType.findRelatedEntry(prefixOrInfix, reg)` (2 candidates). */
function baseRelated(
  ctx: Ctx,
  t: MutableBlockType,
  prefixOrInfix: string,
  registry: Registry,
): BlockTypeChild | undefined {
  const prefixed = prefixOrInfix ? `${prefixOrInfix}_` : "";
  const infixed = prefixOrInfix ? `_${prefixOrInfix}` : "";
  return findFirst(
    ctx,
    [
      `${t.namespace}:${t.path}${infixed}`,
      `${t.namespace}:${prefixed}${t.path}`,
    ],
    registry,
  );
}

const LEAVES: KindDef = {
  kind: "leaves",
  priority: 99,
  vanilla: () =>
    VANILLA_LEAVES_TYPES.map(
      (v) => new MutableBlockType("leaves", v.id, v.leaves),
    ),
  finders: LEAVES_FINDERS,
  defaultMain: (ctx, id) => firstBlock(ctx, [`${id}_leaves`]),
  detect(ctx, types, blockId) {
    const { namespace, path } = parseId(blockId);
    let name: string | undefined;
    if (path.endsWith("_leaves")) name = path.slice(0, -"_leaves".length);
    else if (path.startsWith("leaves_")) name = path.slice("leaves_".length);
    if (
      name === undefined ||
      LEAVES_IGNORED_MODS.has(namespace) ||
      path.includes("hanging_")
    ) {
      return undefined;
    }
    // `baseBlock instanceof LeavesBlock`: approximated, see approximations.ts.
    if (!isLeavesBlock(ctx.world, blockId)) return undefined;
    const id = `${namespace}:${name}`;
    return types.has(id)
      ? undefined
      : new MutableBlockType("leaves", id, blockId);
  },
  initializeChildrenBlocks(ctx, t) {
    t.addChild(K.LEAVES, { id: t.main });
    // `getAssociatedWoodType()` is always null here: LeavesTypeRegistry
    // computes the leaves → wood link after `super.finalizeAndFreeze()`.
    // So LOG never comes from the associated wood.
    t.addChild(K.LOG, baseRelated(ctx, t, K.LOG, "block"));
    t.addChild(K.SAPLING, baseRelated(ctx, t, "sapling", "block"));
  },
  initializeChildrenItems() {},
};

/** `LeavesTypeRegistry.finalizeAndFreeze`'s leaves → wood link. */
function linkLeavesToWood(
  leaves: ReadonlyMap<string, MutableBlockType>,
  woods: ReadonlyMap<string, MutableBlockType>,
  special: ReadonlyMap<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of leaves.values()) {
    const id = special.get(l.id) ?? l.id;
    const { namespace, path } = parseId(id);
    let o = woods.get(id);
    if (!o) {
      for (const w of woods.values()) {
        if (w.path === path) {
          o = w;
          break;
        }
      }
    }
    if (!o) {
      // Assigns "variant leaves types" to their expected woods, e.g.
      // "blossoming_oak" -> "oak". No break: the last match wins, so
      // "dark_oak" beats "oak".
      for (const w of woods.values()) {
        if (w.namespace === MINECRAFT || w.namespace === namespace) {
          if (path.endsWith(w.path)) o = w;
        }
      }
    }
    if (o) out.set(l.id, o.id);
  }
  return out;
}

// ── Stone Zone: stone and mud ─────────────────────────────────────────────

/** Stone Zone `RockType.findRelatedEntry`. */
function szRelated(
  ctx: Ctx,
  t: MutableBlockType,
  prefixOrInfix: string,
  suffix: string,
  registry: Registry = "block",
): BlockTypeChild | undefined {
  // The `minecraft:stone` + "cobblestone" special case is unreachable (no
  // caller passes "cobblestone" as the prefix) and not ported.
  const prefix_ = prefixOrInfix ? `${prefixOrInfix}_` : "";
  const _infix = prefixOrInfix ? `_${prefixOrInfix}` : "";
  const _suffix = suffix ? `_${suffix}` : "";
  const { namespace: ns, path: p } = t;
  return findFirst(
    ctx,
    [
      `${ns}:${p}${_infix}${_suffix}`,
      `${ns}:${prefix_}${p}${_suffix}`,
      `${ns}:rock/raw/${p}${_suffix}`,
      `${ns}:rock/${prefix_}${suffix}/${p}`,
      `${ns}:rock/${prefixOrInfix}/${p}${_suffix}`,
    ],
    registry,
  );
}

const R = ROCK_KEYS;

/** Stone Zone `RockType.initializeChildrenBlocks`. */
function szInitializeChildrenBlocks(ctx: Ctx, t: MutableBlockType): void {
  const rel = (pre: string, suf: string) => szRelated(ctx, t, pre, suf);
  // findBrickEntry: "brick" before "bricks"
  const brick = (pre: string, suf: string) => {
    const s = suf ? `_${suf}` : "";
    return rel(pre, `brick${s}`) ?? rel(pre, `bricks${s}`);
  };
  t.addChild(R.BLOCK, { id: t.main });
  t.addChild(R.STAIRS, rel("", "stairs"));
  t.addChild(R.SLAB, rel("", "slab"));
  t.addChild(R.WALL, rel("", "wall"));
  t.addChild(R.BUTTON, rel("", "button"));
  t.addChild(R.PRESSURE_PLATE, rel("", "pressure_plate"));

  // findCobblestoneEntry("", ""): "cobbled" first, then `x_cobblestone`.
  const cobblestone = rel("cobbled", "") ?? rel("", "cobblestone");
  if (cobblestone) {
    t.addChild(R.COBBLESTONE, cobblestone);
    t.addChild(R.MOSSY_COBBLESTONE, rel("mossy", ""));
  }

  const polished = rel("polished", "");
  if (polished) {
    t.addChild(R.POLISHED, polished);
    t.addChild(R.POLISHED_STAIRS, rel("polished", "stairs"));
    t.addChild(R.POLISHED_SLAB, rel("polished", "slab"));
    t.addChild(R.POLISHED_WALL, rel("polished", "wall"));
  }

  const smooth = rel("smooth", "");
  if (smooth) {
    t.addChild(R.SMOOTH, smooth);
    t.addChild(R.SMOOTH_STAIRS, rel("smooth", "stairs"));
    t.addChild(R.SMOOTH_SLAB, rel("smooth", "slab"));
    t.addChild(R.SMOOTH_WALL, rel("smooth", "wall"));
  }

  const tiles = rel("", "tiles");
  if (tiles) {
    t.addChild(R.TILES, tiles);
    t.addChild(R.TILE_STAIRS, rel("", "tile_stairs"));
    t.addChild(R.TILE_SLAB, rel("", "tile_slab"));
    t.addChild(R.TILE_WALL, rel("", "tile_wall"));
  }

  const bricks = brick("", "");
  const bricksTfc = rel("", "bricks");
  if (bricks || bricksTfc) {
    if (isTfc(t.namespace)) {
      t.addChild(R.BRICKS, bricksTfc);
      t.addChild(R.BRICK_STAIRS, rel("bricks", "stairs"));
      t.addChild(R.BRICK_SLAB, rel("bricks", "slab"));
      t.addChild(R.BRICK_WALL, rel("bricks", "wall"));
      t.addChild(R.CRACKED_BRICKS, rel("cracked_bricks", ""));
    } else {
      t.addChild(R.BRICKS, bricks);
      t.addChild(R.BRICK_STAIRS, brick("", "stairs"));
      t.addChild(R.BRICK_SLAB, brick("", "slab"));
      t.addChild(R.BRICK_WALL, brick("", "wall"));
      t.addChild(R.BRICK_TILES, brick("", "tiles"));
      t.addChild(R.CRACKED_BRICKS, brick("cracked", ""));
      t.addChild(R.MOSSY_BRICKS, brick("mossy", ""));
      t.addChild(R.MOSSY_BRICK_SLAB, brick("mossy", "slab"));
      t.addChild(R.MOSSY_BRICK_STAIRS, brick("mossy", "stairs"));
      t.addChild(R.MOSSY_BRICK_WALL, brick("mossy", "wall"));
    }
  }
}

/** Stone Zone `RockType.makeKnownIDConventions`. */
function szIdConventions(id: string, ...keywords: string[]): string[] {
  const { namespace, path } = parseId(id);
  return keywords.flatMap((k) => [
    `${namespace}:${path}${k ? `_${k}` : ""}`,
    `${namespace}:${k ? `${k}_` : ""}${path}`,
  ]);
}

/**
 * Java `replaceAll("(?<name>[a-z]+_)\\w+", "${name}<x>")` and its
 * `[a-z]+` variant, used by stone detection to probe for dust/ore/log ids.
 */
const replaceRuns = (path: string, tail: RegExp, x: string) =>
  path.replace(tail, `$1${x}`);
const WORD_TAIL = /([a-z]+_)\w+/g;
const LETTERS_TAIL = /([a-z]+_)[a-z]+/g;

const STONE: KindDef = {
  kind: "stone",
  priority: 110,
  vanilla: () =>
    VANILLA_STONE_TYPES.map(
      (v) => new MutableBlockType("stone", v.id, v.block),
    ),
  finders: STONE_FINDERS,
  defaultMain: (ctx, id) => firstBlock(ctx, szIdConventions(id, "", "stone")),
  detect(ctx, types, blockId) {
    const { namespace: ns, path } = parseId(blockId);
    // TerraFirmaCraft & ArborFirmaCraft. The Java also requires the bricks'
    // note-block instrument to be BASEDRUM, which assets cannot show;
    // approximated as always true (TFC rock bricks are stone).
    if (isTfc(ns) && /^rock\/bricks\/\w+$/.test(path)) {
      const stoneName = path.slice(path.lastIndexOf("/") + 1);
      const raw = `${ns}:${javaReplace(path, "bricks", "raw")}`;
      if (ctx.hasBlock(raw)) {
        return new MutableBlockType("stone", `${ns}:${stoneName}`, raw);
      }
    }
    if (SZ_BLACKLISTED_MODS.has(ns)) return undefined;

    const make = (stoneName: string, extraChecks: boolean) => {
      const stoneAlt = `${stoneName}_stone`;
      const id = `${ns}:${stoneName}`;
      const alt = `${ns}:${stoneAlt}`;
      const notBlacklisted = !(
        SZ_BLACKLISTED_STONETYPES.has(id) || SZ_BLACKLISTED_STONETYPES.has(alt)
      );
      if (!types.has(id) && !types.has(alt) && notBlacklisted && extraChecks) {
        if (ctx.hasBlock(id)) return new MutableBlockType("stone", id, id);
        if (ctx.hasBlock(alt)) return new MutableBlockType("stone", alt, alt);
      }
      return undefined;
    };

    // <type>_bricks | <type>_stone_bricks (and _brick, which loses a char:
    // the Java always strips 7)
    if (/^[a-z]+_(?:stone_)?bricks?$/.test(path)) {
      const noDustType = !ctx.hasItem(
        `${ns}:${replaceRuns(path, WORD_TAIL, "dust")}`,
      );
      const noOreType = !ctx.hasBlock(
        `${ns}:${replaceRuns(path, WORD_TAIL, "ore")}`,
      );
      const noWoodType = !ctx.hasBlock(
        `${ns}:${replaceRuns(path, LETTERS_TAIL, "log")}`,
      );
      return make(
        path.slice(0, Math.max(0, path.length - 7)),
        noDustType && noOreType && noWoodType,
      );
    }
    // polished_<type> | polished_<type>_stone
    if (/^polished_[a-z]+(?:_stone)?$/.test(path)) {
      return make(javaReplace(path, "polished_", ""), true);
    }
    return undefined;
  },
  initializeChildrenBlocks: szInitializeChildrenBlocks,
  initializeChildrenItems() {},
};

const MUD: KindDef = {
  kind: "mud",
  priority: 110,
  vanilla: () =>
    VANILLA_MUD_TYPES.map((v) => new MutableBlockType("mud", v.id, v.block)),
  finders: MUD_FINDERS,
  defaultMain: (ctx, id) => firstBlock(ctx, szIdConventions(id, "", "mud")),
  detect(ctx, types, blockId) {
    const { namespace: ns, path } = parseId(blockId);
    // The Java also requires instrument BASEDRUM; approximated as true.
    if (!/^[a-z]+_mud_bricks$/.test(path) || SZ_BLACKLISTED_MODS.has(ns)) {
      return undefined;
    }
    const mudName = path.slice(0, path.length - 7); // keeps "_mud"
    const id = `${ns}:${mudName}`;
    const alt = `${ns}:${mudName}_mud`;
    if (types.has(id) || types.has(alt)) return undefined;
    if (ctx.hasBlock(id)) return new MutableBlockType("mud", id, id);
    if (ctx.hasBlock(alt)) return new MutableBlockType("mud", alt, alt);
    return undefined;
  },
  initializeChildrenBlocks(ctx, t) {
    szInitializeChildrenBlocks(ctx, t);
    t.addChild("packed", szRelated(ctx, t, "packed", ""));
  },
  initializeChildrenItems() {},
};

// ── Gems Realm: crystal, dust, metal, gem ─────────────────────────────────

/** Gems Realm `RockType.findRelatedEntry` plus the per-kind overrides. */
function grRelated(
  ctx: Ctx,
  t: MutableBlockType,
  prefixOrInfix: string,
  suffix: string,
  registry: Registry = "block",
): BlockTypeChild | undefined {
  const prefix_ = prefixOrInfix ? `${prefixOrInfix}_` : "";
  const _infix = prefixOrInfix ? `_${prefixOrInfix}` : "";
  const _suffix = suffix ? `_${suffix}` : "";
  const { namespace: ns, path: p } = t;
  const found = findFirst(
    ctx,
    [
      `${ns}:${p}${_infix}${_suffix}`,
      `${ns}:${prefix_}${p}${_suffix}`,
      // Mo' Shiz
      `${ns}:gem/${p}${_suffix}`,
      `${ns}:resources/${prefix_}${p}${_suffix}`,
      `${ns}:${suffix}/${p}${_suffix}`,
      `${ns}:${suffix}/${p}${suffix}`,
      `${ns}:${suffix}/${p}`,
    ],
    registry,
  );
  if (found) return found;
  // CrystalType / DustType re-try the first two candidates (no-op);
  // MetalType adds TFC/AFC paths.
  if (t.kind === "metal" && isTfc(ns)) {
    return findFirst(
      ctx,
      [
        `${ns}:metal/${prefix_}${suffix}/${p}`,
        `${ns}:metal/${prefixOrInfix}/${p}${_suffix}`,
      ],
      registry,
    );
  }
  return undefined;
}

const G = GR_KEYS;

/** Gems Realm `RockType.initializeChildrenBlocks`. */
function grInitializeChildrenBlocks(ctx: Ctx, t: MutableBlockType): void {
  const rel = (pre: string, suf: string) => grRelated(ctx, t, pre, suf);
  // findChildBlocks: with the (global) child infix, with and without "s"
  const childBlocks = (key: string) => {
    const suffix = ctx.grChildInfix + key;
    return rel("", suffix) ?? rel("", `${suffix}s`);
  };
  const brick = (pre: string, suf: string) => {
    const s = suf ? `_${suf}` : "";
    return rel(pre, `brick${s}`) ?? rel(pre, `bricks${s}`);
  };
  t.addChild(G.BLOCK, { id: t.main });
  t.addChild(G.RAW_BLOCK, rel("raw", "block"));
  t.addChild(G.STAIRS, childBlocks(G.STAIRS));
  t.addChild(G.SLAB, childBlocks(G.SLAB));
  t.addChild(G.WALL, childBlocks(G.WALL));
  t.addChild(G.FENCE, childBlocks(G.FENCE));
  t.addChild(G.CHISELED, rel("chiseled", ""));

  const bricks = brick("", "");
  t.addChild(G.BRICKS, bricks);
  if (bricks) {
    t.addChild(G.BRICK_STAIRS, brick("", "stairs"));
    t.addChild(G.BRICK_SLAB, brick("", "slab"));
    t.addChild(G.BRICK_WALL, brick("", "wall"));
    t.addChild(G.BRICK_TILES, brick("", "tiles"));
    t.addChild(G.CRACKED_BRICKS, brick("cracked", ""));
    t.addChild(G.MOSSY_BRICKS, brick("mossy", ""));
    t.addChild(G.MOSSY_BRICK_SLAB, brick("mossy", "slab"));
    t.addChild(G.MOSSY_BRICK_STAIRS, brick("mossy", "stairs"));
    t.addChild(G.MOSSY_BRICK_WALL, brick("mossy", "wall"));
  }

  const smooth = rel("smooth", "");
  t.addChild(G.SMOOTH, smooth);
  if (smooth) {
    t.addChild(G.SMOOTH_STAIRS, rel("smooth", "stairs"));
    t.addChild(G.SMOOTH_SLAB, rel("smooth", "slab"));
    t.addChild(G.SMOOTH_WALL, rel("smooth", "wall"));
  }
}

/** Gems Realm `RockType.makeKnownIDConventions`. */
const grIdConventions = szIdConventions;

/** `RockType.isInItemRegistry(ns, path, target, replacement)`. */
const inItems = (
  ctx: Ctx,
  ns: string,
  path: string,
  target: string,
  replacement: string,
) => ctx.hasItem(`${ns}:${javaReplace(path, target, replacement)}`);

/**
 * `RockType.newSubBlockType`: `regex.find()` on the path (unanchored unless
 * the pattern says so), type id `ns:<typename>`, nothing if already
 * registered, blacklisted, or any check fails. The main block is the block
 * itself.
 */
function newSubBlockType(
  kind: BlockTypeKind,
  types: ReadonlyMap<string, MutableBlockType>,
  blockId: string,
  regex: RegExp,
  typeBlacklist: ReadonlySet<string> | undefined,
  modBlacklist: ReadonlySet<string> | undefined,
  checks: boolean[],
): MutableBlockType | undefined {
  const { namespace, path } = parseId(blockId);
  const match = regex.exec(path);
  const typename = match?.groups?.typename;
  if (typename === undefined) return undefined;
  const id = `${namespace}:${typename}`;
  if (types.has(id) || modBlacklist?.has(namespace) || typeBlacklist?.has(id)) {
    return undefined;
  }
  if (!checks.every(Boolean)) return undefined;
  return new MutableBlockType(kind, id, blockId);
}

const BLOCK_SUFFIX = /(?<typename>\w+)_block/;
const TECHREBORN_STORAGE = /(?<typename>\w+)_storage_block/;

const CRYSTAL: KindDef = {
  kind: "crystal",
  priority: 110,
  vanilla: () =>
    VANILLA_CRYSTAL_TYPES.map(
      (v) => new MutableBlockType("crystal", v.id, v.block),
    ),
  finders: CRYSTAL_FINDERS,
  defaultMain: (ctx, id) => firstBlock(ctx, grIdConventions(id, "block")),
  detect(ctx, types, blockId) {
    const { namespace: ns, path } = parseId(blockId);
    const hasShard = inItems(ctx, ns, path, "block", G.SHARD);
    const hasCluster = inItems(ctx, ns, path, "block", G.CLUSTER);
    const noGemType = !inItems(ctx, ns, path, "_block", "");
    const noMetalType = !inItems(ctx, ns, path, "block", G.INGOT);
    const noWoodType = !inItems(ctx, ns, path, "block", "log");
    return newSubBlockType(
      "crystal",
      types,
      blockId,
      BLOCK_SUFFIX,
      GR_BLACKLISTED_CRYSTALTYPES,
      GR_BLACKLISTED_MODS,
      [hasCluster || hasShard, noWoodType, noMetalType, noGemType],
    );
  },
  initializeChildrenBlocks(ctx, t) {
    t.addChild(G.CLUSTER, grRelated(ctx, t, "", "cluster"));
    t.addChild(G.GLINTED_CLUSTER, grRelated(ctx, t, "glinted", "cluster"));
    t.addChild(G.LAMP, grRelated(ctx, t, "", "lamp"));
    t.addChild(G.BUDDING, grRelated(ctx, t, "budding", ""));
    grInitializeChildrenBlocks(ctx, t);
  },
  initializeChildrenItems(ctx, t) {
    t.addChild(G.SHARD, grRelated(ctx, t, "", "shard", "item"));
  },
};

const DUST: KindDef = {
  kind: "dust",
  priority: 110,
  vanilla: () =>
    VANILLA_DUST_TYPES.map((v) => new MutableBlockType("dust", v.id, v.block)),
  finders: DUST_FINDERS,
  defaultMain: (ctx, id) => firstBlock(ctx, grIdConventions(id, "block")),
  detect(ctx, types, blockId) {
    const { namespace: ns, path } = parseId(blockId);
    return newSubBlockType(
      "dust",
      types,
      blockId,
      BLOCK_SUFFIX,
      GR_BLACKLISTED_DUSTTYPES,
      GR_BLACKLISTED_MODS,
      [
        inItems(ctx, ns, path, "block", "dust"),
        !inItems(ctx, ns, path, "block", "log"),
        !inItems(ctx, ns, path, "block", "ingot"),
        !inItems(ctx, ns, path, "_block", ""),
        !GR_BLACKLISTED_DUST_MODS.has(ns),
      ],
    );
  },
  initializeChildrenBlocks: grInitializeChildrenBlocks,
  initializeChildrenItems(ctx, t) {
    t.addChild(G.DUST, grRelated(ctx, t, "", "dust", "item"));
  },
};

const METAL: KindDef = {
  kind: "metal",
  priority: 110,
  vanilla: () =>
    VANILLA_METAL_TYPES.map(
      (v) => new MutableBlockType("metal", v.id, v.block),
    ),
  finders: METAL_FINDERS,
  defaultMain: (ctx, id) =>
    firstBlock(ctx, grIdConventions(id, "block", "block_of", "blockof")),
  detect(ctx, types, blockId) {
    const { namespace: ns, path } = parseId(blockId);
    if (isTfc(ns)) {
      return newSubBlockType(
        "metal",
        types,
        blockId,
        /metal\/block\/(?<typename>\w+)(?<!slab|stairs)/,
        undefined,
        undefined,
        [inItems(ctx, ns, path, "block", "ingot")],
      );
    }
    if (ns === "ms") {
      const ingot = javaReplace(
        javaReplace(path, "block", "ingot"),
        "resources",
        "gem",
      );
      return newSubBlockType(
        "metal",
        types,
        blockId,
        /resources\/(?<typename>[a-z]+)_block/,
        GR_BLACKLISTED_METALTYPES,
        undefined,
        [ctx.hasItem(`${ns}:${ingot}`)],
      );
    }
    if (ns === "techreborn") {
      ctx.grChildInfix = "storage_";
      return newSubBlockType(
        "metal",
        types,
        blockId,
        TECHREBORN_STORAGE,
        undefined,
        undefined,
        [
          inItems(ctx, ns, path, "storage_block", "ingot"),
          !inItems(ctx, ns, path, "storage_block", "gem"),
        ],
      );
    }
    return newSubBlockType(
      "metal",
      types,
      blockId,
      BLOCK_SUFFIX,
      GR_BLACKLISTED_METALTYPES,
      undefined,
      [
        inItems(ctx, ns, path, "block", "ingot"),
        !inItems(ctx, ns, path, "block", "log"),
        !inItems(ctx, ns, path, "_block", ""),
      ],
    );
  },
  initializeChildrenBlocks(ctx, t) {
    grInitializeChildrenBlocks(ctx, t);
    for (const key of [G.TRAPDOOR, G.LAMP, G.CHAIN, G.ANVIL, G.BARS]) {
      t.addChild(key, grRelated(ctx, t, "", key));
    }
  },
  initializeChildrenItems(ctx, t) {
    t.addChild(G.INGOT, grRelated(ctx, t, "", "ingot", "item"));
    t.addChild(G.NUGGET, grRelated(ctx, t, "", "nugget", "item"));
  },
};

const GEM_TYPENAME =
  /^(?<typename>(?:rare|dark|black|white|cyan|pink|yellow|blue|green|purple|red|orange|brown|olive)?_?(?:ice|fire|star|blue)?_?[a-z]+)_block$/;

const GEM: KindDef = {
  kind: "gem",
  priority: 110,
  vanilla: () =>
    VANILLA_GEM_TYPES.map((v) => new MutableBlockType("gem", v.id, v.block)),
  finders: GEM_FINDERS,
  defaultMain: (ctx, id) =>
    firstBlock(ctx, grIdConventions(id, "block", "block_of", "blockof")),
  detect(ctx, types, blockId) {
    const { namespace: ns, path } = parseId(blockId);
    if (ns === "techreborn") {
      ctx.grChildInfix = "storage_";
      return newSubBlockType(
        "gem",
        types,
        blockId,
        TECHREBORN_STORAGE,
        undefined,
        undefined,
        [
          inItems(ctx, ns, path, "storage_block", "gem"),
          !inItems(ctx, ns, path, "storage_block", "ingot"),
        ],
      );
    }
    const hasOre =
      inItems(ctx, ns, path, "block", "ore") ||
      inItems(ctx, ns, `deepslate_${path}`, "block", "ore");
    const hasGem = inItems(ctx, ns, path, "_block", "");
    const noWoodType = !inItems(ctx, ns, path, "block", "log");
    const noCrystalType = !inItems(ctx, ns, path, "block", "cluster");
    const noDustType = !inItems(ctx, ns, path, "block", "dust");
    // The raw-block probe looks up `raw_<x>_` (it replaces "block" with ""),
    // so it never matches; kept as written.
    const noMetalType =
      !inItems(ctx, ns, path, "block", "ingot") &&
      !inItems(ctx, ns, `raw_${path}`, "block", "");
    return newSubBlockType(
      "gem",
      types,
      blockId,
      GEM_TYPENAME,
      GR_BLACKLISTED_GEMTYPES,
      GR_BLACKLISTED_MODS,
      [hasOre, hasGem, noWoodType, noCrystalType, noDustType, noMetalType],
    );
  },
  initializeChildrenBlocks: grInitializeChildrenBlocks,
  initializeChildrenItems(ctx, t) {
    t.addChild(G.GEM, grRelated(ctx, t, "", "", "item"));
  },
};

/** Registration order: Moonlight, then Stone Zone, then Gems Realm. */
const REGISTRATION_ORDER: readonly KindDef[] = [
  WOOD,
  LEAVES,
  STONE,
  MUD,
  CRYSTAL,
  DUST,
  METAL,
  GEM,
];

/** `BlockSetInternal.getRegistries()`: priority descending, stable. */
const REGISTRY_ORDER: readonly KindDef[] = [...REGISTRATION_ORDER].sort(
  (a, b) => b.priority - a.priority,
);

// ── Detection ─────────────────────────────────────────────────────────────

/** A finder's `get()`; undefined when it fails or its mod is not loaded. */
function runFinder(
  ctx: Ctx,
  def: KindDef,
  spec: FinderSpec,
): MutableBlockType | undefined {
  if (spec.when && !spec.when(ctx.loaded)) return undefined;
  if (!ctx.loaded(parseId(spec.id).namespace)) return undefined;
  const resolve = (
    ref: FinderRef | undefined,
    fallback: () => string | undefined,
  ) => (ref ? (ctx.hasBlock(ref.id) ? ref.id : undefined) : fallback());
  const main = resolve(spec.main, () => def.defaultMain(ctx, spec.id));
  if (!main) return undefined;
  let t: MutableBlockType;
  if (def.kind === "wood") {
    const log = resolve(spec.log, () => findLog(ctx, spec.id));
    if (!log) return undefined;
    t = newWood(
      spec.id,
      main,
      log,
      spec.bambooLike ?? defaultIsBambooLike(spec.id),
    );
  } else {
    t = new MutableBlockType(def.kind, spec.id, main);
  }
  // `childNames` is a HashMap: children are added in its iteration order.
  for (const [key, ref] of javaHashMapOrder(spec.children)) {
    const exists = ref.item ? ctx.hasItem(ref.id) : ctx.hasBlock(ref.id);
    if (exists)
      t.addChild(key, ref.item ? { id: ref.id, item: true } : { id: ref.id });
  }
  return t;
}

/** Detects every block type the loaded mods of one version have. */
export function detectBlockTypes(world: BlockTypeWorld): BlockTypeRegistries {
  const ctx: Ctx = {
    world,
    loaded: (modId) => modId === MINECRAFT || world.isModLoaded(modId),
    hasBlock: (id) => world.hasBlock(id),
    hasItem: (id) => hasItem(world, id),
    grChildInfix: "",
  };

  const byKind = new Map<BlockTypeKind, Map<string, MutableBlockType>>();

  // buildAll, every registry.
  for (const def of REGISTRY_ORDER) {
    const types = new Map<string, MutableBlockType>();
    const register = (t: MutableBlockType | undefined) => {
      if (t && !types.has(t.id)) types.set(t.id, t);
    };
    def.vanilla().forEach(register);
    for (const spec of def.finders) register(runFinder(ctx, def, spec));
    // No removers (`addRemover`) are registered by any of the ported mods.
    for (const blockId of world.blockIds) {
      register(def.detect(ctx, types, blockId));
    }
    byKind.set(def.kind, types);
  }

  // finalizeAndFreeze, every registry.
  let leavesToWood = new Map<string, string>();
  for (const def of REGISTRY_ORDER) {
    const types = byKind.get(def.kind)!;
    for (const t of types.values()) def.initializeChildrenBlocks(ctx, t);
    for (const t of types.values()) def.initializeChildrenItems(ctx, t);
    if (def.kind === "leaves") {
      const special = new Map<string, string>();
      for (const spec of LEAVES_FINDERS) {
        if (spec.equivalentWood) special.set(spec.id, spec.equivalentWood);
      }
      for (const [l, w] of leavesToWoodMappings(ctx.loaded)) special.set(l, w);
      leavesToWood = linkLeavesToWood(types, byKind.get("wood")!, special);
    }
  }

  return { byKind, leavesToWood };
}
