// Materials (Cairn `SPEC.md` section 4): block ids, ids with states,
// `@role`, `@role:variant`, `family:variant` and weighted `{"mix": {...}}`,
// resolved against one Minecraft version's block registry. Every block a
// material resolves to exists in that version and its states are checked;
// fallbacks and repaired names become notes, anything else an error with
// suggestions. Worker-safe.
//
// Directional states (`facing`, `axis`, `rotation`) are written in the
// scope's local terms, so here they are only checked to be a local or world
// direction; `validatePlacedState` checks the world value once
// `orientStates` has turned them.

import {
  FAMILY_VARIANTS,
  normalizeBlockName,
  type BlockRegistry,
} from "../blockdata/registry";
import { BuildError } from "./errors";
import { pathKey, type MaterialSpec, type ProgramError } from "./program";
import { LOCAL_DIRECTIONS } from "./scope";

export const AIR = "minecraft:air";

export interface MaterialEntry {
  weight: number;
  /** Namespaced block id (`minecraft:` or a modpack's mod); `AIR` erases. */
  id: string;
  /** Block states as written (directions still local). */
  states: Record<string, string>;
}

export interface Material {
  entries: MaterialEntry[];
}

/** Deepest chain of palette roles referring to roles. */
const MAX_ROLE_DEPTH = 8;

const NAMESPACE = "minecraft:";
const WORLD_FACINGS = new Set(["north", "south", "east", "west", "up", "down"]);

/** A normalized block name as a full id: `minecraft:` unless namespaced. */
function qualify(name: string): string {
  return name.includes(":") ? name : NAMESPACE + name;
}

/** Material names, with their states, as the language writes them. */
function shortId(id: string): string {
  return id.startsWith(NAMESPACE) ? id.slice(NAMESPACE.length) : id;
}

interface ParsedMaterial {
  role: boolean;
  base: string;
  variant?: string;
  states: Record<string, string>;
}

// `@role`, `@role:variant`, `base`, `base:variant`, each with optional
// `[k=v,...]`. A leading `minecraft:` on a block id is a namespace, not a
// family. With a modpack registry (`hasNamespace`), `ns:path` is a mod block
// id unless `path` is a variant name and `ns:path` isn't a block, and
// `ns:path:variant` is a mod block's variant.
function parseMaterial(
  spec: string,
  path: string,
  registry: BlockRegistry,
): ParsedMaterial {
  let text = spec.trim();
  const fail = () =>
    new BuildError(path, `cannot parse material ${JSON.stringify(spec)}`);
  let states: Record<string, string> = {};
  const open = text.indexOf("[");
  if (open >= 0) {
    if (!text.endsWith("]")) throw fail();
    states = parseStates(text.slice(open + 1, -1), path);
    text = text.slice(0, open).trim();
  }
  const role = text.startsWith("@");
  if (role) text = text.slice(1).trim();
  else if (text.toLowerCase().startsWith(NAMESPACE)) {
    text = text.slice(NAMESPACE.length);
  }
  const parts = text.split(":").map((part) => part.trim());
  if (!role && registry.hasNamespace && isModBlockId(parts, registry)) {
    const [namespace, blockPath, variant] = parts;
    if (
      !/^[A-Za-z0-9_.-]+$/.test(namespace) ||
      !/^[A-Za-z0-9_./-]+$/.test(blockPath) ||
      variant === "" ||
      (variant !== undefined && !/^[A-Za-z_\- ]+$/.test(variant))
    ) {
      throw fail();
    }
    return { role, base: `${namespace}:${blockPath}`, variant, states };
  }
  if (parts.length > 2) throw fail();
  const base = parts[0];
  const variant = parts[1];
  if (!base || variant === "") throw fail();
  if (!role && !/^[A-Za-z0-9_\- ]+$/.test(base)) throw fail();
  if (variant !== undefined && !/^[A-Za-z_\- ]+$/.test(variant)) throw fail();
  return { role, base, variant, states };
}

// Whether `ns:path` or `ns:path:variant` (split on colons) names a mod block
// rather than `family:variant`.
function isModBlockId(parts: string[], registry: BlockRegistry): boolean {
  if (parts.length === 3) return true;
  if (parts.length !== 2) return false;
  const [namespace, second] = parts;
  if (!VARIANT_NAMES.has(normalizeBlockName(second))) return true;
  return (
    registry.hasNamespace?.(namespace.toLowerCase()) === true &&
    registry.exists(normalizeBlockName(`${namespace}:${second}`))
  );
}

