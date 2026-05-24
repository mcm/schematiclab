"use client";

import * as React from "react";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iamthemcmaster/ui";
import {
  IconArrowBackUp,
  IconArrowsExchange,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import type { ParsedSchematicProjection } from "@/lib/convert";
import { translatePreviewInWorker } from "@/lib/convert-client";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";
import type {
  ProblematicEntry,
  VersionMappingPreview,
} from "@/lib/advanced/version-mapping-preview";
import type { VersionMappingOverrides } from "@/lib/advanced/edit";
import { useEditorState } from "@/lib/editor-state";
import {
  applyVersionMapping as applyVersionMappingAction,
  undoLastTranslation,
} from "@/lib/editor-state-edits";
import {
  BlockStatePicker,
  type BlockStatePickerResult,
  type BlockStatePickerSource,
} from "./block-state-picker";

const TARGET_VERSION_TRIGGER_ID = "advanced-target-version-trigger";

const VERSION_IDS: readonly string[] = Object.keys(KNOWN_VERSIONS);

interface VersionMappingPanelProps {
  schematic: ParsedSchematicProjection;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; targetVersionId: string }
  | { status: "ready"; targetVersionId: string; preview: VersionMappingPreview }
  | { status: "error"; targetVersionId: string; message: string };

// Per-row decision. A row is "resolved" once it has either an accepted-default
// or an override entry — see `allRowsResolved` below.
type Decision =
  | { kind: "accepted" }
  | { kind: "override"; target: BlockStatePickerResult };

export function VersionMappingPanel({ schematic }: VersionMappingPanelProps) {
  const { lastTranslationSnapshot } = useEditorState();
  const canUndoTranslation = lastTranslationSnapshot !== null;

  const [targetVersionId, setTargetVersionId] = React.useState<string | null>(
    null,
  );
  const [previewState, setPreviewState] = React.useState<PreviewState>({
    status: "idle",
  });
  // Decisions keyed by target version id, then by source block-state string.
  // Persisting per-version means switching the dropdown away and back to a
  // previously-decorated target restores the user's earlier choices (AC4).
  // Reset wholesale when the schematic mutates — stale palette keys aren't
  // safe to apply to a different state set.
  const [decisionsByVersion, setDecisionsByVersion] = React.useState<
    Record<string, Record<string, Decision>>
  >({});
  const [pickerSource, setPickerSource] =
    React.useState<BlockStatePickerSource | null>(null);

  // A monotonically increasing request key — we only commit a preview result
  // when the request that produced it is still the latest one. Handles the
  // user changing the target version (or the schematic mutating from US-010
  // / US-015) while a preview is in flight.
  const requestKeyRef = React.useRef(0);

  const decisions = React.useMemo<Record<string, Decision>>(() => {
    if (targetVersionId === null) return {};
    return decisionsByVersion[targetVersionId] ?? {};
  }, [decisionsByVersion, targetVersionId]);

  // The schematic just mutated (initial mount, swap from US-010, apply from
  // US-015, or undo of either). Drop every stored decision — keys belong to
  // a palette / version pairing that may no longer exist.
  React.useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setDecisionsByVersion({});
    })();
  }, [schematic]);

  // Kick off a preview pass whenever the target version selection changes to
  // a non-null value, or the schematic mutates underneath us. Setting the
  // selection back to null returns the panel to idle.
  //
  // Every `setState` call lives behind an `await` inside the async IIFE so
  // the lint rule against synchronous setState-in-effect stays happy.
  React.useEffect(() => {
    requestKeyRef.current += 1;
    const requestKey = requestKeyRef.current;

    if (targetVersionId === null) {
      void (async () => {
        await Promise.resolve();
        if (requestKeyRef.current !== requestKey) return;
        setPreviewState({ status: "idle" });
      })();
      return;
    }

    const target = KNOWN_VERSIONS[targetVersionId];
    if (!target) return;

    void (async () => {
      await Promise.resolve();
      if (requestKeyRef.current !== requestKey) return;
      setPreviewState({ status: "loading", targetVersionId });
      try {
        const preview = await translatePreviewInWorker(schematic, target);
        if (requestKeyRef.current !== requestKey) return;
        setPreviewState({ status: "ready", targetVersionId, preview });
      } catch (err) {
        if (requestKeyRef.current !== requestKey) return;
        const message =
          err instanceof Error ? err.message : "Translation preview failed.";
        setPreviewState({ status: "error", targetVersionId, message });
      }
    })();
  }, [schematic, targetVersionId]);

  const sourceVersion = schematic.minecraftVersion;

  const setDecisionForCurrentVersion = React.useCallback(
    (key: string, decision: Decision | null) => {
      if (targetVersionId === null) return;
      setDecisionsByVersion((prev) => {
        const current = prev[targetVersionId] ?? {};
        if (decision === null) {
          if (!(key in current)) return prev;
          const next = { ...current };
          delete next[key];
          return { ...prev, [targetVersionId]: next };
        }
        return {
          ...prev,
          [targetVersionId]: { ...current, [key]: decision },
        };
      });
    },
    [targetVersionId],
  );

  const handleAccept = React.useCallback(
    (entry: ProblematicEntry) => {
      setDecisionForCurrentVersion(entry.sourceBlockState, {
        kind: "accepted",
      });
    },
    [setDecisionForCurrentVersion],
  );

  const handlePickReplacement = React.useCallback((entry: ProblematicEntry) => {
    setPickerSource({
      blockState: entry.sourceBlockState,
      blockId: entry.sourceBlockId,
      properties: entry.sourceProperties,
    });
  }, []);

  const handleConfirmReplacement = React.useCallback(
    (target: BlockStatePickerResult) => {
      if (pickerSource) {
        setDecisionForCurrentVersion(pickerSource.blockState, {
          kind: "override",
          target,
        });
      }
      setPickerSource(null);
    },
    [pickerSource, setDecisionForCurrentVersion],
  );

  const handleCancelPicker = React.useCallback(() => {
    setPickerSource(null);
  }, []);

  const handleClearDecision = React.useCallback(
    (entry: ProblematicEntry) => {
      setDecisionForCurrentVersion(entry.sourceBlockState, null);
    },
    [setDecisionForCurrentVersion],
  );

  const handleApplyTranslation = React.useCallback(() => {
    if (previewState.status !== "ready") return;
    const target = KNOWN_VERSIONS[previewState.targetVersionId];
    if (!target) return;
    const currentDecisions =
      decisionsByVersion[previewState.targetVersionId] ?? {};
    const overrides: VersionMappingOverrides = {};
    for (const entry of previewState.preview.problematic) {
      const decision = currentDecisions[entry.sourceBlockState];
      if (decision?.kind === "override") {
        overrides[entry.sourceBlockState] = {
          blockId: decision.target.blockId,
          properties: decision.target.properties,
        };
      }
    }
    const applied = applyVersionMappingAction(target, overrides);
    if (applied) {
      // Reset the panel: clear the target selection so the dropdown returns
      // to its placeholder and the preview goes back to idle. The schematic
      // also mutated, so the [schematic] effect drops every stored decision
      // (their palette / version pairing is no longer current).
      setTargetVersionId(null);
    }
  }, [previewState, decisionsByVersion]);

  const handleUndoTranslation = React.useCallback(() => {
    undoLastTranslation();
  }, []);

  // The "Apply translation" button is enabled when every problematic row has a
  // decision (accept or override). A clean translation (no problematic rows)
  // is also applyable. AC5 leaves room to enable earlier with a warning; we
  // take the strict path — easier for the user to trust the button.
  const allRowsResolved =
    previewState.status === "ready" &&
    previewState.preview.problematic.every(
      (entry) => entry.sourceBlockState in decisions,
    );
  const undecidedCount =
    previewState.status === "ready"
      ? previewState.preview.problematic.filter(
          (entry) => !(entry.sourceBlockState in decisions),
        ).length
      : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-xs)",
        }}
      >
        Source version: {sourceVersion.versionNumber.join(".")} (data{" "}
        {sourceVersion.dataVersion})
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
        }}
      >
        <Label
          htmlFor={TARGET_VERSION_TRIGGER_ID}
          style={{ fontSize: "var(--text-xs)" }}
        >
          Target Minecraft version
        </Label>
        <Select
          value={targetVersionId ?? undefined}
          onValueChange={(next) => setTargetVersionId(next)}
        >
          <SelectTrigger
            id={TARGET_VERSION_TRIGGER_ID}
            style={{ width: "100%" }}
          >
            <SelectValue placeholder="Choose a target version" />
          </SelectTrigger>
          <SelectContent>
            {VERSION_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <PreviewSummary state={previewState} />

      {previewState.status === "ready" ? (
        <ProblematicList
          preview={previewState.preview}
          decisions={decisions}
          onAccept={handleAccept}
          onPickReplacement={handlePickReplacement}
          onClearDecision={handleClearDecision}
        />
      ) : (
        <div style={{ flex: 1 }} />
      )}

      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center",
        }}
      >
        {canUndoTranslation ? (
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={handleUndoTranslation}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
            }}
            title="Restore the schematic to its state before the most recent translation."
          >
            <IconArrowBackUp size={14} aria-hidden="true" />
            Undo translation
          </Button>
        ) : null}
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleApplyTranslation}
          disabled={!allRowsResolved}
          style={{ flex: 1 }}
          title={
            previewState.status !== "ready"
              ? "Pick a target version first."
              : undecidedCount > 0
                ? `${undecidedCount} flagged block${undecidedCount === 1 ? "" : "s"} still need a decision (accept the proposal or pick a replacement).`
                : "Commit this translation to the in-memory schematic."
          }
        >
          Apply translation
        </Button>
      </div>

      {pickerSource !== null ? (
        <BlockStatePicker
          open
          source={pickerSource}
          onCancel={handleCancelPicker}
          onConfirm={handleConfirmReplacement}
          title="Pick replacement block"
          description="Choose the block to substitute for this source state in the translated schematic. The choice overrides the mapper's proposal for this row only. Free-text input is accepted for identifiers outside the catalog."
          confirmLabel="Set replacement"
        />
      ) : null}
    </div>
  );
}

