// Reads the compat modules of one addon (Every Compat, Stone Zone or Gems
// Realm) from its checkout: the `addOptionalModule` / `addIfLoaded`
// registrations, each module's shortId and builder chains, and turns every
// chain into an entry-set record for `gen:everycomp`.

import { emitLambda, EmitError, type EmitScope } from "./emit.ts";
import {
  lineOf,
  matchBracket,
  parseJavaExpression,
  splitArgs,
  unescapeJava,
  type JavaNode,
} from "./java.ts";
import type {
  JavaClass,
  Repo,
  SourceIndex,
  SourceSet,
} from "./source-index.ts";

export type Addon = Exclude<Repo, "moonlight">;

/** Where an addon registers its modules, per source set. */
const ENTRY_POINTS: Record<Addon, { file: string; sourceSet: SourceSet }[]> = {
  everycomp: [
    { file: "EveryCompatCommon", sourceSet: "common" },
    { file: "EveryCompatForge", sourceSet: "neoforge" },
    { file: "EveryCompatFabric", sourceSet: "fabric" },
  ],
  stonezone: [
    { file: "StoneZoneCommon", sourceSet: "common" },
    { file: "StoneZoneForge", sourceSet: "neoforge" },
    { file: "StoneZoneFabric", sourceSet: "fabric" },
  ],
  gemsrealm: [
    { file: "GemsRealmCommon", sourceSet: "common" },
    { file: "GemsRealmForge", sourceSet: "neoforge" },
    { file: "GemsRealmFabric", sourceSet: "fabric" },
  ],
};

/**
 * Parts of code guards around registrations (`if (…) addOptionalModule(…)`)
 * that always hold for the port: client-side checks, config toggles at
 * their defaults, and checks of the mod's version or classes (assumed to
 * pass). `isModLoaded` parts are read generically; any other guard fails
 * the generator, so a new kind of guard is a conscious decision.
 */
const ALWAYS_TRUE_GUARDS = new Set([
  "INCLUDE_ALL_WOOD_MODULES.get()",
  "PlatHelper.getPhysicalSide().isClient()",
  "Objects.nonNull(modClass)",
  'Objects.nonNull(modClass) && PlatHelper.isModLoaded("shutter")',
]);

interface Guard {
  requiresAnyOf?: string[];
  requiresNoneOf?: string[];
}

/** The registration guard `condition` means, or throws. */
function readGuard(condition: string, guard: Guard): void {
  for (const part of condition.split(/\s*&&\s*/)) {
    if (ALWAYS_TRUE_GUARDS.has(part)) continue;
    // mod version checks: assume a supported version is loaded
    if (/^!PlatHelper\.getModVersion\("[^"]+"\)\.matches\(.*\)$/.test(part))
      continue;
    const any = part
      .replace(/^\((.*)\)$/, "$1")
      .split(/\s*\|\|\s*/)
      .map((p) => /^PlatHelper\.isModLoaded\(\s*"([^"]+)"\s*\)$/.exec(p)?.[1]);
    if (any.every((m) => m !== undefined)) {
      guard.requiresAnyOf = [
        ...(guard.requiresAnyOf ?? []),
        ...(any as string[]),
      ];
      continue;
    }
    const none = /^!\s*PlatHelper\.isModLoaded\(\s*"([^"]+)"\s*\)$/.exec(part);
    if (none !== null) {
      guard.requiresNoneOf = [...(guard.requiresNoneOf ?? []), none[1]];
      continue;
    }
    throw new Error(`unknown registration guard: ${part} (in ${condition})`);
  }
}

export interface Registration {
  modId: string;
  cls: JavaClass;
  sourceSet: SourceSet;
  requiresAnyOf?: string[];
  requiresNoneOf?: string[];
}

