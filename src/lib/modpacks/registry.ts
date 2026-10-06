// A modpack's blocks as a `BlockRegistry`: the pack's mod blocks (properties,
// defaults, `kind`) layered over the vanilla registry of the pack's Minecraft
// version, so the build language, `generate_shape` and search check pack
// blocks exactly like vanilla ones. Each mod namespace gets its own
// `createBlockRegistry` (state validation, families, name repair); unknown
// ids get suggestions from the whole pack.
//
// Camo frames are corrected first (`withCamoFrameState`): their stored
// properties and kind come from placeholder jar models.
//
// What the `BlockRegistry` interface has no room for (mod name, namespace,
// appearance, swatch, camo slots, an `unknown` kind) is in `modBlock`.
//
// Imports carry their `.ts` extension so node's strip-types can load it.

import type { BlockData, BlockInfo } from "../blockdata/load.ts";
import {
  STATE_PATTERN,
  createBlockRegistry,
  normalizeBlockName,
  similarity,
  type BlockKind,
  type BlockRegistry,
  type Family,
  type RepairResult,
  type StateValidation,
  type VariantResult,
} from "../blockdata/registry.ts";
import { withCamoFrameState } from "./camo-frames.ts";
import type {
  ModBlockAppearance,
  ModBlockKind,
  ModBlockSwatch,
  ModpackData,
} from "./schema.ts";

const VANILLA = "minecraft:";

/** A mod block of the pack with what the `BlockRegistry` doesn't carry. */
export interface ModpackBlockInfo {
  id: string;
  /** The id's namespace, without its colon (`create`). */
  namespace: string;
  /** Key and name of the mod (in `ModpackData.mods`) that ships the block. */
  mod: { key: string; name: string };
  displayName: string;
  /** `unknown` when the shape evidence was unclear (the registry says `block`). */
  kind: ModBlockKind;
  fullCube: boolean;
  appearance?: ModBlockAppearance;
  swatch?: ModBlockSwatch;
  /** Camo slots, on camo-capable blocks (FramedBlocks, copycats). */
  camo?: { slots: number };
}

export interface ModpackBlocks {
  /** The reference the pack was asked for by. */
  ref: string;
  minecraftVersion: string;
  data: ModpackData;
  /** Vanilla blocks of `minecraftVersion` plus the pack's mod blocks. */
  registry: BlockRegistry;
  /** A mod block of the pack, or undefined (vanilla ids included). */
  modBlock(id: string): ModpackBlockInfo | undefined;
  /** Every mod block of the pack, sorted by id. */
  modBlocks(): readonly ModpackBlockInfo[];
}

/** `namespace:` of an id (with its colon), `minecraft:` for a bare path. */
function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon === -1 ? VANILLA : id.slice(0, colon + 1);
}

function stripNamespace(id: string): string {
  return id.slice(id.indexOf(":") + 1);
}

