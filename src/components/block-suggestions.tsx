"use client";

import * as React from "react";
import { Button } from "@iamthemcmaster/ui";
import {
  sourceAppearance,
  suggestBlocks,
  suggestionCandidates,
  type SuggestionCandidate,
} from "@/lib/advanced/suggest-blocks";
import { useVanillaBlockColors } from "@/lib/advanced/vanilla-block-colors";
import { ensureModAppearances } from "@/lib/mods/appearance-backfill";
import { useLoadedMods } from "@/lib/mods/registry";
import { vanillaBlocksForVersion } from "@/lib/schemlib/data/vanilla-blocks";
import type { MinecraftVersion } from "@/lib/schemlib/schematic-formats/version-mapping";

/** Where suggestions come from: the version they must exist in, and mods. */
export interface BlockSuggestionContext {
  /** The target version, else the source version. */
  version: MinecraftVersion;
  /** `KNOWN_VERSIONS` key of `version` (loaded mod files are keyed by it). */
  versionId: string;
  sourceVersionId: string;
  /** CurseForge mods that are mapped or chosen as replacements. */
  modIds: ReadonlySet<number>;
}

export function BlockSuggestions({
  sourceBlockId,
  context,
  onChoose,
  chooseLabel = "Use",
}: {
  sourceBlockId: string;
  context: BlockSuggestionContext;
  onChoose: (candidate: SuggestionCandidate) => void;
  chooseLabel?: string;
}) {
  const vanillaColors = useVanillaBlockColors();
  const loadedMods = useLoadedMods();
  const { version, versionId, sourceVersionId, modIds } = context;
  const sourceNamespace = sourceBlockId.slice(0, sourceBlockId.indexOf(":"));

  // Files loaded before appearances existed get them computed in the
  // background; the registry update re-ranks the list.
  React.useEffect(() => {
    for (const file of loadedMods) {
      if (file.appearancesComputed === true) continue;
      const candidate =
        file.gameVersion === versionId && modIds.has(file.modId);
      if (candidate || file.namespaces.includes(sourceNamespace)) {
        void ensureModAppearances(file.key);
      }
    }
  }, [loadedMods, versionId, modIds, sourceNamespace]);

  const candidates = React.useMemo(
    () =>
      suggestionCandidates({
        vanillaBlocks: vanillaBlocksForVersion(version),
        vanillaColors,
        loadedMods,
        modIds,
        versionId,
      }),
    [version, versionId, vanillaColors, loadedMods, modIds],
  );

  const suggestions = React.useMemo(
    () =>
      suggestBlocks({
        source: {
          id: sourceBlockId,
          appearance: sourceAppearance(
            sourceBlockId,
            vanillaColors,
            loadedMods,
            sourceVersionId,
          ),
        },
        candidates,
      }),
    [sourceBlockId, vanillaColors, loadedMods, sourceVersionId, candidates],
  );

  if (vanillaColors === null) {
    return (
      <div
        role="status"
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-xs)",
          fontStyle: "italic",
        }}
      >
        Finding similar blocks…
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-xs)",
          fontStyle: "italic",
        }}
      >
        No suggestions for {versionId}.
      </div>
    );
  }

  return (
    <ul
      aria-label={`Suggested replacements for ${sourceBlockId}`}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-page)",
      }}
    >
      {suggestions.map((candidate) => (
        <li
          key={candidate.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-1) var(--space-2)",
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: "var(--text-xs)",
          }}
        >
          <ColorSwatch candidate={candidate} />
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              title={candidate.id}
              style={{
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {candidate.id}
            </span>
            <span
              style={{
                color: "var(--text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {candidate.displayName} · {candidate.sourceLabel}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChoose(candidate)}
            aria-label={`${chooseLabel} ${candidate.id}`}
            style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}
          >
            {chooseLabel}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function ColorSwatch({ candidate }: { candidate: SuggestionCandidate }) {
  const appearance = candidate.appearance;
  const [l, a, b] = appearance?.oklab ?? [0, 0, 0];
  return (
    <span
      aria-hidden="true"
      title={appearance ? undefined : "No colour data"}
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: appearance?.fullCube === false ? "50%" : 3,
        border: "1px solid var(--border-subtle)",
        background: appearance
          ? `oklab(${l} ${a} ${b})`
          : "repeating-linear-gradient(45deg, var(--bg-elevated) 0 4px, var(--bg-page) 4px 8px)",
      }}
    />
  );
}
