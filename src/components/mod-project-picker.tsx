"use client";

// Shared CurseForge project picker (SCHEM-60). Serves every "map namespace"
// and "replace mod" action: the search starts from the namespace, and a
// result whose slug equals it exactly is preselected. Nothing else is.
// Projects whose authors disallow third-party downloads are listed (marked,
// like the Mods tab) but can't be picked: their files can't be fetched.
//
// Mount it only while open (like `BlockStatePicker`) so each open starts from
// a fresh search and selection.

import * as React from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@iamthemcmaster/ui";
import { IconDownload, IconPackage } from "@tabler/icons-react";
import { formatDownloadCount, hasMoreResults } from "@/lib/curseforge/client";
import type { CurseForgeModSummary } from "@/lib/curseforge/types";
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedValue,
  useModSearch,
} from "@/lib/curseforge/use-mod-search";
import {
  exactSlugMatch,
  isRestrictedProject,
  mapNamespaceToProject,
} from "@/lib/mods/project-picker";

const INPUT_ID = "mod-project-picker-search";
const LIST_ID = "mod-project-picker-results";

interface ModProjectPickerBaseProps {
  open: boolean;
  /** Namespace being mapped or replaced; also the initial search text. */
  namespace: string;
  /** Filter results to this Minecraft version; null searches every version. */
  gameVersion: string | null;
  onSelect: (mod: CurseForgeModSummary) => void;
  onCancel: () => void;
}

export type ModProjectPickerProps = ModProjectPickerBaseProps &
  (
    | {
        // Records `namespace` → project and starts loading the project's
        // file for `sourceVersion` before calling `onSelect`.
        mode: "map";
        /** The schematic's version (KNOWN_VERSIONS key form). */
        sourceVersion: string;
      }
    | {
        // Only returns the project; the caller records the replacement.
        mode: "replace";
      }
  );

/**
 * A request to open the shared picker instance (mounted once, in the
 * Advanced Editor page). Map requests use the schematic's version.
 */
export type ModProjectPickerRequest =
  | { mode: "map"; namespace: string }
  | {
      mode: "replace";
      namespace: string;
      gameVersion: string | null;
      onSelect: (mod: CurseForgeModSummary) => void;
    };

export function ModProjectPicker(props: ModProjectPickerProps) {
  const { open, namespace, gameVersion, onSelect, onCancel } = props;
  const [query, setQuery] = React.useState(namespace);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const { view, loadMore } = useModSearch(debouncedQuery, gameVersion, null);
  const [pickedId, setPickedId] = React.useState<number | null>(null);

  const mods = view.status === "ready" ? view.mods : [];
  // Never a restricted project, so neither is `selected`.
  const exact = exactSlugMatch(namespace, mods);
  // An explicit pick wins while it's still listed; otherwise fall back to the
  // exact match (or nothing).
  const selected = mods.find((mod) => mod.id === pickedId) ?? exact;

  function confirm(mod: CurseForgeModSummary | null) {
    if (mod === null || isRestrictedProject(mod)) return;
    if (props.mode === "map") {
      void mapNamespaceToProject(namespace, mod, props.sourceVersion);
    }
    onSelect(mod);
  }

  const isMap = props.mode === "map";
  const title = isMap
    ? `Map “${namespace}” to a CurseForge project`
    : `Replace “${namespace}” with another mod`;
  const description = isMap
    ? "Choose the CurseForge project that provides this namespace. The mapping is remembered for future schematics."
    : "Choose the mod whose blocks should replace this namespace's blocks.";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent style={{ maxWidth: 640, width: "calc(100vw - 2rem)" }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <Label htmlFor={INPUT_ID} style={{ fontSize: "var(--text-xs)" }}>
              Search CurseForge
            </Label>
            <Input
              id={INPUT_ID}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
              aria-controls={LIST_ID}
            />
            <span
              style={{
                color: "var(--text-tertiary)",
                fontSize: "var(--text-xs)",
              }}
            >
              {gameVersion === null
                ? "Showing mods for every Minecraft version"
                : `Showing mods for Minecraft ${gameVersion}`}
            </span>

            <div
              style={{
                maxHeight: "50vh",
                overflowY: "auto",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-page)",
              }}
            >
              {view.status === "loading" ? (
                <PickerStatus>Searching CurseForge…</PickerStatus>
              ) : view.status === "not_configured" ? (
                <PickerStatus>
                  CurseForge integration is not configured on this server
                </PickerStatus>
              ) : view.status === "error" ? (
                <PickerStatus tone="error">{view.message}</PickerStatus>
              ) : view.mods.length === 0 ? (
                <PickerStatus>No mods found</PickerStatus>
              ) : (
                <>
                  <div
                    id={LIST_ID}
                    role="listbox"
                    aria-label="CurseForge projects"
                  >
                    {view.mods.map((mod) => (
                      <ProjectOption
                        key={mod.id}
                        mod={mod}
                        selected={selected?.id === mod.id}
                        exact={exact?.id === mod.id}
                        restricted={isRestrictedProject(mod)}
                        onPick={() => setPickedId(mod.id)}
                        onConfirm={() => confirm(mod)}
                      />
                    ))}
                  </div>
                  {view.loadMoreError ? (
                    <PickerStatus tone="error">
                      {view.loadMoreError}
                    </PickerStatus>
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
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => confirm(selected)}
            disabled={selected === null || isRestrictedProject(selected)}
          >
            {selected === null
              ? isMap
                ? "Map"
                : "Use mod"
              : isMap
                ? `Map to ${selected.name}`
                : `Use ${selected.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickerStatus({
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

function ProjectOption({
  mod,
  selected,
  exact,
  restricted,
  onPick,
  onConfirm,
}: {
  mod: CurseForgeModSummary;
  selected: boolean;
  exact: boolean;
  /** The author disallows third-party downloads; the option can't be picked. */
  restricted: boolean;
  onPick: () => void;
  onConfirm: () => void;
}) {
  const author = mod.authors[0] ?? null;
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={restricted || undefined}
      tabIndex={restricted ? -1 : 0}
      onClick={restricted ? undefined : onPick}
      onDoubleClick={restricted ? undefined : onConfirm}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (!restricted) onConfirm();
        } else if (e.key === " ") {
          e.preventDefault();
          if (!restricted) onPick();
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "32px minmax(0, 1fr)",
        alignItems: "start",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "var(--text-sm)",
        cursor: restricted ? "not-allowed" : "pointer",
        opacity: restricted ? 0.6 : 1,
        background: selected ? "var(--accent-tint)" : "transparent",
        boxShadow: selected ? "inset 3px 0 0 var(--accent)" : "none",
      }}
    >
      {mod.logoThumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote CurseForge CDN thumbnail; not worth configuring next/image domains.
        <img
          src={mod.logoThumbnailUrl}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius-sm)",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-subtle, var(--border-subtle))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
          }}
        >
          <IconPackage size={16} />
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
            alignItems: "center",
            gap: "var(--space-2)",
            minWidth: 0,
          }}
        >
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
          {exact ? (
            <Badge variant="success" size="sm" style={{ flexShrink: 0 }}>
              Exact match
            </Badge>
          ) : null}
        </div>
        <span
          style={{
            color: "var(--text-tertiary)",
            fontSize: "var(--text-xs)",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {mod.slug}
          </span>
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
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {mod.summary}
        </span>
        {restricted ? (
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
    </div>
  );
}
