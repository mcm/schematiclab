"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iamthemcmaster/ui";
import {
  IconArrowsExchange,
  IconChevronDown,
  IconReplace,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { materialTotals } from "@/lib/camo/materials";
import type {
  ParsedCamoMaterial,
  ParsedSchematicPaletteEntry,
} from "@/lib/convert";
import { knownVersionIdFor } from "@/lib/advanced/effective-mod-version";
import { useEditorState } from "@/lib/editor-state";
import { isInvisibleBlockId } from "@/lib/invisible-blocks";
import {
  filterPaletteRows,
  namespaceOf,
  namespaceOptions,
  pruneSelection,
  unmappedSelection,
  type NamespaceOption,
} from "@/lib/material-list-filter";
import { useNamespaceMappings } from "@/lib/mods/mappings";
import {
  getLoadedModBlock,
  getLoadedNamespaces,
  getModForBlockId,
  useLoadedMods,
} from "@/lib/mods/registry";

type SortOrder = "count-desc" | "id-asc";

// A camo child row's swap: "parent" changes only the camo under `parent`,
// "all" every camo slot holding `material` in the schematic. For the "empty"
// material it fills the empty slots.
export interface CamoSwapRequest {
  parent: ParsedSchematicPaletteEntry;
  material: ParsedCamoMaterial;
  scope: "parent" | "all";
}

interface MaterialListProps {
  palette: readonly ParsedSchematicPaletteEntry[];
  onRequestSwap?: (entry: ParsedSchematicPaletteEntry) => void;
  onRequestCamoSwap?: (request: CamoSwapRequest) => void;
  // Removes `material` from the camo slots under `parent`.
  onRemoveCamo?: (
    parent: ParsedSchematicPaletteEntry,
    material: ParsedCamoMaterial,
  ) => void;
  // Called with a block's namespace when the user asks to find its (unloaded)
  // mod on CurseForge; the editor opens the project picker for it.
  onSearchMod?: (namespace: string) => void;
}

// Mod ownership of a palette row: provided by a loaded mod, from a modded
// namespace that isn't loaded, or neither (vanilla / namespace loaded but the
// block has no blockstates).
type RowModInfo =
  | { kind: "loaded"; modName: string; displayName: string }
  | { kind: "not-loaded"; namespace: string }
  | null;

// Reads the registry's derived lookups, which track the snapshot returned by
// `useLoadedMods()` — callers must subscribe via that hook. `versionId` (the
// schematic's current version) picks which loaded file of a mod names the
// block when files for several versions are loaded.
function modInfoFor(blockId: string, versionId: string | null): RowModInfo {
  const mod = getModForBlockId(blockId, versionId);
  if (mod !== null) {
    return {
      kind: "loaded",
      modName: mod.modName,
      displayName:
        getLoadedModBlock(blockId, versionId)?.displayName ?? blockId,
    };
  }
  const namespace = namespaceOf(blockId);
  if (namespace === "minecraft" || getLoadedNamespaces().has(namespace)) {
    return null;
  }
  return { kind: "not-loaded", namespace };
}

// A block's display name: the loaded mod's name for it, else one made from
// the id's path (`minecraft:mangrove_planks` → "Mangrove Planks").
function displayNameFor(blockId: string): string {
  const modded = getLoadedModBlock(blockId)?.displayName;
  if (modded) return modded;
  const path = blockId.slice(blockId.indexOf(":") + 1);
  return path
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

const SEARCH_INPUT_ID = "material-list-search";
const SORT_SELECT_ID = "material-list-sort";
const NAMESPACE_TRIGGER_ID = "material-list-namespaces";

const NO_NAMESPACES: ReadonlySet<string> = new Set();

export function MaterialList({
  palette,
  onRequestSwap,
  onRequestCamoSwap,
  onRemoveCamo,
  onSearchMod,
}: MaterialListProps) {
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<SortOrder>("count-desc");
  const [selectedNamespaces, setSelectedNamespaces] =
    React.useState<ReadonlySet<string>>(NO_NAMESPACES);
  const loadedMods = useLoadedMods();
  const mappings = useNamespaceMappings();
  const { parseStatus } = useEditorState();
  const versionId =
    parseStatus.status === "ready"
      ? knownVersionIdFor(parseStatus.schematic.minecraftVersion)
      : null;

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
        out.set(entry.blockId, modInfoFor(entry.blockId, versionId));
      }
    }
    return out;
    // `loadedMods` invalidates the registry lookups `modInfoFor` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePalette, loadedMods, versionId]);

  const namespaces = React.useMemo(
    () => namespaceOptions(visiblePalette, mappings),
    [visiblePalette, mappings],
  );

  // Namespaces that left the palette (after a swap or translation) drop out
  // of the selection. Adjusting state during render avoids a stale frame.
  const prunedNamespaces = pruneSelection(selectedNamespaces, namespaces);
  if (prunedNamespaces !== selectedNamespaces) {
    setSelectedNamespaces(prunedNamespaces);
  }

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = filterPaletteRows(
      visiblePalette,
      prunedNamespaces,
      (entry) => {
        if (!needle || entry.blockId.toLowerCase().includes(needle)) {
          return true;
        }
        if (
          entry.camoMaterials?.some((material) =>
            material.blockId.toLowerCase().includes(needle),
          )
        ) {
          return true;
        }
        const info = modInfoByBlockId.get(entry.blockId);
        return (
          info?.kind === "loaded" &&
          (info.displayName.toLowerCase().includes(needle) ||
            info.modName.toLowerCase().includes(needle))
        );
      },
    );
    if (sort === "id-asc") {
      return [...base].sort((a, b) => a.blockId.localeCompare(b.blockId));
    }
    // count-desc: tiebreak by identifier for stable ordering.
    return [...base].sort(
      (a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId),
    );
  }, [visiblePalette, prunedNamespaces, modInfoByBlockId, search, sort]);

  // Placed blocks plus camo slots, per block state (see `materialTotals`).
  const totals = React.useMemo(
    () => materialTotals(visiblePalette),
    [visiblePalette],
  );
  // The footer counts only the rows the filters leave, camo slots included.
  const totalCount = React.useMemo(
    () =>
      [...materialTotals(filtered).values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
    [filtered],
  );
  const camoCount = React.useMemo(
    () =>
      filtered.reduce(
        (sum, entry) =>
          sum +
          (entry.camoMaterials ?? []).reduce(
            (n, m) => (m.kind === "empty" ? n : n + m.count),
            0,
          ),
        0,
      ),
    [filtered],
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
        <NamespaceFilter
          options={namespaces}
          selected={prunedNamespaces}
          onChange={setSelectedNamespaces}
        />
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
              total={totals.get(entry.blockState) ?? entry.count}
              onRequestSwap={onRequestSwap}
              onRequestCamoSwap={onRequestCamoSwap}
              onRemoveCamo={onRemoveCamo}
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
          {camoCount > 0 ? ` (${camoCount.toLocaleString()} in camo)` : ""}
        </span>
      </div>
    </div>
  );
}

