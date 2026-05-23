// Heavy edit operations on the editor-state store.
//
// Split out from `./editor-state.ts` so importing the store itself doesn't
// drag `swap-projection.ts` or `advanced/edit.ts` (and their transitive
// schemlib block-translation tables / deepslate-tied helpers) into Simple
// Mode's `/page.tsx` bundle. Only `/advanced/page.tsx` and the version-
// mapping / swap UI need these.

import { _emitEditorState, getEditorState } from "./editor-state";
import { swapBlockState, type SwapTarget } from "./swap-projection";
import {
  applyVersionMapping as applyVersionMappingTransform,
  type VersionMappingOverrides,
} from "./advanced/edit";
import type { MinecraftVersion } from "./schemlib/schematic-formats/version-mapping";

// Apply a global block swap. Every placement whose state matches
// `sourceBlockState` is redirected to `target`. The pre-swap projection is
// stashed as `lastSwapSnapshot` so the UI can offer a single-step undo.
//
// No-op if there is no ready parse, or if the source isn't in the palette.
// Returns true if a swap was applied (so callers can drive toasts / undo
// affordance state off the same signal).
export function applyBlockSwap(
  sourceBlockState: string,
  target: SwapTarget,
): boolean {
  const state = getEditorState();
  if (state.parseStatus.status !== "ready") return false;
  const prior = state.parseStatus.schematic;
  const next = swapBlockState(prior, sourceBlockState, target);
  if (next === prior) return false;
  _emitEditorState({
    ...state,
    parseStatus: { status: "ready", schematic: next },
    lastSwapSnapshot: prior,
  });
  return true;
}

// Restore the projection from before the most recent swap. Drops the snapshot
// — v1 is single-level undo only, per AC. Returns true if an undo was applied.
export function undoLastSwap(): boolean {
  const state = getEditorState();
  if (state.lastSwapSnapshot === null) return false;
  if (state.parseStatus.status !== "ready") return false;
  const snapshot = state.lastSwapSnapshot;
  _emitEditorState({
    ...state,
    parseStatus: { status: "ready", schematic: snapshot },
    lastSwapSnapshot: null,
  });
  return true;
}

// Commit a version-mapping translation (with optional overrides) to the
// in-memory schematic. The pre-translation projection is stashed as
// `lastTranslationSnapshot` for the single-step undo affordance.
//
// No-op when there is no ready parse. Returns true if a translation was
// applied so callers can drive UI affordances off the same signal.
export function applyVersionMapping(
  targetVersion: MinecraftVersion,
  overrides: VersionMappingOverrides = {},
): boolean {
  const state = getEditorState();
  if (state.parseStatus.status !== "ready") return false;
  const prior = state.parseStatus.schematic;
  const next = applyVersionMappingTransform(prior, targetVersion, overrides);
  _emitEditorState({
    ...state,
    parseStatus: { status: "ready", schematic: next },
    lastTranslationSnapshot: prior,
    // A subsequent translation supersedes any prior swap-undo — its snapshot
    // refers to a palette that no longer matches the active schematic.
    lastSwapSnapshot: null,
  });
  return true;
}

// Restore the projection from before the most recent translation. Drops the
// snapshot — v1 is single-level undo only, per AC. Returns true on success.
export function undoLastTranslation(): boolean {
  const state = getEditorState();
  if (state.lastTranslationSnapshot === null) return false;
  if (state.parseStatus.status !== "ready") return false;
  const snapshot = state.lastTranslationSnapshot;
  _emitEditorState({
    ...state,
    parseStatus: { status: "ready", schematic: snapshot },
    lastTranslationSnapshot: null,
    // Any swap layered onto the translated schematic is implicitly undone
    // as part of restoring the pre-translation state — drop its snapshot too.
    lastSwapSnapshot: null,
  });
  return true;
}