export function createModpackRegistry(
  vanilla: BlockRegistry,
  stored: ModpackData,
  ref: string,
): ModpackBlocks {
  // Camo frames get their real state properties and shape (camo-frames.ts).
  const data: ModpackData = {
    ...stored,
    blocks: stored.blocks.map((block) => withCamoFrameState(block, vanilla)),
  };
  const minecraftVersion = vanilla.version;
  const source = `modpack '${ref}' (Minecraft ${minecraftVersion})`;
  const modNames = new Map(data.mods.map((m) => [m.key, m.name]));

  const infos = new Map<string, ModpackBlockInfo>();
  const byNamespace = new Map<string, Map<string, BlockInfo>>();
  for (const block of data.blocks) {
    if (infos.has(block.id) || block.id.startsWith(VANILLA)) continue;
    const ns = namespaceOf(block.id);
    infos.set(block.id, {
      id: block.id,
      namespace: ns.slice(0, -1),
      mod: { key: block.mod, name: modNames.get(block.mod) ?? block.mod },
      displayName: block.displayName,
      kind: block.kind,
      fullCube: block.fullCube,
      ...(block.appearance && { appearance: block.appearance }),
      ...(block.swatch && { swatch: block.swatch }),
      ...(block.camo && { camo: block.camo }),
    });
    // A property without a stored default takes its first value.
    const defaults: Record<string, string> = {};
    for (const [name, values] of Object.entries(block.properties)) {
      const stored = block.defaults[name];
      defaults[name] =
        stored !== undefined && values.includes(stored) ? stored : values[0];
    }
    let blocks = byNamespace.get(ns);
    if (!blocks) byNamespace.set(ns, (blocks = new Map()));
    blocks.set(block.id, { properties: block.properties, defaults });
  }

  const modKind = (id: string): BlockKind | undefined => {
    const kind = infos.get(id.trim())?.kind;
    if (kind === undefined) return undefined;
    return kind === "unknown" ? "block" : kind;
  };
  const mods = new Map<string, BlockRegistry>();
  for (const [ns, blocks] of byNamespace) {
    const blockData: BlockData = {
      sourceVersion: minecraftVersion,
      translateOnExport: false,
      blocks,
    };
    mods.set(
      ns,
      createBlockRegistry(blockData, minecraftVersion, {
        namespace: ns,
        source,
        kind: modKind,
      }),
    );
  }
  const sorted = [...infos.values()].sort((a, b) => a.id.localeCompare(b.id));

  // The registry an id belongs to: vanilla for `minecraft:` and bare paths,
  // a mod namespace's, or null for a namespace the pack doesn't have.
  const registryOf = (id: string): BlockRegistry | null => {
    const ns = namespaceOf(normalizeBlockName(id));
    return ns === VANILLA ? vanilla : (mods.get(ns) ?? null);
  };

  function suggest(name: string, n = 3): string[] {
    const normalized = normalizeBlockName(name);
    const ns = namespaceOf(normalized);
    const target = stripNamespace(normalized);
    // A name in a mod namespace the pack has is answered from that mod
    // first; otherwise the closest names win, vanilla first on a tie.
    const preferred = ns !== VANILLA && mods.has(ns) ? ns : VANILLA;
    const strict = preferred !== VANILLA;
    return [vanilla, ...mods.values()]
      .flatMap((r) => r.suggest(target, n))
      .map((id) => ({
        id,
        score: similarity(target, stripNamespace(id)),
        home: namespaceOf(id) === preferred ? 0 : 1,
      }))
      .sort(
        (a, b) =>
          (strict ? a.home - b.home : 0) ||
          b.score - a.score ||
          a.home - b.home ||
          a.id.localeCompare(b.id),
      )
      .slice(0, n)
      .map((c) => c.id);
  }

  function unknownBlock(id: string): string {
    const hints = suggest(id);
    const hint = hints.length > 0 ? ` Did you mean: ${hints.join(", ")}?` : "";
    return `Unknown block "${id}" in ${source}.${hint}`;
  }

  const exists = (id: string) => registryOf(id)?.exists(id) ?? false;

  function validateState(raw: string): StateValidation {
    const match = STATE_PATTERN.exec(raw.trim());
    if (match) {
      const [, namespace = VANILLA, path] = match;
      const id = namespace + path;
      if (!exists(id)) return { ok: false, error: unknownBlock(id) };
    }
    // Parse errors and every state check come from the block's own registry.
    return (registryOf(match?.[1] ?? VANILLA) ?? vanilla).validateState(raw);
  }

  function repair(raw: string): RepairResult {
    const s = normalizeBlockName(raw);
    const own = registryOf(s);
    const result = own?.repair(raw);
    if (result && result.id !== null) return result;
    if (namespaceOf(s) === VANILLA && !s.includes(":")) {
      // A bare name only one mod has: `brass_block` → `create:brass_block`.
      const hits = [...mods.keys()]
        .map((ns) => ns + s)
        .filter((id) => infos.has(id));
      if (hits.length === 1) {
        return { id: hits[0], note: `repaired '${raw}' -> '${hits[0]}'` };
      }
      if (hits.length > 1) return { id: null, suggestions: hits.slice(0, 3) };
    }
    return { id: null, suggestions: suggest(s) };
  }

  const registry: BlockRegistry = {
    version: minecraftVersion,
    exists,
    properties: (id) => registryOf(id)?.properties(id),
    defaults: (id) => registryOf(id)?.defaults(id),
    validateState,
    kind: (id) => (registryOf(id) ?? vanilla).kind(id),
    family: (base): Family => registryOf(base)?.family(base) ?? {},
    variant: (base, variant): VariantResult | null =>
      registryOf(base)?.variant(base, variant) ?? null,
    repair,
    suggest,
    hasNamespace: (namespace) => mods.has(`${namespace}:`),
  };

  return {
    ref,
    minecraftVersion,
    data,
    registry,
    modBlock: (id) => infos.get(id.trim()),
    modBlocks: () => sorted,
  };
}
