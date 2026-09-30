// Per-namespace status for the Version Mapping tab's Mods section (SCHEM-64),
// and the `ModMappingContext` the preview and apply pass use.
//
// Every non-`minecraft` namespace in the schematic gets a row: its project
// mapping, whether that project has a file for the target version (and
// whether it's loaded), and the user's replace / keep choice. The context is
// derived from the same rows so the panel and the pass can't disagree.
//
// Pure TS, no DOM.

import type { ResolvedModFile } from "../curseforge/resolve-file";
import type { ModLoader } from "../curseforge/types";
import type { ModLoadRequest } from "../mods/load-mod";
import type { SchematicNamespace } from "../mods/namespaces";
import {
  loadedModKey,
  type LoadedModMeta,
  type NamespaceMapping,
} from "../mods/types";
import type { ModBlockProperties, ModMappingContext } from "./mod-mapping";

export type ModProject = ModLoadRequest["mod"];

/** The user's choice for a namespace, per target version (or none). */
export type ModChoice = { kind: "keep" } | { kind: "replace"; mod: ModProject };

/** A `resolveModFileForVersion` result; absent entries are still resolving. */
export type ModFileResolutions = ReadonlyMap<string, ResolvedModFile>;

export type TargetFileStatus =
  | { status: "resolving" }
  | {
      status: "loading";
      loadKey: string;
      fileName: string;
      loader: ModLoader | null;
      loaderFallback: boolean;
    }
  | {
      status: "loaded";
      file: LoadedModMeta;
      loader: ModLoader | null;
      loaderFallback: boolean;
    }
  | { status: "unavailable" }
  | { status: "error"; message: string; retry: "resolve" | "load" };

export type ReplacementStatus =
  | { status: "loading"; loadKey: string; gameVersion: string }
  | { status: "loaded"; file: LoadedModMeta; newNamespace: string }
  | { status: "error"; loadKey: string; gameVersion: string; message: string };

export interface ModNamespaceRow extends SchematicNamespace {
  mapping: NamespaceMapping | null;
  /** The mapped project's target-version file; null without a target or mapping. */
  target: TargetFileStatus | null;
  choice: ModChoice | null;
  /** Present when `choice` is a replacement. */
  replacement: ReplacementStatus | null;
  /** The mod can't carry over and the user hasn't replaced or kept it. */
  needsDecision: boolean;
}

export interface ModNamespaceInput {
  namespaces: readonly SchematicNamespace[];
  mappings: ReadonlyMap<string, NamespaceMapping>;
  loadedMods: readonly LoadedModMeta[];
  /** Load key → message, for loads that failed. */
  failedLoads: ReadonlyMap<string, string>;
  /** Keyed by `loadedModKey(modId, targetVersionId)`. */
  resolutions: ModFileResolutions;
  /** The choices for the current target version (or none). */
  choices: Readonly<Record<string, ModChoice>>;
  targetVersionId: string | null;
  sourceVersionId: string;
}

/** Key for the per-version choice and decision maps. */
export function choiceVersionKey(targetVersionId: string | null): string {
  return targetVersionId ?? "none";
}

export function projectFromMapping(mapping: NamespaceMapping): ModProject {
  return {
    id: mapping.modId,
    name: mapping.modName,
    slug: mapping.modSlug,
    logoThumbnailUrl: mapping.logoUrl,
  };
}

function findFile(
  mods: readonly LoadedModMeta[],
  modId: number,
  gameVersion: string,
): LoadedModMeta | null {
  return (
    mods.find(
      (mod) => mod.modId === modId && mod.gameVersion === gameVersion,
    ) ?? null
  );
}

/**
 * The namespace a replacement mod's blocks are rewritten into: the one with
 * the most blocks in its file, ties broken by name.
 */
export function replacementNamespace(file: LoadedModMeta): string {
  const counts = new Map<string, number>();
  for (const block of file.blocks) {
    const namespace = block.id.slice(0, block.id.indexOf(":"));
    counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
  }
  let best = file.modSlug;
  let bestCount = 0;
  for (const [namespace, count] of counts) {
    if (count > bestCount || (count === bestCount && namespace < best)) {
      best = namespace;
      bestCount = count;
    }
  }
  return best;
}

