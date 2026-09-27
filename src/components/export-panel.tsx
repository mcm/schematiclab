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
import { IconDownload, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import type {
  ParsedSchematicProjection,
  SchematicFormatId,
} from "@/lib/convert";
import { SUPPORTED_FORMATS } from "@/lib/convert";
import { useAdvancedTargetVersion } from "@/lib/advanced/target-version-state";
import { unappliedTargetVersionId } from "@/lib/advanced/unapplied-version";
import { cancel, exportInWorker } from "@/lib/convert-client";
import { setOutputFormat, useEditorState } from "@/lib/editor-state";
import { InlineError } from "./inline-error";

const OUTPUT_FORMAT_TRIGGER_ID = "advanced-export-format-trigger";

const WORKER_CANCELLED_MESSAGE = "Worker cancelled";
const GENERIC_EXPORT_ERROR =
  "Something went wrong during export. Please try again.";

interface FormatOption {
  id: SchematicFormatId;
  label: string;
}

// Mirrors Simple Mode's FormatSelector list (same options, same labels). The
// JSON dev-only rule is applied below; Advanced Mode does NOT exclude the
// detected input format — power users may legitimately want to re-export to
// the same format after edits.
const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: "Litematic", label: "Litematic (.litematic)" },
  { id: "Sponge[v1]", label: "Sponge v1 (.schem)" },
  { id: "Sponge[v2]", label: "Sponge v2 (.schem)" },
  { id: "Sponge[v3]", label: "Sponge v3 (.schem)" },
  { id: "Structure", label: "Structure (.nbt)" },
  { id: "BuildingGadgets[1.12]", label: "Building Gadgets 1.12 (.txt)" },
  {
    id: "BuildingGadgets[1.14.4-1.19.3]",
    label: "Building Gadgets 1.14.4–1.19.3 (.txt)",
  },
  { id: "BuildingGadgets2[1.20+]", label: "Building Gadgets 2 1.20+ (.txt)" },
  { id: "StructurizeBlueprint", label: "Structurize Blueprint (.blueprint)" },
  { id: "JSON", label: "schemlib JSON (.json)" },
];

// Defensive: keep the option list in lockstep with the canonical id list.
const SUPPORTED_FORMAT_SET = new Set<string>(SUPPORTED_FORMATS);

function triggerDownload(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ExportPanelProps {
  schematic: ParsedSchematicProjection;
  inputFilename: string;
  /** Switches to the Version Mapping tab. */
  onGoToVersionMapping: () => void;
}

export function ExportPanel({
  schematic,
  inputFilename,
  onGoToVersionMapping,
}: ExportPanelProps) {
  const { outputFormat } = useEditorState();
  // Export writes the schematic in its current version. A target picked in
  // Version Mapping but never applied gets a notice and a labelled button.
  const [targetVersionId] = useAdvancedTargetVersion();
  const unappliedVersion = unappliedTargetVersionId(
    targetVersionId,
    schematic.minecraftVersion,
  );
  const currentVersion = schematic.minecraftVersion.versionNumber.join(".");

  const [isExporting, setIsExporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  const isDev = process.env.NODE_ENV === "development";
  const visibleFormatOptions = React.useMemo(
    () =>
      FORMAT_OPTIONS.filter((option) => {
        if (!SUPPORTED_FORMAT_SET.has(option.id)) return false;
        if (option.id === "JSON" && !isDev) return false;
        return true;
      }),
    [isDev],
  );

  const handleOutputFormatChange = React.useCallback((next: string) => {
    setOutputFormat(next as SchematicFormatId);
    setError(null);
  }, []);

  const handleExport = React.useCallback(async () => {
    if (!outputFormat || isExporting) return;
    cancelledRef.current = false;
    setError(null);
    setIsExporting(true);
    try {
      const result = await exportInWorker(
        schematic,
        outputFormat,
        inputFilename,
      );
      if (cancelledRef.current) return;
      if (result.ok) {
        triggerDownload(result.bytes, result.filename, result.mimeType);
      } else {
        setError(result.error);
      }
    } catch (err) {
      if (cancelledRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      if (message === WORKER_CANCELLED_MESSAGE) return;
      setError(GENERIC_EXPORT_ERROR);
    } finally {
      setIsExporting(false);
      cancelledRef.current = false;
    }
  }, [schematic, inputFilename, outputFormat, isExporting]);

  const handleCancel = React.useCallback(() => {
    cancelledRef.current = true;
    cancel();
  }, []);

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
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
        }}
      >
        <Label
          htmlFor={OUTPUT_FORMAT_TRIGGER_ID}
          style={{ fontSize: "var(--text-xs)" }}
        >
          Output format
        </Label>
        <Select
          value={outputFormat ?? undefined}
          onValueChange={handleOutputFormatChange}
        >
          <SelectTrigger
            id={OUTPUT_FORMAT_TRIGGER_ID}
            style={{ width: "100%" }}
            disabled={isExporting}
          >
            <SelectValue placeholder="Choose a schematic type to output" />
          </SelectTrigger>
          <SelectContent>
            {visibleFormatOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {unappliedVersion !== null ? (
        <UnappliedVersionNotice
          targetVersion={unappliedVersion}
          currentVersion={currentVersion}
          onGoToVersionMapping={onGoToVersionMapping}
        />
      ) : null}

      <InlineError message={error} />

      <div style={{ flex: 1 }} />

      {isExporting ? (
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
          }}
        >
          <div
            role="status"
            aria-live="polite"
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-2)",
              padding: "var(--space-2) var(--space-3)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-secondary)",
            }}
          >
            <IconLoader2
              size={16}
              style={{
                animation: "schematiclab-spin 0.9s linear infinite",
              }}
              aria-hidden
            />
            <span>Exporting…</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleExport}
          disabled={!outputFormat}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-2)",
          }}
          title={
            outputFormat
              ? "Serialize the edited schematic and download it."
              : "Choose an output format first."
          }
        >
          <IconDownload size={16} aria-hidden="true" />
          {unappliedVersion !== null ? `Export as ${currentVersion}` : "Export"}
        </Button>
      )}
    </div>
  );
}

function UnappliedVersionNotice({
  targetVersion,
  currentVersion,
  onGoToVersionMapping,
}: {
  targetVersion: string;
  currentVersion: string;
  onGoToVersionMapping: () => void;
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-2)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-accent)",
        background: "var(--accent-tint)",
        color: "var(--text-primary)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.4,
      }}
    >
      <IconInfoCircle
        size={18}
        aria-hidden
        style={{ flexShrink: 0, marginTop: 1, color: "var(--text-accent)" }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "var(--space-2)",
        }}
      >
        <span>
          Minecraft {targetVersion} is selected in Version Mapping but not
          applied. This export will be Minecraft {currentVersion}.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGoToVersionMapping}
        >
          Go to Version Mapping
        </Button>
      </div>
    </div>
  );
}
