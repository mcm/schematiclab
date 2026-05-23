// In-memory hand-off store for the currently staged schematic.
//
// Module-level state subscribed via `useSyncExternalStore`. State persists
// across client-side navigation between `/` and `/advanced` (the module
// instance is reused) but resets on a full page reload (module is re-imported
// fresh). IndexedDB / sessionStorage persistence is out of scope for v1.

import * as React from "react";
import type { ParsedSchematicProjection, SchematicFormatId } from "./convert";
import { swapBlockState, type SwapTarget } from "./swap-projection";

export interface StagedFile {
  bytes: Uint8Array;
  filename: string;
  inputFormat: SchematicFormatId;
}

// Discriminated union for the parsed schematic. Lives in the store so a
// successful parse survives client-side navigation between `/` and `/advanced`
// (the editor doesn't re-parse on every remount).
export type ParseStatus =
  | { status: "idle" }
  | { status: "parsing" }
  | { status: "ready"; schematic: ParsedSchematicProjection }
  | { status: "error"; error: string };

export interface EditorState {
  stagedFile: StagedFile | null;
  outputFormat: SchematicFormatId | null;
  targetVersion: string | null;
  parseStatus: ParseStatus;
  // Snapshot of the projection prior to the most recent swap (US-010). Used
  // by the "Undo last swap" affordance. Reset whenever a new parse lands or
  // the staged file changes — undo doesn't survive a reload of the source.
  lastSwapSnapshot: ParsedSchematicProjection | null;
}

const IDLE_PARSE: ParseStatus = { status: "idle" };

const EMPTY_STATE: EditorState = {
  stagedFile: null,
  outputFormat: null,
  targetVersion: null,
  parseStatus: IDLE_PARSE,
  lastSwapSnapshot: null,
};

let state: EditorState = EMPTY_STATE;
const listeners = new Set<() => void>();

function emit(next: EditorState): void {
  state = next;
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): EditorState {
  return EMPTY_STATE;
}

export function getEditorState(): EditorState {
  return state;
}

export function setStagedFile(stagedFile: StagedFile | null): void {
  if (state.stagedFile === stagedFile) return;
  // Replacing the staged file invalidates any prior parse result — it belongs
  // to the previous bytes. Reset parseStatus so /advanced re-parses cleanly.
  // Also discard any pending undo snapshot — it referenced the old projection.
  emit({
    ...state,
    stagedFile,
    parseStatus: IDLE_PARSE,
    lastSwapSnapshot: null,
  });
}

export function setParseStatus(parseStatus: ParseStatus): void {
  if (state.parseStatus === parseStatus) return;
  // A fresh parse result discards any undo snapshot from a previous projection.
  emit({ ...state, parseStatus, lastSwapSnapshot: null });
}

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
  if (state.parseStatus.status !== "ready") return false;
  const prior = state.parseStatus.schematic;
  const next = swapBlockState(prior, sourceBlockState, target);
  if (next === prior) return false;
  emit({
    ...state,
    parseStatus: { status: "ready", schematic: next },
    lastSwapSnapshot: prior,
  });
  return true;
}

// Restore the projection from before the most recent swap. Drops the snapshot
// — v1 is single-level undo only, per AC. Returns true if an undo was applied.
export function undoLastSwap(): boolean {
  if (state.lastSwapSnapshot === null) return false;
  if (state.parseStatus.status !== "ready") return false;
  const snapshot = state.lastSwapSnapshot;
  emit({
    ...state,
    parseStatus: { status: "ready", schematic: snapshot },
    lastSwapSnapshot: null,
  });
  return true;
}

export function setOutputFormat(outputFormat: SchematicFormatId | null): void {
  if (state.outputFormat === outputFormat) return;
  emit({ ...state, outputFormat });
}

export function setTargetVersion(targetVersion: string | null): void {
  if (state.targetVersion === targetVersion) return;
  emit({ ...state, targetVersion });
}

export function clearEditorState(): void {
  if (state === EMPTY_STATE) return;
  emit(EMPTY_STATE);
}

export function useEditorState(): EditorState {
  return React.useSyncExternalStore(subscribe, getEditorState, getServerSnapshot);
}

// Test-only: reset module state between tests.
export function __resetEditorStateForTests(): void {
  state = EMPTY_STATE;
  listeners.clear();
}
