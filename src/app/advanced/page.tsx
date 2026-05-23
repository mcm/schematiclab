"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, CardContent } from "@iamthemcmaster/ui";
import { IconArrowLeft } from "@tabler/icons-react";

// US-003 will replace this with reads from the shared editor-state store.
// For now there is no in-memory hand-off, so the page always renders the
// empty state.
const STAGED_FILENAME: string | null = null;

const NARROW_VIEWPORT_QUERY = "(max-width: 899.98px)";

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

function EditorShell() {
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
          }}
        >
          Preview will render here.
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
          Palette and counts go here.
        </PanelCard>
        <PanelCard title="Version Mapping" flex={1}>
          Target version and overrides go here.
        </PanelCard>
        <PanelCard title="Export">
          Output format and download go here.
        </PanelCard>
      </div>
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
  const stagedFilename = STAGED_FILENAME;
  const hasStagedFile = stagedFilename !== null;

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

      {hasStagedFile ? <EditorShell /> : <EmptyState />}
    </main>
  );
}
