// One addon (Every Compat, Stone Zone or Gems Realm) over the files loaded
// for one Minecraft version: which of its modules are registered (the
// supported mods that are loaded, for the addon file's mod loader), which
// block types exist, which blocks each entry set generates
// (`SimpleEntrySet.registerBlocks`), and how a block id maps back to its
// entry set and block type.
//
// Port of the registration logic of Every Compat 1.21
// (`SimpleEntrySet.registerBlocks`, `SimpleModule.isEntryAlreadyRegistered`,
// `AbstractSimpleEntrySet.makeEntryName`/`makeFullEntryID`/`nameScheme`;
// https://github.com/MehVahdJukaar/WoodGood, commit 556d936). Copyright (c)
// MehVahdJukaar, Xel'Bayria and the Supplementaries Team, under the
// Supplementaries Team License, whose authors this port credits.
//
// Not ported: the per-mod exclusion tables of `HardcodedBlockType` (EC,
// Stone Zone, Gems Realm) and the hazardous-config blacklists. Enumeration
// may list a few blocks the game skips; resolving an id that exists in a
// schematic doesn't depend on them.
//
// Worker-safe: no DOM access.

import type { LoadedModMeta } from "../../types";
import type { GeneratedBlockFiles } from "../types";
import type {
  BlockTypeKind,
  BlockTypeRegistries,
  BlockTypeWorld,
  DetectedBlockType,
} from "./block-types/types";
import type {
  EcAddonTable,
  EcEntrySet,
  EcModule,
  EcPlatform,
  EcRegistration,
} from "./entry-sets";
import {
  createFullIdWith,
  EcResourceLocation,
  LOOKS_LIKE_LEAF_TEXTURE,
  LOOKS_LIKE_SIDE_LOG_TEXTURE,
  LOOKS_LIKE_TOP_LOG_TEXTURE,
  SPRITE_HELPERS,
  type EcContext,
  type EcTypeView,
} from "./runtime";
import { blockTypeRegistries, loadedNamespaces } from "./world";

/** Minecraft versions the generated tables (Every Compat 1.21-…) apply to. */
export const EC_GAME_VERSIONS: readonly string[] = ["1.21", "1.21.1"];

