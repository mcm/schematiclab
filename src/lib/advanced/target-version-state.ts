// Shared Advanced Editor target Minecraft version (SCHEM-7).
//
// Module-level state subscribed via `useSyncExternalStore`, same pattern as
// `../editor-state.ts`. The Version Mapping panel writes it; the Mods tab reads
// it to filter CurseForge results. Kept dependency-free so `editor-state.ts`
// can reset it when the staged file changes without growing `/`'s bundle.

import * as React from "react";

let targetVersionId: string | null = null;
const listeners = new Set<() => void>();

export function getAdvancedTargetVersion(): string | null {
  return targetVersionId;
}

export function setAdvancedTargetVersion(next: string | null): void {
  if (targetVersionId === next) return;
  targetVersionId = next;
  listeners.forEach((listener) => {
    listener();
  });
}

export function subscribeAdvancedTargetVersion(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): string | null {
  return null;
}

export function useAdvancedTargetVersion(): [
  string | null,
  (next: string | null) => void,
] {
  const value = React.useSyncExternalStore(
    subscribeAdvancedTargetVersion,
    getAdvancedTargetVersion,
    getServerSnapshot,
  );
  return [value, setAdvancedTargetVersion];
}

// Test-only: reset module state between tests.
export function __resetAdvancedTargetVersionForTests(): void {
  targetVersionId = null;
  listeners.clear();
}
