"use client";

import * as React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  TabsContent,
  TabsLine,
  TabsLineList,
  TabsLineTrigger,
} from "@iamthemcmaster/ui";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import { IconArrowBackUp } from "@tabler/icons-react";
import { parseInWorker } from "@/lib/convert-client";
import {
  getEditorState,
  setParseStatus,
  useEditorState,
  type ParseStatus,
} from "@/lib/editor-state";
import { applyBlockSwap, undoLastSwap } from "@/lib/editor-state-edits";
import type { ParsedSchematicPaletteEntry } from "@/lib/convert";
import {
  BlockStatePicker,
  type BlockStatePickerResult,
  type BlockStatePickerSource,
} from "@/components/block-state-picker";
import { ExportPanel } from "@/components/export-panel";
import { MaterialList } from "@/components/material-list";
import { ThreeDPreview } from "@/components/three-d-preview";
import { VersionMappingPanel } from "@/components/version-mapping-panel";

const NARROW_VIEWPORT_QUERY = "(max-width: 899.98px)";
const GENERIC_PARSE_ERROR =
  "Something went wrong while loading the schematic. Please try again.";

function useIsNarrowViewport(): boolean {
  const subscribe = React.useCallback((callback: () => void) => {
    if (typeof window === "undefined") return () => {};
    const mql = window.matchMedia(NARROW_VIEWPORT_QUERY);
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  }, []);

  const getSnapshot = React.useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
  }, []);

  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function PanelSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading schematic"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        minHeight: 80,
      }}
    >
      <div
        style={{
          height: 12,
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated)",
          width: "60%",
          opacity: 0.6,
        }}
      />
      <div
        style={{
          height: 12,
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated)",
          width: "85%",
          opacity: 0.5,
        }}
      />
      <div
        style={{
          height: 12,
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated)",
          width: "40%",
          opacity: 0.45,
        }}
      />
      <span
        style={{
          marginTop: "var(--space-2)",
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
        }}
      >
        Loading schematic…
      </span>
    </div>
  );
}

function PanelCard({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Card
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <CardContent
        style={{
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          flex: 1,
          minHeight: 0,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--text-secondary)",
          }}
        >
          {title}
        </h2>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            color: "var(--text-tertiary)",
            fontSize: "var(--text-sm)",
          }}
        >
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

const UNAVAILABLE_LABEL = "Unavailable — see error above.";

