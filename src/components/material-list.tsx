"use client";

import * as React from "react";
import { Button, Input, Label, NativeSelect } from "@iamthemcmaster/ui";
import { IconArrowsExchange } from "@tabler/icons-react";
import type { ParsedSchematicPaletteEntry } from "@/lib/convert";
import { isInvisibleBlockId } from "@/lib/render/minecraft-resources";

type SortOrder = "count-desc" | "id-asc";

interface MaterialListProps {
  palette: readonly ParsedSchematicPaletteEntry[];
  onRequestSwap?: (entry: ParsedSchematicPaletteEntry) => void;
}

const SEARCH_INPUT_ID = "material-list-search";
const SORT_SELECT_ID = "material-list-sort";

export function MaterialList({ palette, onRequestSwap }: MaterialListProps) {
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<SortOrder>("count-desc");

  // Air-likes shouldn't count toward the totals or appear in the list — they're
  // not really materials the user works with. If a future story decides air is
  // meaningful, drop this filter.
  const visiblePalette = React.useMemo(
    () => palette.filter((entry) => !isInvisibleBlockId(entry.blockId)),
    [palette],
  );

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = needle
      ? visiblePalette.filter((entry) =>
          entry.blockId.toLowerCase().includes(needle),
        )
      : visiblePalette;
    if (sort === "id-asc") {
      return [...base].sort((a, b) => a.blockId.localeCompare(b.blockId));
    }
    // count-desc: tiebreak by identifier for stable ordering.
    return [...base].sort(
      (a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId),
    );
  }, [visiblePalette, search, sort]);

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
              onRequestSwap={onRequestSwap}
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
  onRequestSwap,
}: {
  entry: ParsedSchematicPaletteEntry;
  onRequestSwap?: (entry: ParsedSchematicPaletteEntry) => void;
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
          border: "1px solid color-mix(in srgb, var(--text-primary) 18%, transparent)",
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
