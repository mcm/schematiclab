// Unlimited Chisel Works block rules, read from the jar's
// `assets/unlimitedchiselworks/ucwdefs/**/*.json`.
//
// Port of the rule parsing in Unlimited Chisel Works 0.3.5 by asiekierka
// (https://github.com/asiekierka/UnlimitedChiselWorks, LGPL-3.0):
// `UnlimitedChiselWorks.proposeRule` (file `modid` / `loadLate`),
// `UCWBlockRule(JsonObject)` (per-rule fields) and `UCWJsonUtils.parseState` /
// `parseStateList` (state sources). Java resolves states against the block
// registry while parsing; here they stay as names and are resolved later
// against the loaded mod files.
//
// Worker-safe: no DOM access.

/** Block id namespace of UCW's generated blocks. */
export const UCW_NAMESPACE = "unlimitedchiselworks";

/** Display name of the mod. */
export const UCW_MOD_NAME = "Unlimited Chisel Works";

/** Jar entries holding UCW's bundled rule files. */
export const UCW_RULE_PATH_RE =
  /^assets\/unlimitedchiselworks\/ucwdefs\/((?:[^/]+\/)*[^/]+\.json)$/;

/** One block state named by a rule, e.g. `minecraft:planks#variant=oak`. */
export interface UcwBlockState {
  /** Namespaced block id, lower-cased (1.12 `ResourceLocation`). */
  block: string;
  /** `prop=value` pairs after `#`, in listed order. */
  properties: Record<string, string>;
}

/**
 * Where a rule's states come from: every state of a block
 * (`{ "block": id, "iterate": [...] }`) or listed states
 * (`{ "state": "id#…" }` / `{ "state": ["id#…", …] }`).
 */
export type UcwStateSource =
  | {
      kind: "block";
      block: string;
      /** Properties the file says it iterates; Java iterates every state. */
      iterate: string[];
    }
  | {
      kind: "state";
      states: UcwBlockState[];
      /** True for the array form, which Java indexes by each state's meta. */
      list: boolean;
    };

/** `UCWBlockRule.BlendMode`, lower-cased. */
export type UcwBlendMode = "none" | "blend" | "plank";

/** One entry of a rule file's `blocks` array (`UCWBlockRule`). */
export interface UcwBlockRule {
  /** The material whose colours are applied. */
  from: UcwStateSource;
  /** The (Chisel) block whose models and textures are recoloured. */
  through: UcwStateSource;
  /** The block `through`'s textures were drawn from (lightness reference). */
  basedUpon: UcwStateSource;
  /** Chroma source; absent means `from`. */
  overlay?: UcwStateSource;
  mode: UcwBlendMode;
  // Kept for completeness; not used by Schematiclab.
  group?: string;
  customBlockClass?: string;
  customItemClass?: string;
  customColorClass?: string;
  /** `custom_color_class` set or a `has_color` key present. */
  hasColor: boolean;
}

/** One `ucwdefs` JSON file. */
export interface UcwRuleFile {
  /** Path below `ucwdefs/`, e.g. `chisel/natura.json`. */
  path: string;
  /** Mods that must all be loaded for the rules to apply (`modid`). */
  modids: string[];
  /** `loadLate`: registered in UCW's second pass. */
  loadLate: boolean;
  /** Valid rules, in file order. */
  rules: UcwBlockRule[];
}

/** UCW's provider data on its loaded file (`providerData.unlimitedchiselworks`). */
export interface UcwProviderData {
  formatVersion: typeof UCW_RULES_FORMAT_VERSION;
  /** Rule files sorted by path. */
  files: UcwRuleFile[];
}

/** Bump when `UcwProviderData` changes incompatibly. */
export const UCW_RULES_FORMAT_VERSION = 1;

/** Warning on a stored UCW file loaded before its rules were read. */
export const UCW_RELOAD_WARNING =
  "Reload Unlimited Chisel Works to read its block rules";

class RuleError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `new ResourceLocation(s)` in 1.12: default namespace, lower-cased. */
function resourceLocation(raw: string, field: string): string {
  const id = raw.trim().toLowerCase();
  const colon = id.indexOf(":");
  const ns = colon < 0 ? "minecraft" : id.slice(0, colon);
  const path = colon < 0 ? id : id.slice(colon + 1);
  if (ns.length === 0 || path.length === 0) {
    throw new RuleError(`${field}: invalid block id "${raw}"`);
  }
  return `${ns}:${path}`;
}

