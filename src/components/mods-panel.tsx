"use client";

import * as React from "react";
import { Button, Input, Label, NativeSelect } from "@iamthemcmaster/ui";
import {
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconPackage,
  IconPlus,
} from "@tabler/icons-react";
import type { ParsedSchematicProjection } from "@/lib/convert";
import { getEffectiveModVersion } from "@/lib/advanced/effective-mod-version";
import { useAdvancedTargetVersion } from "@/lib/advanced/target-version-state";
import {
  formatDownloadCount,
  hasMoreResults,
  searchCurseForgeMods,
} from "@/lib/curseforge/client";
import {
  isModLoader,
  type CurseForgeModSummary,
  type ModLoader,
} from "@/lib/curseforge/types";
import { useLoadedMods } from "@/lib/mods/registry";

const SEARCH_INPUT_ID = "mods-panel-search";
const LOADER_SELECT_ID = "mods-panel-loader";
const SEARCH_DEBOUNCE_MS = 300;

const LOADER_OPTIONS: readonly { value: ModLoader | ""; label: string }[] = [
  { value: "", label: "Any" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
  { value: "fabric", label: "Fabric" },
  { value: "quilt", label: "Quilt" },
];

// A request from elsewhere in the editor to search for a mod. Each new object
// replaces the search text, even if `text` repeats.
export interface ModSearchRequest {
  text: string;
}

interface ModsPanelProps {
  schematic: ParsedSchematicProjection;
  searchRequest?: ModSearchRequest | null;
}

// Results for one (version, loader, query) combination. Changing any of the
// three produces a new `key`, which discards accumulated pages.
type SearchState =
  | { status: "loading"; key: string }
  | {
      status: "ready";
      key: string;
      mods: CurseForgeModSummary[];
      totalCount: number;
      loadingMore: boolean;
      loadMoreError: string | null;
    }
  | { status: "error"; key: string; message: string }
  | { status: "not_configured"; key: string };

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ModsPanel({ schematic, searchRequest = null }: ModsPanelProps) {
  const [targetVersionId] = useAdvancedTargetVersion();
  const { versionId, isFallback } = getEffectiveModVersion(
    targetVersionId,
    schematic,
  );

  const [query, setQuery] = React.useState(searchRequest?.text ?? "");
  // Apply a new external search request by adjusting state during render.
  const [appliedRequest, setAppliedRequest] = React.useState(searchRequest);
  if (searchRequest !== appliedRequest) {
    setAppliedRequest(searchRequest);
    if (searchRequest !== null) setQuery(searchRequest.text);
  }
  const [loader, setLoader] = React.useState<ModLoader | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const loadedMods = useLoadedMods();
  const loadedModIds = React.useMemo(
    () => new Set(loadedMods.map((mod) => mod.modId)),
    [loadedMods],
  );

  const searchKey = JSON.stringify([versionId, loader, debouncedQuery]);
  const [state, setState] = React.useState<SearchState>({
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
          { q: debouncedQuery, gameVersion: versionId, loader, index: 0 },
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
  }, [searchKey, debouncedQuery, versionId, loader]);

  const loadMore = React.useCallback(() => {
    if (state.status !== "ready" || state.loadingMore) return;
    const { key, mods } = state;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setState({ ...state, loadingMore: true, loadMoreError: null });
    void (async () => {
      let result;
      try {
        result = await searchCurseForgeMods(
          {
            q: debouncedQuery,
            gameVersion: versionId,
            loader,
            index: mods.length,
          },
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
          // An empty page means we've run out regardless of the reported total.
          totalCount:
            result.data.mods.length === 0
              ? prev.mods.length
              : result.data.pagination.totalCount,
          loadingMore: false,
        };
      });
    })();
  }, [state, debouncedQuery, versionId, loader]);

  const handleAdd = React.useCallback((mod: CurseForgeModSummary) => {
    // Wired up in the load-mod story; intentionally a no-op for now.
    void mod;
  }, []);

  // Show the loading state immediately when inputs change, before the effect
  // for the new key has run.
  const view: SearchState =
    state.key === searchKey ? state : { status: "loading", key: searchKey };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
            flex: 1,
            minWidth: 140,
          }}
        >
          <Label
            htmlFor={SEARCH_INPUT_ID}
            style={{ fontSize: "var(--text-xs)" }}
          >
            Search CurseForge
          </Label>
          <Input
            id={SEARCH_INPUT_ID}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="e.g. create, botania"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
          }}
        >
          <Label
            htmlFor={LOADER_SELECT_ID}
            style={{ fontSize: "var(--text-xs)" }}
          >
            Loader
          </Label>
          <NativeSelect
            id={LOADER_SELECT_ID}
            value={loader ?? ""}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setLoader(isModLoader(next) ? next : null);
            }}
          >
            {LOADER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <p
        style={{
          margin: 0,
          color: "var(--text-tertiary)",
          fontSize: "var(--text-xs)",
        }}
      >
        Showing mods for Minecraft {versionId}
        {isFallback
          ? " (schematic version — set a target in Version Mapping to change)"
          : null}
      </p>

      <div
        role="list"
        aria-label="CurseForge mods"
        aria-busy={view.status === "loading"}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-page)",
        }}
      >
        {view.status === "loading" ? (
          <StatusMessage>Searching CurseForge…</StatusMessage>
        ) : view.status === "not_configured" ? (
          <StatusMessage>
            CurseForge integration is not configured on this server
          </StatusMessage>
        ) : view.status === "error" ? (
          <StatusMessage tone="error">{view.message}</StatusMessage>
        ) : view.mods.length === 0 ? (
          <StatusMessage>No mods found for {versionId}</StatusMessage>
        ) : (
          <>
            {view.mods.map((mod) => (
              <ModRow
                key={mod.id}
                mod={mod}
                loaded={loadedModIds.has(mod.id)}
                onAdd={handleAdd}
              />
            ))}
            {view.loadMoreError ? (
              <StatusMessage tone="error">{view.loadMoreError}</StatusMessage>
            ) : null}
            {hasMoreResults(view.mods.length, view.totalCount) ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "var(--space-2)",
                }}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={loadMore}
                  disabled={view.loadingMore}
                >
                  {view.loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function StatusMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        padding: "var(--space-4)",
        color: tone === "error" ? "var(--color-error)" : "var(--text-tertiary)",
        fontSize: "var(--text-sm)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function ModRow({
  mod,
  loaded,
  onAdd,
}: {
  mod: CurseForgeModSummary;
  loaded: boolean;
  onAdd: (mod: CurseForgeModSummary) => void;
}) {
  const author = mod.authors[0] ?? null;
  const restricted = !mod.allowModDistribution;

  return (
    <div
      role="listitem"
      style={{
        display: "grid",
        gridTemplateColumns: "40px minmax(0, 1fr) auto",
        alignItems: "start",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "var(--text-sm)",
      }}
    >
      {mod.logoThumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote CurseForge CDN thumbnail; not worth configuring next/image domains.
        <img
          src={mod.logoThumbnailUrl}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-sm)",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-subtle, var(--border-subtle))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
          }}
        >
          <IconPackage size={20} />
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          gap: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-2)",
            minWidth: 0,
          }}
        >
          {mod.websiteUrl ? (
            <a
              href={mod.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`${mod.name} on CurseForge`}
              style={{
                color: "var(--text-primary)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {mod.name}
              <IconExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <span
              style={{
                color: "var(--text-primary)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mod.name}
            </span>
          )}
        </div>
        <span
          style={{
            color: "var(--text-tertiary)",
            fontSize: "var(--text-xs)",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          {author ? <span>by {author}</span> : null}
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
            title={`${mod.downloadCount.toLocaleString()} downloads`}
          >
            <IconDownload size={12} aria-hidden="true" />
            {formatDownloadCount(mod.downloadCount)}
          </span>
        </span>
        <span
          style={{
            color: "var(--text-secondary)",
            fontSize: "var(--text-xs)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {mod.summary}
        </span>
        {restricted && !loaded ? (
          <span
            style={{
              color: "var(--text-tertiary)",
              fontSize: "var(--text-xs)",
            }}
          >
            Author disallows third-party downloads
          </span>
        ) : null}
      </div>
      {loaded ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--text-secondary)",
            fontSize: "var(--text-xs)",
            padding: "var(--space-1) 0",
          }}
        >
          <IconCheck size={14} aria-hidden="true" />
          Loaded
        </span>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onAdd(mod)}
          disabled={restricted}
          aria-label={`Add ${mod.name}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
          }}
        >
          <IconPlus size={14} aria-hidden="true" />
          Add
        </Button>
      )}
    </div>
  );
}
