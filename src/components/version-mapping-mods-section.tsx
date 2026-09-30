"use client";

// Mods section of the Version Mapping tab (SCHEM-64): one row per mod
// namespace in the schematic with its project mapping, target-version file
// status and replace / keep choice. State lives in `VersionMappingPanel`;
// this only renders rows and reports actions.

import * as React from "react";
import { Badge, Button } from "@iamthemcmaster/ui";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconCheck,
  IconLink,
  IconLoader2,
  IconPackage,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import type { ModLoader } from "@/lib/curseforge/types";
import type { ModNamespaceRow } from "@/lib/advanced/mod-namespace-status";
import {
  describeModLoadState,
  type ModLoadEntry,
  type ModLoadsSnapshot,
} from "@/lib/mods/load-mod";

const LOADER_LABELS: Record<ModLoader, string> = {
  forge: "Forge",
  neoforge: "NeoForge",
  fabric: "Fabric",
  quilt: "Quilt",
};

export interface ModsSectionActions {
  onMap: (namespace: string) => void;
  onReplace: (namespace: string) => void;
  onKeep: (namespace: string) => void;
  onClearChoice: (namespace: string) => void;
  onRetryTarget: (row: ModNamespaceRow) => void;
  onRetryReplacement: (row: ModNamespaceRow) => void;
}

export function VersionMappingModsSection({
  rows,
  loads,
  targetVersionId,
  actions,
}: {
  rows: readonly ModNamespaceRow[];
  loads: ModLoadsSnapshot;
  targetVersionId: string | null;
  actions: ModsSectionActions;
}) {
  if (rows.length === 0) return null;
  return (
    <section
      aria-label="Mods in this schematic"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Mods
      </h3>
      <div
        role="list"
        aria-label="Mod namespaces"
        style={{
          maxHeight: "40vh",
          overflowY: "auto",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-page)",
        }}
      >
        {rows.map((row) => (
          <ModRow
            key={row.namespace}
            row={row}
            loads={loads}
            targetVersionId={targetVersionId}
            actions={actions}
          />
        ))}
      </div>
    </section>
  );
}