/** `BlockType.getTypeName`: the id path after its last `/`. */
export function typeNameOf(id: string): string {
  const path = id.slice(id.indexOf(":") + 1);
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `AbstractSimpleEntrySet.makeEntryName`. */
export function makeEntryName(entry: EcEntrySet, typeName: string): string {
  if (entry.prefix !== null) {
    return `${entry.prefix}_${typeName}${entry.name === "" ? "" : `_${entry.name}`}`;
  }
  return `${typeName}_${entry.name}`;
}

/** `AbstractSimpleEntrySet.typeName`: the entry set's own name. */
export function entrySetName(entry: EcEntrySet): string {
  return (
    (entry.prefix === null
      ? ""
      : entry.prefix + (entry.name === "" ? "" : "_")) + entry.name
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `AbstractSimpleEntrySet.nameScheme`: the type name in an entry name, or null. */
export function parseTypeName(entry: EcEntrySet, name: string): string | null {
  const re =
    entry.prefix !== null
      ? entry.name === ""
        ? new RegExp(`^${escapeRegex(entry.prefix)}_(.+?)$`)
        : new RegExp(
            `^${escapeRegex(entry.prefix)}_(.+?)_${escapeRegex(entry.name)}$`,
          )
      : new RegExp(`^(.+?)_${escapeRegex(entry.name)}$`);
  return re.exec(name)?.[1] ?? null;
}

/** One entry set of one active registration. */
export interface EcEntryRef {
  registration: EcRegistration;
  module: EcModule;
  entry: EcEntrySet;
}

/** An entry set generating `blockId` for `type`. */
export interface EcBlockMatch extends EcEntryRef {
  blockId: string;
  type: DetectedBlockType;
}

function platformOf(file: LoadedModMeta | null): EcPlatform | null {
  switch (file?.loader) {
    case "fabric":
    case "quilt":
      return "fabric";
    case "forge":
    case "neoforge":
      return "neoforge";
    default:
      return null;
  }
}

/** The addon over one version's loaded files. */
export class EcAddonState {
  readonly table: EcAddonTable;
  readonly files: GeneratedBlockFiles;
  /** The addon's own loaded file, or null. */
  readonly addonFile: LoadedModMeta | null;
  readonly world: BlockTypeWorld;
  readonly registries: BlockTypeRegistries;
  /** Registrations whose supported mod (and guards) are loaded. */
  readonly active: readonly EcRegistration[];
  private readonly namespaces: Set<string>;
  private readonly views = new Map<string, TypeView>();
  private readonly generated = new Map<string, string | null>();
  private readonly visiting = new Set<string>();

  constructor(table: EcAddonTable, files: GeneratedBlockFiles) {
    this.table = table;
    this.files = files;
    this.addonFile = files.fileForNamespace(table.addon);
    const { world, registries } = blockTypeRegistries(files);
    this.world = world;
    this.registries = registries;
    this.namespaces = loadedNamespaces(files);
    const platform = platformOf(this.addonFile);
    this.active = table.registrations.filter(
      (reg) =>
        (platform === null || reg.platforms.includes(platform)) &&
        this.isModLoaded(reg.modId) &&
        (reg.requiresAnyOf === undefined ||
          reg.requiresAnyOf.some((id) => this.isModLoaded(id))) &&
        !(reg.requiresNoneOf ?? []).some((id) => this.isModLoaded(id)),
    );
  }

  /** True when a mod with this id (approximated by namespace) is loaded. */
  isModLoaded(modId: string): boolean {
    return this.namespaces.has(modId);
  }

  module(reg: EcRegistration): EcModule {
    return this.table.modules[reg.module];
  }

  typesOf(kind: BlockTypeKind): ReadonlyMap<string, DetectedBlockType> {
    return this.registries.byKind.get(kind) ?? new Map();
  }

  type(kind: BlockTypeKind, id: string): DetectedBlockType | null {
    return this.typesOf(kind).get(id) ?? null;
  }

  /** The view of a type the translated lambdas see. */
  view(type: DetectedBlockType): TypeView {
    const key = `${type.kind}|${type.id}`;
    let view = this.views.get(key);
    if (view === undefined) {
      view = new TypeView(this, type);
      this.views.set(key, view);
    }
    return view;
  }

  /** The `c` of an entry set's lambdas. */
  context(reg: EcRegistration): EcContext {
    const compatModule = this.module(reg);
    return {
      modId: reg.modId,
      isModLoaded: (id) => this.isModLoaded(id),
      rl: (namespace, path) => new EcResourceLocation(namespace, path),
      parseRl: (id) => EcResourceLocation.parse(id),
      entryBlock: (name, t) => {
        const entry = compatModule.entrySets.find(
          (e) => entrySetName(e) === name,
        );
        const type = t instanceof TypeView ? t.type : null;
        if (entry === undefined || type === null) return null;
        return this.generatedBlock(
          { registration: reg, module: compatModule, entry },
          type,
        );
      },
      LOOKS_LIKE_TOP_LOG_TEXTURE,
      LOOKS_LIKE_SIDE_LOG_TEXTURE,
      LOOKS_LIKE_LEAF_TEXTURE,
      ...SPRITE_HELPERS,
    };
  }

  /** `makeFullEntryID`: the block id an entry set gives `type`. */
  blockId(ref: EcEntryRef, type: DetectedBlockType): string {
    return `${this.table.addon}:${ref.module.shortId}/${type.namespace}/${makeEntryName(
      ref.entry,
      type.typeName,
    )}`;
  }

  /**
   * `SimpleModule.isEntryAlreadyRegistered` (without the hardcoded per-mod
   * tables): true when the game wouldn't generate this block because it
   * exists elsewhere.
   */
  private alreadyRegistered(ref: EcEntryRef, type: DetectedBlockType): boolean {
    const { world } = this;
    const modId = ref.registration.modId;
    const blockName = makeEntryName(ref.entry, type.typeName);
    const typeNs = type.namespace;
    // Vanilla types: the supported mod has its own blocks for them.
    // (Stone Zone still generates the prismarine waystone.)
    if (
      typeNs === "minecraft" &&
      !(
        this.table.addon === "stonezone" &&
        modId === "waystones" &&
        blockName === "prismarine_waystone"
      )
    ) {
      return true;
    }
    if (typeNs === modId) return true;
    if ((ref.module.alreadySupportedMods ?? []).includes(typeNs)) return true;
    if (
      (world.hasBlock(`${modId}:${blockName}`) ||
        world.hasBlock(`${modId}:${typeNs}_${blockName}`)) &&
      !this.typesOf("wood").has(`${modId}:${type.typeName}`)
    ) {
      return true;
    }
    if (world.hasBlock(`${typeNs}:${blockName}`)) return true;
    for (const compat of this.table.otherCompatMods) {
      if (
        !compat.woodsFrom.includes(typeNs) ||
        !compat.blocksFrom.includes(modId)
      ) {
        continue;
      }
      if (
        world.hasBlock(`${compat.modId}:${blockName}`) ||
        world.hasBlock(`${compat.modId}:${typeNs}/${blockName}`) ||
        world.hasBlock(`${compat.modId}:${typeNs}_${blockName}`)
      ) {
        return true;
      }
    }
    return false;
  }

  /** The block `ref` generates for `type`, or null (memoized). */
  generatedBlock(ref: EcEntryRef, type: DetectedBlockType): string | null {
    if (ref.entry.kind !== type.kind) return null;
    const blockId = this.blockId(ref, type);
    const key = `${ref.registration.module}|${ref.registration.modId}|${blockId}`;
    if (this.generated.has(key)) return this.generated.get(key)!;
    // Conditions can ask for other entry sets' children; a cycle means no.
    if (this.visiting.has(key)) return null;
    this.visiting.add(key);
    let result: string | null = null;
    try {
      if (!this.alreadyRegistered(ref, type)) {
        const condition = ref.entry.condition;
        const ok =
          condition === undefined ||
          condition(this.context(ref.registration))(this.view(type));
        result = ok ? blockId : null;
      }
    } catch {
      result = null;
    } finally {
      this.visiting.delete(key);
    }
    this.generated.set(key, result);
    return result;
  }

  /** Every active entry set. */
  *entryRefs(): Generator<EcEntryRef> {
    for (const registration of this.active) {
      const compatModule = this.module(registration);
      if (compatModule === undefined) continue;
      for (const entry of compatModule.entrySets)
        yield { registration, module: compatModule, entry };
    }
  }

  /**
   * The entry sets (of `registrations`) whose naming matches `blockId`,
   * most specific first, each with the type it names (or null when that type
   * isn't detected).
   */
  matchesFor(
    blockId: string,
    registrations: readonly EcRegistration[] = this.active,
  ): {
    ref: EcEntryRef;
    typeNamespace: string;
    typeName: string;
    type: DetectedBlockType | null;
  }[] {
    const colon = blockId.indexOf(":");
    if (colon < 0 || blockId.slice(0, colon) !== this.table.addon) return [];
    const parts = blockId.slice(colon + 1).split("/");
    if (parts.length !== 3) return [];
    const [shortId, typeNamespace, name] = parts;
    const out: {
      ref: EcEntryRef;
      typeNamespace: string;
      typeName: string;
      type: DetectedBlockType | null;
      score: number;
    }[] = [];
    for (const registration of registrations) {
      const compatModule = this.module(registration);
      if (compatModule === undefined || compatModule.shortId !== shortId)
        continue;
      for (const entry of compatModule.entrySets) {
        const typeName = parseTypeName(entry, name);
        if (typeName === null) continue;
        const type =
          [...this.typesOf(entry.kind).values()].find(
            (t) => t.namespace === typeNamespace && t.typeName === typeName,
          ) ?? null;
        out.push({
          ref: { registration, module: compatModule, entry },
          typeNamespace,
          typeName,
          type,
          score: (entry.prefix?.length ?? 0) + entry.name.length,
        });
      }
    }
    // Detected types first, then the longest prefix + postfix.
    out.sort(
      (a, b) =>
        Number(b.type !== null) - Number(a.type !== null) || b.score - a.score,
    );
    return out.map(({ score: _score, ...rest }) => rest);
  }

  /** The entry set and type generating `blockId`, or null. */
  match(blockId: string): EcBlockMatch | null {
    const matches = this.matchesFor(blockId).filter((m) => m.type !== null);
    // Prefer an entry set the game would really register for the type.
    const best =
      matches.find((m) => this.generatedBlock(m.ref, m.type!) === blockId) ??
      matches[0];
    return best === undefined
      ? null
      : { ...best.ref, blockId, type: best.type! };
  }
}

/** `EcTypeView` over a detected type (children include generated blocks). */
export class TypeView implements EcTypeView {
  readonly state: EcAddonState;
  readonly type: DetectedBlockType;

  constructor(state: EcAddonState, type: DetectedBlockType) {
    this.state = state;
    this.type = type;
  }

  getId(): EcResourceLocation {
    return EcResourceLocation.parse(this.type.id);
  }

  getNamespace(): string {
    return this.type.namespace;
  }

  getTypeName(): string {
    return this.type.typeName;
  }

  /**
   * The child under `key`: detected children, else (`<modId>:<entry set>`
   * keys, or Gems Realm's `minecraft:`-stripped ones) the block an active
   * entry set generates for this type, or the existing block it would have
   * adopted (`SimpleEntrySet.registerBlocks`' "adding all other children").
   */
  getChild(key: string): string | null {
    const child = this.type.children.get(key);
    if (child !== undefined) return child.id;
    const colon = key.indexOf(":");
    const modId = colon < 0 ? "minecraft" : key.slice(0, colon);
    const setName = key.slice(colon + 1);
    const { state } = this;
    for (const ref of state.entryRefs()) {
      if (
        ref.registration.modId !== modId ||
        entrySetName(ref.entry) !== setName
      ) {
        continue;
      }
      if (ref.entry.kind !== this.type.kind) continue;
      const generated = state.generatedBlock(ref, this.type);
      if (generated !== null) return generated;
      const name = makeEntryName(ref.entry, this.type.typeName);
      for (const ns of [
        this.type.namespace,
        ...(ref.module.alreadySupportedMods ?? []),
        modId,
      ]) {
        if (state.world.hasBlock(`${ns}:${name}`)) return `${ns}:${name}`;
      }
    }
    return null;
  }

  hasChild(key: string): boolean {
    return this.getChild(key) !== null;
  }

  getBlockOfThis(key: string): string | null {
    const child = this.type.children.get(key);
    if (child?.item)
      return this.state.world.hasBlock(child.id) ? child.id : null;
    return this.getChild(key);
  }

  getItemOfThis(key: string): string | null {
    const child = this.getChild(key);
    return child !== null && this.state.world.hasItem(child) ? child : null;
  }

  isBambooLike(): boolean {
    return this.type.bambooLike === true;
  }

  getAssociatedWoodType(): EcTypeView | null {
    if (this.type.kind !== "leaves") return null;
    const woodId = this.state.registries.leavesToWood.get(this.type.id);
    const wood = woodId === undefined ? null : this.state.type("wood", woodId);
    return wood === null ? null : this.state.view(wood);
  }

  createFullIdWith(
    modId: string,
    folder: string,
    shortId: string,
    prefix: string,
    suffix: string,
  ): string {
    return createFullIdWith(this.type, modId, folder, shortId, prefix, suffix);
  }

  CreateStandardId(shortId: string, prefix: string, suffix: string): string {
    return createFullIdWith(
      this.type,
      "stonezone",
      "",
      shortId,
      prefix,
      suffix,
    );
  }
}

// States per (table, files view), redone when the files' assets change.
const states = new WeakMap<
  GeneratedBlockFiles,
  Map<string, { signature: string; state: EcAddonState }>
>();

/** The addon state of `table` over `files` (cached). */
export function ecAddonState(
  table: EcAddonTable,
  files: GeneratedBlockFiles,
  signature: string,
): EcAddonState {
  let byAddon = states.get(files);
  if (byAddon === undefined) {
    byAddon = new Map();
    states.set(files, byAddon);
  }
  const cached = byAddon.get(table.addon);
  if (cached?.signature === signature) return cached.state;
  const state = new EcAddonState(table, files);
  byAddon.set(table.addon, { signature, state });
  return state;
}