/** The `if (…)` conditions enclosing offset `at` of `src`. */
function enclosingIfs(src: string, at: number): string[] {
  const conditions: string[] = [];
  const stack: number[] = [];
  for (let i = 0; i < at; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "{") stack.push(i);
    else if (c === "}") stack.pop();
  }
  for (const open of stack) {
    // `if (cond) {`: the `{` follows the `)` closing the `if (`
    let close = open - 1;
    while (close >= 0 && /\s/.test(src[close])) close--;
    if (src[close] !== ")") continue;
    let depth = 0;
    let start = close;
    for (; start >= 0; start--) {
      if (src[start] === ")") depth++;
      else if (src[start] === "(") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (!/\bif\s*$/.test(src.slice(Math.max(0, start - 10), start))) continue;
    conditions.push(
      src
        .slice(start + 1, close)
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return conditions;
}

export function readRegistrations(
  index: SourceIndex,
  addon: Addon,
): Registration[] {
  const out: Registration[] = [];
  for (const entry of ENTRY_POINTS[addon]) {
    const cls = index.classes.find(
      (c) =>
        c.repo === addon &&
        c.name === entry.file &&
        c.sourceSet === entry.sourceSet,
    );
    if (cls === undefined) {
      throw new Error(`${addon}: entry point ${entry.file} not found`);
    }
    const re =
      /\b(addOptionalModule|addIfLoaded|addMultipleOptional|addMultipleIfLoaded)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cls.src)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(cls.src, open);
      const args = splitArgs(cls.src.slice(open + 1, close));
      re.lastIndex = close;
      // the method definitions themselves (EveryCompat.java) aren't here
      if (!/^"/.test(args[0] ?? "")) continue;
      const modId = unescapeJava(args[0]);
      const guard: Guard = {};
      for (const condition of enclosingIfs(cls.src, m.index)) {
        try {
          readGuard(condition, guard);
        } catch (err) {
          throw new Error(`${addon}: ${(err as Error).message}`);
        }
      }
      const { requiresAnyOf, requiresNoneOf } = guard;
      for (const arg of args.slice(1)) {
        const target = /->\s*(\w+)(?:\.class|::new)/.exec(arg);
        if (target === null) continue;
        const compatModule = index.resolveClass(cls, target[1]);
        if (compatModule === null) {
          throw new Error(`${addon}: module class ${target[1]} not found`);
        }
        out.push({
          modId,
          cls: compatModule,
          sourceSet: entry.sourceSet,
          ...(requiresAnyOf ? { requiresAnyOf } : {}),
          ...(requiresNoneOf ? { requiresNoneOf } : {}),
        });
      }
    }
  }
  return out;
}

// ── Builder chains ───────────────────────────────────────────────────────

const BUILDER_RE =
  /\b(SimpleEntrySet|StoneZoneEntrySet|GemsRealmEntrySet|QuarkSimpleEntrySet|QuarkEntrySet|ItemOnlyEntrySet)\s*(?:\.\s*<[^>]*>)?\s*\.\s*(builder|of)\s*\(/g;

export interface RawChain {
  kind: string;
  args: string[];
  calls: { name: string; args: string[]; line: number }[];
  line: number;
  field: string | null;
}

export function parseChains(src: string): RawChain[] {
  const chains: RawChain[] = [];
  BUILDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BUILDER_RE.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(src, open);
    const args = splitArgs(src.slice(open + 1, close));
    const calls: RawChain["calls"] = [];
    let k = close + 1;
    for (;;) {
      const mm = /^\s*\.\s*(?:<[^>]*>\s*)?(\w+)\s*\(/.exec(src.slice(k));
      if (mm === null) break;
      const o = k + mm[0].length - 1;
      const c = matchBracket(src, o);
      calls.push({
        name: mm[1],
        args: splitArgs(src.slice(o + 1, c)),
        line: lineOf(src, k),
      });
      k = c + 1;
    }
    const before = src.slice(Math.max(0, m.index - 120), m.index);
    const field = /(\w+)\s*=\s*$/.exec(before)?.[1] ?? null;
    chains.push({ kind: m[1], args, calls, line: lineOf(src, m.index), field });
    BUILDER_RE.lastIndex = k;
  }
  return chains;
}

const MODULE_BASES = new Set([
  "EveryCompatModule",
  "StoneZoneModule",
  "GemsRealmModule",
  "SimpleModule",
  "CompatModule",
]);

/** The module's classes from itself up to (excluding) the API base. */
export function moduleHierarchy(
  index: SourceIndex,
  cls: JavaClass,
): JavaClass[] {
  const chain: JavaClass[] = [];
  for (const c of index.hierarchy(cls)) {
    if (MODULE_BASES.has(c.name)) break;
    chain.push(c);
  }
  return chain;
}

export function moduleShortId(index: SourceIndex, cls: JavaClass): string {
  for (const c of moduleHierarchy(index, cls)) {
    const m = /\bsuper\s*\(\s*\w+\s*,\s*"([^"]*)"/.exec(c.src);
    if (m !== null) return m[1];
  }
  throw new Error(`No shortId for ${cls.name}`);
}

const TYPE_CLASSES: Record<string, string> = {
  WoodType: "wood",
  LeavesType: "leaves",
  StoneType: "stone",
  MudType: "mud",
  GemType: "gem",
  MetalType: "metal",
  CrystalType: "crystal",
  DustType: "dust",
};

const IGNORED_CALLS = new Set([
  "addTag",
  "setTab",
  "setTabKey",
  "setTabMode",
  "noTab",
  "defaultRecipe",
  "addRecipe",
  "build",
  "copyParentDrop",
  "dropSelf",
  "noDrops",
  "addCustomItem",
  "noItem",
  "requiresModConfig",
  // Gems Realm's deprecated palette builder is a no-op (it never reaches the
  // texture infos)
  "createPaletteFromRockChild",
]);

export interface ChainContext {
  index: SourceIndex;
  addon: Addon;
  /** The class the chain is written in. */
  cls: JavaClass;
  shortId: string;
  /** Entry-set field → entry-set name, for this module. */
  fields: Map<string, string>;
  warnings: string[];
}

function str(node: JavaNode | undefined): string | null {
  return node?.kind === "string" ? node.value : null;
}

/** Resolve a static constant used in a chain (child keys, mod ids…). */
function constant(ctx: ChainContext, name: string): string | null {
  const dot = name.indexOf(".");
  const found =
    dot < 0
      ? ctx.index.resolveField(ctx.cls, name)
      : ctx.index.resolveQualifiedField(
          ctx.cls,
          name.slice(0, dot),
          name.slice(dot + 1),
        );
  if (found === null || found.field.init === null) return null;
  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(found.field.init);
  if (literal !== null) return unescapeJava(`"${literal[1]}"`);
  // `EveryCompat.MOD_ID`-style aliases
  if (/^[\w.]+$/.test(found.field.init)) {
    const ownerCtx = { ...ctx, cls: found.owner };
    return constant(ownerCtx, found.field.init);
  }
  return null;
}

/** The namespace `res(…)` means in `cls` (a static import of an addon's `res`). */
function resNamespace(ctx: ChainContext): string {
  for (const c of ctx.index.hierarchy(ctx.cls)) {
    const owner = c.staticImports.get("res");
    if (owner?.endsWith(".EveryCompat")) return "everycomp";
    if (owner?.endsWith(".StoneZone")) return "stonezone";
    if (owner?.endsWith(".GemsRealm")) return "gemsrealm";
  }
  return ctx.addon;
}

const ADDON_CLASSES: Record<string, string> = {
  EveryCompat: "everycomp",
  StoneZone: "stonezone",
  GemsRealm: "gemsrealm",
};

/** A texture/model id expression → `ns:path` (`@:` for the module's mod). */
function resourceId(ctx: ChainContext, node: JavaNode): string {
  if (node.kind === "call") {
    const arg0 = str(node.args[0]);
    const arg1 = str(node.args[1]);
    if (node.target === null) {
      if (node.name === "modRes" && arg0 !== null) return `@:${arg0}`;
      if (node.name === "res" && arg0 !== null)
        return `${resNamespace(ctx)}:${arg0}`;
    } else if (node.target.kind === "name") {
      const owner = node.target.name;
      if (owner in ADDON_CLASSES && node.name === "res" && arg0 !== null) {
        return `${ADDON_CLASSES[owner]}:${arg0}`;
      }
      if (owner === "ResourceLocation") {
        if (
          (node.name === "parse" || node.name === "tryParse") &&
          arg0 !== null
        ) {
          return arg0.includes(":") ? arg0 : `minecraft:${arg0}`;
        }
        if (node.name === "withDefaultNamespace" && arg0 !== null) {
          return `minecraft:${arg0}`;
        }
        if (
          node.name === "fromNamespaceAndPath" &&
          arg0 !== null &&
          arg1 !== null
        ) {
          return `${arg0}:${arg1}`;
        }
      }
    }
  }
  if (
    node.kind === "name" &&
    new RegExp(String.raw`\bResourceLocation\s+${node.name}\s*;`).test(
      ctx.cls.src,
    )
  ) {
    // A local variable (BBB picks its frame textures by mod version): use
    // the last assignment in the source, the newest version's branch.
    const assignments = [
      ...ctx.cls.src.matchAll(
        new RegExp(String.raw`\b${node.name}\s*=\s*([^;]+);`, "g"),
      ),
    ];
    const last = assignments[assignments.length - 1];
    if (last !== undefined) {
      ctx.warnings.push(
        `${ctx.cls.file}: ${node.name} takes its last assignment (${last[1].trim()})`,
      );
      return resourceId(ctx, parseJavaExpression(last[1]));
    }
  }
  throw new Error(`Unsupported resource expression ${JSON.stringify(node)}`);
}

function isResourceExpression(ctx: ChainContext, node: JavaNode): boolean {
  try {
    resourceId(ctx, node);
    return true;
  } catch {
    return false;
  }
}

/** Palette strategy key `<repo>:<Class>.<FIELD>` for an identifier. */
function paletteKey(ctx: ChainContext, node: JavaNode): string {
  let found = null;
  if (node.kind === "name") found = ctx.index.resolveField(ctx.cls, node.name);
  else if (node.kind === "field" && node.target.kind === "name") {
    found = ctx.index.resolveQualifiedField(
      ctx.cls,
      node.target.name,
      node.name,
    );
  }
  if (found === null) {
    throw new Error(`Unknown palette strategy ${JSON.stringify(node)}`);
  }
  return `${found.owner.repo}:${found.owner.name}.${found.field.name}`;
}

/** The base type id from `() -> VanillaWoodTypes.OAK`. */
function baseTypeId(ctx: ChainContext, src: string): string {
  const holder = new RegExp(
    String.raw`\b${src.trim()}\s*=\s*\w+\.INSTANCE\.makeFutureHolder\(\s*ResourceLocation\.parse\(\s*"([^"]+)"`,
  ).exec(ctx.cls.src);
  if (/^\w+$/.test(src.trim()) && holder !== null) return holder[1];
  const m = /^\(\)\s*->\s*(Vanilla\w+Types)\.(\w+)$/.exec(
    src.replace(/\s+/g, " ").trim(),
  );
  if (m === null) throw new Error(`Unsupported base type ${src}`);
  const found = ctx.index.resolveQualifiedField(ctx.cls, m[1], m[2]);
  const literal = found?.field.init?.match(
    /withDefaultNamespace\(\s*"([^"]+)"\s*\)|fromNamespaceAndPath\(\s*"minecraft"\s*,\s*"([^"]+)"\s*\)|ResourceLocation\.parse\(\s*"([^":]+)"\s*\)/,
  );
  if (!literal) throw new Error(`Can't read ${m[1]}.${m[2]}`);
  return `minecraft:${literal[1] ?? literal[2] ?? literal[3]}`;
}