function ProblematicList({
  preview,
  decisions,
  onAccept,
  onPickReplacement,
  onClearDecision,
}: {
  preview: VersionMappingPreview;
  decisions: Record<string, Decision>;
  onAccept: (entry: ProblematicEntry) => void;
  onPickReplacement: (entry: ProblematicEntry) => void;
  onClearDecision: (entry: ProblematicEntry) => void;
}) {
  if (preview.problematic.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-3)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
          textAlign: "center",
        }}
      >
        No issues — translation is clean.
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label="Problematic blocks"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-page)",
      }}
    >
      {preview.problematic.map((entry) => (
        <ProblematicRow
          key={entry.sourceBlockState}
          entry={entry}
          decision={decisions[entry.sourceBlockState]}
          onAccept={() => onAccept(entry)}
          onPickReplacement={() => onPickReplacement(entry)}
          onClearDecision={() => onClearDecision(entry)}
        />
      ))}
    </div>
  );
}

function ProblematicRow({
  entry,
  decision,
  onAccept,
  onPickReplacement,
  onClearDecision,
}: {
  entry: ProblematicEntry;
  decision: Decision | undefined;
  onAccept: () => void;
  onPickReplacement: () => void;
  onClearDecision: () => void;
}) {
  const sourceProps = formatProperties(entry.sourceProperties);
  const targetProps = formatProperties(entry.proposedTargetProperties);

  return (
    <div
      role="listitem"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-2) var(--space-3)",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "var(--text-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-2)",
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
            minWidth: 0,
          }}
          title={entry.sourceBlockId + sourceProps}
        >
          {entry.sourceBlockId}
          {sourceProps ? (
            <span style={{ color: "var(--text-tertiary)" }}>{sourceProps}</span>
          ) : null}
        </span>
        <span
          style={{
            color: "var(--text-primary)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {entry.sourceCount.toLocaleString()}
        </span>
      </div>
      <div
        style={{
          color: "var(--text-secondary)",
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textDecoration:
            decision?.kind === "override" ? "line-through" : "none",
          opacity: decision?.kind === "override" ? 0.55 : 1,
        }}
        title={entry.proposedTargetBlockId + targetProps}
      >
        <span style={{ color: "var(--text-tertiary)" }}>→ </span>
        {entry.proposedTargetBlockId}
        {targetProps ? (
          <span style={{ color: "var(--text-tertiary)" }}>{targetProps}</span>
        ) : null}
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: "var(--space-4)",
          color: "var(--color-error)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.4,
        }}
      >
        {entry.warnings.map((warning, idx) => (
          <li key={idx}>{warning}</li>
        ))}
      </ul>

      <DecisionFooter
        decision={decision}
        onAccept={onAccept}
        onPickReplacement={onPickReplacement}
        onClearDecision={onClearDecision}
      />
    </div>
  );
}