function parseStates(list: string, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of list.split(",")) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    const name = part.slice(0, eq).trim().toLowerCase();
    const value = part
      .slice(eq + 1)
      .trim()
      .toLowerCase();
    if (eq < 0 || !name || !value) {
      throw new BuildError(
        path,
        `bad block state ${JSON.stringify(part.trim())} (expected key=value)`,
      );
    }
    // An own property even for `__proto__`, so it is checked like any name.
    Object.defineProperty(out, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

const VARIANT_NAMES: ReadonlySet<string> = new Set([
  ...FAMILY_VARIANTS,
  "planks",
]);

/**
 * Resolves material specs for one program. Results are cached per spec and
 * variant; notes (fallbacks, repairs) are collected once each with the path
 * that first needed them.
 */
export class MaterialResolver {
  readonly notes: ProgramError[] = [];
  private readonly cache = new Map<string, Material>();
  private readonly noted = new Set<string>();

  constructor(
    readonly registry: BlockRegistry,
    private readonly palette: Readonly<Record<string, MaterialSpec>> = {},
  ) {}

  /**
   * The material `spec` names at `path`. `variant` is the variant the
   * operation wants when the spec doesn't name one (a `@roof` used for stairs).
   * Throws `BuildError`.
   */
  resolve(spec: unknown, path: string, variant?: string): Material {
    return this.resolveIn(spec, path, variant, []);
  }

  private resolveIn(
    spec: unknown,
    path: string,
    variant: string | undefined,
    roles: readonly string[],
  ): Material {
    const cacheKey = JSON.stringify([spec, variant ?? null]);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const material = this.resolveUncached(spec, path, variant, roles);
    this.cache.set(cacheKey, material);
    return material;
  }

  private resolveUncached(
    spec: unknown,
    path: string,
    variant: string | undefined,
    roles: readonly string[],
  ): Material {
    if (typeof spec === "object" && spec !== null && "mix" in spec) {
      return this.mix((spec as { mix: unknown }).mix, path, variant, roles);
    }
    if (typeof spec !== "string") {
      throw new BuildError(
        path,
        `material must be a string or {"mix": {...}}, got ${JSON.stringify(spec) ?? String(spec)}`,
      );
    }
    const parsed = parseMaterial(spec, path, this.registry);
    const want = parsed.variant ?? variant;
    let entries: MaterialEntry[];
    if (parsed.role) {
      entries = this.role(parsed.base, path, want, roles).entries.map((e) => ({
        ...e,
        states: { ...e.states, ...parsed.states },
      }));
    } else {
      const id = this.block(parsed.base, path, want);
      entries = [{ weight: 1, id, states: parsed.states }];
    }
    for (const entry of entries) this.checkStates(entry, path);
    return { entries };
  }

  private mix(
    mix: unknown,
    path: string,
    variant: string | undefined,
    roles: readonly string[],
  ): Material {
    if (typeof mix !== "object" || mix === null || Array.isArray(mix)) {
      throw new BuildError(path, "mix must be an object of material → weight");
    }
    const entries: MaterialEntry[] = [];
    for (const [name, weight] of Object.entries(mix)) {
      if (name.startsWith("#")) continue;
      const mixPath = pathKey(`${path}.mix`, name);
      if (typeof weight !== "number" || !(weight > 0) || weight === Infinity) {
        throw new BuildError(mixPath, "weight must be a positive number");
      }
      for (const e of this.resolveIn(name, mixPath, variant, roles).entries) {
        const product = weight * e.weight;
        if (!Number.isFinite(product)) {
          throw new BuildError(mixPath, "weight is too large");
        }
        entries.push({ ...e, weight: product });
      }
    }
    if (entries.length === 0) throw new BuildError(path, "empty mix");
    return { entries };
  }

  private role(
    role: string,
    path: string,
    variant: string | undefined,
    roles: readonly string[],
  ): Material {
    if (!Object.hasOwn(this.palette, role) || role.startsWith("#")) {
      const defined = Object.keys(this.palette)
        .filter((r) => !r.startsWith("#"))
        .sort();
      throw new BuildError(
        path,
        `palette has no role '@${role}'. Defined roles: ${defined.length > 0 ? defined.join(", ") : "(none)"}`,
      );
    }
    if (roles.includes(role) || roles.length >= MAX_ROLE_DEPTH) {
      throw new BuildError(
        path,
        `palette references are circular: ${[...roles, role].map((r) => `@${r}`).join(" -> ")}`,
      );
    }
    return this.resolveIn(
      this.palette[role],
      pathKey("palette", role),
      variant,
      [...roles, role],
    );
  }

  // A literal block or a family base, with an optional variant.
  private block(base: string, path: string, variant: string | undefined) {
    const reg = this.registry;
    const name = normalizeBlockName(base);
    if (name === "air") return AIR;
    const v = variant === undefined ? undefined : normalizeBlockName(variant);
    if (v !== undefined && !VARIANT_NAMES.has(v)) {
      throw new BuildError(
        path,
        `unknown variant '${variant}'. Variants: ${FAMILY_VARIANTS.join(", ")}`,
      );
    }
    if (v !== undefined && v !== "block" && v !== "planks") {
      // Already the variant asked for ("@roof:stairs" with roof "oak_stairs").
      if (reg.exists(name) && reg.kind(name) === v) return qualify(name);
      let result = reg.variant(name, v);
      if (!result) {
        const fixed = reg.repair(name);
        if (fixed.id !== null) {
          result = reg.variant(fixed.id, v);
          if (result && fixed.note) this.note(path, fixed.note);
        }
      }
      if (!result) throw this.unknown(path, base);
      if (result.note) this.note(path, result.note);
      return result.id;
    }
    if (v === undefined && reg.exists(name)) return qualify(name);
    // A family base ("dark_oak") is its full block; a wood the version lacks
    // falls back to an older one.
    const full = reg.variant(name, "block");
    if (full) {
      if (full.note) this.note(path, full.note);
      return full.id;
    }
    if (reg.exists(name)) return qualify(name);
    const fixed = reg.repair(base);
    if (fixed.id === null) throw this.unknown(path, base, fixed.suggestions);
    if (fixed.note) this.note(path, fixed.note);
    return fixed.id;
  }

  private checkStates(entry: MaterialEntry, path: string): void {
    if (entry.id === AIR) {
      if (Object.keys(entry.states).length > 0) {
        throw new BuildError(path, "air takes no block states");
      }
      return;
    }
    const domains = this.registry.properties(entry.id) ?? {};
    const names = Object.keys(domains);
    for (const [name, value] of Object.entries(entry.states)) {
      if (!Object.hasOwn(domains, name)) {
        throw new BuildError(
          path,
          names.length === 0
            ? `${shortId(entry.id)} has no block states, so '${name}' is not allowed`
            : `${shortId(entry.id)} has no state '${name}'; its states are ${names.join(", ")}`,
        );
      }
      if (domains[name].includes(value) || isLocalDirection(name, value)) {
        continue;
      }
      throw new BuildError(
        path,
        `${shortId(entry.id)} state '${name}' cannot be '${value}'; allowed: ${allowedValues(name, domains[name]).join(", ")}`,
      );
    }
  }

  private unknown(path: string, base: string, suggestions?: string[]) {
    const hints = (
      suggestions ?? this.registry.suggest(normalizeBlockName(base))
    ).map(shortId);
    const hint = hints.length > 0 ? ` Did you mean: ${hints.join(", ")}?` : "";
    return new BuildError(
      path,
      `unknown block/material '${base}' in Minecraft ${this.registry.version}.${hint}`,
    );
  }

  private note(path: string, message: string): void {
    const k = `${path}\n${message}`;
    if (this.noted.has(k)) return;
    this.noted.add(k);
    this.notes.push({ path, message });
  }
}

// A direction written in local terms, turned into a world value at
// placement time.
function isLocalDirection(name: string, value: string): boolean {
  if (name === "facing") {
    return Object.hasOwn(LOCAL_DIRECTIONS, value) || WORLD_FACINGS.has(value);
  }
  if (name === "axis") return value === "x" || value === "y" || value === "z";
  if (name === "rotation") return /^(?:[0-9]|1[0-5])$/.test(value);
  return false;
}

function allowedValues(name: string, domain: string[]): string[] {
  if (name === "facing") return [...Object.keys(LOCAL_DIRECTIONS), ...domain];
  return domain;
}

/**
 * Checks a block's world states (after `orientStates`) against the
 * registry: an error message, or null when the state is valid.
 */
export function validatePlacedState(
  registry: BlockRegistry,
  id: string,
  states: Readonly<Record<string, string>>,
): string | null {
  const list = Object.entries(states)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  const result = registry.validateState(list ? `${id}[${list}]` : id);
  return result.ok ? null : result.error;
}

/**
 * Deterministic hash of `parts` in [0, 1). The port's own hash (Cairn used
 * blake2b over Python's `repr`, so picks differ from Cairn's): cyrb53 over
 * `JSON.stringify(parts)`, divided by 2^53. The same parts always give the
 * same value, on every platform.
 */
export function hash01(...parts: readonly (string | number)[]): number {
  const text = JSON.stringify(parts);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash / 2 ** 53;
}

/**
 * The entry of `material` placed at world position `pos`: weighted by the
 * entries' weights, picked by `hash01(seed, x, y, z)`.
 */
export function pickEntry(
  material: Material,
  seed: number,
  pos: readonly [number, number, number],
): MaterialEntry {
  const { entries } = material;
  if (entries.length === 1) return entries[0];
  let weights = entries.map((e) => e.weight);
  let total = weights.reduce((sum, w) => sum + w, 0);
  if (!Number.isFinite(total)) {
    // Huge weights overflow the sum; scale them down by the largest.
    const max = Math.max(...weights);
    weights = weights.map((w) => w / max);
    total = weights.reduce((sum, w) => sum + w, 0);
  }
  let r = hash01(seed, pos[0], pos[1], pos[2]) * total;
  for (const [i, entry] of entries.entries()) {
    r -= weights[i];
    if (r < 0) return entry;
  }
  return entries[entries.length - 1];
}

export function isAirMaterial(material: Material): boolean {
  return material.entries.every((e) => e.id === AIR);
}
