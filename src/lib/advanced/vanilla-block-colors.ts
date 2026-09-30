// Vanilla block appearances (`public/minecraft-assets/block-colors.json`,
// written by `pnpm gen:mc-assets`) for "Suggest a block". Fetched once, on
// first subscription; a failed fetch leaves the colours null and is retried
// on the next subscription.

import * as React from "react";
import type { BlockAppearance } from "../render/block-appearance";

export type VanillaBlockColors = Readonly<Record<string, BlockAppearance>>;

const COLORS_URL = "/minecraft-assets/block-colors.json";

let colors: VanillaBlockColors | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(fetchImpl: typeof fetch): Promise<void> {
  if (colors !== null) return Promise.resolve();
  if (loading === null) {
    loading = (async () => {
      try {
        const res = await fetchImpl(COLORS_URL);
        if (!res.ok) throw new Error(`block-colors.json: HTTP ${res.status}`);
        colors = (await res.json()) as VanillaBlockColors;
        for (const listener of listeners) listener();
      } catch (err) {
        console.warn("Could not load vanilla block colours.", err);
      } finally {
        loading = null;
      }
    })();
  }
  return loading;
}

/** Loads the colours (once) and resolves with them, or null on failure. */
export async function loadVanillaBlockColors(
  fetchImpl: typeof fetch = fetch,
): Promise<VanillaBlockColors | null> {
  await load(fetchImpl);
  return colors;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void load(fetch);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): VanillaBlockColors | null {
  return colors;
}

function getServerSnapshot(): VanillaBlockColors | null {
  return null;
}

/** The vanilla colours, or null until they've loaded. */
export function useVanillaBlockColors(): VanillaBlockColors | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function __resetVanillaBlockColorsForTests(): void {
  colors = null;
  loading = null;
  listeners.clear();
}
