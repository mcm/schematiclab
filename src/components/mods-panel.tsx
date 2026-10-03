"use client";

import * as React from "react";
import { Badge, Button, Input, Label, NativeSelect } from "@iamthemcmaster/ui";
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconFolderOpen,
  IconLink,
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
import { formatDownloadCount, hasMoreResults } from "@/lib/curseforge/client";
import {
  isModLoader,
  type CurseForgeModSummary,
  type ModLoader,
} from "@/lib/curseforge/types";
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedValue,
  useModSearch,
} from "@/lib/curseforge/use-mod-search";
import {
  describeModLoadState,
  dismissModLoad,
  modLoadKey,
  startModLoad,
  useModLoads,
  type ModLoadEntry,
} from "@/lib/mods/load-mod";
import {
  cancelModpackLoad,
  dismissModpackLoad,
  isModpackLoadActive,
  startModpackLoad,
  useModpackLoad,
  type ModpackLoadState,
} from "@/lib/mods/load-modpack";
import { useNamespaceMappings } from "@/lib/mods/mappings";
import {
  detectSchematicNamespaces,
  unmappedNamespaces,
  type SchematicNamespace,
} from "@/lib/mods/namespaces";
import { isRestrictedProject } from "@/lib/mods/project-picker";
import {
  removeAllLoadedMods,
  removeLoadedMod,
  useLoadedMods,
} from "@/lib/mods/registry";
import type { LoadedModMeta } from "@/lib/mods/types";

const SEARCH_INPUT_ID = "mods-panel-search";
const LOADER_SELECT_ID = "mods-panel-loader";

