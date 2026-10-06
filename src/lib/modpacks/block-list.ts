// A server's block dump (`pnpm modpack:upload --block-list <file>`): every
// block id the server registers, one per line. When given, it says which
// blocks the pack data has: pack blocks it doesn't list are dropped, and the
// modded ids it lists that no jar describes are added without a look (config-
// gated blocks, blocks KubeJS registers at runtime, fluids…).
//
// Worker-safe and free of Node APIs (`crypto.subtle` hashes the file).
// Imports carry their `.ts` extension so node's strip-types can load it.

import { displayNameFor } from "../mods/parse-mod-jar.ts";
import {
  BLOCK_ID_PATTERN,
  type ModpackBlock,
  type ModpackMod,
} from "./schema.ts";

/** A parsed block list. */
export interface BlockList {
  /** Every listed id once, in file order. */
  ids: string[];
  /** SHA-256 of the file, hex. */
  sha256: string;
}

/** How many example ids a warning names. */
const MAX_EXAMPLES = 10;

/**
 * The ids of a block list's text: one per line, trimmed; blank lines and
 * lines starting with `#` are skipped. Throws on a line that isn't a block
 * id, naming its line number. Repeated ids are kept once.
 */
export function parseBlockListText(text: string): string[] {
  const ids = new Set<string>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n|\r/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!BLOCK_ID_PATTERN.test(line)) {
      const shown = line.length > 80 ? `${line.slice(0, 80)}…` : line;
      throw new Error(
        `Block list line ${index + 1} isn't a block id (namespace:path): "${shown}".`,
      );
    }
    ids.add(line);
  }
  return [...ids];
}

/** Parses a block list file and hashes it. */
export async function readBlockList(bytes: Uint8Array): Promise<BlockList> {
  const ids = parseBlockListText(new TextDecoder().decode(bytes));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { ids, sha256 };
}

/** `minecraft:stone` → `minecraft`. */
export function blockNamespace(id: string): string {
  return id.slice(0, id.indexOf(":"));
}

/** Namespace → count, largest first (then by name). */
export function countByNamespace(
  ids: Iterable<string>,
): { namespace: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const ns = blockNamespace(id);
    counts.set(ns, (counts.get(ns) ?? 0) + 1);
  }
  return [...counts]
    .map(([namespace, count]) => ({ namespace, count }))
    .sort((a, b) =>
      a.count !== b.count
        ? b.count - a.count
        : a.namespace < b.namespace
          ? -1
          : a.namespace > b.namespace
            ? 1
            : 0,
    );
}

/**
 * A warning when the list's `minecraft:` ids aren't exactly the vanilla
 * registry of the pack's Minecraft version, else null. Names the counts
 * both ways and up to ten example ids.
 */
export function vanillaMismatchWarning(
  list: BlockList,
  vanillaIds: Iterable<string>,
  minecraftVersion: string,
): string | null {
  const vanilla = new Set(vanillaIds);
  const listed = new Set(
    list.ids.filter((id) => blockNamespace(id) === "minecraft"),
  );
  const notVanilla = [...listed].filter((id) => !vanilla.has(id)).sort();
  const notListed = [...vanilla].filter((id) => !listed.has(id)).sort();
  if (notVanilla.length === 0 && notListed.length === 0) return null;
  // Share the examples between both ways.
  const fromNotVanilla = Math.min(
    notVanilla.length,
    Math.max(MAX_EXAMPLES / 2, MAX_EXAMPLES - notListed.length),
  );
  const examples = [
    ...notVanilla.slice(0, fromNotVanilla),
    ...notListed.slice(0, MAX_EXAMPLES - fromNotVanilla),
  ];
  return (
    `The block list's minecraft: ids don't match Minecraft ${minecraftVersion}'s vanilla blocks: ` +
    `${notVanilla.length} listed ${notVanilla.length === 1 ? "id isn't a vanilla block" : "ids aren't vanilla blocks"}, ` +
    `${notListed.length} vanilla ${notListed.length === 1 ? "block isn't" : "blocks aren't"} listed ` +
    `(e.g. ${examples.join(", ")}). The list may come from another Minecraft version; vanilla blocks are left as they are.`
  );
}

/** Key of the mod record bare blocks of no pack mod's namespace belong to. */
export const BLOCK_LIST_MOD_KEY = "block-list";

export interface AppliedBlockList {
  /** The listed pack blocks and the bare ones added, sorted by id. */
  blocks: ModpackBlock[];
  /** The `block-list` mod, when a bare block's namespace is no mod's. */
  blockListMod: ModpackMod | null;
  /** Pack blocks the list doesn't name, per namespace, largest first. */
  dropped: { namespace: string; count: number }[];
  /** How many listed non-`minecraft:` ids were added as bare blocks. */
  added: number;
}

/**
 * Makes the pack's blocks the list's: drops the blocks it doesn't name and
 * adds each listed non-`minecraft:` id the pack has no block for, bare (no
 * properties, look or swatch). A bare block is named by a `block.<ns>.<path>`
 * entry of `langBlockNames`, else after its id, and belongs to the mod with
 * its namespace (the first `ok` one, then any), else to the `block-list` mod.
 */
export function applyBlockList(
  blocks: readonly ModpackBlock[],
  mods: readonly ModpackMod[],
  list: BlockList,
  langBlockNames: Readonly<Record<string, string>>,
): AppliedBlockList {
  const listed = new Set(list.ids);
  const kept = new Map<string, ModpackBlock>();
  const dropped: string[] = [];
  for (const block of blocks) {
    if (listed.has(block.id)) kept.set(block.id, block);
    else dropped.push(block.id);
  }

  const modOf = new Map<string, string>();
  for (const ok of [true, false]) {
    for (const mod of mods) {
      if ((mod.status === "ok") !== ok) continue;
      for (const ns of mod.namespaces) {
        if (!modOf.has(ns)) modOf.set(ns, mod.key);
      }
    }
  }
  const orphanNamespaces = new Set<string>();
  let added = 0;
  for (const id of list.ids) {
    const ns = blockNamespace(id);
    if (ns === "minecraft" || kept.has(id)) continue;
    let mod = modOf.get(ns);
    if (mod === undefined) {
      mod = BLOCK_LIST_MOD_KEY;
      orphanNamespaces.add(ns);
    }
    kept.set(id, {
      id,
      mod,
      displayName: displayNameFor(id, langBlockNames),
      properties: {},
      defaults: {},
      kind: "unknown",
      fullCube: false,
    });
    added += 1;
  }

  return {
    blocks: [...kept.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    blockListMod:
      orphanNamespaces.size === 0
        ? null
        : {
            key: BLOCK_LIST_MOD_KEY,
            name: "Server block list",
            curseForgeProjectId: null,
            curseForgeFileId: null,
            fileName: null,
            namespaces: [...orphanNamespaces].sort(),
            status: "ok",
            hasSwatches: false,
          },
    dropped: countByNamespace(dropped),
    added,
  };
}
