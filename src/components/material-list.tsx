"use client";

import * as React from "react";
import { Badge, Button, Input, Label, NativeSelect } from "@iamthemcmaster/ui";
import { IconArrowsExchange, IconSearch } from "@tabler/icons-react";
import type { ParsedSchematicPaletteEntry } from "@/lib/convert";
import { isInvisibleBlockId } from "@/lib/invisible-blocks";
import {
  getLoadedModBlock,
  getLoadedNamespaces,
  getModForBlockId,
  useLoadedMods,
} from "@/lib/mods/registry";

type SortOrder = "count-desc" | "id-asc";

interface MaterialListProps {
  palette: readonly ParsedSchematicPaletteEntry[];
  onRequestSwap?: (entry: ParsedSchematicPaletteEntry) => void;
  // Called with a block's namespace when the user asks to find its (unloaded)
  // mod on CurseForge.
  onSearchMod?: (namespace: string) => void;
}

// Mod ownership of a palette row: provided by a loaded mod, from a modded
// namespace that isn't loaded, or neither (vanilla / namespace loaded but the
// block has no blockstates).
type RowModInfo =
  | { kind: "loaded"; modName: string; displayName: string }
  | { kind: "not-loaded"; namespace: string }
  | null;

function namespaceOf(blockId: string): string {
  const colon = blockId.indexOf(":");
  return colon === -1 ? "minecraft" : blockId.slice(0, colon);
}

// Reads the registry's derived lookups, which track the snapshot returned by
// `useLoadedMods()` — callers must subscribe via that hook.
function modInfoFor(blockId: string): RowModInfo {
  const mod = getModForBlockId(blockId);
  if (mod !== null) {
    return {
      kind: "loaded",
      modName: mod.modName,
      displayName: getLoadedModBlock(blockId)?.displayName ?? blockId,
    };
  }
  const namespace = namespaceOf(blockId);
  if (namespace === "minecraft" || getLoadedNamespaces().has(namespace)) {
    return null;
  }
  return { kind: "not-loaded", namespace };
}

const SEARCH_INPUT_ID = "material-list-search";
const SORT_SELECT_ID = "material-list-sort";

