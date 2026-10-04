// What the generated Every Compat / Stone Zone / Gems Realm tables call:
// Java `String` semantics (`J`), a port of Moonlight Lib's
// `BlockTypeResTransformer` (the text rewrites applied to a template block's
// blockstate and models), and the views of a block type and resource
// location the translated module lambdas use with their Java method names.
//
// Port of Moonlight Lib 1.21 (`net.mehvahdjukaar.moonlight.api.resources.
// BlockTypeResTransformer`, `api.set.BlockType.createFullIdWith`;
// https://github.com/MehVahdJukaar/Moonlight, commit 72afa38) and Every
// Compat 1.21 (`CompatSpritesHelper` predicates and helpers;
// https://github.com/MehVahdJukaar/WoodGood, commit 556d936). Copyright (c)
// MehVahdJukaar and the Supplementaries Team, under the Supplementaries Team
// License, whose authors this port credits.
//
// Worker-safe: no DOM access.

import {
  looksLikeLeafTexture,
  looksLikeSideLogTexture,
  looksLikeTopLogTexture,
} from "./texture/generate";

/** Java `String` methods with Java semantics, for translated lambdas. */
export const J = {
  /** `String.replace(CharSequence, CharSequence)`: every literal occurrence. */
  replace(s: string, target: string, replacement: string): string {
    return s.split(String(target)).join(String(replacement));
  },
  /** `String.replaceAll(regex, replacement)`. */
  replaceAll(s: string, regex: string, replacement: string): string {
    return s.replace(new RegExp(regex, "g"), javaReplacement(replacement));
  },
  /** `String.matches(regex)`: the whole string. */
  matches(s: string, regex: string): boolean {
    return new RegExp(`^(?:${regex})$`).test(s);
  },
  equals(a: unknown, b: unknown): boolean {
    return String(a) === String(b);
  },
  contains(s: string, part: string): boolean {
    return s.includes(String(part));
  },
  startsWith(s: string, part: string): boolean {
    return s.startsWith(part);
  },
  endsWith(s: string, part: string): boolean {
    return s.endsWith(part);
  },
  isEmpty(s: string): boolean {
    return s.length === 0;
  },
};

/** A Java `replaceAll` replacement (`$1`, `\$`) as a JS one. */
function javaReplacement(replacement: string): string {
  let out = "";
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i];
    if (c === "\\" && i + 1 < replacement.length) {
      const next = replacement[++i];
      out += next === "$" ? "$$" : next;
    } else {
      out += c;
    }
  }
  return out;
}

/** A Minecraft `ResourceLocation` (`toString` is `ns:path`). */
export class EcResourceLocation {
  readonly namespace: string;
  readonly path: string;

  constructor(namespace: string, path: string) {
    this.namespace = namespace;
    this.path = path;
  }

  static parse(id: string): EcResourceLocation {
    const colon = id.indexOf(":");
    return colon < 0
      ? new EcResourceLocation("minecraft", id)
      : new EcResourceLocation(id.slice(0, colon), id.slice(colon + 1));
  }

  getNamespace(): string {
    return this.namespace;
  }

  getPath(): string {
    return this.path;
  }

  withPath(path: string): EcResourceLocation {
    return new EcResourceLocation(this.namespace, path);
  }

  withPrefix(prefix: string): EcResourceLocation {
    return new EcResourceLocation(this.namespace, prefix + this.path);
  }

  withSuffix(suffix: string): EcResourceLocation {
    return new EcResourceLocation(this.namespace, this.path + suffix);
  }

  toString(): string {
    return `${this.namespace}:${this.path}`;
  }
}

/** What a translated lambda may ask of a block type (Java names). */
export interface EcTypeView {
  getId(): EcResourceLocation;
  getNamespace(): string;
  getTypeName(): string;
  /** Child under `key`: a block or item id, or null. */
  getChild(key: string): string | null;
  hasChild(key: string): boolean;
  getBlockOfThis(key: string): string | null;
  getItemOfThis(key: string): string | null;
  isBambooLike(): boolean;
  /** Leaves: the associated wood type, or null. */
  getAssociatedWoodType(): EcTypeView | null;
  createFullIdWith(
    modId: string,
    folder: string,
    shortId: string,
    prefix: string,
    suffix: string,
  ): string;
  /** Stone Zone `RockType.CreateStandardId`. */
  CreateStandardId(shortId: string, prefix: string, suffix: string): string;
}