function NamespaceFilter({
  options,
  selected,
  onChange,
}: {
  options: readonly NamespaceOption[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const unmapped = React.useMemo(() => unmappedSelection(options), [options]);
  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} selected`;

  const toggle = (namespace: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(namespace);
    else next.delete(namespace);
    onChange(next);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <Label
        htmlFor={NAMESPACE_TRIGGER_ID}
        style={{ fontSize: "var(--text-xs)" }}
      >
        Namespace
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={NAMESPACE_TRIGGER_ID}
            type="button"
            variant="outline"
            disabled={options.length === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
              minWidth: 120,
              maxWidth: 200,
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {summary}
            </span>
            <IconChevronDown size={14} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            width: 280,
            padding: "var(--space-2)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--space-2)",
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={unmapped.size === 0}
              onClick={() => onChange(unmapped)}
            >
              Select unmapped
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => onChange(NO_NAMESPACES)}
            >
              Clear
            </Button>
          </div>
          <div
            role="group"
            aria-label="Namespaces"
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: 280,
              overflowY: "auto",
            }}
          >
            {options.map((option) => {
              const id = `${NAMESPACE_TRIGGER_ID}-${option.namespace}`;
              return (
                <div
                  key={option.namespace}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-1) var(--space-1)",
                  }}
                >
                  <Checkbox
                    id={id}
                    checked={selected.has(option.namespace)}
                    onCheckedChange={(checked) =>
                      toggle(option.namespace, checked === true)
                    }
                  />
                  <Label
                    htmlFor={id}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono, ui-monospace, monospace)",
                      fontSize: "var(--text-xs)",
                    }}
                    title={option.namespace}
                  >
                    {option.namespace}
                  </Label>
                  {option.mapped !== null ? (
                    <Badge
                      variant={option.mapped ? "success" : "warning"}
                      size="sm"
                      style={{ flexShrink: 0 }}
                    >
                      {option.mapped ? "Mapped" : "Unmapped"}
                    </Badge>
                  ) : null}
                  <span
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: "var(--text-xs)",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                    title={`${option.blockStateCount} block state${option.blockStateCount === 1 ? "" : "s"}`}
                  >
                    {option.blockStateCount.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PaletteRow({
  entry,
  modInfo,
  total,
  onRequestSwap,
  onRequestCamoSwap,
  onRemoveCamo,
  onSearchMod,
}: {
  entry: ParsedSchematicPaletteEntry;
  modInfo: RowModInfo;
  // `entry.count` plus the camo slots holding this block state elsewhere.
  total: number;
  onRequestSwap?: (entry: ParsedSchematicPaletteEntry) => void;
  onRequestCamoSwap?: (request: CamoSwapRequest) => void;
  onRemoveCamo?: MaterialListProps["onRemoveCamo"];
  onSearchMod?: (namespace: string) => void;
}) {
  const propertyKeys = Object.keys(entry.properties);
  const propertiesLabel = formatProperties(entry.properties, propertyKeys);
  const swatch = swatchColorFor(entry.blockState);
  const camoMaterials = entry.camoMaterials ?? [];
  const camoTotal = total - entry.count;

  return (
    <div role="listitem">
      <div
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
          {camoTotal > 0 ? (
            <span
              title={`${camoTotal.toLocaleString()} more used as camo; ${total.toLocaleString()} in total`}
              style={{
                display: "block",
                color: "var(--text-tertiary)",
                fontSize: "var(--text-xs)",
                fontWeight: 400,
              }}
            >
              +{camoTotal.toLocaleString()} camo
            </span>
          ) : null}
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
      {camoMaterials.length > 0 ? (
        <div role="list" aria-label={`Camo materials in ${entry.blockState}`}>
          {camoMaterials.map((material) => (
            <CamoMaterialRow
              key={`${material.kind}:${material.blockState}`}
              material={material}
              onRequestSwap={
                onRequestCamoSwap
                  ? (scope) =>
                      onRequestCamoSwap({ parent: entry, material, scope })
                  : undefined
              }
              onRemove={
                onRemoveCamo && material.kind !== "empty"
                  ? () => onRemoveCamo(entry, material)
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CamoMaterialRow({
  material,
  onRequestSwap,
  onRemove,
}: {
  material: ParsedCamoMaterial;
  onRequestSwap?: (scope: CamoSwapRequest["scope"]) => void;
  onRemove?: () => void;
}) {
  const isEmpty = material.kind === "empty";
  const displayName = isEmpty ? "No camo" : displayNameFor(material.blockId);
  const propertiesLabel = formatProperties(
    material.properties,
    Object.keys(material.properties),
  );
  const label = isEmpty ? "empty camo slots" : `camo ${material.blockState}`;
  const hasActions = onRequestSwap !== undefined || onRemove !== undefined;
  return (
    <div
      role="listitem"
      style={{
        display: "grid",
        gridTemplateColumns: hasActions
          ? "14px minmax(0, 1fr) auto auto"
          : "14px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: "var(--space-3)",
        padding:
          "var(--space-1) var(--space-3) var(--space-1) calc(var(--space-3) + 32px)",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "var(--text-xs)",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: "var(--radius-sm)",
          background: isEmpty
            ? "transparent"
            : swatchColorFor(material.blockState),
          border: `1px ${isEmpty ? "dashed" : "solid"} color-mix(in srgb, var(--text-primary) ${isEmpty ? 40 : 18}%, transparent)`,
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
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--text-primary)",
            minWidth: 0,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={displayName}
          >
            {displayName}
          </span>
          {material.kind === "fluid" ? (
            <Badge variant="info" size="sm" style={{ flexShrink: 0 }}>
              Fluid
            </Badge>
          ) : null}
        </span>
        <span
          style={{
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={isEmpty ? undefined : material.blockState}
        >
          {isEmpty ? "Empty slots" : `${material.blockId}${propertiesLabel}`}
        </span>
      </div>
      <span
        style={{
          color: "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {material.count.toLocaleString()}
      </span>
      {hasActions ? (
        <span style={{ display: "inline-flex", gap: "var(--space-1)" }}>
          {onRequestSwap ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRequestSwap("parent")}
                aria-label={
                  isEmpty
                    ? "Set the camo of empty slots in this block"
                    : `Swap ${label} in this block`
                }
                title={
                  isEmpty
                    ? "Set a camo in this block state's empty slots…"
                    : "Swap this camo in this block state only…"
                }
                style={CAMO_ACTION_STYLE}
              >
                <IconArrowsExchange size={12} aria-hidden="true" />
                {isEmpty ? "Set…" : "Swap…"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRequestSwap("all")}
                aria-label={
                  isEmpty
                    ? "Set the camo of empty slots everywhere"
                    : `Replace ${label} everywhere`
                }
                title={
                  isEmpty
                    ? "Set a camo in the empty slots of every block…"
                    : "Replace this camo under every block…"
                }
                style={CAMO_ACTION_STYLE}
              >
                <IconReplace size={12} aria-hidden="true" />
                {isEmpty ? "Set all" : "Replace all"}
              </Button>
            </>
          ) : null}
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              aria-label={`Remove ${label} from this block`}
              title="Remove this camo from this block state, leaving the slots empty"
              style={CAMO_ACTION_STYLE}
            >
              <IconTrash size={12} aria-hidden="true" />
              Remove
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

const CAMO_ACTION_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  fontSize: "var(--text-xs)",
};

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