export function MaterialList({
  palette,
  onRequestSwap,
  onSearchMod,
}: MaterialListProps) {
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<SortOrder>("count-desc");
  const loadedMods = useLoadedMods();

  // Air-likes shouldn't count toward the totals or appear in the list — they're
  // not really materials the user works with. If a future story decides air is
  // meaningful, drop this filter.
  const visiblePalette = React.useMemo(
    () => palette.filter((entry) => !isInvisibleBlockId(entry.blockId)),
    [palette],
  );

  const modInfoByBlockId = React.useMemo(() => {
    const out = new Map<string, RowModInfo>();
    for (const entry of visiblePalette) {
      if (!out.has(entry.blockId)) {
        out.set(entry.blockId, modInfoFor(entry.blockId));
      }
    }
    return out;
    // `loadedMods` invalidates the registry lookups `modInfoFor` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePalette, loadedMods]);

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = needle
      ? visiblePalette.filter((entry) => {
          if (entry.blockId.toLowerCase().includes(needle)) return true;
          const info = modInfoByBlockId.get(entry.blockId);
          return (
            info?.kind === "loaded" &&
            (info.displayName.toLowerCase().includes(needle) ||
              info.modName.toLowerCase().includes(needle))
          );
        })
      : visiblePalette;
    if (sort === "id-asc") {
      return [...base].sort((a, b) => a.blockId.localeCompare(b.blockId));
    }
    // count-desc: tiebreak by identifier for stable ordering.
    return [...base].sort(
      (a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId),
    );
  }, [visiblePalette, modInfoByBlockId, search, sort]);

  const totalCount = React.useMemo(
    () => visiblePalette.reduce((sum, entry) => sum + entry.count, 0),
    [visiblePalette],
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
            Filter
          </Label>
          <Input
            id={SEARCH_INPUT_ID}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="e.g. stone, oak"
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
            htmlFor={SORT_SELECT_ID}
            style={{ fontSize: "var(--text-xs)" }}
          >
            Sort
          </Label>
          <NativeSelect
            id={SORT_SELECT_ID}
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value as SortOrder)}
          >
            <option value="count-desc">Count (high → low)</option>
            <option value="id-asc">Identifier (A → Z)</option>
          </NativeSelect>
        </div>
      </div>

      <div
        role="list"
        aria-label="Block palette"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-page)",
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "var(--space-4)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
              textAlign: "center",
            }}
          >
            {visiblePalette.length === 0
              ? "No blocks in this schematic."
              : "No blocks match your filter."}
          </div>
        ) : (
          filtered.map((entry) => (
            <PaletteRow
              key={entry.blockState}
              entry={entry}
              modInfo={modInfoByBlockId.get(entry.blockId) ?? null}
              onRequestSwap={onRequestSwap}
              onSearchMod={onSearchMod}
            />
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "var(--space-2) var(--space-3)",
          borderTop: "1px solid var(--border-subtle)",
          color: "var(--text-secondary)",
          fontSize: "var(--text-xs)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          {filtered.length === visiblePalette.length
            ? `${visiblePalette.length} block state${visiblePalette.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${visiblePalette.length} block states`}
        </span>
        <span>
          Total: <strong>{totalCount.toLocaleString()}</strong> block
          {totalCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function PaletteRow({
  entry,
  modInfo,
  onRequestSwap,
  onSearchMod,
}: {
  entry: ParsedSchematicPaletteEntry;
  modInfo: RowModInfo;
  onRequestSwap?: (entry: ParsedSchematicPaletteEntry) => void;
  onSearchMod?: (namespace: string) => void;
}) {
  const propertyKeys = Object.keys(entry.properties);
  const propertiesLabel = formatProperties(entry.properties, propertyKeys);
  const swatch = swatchColorFor(entry.blockState);

  return (
    <div
      role="listitem"
      style={{
        display: "grid",
        gridTemplateColumns: "20px minmax(0, 1fr) auto auto",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "var(--text-sm)",
      }}
    >
      <div
        aria-hidden
        title={entry.blockId}
        style={{
          width: 20,
          height: 20,
          borderRadius: "var(--radius-sm)",
          background: swatch,
          border:
            "1px solid color-mix(in srgb, var(--text-primary) 18%, transparent)",
          flexShrink: 0,
        }}
      />
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
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: "var(--text-xs)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={entry.blockId}
          >
            {entry.blockId}
          </span>
          {modInfo?.kind === "loaded" ? (
            <Badge
              variant="info"
              size="sm"
              title={`Provided by ${modInfo.modName}`}
              style={{ flexShrink: 0 }}
            >
              {modInfo.modName}
            </Badge>
          ) : null}
        </div>
        {modInfo?.kind === "loaded" ? (
          <span
            style={{
              color: "var(--text-secondary)",
              fontSize: "var(--text-xs)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={modInfo.displayName}
          >
            {modInfo.displayName}
          </span>
        ) : null}
        {modInfo?.kind === "not-loaded" ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-xs)",
            }}
          >
            Mod not loaded
            {onSearchMod ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => onSearchMod(modInfo.namespace)}
                aria-label={`Search CurseForge for ${modInfo.namespace}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  height: "auto",
                  padding: 0,
                  fontSize: "var(--text-xs)",
                }}
              >
                <IconSearch size={12} aria-hidden="true" />
                Search CurseForge
              </Button>
            ) : null}
          </span>
        ) : null}
        {propertiesLabel ? (
          <span
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: "var(--text-xs)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={propertiesLabel}
          >
            {propertiesLabel}
          </span>
        ) : null}
      </div>
      <span
        style={{
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 500,
        }}
      >
        {entry.count.toLocaleString()}
      </span>
      {onRequestSwap ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRequestSwap(entry)}
          aria-label={`Swap ${entry.blockState}`}
          title="Swap this block state…"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-xs)",
          }}
        >
          <IconArrowsExchange size={14} aria-hidden="true" />
          Swap…
        </Button>
      ) : null}
    </div>
  );
}

function formatProperties(
  properties: Record<string, string>,
  keys: readonly string[],
): string {
  if (keys.length === 0) return "";
  const sorted = [...keys].sort();
  return `[${sorted.map((k) => `${k}=${properties[k]}`).join(",")}]`;
}

// Deterministic HSL swatch derived from the full block-state string. Distinct
// states (e.g. `oak_stairs[facing=north]` vs `oak_stairs[facing=east]`) get
// distinct colours so the row's visual marker matches its row identity. Real
// per-block thumbnails sourced from the texture atlas are a future story.
function swatchColorFor(blockState: string): string {
  let hash = 2166136261 >>> 0; // FNV-1a 32-bit basis
  for (let i = 0; i < blockState.length; i += 1) {
    hash ^= blockState.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const hue = hash % 360;
  const sat = 55 + ((hash >>> 8) % 25); // 55–79
  const light = 45 + ((hash >>> 16) % 15); // 45–59
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