/** `UCWJsonUtils.parseState`: `id` or `id#prop=value,prop=value`. */
export function parseUcwBlockState(
  raw: string,
  field = "state",
): UcwBlockState {
  const hash = raw.indexOf("#");
  const block = resourceLocation(hash < 0 ? raw : raw.slice(0, hash), field);
  const properties: Record<string, string> = {};
  if (hash >= 0) {
    for (const param of raw.slice(hash + 1).split(",")) {
      const eq = param.indexOf("=");
      // Java ignores parameters without a value.
      if (eq < 0) continue;
      const name = param.slice(0, eq);
      if (name.length === 0) continue;
      Object.defineProperty(properties, name, {
        value: param.slice(eq + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return { block, properties };
}

/** `UCWJsonUtils.parseStateList`. */
function parseStateSource(value: unknown, field: string): UcwStateSource {
  if (!isRecord(value)) throw new RuleError(`${field}: expected an object`);
  if ("block" in value) {
    if (typeof value.block !== "string") {
      throw new RuleError(`${field}.block: expected a string`);
    }
    const iterate = value.iterate ?? [];
    if (
      !Array.isArray(iterate) ||
      !iterate.every((name) => typeof name === "string")
    ) {
      throw new RuleError(`${field}.iterate: expected a list of strings`);
    }
    return {
      kind: "block",
      block: resourceLocation(value.block, `${field}.block`),
      iterate: [...(iterate as string[])],
    };
  }
  if ("state" in value) {
    const { state } = value;
    if (typeof state === "string") {
      return {
        kind: "state",
        states: [parseUcwBlockState(state, `${field}.state`)],
        list: false,
      };
    }
    if (
      Array.isArray(state) &&
      state.length > 0 &&
      state.every((s) => typeof s === "string")
    ) {
      return {
        kind: "state",
        states: (state as string[]).map((s) =>
          parseUcwBlockState(s, `${field}.state`),
        ),
        list: true,
      };
    }
    throw new RuleError(
      `${field}.state: expected a string or a non-empty list of strings`,
    );
  }
  throw new RuleError(`${field}: expected "block" or "state"`);
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RuleError(`${key}: expected a string`);
  }
  return value;
}

/** `UCWBlockRule(JsonObject)`. */
function parseRule(value: unknown): UcwBlockRule {
  if (!isRecord(value)) throw new RuleError("expected an object");
  for (const key of ["from", "through", "based_upon"]) {
    if (value[key] === undefined) throw new RuleError(`missing "${key}"`);
  }
  const from = parseStateSource(value.from, "from");
  const through = parseStateSource(value.through, "through");
  const basedUpon = parseStateSource(value.based_upon, "based_upon");
  const overlay =
    value.overlay === undefined
      ? undefined
      : parseStateSource(value.overlay, "overlay");

  let mode: UcwBlendMode = "none";
  if (value.mode !== undefined) {
    const raw = typeof value.mode === "string" ? value.mode.toLowerCase() : "";
    if (raw !== "none" && raw !== "blend" && raw !== "plank") {
      throw new RuleError(
        `mode: unknown blend mode ${JSON.stringify(value.mode)}`,
      );
    }
    mode = raw;
  }

  const group = optionalString(value, "group");
  const customBlockClass = optionalString(value, "custom_block_class");
  const customItemClass = optionalString(value, "custom_item_class");
  const customColorClass = optionalString(value, "custom_color_class");
  return {
    from,
    through,
    basedUpon,
    ...(overlay ? { overlay } : {}),
    mode,
    ...(group !== undefined ? { group } : {}),
    ...(customBlockClass !== undefined ? { customBlockClass } : {}),
    ...(customItemClass !== undefined ? { customItemClass } : {}),
    ...(customColorClass !== undefined ? { customColorClass } : {}),
    hasColor: customColorClass !== undefined || "has_color" in value,
  };
}

/**
 * Parse one rule file (`path` relative to `ucwdefs/`). Malformed rules are
 * skipped with a warning and the rest kept; a malformed file returns null.
 * `entry` names the file in warnings.
 */
export function parseUcwRuleFile(
  path: string,
  json: unknown,
  warnings: string[],
  entry = path,
): UcwRuleFile | null {
  if (!isRecord(json)) {
    warnings.push(`Skipped ${entry}: expected a JSON object`);
    return null;
  }
  let modids: string[];
  const { modid } = json;
  if (modid === undefined) modids = [];
  else if (typeof modid === "string") modids = [modid];
  else if (Array.isArray(modid) && modid.every((m) => typeof m === "string")) {
    modids = [...(modid as string[])];
  } else {
    warnings.push(
      `Skipped ${entry}: "modid" must be a string or a list of strings`,
    );
    return null;
  }
  if (json.loadLate !== undefined && typeof json.loadLate !== "boolean") {
    warnings.push(`Skipped ${entry}: "loadLate" must be a boolean`);
    return null;
  }
  const blocks = json.blocks ?? [];
  if (!Array.isArray(blocks)) {
    warnings.push(`Skipped ${entry}: "blocks" must be a list`);
    return null;
  }

  const rules: UcwBlockRule[] = [];
  blocks.forEach((value: unknown, index) => {
    try {
      rules.push(parseRule(value));
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      warnings.push(`Skipped rule ${index} of ${entry}: ${err.message}`);
    }
  });
  return { path, modids, loadLate: json.loadLate === true, rules };
}

/**
 * Build UCW's provider data from its rule entries (`ucwdefs` path → parsed
 * JSON; undefined for entries whose JSON didn't parse).
 */
export function parseUcwRules(
  entries: ReadonlyMap<string, unknown>,
  warnings: string[],
): UcwProviderData {
  const files: UcwRuleFile[] = [];
  for (const path of [...entries.keys()].sort()) {
    const json = entries.get(path);
    if (json === undefined) continue;
    const file = parseUcwRuleFile(
      path,
      json,
      warnings,
      `assets/${UCW_NAMESPACE}/ucwdefs/${path}`,
    );
    if (file !== null) files.push(file);
  }
  return { formatVersion: UCW_RULES_FORMAT_VERSION, files };
}

// ---------------------------------------------------------------------------
// Block ids (`UCWBlockRule` constructor). No imports in this file, so
// `scripts/generate-ucw-fixture-functions.mts` can load it under node.

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

/** `providerData.unlimitedchiselworks` as UCW data, or null if absent/stale. */
export function asUcwProviderData(value: unknown): UcwProviderData | null {
  return isRecord(value) &&
    value.formatVersion === UCW_RULES_FORMAT_VERSION &&
    Array.isArray(value.files)
    ? (value as unknown as UcwProviderData)
    : null;
}

/** Number of rules across every file. */
export function countUcwRules(data: UcwProviderData): number {
  return data.files.reduce((sum, file) => sum + file.rules.length, 0);
}