function blocksIn(
  file: LoadedModMeta,
  namespace: string,
): Record<string, ModBlockProperties> {
  const prefix = `${namespace}:`;
  const blocks: Record<string, ModBlockProperties> = {};
  for (const block of file.blocks) {
    if (block.id.startsWith(prefix)) blocks[block.id] = block.properties;
  }
  return blocks;
}

function targetStatus(
  mapping: NamespaceMapping,
  input: ModNamespaceInput,
  targetVersionId: string,
): TargetFileStatus {
  const key = loadedModKey(mapping.modId, targetVersionId);
  const resolution = input.resolutions.get(key);
  const loader = resolution?.status === "available" ? resolution.loader : null;
  const loaderFallback =
    resolution?.status === "available" && resolution.loaderFallback;
  const file = findFile(input.loadedMods, mapping.modId, targetVersionId);
  if (file !== null) {
    return { status: "loaded", file, loader, loaderFallback };
  }
  if (resolution === undefined) return { status: "resolving" };
  if (resolution.status === "unavailable") return { status: "unavailable" };
  if (resolution.status === "error") {
    return { status: "error", message: resolution.message, retry: "resolve" };
  }
  const failed = input.failedLoads.get(key);
  if (failed !== undefined) {
    return { status: "error", message: failed, retry: "load" };
  }
  return {
    status: "loading",
    loadKey: key,
    fileName: resolution.file.displayName || resolution.file.fileName,
    loader,
    loaderFallback,
  };
}

function replacementStatus(
  mod: ModProject,
  input: ModNamespaceInput,
): ReplacementStatus {
  // With no target version the replacement is validated against its file
  // for the schematic's own version.
  const gameVersion = input.targetVersionId ?? input.sourceVersionId;
  const loadKey = loadedModKey(mod.id, gameVersion);
  const file = findFile(input.loadedMods, mod.id, gameVersion);
  if (file !== null) {
    return { status: "loaded", file, newNamespace: replacementNamespace(file) };
  }
  const failed = input.failedLoads.get(loadKey);
  if (failed !== undefined) {
    return { status: "error", loadKey, gameVersion, message: failed };
  }
  return { status: "loading", loadKey, gameVersion };
}

export function describeModNamespaces(
  input: ModNamespaceInput,
): ModNamespaceRow[] {
  const { targetVersionId } = input;
  return input.namespaces.map((summary) => {
    const mapping = input.mappings.get(summary.namespace) ?? null;
    const choice = Object.hasOwn(input.choices, summary.namespace)
      ? input.choices[summary.namespace]
      : null;
    const target =
      mapping !== null && targetVersionId !== null
        ? targetStatus(mapping, input, targetVersionId)
        : null;
    const replacement =
      choice?.kind === "replace" ? replacementStatus(choice.mod, input) : null;
    const needsDecision =
      replacement?.status === "error" ||
      (choice === null &&
        (target?.status === "unavailable" || target?.status === "error"));
    return { ...summary, mapping, target, choice, replacement, needsDecision };
  });
}

/**
 * The context the preview and apply pass run with. With no target version,
 * only replaced namespaces are listed (everything else stays untouched).
 * Mods that can't carry over are kept as-is until the user decides.
 */
export function buildModMappingContext(
  rows: readonly ModNamespaceRow[],
  targetVersionId: string | null,
): ModMappingContext {
  const context: ModMappingContext = {};
  for (const row of rows) {
    const { namespace, replacement, target } = row;
    if (replacement !== null) {
      if (replacement.status === "loaded") {
        context[namespace] = {
          kind: "replace",
          newNamespace: replacement.newNamespace,
          blocks: blocksIn(replacement.file, replacement.newNamespace),
        };
      } else if (replacement.status === "loading") {
        context[namespace] = { kind: "pending" };
      } else if (targetVersionId !== null) {
        context[namespace] = { kind: "keep" };
      }
      continue;
    }
    if (targetVersionId === null) continue;
    if (row.choice?.kind === "keep") {
      context[namespace] = { kind: "keep" };
    } else if (row.mapping === null || target === null) {
      context[namespace] = { kind: "unmapped" };
    } else if (target.status === "loaded") {
      context[namespace] = {
        kind: "target",
        blocks: blocksIn(target.file, namespace),
      };
    } else if (target.status === "resolving" || target.status === "loading") {
      context[namespace] = { kind: "pending" };
    } else {
      context[namespace] = { kind: "keep" };
    }
  }
  return context;
}

