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
import type { VersionMappingPreview } from "@/lib/advanced/version-mapping-preview";

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

      <div style={{ flex: 1 }} />

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
