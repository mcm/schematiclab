// "Suggest a block" for the Version Mapping tab: the closest-looking blocks
// that exist in the target version, for a source block with no equivalent.
//
// Candidates are ranked by OKLab distance to the source's average colour,
// within the source's full-cube class (all candidates when none share it).
// A source without an appearance (its mod isn't loaded) is ranked by name
// instead: shared path tokens, then edit distance between the paths.
//
// Pure TS, no DOM, Worker-safe.

import { isInvisibleBlockId } from "../invisible-blocks";
import type { LoadedModMeta } from "../mods/types";
import type { BlockAppearance } from "../render/block-appearance";

export interface SuggestionCandidate {
  id: string;
  displayName: string;
  /** "Vanilla", or the name of the mod that provides the block. */
  sourceLabel: string;
  appearance?: BlockAppearance;
}

export interface SuggestionSource {
  id: string;
  appearance?: BlockAppearance;
}

export interface SuggestBlocksInput {
  source: SuggestionSource;
  candidates: readonly SuggestionCandidate[];
  limit?: number;
}

export const VANILLA_SOURCE_LABEL = "Vanilla";

function pathOf(blockId: string): string {
  const colon = blockId.indexOf(":");
  return colon < 0 ? blockId : blockId.slice(colon + 1);
}

function oklabDistance(
  a: BlockAppearance["oklab"],
  b: BlockAppearance["oklab"],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Lower-cased path tokens split on `_`, `/`, `.` and `-`. */
export function nameTokens(blockId: string): Set<string> {
  return new Set(
    pathOf(blockId)
      .toLowerCase()
      .split(/[_/.-]+/)
      .filter((token) => token.length > 0),
  );
}

/** Shared tokens over all tokens (Jaccard), 0–1. */
export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

function byId(a: SuggestionCandidate, b: SuggestionCandidate): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rankByColour(
  appearance: BlockAppearance,
  candidates: readonly SuggestionCandidate[],
): SuggestionCandidate[] {
  const coloured = candidates.filter((c) => c.appearance !== undefined);
  const sameShape = coloured.filter(
    (c) => c.appearance?.fullCube === appearance.fullCube,
  );
  const pool = sameShape.length > 0 ? sameShape : coloured;
  return pool
    .map((candidate) => ({
      candidate,
      distance: oklabDistance(appearance.oklab, candidate.appearance!.oklab),
    }))
    .sort((a, b) => a.distance - b.distance || byId(a.candidate, b.candidate))
    .map(({ candidate }) => candidate);
}

function rankByName(
  sourceId: string,
  candidates: readonly SuggestionCandidate[],
): SuggestionCandidate[] {
  const sourceTokens = nameTokens(sourceId);
  const sourcePath = pathOf(sourceId).toLowerCase();
  return candidates
    .map((candidate) => ({
      candidate,
      overlap: tokenOverlap(sourceTokens, nameTokens(candidate.id)),
      distance: editDistance(sourcePath, pathOf(candidate.id).toLowerCase()),
    }))
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        a.distance - b.distance ||
        byId(a.candidate, b.candidate),
    )
    .map(({ candidate }) => candidate);
}

/**
 * Up to `limit` candidates closest to `source`: by OKLab distance within the
 * source's full-cube class when it has an appearance (candidates without one
 * are skipped), otherwise by name similarity. The source itself is never
 * suggested. Ties break by id.
 */
export function suggestBlocks({
  source,
  candidates,
  limit = 5,
}: SuggestBlocksInput): SuggestionCandidate[] {
  const others = candidates.filter((c) => c.id !== source.id);
  const colourRanked =
    source.appearance === undefined
      ? []
      : rankByColour(source.appearance, others);
  const ranked =
    colourRanked.length > 0 ? colourRanked : rankByName(source.id, others);
  return ranked.slice(0, Math.max(0, limit));
}

/** "oak_planks" → "Oak Planks", for vanilla blocks without a lang file. */
export function titleCasePath(blockId: string): string {
  return pathOf(blockId)
    .split(/[_/]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export interface SuggestionCandidatesInput {
  /** Vanilla block ids that exist in the version (`vanillaBlocksForVersion`). */
  vanillaBlocks: ReadonlySet<string>;
  /** `block-colors.json` contents; null while it hasn't loaded. */
  vanillaColors: Readonly<Record<string, BlockAppearance>> | null;
  loadedMods: readonly LoadedModMeta[];
  /** CurseForge mods that are mapped or chosen as replacements. */
  modIds: ReadonlySet<number>;
  /** `KNOWN_VERSIONS` key: the target version, else the source version. */
  versionId: string;
}

/**
 * Blocks a suggestion may pick: the vanilla blocks of the version plus the
 * blocks of `modIds`' files for `versionId`. Invisible blocks are left out.
 * Sorted by id; a vanilla id wins over a mod block with the same id.
 */
export function suggestionCandidates({
  vanillaBlocks,
  vanillaColors,
  loadedMods,
  modIds,
  versionId,
}: SuggestionCandidatesInput): SuggestionCandidate[] {
  const byBlockId = new Map<string, SuggestionCandidate>();
  for (const id of vanillaBlocks) {
    if (isInvisibleBlockId(id)) continue;
    const appearance = vanillaColors?.[id];
    byBlockId.set(id, {
      id,
      displayName: titleCasePath(id),
      sourceLabel: VANILLA_SOURCE_LABEL,
      ...(appearance ? { appearance } : {}),
    });
  }
  for (const file of loadedMods) {
    if (file.gameVersion !== versionId || !modIds.has(file.modId)) continue;
    for (const block of file.blocks) {
      if (byBlockId.has(block.id)) continue;
      byBlockId.set(block.id, {
        id: block.id,
        displayName: block.displayName,
        sourceLabel: file.modName,
        ...(block.appearance ? { appearance: block.appearance } : {}),
      });
    }
  }
  return [...byBlockId.values()].sort(byId);
}

/**
 * The appearance of a source block: vanilla colours for `minecraft:` blocks,
 * otherwise the block in a loaded mod file, preferring the file for
 * `sourceVersionId`. Undefined when nothing loaded knows the block.
 */
export function sourceAppearance(
  blockId: string,
  vanillaColors: Readonly<Record<string, BlockAppearance>> | null,
  loadedMods: readonly LoadedModMeta[],
  sourceVersionId: string,
): BlockAppearance | undefined {
  if (blockId.startsWith("minecraft:")) return vanillaColors?.[blockId];
  const files = [...loadedMods].sort(
    (a, b) =>
      Number(b.gameVersion === sourceVersionId) -
      Number(a.gameVersion === sourceVersionId),
  );
  for (const file of files) {
    const block = file.blocks.find((b) => b.id === blockId);
    if (block?.appearance) return block.appearance;
  }
  return undefined;
}