function previewBody(parseStatus: ParseStatus): React.ReactNode {
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function materialListBody(
  parseStatus: ParseStatus,
  onRequestSwap: (entry: ParsedSchematicPaletteEntry) => void,
): React.ReactNode {
  if (parseStatus.status === "ready") {
    return (
      <MaterialList
        palette={parseStatus.schematic.palette}
        onRequestSwap={onRequestSwap}
      />
    );
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function versionMappingBody(parseStatus: ParseStatus): React.ReactNode {
  if (parseStatus.status === "ready") {
    return <VersionMappingPanel schematic={parseStatus.schematic} />;
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function exportBody(
  parseStatus: ParseStatus,
  inputFilename: string | null,
): React.ReactNode {
  if (parseStatus.status === "ready") {
    return (
      <ExportPanel
        schematic={parseStatus.schematic}
        inputFilename={inputFilename ?? "schematic"}
      />
    );
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function EditorShell({
  parseStatus,
  onRequestSwap,
  canUndoSwap,
  onUndoSwap,
  inputFilename,
  isNarrow,
}: {
  parseStatus: ParseStatus;
  onRequestSwap: (entry: ParsedSchematicPaletteEntry) => void;
  canUndoSwap: boolean;
  onUndoSwap: () => void;
  inputFilename: string | null;
  isNarrow: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gap: "var(--space-4)",
        padding: "var(--space-4)",
        gridTemplateColumns: isNarrow
          ? "1fr"
          : "minmax(0, 2fr) minmax(280px, 1fr)",
        gridTemplateRows: isNarrow
          ? "minmax(320px, 60vh) minmax(0, 1fr)"
          : "1fr",
        overflow: "hidden",
      }}
    >
      <PanelCard title="3D Preview">
        {parseStatus.status === "ready" ? (
          <div
            style={{
              flex: 1,
              minHeight: 200,
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              background: "var(--bg-page)",
            }}
          >
            <ThreeDPreview projection={parseStatus.schematic} />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              minHeight: 200,
              padding: "var(--space-4)",
            }}
          >
            {previewBody(parseStatus)}
          </div>
        )}
      </PanelCard>

      <RightTabs
        parseStatus={parseStatus}
        onRequestSwap={onRequestSwap}
        canUndoSwap={canUndoSwap}
        onUndoSwap={onUndoSwap}
        inputFilename={inputFilename}
      />
    </div>
  );
}

type RightTabId = "materials" | "version" | "export";

function RightTabs({
  parseStatus,
  onRequestSwap,
  canUndoSwap,
  onUndoSwap,
  inputFilename,
}: {
  parseStatus: ParseStatus;
  onRequestSwap: (entry: ParsedSchematicPaletteEntry) => void;
  canUndoSwap: boolean;
  onUndoSwap: () => void;
  inputFilename: string | null;
}) {
  // forceMount on each TabsContent keeps internal state (search/sort,
  // selected target version + per-version decisions, in-flight export) alive
  // when the user flips between tabs. Visibility is driven by an inline
  // display toggle keyed off `activeTab` so the active panel can still
  // participate in flex layout.
  const [activeTab, setActiveTab] = React.useState<RightTabId>("materials");

  return (
    <Card
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <CardContent
        style={{
          padding: "var(--space-4)",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TabsLine
          value={activeTab}
          onValueChange={(next) => setActiveTab(next as RightTabId)}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TabsLineList>
            <TabsLineTrigger value="materials">Material List</TabsLineTrigger>
            <TabsLineTrigger value="version">Version Mapping</TabsLineTrigger>
            <TabsLineTrigger value="export">Export</TabsLineTrigger>
          </TabsLineList>
          <TabsContent
            value="materials"
            forceMount
            style={{
              flex: 1,
              minHeight: 0,
              display: activeTab === "materials" ? "flex" : "none",
              flexDirection: "column",
              gap: "var(--space-2)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
            }}
          >
            {parseStatus.status === "ready" ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginBottom: "calc(-1 * var(--space-1))",
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onUndoSwap}
                  disabled={!canUndoSwap}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    fontSize: "var(--text-xs)",
                  }}
                >
                  <IconArrowBackUp size={14} aria-hidden="true" />
                  Undo last swap
                </Button>
              </div>
            ) : null}
            {materialListBody(parseStatus, onRequestSwap)}
          </TabsContent>
          <TabsContent
            value="version"
            forceMount
            style={{
              flex: 1,
              minHeight: 0,
              display: activeTab === "version" ? "flex" : "none",
              flexDirection: "column",
              gap: "var(--space-2)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
            }}
          >
            {versionMappingBody(parseStatus)}
          </TabsContent>
          <TabsContent
            value="export"
            forceMount
            style={{
              flex: 1,
              minHeight: 0,
              display: activeTab === "export" ? "flex" : "none",
              flexDirection: "column",
              gap: "var(--space-2)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
            }}
          >
            {exportBody(parseStatus, inputFilename)}
          </TabsContent>
        </TabsLine>
      </CardContent>
    </Card>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        borderBottom: "1px solid var(--color-error)",
        background: "color-mix(in srgb, var(--color-error) 10%, transparent)",
        color: "var(--color-error)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.4,
      }}
    >
      <IconAlertCircle
        size={18}
        aria-hidden
        style={{ flexShrink: 0, marginTop: 2 }}
      />
      <span style={{ flex: 1 }}>{message}</span>
      <Button asChild variant="secondary" size="sm">
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <IconArrowLeft size={14} aria-hidden="true" />
          Back to Quick Convert
        </Link>
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6) var(--space-4)",
      }}
    >
      <Card style={{ maxWidth: 480, width: "100%" }}>
        <CardContent
          style={{
            padding: "var(--space-6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-4)",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            No file loaded
          </h1>
          <p
            style={{
              margin: 0,
              color: "var(--text-secondary)",
              fontSize: "var(--text-sm)",
            }}
          >
            Return to Quick Convert to choose a schematic.
          </p>
          <Button asChild variant="primary" size="md">
            <Link href="/">Go to Quick Convert</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdvancedPage() {
  const { stagedFile, parseStatus, lastSwapSnapshot } = useEditorState();
  const stagedFilename = stagedFile?.filename ?? null;
  const hasStagedFile = stagedFile !== null;
  const isNarrow = useIsNarrowViewport();

  const [pickerSource, setPickerSource] =
    React.useState<BlockStatePickerSource | null>(null);

  const handleRequestSwap = React.useCallback(
    (entry: ParsedSchematicPaletteEntry) => {
      setPickerSource({
        blockState: entry.blockState,
        blockId: entry.blockId,
        properties: entry.properties,
      });
    },
    [],
  );

  const handleConfirmSwap = React.useCallback(
    (target: BlockStatePickerResult) => {
      if (pickerSource) {
        applyBlockSwap(pickerSource.blockState, target);
      }
      setPickerSource(null);
    },
    [pickerSource],
  );

  const handleCancelSwap = React.useCallback(() => {
    setPickerSource(null);
  }, []);

  const handleUndoSwap = React.useCallback(() => {
    undoLastSwap();
  }, []);

  // Kick off the worker parse when we have staged bytes and no parse has run
  // yet for them (parseStatus reset to idle by setStagedFile). Copy the bytes
  // before transferring so the store's view stays intact for downstream uses
  // (export later, browser back to `/`, etc.).
  //
  // We don't use a `cancelled` flag — under React strict mode the effect
  // mount/unmount/remount sequence would cancel the only in-flight parse and
  // leave the store stuck on "parsing". Instead we check store identity at
  // write time: if `stagedFile` no longer matches the bytes we parsed, drop
  // the result on the floor (a fresh effect will re-parse the new file).
  React.useEffect(() => {
    if (!stagedFile) return;
    if (parseStatus.status !== "idle") return;

    const targetStaged = stagedFile;
    setParseStatus({ status: "parsing" });

    const bytesCopy = new Uint8Array(stagedFile.bytes);

    void (async () => {
      try {
        const result = await parseInWorker(bytesCopy);
        if (getEditorState().stagedFile !== targetStaged) return;
        if (result.ok) {
          setParseStatus({ status: "ready", schematic: result.schematic });
        } else {
          setParseStatus({ status: "error", error: result.error });
        }
      } catch (err) {
        if (getEditorState().stagedFile !== targetStaged) return;
        const message =
          err instanceof Error ? err.message : GENERIC_PARSE_ERROR;
        setParseStatus({ status: "error", error: message });
      }
    })();
  }, [stagedFile, parseStatus.status]);

  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-page)",
          flexShrink: 0,
        }}
      >
        <Button asChild variant="ghost" size="sm">
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <IconArrowLeft size={14} aria-hidden="true" />
            Back to Quick Convert
          </Link>
        </Button>
        <div
          style={{
            width: 1,
            height: 20,
            background: "var(--border-subtle)",
          }}
          aria-hidden="true"
        />
        <span
          style={{
            fontSize: "var(--text-sm)",
            color: hasStagedFile
              ? "var(--text-primary)"
              : "var(--text-tertiary)",
            fontWeight: hasStagedFile ? 500 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={stagedFilename ?? undefined}
        >
          {stagedFilename ?? "No file loaded"}
        </span>
      </header>

      {parseStatus.status === "error" ? (
        <ErrorBanner message={parseStatus.error} />
      ) : null}

      {hasStagedFile ? (
        <EditorShell
          parseStatus={parseStatus}
          onRequestSwap={handleRequestSwap}
          canUndoSwap={lastSwapSnapshot !== null}
          onUndoSwap={handleUndoSwap}
          inputFilename={stagedFilename}
          isNarrow={isNarrow}
        />
      ) : (
        <EmptyState />
      )}

      {pickerSource !== null ? (
        <BlockStatePicker
          open
          source={pickerSource}
          onCancel={handleCancelSwap}
          onConfirm={handleConfirmSwap}
        />
      ) : null}
    </main>
  );
}
