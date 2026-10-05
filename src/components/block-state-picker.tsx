"use client";

import * as React from "react";
import {
  Button,
  Checkbox,
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
import { knownVersionIdFor } from "@/lib/advanced/effective-mod-version";
import {
  isCatalogedBlockId,
  searchBlockCatalog,
  type CatalogScope,
} from "@/lib/block-catalog";
import { carryCamoBlockProperties } from "@/lib/camo/block-properties";
import { defaultCamoSlots } from "@/lib/camo/extract";
import type { CamoChoice } from "@/lib/camo/write";
import { useEditorState } from "@/lib/editor-state";
import {
  getEnumeratedGeneratedBlock,
  getGeneratedBlockFilesRevision,
  getGeneratedBlockProvider,
  loadGeneratedBlockFiles,
  subscribeGeneratedBlockFiles,
} from "@/lib/mods/generated/registry";
import { completeBlockProperties } from "@/lib/mods/property-domains";
import {
  getLoadedModBlock,
  getModForBlockId,
  useLoadedMods,
} from "@/lib/mods/registry";
import {
  BlockSuggestions,
  type BlockSuggestionContext,
} from "./block-suggestions";

export interface BlockStatePickerSource {
  blockState: string;
  blockId: string;
  properties: Record<string, string>;
}

export interface BlockStatePickerResult {
  blockId: string;
  properties: Record<string, string>;
}

// What the user confirmed. `blockId` / `properties` are the target for
// `source`; `targets` has one per source state the choice applies to, each
// keeping that state's properties when the target is a camo block. `camo`
// is set when camo was chosen for a camo block target.
export interface BlockStatePickerChoice extends BlockStatePickerResult {
  targets: { source: BlockStatePickerSource; target: BlockStatePickerResult }[];
  camo?: CamoChoice;
  /** The properties typed after the identifier (set on every target). */
  typedProperties: Record<string, string>;
  /** Properties some target keeps from its source state. */
  carriedNames: string[];
}

interface BlockStatePickerProps {
  open: boolean;
  source: BlockStatePickerSource | null;
  onCancel: () => void;
  onConfirm: (choice: BlockStatePickerChoice) => void;
  // Every source state the choice applies to (a Version Mapping block
  // group); defaults to `source` alone.
  sources?: readonly BlockStatePickerSource[];
  // Every state of the source's block in the schematic. With more than one,
  // a checkbox widens the choice from `source` to all of them.
  allStates?: readonly BlockStatePickerSource[];
  // Offer camo inputs when the target is a camo block.
  allowCamo?: boolean;
  // Optional copy overrides so the picker can be reused outside of the
  // material-list "swap every instance" flow (e.g. the version-mapping
  // override picker in US-014 reads "Pick replacement block").
  title?: string;
  description?: string;
  confirmLabel?: string;
  // When opened from a problematic Version Mapping row: show "Suggest a
  // block" candidates for the source above the identifier input, and limit
  // autocomplete to blocks in the version being mapped to.
  suggestionContext?: BlockSuggestionContext;
}

const INPUT_ID = "block-state-picker-input";
const ALL_STATES_ID = "block-state-picker-all-states";
const CAMO_INPUT_ID = "block-state-picker-camo";
const MAX_CAMO_SUGGESTIONS = 12;
const MAX_SUGGESTIONS = 25;

// Parse "minecraft:foo[a=b,c=d]" into { blockId, properties }. Free-text input
// is accepted, so users can supply property suffixes for blocks outside the
// catalog. Returns null for clearly-empty input.
function parseTargetEntry(raw: string): BlockStatePickerResult | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const bracket = trimmed.indexOf("[");
  if (bracket === -1) {
    return { blockId: trimmed, properties: {} };
  }
  const id = trimmed.slice(0, bracket).trim();
  const end = trimmed.lastIndexOf("]");
  if (end <= bracket) return { blockId: id, properties: {} };
  const inner = trimmed.slice(bracket + 1, end);
  const properties: Record<string, string> = {};
  for (const part of inner.split(",")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) {
      properties[k.trim()] = v.trim();
    }
  }
  return { blockId: id, properties };
}