/** Moonlight's `makeEntryName` for the base type name. */
export function entryName(
  prefix: string | null,
  name: string,
  typeName: string,
): string {
  if (prefix !== null)
    return `${prefix}_${typeName}${name === "" ? "" : `_${name}`}`;
  return `${typeName}_${name}`;
}

export interface ParsedTexture {
  texture: string;
  mask?: string;
  overlay?: string;
  palette?: string;
  noAnimation?: true;
  copyTexture?: true;
  keepNamespace?: true;
  customPath?: string;
}

function textureInfoOf(ctx: ChainContext, node: JavaNode): ParsedTexture {
  // TextureInfo.of(res[, "path"]).mask(m).copyTexture()…
  const calls: Extract<JavaNode, { kind: "call" }>[] = [];
  let cur: JavaNode = node;
  while (
    cur.kind === "call" &&
    cur.target !== null &&
    !(cur.target.kind === "name" && cur.target.name === "TextureInfo")
  ) {
    calls.unshift(cur);
    cur = cur.target;
  }
  if (cur.kind !== "call" || cur.name !== "of") {
    throw new Error(`Unsupported TextureInfo ${JSON.stringify(node)}`);
  }
  const info: ParsedTexture = { texture: resourceId(ctx, cur.args[0]) };
  const path = str(cur.args[1]);
  if (path !== null) info.customPath = path;
  for (const call of calls) {
    switch (call.name) {
      case "mask":
        info.mask = resourceId(ctx, call.args[0]);
        break;
      case "overlay":
        info.overlay = resourceId(ctx, call.args[0]);
        break;
      case "copyTexture":
        info.copyTexture = true;
        break;
      case "noAnimation":
        info.noAnimation = true;
        break;
      case "keepNamespace":
        info.keepNamespace = true;
        break;
      case "setPalette":
        info.palette = paletteKey(ctx, call.args[0]);
        break;
      case "forEntityOrGui":
        info.noAnimation = true;
        break;
      case "build":
        break;
      default:
        throw new Error(`Unsupported TextureInfo call ${call.name}`);
    }
  }
  return info;
}

