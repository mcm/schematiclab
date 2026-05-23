// In-memory hand-off store for the currently staged schematic.
//
// Module-level state subscribed via `useSyncExternalStore`. State persists
// across client-side navigation between `/` and `/advanced` (the module
// instance is reused) but resets on a full page reload (module is re-imported
// fresh). IndexedDB / sessionStorage persistence is out of scope for v1.

import * as React from "react";
import type { ParsedSchematicProjection, SchematicFormatId } from "./convert";

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
}

const IDLE_PARSE: ParseStatus = { status: "idle" };

const EMPTY_STATE: EditorState = {
  stagedFile: null,
  outputFormat: null,
  targetVersion: null,
  parseStatus: IDLE_PARSE,
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
  emit({ ...state, stagedFile, parseStatus: IDLE_PARSE });
}

export function setParseStatus(parseStatus: ParseStatus): void {
  if (state.parseStatus === parseStatus) return;
  emit({ ...state, parseStatus });
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