/** `BlockType.createFullIdWith`: `modId:folder/shortId/ns/prefix_TYPE_suffix`. */
export function createFullIdWith(
  type: { namespace: string; typeName: string },
  modIdOrEmpty: string,
  folderOrEmpty: string,
  shortIdOrEmpty: string,
  prefixOrEmpty: string,
  suffix: string,
): string {
  const modIded = modIdOrEmpty === "" ? "" : `${modIdOrEmpty}:`;
  const foldered = folderOrEmpty === "" ? "" : `${folderOrEmpty}/`;
  const namespaced =
    modIdOrEmpty === type.namespace ? "" : `${type.namespace}/`;
  const shortened = shortIdOrEmpty === "" ? "" : `${shortIdOrEmpty}/`;
  let prefixed = "";
  if (prefixOrEmpty.includes("/")) prefixed = prefixOrEmpty;
  else if (prefixOrEmpty !== "") prefixed = `${prefixOrEmpty}_`;
  let suffixed = "";
  if (/^\.(png|json)$/.test(suffix)) suffixed = suffix;
  else if (suffix !== "") suffixed = `_${suffix}`;
  return (
    modIded +
    foldered +
    shortened +
    namespaced +
    prefixed +
    type.typeName +
    suffixed
  );
}

/** Texture-label predicates of `CompatSpritesHelper` (on special-texture labels or texture ids). */
export type TexturePredicate = (label: string) => boolean;

/** `CompatSpritesHelper.LOOKS_LIKE_TOP_LOG_TEXTURE`. */
export const LOOKS_LIKE_TOP_LOG_TEXTURE: TexturePredicate =
  looksLikeTopLogTexture;
/** `CompatSpritesHelper.LOOKS_LIKE_SIDE_LOG_TEXTURE`. */
export const LOOKS_LIKE_SIDE_LOG_TEXTURE: TexturePredicate =
  looksLikeSideLogTexture;
/** `CompatSpritesHelper.LOOKS_LIKE_LEAF_TEXTURE`. */
export const LOOKS_LIKE_LEAF_TEXTURE: TexturePredicate = looksLikeLeafTexture;

export const ANY_TEXTURE: TexturePredicate = () => true;

/**
 * Moonlight `BlockTypeResTransformer.replaceFullGenericType`: rewrites
 * `oldNs:folder/…old…` references to the generated block's
 * `newNs:folder/<shortId>/<typeNs>/…new…`. `folder` is a regex, or a depth
 * (`.*?` per level) for resource paths.
 */
export function replaceFullGenericType(
  text: string,
  newTypeName: string,
  blockId: EcResourceLocation,
  oldTypeName: string,
  oldNamespace: string | null,
  folder: string | number,
): string {
  const folderRegex =
    typeof folder === "number"
      ? Array.from({ length: folder }, () => ".*?").join("\\/")
      : folder;
  const prefixMatch = /([^,]*(?=\/))/.exec(blockId.path);
  const blockFolderPrefix = prefixMatch ? prefixMatch[1] : "";
  const newNamespace = oldNamespace === null ? "" : `${blockId.namespace}:`;
  const oldNs = oldNamespace === null ? "" : `${oldNamespace}:`;
  const re = new RegExp(
    `${oldNs}(${folderRegex})/(/?(?:\\w+/)*\\w*?)(?<![a-zA-Z])${oldTypeName}(?![a-zA-Z])`,
    "g",
  );
  return text.replace(re, (_m, g1: string, g2: string) => {
    const group2 = g2.includes(oldTypeName)
      ? g2.replace(new RegExp(oldTypeName, "g"), newTypeName)
      : g2;
    return (
      newNamespace +
      [g1, blockFolderPrefix, group2 + newTypeName]
        .filter((s) => s !== "")
        .join("/")
    );
  });
}

/** `BlockTypeResTransformer.replaceTypeNoNamespace` (depth 1). */
export function replaceTypeNoNamespace(
  path: string,
  newTypeName: string,
  blockId: EcResourceLocation,
  oldTypeName: string,
): string {
  return replaceFullGenericType(
    path,
    newTypeName,
    blockId,
    oldTypeName,
    null,
    1,
  );
}

/** The texture of a child the transformer substitutes, or null when absent. */
export type ChildTextureLookup = (
  type: EcTypeView,
  child: string | ((t: EcTypeView) => string | null),
  predicate: TexturePredicate,
) => string | null;

type TextModifier = (
  s: string,
  blockId: EcResourceLocation,
  type: EcTypeView,
) => string;

/**
 * Moonlight `BlockTypeResTransformer`: text modifiers applied in order to a
 * template's raw JSON, plus an id modifier for its resource path.
 */
export class EcResTransformer {
  readonly modifiers: TextModifier[] = [];
  idModifier:
    | ((path: string, blockId: EcResourceLocation, type: EcTypeView) => string)
    | null = null;
  /** Supported mod id: the namespace rewritten by `replace*Type`. */
  readonly modId: string;
  private readonly childTexture: ChildTextureLookup;

  constructor(modId: string, childTexture: ChildTextureLookup) {
    this.modId = modId;
    this.childTexture = childTexture;
  }

  addModifier(modifier: TextModifier): this {
    this.modifiers.push(modifier);
    return this;
  }

  setIDModifier(
    modifier: (
      path: string,
      blockId: EcResourceLocation,
      type: EcTypeView,
    ) => string,
  ): this {
    this.idModifier = modifier;
    return this;
  }

  IDReplaceType(oldTypeName: string): this {
    return this.setIDModifier((s, id, t) =>
      replaceFullGenericType(s, t.getTypeName(), id, oldTypeName, null, 1),
    );
  }