function textureCall(
  ctx: ChainContext,
  name: string,
  rawArgs: string[],
): ParsedTexture {
  const args = rawArgs.map(parseJavaExpression);
  const first = args[0];
  if (
    name === "addTexture" &&
    first.kind === "call" &&
    !isResourceExpression(ctx, first)
  ) {
    return textureInfoOf(ctx, first);
  }
  const info: ParsedTexture = { texture: resourceId(ctx, first) };
  const rest = args.slice(1);
  switch (name) {
    case "addTexture":
      if (rest[0]) info.palette = paletteKey(ctx, rest[0]);
      break;
    case "addNonAnimatedTexture":
      info.noAnimation = true;
      break;
    case "addNonAnimatedTextureM":
      info.mask = resourceId(ctx, rest[0]);
      info.noAnimation = true;
      break;
    case "addTextureM":
      info.mask = resourceId(ctx, rest[0]);
      if (rest[1]) {
        if (isResourceExpression(ctx, rest[1])) {
          info.overlay = resourceId(ctx, rest[1]);
          if (rest[2]) info.palette = paletteKey(ctx, rest[2]);
        } else info.palette = paletteKey(ctx, rest[1]);
      }
      break;
    case "addTextureC":
      if (rest.length === 2) info.palette = paletteKey(ctx, rest[0]);
      info.customPath = str(rest[rest.length - 1]) ?? undefined;
      break;
    case "addTextureMC":
      info.mask = resourceId(ctx, rest[0]);
      info.palette = paletteKey(ctx, rest[1]);
      info.customPath = str(rest[2]) ?? undefined;
      break;
    case "copyTexture":
      info.copyTexture = true;
      break;
    default:
      throw new Error(`Unsupported texture call ${name}`);
  }
  if (info.palette === "everycomp:PaletteStrategies.MAIN_CHILD")
    delete info.palette;
  return info;
}

