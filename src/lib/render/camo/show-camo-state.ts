// "Show camo" toggle of the 3D preview.
//
// Module-level state subscribed via `useSyncExternalStore`, same pattern as
// `../../editor-state.ts`: it survives client-side navigation and resets on
// reload. When off, the preview renders every camo-capable block in shape
// with its empty-frame texture (`CamoTable.framesOnly`).

import * as React from "react";
import { isCamoCapableBlockId } from "../../camo/extract";

let showCamo = true;
const listeners = new Set<() => void>();

export function getShowCamo(): boolean {
  return showCamo;
}

export function setShowCamo(next: boolean): void {
  if (showCamo === next) return;
  showCamo = next;
  listeners.forEach((listener) => {
    listener();
  });
}

export function subscribeShowCamo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): boolean {
  return true;
}

export function useShowCamo(): [boolean, (next: boolean) => void] {
  const value = React.useSyncExternalStore(
    subscribeShowCamo,
    getShowCamo,
    getServerSnapshot,
  );
  return [value, setShowCamo];
}

/**
 * Whether the preview offers the toggle: some block in `palette` is
 * camo-capable and its mod's namespace is loaded (otherwise it renders as
 * the missing cube, with nothing to toggle).
 */
export function isCamoToggleVisible(
  palette: readonly { blockId: string }[],
  loadedNamespaces: ReadonlySet<string>,
): boolean {
  return palette.some(
    ({ blockId }) =>
      isCamoCapableBlockId(blockId) &&
      loadedNamespaces.has(blockId.slice(0, blockId.indexOf(":"))),
  );
}

// Test-only: reset module state between tests.
export function __resetShowCamoForTests(): void {
  showCamo = true;
  listeners.clear();
}
