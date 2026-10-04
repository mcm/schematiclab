// Block types for the Every Compat family of providers (Every Compat "Wood
// Good", Stone Zone, Gems Realm): the wood, leaves, stone, mud, gem, metal,
// crystal and dust types Moonlight Lib and the addons detect from the
// registered blocks, and the blocks/items each type has as children.
//
// The app only sees assets, so the "registries" are approximated from the
// loaded jars (`BlockTypeWorld`). See `detect.ts`.
//
// Worker-safe: no DOM access.

/** Every block-type class the Every Compat family generates blocks for. */
export type BlockTypeKind =
  | "wood"
  | "leaves"
  | "stone"
  | "mud"
  | "gem"
  | "metal"
  | "crystal"
  | "dust";

/** What detection can see of the loaded mods of one Minecraft version. */
export interface BlockTypeWorld {
  /**
   * Every block id, in block-registry order as best we know it: vanilla
   * blocks first, then each loaded file's blocks (files oldest first, each
   * file's blocks sorted by id).
   */
  readonly blockIds: readonly string[];
  hasBlock(id: string): boolean;
  /**
   * True when an item `id` is registered. Approximated: every block has an
   * item, plus item models and `item.<ns>.<path>` lang keys of the jars.
   */
  hasItem(id: string): boolean;
  /** True when a mod providing `namespace` is loaded (asset namespaces). */
  isModLoaded(namespace: string): boolean;
  /** The blockstate JSON of block `id`, or undefined (vanilla included). */
  blockstate(id: string): unknown;
  /** A model by normalized id (`ns:block/x`), or undefined (vanilla included). */
  model(id: string): unknown;
}

/** A child of a block type: a block, or an item (boats, saplings, ingots…). */
export interface BlockTypeChild {
  id: string;
  /** True for item children (`findRelatedItem`, `childItem`). */
  item?: true;
}

/** One detected block type. */
export interface DetectedBlockType {
  kind: BlockTypeKind;
  /** `ns:path`, e.g. `biomesoplenty:fir`, `tfc:granite`, `minecraft:oak`. */
  id: string;
  namespace: string;
  /** The id path after the last `/` (`BlockType.getTypeName`). */
  typeName: string;
  /**
   * Child key → child, in insertion order (`BlockType.addChild` semantics:
   * a later put on a key replaces it; one object belongs to at most one key,
   * the earlier one wins).
   */
  children: ReadonlyMap<string, BlockTypeChild>;
  /** Wood types: `WoodType.bambooLike`. */
  bambooLike?: boolean;
}

/** The detected types of every kind. */
export interface BlockTypeRegistries {
  /** Per kind, type id → type, in registration order. */
  readonly byKind: ReadonlyMap<
    BlockTypeKind,
    ReadonlyMap<string, DetectedBlockType>
  >;
  /** Leaves type id → its associated wood type id (`getAssociatedWoodType`). */
  readonly leavesToWood: ReadonlyMap<string, string>;
}
