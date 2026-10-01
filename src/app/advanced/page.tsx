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
import {
  applyBlockSwap,
  applyCamoSwap,
  undoLastSwap,
} from "@/lib/editor-state-edits";
import type {
  ParsedCamoMaterial,
  ParsedSchematicPaletteEntry,
} from "@/lib/convert";
import { knownVersionIdFor } from "@/lib/advanced/effective-mod-version";
import {
  BlockStatePicker,
  type BlockStatePickerResult,
  type BlockStatePickerSource,
} from "@/components/block-state-picker";
import { ExportPanel } from "@/components/export-panel";
import { MaterialList, type CamoSwapRequest } from "@/components/material-list";
import {
  ModProjectPicker,
  type ModProjectPickerRequest,
} from "@/components/mod-project-picker";
import { ModsPanel } from "@/components/mods-panel";
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

// Removes a camo from the slots under one palette entry; "Undo last swap"
// reverts it like any camo swap.
function removeCamo(
  parent: ParsedSchematicPaletteEntry,
  material: ParsedCamoMaterial,
): void {
  applyCamoSwap(material, null, {
    kind: "parent",
    parentBlockState: parent.blockState,
  });
}

function materialListBody(
  parseStatus: ParseStatus,
  onRequestSwap: (entry: ParsedSchematicPaletteEntry) => void,
  onRequestCamoSwap: (request: CamoSwapRequest) => void,
  onMapNamespace: (namespace: string) => void,
): React.ReactNode {
  if (parseStatus.status === "ready") {
    return (
      <MaterialList
        palette={parseStatus.schematic.palette}
        onRequestSwap={onRequestSwap}
        onRequestCamoSwap={onRequestCamoSwap}
        onRemoveCamo={removeCamo}
        onSearchMod={onMapNamespace}
      />
    );
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function versionMappingBody(
  parseStatus: ParseStatus,
  onRequestProjectPicker: (request: ModProjectPickerRequest) => void,
): React.ReactNode {
  if (parseStatus.status === "ready") {
    return (
      <VersionMappingPanel
        schematic={parseStatus.schematic}
        onRequestProjectPicker={onRequestProjectPicker}
      />
    );
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function modsBody(
  parseStatus: ParseStatus,
  onMapNamespace: (namespace: string) => void,
): React.ReactNode {
  if (parseStatus.status === "ready") {
    return (
      <ModsPanel
        schematic={parseStatus.schematic}
        onMapNamespace={onMapNamespace}
      />
    );
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function exportBody(
  parseStatus: ParseStatus,
  inputFilename: string | null,
  onGoToVersionMapping: () => void,
): React.ReactNode {
  if (parseStatus.status === "ready") {
    return (
      <ExportPanel
        schematic={parseStatus.schematic}
        inputFilename={inputFilename ?? "schematic"}
        onGoToVersionMapping={onGoToVersionMapping}
      />
    );
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function EditorShell({
  parseStatus,
  onRequestSwap,
  onRequestCamoSwap,
  canUndoSwap,
  onUndoSwap,
  inputFilename,
  isNarrow,
}: {
  parseStatus: ParseStatus;
  onRequestSwap: (entry: ParsedSchematicPaletteEntry) => void;
  onRequestCamoSwap: (request: CamoSwapRequest) => void;
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
        onRequestCamoSwap={onRequestCamoSwap}
        canUndoSwap={canUndoSwap}
        onUndoSwap={onUndoSwap}
        inputFilename={inputFilename}
      />
    </div>
  );
}

type RightTabId = "materials" | "version" | "mods" | "export";

function RightTabs({
  parseStatus,
  onRequestSwap,
  onRequestCamoSwap,
  canUndoSwap,
  onUndoSwap,
  inputFilename,
}: {
  parseStatus: ParseStatus;
  onRequestSwap: (entry: ParsedSchematicPaletteEntry) => void;
  onRequestCamoSwap: (request: CamoSwapRequest) => void;
  canUndoSwap: boolean;
  onUndoSwap: () => void;
  inputFilename: string | null;
}) {
  // forceMount on each TabsContent keeps internal state (search/sort,
  // selected target version + per-version decisions, mod search results,
  // in-flight export) alive when the user flips between tabs. Visibility is
  // driven by an inline display toggle keyed off `activeTab` so the active
  // panel can still participate in flex layout.
  const [activeTab, setActiveTab] = React.useState<RightTabId>("materials");
  // The Mods panel searches CurseForge on mount, so defer mounting it until
  // the tab is first opened; after that it stays mounted like the others.
  const [modsTabOpened, setModsTabOpened] = React.useState(false);
  if (activeTab === "mods" && !modsTabOpened) setModsTabOpened(true);
  // "Search CurseForge" (Material List) and "Map…" (Mods tab) open the shared
  // project picker for a namespace. Picking a project maps it and starts the
  // load; we then show the Mods tab, where its progress appears. The Version
  // Mapping tab opens the same picker (map or replace) and shows progress in
  // its own Mods section, so its requests don't switch tabs.
  const [pickerRequest, setPickerRequest] = React.useState<{
    request: ModProjectPickerRequest;
    showModsTab: boolean;
  } | null>(null);
  const handleMapNamespace = React.useCallback((namespace: string) => {
    setPickerRequest({
      request: { mode: "map", namespace },
      showModsTab: true,
    });
  }, []);
  const handleRequestProjectPicker = React.useCallback(
    (request: ModProjectPickerRequest) => {
      setPickerRequest({ request, showModsTab: false });
    },
    [],
  );
  const sourceVersionId =
    parseStatus.status === "ready"
      ? knownVersionIdFor(parseStatus.schematic.minecraftVersion)
      : null;
  const handleGoToVersionMapping = React.useCallback(() => {
    setActiveTab("version");
  }, []);

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
            <TabsLineTrigger value="mods">Mods</TabsLineTrigger>
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
            {materialListBody(
              parseStatus,
              onRequestSwap,
              onRequestCamoSwap,
              handleMapNamespace,
            )}
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
            {versionMappingBody(parseStatus, handleRequestProjectPicker)}
          </TabsContent>
          <TabsContent
            value="mods"
            forceMount
            style={{
              flex: 1,
              minHeight: 0,
              display: activeTab === "mods" ? "flex" : "none",
              flexDirection: "column",
              gap: "var(--space-2)",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
            }}
          >
            {modsTabOpened ? modsBody(parseStatus, handleMapNamespace) : null}
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
            {exportBody(parseStatus, inputFilename, handleGoToVersionMapping)}
          </TabsContent>
        </TabsLine>
      </CardContent>
      {pickerRequest !== null && sourceVersionId !== null ? (
        pickerRequest.request.mode === "map" ? (
          <ModProjectPicker
            key={`map:${pickerRequest.request.namespace}`}
            open
            mode="map"
            namespace={pickerRequest.request.namespace}
            sourceVersion={sourceVersionId}
            gameVersion={sourceVersionId}
            onSelect={() => {
              if (pickerRequest.showModsTab) setActiveTab("mods");
              setPickerRequest(null);
            }}
            onCancel={() => setPickerRequest(null)}
          />
        ) : (
          <ModProjectPicker
            key={`replace:${pickerRequest.request.namespace}`}
            open
            mode="replace"
            namespace={pickerRequest.request.namespace}
            gameVersion={pickerRequest.request.gameVersion}
            onSelect={(mod) => {
              if (pickerRequest.request.mode === "replace") {
                pickerRequest.request.onSelect(mod);
              }
              setPickerRequest(null);
            }}
            onCancel={() => setPickerRequest(null)}
          />
        )
      ) : null}
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

// The picker's source card for a camo swap: the material, or the empty slots.
function camoPickerSource({ material }: CamoSwapRequest) {
  return material.kind === "empty"
    ? { blockState: "Empty camo slots", blockId: "No camo", properties: {} }
    : material;
}

// Picker copy for a camo swap, naming its scope.
function camoPickerCopy({ parent, material, scope }: CamoSwapRequest) {
  if (material.kind === "empty") {
    return scope === "all"
      ? {
          title: "Set camo everywhere",
          description:
            "Put a camo in every empty camo slot of the schematic, under any block. Type the block identifier to use.",
          confirmLabel: "Set all",
        }
      : {
          title: "Set camo",
          description: `Put a camo in the empty camo slots of ${parent.blockState}. Type the block identifier to use.`,
          confirmLabel: "Set camo",
        };
  }
  return scope === "all"
    ? {
        title: "Replace camo everywhere",
        description: `Replace ${material.blockState} in every camo slot of the schematic, under any block. Type the block identifier to use instead.`,
        confirmLabel: "Replace all",
      }
    : {
        title: "Swap camo",
        description: `Replace ${material.blockState} in the camo slots of ${parent.blockState} only. Type the block identifier to use instead.`,
        confirmLabel: "Confirm swap",
      };
}

export default function AdvancedPage() {
  const { stagedFile, parseStatus, lastSwapSnapshot } = useEditorState();
  const stagedFilename = stagedFile?.filename ?? null;
  const hasStagedFile = stagedFile !== null;
  const isNarrow = useIsNarrowViewport();

  // What the open picker swaps: a palette entry, or a camo material under
  // one parent ("Swap…") or everywhere ("Replace all").
  const [picker, setPicker] = React.useState<
    | { kind: "block"; source: BlockStatePickerSource }
    | { kind: "camo"; request: CamoSwapRequest }
    | null
  >(null);

  const handleRequestSwap = React.useCallback(
    (entry: ParsedSchematicPaletteEntry) => {
      setPicker({
        kind: "block",
        source: {
          blockState: entry.blockState,
          blockId: entry.blockId,
          properties: entry.properties,
        },
      });
    },
    [],
  );

  const handleRequestCamoSwap = React.useCallback(
    (request: CamoSwapRequest) => {
      setPicker({ kind: "camo", request });
    },
    [],
  );

  const handleConfirmSwap = React.useCallback(
    (target: BlockStatePickerResult) => {
      if (picker?.kind === "block") {
        applyBlockSwap(picker.source.blockState, target);
      } else if (picker?.kind === "camo") {
        const { parent, material, scope } = picker.request;
        applyCamoSwap(
          material,
          target,
          scope === "all"
            ? { kind: "all" }
            : { kind: "parent", parentBlockState: parent.blockState },
        );
      }
      setPicker(null);
    },
    [picker],
  );

  const handleCancelSwap = React.useCallback(() => {
    setPicker(null);
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
          onRequestCamoSwap={handleRequestCamoSwap}
          canUndoSwap={lastSwapSnapshot !== null}
          onUndoSwap={handleUndoSwap}
          inputFilename={stagedFilename}
          isNarrow={isNarrow}
        />
      ) : (
        <EmptyState />
      )}

      {picker?.kind === "block" ? (
        <BlockStatePicker
          open
          source={picker.source}
          onCancel={handleCancelSwap}
          onConfirm={handleConfirmSwap}
        />
      ) : null}
      {picker?.kind === "camo" ? (
        <BlockStatePicker
          open
          source={camoPickerSource(picker.request)}
          onCancel={handleCancelSwap}
          onConfirm={handleConfirmSwap}
          {...camoPickerCopy(picker.request)}
        />
      ) : null}
    </main>
  );
}