  replaceString(from: string, to: string): this {
    return this.addModifier((s) => J.replace(s, from, to));
  }

  replaceSimpleType(oldTypeName: string): this {
    return this.addModifier((s, id, t) =>
      replaceFullGenericType(
        s,
        t.getTypeName(),
        id,
        oldTypeName,
        this.modId,
        1,
      ),
    );
  }

  replaceGenericType(oldTypeName: string, folder: string): this {
    return this.addModifier((s, id, t) =>
      replaceFullGenericType(
        s,
        t.getTypeName(),
        id,
        oldTypeName,
        this.modId,
        folder,
      ),
    );
  }

  replaceBlockType(oldTypeName: string): this {
    return this.replaceGenericType(oldTypeName, "block");
  }

  replaceItemType(oldTypeName: string): this {
    return this.replaceGenericType(oldTypeName, "item");
  }

  /**
   * Replace texture `target` with the texture of the type's child (`child`
   * key, or a function picking it). Moonlight's quirk is kept: when the
   * child's texture is found, every `"block/` also gains `minecraft:`.
   */
  replaceWithTextureFromChild(
    target: string,
    child: string | ((t: EcTypeView) => string | null),
    predicate: TexturePredicate = ANY_TEXTURE,
  ): this {
    return this.addModifier((s, _id, t) => {
      if (/^\{\s*"parent":\s*".*"\s*\}$/.test(s)) return s;
      const texture = this.childTexture(t, child, predicate);
      if (texture === null) return s;
      return J.replace(
        J.replace(s, '"block/', '"minecraft:block/'),
        `"${target}"`,
        `"${texture}"`,
      );
    });
  }

  /** `andThen`: other's modifiers after these, and other's id modifier. */
  andThen(other: EcResTransformer): this {
    this.modifiers.push(...other.modifiers);
    this.idModifier = other.idModifier;
    return this;
  }

  /** Apply the modifiers to `text`. */
  transformText(
    text: string,
    blockId: EcResourceLocation,
    type: EcTypeView,
  ): string {
    let out = text;
    for (const modifier of this.modifiers) out = modifier(out, blockId, type);
    return out;
  }

  /** The new resource path of `path` (e.g. `models/block/x.json`). */
  transformPath(
    path: string,
    blockId: EcResourceLocation,
    type: EcTypeView,
  ): string {
    return this.idModifier === null
      ? path
      : this.idModifier(path, blockId, type);
  }
}

/** The context the generated lambdas see as `c`. */
export interface EcContext {
  /** Supported mod id of the module's registration. */
  readonly modId: string;
  isModLoaded(modId: string): boolean;
  rl(namespace: string, path: string): EcResourceLocation;
  parseRl(id: string): EcResourceLocation;
  /** The block entry set `name` of this module generates for `type`, or null. */
  entryBlock(name: string, type: EcTypeView): string | null;
  readonly LOOKS_LIKE_TOP_LOG_TEXTURE: TexturePredicate;
  readonly LOOKS_LIKE_SIDE_LOG_TEXTURE: TexturePredicate;
  readonly LOOKS_LIKE_LEAF_TEXTURE: TexturePredicate;
  /** `CompatSpritesHelper.replaceOakPlanks` and friends. */
  replaceOakPlanks(m: EcResTransformer): EcResTransformer;
  replaceOakLeaves(m: EcResTransformer): EcResTransformer;
  replaceOakBark(m: EcResTransformer): EcResTransformer;
  replaceOakStripped(m: EcResTransformer): EcResTransformer;
}

/** The `CompatSpritesHelper` helpers of `EcContext`. */
export const SPRITE_HELPERS = {
  replaceOakPlanks: (m: EcResTransformer) =>
    m.replaceWithTextureFromChild("minecraft:block/oak_planks", "planks"),
  replaceOakLeaves: (m: EcResTransformer) =>
    m.replaceWithTextureFromChild(
      "minecraft:block/oak_leaves",
      "leaves",
      (s) =>
        !s.includes("_snow") && !s.includes("snow_") && !s.includes("snowy_"),
    ),
  replaceOakBark: (m: EcResTransformer) =>
    m
      .replaceWithTextureFromChild(
        "minecraft:block/oak_log",
        "log",
        LOOKS_LIKE_SIDE_LOG_TEXTURE,
      )
      .replaceWithTextureFromChild(
        "minecraft:block/oak_log_top",
        "log",
        LOOKS_LIKE_TOP_LOG_TEXTURE,
      ),
  replaceOakStripped: (m: EcResTransformer) =>
    m
      .replaceWithTextureFromChild(
        "minecraft:block/stripped_oak_log",
        "stripped_log",
        LOOKS_LIKE_SIDE_LOG_TEXTURE,
      )
      .replaceWithTextureFromChild(
        "minecraft:block/stripped_oak_log_top",
        "stripped_log",
        LOOKS_LIKE_TOP_LOG_TEXTURE,
      ),
} as const;
