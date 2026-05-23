"use client";

import * as React from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@iamthemcmaster/ui";
import {
  isCatalogedBlockId,
  searchBlockCatalog,
} from "@/lib/block-catalog";

export interface BlockStatePickerSource {
  blockState: string;
  blockId: string;
  properties: Record<string, string>;
}

export interface BlockStatePickerResult {
  blockId: string;
  properties: Record<string, string>;
}

interface BlockStatePickerProps {
  open: boolean;
  source: BlockStatePickerSource | null;
  onCancel: () => void;
  onConfirm: (target: BlockStatePickerResult) => void;
}

const INPUT_ID = "block-state-picker-input";
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
}: BlockStatePickerProps) {
  const [query, setQuery] = React.useState("");
  const [highlightIndex, setHighlightIndex] = React.useState(0);

  // Reset across opens is handled by the parent — `<BlockStatePicker>` is only
  // mounted while `source !== null`, so each open creates a fresh component
  // instance with fresh `useState` values (avoiding setState-in-effect).

  const suggestions = React.useMemo(
    () => searchBlockCatalog(query, MAX_SUGGESTIONS),
    [query],
  );

  const parsedTarget = parseTargetEntry(query);
  const targetValid = parsedTarget !== null && isValidBlockId(parsedTarget.blockId);
  const targetDisplay =
    parsedTarget && parsedTarget.blockId
      ? formatStateDisplay(parsedTarget.blockId, parsedTarget.properties)
      : "—";

  function selectSuggestion(id: string) {
    setQuery(id);
    setHighlightIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Enter inside the input commits the highlighted suggestion as the
      // typed value (the user can hit Confirm to apply, or press Enter again).
      if (suggestions[highlightIndex] && query.trim() !== suggestions[highlightIndex]) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightIndex]);
      }
    }
  }

  function handleConfirm() {
    if (!parsedTarget || !targetValid) return;
    onConfirm(parsedTarget);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
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
          <DialogTitle>Swap block state</DialogTitle>
          <DialogDescription>
            Replace every instance of the source block state with a new target.
            Type a block identifier — autocomplete suggestions come from the
            schemlib catalog. Free-text input is accepted for identifiers
            outside the catalog.
          </DialogDescription>
        </DialogHeader>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gap: "var(--space-3)",
            alignItems: "center",
            padding: "var(--space-3) 0",
          }}
        >
          <StateCard
            label="Source"
            blockId={source?.blockId ?? "—"}
            display={source ? source.blockState : "—"}
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
                ? `block-state-picker-option-${highlightIndex}`
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
                No matches in the catalog — free-text input still accepted.
              </li>
            ) : (
              suggestions.map((id, i) => {
                const isHighlighted = i === highlightIndex;
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
                      fontFamily:
                        "var(--font-mono, ui-monospace, monospace)",
                      cursor: "pointer",
                      background: isHighlighted
                        ? "var(--bg-elevated)"
                        : "transparent",
                      color: "var(--text-primary)",
                    }}
                  >
                    {id}
                  </li>
                );
              })
            )}
          </ul>
          {parsedTarget && !isCatalogedBlockId(parsedTarget.blockId) ? (
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              {targetValid
                ? `"${parsedTarget.blockId}" isn't in the catalog — it'll be used as-is.`
                : "Identifier must look like `namespace:path`."}
            </span>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={!targetValid || source === null}
          >
            Confirm swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        background: "var(--bg-elevated)",
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
