"use client";

import * as React from "react";
import { Badge, Button, Input, Label, NativeSelect } from "@iamthemcmaster/ui";
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconFolderOpen,
  IconLoader2,
  IconPackage,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
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
import {
  describeModLoadState,
  dismissModLoad,
  startModLoad,
  useModLoads,
  type ModLoadEntry,
} from "@/lib/mods/load-mod";
import {
  cancelModpackLoad,
  dismissModpackLoad,
  startModpackLoad,
  useModpackLoad,
  type ModpackLoadState,
} from "@/lib/mods/load-modpack";
import { removeLoadedMod, useLoadedMods } from "@/lib/mods/registry";
import type { LoadedModMeta } from "@/lib/mods/types";

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
      // CurseForge offset for the next page. Tracked separately from
      // `mods.length` because duplicate ids across pages are dropped.
      nextIndex: number;
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
  }, [searchKey, debouncedQuery, versionId, loader]);

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
          {
            q: debouncedQuery,
            gameVersion: versionId,
            loader,
            index: nextIndex,
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
  }, [state, debouncedQuery, versionId, loader]);

  const modLoads = useModLoads();
  const handleAdd = React.useCallback(
    (mod: CurseForgeModSummary) => {
      void startModLoad({ mod, gameVersion: versionId, loader });
    },
    [versionId, loader],
  );

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
      <LoadedModsSection
        loadedMods={loadedMods}
        modLoads={modLoads}
        versionId={versionId}
      />

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
                load={modLoads.get(mod.id) ?? null}
                onAdd={handleAdd}
              />
            ))}
            {view.loadMoreError ? (
              <StatusMessage tone="error">{view.loadMoreError}</StatusMessage>
            ) : null}
            {hasMoreResults(view.nextIndex, view.totalCount) ? (
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
  load,
  onAdd,
}: {
  mod: CurseForgeModSummary;
  loaded: boolean;
  load: ModLoadEntry | null;
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
        {load?.state.phase === "error" && !loaded ? (
          <span
            role="alert"
            style={{ color: "var(--color-error)", fontSize: "var(--text-xs)" }}
          >
            {load.state.message}
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
      ) : load !== null && load.state.phase !== "error" ? (
        <LoadProgress entry={load} />
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onAdd(mod)}
          disabled={restricted}
          aria-label={`${load ? "Retry adding" : "Add"} ${mod.name}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
          }}
        >
          {load ? (
            <IconRefresh size={14} aria-hidden="true" />
          ) : (
            <IconPlus size={14} aria-hidden="true" />
          )}
          {load ? "Retry" : "Add"}
        </Button>
      )}
    </div>
  );
}

function LoadProgress({ entry }: { entry: ModLoadEntry }) {
  return (
    <span
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: "var(--text-secondary)",
        fontSize: "var(--text-xs)",
        padding: "var(--space-1) 0",
        whiteSpace: "nowrap",
      }}
    >
      <IconLoader2
        size={14}
        aria-hidden="true"
        style={{ animation: "schematiclab-spin 0.9s linear infinite" }}
      />
      {describeModLoadState(entry.state)}
    </span>
  );
}

const LOADER_LABELS: Record<string, string> = Object.fromEntries(
  LOADER_OPTIONS.map((option) => [option.value, option.label]),
);

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: "var(--text-xs)",
        fontWeight: 600,
        color: "var(--text-secondary)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </h3>
  );
}

function LoadedModsSection({
  loadedMods,
  modLoads,
  versionId,
}: {
  loadedMods: readonly LoadedModMeta[];
  modLoads: ReadonlyMap<number, ModLoadEntry>;
  versionId: string;
}) {
  // A load stays pending until persisted, but the registry lists it sooner.
  const pending = [...modLoads.values()].filter(
    (entry) => !loadedMods.some((mod) => mod.modId === entry.request.mod.id),
  );
  const empty = loadedMods.length === 0 && pending.length === 0;

  return (
    <section
      aria-label="Loaded mods"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
        }}
      >
        <SectionHeading>Loaded mods</SectionHeading>
        <ModpackFolderButton />
      </div>
      <ModpackLoadStatus />
      {empty ? (
        <p
          style={{
            margin: 0,
            color: "var(--text-tertiary)",
            fontSize: "var(--text-xs)",
          }}
        >
          No mods loaded. Search CurseForge below and click Add, or load a
          CurseForge modpack folder.
        </p>
      ) : (
        <div
          role="list"
          aria-label="Loaded mods"
          style={{
            maxHeight: "40vh",
            overflowY: "auto",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-page)",
          }}
        >
          {loadedMods.map((mod) => (
            <LoadedModRow key={mod.key} mod={mod} versionId={versionId} />
          ))}
          {pending.map((entry) => (
            <PendingModRow key={entry.request.mod.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

// Picks a CurseForge instance folder (the one holding minecraftinstance.json).
// Nothing is uploaded: the browser only hands over File handles, and just the
// manifest and mods/*.jar are ever read.
function ModpackFolderButton() {
  const modpackLoad = useModpackLoad();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const busy =
    modpackLoad?.status === "reading" || modpackLoad?.status === "running";

  return (
    <>
      <input
        ref={(el) => {
          inputRef.current = el;
          // Not in React's input typings; supported by all major browsers.
          el?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const input = e.currentTarget;
          const files = Array.from(input.files ?? [], (file) => ({
            path: file.webkitRelativePath || file.name,
            file,
          }));
          // Let the same folder be picked again later.
          input.value = "";
          if (files.length > 0) void startModpackLoad(files);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title="Load every mod from a CurseForge instance folder on this computer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          flexShrink: 0,
        }}
      >
        <IconFolderOpen size={14} aria-hidden="true" />
        Load modpack…
      </Button>
    </>
  );
}

function ModpackLoadStatus() {
  const modpackLoad = useModpackLoad();
  if (modpackLoad === null) return null;

  const box: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
    padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    background: "var(--bg-page)",
    fontSize: "var(--text-xs)",
  };

  if (modpackLoad.status === "error") {
    return (
      <div style={{ ...box, flexDirection: "row", alignItems: "start" }}>
        <span
          role="alert"
          style={{ flex: 1, color: "var(--color-error)", minWidth: 0 }}
        >
          {modpackLoad.message}
        </span>
        <DismissModpackButton />
      </div>
    );
  }
  if (modpackLoad.status === "reading") {
    return (
      <div role="status" style={{ ...box, color: "var(--text-secondary)" }}>
        Reading modpack…
      </div>
    );
  }

  const running = modpackLoad.status === "running";
  return (
    <div style={box}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          minWidth: 0,
        }}
      >
        <span
          role="status"
          style={{
            flex: 1,
            minWidth: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--text-secondary)",
          }}
        >
          {running ? (
            <IconLoader2
              size={14}
              aria-hidden="true"
              style={{
                flexShrink: 0,
                animation: "schematiclab-spin 0.9s linear infinite",
              }}
            />
          ) : null}
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={modpackLoad.packName}
          >
            {describeModpackHeadline(modpackLoad)}
          </span>
        </span>
        {running ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelModpackLoad}
          >
            Cancel
          </Button>
        ) : (
          <DismissModpackButton />
        )}
      </div>
      {running ? (
        <progress
          value={modpackLoad.processed}
          max={Math.max(1, modpackLoad.total)}
          aria-label={`Loading ${modpackLoad.packName}`}
          style={{ width: "100%", height: 6 }}
        />
      ) : null}
      <span style={{ color: "var(--text-tertiary)" }}>
        {describeModpackCounts(modpackLoad)}
      </span>
      {modpackLoad.failures.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer", color: "var(--color-error)" }}>
            {modpackLoad.failures.length}{" "}
            {modpackLoad.failures.length === 1 ? "mod" : "mods"} failed
          </summary>
          <ul
            style={{
              margin: "var(--space-1) 0 0",
              paddingLeft: "var(--space-4)",
              maxHeight: 160,
              overflowY: "auto",
              color: "var(--text-tertiary)",
              wordBreak: "break-word",
            }}
          >
            {modpackLoad.failures.map((failure, i) => (
              <li key={i}>
                <strong>{failure.modName}</strong>: {failure.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function DismissModpackButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={dismissModpackLoad}
      aria-label="Dismiss modpack status"
    >
      <IconX size={14} aria-hidden="true" />
    </Button>
  );
}

type ModpackProgressState = Extract<
  ModpackLoadState,
  { status: "running" | "done" | "cancelled" }
>;

function describeModpackHeadline(load: ModpackProgressState): string {
  switch (load.status) {
    case "running":
      return `${load.packName}: ${load.processed} / ${load.total}${
        load.current ? ` · ${load.current}` : ""
      }`;
    case "done":
      return `Loaded ${load.packName}`;
    case "cancelled":
      return `Stopped loading ${load.packName} (${load.processed} / ${load.total})`;
  }
}

function describeModpackCounts(load: ModpackProgressState): string {
  const plural = (n: number, one: string, many: string) =>
    `${n.toLocaleString()} ${n === 1 ? one : many}`;
  return [
    plural(load.loaded, "mod added", "mods added"),
    load.alreadyLoaded > 0 ? `${load.alreadyLoaded} already loaded` : null,
    load.noBlocks > 0
      ? `${load.noBlocks.toLocaleString()} without blocks`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const ROW_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "start",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--text-sm)",
};

const NAME_STYLE: React.CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const META_STYLE: React.CSSProperties = {
  color: "var(--text-tertiary)",
  fontSize: "var(--text-xs)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function LoadedModRow({
  mod,
  versionId,
}: {
  mod: LoadedModMeta;
  versionId: string;
}) {
  const [removing, setRemoving] = React.useState(false);
  const warnings = mod.warnings ?? [];
  const versionMismatch =
    mod.gameVersions.length > 0 && !mod.gameVersions.includes(versionId);
  const blockCount = mod.blocks.length;

  return (
    <div role="listitem" style={ROW_STYLE}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            minWidth: 0,
          }}
        >
          <span style={NAME_STYLE} title={mod.modName}>
            {mod.modName}
          </span>
          {versionMismatch ? (
            <Badge
              variant="warning"
              size="sm"
              title={`This file was built for Minecraft ${mod.gameVersions.join(", ")}, not ${versionId}`}
              style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              <IconAlertTriangle size={12} aria-hidden="true" />
              Built for {mod.gameVersions.join(", ")}
            </Badge>
          ) : null}
        </div>
        <span style={META_STYLE} title={mod.fileDisplayName}>
          {mod.fileDisplayName}
        </span>
        <span style={META_STYLE}>
          {[
            mod.gameVersions.join(", ") || "Unknown version",
            mod.loader ? LOADER_LABELS[mod.loader] : null,
            `${blockCount.toLocaleString()} ${blockCount === 1 ? "block" : "blocks"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {warnings.length > 0 ? (
          <details style={{ fontSize: "var(--text-xs)" }}>
            <summary
              style={{ cursor: "pointer", color: "var(--text-secondary)" }}
            >
              {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
            </summary>
            <ul
              style={{
                margin: "var(--space-1) 0 0",
                paddingLeft: "var(--space-4)",
                maxHeight: 160,
                overflowY: "auto",
                color: "var(--text-tertiary)",
                wordBreak: "break-all",
              }}
            >
              {warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={removing}
        onClick={() => {
          setRemoving(true);
          void removeLoadedMod(mod.key);
        }}
        aria-label={`Remove ${mod.modName}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
        }}
      >
        <IconTrash size={14} aria-hidden="true" />
        Remove
      </Button>
    </div>
  );
}

function PendingModRow({ entry }: { entry: ModLoadEntry }) {
  const { request, state } = entry;
  const failed = state.phase === "error";
  return (
    <div role="listitem" style={ROW_STYLE}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={NAME_STYLE} title={request.mod.name}>
          {request.mod.name}
        </span>
        {failed ? (
          <span
            role="alert"
            style={{ color: "var(--color-error)", fontSize: "var(--text-xs)" }}
          >
            {state.message}
          </span>
        ) : (
          <LoadProgress entry={entry} />
        )}
      </div>
      {failed ? (
        <div style={{ display: "flex", gap: "var(--space-1)" }}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void startModLoad(request)}
            aria-label={`Retry adding ${request.mod.name}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
            }}
          >
            <IconRefresh size={14} aria-hidden="true" />
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => dismissModLoad(request.mod.id)}
            aria-label={`Dismiss error for ${request.mod.name}`}
          >
            <IconX size={14} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
