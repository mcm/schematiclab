// Unlimited Chisel Works block ids → the rule and `from` / `through` states
// that generated them.
//
// Port of the naming in Unlimited Chisel Works 0.3.5 by asiekierka
// (https://github.com/asiekierka/UnlimitedChiselWorks, LGPL-3.0):
// `UCWBlockRule(JsonObject)` names each block
// `unlimitedchiselworks:<through id>_<from id>_<from meta>`,
// `BlockUCWProxy` / `UCWObjectBroker.createBlockState` give it the `through`
// block's properties, and `UnlimitedChiselWorks.registerBlocks` keeps the
// first rule registering an id (`loadLate` files register after the rest).
//
// Java reads each `from` state's metadata from the `from` mod's code, which we
// never load. Instead, in order of preference: `meta-overrides.ts` (exact),
// the Forge 1.12 flatten table for `minecraft:` blocks (exact), else the order
// the block's blockstate JSON lists its variant values (`approximate`).
//
// Worker-safe: no DOM access.

import { FORGE_1_12_FLATTEN } from "../../../schemlib/data/forge-1.12-flatten.generated";
import type { GeneratedBlockFiles, GeneratedBlockProperties } from "../types";
import { CHISEL_NAMESPACE, chiselBlock } from "./chisel";
import { UCW_META_OVERRIDES } from "./meta-overrides";
import {
  asUcwProviderData,
  parseUcwBlockState,
  UCW_NAMESPACE,
  type UcwBlockRule,
  type UcwBlockState,
  type UcwProviderData,
  type UcwRuleFile,
  type UcwStateSource,
} from "./rules";

/** Block id → properties per metadata (see `meta-overrides.ts`). */
export type UcwMetaOverrides = Readonly<
  Record<string, readonly (string | null)[]>
>;

/** A block's properties per metadata, null where no state has that meta. */
export interface UcwMetaStates {
  states: (Record<string, string> | null)[];
  /** True when the order is guessed from the blockstate JSON. */
  approximate: boolean;
}

/** One rule of one file, as registered. */
export interface UcwRuleRef {
  file: UcwRuleFile;
  rule: UcwBlockRule;
}

/** A UCW block whose rule's mods are all loaded. */
export interface UcwResolved extends UcwRuleRef {
  kind: "resolved";
  /** Metadata of the `from` state, from the block id. */
  fromMeta: number;
  /** The `from` state (properties as known, possibly partial). */
  from: UcwBlockState;
  /** The `through` state the block's properties select. */
  through: UcwBlockState;
  /** True when the `from` state's metadata was guessed. */
  approximate: boolean;
  warnings: string[];
}

/** A UCW block whose rule needs mods that aren't loaded. */
export interface UcwNeedsMods {
  kind: "needs-mods";
  /** Namespaces to load, sorted. */
  namespaces: string[];
  /** The rule, when UCW's rules are loaded. */
  ref?: UcwRuleRef;
}

export type UcwResolution =
  | UcwResolved
  | UcwNeedsMods
  | { kind: "unrecognised" };

// Java iterates metadata 0..15.
const MAX_META = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** `id.trim().replaceAll("[^A-Za-z0-9]", "_")`, as `UCWBlockRule` does. */
export function sanitizeUcwId(id: string): string {
  return id.trim().replace(/[^A-Za-z0-9]/g, "_");
}

/** The block of a state source (`UCWBlockRule.getBlock`: its first state). */
export function ucwSourceBlock(source: UcwStateSource): string {
  return source.kind === "block" ? source.block : source.states[0].block;
}

/** `UCWBlockRule.prefix`: `<through id>_<from id>_`, sanitized. */
export function ucwIdPrefix(rule: UcwBlockRule): string {
  return `${sanitizeUcwId(ucwSourceBlock(rule.through))}_${sanitizeUcwId(ucwSourceBlock(rule.from))}_`;
}

/** The id UCW registers for `rule`'s `from` state with metadata `fromMeta`. */
export function ucwBlockId(rule: UcwBlockRule, fromMeta: number): string {
  return `${UCW_NAMESPACE}:${ucwIdPrefix(rule)}${fromMeta}`;
}