export interface ParsedEntrySet {
  kind: string;
  name: string;
  prefix: string | null;
  baseType: string;
  baseBlock: string | null;
  field?: string;
  line: number;
  itemOnly: boolean;
  textures: ParsedTexture[];
  mergedPalette: boolean;
  /** TS source: `(c) => <Java transform lambda>`. */
  modelTransform?: string;
  /** TS source: `(c) => (t) => boolean`. */
  condition?: string;
  includeModels?: { block: string[]; item: string[]; generate: boolean };
  renderType?: string;
  tile: boolean;
  copyTint: boolean;
  unsupported: string[];
}

function emitScope(ctx: ChainContext): EmitScope {
  return {
    modId: "",
    shortId: ctx.shortId,
    addon: ctx.addon,
    constant: (name) => constant(ctx, name),
    entryField: (field) => ctx.fields.get(field) ?? null,
  };
}

/** The builder arguments without Quark's extra module class argument. */
function builderArgs(chain: RawChain): string[] {
  const args = [...chain.args];
  if (chain.kind === "QuarkSimpleEntrySet" || chain.kind === "QuarkEntrySet") {
    // (type, name, [prefix,] QuarkModule.class, baseBlock, baseType, factory)
    args.splice(
      args.findIndex((a, i) => i > 0 && /\.class$/.test(a)),
      1,
    );
  }
  return args;
}