const LOADER_OPTIONS: readonly { value: ModLoader | ""; label: string }[] = [
  { value: "", label: "Any" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
  { value: "fabric", label: "Fabric" },
  { value: "quilt", label: "Quilt" },
];

interface ModsPanelProps {
  schematic: ParsedSchematicProjection;
  // Opens the shared project picker (map mode) for a namespace.
  onMapNamespace?: (namespace: string) => void;
}

export function ModsPanel({ schematic, onMapNamespace }: ModsPanelProps) {
  const [targetVersionId] = useAdvancedTargetVersion();
  const { versionId, isFallback } = getEffectiveModVersion(
    targetVersionId,
    schematic,
  );

  const [query, setQuery] = React.useState("");
  const [loader, setLoader] = React.useState<ModLoader | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const loadedMods = useLoadedMods();
  // Mods with a file loaded for the version being searched.
  const loadedModIds = React.useMemo(
    () =>
      new Set(
        loadedMods
          .filter((mod) => mod.gameVersion === versionId)
          .map((mod) => mod.modId),
      ),
    [loadedMods, versionId],
  );

  const { view, loadMore } = useModSearch(debouncedQuery, versionId, loader);

  const modLoads = useModLoads();
  const handleAdd = React.useCallback(
    (mod: CurseForgeModSummary) => {
      void startModLoad({ mod, gameVersion: versionId, loader });
    },
    [versionId, loader],
  );

  const mappings = useNamespaceMappings();
  const unmapped = React.useMemo(
    () =>
      unmappedNamespaces(
        detectSchematicNamespaces(schematic.palette),
        mappings,
      ),
    [schematic.palette, mappings],
  );

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
      {unmapped.length > 0 ? (
        <UnmappedModsSection
          namespaces={unmapped}
          onMapNamespace={onMapNamespace}
        />
      ) : null}

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
                load={modLoads.get(modLoadKey(mod.id, versionId)) ?? null}
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
  const restricted = isRestrictedProject(mod);

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

function UnmappedModsSection({
  namespaces,
  onMapNamespace,
}: {
  namespaces: readonly SchematicNamespace[];
  onMapNamespace?: (namespace: string) => void;
}) {
  return (
    <section
      aria-label="Unmapped mods in this schematic"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        flexShrink: 0,
      }}
    >
      <SectionHeading>Unmapped mods in this schematic</SectionHeading>
      <div
        role="list"
        aria-label="Unmapped mods in this schematic"
        style={{
          maxHeight: "30vh",
          overflowY: "auto",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-page)",
        }}
      >
        {namespaces.map((entry) => (
          <div
            key={entry.namespace}
            role="listitem"
            style={{ ...ROW_STYLE, alignItems: "center" }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
            >
              <span
                style={{
                  ...NAME_STYLE,
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                }}
                title={entry.namespace}
              >
                {entry.namespace}
              </span>
              <span style={META_STYLE}>
                {`${entry.blockStateCount.toLocaleString()} ${
                  entry.blockStateCount === 1 ? "block state" : "block states"
                } · ${entry.blockCount.toLocaleString()} ${
                  entry.blockCount === 1 ? "block" : "blocks"
                }`}
              </span>
            </div>
            {onMapNamespace ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onMapNamespace(entry.namespace)}
                aria-label={`Map ${entry.namespace} to a CurseForge project`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                }}
              >
                <IconLink size={14} aria-hidden="true" />
                Map…
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function LoadedModsSection({
  loadedMods,
  modLoads,
  versionId,
}: {
  loadedMods: readonly LoadedModMeta[];
  modLoads: ReadonlyMap<string, ModLoadEntry>;
  versionId: string;
}) {
  // One group per mod, in first-loaded order, each listing its files.
  const groups = React.useMemo(() => {
    const byMod = new Map<number, LoadedModMeta[]>();
    for (const mod of loadedMods) {
      const files = byMod.get(mod.modId);
      if (files === undefined) byMod.set(mod.modId, [mod]);
      else files.push(mod);
    }
    return [...byMod.values()];
  }, [loadedMods]);
  // A load stays pending until persisted, but the registry lists it sooner.
  const pending = [...modLoads].filter(
    ([key]) => !loadedMods.some((mod) => mod.key === key),
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {loadedMods.length > 0 ? (
            <UnloadAllButton fileCount={loadedMods.length} />
          ) : null}
          <ModpackFolderButton />
        </div>
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
          {groups.map((files) => (
            <LoadedModGroup
              key={files[0].modId}
              files={files}
              versionId={versionId}
            />
          ))}
          {pending.map(([key, entry]) => (
            <PendingModRow key={key} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

// Unloads every loaded mod file after an inline confirmation. Disabled while a
// modpack folder is loading, which would add its files straight back. Focus
// moves to the confirm button, and back to "Unload all" on Cancel or Escape.
function UnloadAllButton({ fileCount }: { fileCount: number }) {
  const modpackLoad = useModpackLoad();
  const [confirming, setConfirming] = React.useState(false);
  // The button to focus when it mounts after a confirm/cancel switch.
  const focusOnMount = React.useRef<"confirm" | "trigger" | null>(null);
  const busy = isModpackLoadActive(modpackLoad);
  const buttonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-1)",
    flexShrink: 0,
  };
  const focusRef =
    (which: "confirm" | "trigger") => (el: HTMLButtonElement | null) => {
      if (el !== null && focusOnMount.current === which) {
        focusOnMount.current = null;
        el.focus();
      }
    };
  const cancel = () => {
    focusOnMount.current = "trigger";
    setConfirming(false);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  if (confirming && !busy) {
    return (
      <>
        <Button
          ref={focusRef("confirm")}
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            setConfirming(false);
            void removeAllLoadedMods();
          }}
          onKeyDown={onKeyDown}
          style={buttonStyle}
        >
          <IconTrash size={14} aria-hidden="true" />
          Unload {fileCount.toLocaleString()}{" "}
          {fileCount === 1 ? "file" : "files"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={cancel}
          onKeyDown={onKeyDown}
        >
          Cancel
        </Button>
      </>
    );
  }

  return (
    <Button
      ref={focusRef("trigger")}
      type="button"
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={() => {
        focusOnMount.current = "confirm";
        setConfirming(true);
      }}
      title="Unload every loaded mod file. Namespace mappings are kept."
      style={buttonStyle}
    >
      <IconTrash size={14} aria-hidden="true" />
      Unload all
    </Button>
  );
}

// Picks a CurseForge instance folder (the one holding minecraftinstance.json).
// Nothing is uploaded: the browser only hands over File handles, and just the
// manifest and mods/*.jar are ever read.
function ModpackFolderButton() {
  const modpackLoad = useModpackLoad();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const busy = isModpackLoadActive(modpackLoad);

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
  const busy = running || modpackLoad.status === "saving";
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
          {busy ? (
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
        ) : busy ? null : (
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
  { status: "running" | "saving" | "done" | "cancelled" }
>;

function describeModpackHeadline(load: ModpackProgressState): string {
  switch (load.status) {
    case "running":
      return [
        `${load.packName}: ${load.processed} / ${load.total}`,
        load.current,
        load.download
          ? describeModLoadState({ phase: "downloading", ...load.download })
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "saving":
      return `Adding mods from ${load.packName}…`;
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
    load.status === "running"
      ? `${load.loaded.toLocaleString()} with blocks`
      : plural(load.loaded, "mod added", "mods added"),
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

function LoadedModGroup({
  files,
  versionId,
}: {
  files: readonly LoadedModMeta[];
  versionId: string;
}) {
  const { modName } = files[0];
  const hasVersionFile = files.some((file) => file.gameVersion === versionId);

  return (
    <div
      role="listitem"
      aria-label={modName}
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "var(--text-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          minWidth: 0,
          padding: "var(--space-2) var(--space-3) 0",
        }}
      >
        <span style={NAME_STYLE} title={modName}>
          {modName}
        </span>
        {hasVersionFile ? null : (
          <Badge
            variant="warning"
            size="sm"
            title={`No file of this mod is loaded for Minecraft ${versionId}`}
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <IconAlertTriangle size={12} aria-hidden="true" />
            No {versionId} file
          </Badge>
        )}
      </div>
      <div role="list" aria-label={`${modName} files`}>
        {files.map((file) => (
          <LoadedFileRow key={file.key} file={file} />
        ))}
      </div>
    </div>
  );
}

function LoadedFileRow({ file }: { file: LoadedModMeta }) {
  const [removing, setRemoving] = React.useState(false);
  const warnings = file.warnings ?? [];
  const blockCount = file.blocks.length;

  return (
    <div role="listitem" style={{ ...ROW_STYLE, borderBottom: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{ ...META_STYLE, color: "var(--text-secondary)" }}
          title={`Built for ${file.gameVersions.join(", ") || "an unknown version"}`}
        >
          Minecraft {file.gameVersion}
        </span>
        <span style={META_STYLE} title={file.fileDisplayName}>
          {file.fileDisplayName}
        </span>
        <span style={META_STYLE}>
          {[
            file.loader ? LOADER_LABELS[file.loader] : null,
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
          void removeLoadedMod(file.key);
        }}
        aria-label={`Remove ${file.modName} for Minecraft ${file.gameVersion}`}
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
        <span style={META_STYLE}>Minecraft {request.gameVersion}</span>
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
            onClick={() => dismissModLoad(request.mod.id, request.gameVersion)}
            aria-label={`Dismiss error for ${request.mod.name}`}
          >
            <IconX size={14} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
