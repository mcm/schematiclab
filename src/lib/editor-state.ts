// In-memory hand-off store for the currently staged schematic.
//
// Module-level state subscribed via `useSyncExternalStore`. State persists
// across client-side navigation between `/` and `/advanced` (the module
// instance is reused) but resets on a full page reload (module is re-imported
// fresh). IndexedDB / sessionStorage persistence is out of scope for v1.

import * as React from "react";
import type { SchematicFormatId } from "./convert";

export interface StagedFile {
  bytes: Uint8Array;
  filename: string;
  inputFormat: SchematicFormatId;
}

export interface EditorState {
  stagedFile: StagedFile | null;
  outputFormat: SchematicFormatId | null;
  targetVersion: string | null;
}

const EMPTY_STATE: EditorState = {
  stagedFile: null,
  outputFormat: null,
  targetVersion: null,
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
  emit({ ...state, stagedFile });
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
