"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, CardContent } from "@iamthemcmaster/ui";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import { parseInWorker } from "@/lib/convert-client";
import {
  getEditorState,
  setParseStatus,
  useEditorState,
  type ParseStatus,
} from "@/lib/editor-state";

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
  flex,
}: {
  title: string;
  children?: React.ReactNode;
  flex?: number;
}) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", flex }}>
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
  if (parseStatus.status === "ready") return "Preview will render here.";
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function materialListBody(parseStatus: ParseStatus): React.ReactNode {
  if (parseStatus.status === "ready") {
    return `${parseStatus.schematic.palette.length} unique block states · ${parseStatus.schematic.totalBlocks.toLocaleString()} blocks`;
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function versionMappingBody(parseStatus: ParseStatus): React.ReactNode {
  if (parseStatus.status === "ready") {
    const v = parseStatus.schematic.minecraftVersion;
    return `Source version: ${v.versionNumber.join(".")} (data ${v.dataVersion})`;
  }
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function exportBody(parseStatus: ParseStatus): React.ReactNode {
  if (parseStatus.status === "ready") return "Output format and download go here.";
  if (parseStatus.status === "error") return UNAVAILABLE_LABEL;
  return <PanelSkeleton />;
}

function EditorShell({ parseStatus }: { parseStatus: ParseStatus }) {
  const isNarrow = useIsNarrowViewport();

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gap: "var(--space-4)",
        padding: "var(--space-4)",
        gridTemplateColumns: isNarrow ? "1fr" : "minmax(0, 2fr) minmax(280px, 1fr)",
        gridTemplateRows: isNarrow ? "minmax(320px, 60vh) auto" : "1fr",
      }}
    >
      <PanelCard title="3D Preview">
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
      </PanelCard>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          minHeight: 0,
        }}
      >
        <PanelCard title="Material List" flex={1}>
          {materialListBody(parseStatus)}
        </PanelCard>
        <PanelCard title="Version Mapping" flex={1}>
          {versionMappingBody(parseStatus)}
        </PanelCard>
        <PanelCard title="Export">{exportBody(parseStatus)}</PanelCard>
      </div>
    </div>
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
  const { stagedFile, parseStatus } = useEditorState();
  const stagedFilename = stagedFile?.filename ?? null;
  const hasStagedFile = stagedFile !== null;

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
        const message = err instanceof Error ? err.message : GENERIC_PARSE_ERROR;
        setParseStatus({ status: "error", error: message });
      }
    })();
  }, [stagedFile, parseStatus.status]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
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
            color: hasStagedFile ? "var(--text-primary)" : "var(--text-tertiary)",
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

      {hasStagedFile ? <EditorShell parseStatus={parseStatus} /> : <EmptyState />}
    </main>
  );
}