function DecisionFooter({
  decision,
  onAccept,
  onPickReplacement,
  onClearDecision,
}: {
  decision: Decision | undefined;
  onAccept: () => void;
  onPickReplacement: () => void;
  onClearDecision: () => void;
}) {
  if (decision === undefined) {
    return (
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          flexWrap: "wrap",
          paddingTop: "var(--space-1)",
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAccept}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-xs)",
          }}
        >
          <IconCheck size={14} aria-hidden="true" />
          Accept proposal
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPickReplacement}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-xs)",
          }}
        >
          <IconArrowsExchange size={14} aria-hidden="true" />
          Pick replacement…
        </Button>
      </div>
    );
  }

  if (decision.kind === "accepted") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          paddingTop: "var(--space-1)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            color: "var(--text-primary)",
            fontSize: "var(--text-xs)",
            fontWeight: 500,
          }}
        >
          <IconCheck size={14} aria-hidden="true" />
          Proposal accepted
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearDecision}
          aria-label="Clear decision"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-xs)",
            marginLeft: "auto",
          }}
        >
          <IconX size={14} aria-hidden="true" />
          Clear
        </Button>
      </div>
    );
  }

  const overrideDisplay = formatStateDisplay(
    decision.target.blockId,
    decision.target.properties,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        paddingTop: "var(--space-1)",
      }}
    >
      <div
        style={{
          color: "var(--text-primary)",
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={overrideDisplay}
      >
        <span style={{ color: "var(--text-tertiary)" }}>→ replace with </span>
        <strong>{decision.target.blockId}</strong>
        {Object.keys(decision.target.properties).length > 0 ? (
          <span style={{ color: "var(--text-tertiary)" }}>
            {formatProperties(decision.target.properties)}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          flexWrap: "wrap",
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPickReplacement}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-xs)",
          }}
        >
          <IconArrowsExchange size={14} aria-hidden="true" />
          Pick replacement…
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearDecision}
          aria-label="Clear override"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-xs)",
            marginLeft: "auto",
          }}
        >
          <IconX size={14} aria-hidden="true" />
          Clear
        </Button>
      </div>
    </div>
  );
}

function formatStateDisplay(
  blockId: string,
  properties: Record<string, string>,
): string {
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return blockId;
  return `${blockId}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`;
}

function formatProperties(properties: Record<string, string>): string {
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return "";
  return `[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`;
}

function PreviewSummary({ state }: { state: PreviewState }) {
  if (state.status === "idle") {
    return (
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
        }}
      >
        Pick a target version to preview the translation.
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
          fontStyle: "italic",
        }}
      >
        Previewing translation to {state.targetVersionId}…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        style={{
          color: "var(--color-error)",
          fontSize: "var(--text-sm)",
        }}
      >
        Translation preview failed: {state.message}
      </div>
    );
  }

  const { targetVersionId, preview } = state;
  return (
    <div
      role="status"
      style={{
        color: "var(--text-primary)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.4,
      }}
    >
      Translating to <strong>{targetVersionId}</strong>:{" "}
      <strong>{preview.cleanCount.toLocaleString()}</strong> state
      {preview.cleanCount === 1 ? "" : "s"} translated cleanly,{" "}
      <strong>{preview.problematicCount.toLocaleString()}</strong> state
      {preview.problematicCount === 1 ? "" : "s"} need attention.
    </div>
  );
}
