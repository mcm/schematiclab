// Paged CurseForge search state, shared by the Mods tab and the project
// picker. Results are keyed by (version, loader, query); changing any of them
// discards accumulated pages.

import * as React from "react";

import { searchCurseForgeMods } from "./client";
import type { CurseForgeModSummary, ModLoader } from "./types";

export type ModSearchState =
  | { status: "loading"; key: string }
  | {
      status: "ready";
      key: string;
      mods: CurseForgeModSummary[];
      // CurseForge offset for the next page. Tracked separately from
      // `mods.length` because duplicate ids across pages are dropped.
      nextIndex: number;
      totalCount: number;
      loadingMore: boolean;
      loadMoreError: string | null;
    }
  | { status: "error"; key: string; message: string }
  | { status: "not_configured"; key: string };

export const SEARCH_DEBOUNCE_MS = 300;

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Search CurseForge for `query` (already debounced/trimmed by the caller).
 * `gameVersion: null` searches every Minecraft version.
 */
export function useModSearch(
  query: string,
  gameVersion: string | null,
  loader: ModLoader | null,
): { view: ModSearchState; loadMore: () => void } {
  const searchKey = JSON.stringify([gameVersion, loader, query]);
  const [state, setState] = React.useState<ModSearchState>({
    status: "loading",
    key: searchKey,
  });
  const loadMoreAbortRef = React.useRef<AbortController | null>(null);

  // First page for the current key. setState lives behind an `await` to keep
  // the no-sync-setState-in-effect lint rule happy.
  React.useEffect(() => {
    const controller = new AbortController();
    loadMoreAbortRef.current?.abort();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setState({ status: "loading", key: searchKey });
      let result;
      try {
        result = await searchCurseForgeMods(
          { q: query, gameVersion, loader, index: 0 },
          controller.signal,
        );
      } catch {
        return; // aborted
      }
      if (controller.signal.aborted) return;
      if (result.status === "ok") {
        setState({
          status: "ready",
          key: searchKey,
          mods: result.data.mods,
          nextIndex: result.data.mods.length,
          totalCount: result.data.pagination.totalCount,
          loadingMore: false,
          loadMoreError: null,
        });
      } else if (result.status === "not_configured") {
        setState({ status: "not_configured", key: searchKey });
      } else {
        setState({ status: "error", key: searchKey, message: result.message });
      }
    })();
    return () => controller.abort();
  }, [searchKey, query, gameVersion, loader]);

  // Abort an in-flight page on unmount.
  React.useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

  const loadMore = React.useCallback(() => {
    if (state.status !== "ready" || state.loadingMore) return;
    const { key, nextIndex } = state;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setState({ ...state, loadingMore: true, loadMoreError: null });
    void (async () => {
      let result;
      try {
        result = await searchCurseForgeMods(
          { q: query, gameVersion, loader, index: nextIndex },
          controller.signal,
        );
      } catch {
        return; // aborted
      }
      setState((prev) => {
        if (prev.status !== "ready" || prev.key !== key) return prev;
        if (result.status !== "ok") {
          return {
            ...prev,
            loadingMore: false,
            loadMoreError:
              result.status === "error"
                ? result.message
                : "CurseForge integration is not configured on this server.",
          };
        }
        // Rankings can shift between pages; skip duplicates.
        const seen = new Set(prev.mods.map((mod) => mod.id));
        const appended = result.data.mods.filter((mod) => !seen.has(mod.id));
        return {
          ...prev,
          mods: [...prev.mods, ...appended],
          nextIndex: prev.nextIndex + result.data.mods.length,
          // An empty page means we've run out regardless of the reported total.
          totalCount:
            result.data.mods.length === 0
              ? prev.nextIndex
              : result.data.pagination.totalCount,
          loadingMore: false,
        };
      });
    })();
  }, [state, query, gameVersion, loader]);

  // Show the loading state immediately when inputs change, before the effect
  // for the new key has run.
  const view: ModSearchState =
    state.key === searchKey ? state : { status: "loading", key: searchKey };
  return { view, loadMore };
}