/** Split a UCW block id into its rule prefix and `from` metadata. */
export function parseUcwBlockId(
  id: string,
): { prefix: string; fromMeta: number } | null {
  if (!id.startsWith(`${UCW_NAMESPACE}:`)) return null;
  const match = /^(.+_)(0|[1-9][0-9]*)$/.exec(
    id.slice(UCW_NAMESPACE.length + 1),
  );
  if (match === null) return null;
  return { prefix: match[1], fromMeta: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Metadata order of a block's states

function toRecord(entries: [string, string][]): Record<string, string> {
  // fromEntries defines own properties, so `__proto__` stays a plain key.
  return Object.fromEntries(entries);
}

let vanillaMetaStates: Map<string, (Record<string, string> | null)[]> | null =
  null;

/** `minecraft:` blocks' states per metadata, from the Forge 1.12 table. */
function vanillaStates(
  blockId: string,
): (Record<string, string> | null)[] | null {
  if (vanillaMetaStates === null) {
    vanillaMetaStates = new Map();
    for (const [key, value] of Object.entries(FORGE_1_12_FLATTEN)) {
      const bracket = key.indexOf("[");
      const block = bracket < 0 ? key : key.slice(0, bracket);
      const meta = Number(value.slice(value.indexOf(":") + 1));
      if (!Number.isInteger(meta) || meta < 0 || meta >= MAX_META) continue;
      const properties =
        bracket < 0
          ? {}
          : parseUcwBlockState(`${block}#${key.slice(bracket + 1, -1)}`)
              .properties;
      let list = vanillaMetaStates.get(block);
      if (list === undefined) {
        list = [];
        vanillaMetaStates.set(block, list);
      }
      while (list.length <= meta) list.push(null);
      // Several states may share a meta (e.g. `snowy`); the first is kept.
      list[meta] ??= properties;
    }
  }
  return vanillaMetaStates.get(blockId) ?? null;
}

// Keys of a variant object, which a Forge property object never has.
const VARIANT_KEYS = new Set([
  "model",
  "textures",
  "x",
  "y",
  "uvlock",
  "weight",
  "submodel",
  "transform",
  "custom",
]);

/** A `forge_marker` `variants` entry `"prop": { "value": {…}, … }`. */
function isForgePropertyObject(key: string, value: unknown): boolean {
  if (key === "normal" || key === "inventory" || !isRecord(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([name, variant]) => !VARIANT_KEYS.has(name) && isRecord(variant),
    )
  );
}

/**
 * Property → values in the order a blockstate JSON first lists them: vanilla
 * `variants` keys (`a=1,b=2`) and Forge `forge_marker` property objects.
 * Null when it has no `variants`.
 */
export function blockstatePropertyOrder(
  blockstate: unknown,
): Map<string, string[]> | null {
  if (!isRecord(blockstate) || !isRecord(blockstate.variants)) return null;
  const order = new Map<string, string[]>();
  const add = (name: string, value: string): void => {
    if (name.length === 0 || value.length === 0) return;
    let values = order.get(name);
    if (values === undefined) {
      values = [];
      order.set(name, values);
    }
    if (!values.includes(value)) values.push(value);
  };
  const forge = blockstate.forge_marker !== undefined;
  for (const [key, value] of Object.entries(blockstate.variants)) {
    if (key.includes("=")) {
      for (const pair of key.split(",")) {
        const eq = pair.indexOf("=");
        if (eq >= 0) add(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    } else if (forge && isForgePropertyObject(key, value)) {
      for (const name of Object.keys(value as Record<string, unknown>)) {
        add(key, name);
      }
    }
  }
  return order;
}

function blockstateFor(blockId: string, files: GeneratedBlockFiles): unknown {
  const file = files.fileForNamespace(namespaceOf(blockId));
  if (file === null) return undefined;
  return files.assets(file)?.blockstates[blockId];
}

/**
 * Property → values of a modded block in its guessed metadata order: the
 * blockstate JSON's order, plus values only its `ModBlock` lists, with
 * integer properties in numeric order. Null when the block isn't loaded.
 */
function moddedPropertyOrder(
  blockId: string,
  files: GeneratedBlockFiles,
): Map<string, string[]> | null {
  const fromJson = blockstatePropertyOrder(blockstateFor(blockId, files));
  const block = files.blocks(namespaceOf(blockId)).get(blockId);
  if (fromJson === null && block === undefined) return null;
  const order = fromJson ?? new Map<string, string[]>();
  for (const [name, values] of Object.entries(block?.properties ?? {})) {
    const listed = order.get(name) ?? [];
    for (const value of values) if (!listed.includes(value)) listed.push(value);
    order.set(name, listed);
  }
  for (const values of order.values()) {
    if (values.every((value) => /^[0-9]+$/.test(value))) {
      values.sort((a, b) => Number(a) - Number(b));
    }
  }
  return order;
}

/**
 * States per metadata of a Chisel block in `chisel.ts`'s table
 * (`variation=0`, `variation=1`, …), when Chisel is loaded. Else null.
 */
function chiselMetaStates(
  blockId: string,
  files: GeneratedBlockFiles,
): Record<string, string>[] | null {
  if (files.fileForNamespace(CHISEL_NAMESPACE) === null) return null;
  const block = chiselBlock(blockId);
  return (
    block?.variants.map((_, meta) => ({ variation: String(meta) })) ?? null
  );
}

/**
 * True when `blockId` exists in the files loaded for the version (vanilla
 * blocks always do).
 */
export function ucwBlockLoaded(
  blockId: string,
  files: GeneratedBlockFiles,
): boolean {
  const namespace = namespaceOf(blockId);
  return (
    namespace === "minecraft" ||
    chiselMetaStates(blockId, files) !== null ||
    files.blocks(namespace).has(blockId)
  );
}

/**
 * Guessed states per metadata: every combination of the `iterate` properties
 * (all properties when none of them is known), the first property outermost.
 */
function heuristicStates(
  order: ReadonlyMap<string, readonly string[]>,
  iterate: readonly string[],
): Record<string, string>[] {
  let names = iterate.filter((name) => (order.get(name)?.length ?? 0) > 0);
  if (names.length === 0) {
    names = [...order.keys()].filter((name) => order.get(name)!.length > 0);
  }
  let states: [string, string][][] = [[]];
  for (const name of names) {
    const next: [string, string][][] = [];
    for (const state of states) {
      for (const value of order.get(name)!) {
        next.push([...state, [name, value]]);
      }
    }
    // A prefix of the product only depends on a prefix of `states`.
    states = next.slice(0, MAX_META);
  }
  return states.map(toRecord);
}

/**
 * A block's states per metadata: from `overrides`, the Forge 1.12 table for
 * `minecraft:` blocks, `chisel.ts` for Chisel blocks, else guessed from its
 * blockstate JSON. Null when the
 * block is unknown (its mod isn't loaded or doesn't have it).
 */
export function ucwMetaStates(
  blockId: string,
  files: GeneratedBlockFiles,
  iterate: readonly string[] = [],
  overrides: UcwMetaOverrides = UCW_META_OVERRIDES,
): UcwMetaStates | null {
  const override = Object.hasOwn(overrides, blockId)
    ? overrides[blockId]
    : undefined;
  if (override !== undefined) {
    return {
      states: override.map((entry) =>
        entry === null
          ? null
          : parseUcwBlockState(`${blockId}#${entry}`).properties,
      ),
      approximate: false,
    };
  }
  if (namespaceOf(blockId) === "minecraft") {
    const states = vanillaStates(blockId);
    return states === null ? null : { states, approximate: false };
  }
  const chisel = chiselMetaStates(blockId, files);
  if (chisel !== null) return { states: chisel, approximate: false };
  const order = moddedPropertyOrder(blockId, files);
  if (order === null) return null;
  return { states: heuristicStates(order, iterate), approximate: true };
}

/** True when `candidate` has every property of `wanted` it knows about. */
function matchesState(
  candidate: Readonly<Record<string, string>>,
  wanted: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(wanted).every(
    ([name, value]) =>
      !Object.hasOwn(candidate, name) || candidate[name] === value,
  );
}

interface FromCandidate {
  state: UcwBlockState;
  approximate: boolean;
}

/**
 * `UCWJsonUtils.parseStateList(from)` keyed by each state's metadata (the
 * id suffix). States of unknown blocks are dropped, as Java drops them.
 */
export function ucwFromStates(
  source: UcwStateSource,
  files: GeneratedBlockFiles,
  overrides: UcwMetaOverrides = UCW_META_OVERRIDES,
): Map<number, FromCandidate> {
  const byMeta = new Map<number, FromCandidate>();
  if (source.kind === "block") {
    const metaStates = ucwMetaStates(
      source.block,
      files,
      source.iterate,
      overrides,
    );
    metaStates?.states.forEach((properties, meta) => {
      if (properties === null) return;
      byMeta.set(meta, {
        state: { block: source.block, properties },
        approximate: metaStates.approximate,
      });
    });
    return byMeta;
  }
  source.states.forEach((state, index) => {
    const metaStates = ucwMetaStates(state.block, files, [], overrides);
    if (metaStates === null) return;
    const found = metaStates.states.findIndex(
      (candidate) =>
        candidate !== null && matchesState(candidate, state.properties),
    );
    let meta: number;
    if (!metaStates.approximate) {
      if (found < 0) return;
      meta = found;
    } else if (source.list) {
      // Java indexes the list by each state's meta; assume listed order.
      meta = index;
    } else {
      meta = Math.max(found, 0);
    }
    const known = metaStates.approximate ? {} : metaStates.states[meta];
    // Later states replace earlier ones of the same meta, as in Java.
    byMeta.set(meta, {
      state: {
        block: state.block,
        properties: { ...known, ...state.properties },
      },
      approximate: metaStates.approximate,
    });
  });
  return byMeta;
}

/**
 * The `through` block's properties and values (the UCW block's), in metadata
 * order. Null when the block isn't loaded.
 */
export function ucwThroughProperties(
  rule: UcwBlockRule,
  files: GeneratedBlockFiles,
): Map<string, string[]> | null {
  const block = ucwSourceBlock(rule.through);
  const chisel = chiselMetaStates(block, files);
  if (chisel !== null) {
    return new Map([["variation", chisel.map((state) => state.variation)]]);
  }
  if (namespaceOf(block) !== "minecraft") {
    return moddedPropertyOrder(block, files);
  }
  const states = vanillaStates(block);
  if (states === null) return null;
  const order = new Map<string, string[]>();
  for (const state of states) {
    for (const [name, value] of Object.entries(state ?? {})) {
      const values = order.get(name) ?? [];
      if (!values.includes(value)) values.push(value);
      order.set(name, values);
    }
  }
  return order;
}

function formatProperties(properties: GeneratedBlockProperties): string {
  const pairs = Object.entries(properties).map(([k, v]) => `${k}=${v}`);
  return pairs.length === 0 ? "[]" : `[${pairs.join(",")}]`;
}

/**
 * The `through` state for a UCW block's `properties`: the same properties
 * when they're a state of the `through` block, else its metadata 0 state
 * (with a warning). Unknown `through` blocks take `properties` as they are.
 */
export function ucwThroughState(
  id: string,
  rule: UcwBlockRule,
  properties: GeneratedBlockProperties,
  files: GeneratedBlockFiles,
  warnings: string[],
  overrides: UcwMetaOverrides = UCW_META_OVERRIDES,
): UcwBlockState {
  const block = ucwSourceBlock(rule.through);
  const domain = ucwThroughProperties(rule, files);
  if (domain === null) return { block, properties: { ...properties } };
  const names = Object.keys(properties);
  const valid =
    names.length === domain.size &&
    names.every((name) => domain.get(name)?.includes(properties[name]));
  if (valid) return { block, properties: { ...properties } };

  const metaStates = ucwMetaStates(block, files, [], overrides);
  const first =
    metaStates?.states[0] ??
    metaStates?.states.find((state) => state !== null) ??
    toRecord([...domain].map(([name, values]) => [name, values[0]]));
  warnings.push(
    `${id}${formatProperties(properties)} isn't a state of ${block}; showing its metadata 0 state ${formatProperties(first)}`,
  );
  return { block, properties: { ...first } };
}

// ---------------------------------------------------------------------------
// Rules by id prefix

interface RuleIndex {
  /** Every rule, in registration order. */
  ordered: UcwRuleRef[];
  /** Rules by `ucwIdPrefix`, in registration order. */
  byPrefix: Map<string, UcwRuleRef[]>;
}

const indexCache = new WeakMap<UcwProviderData, RuleIndex>();

function ruleIndex(data: UcwProviderData): RuleIndex {
  let index = indexCache.get(data);
  if (index === undefined) {
    const ordered = [
      ...data.files.filter((file) => !file.loadLate),
      ...data.files.filter((file) => file.loadLate),
    ].flatMap((file) => file.rules.map((rule) => ({ file, rule })));
    const byPrefix = new Map<string, UcwRuleRef[]>();
    for (const ref of ordered) {
      const prefix = ucwIdPrefix(ref.rule);
      const list = byPrefix.get(prefix) ?? [];
      list.push(ref);
      byPrefix.set(prefix, list);
    }
    index = { ordered, byPrefix };
    indexCache.set(data, index);
  }
  return index;
}

/** Every rule, in registration order (`loadLate` files last). */
export function ucwRulesInOrder(data: UcwProviderData): readonly UcwRuleRef[] {
  return ruleIndex(data).ordered;
}

/**
 * Namespaces `ref` needs that have no file loaded: its file's `modid` list
 * and the namespaces of its blocks. Sorted.
 */
export function ucwMissingNamespaces(
  ref: UcwRuleRef,
  files: GeneratedBlockFiles,
): string[] {
  const { rule } = ref;
  const needed = new Set(ref.file.modids);
  for (const source of [
    rule.from,
    rule.through,
    rule.basedUpon,
    rule.overlay,
  ]) {
    if (source !== undefined) needed.add(namespaceOf(ucwSourceBlock(source)));
  }
  needed.delete("minecraft");
  needed.delete(UCW_NAMESPACE);
  return [...needed]
    .filter((namespace) => files.fileForNamespace(namespace) === null)
    .sort();
}

/** UCW's rules from its file loaded for `files.gameVersion`, or null. */
export function ucwRules(files: GeneratedBlockFiles): UcwProviderData | null {
  return asUcwProviderData(files.providerData(UCW_NAMESPACE));
}

/**
 * Resolve a UCW block state against the files loaded for one Minecraft
 * version. Among rules sharing the id's prefix whose mods are loaded, the
 * first (in registration order) with a `from` state at the id's metadata
 * wins; when none has one, the first such rule is used with a warning.
 */
export function resolveUcwBlock(
  id: string,
  properties: GeneratedBlockProperties,
  files: GeneratedBlockFiles,
  overrides: UcwMetaOverrides = UCW_META_OVERRIDES,
): UcwResolution {
  const parsed = parseUcwBlockId(id);
  if (parsed === null) return { kind: "unrecognised" };
  const data = ucwRules(files);
  if (data === null) return { kind: "needs-mods", namespaces: [UCW_NAMESPACE] };
  const candidates = ruleIndex(data).byPrefix.get(parsed.prefix);
  if (candidates === undefined) return { kind: "unrecognised" };

  const applicable: UcwRuleRef[] = [];
  let closest: { ref: UcwRuleRef; missing: string[] } | null = null;
  for (const ref of candidates) {
    const missing = ucwMissingNamespaces(ref, files);
    if (missing.length === 0) applicable.push(ref);
    else if (closest === null || missing.length < closest.missing.length) {
      closest = { ref, missing };
    }
  }
  if (applicable.length === 0) {
    return {
      kind: "needs-mods",
      namespaces: closest!.missing,
      ref: closest!.ref,
    };
  }

  const warnings: string[] = [];
  for (const ref of applicable) {
    const from = ucwFromStates(ref.rule.from, files, overrides).get(
      parsed.fromMeta,
    );
    if (from === undefined) continue;
    return {
      kind: "resolved",
      ...ref,
      fromMeta: parsed.fromMeta,
      from: from.state,
      through: ucwThroughState(
        id,
        ref.rule,
        properties,
        files,
        warnings,
        overrides,
      ),
      approximate: from.approximate,
      warnings,
    };
  }

  const ref = applicable[0];
  const fromBlock = ucwSourceBlock(ref.rule.from);
  const first = [...ucwFromStates(ref.rule.from, files, overrides)].sort(
    ([a], [b]) => a - b,
  )[0]?.[1];
  warnings.push(
    `No known ${fromBlock} state has metadata ${parsed.fromMeta}; showing ${first === undefined ? "the block" : `its state ${formatProperties(first.state.properties)}`}`,
  );
  return {
    kind: "resolved",
    ...ref,
    fromMeta: parsed.fromMeta,
    from: first?.state ?? { block: fromBlock, properties: {} },
    through: ucwThroughState(
      id,
      ref.rule,
      properties,
      files,
      warnings,
      overrides,
    ),
    approximate: true,
    warnings,
  };
}
