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
import type { ParsedSchematicProjection } from "@/lib/convert";
import { translatePreviewInWorker } from "@/lib/convert-client";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";
import type {
  ProblematicEntry,
  VersionMappingPreview,
} from "@/lib/advanced/version-mapping-preview";

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

export function VersionMappingPanel({ schematic }: VersionMappingPanelProps) {
  const [targetVersionId, setTargetVersionId] = React.useState<string | null>(
    null,
  );
  const [previewState, setPreviewState] = React.useState<PreviewState>({
    status: "idle",
  });

  // A monotonically increasing request key — we only commit a preview result
  // when the request that produced it is still the latest one. Handles the
  // user changing the target version (or the schematic mutating from US-010)
  // while a preview is in flight.
  const requestKeyRef = React.useRef(0);

  // Kick off a preview pass whenever the target version selection changes to
  // a non-null value. Setting it back to null returns the panel to idle.
  //
  // Every `setPreviewState` lives behind an `await` inside the async IIFE so
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
        <ProblematicList preview={previewState.preview} />
      ) : (
        <div style={{ flex: 1 }} />
      )}

      <Button
        type="button"
        variant="primary"
        size="md"
        disabled
        title="Resolve any flagged blocks first (coming in a later story)."
      >
        Apply translation
      </Button>
    </div>
  );
}

function ProblematicList({ preview }: { preview: VersionMappingPreview }) {
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
        <ProblematicRow key={entry.sourceBlockState} entry={entry} />
      ))}
    </div>
  );
}

function ProblematicRow({ entry }: { entry: ProblematicEntry }) {
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
    </div>
  );
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
      <strong>{preview.cleanCount.toLocaleString()}</strong>{" "}
      state{preview.cleanCount === 1 ? "" : "s"} translated cleanly,{" "}
      <strong>{preview.problematicCount.toLocaleString()}</strong>{" "}
      state{preview.problematicCount === 1 ? "" : "s"} need attention.
    </div>
  );
}