/**
 * Mod rows blocking Apply, split by what the user can do about them: mods
 * with no target file need a replacement or "Don't replace"; failed
 * replacement loads need a retry, a different mod or clearing.
 */
export function countModBlockers(rows: readonly ModNamespaceRow[]): {
  undecidedModCount: number;
  failedReplacementCount: number;
} {
  let undecidedModCount = 0;
  let failedReplacementCount = 0;
  for (const row of rows) {
    if (row.replacement?.status === "error") failedReplacementCount++;
    else if (row.needsDecision) undecidedModCount++;
  }
  return { undecidedModCount, failedReplacementCount };
}

export interface ApplyReadinessInput {
  previewStatus: "idle" | "loading" | "error" | "ready";
  /** Entries whose target mod file is still loading. */
  pendingCount: number;
  /** Problematic rows without an accept / override decision. */
  undecidedCount: number;
  /** Mods without a target file that are neither replaced nor kept. */
  undecidedModCount: number;
  /** Chosen replacement mods whose file failed to load. */
  failedReplacementCount: number;
  targetVersionId: string | null;
  /** Label for the schematic's own version, used when there's no target. */
  sourceVersionLabel: string;
  hasReplacement: boolean;
}

/**
 * Whether Apply is enabled, and the tooltip saying why (not). Every
 * problematic row needs a decision and every mod that can't carry over must
 * be replaced or kept; failed replacement loads and mod files still loading
 * block it too. With no target version, Apply only commits chosen
 * replacement mods.
 */
export function applyReadiness(input: ApplyReadinessInput): {
  canApply: boolean;
  title: string;
} {
  const {
    previewStatus,
    pendingCount,
    undecidedCount,
    undecidedModCount,
    failedReplacementCount,
    targetVersionId,
    sourceVersionLabel,
    hasReplacement,
  } = input;
  const isModOnly = targetVersionId === null;
  const versionLabel = targetVersionId ?? sourceVersionLabel;
  const canApply =
    previewStatus === "ready" &&
    pendingCount === 0 &&
    undecidedCount === 0 &&
    undecidedModCount === 0 &&
    failedReplacementCount === 0 &&
    (!isModOnly || hasReplacement);
  const title =
    previewStatus === "idle"
      ? "Pick a target version, or choose a replacement mod, first."
      : previewStatus === "loading"
        ? "Previewing…"
        : previewStatus === "error"
          ? "The preview failed."
          : pendingCount > 0
            ? `Waiting for mod files to load (${pendingCount} block state${pendingCount === 1 ? "" : "s"} can't be checked yet).`
            : failedReplacementCount > 0
              ? `${failedReplacementCount} replacement mod${failedReplacementCount === 1 ? "" : "s"} failed to load: retry, change or clear ${failedReplacementCount === 1 ? "it" : "them"}.`
              : undecidedModCount > 0
                ? `${undecidedModCount} mod${undecidedModCount === 1 ? " has" : "s have"} no file for ${versionLabel}: choose a replacement or "Don't replace".`
                : undecidedCount > 0
                  ? `${undecidedCount} flagged block${undecidedCount === 1 ? "" : "s"} still need a decision (accept the proposal or pick a replacement).`
                  : isModOnly && !hasReplacement
                    ? "Choose a replacement mod first."
                    : isModOnly
                      ? "Commit the replacement mods to the in-memory schematic."
                      : "Commit this translation to the in-memory schematic.";
  return { canApply, title };
}