/** The `name` and `prefix` builder arguments of a chain. */
export function chainNames(chain: RawChain): {
  name: string;
  prefix: string | null;
} {
  const args = builderArgs(chain);
  const hasPrefix = args.length === 6;
  return {
    name: unescapeJava(args[1]),
    prefix: hasPrefix && args[2] !== "null" ? unescapeJava(args[2]) : null,
  };
}

/** `AbstractSimpleEntrySet.typeName`: the entry set's name (child key path). */
export function entrySetName(prefix: string | null, name: string): string {
  return (prefix === null ? "" : prefix + (name === "" ? "" : "_")) + name;
}

export function parseEntrySet(
  ctx: ChainContext,
  chain: RawChain,
): ParsedEntrySet {
  const args = builderArgs(chain);
  const hasPrefix = args.length === 6;
  const typeClass = /^(\w+)\.class$/.exec(args[0])?.[1] ?? "";
  const kind = TYPE_CLASSES[typeClass];
  if (kind === undefined) throw new Error(`Unknown type class ${args[0]}`);
  const { name, prefix } = chainNames(chain);
  const baseBlockSrc = args[hasPrefix ? 3 : 2].replace(/\s+/g, " ").trim();
  const baseType = baseTypeId(ctx, args[hasPrefix ? 4 : 3]);
  const baseBlock =
    /^getMod(?:Block|Item)\(\s*"([^"]*)"/.exec(baseBlockSrc)?.[1] ??
    (/BuiltInRegistries\.BLOCK\.get\(\s*ResourceLocation\.withDefaultNamespace\(\s*"([^"]+)"/.exec(
      baseBlockSrc,
    )?.[1]
      ? `minecraft:${/withDefaultNamespace\(\s*"([^"]+)"/.exec(baseBlockSrc)![1]}`
      : null);

  const out: ParsedEntrySet = {
    kind,
    name,
    prefix,
    baseType,
    baseBlock,
    ...(chain.field ? { field: chain.field } : {}),
    line: chain.line,
    itemOnly: chain.kind === "ItemOnlyEntrySet",
    textures: [],
    mergedPalette: false,
    tile: false,
    copyTint: chain.kind === "GemsRealmEntrySet",
    unsupported: [],
  };
  const conditions: string[] = [];
  const transforms: string[] = [];
  const scope = emitScope(ctx);
  for (const call of chain.calls) {
    try {
      switch (call.name) {
        case "addTexture":
        case "addTextureM":
        case "addNonAnimatedTexture":
        case "addNonAnimatedTextureM":
        case "addTextureC":
        case "addTextureMC":
        case "copyTexture":
          out.textures.push(textureCall(ctx, call.name, call.args));
          break;
        case "useMergedPalette":
          out.mergedPalette = true;
          break;
        case "copyParentTint":
          out.copyTint = true;
          break;
        case "addTile":
          out.tile = true;
          break;
        case "setRenderType": {
          const m = /(\w+)\s*$/.exec(call.args[0]);
          if (m) out.renderType = m[1].toLowerCase();
          break;
        }
        case "requiresChildren":
          for (const arg of call.args) {
            const node = parseJavaExpression(arg);
            const key =
              str(node) ??
              (node.kind === "name"
                ? constant(ctx, node.name)
                : node.kind === "field" && node.target.kind === "name"
                  ? constant(ctx, `${node.target.name}.${node.name}`)
                  : null);
            if (key === null) throw new Error(`Unknown child key ${arg}`);
            conditions.push(`t.getChild(${JSON.stringify(key)}) != null`);
          }
          break;
        case "requiresFromMap": {
          const m = /^(\w+)\.blocks$/.exec(call.args[0].trim());
          const entry = m ? ctx.fields.get(m[1]) : undefined;
          if (entry === undefined)
            throw new Error(`Unknown map ${call.args[0]}`);
          conditions.push(`c.entryBlock(${JSON.stringify(entry)}, t) != null`);
          break;
        }
        case "excludeBlockTypes": {
          const values = call.args.map((a) => {
            const node = parseJavaExpression(a);
            const s = str(node);
            if (s === null)
              throw new Error(`Non-literal excludeBlockTypes ${a}`);
            return s;
          });
          const regex =
            values.length === 1
              ? values[0]
              : `${values[0]}:(${values.slice(1).join("|")})`;
          conditions.push(
            `!J.matches(t.getId().toString(), ${JSON.stringify(regex)})`,
          );
          break;
        }
        case "addCondition": {
          const lambda = emitLambda(
            parseJavaExpression(call.args.join(", ")),
            scope,
          );
          conditions.push(`(${lambda})(t)`);
          break;
        }
        case "addModelTransform":
          transforms.push(
            emitLambda(parseJavaExpression(call.args.join(", ")), scope),
          );
          break;
        case "includeModelsBlock":
        case "includeModelsItem": {
          const includes = (out.includeModels ??= {
            block: [],
            item: [],
            generate: false,
          });
          let list = call.args.map(parseJavaExpression);
          if (list[0]?.kind === "bool") {
            includes.generate = list[0].value;
            list = list.slice(1);
          }
          const ids = list.map((n) => resourceId(ctx, n));
          (call.name === "includeModelsBlock"
            ? includes.block
            : includes.item
          ).push(...ids);
          break;
        }
        default:
          if (!IGNORED_CALLS.has(call.name)) {
            out.unsupported.push(call.name);
            ctx.warnings.push(
              `${ctx.cls.file}:${call.line}: unsupported builder call ${call.name}`,
            );
          }
      }
    } catch (err) {
      const reason =
        err instanceof EmitError || err instanceof Error
          ? err.message
          : String(err);
      out.unsupported.push(`${call.name}: ${reason}`);
      ctx.warnings.push(
        `${ctx.cls.file}:${call.line}: ${call.name}: ${reason}`,
      );
    }
  }
  if (conditions.length > 0) {
    out.condition = `(c) => (t) => ${conditions.map((s) => `(${s})`).join(" && ")}`;
  }
  if (transforms.length > 0) {
    out.modelTransform =
      transforms.length === 1
        ? `(c) => ${transforms[0]}`
        : `(c) => (m) => { ${transforms.map((t) => `(${t})(m);`).join(" ")} }`;
  }
  return out;
}

/** `getAlreadySupportedMods()` literals of a module, if overridden. */
export function alreadySupportedMods(
  index: SourceIndex,
  cls: JavaClass,
): string[] | null {
  for (const c of moduleHierarchy(index, cls)) {
    const m = /getAlreadySupportedMods\s*\(\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(
      c.src,
    );
    if (m !== null) {
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    }
  }
  return null;
}

/** True when a class of the module overrides `addDynamicClientResources`. */
export function hasCustomClientResources(
  index: SourceIndex,
  cls: JavaClass,
): boolean {
  return moduleHierarchy(index, cls).some((c) =>
    /void\s+addDynamicClientResources\s*\(/.test(c.src),
  );
}