function formatStateDisplay(
  blockId: string,
  properties: Record<string, string>,
): string {
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return blockId;
  return `${blockId}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`;
}

function isValidBlockId(id: string): boolean {
  // Minecraft identifiers are `namespace:path`. Be lenient — accept anything
  // that looks like an identifier-ish string with a colon.
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(id);
}

export function BlockStatePicker({
  open,
  source,
  onCancel,
  onConfirm,
  title = "Swap block state",
  description = "Replace every instance of the source block state with a new target. Type a block identifier — autocomplete suggestions come from the schemlib catalog and loaded mods. Free-text input is accepted for identifiers outside the catalog.",
  confirmLabel = "Confirm swap",
  suggestionContext,
  sources,
  allStates,
  allowCamo = false,
}: BlockStatePickerProps) {
  const [query, setQuery] = React.useState("");
  const [highlightIndex, setHighlightIndex] = React.useState(0);
  const [applyToAllStates, setApplyToAllStates] = React.useState(false);
  // Typed camo per slot; empty means no camo.
  const [camoText, setCamoText] = React.useState<Record<string, string>>({});

  // Reset across opens is handled by the parent — `<BlockStatePicker>` is only
  // mounted while `source !== null`, so each open creates a fresh component
  // instance with fresh `useState` values (avoiding setState-in-effect).

  // Re-run the search whenever the set of loaded mods changes so modded
  // blocks appear (or disappear) without reopening the picker.
  const loadedMods = useLoadedMods();
  // Which loaded file of a mod describes a block (properties, name) when
  // files for several versions are loaded: the version being mapped to, else
  // the schematic's current version.
  const { parseStatus } = useEditorState();
  const modVersionId =
    suggestionContext?.versionId ??
    (parseStatus.status === "ready"
      ? knownVersionIdFor(parseStatus.schematic.minecraftVersion)
      : null);
  const scopeVersion = suggestionContext?.version;
  const scopeVersionId = suggestionContext?.versionId;
  const catalogScope = React.useMemo<CatalogScope | undefined>(
    () =>
      scopeVersion && scopeVersionId
        ? { version: scopeVersion, versionId: scopeVersionId }
        : undefined,
    [scopeVersion, scopeVersionId],
  );
  // Blocks generated from the files of the version (Unlimited Chisel Works)
  // are listed once those files' rule data is in memory.
  const generatedFilesRevision = React.useSyncExternalStore(
    subscribeGeneratedBlockFiles,
    getGeneratedBlockFilesRevision,
    getGeneratedBlockFilesRevision,
  );
  const generatesBlocks = loadedMods.some(
    (file) =>
      file.gameVersion === modVersionId &&
      file.namespaces.some((ns) => getGeneratedBlockProvider(ns) !== null),
  );
  React.useEffect(() => {
    if (modVersionId === null || !generatesBlocks) return;
    void loadGeneratedBlockFiles(modVersionId).catch((err: unknown) => {
      console.warn("Could not load generated blocks.", err);
    });
  }, [modVersionId, generatesBlocks, loadedMods]);
  const suggestions = React.useMemo(() => {
    void loadedMods;
    void generatedFilesRevision;
    return searchBlockCatalog(query, MAX_SUGGESTIONS, catalogScope);
  }, [query, loadedMods, generatedFilesRevision, catalogScope]);
  // The list can shrink underneath a stale highlight (e.g. a mod unloads
  // while the picker is open), so clamp during render rather than trusting
  // the stored index.
  const activeIndex = Math.max(
    0,
    Math.min(highlightIndex, suggestions.length - 1),
  );

  const typedTarget = parseTargetEntry(query);
  const canWiden = allStates !== undefined && allStates.length > 1;
  const appliesTo: readonly BlockStatePickerSource[] =
    canWiden && applyToAllStates
      ? allStates
      : (sources ?? (source ? [source] : []));
  // A camo block target keeps each source state's properties it also has (a
  // stairs' facing/half/shape/waterlogged); typed properties win.
  const targetFor = (from: BlockStatePickerSource): BlockStatePickerResult =>
    typedTarget === null
      ? { blockId: "", properties: {} }
      : {
          blockId: typedTarget.blockId,
          properties: {
            ...carryCamoBlockProperties(from.properties, typedTarget.blockId),
            ...typedTarget.properties,
          },
        };
  const carriedNames = [
    ...new Set(
      appliesTo.flatMap((from) =>
        typedTarget === null
          ? []
          : Object.keys(
              carryCamoBlockProperties(from.properties, typedTarget.blockId),
            ),
      ),
    ),
  ]
    .filter((name) => !Object.hasOwn(typedTarget?.properties ?? {}, name))
    .sort();
  const parsedTarget =
    typedTarget && (source ? targetFor(source) : typedTarget);
  // Camo slots of the target across every state it applies to.
  const camoSlots =
    allowCamo && typedTarget
      ? [
          ...new Set(
            appliesTo.flatMap((from) => {
              const target = targetFor(from);
              return defaultCamoSlots(target.blockId, target.properties);
            }),
          ),
        ]
      : [];
  const camoEntries = camoSlots.flatMap((slot) => {
    const parsed = parseTargetEntry(camoText[slot] ?? "");
    return parsed === null ? [] : [[slot, parsed] as const];
  });
  const camoValid = camoEntries.every(([, target]) =>
    isValidBlockId(target.blockId),
  );
  const targetValid =
    parsedTarget !== null && isValidBlockId(parsedTarget.blockId);
  const manyStates = appliesTo.length > 1;
  const targetDisplay =
    parsedTarget && parsedTarget.blockId
      ? manyStates
        ? formatStateDisplay(
            parsedTarget.blockId,
            typedTarget?.properties ?? {},
          )
        : formatStateDisplay(parsedTarget.blockId, parsedTarget.properties)
      : "—";
  const targetGenerated =
    parsedTarget && modVersionId !== null
      ? getEnumeratedGeneratedBlock(parsedTarget.blockId, modVersionId)
      : null;
  const targetModBlock = parsedTarget
    ? (getLoadedModBlock(parsedTarget.blockId, modVersionId) ??
      targetGenerated?.block ??
      null)
    : null;
  const targetModName = parsedTarget
    ? (getModForBlockId(parsedTarget.blockId, modVersionId)?.modName ??
      targetGenerated?.provider.modName ??
      null)
    : null;

  function selectSuggestion(id: string) {
    setQuery(id);
    setHighlightIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex(Math.min(activeIndex + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      // Enter inside the input commits the highlighted suggestion as the
      // typed value (the user can hit Confirm to apply, or press Enter again).
      if (
        suggestions[activeIndex] &&
        query.trim() !== suggestions[activeIndex]
      ) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      }
    }
  }

  function handleConfirm() {
    if (!parsedTarget || !targetValid || !camoValid) return;
    onConfirm({
      ...parsedTarget,
      typedProperties: typedTarget?.properties ?? {},
      carriedNames,
      targets: appliesTo.map((from) => ({
        source: from,
        target: targetFor(from),
      })),
      ...(camoEntries.length > 0
        ? { camo: Object.fromEntries(camoEntries) }
        : {}),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        style={{
          maxWidth: 640,
          width: "calc(100vw - 2rem)",
        }}
        onPointerDownOutside={(e) => {
          // Keep the dialog stable while the user clicks inside the suggestion
          // list — Radix would otherwise consider the suggestion <li> "outside"
          // because it's rendered in the dialog's child tree but uses pointer-
          // down. Default behavior is fine here, so no preventDefault needed,
          // but leaving the hook to make the intent explicit.
          void e;
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
              gap: "var(--space-3)",
              alignItems: "center",
              paddingBottom: "var(--space-3)",
            }}
          >
            <StateCard
              label="Source"
              blockId={source?.blockId ?? "—"}
              display={
                source
                  ? manyStates
                    ? `${appliesTo.length} states`
                    : source.blockState
                  : "—"
              }
            />
            <span aria-hidden style={{ color: "var(--text-tertiary)" }}>
              →
            </span>
            <StateCard
              label="Target"
              blockId={parsedTarget?.blockId ?? "—"}
              display={targetDisplay}
              tone={!targetValid ? "muted" : "normal"}
            />
          </div>

          {suggestionContext && source ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                paddingBottom: "var(--space-3)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                }}
              >
                Suggested blocks in {suggestionContext.versionId}
              </span>
              <BlockSuggestions
                sourceBlockId={source.blockId}
                context={suggestionContext}
                onChoose={(candidate) => selectSuggestion(candidate.id)}
                chooseLabel="Select"
              />
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <Label htmlFor={INPUT_ID} style={{ fontSize: "var(--text-xs)" }}>
              Target block identifier
            </Label>
            <Input
              id={INPUT_ID}
              type="text"
              value={query}
              placeholder="minecraft:spruce_planks"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.currentTarget.value);
                setHighlightIndex(0);
              }}
              onKeyDown={handleKeyDown}
              aria-autocomplete="list"
              aria-controls="block-state-picker-suggestions"
              aria-activedescendant={
                suggestions.length > 0
                  ? `block-state-picker-option-${activeIndex}`
                  : undefined
              }
            />
            <ul
              id="block-state-picker-suggestions"
              role="listbox"
              aria-label="Block identifier suggestions"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                maxHeight: 220,
                overflowY: "auto",
                background: "var(--bg-page)",
              }}
            >
              {suggestions.length === 0 ? (
                <li
                  style={{
                    padding: "var(--space-2) var(--space-3)",
                    color: "var(--text-tertiary)",
                    fontSize: "var(--text-sm)",
                    fontStyle: "italic",
                  }}
                >
                  {catalogScope
                    ? `No matches in ${catalogScope.versionId}`
                    : "No matches in the catalog"}{" "}
                  — free-text input still accepted.
                </li>
              ) : (
                suggestions.map((id, i) => {
                  const isHighlighted = i === activeIndex;
                  const modName =
                    getModForBlockId(id, modVersionId)?.modName ??
                    getGeneratedBlockProvider(id.slice(0, id.indexOf(":")))
                      ?.modName;
                  return (
                    <li
                      key={id}
                      id={`block-state-picker-option-${i}`}
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseDown={(e) => {
                        // Use mousedown so the input keeps focus through the
                        // click — onClick would fire after the input blurs.
                        e.preventDefault();
                        selectSuggestion(id);
                      }}
                      onMouseEnter={() => setHighlightIndex(i)}
                      style={{
                        padding: "var(--space-1) var(--space-3)",
                        fontSize: "var(--text-sm)",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        cursor: "pointer",
                        background: isHighlighted
                          ? "var(--bg-raised)"
                          : "transparent",
                        color: "var(--text-primary)",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "var(--space-2)",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {id}
                      </span>
                      {modName ? (
                        <span
                          style={{
                            flexShrink: 0,
                            fontFamily: "var(--font-body)",
                            fontSize: "var(--text-xs)",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {modName}
                        </span>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
            {parsedTarget &&
            !isCatalogedBlockId(parsedTarget.blockId, catalogScope) ? (
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                {targetValid
                  ? catalogScope
                    ? `"${parsedTarget.blockId}" isn't a known block in ${catalogScope.versionId} — it'll be used as-is.`
                    : `"${parsedTarget.blockId}" isn't in the catalog — it'll be used as-is.`
                  : "Identifier must look like `namespace:path`."}
              </span>
            ) : null}
            {targetValid && carriedNames.length > 0 ? (
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                {appliesTo.length > 1
                  ? `Each of the ${appliesTo.length} states keeps its own`
                  : "Kept from the source:"}{" "}
                {carriedNames.join(", ")}. Type <code>[name=value]</code> after
                the identifier to set one for all.
              </span>
            ) : null}
            {canWiden ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <Checkbox
                  id={ALL_STATES_ID}
                  checked={applyToAllStates}
                  onCheckedChange={(checked) =>
                    setApplyToAllStates(checked === true)
                  }
                />
                <Label
                  htmlFor={ALL_STATES_ID}
                  style={{ fontSize: "var(--text-xs)" }}
                >
                  Replace all {allStates.length} states of {source?.blockId}
                </Label>
              </div>
            ) : null}
            {targetValid && camoSlots.length > 0 ? (
              <CamoInputs
                slots={camoSlots}
                scope={catalogScope}
                values={camoText}
                onChange={(slot, value) =>
                  setCamoText((prev) => ({ ...prev, [slot]: value }))
                }
              />
            ) : null}
            {targetModBlock ? (
              <ModBlockHint
                displayName={targetModBlock.displayName}
                modName={targetModName}
                properties={completeBlockProperties(targetModBlock.properties)}
              />
            ) : null}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={!targetValid || !camoValid || source === null}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CAMO_SLOT_LABELS: Record<string, string> = {
  camo: "Camo",
  camo_two: "Second camo",
  material: "Camo",
};

// "top_northeast" → "Top northeast camo"
function camoSlotLabel(slot: string): string {
  if (Object.hasOwn(CAMO_SLOT_LABELS, slot)) return CAMO_SLOT_LABELS[slot];
  const words = slot.replace(/_/g, " ");
  return `${words[0].toUpperCase()}${words.slice(1)} camo`;
}

// One identifier input per camo slot of a camo block target, with catalog
// suggestions. An empty input leaves that slot without camo.
function CamoInputs({
  slots,
  scope,
  values,
  onChange,
}: {
  slots: readonly string[];
  scope: CatalogScope | undefined;
  values: Record<string, string>;
  onChange: (slot: string, value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Camo"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-tertiary)",
        }}
      >
        Camo for the new blocks. Leave a slot empty for no camo.
      </span>
      {slots.map((slot) => {
        const id = `${CAMO_INPUT_ID}-${slot}`;
        const value = values[slot] ?? "";
        const parsed = parseTargetEntry(value);
        return (
          <div
            key={slot}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
            }}
          >
            <Label htmlFor={id} style={{ fontSize: "var(--text-xs)" }}>
              {camoSlotLabel(slot)}
            </Label>
            <Input
              id={id}
              type="text"
              value={value}
              placeholder="No camo (e.g. minecraft:oak_planks)"
              autoComplete="off"
              spellCheck={false}
              list={`${id}-suggestions`}
              onChange={(e) => onChange(slot, e.currentTarget.value)}
            />
            <datalist id={`${id}-suggestions`}>
              {searchBlockCatalog(value, MAX_CAMO_SUGGESTIONS, scope).map(
                (option) => (
                  <option key={option} value={option} />
                ),
              )}
            </datalist>
            {parsed !== null && !isValidBlockId(parsed.blockId) ? (
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                Identifier must look like `namespace:path`.
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// Known properties/values for a loaded mod block, derived from its blockstates
// file and completed with `completeBlockProperties`. Shown as a hint so users can type a valid `[prop=value]` suffix.
function ModBlockHint({
  displayName,
  modName,
  properties,
}: {
  displayName: string;
  modName: string | null;
  properties: Record<string, string[]>;
}) {
  const names = Object.keys(properties).sort();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        fontSize: "var(--text-xs)",
        color: "var(--text-tertiary)",
      }}
    >
      <span>
        {displayName}
        {modName ? ` · from ${modName}` : null}
      </span>
      {names.length === 0 ? (
        <span>No block-state properties.</span>
      ) : (
        <ul
          aria-label="Known block-state properties"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
          }}
        >
          {names.map((name) => (
            <li key={name}>
              {name} = {properties[name].join(" | ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StateCard({
  label,
  blockId,
  display,
  tone = "normal",
}: {
  label: string;
  blockId: string;
  display: string;
  tone?: "normal" | "muted";
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-3)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-raised)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: "var(--text-xs)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      <span
        title={display}
        style={{
          color:
            tone === "muted" ? "var(--text-tertiary)" : "var(--text-primary)",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: "var(--text-sm)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {blockId}
      </span>
      <span
        title={display}
        style={{
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: "var(--text-xs)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {display}
      </span>
    </div>
  );
}