function ModRow({
  row,
  loads,
  targetVersionId,
  actions,
}: {
  row: ModNamespaceRow;
  loads: ModLoadsSnapshot;
  targetVersionId: string | null;
  actions: ModsSectionActions;
}) {
  const { namespace, mapping } = row;
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
        boxShadow: row.needsDecision
          ? "inset 3px 0 0 var(--color-warning, var(--color-error))"
          : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          minWidth: 0,
        }}
      >
        <ProjectLogo logoUrl={mapping?.logoUrl ?? null} />
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
          title={namespace}
        >
          {namespace}
        </span>
        <span
          style={{
            color: "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={mapping?.modName}
        >
          {mapping !== null ? mapping.modName : null}
        </span>
        {mapping === null ? (
          <Badge variant="warning" size="sm" style={{ flexShrink: 0 }}>
            Unmapped
          </Badge>
        ) : null}
        <span
          style={{
            marginLeft: "auto",
            color: "var(--text-tertiary)",
            fontSize: "var(--text-xs)",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {row.blockStateCount.toLocaleString()} state
          {row.blockStateCount === 1 ? "" : "s"} ·{" "}
          {row.blockCount.toLocaleString()} block
          {row.blockCount === 1 ? "" : "s"}
        </span>
      </div>
      <RowStatus
        row={row}
        loads={loads}
        targetVersionId={targetVersionId}
        actions={actions}
      />
    </div>
  );
}

function RowStatus({
  row,
  loads,
  targetVersionId,
  actions,
}: {
  row: ModNamespaceRow;
  loads: ModLoadsSnapshot;
  targetVersionId: string | null;
  actions: ModsSectionActions;
}) {
  const { namespace, choice, replacement, target } = row;

  if (choice?.kind === "replace" && replacement !== null) {
    const newNamespace =
      replacement.status === "loaded" ? replacement.newNamespace : null;
    return (
      <>
        <StatusLine icon={<IconArrowsExchange size={14} aria-hidden="true" />}>
          <span
            style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
          >
            {namespace} → {newNamespace ?? "…"}
          </span>{" "}
          <span style={{ color: "var(--text-tertiary)" }}>
            ({choice.mod.name})
          </span>
        </StatusLine>
        {replacement.status === "loading" ? (
          <LoadProgress
            label={`Loading ${choice.mod.name} for ${replacement.gameVersion}`}
            entry={loads.get(replacement.loadKey)}
          />
        ) : replacement.status === "error" ? (
          <StatusLine tone="error">
            Couldn&apos;t load {choice.mod.name} for {replacement.gameVersion}:{" "}
            {replacement.message}
          </StatusLine>
        ) : null}
        <Actions>
          {replacement.status === "error" ? (
            <ActionButton
              icon={<IconRefresh size={14} aria-hidden="true" />}
              onClick={() => actions.onRetryReplacement(row)}
            >
              Retry
            </ActionButton>
          ) : null}
          <ActionButton
            icon={<IconArrowsExchange size={14} aria-hidden="true" />}
            onClick={() => actions.onReplace(namespace)}
          >
            Change
          </ActionButton>
          <ActionButton
            icon={<IconX size={14} aria-hidden="true" />}
            onClick={() => actions.onClearChoice(namespace)}
            ariaLabel={`Clear replacement for ${namespace}`}
          >
            Clear
          </ActionButton>
        </Actions>
      </>
    );
  }

  if (choice?.kind === "keep") {
    return (
      <>
        <StatusLine icon={<IconCheck size={14} aria-hidden="true" />}>
          Not replaced. Blocks are kept as they are.
        </StatusLine>
        <Actions>
          <ActionButton
            icon={<IconX size={14} aria-hidden="true" />}
            onClick={() => actions.onClearChoice(namespace)}
            ariaLabel={`Clear decision for ${namespace}`}
          >
            Clear
          </ActionButton>
        </Actions>
      </>
    );
  }

  const replaceButton = (
    <ActionButton
      icon={<IconArrowsExchange size={14} aria-hidden="true" />}
      onClick={() => actions.onReplace(namespace)}
    >
      Replace with another mod…
    </ActionButton>
  );

  if (row.mapping === null) {
    return (
      <>
        <StatusLine tone="muted">
          Not mapped to a CurseForge project.
        </StatusLine>
        <Actions>
          <ActionButton
            icon={<IconLink size={14} aria-hidden="true" />}
            onClick={() => actions.onMap(namespace)}
          >
            Map to CurseForge project…
          </ActionButton>
          {replaceButton}
        </Actions>
      </>
    );
  }

  if (target === null) {
    return (
      <>
        <StatusLine tone="muted">
          Mapped. Pick a target version to check for a file.
        </StatusLine>
        <Actions>{replaceButton}</Actions>
      </>
    );
  }

  switch (target.status) {
    case "resolving":
      return (
        <LoadProgress
          label={`Checking for a ${targetVersionId} file`}
          entry={undefined}
        />
      );
    case "loading":
      return (
        <>
          <StatusLine>
            {target.fileName}
            <LoaderNote
              loader={target.loader}
              fallback={target.loaderFallback}
            />
          </StatusLine>
          <LoadProgress
            label={`Loading the ${targetVersionId} file`}
            entry={loads.get(target.loadKey)}
          />
        </>
      );
    case "loaded":
      return (
        <StatusLine
          icon={
            <IconCheck
              size={14}
              aria-hidden="true"
              style={{ color: "var(--color-success, currentColor)" }}
            />
          }
        >
          {target.file.fileDisplayName}
          <LoaderNote loader={target.loader} fallback={target.loaderFallback} />
        </StatusLine>
      );
    case "unavailable":
    case "error":
      return (
        <>
          <StatusLine
            tone={target.status === "error" ? "error" : "warning"}
            icon={<IconAlertTriangle size={14} aria-hidden="true" />}
          >
            {target.status === "unavailable"
              ? `No file for ${targetVersionId}.`
              : target.retry === "resolve"
                ? `Couldn't check for a ${targetVersionId} file: ${target.message}`
                : `Couldn't load the ${targetVersionId} file: ${target.message}`}
          </StatusLine>
          <Actions>
            {target.status === "error" ? (
              <ActionButton
                icon={<IconRefresh size={14} aria-hidden="true" />}
                onClick={() => actions.onRetryTarget(row)}
              >
                Retry
              </ActionButton>
            ) : null}
            {replaceButton}
            <ActionButton
              icon={<IconX size={14} aria-hidden="true" />}
              onClick={() => actions.onKeep(namespace)}
            >
              Don&apos;t replace
            </ActionButton>
          </Actions>
        </>
      );
  }
}

function LoaderNote({
  loader,
  fallback,
}: {
  loader: ModLoader | null;
  fallback: boolean;
}) {
  if (!fallback) return null;
  return (
    <span style={{ color: "var(--text-tertiary)" }}>
      {" "}
      ({loader !== null ? `${LOADER_LABELS[loader]} only` : "other loader"})
    </span>
  );
}

function ProjectLogo({ logoUrl }: { logoUrl: string | null }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote CurseForge CDN thumbnail; not worth configuring next/image domains.
      <img
        src={logoUrl}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        style={{
          width: 20,
          height: 20,
          borderRadius: "var(--radius-sm)",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-subtle, var(--border-subtle))",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-tertiary)",
      }}
    >
      <IconPackage size={12} />
    </span>
  );
}

const TONE_COLORS = {
  default: "var(--text-secondary)",
  muted: "var(--text-tertiary)",
  warning: "var(--color-warning, var(--color-error))",
  error: "var(--color-error)",
} as const;

function StatusLine({
  children,
  icon,
  tone = "default",
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof TONE_COLORS;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-1)",
        color: TONE_COLORS[tone],
        fontSize: "var(--text-xs)",
        minWidth: 0,
      }}
    >
      {icon}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {children}
      </span>
    </div>
  );
}

function LoadProgress({
  label,
  entry,
}: {
  label: string;
  entry: ModLoadEntry | undefined;
}) {
  return (
    <span
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: "var(--text-secondary)",
        fontSize: "var(--text-xs)",
      }}
    >
      <IconLoader2
        size={14}
        aria-hidden="true"
        style={{ animation: "schematiclab-spin 0.9s linear infinite" }}
      />
      {label}
      {entry !== undefined && entry.state.phase !== "error"
        ? `: ${describeModLoadState(entry.state)}`
        : "…"}
    </span>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-2)",
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        fontSize: "var(--text-xs)",
      }}
    >
      {icon}
      {children}
    </Button>
  );
}
