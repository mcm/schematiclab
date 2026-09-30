"use client";

import * as React from "react";
import {
  Badge,
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
  IconBulb,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import type { ParsedSchematicProjection } from "@/lib/convert";
import { translatePreviewInWorker } from "@/lib/convert-client";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";
import type {
  ProblematicEntry,
  ProblematicReason,
  VersionMappingPreview,
} from "@/lib/advanced/version-mapping-preview";
import type { VersionMappingOverrides } from "@/lib/advanced/edit";
import type { ModMappingContext } from "@/lib/advanced/mod-mapping";
import { useAdvancedTargetVersion } from "@/lib/advanced/target-version-state";
import { useEditorState } from "@/lib/editor-state";
import { useLoadedMods } from "@/lib/mods/registry";
import { useNamespaceMappings } from "@/lib/mods/mappings";
import {
  getModLoads,
  modLoadKey,
  startModLoad,
  useModLoads,
} from "@/lib/mods/load-mod";
import { detectSchematicNamespaces } from "@/lib/mods/namespaces";
import { loadedModKey } from "@/lib/mods/types";
import {
  preferredLoaderFor,
  resolveModFileForVersion,
  type ResolvedModFile,
} from "@/lib/curseforge/resolve-file";
import type { ModLoader } from "@/lib/curseforge/types";
import { knownVersionIdFor } from "@/lib/advanced/effective-mod-version";
import {
  applyReadiness,
  buildModMappingContext,
  choiceVersionKey,
  countModBlockers,
  describeModNamespaces,
  projectFromMapping,
  type ModChoice,
  type ModProject,
} from "@/lib/advanced/mod-namespace-status";
import type { ModProjectPickerRequest } from "./mod-project-picker";
import {
  VersionMappingModsSection,
  type ModsSectionActions,
} from "./version-mapping-mods-section";
import {
  applyVersionMapping as applyVersionMappingAction,
  undoLastTranslation,
} from "@/lib/editor-state-edits";
import {
  BlockStatePicker,
  type BlockStatePickerResult,
  type BlockStatePickerSource,
} from "./block-state-picker";
import {
  BlockSuggestions,
  type BlockSuggestionContext,
} from "./block-suggestions";
import type { SuggestionCandidate } from "@/lib/advanced/suggest-blocks";

const TARGET_VERSION_TRIGGER_ID = "advanced-target-version-trigger";

const VERSION_IDS: readonly string[] = Object.keys(KNOWN_VERSIONS);

interface VersionMappingPanelProps {
  schematic: ParsedSchematicProjection;
  /** Opens the editor's shared CurseForge project picker. */
  onRequestProjectPicker: (request: ModProjectPickerRequest) => void;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; targetVersionId: string | null }
  | {
      status: "ready";
      // Null when only mod mapping runs (no version change).
      targetVersionId: string | null;
      preview: VersionMappingPreview;
      // Inputs the preview was computed from, so a stale result can be
      // detected during render (see `previewState` below).
      schematic: ParsedSchematicProjection;
      mods: ModMappingContext;
    }
  | { status: "error"; targetVersionId: string | null; message: string };

// Per-row decision. A row is "resolved" once it has either an accepted-default
// or an override entry — see `allRowsResolved` below.
type Decision =
  | { kind: "accepted" }
  | { kind: "override"; target: BlockStatePickerResult };

const EMPTY_CHOICES: Readonly<Record<string, ModChoice>> = {};

export function VersionMappingPanel({
  schematic,
  onRequestProjectPicker,
}: VersionMappingPanelProps) {
  const { lastTranslationSnapshot } = useEditorState();
  const canUndoTranslation = lastTranslationSnapshot !== null;

  const [targetVersionId, setTargetVersionId] = useAdvancedTargetVersion();
  // Decisions and mod choices are keyed by target version id ("none" when no
  // target is selected).
  const versionKey = choiceVersionKey(targetVersionId);
  const sourceVersion = schematic.minecraftVersion;
  const sourceVersionId = knownVersionIdFor(sourceVersion);

  // --- Mods section -------------------------------------------------------
  const namespaces = React.useMemo(
    () => detectSchematicNamespaces(schematic.palette),
    [schematic],
  );
  const mappings = useNamespaceMappings();
  const loadedMods = useLoadedMods();
  const loads = useModLoads();
  // `loads` changes on every download tick; only failures feed the context,
  // so derive them through a string to keep their identity stable.
  const failedLoadsSignature = [...loads]
    .filter(([, entry]) => entry.state.phase === "error")
    .map(([key, entry]) =>
      entry.state.phase === "error" ? `${key}\u0000${entry.state.message}` : "",
    )
    .join("\u0001");
  const failedLoads = React.useMemo(() => {
    const failed = new Map<string, string>();
    if (failedLoadsSignature === "") return failed;
    for (const line of failedLoadsSignature.split("\u0001")) {
      const split = line.indexOf("\u0000");
      failed.set(line.slice(0, split), line.slice(split + 1));
    }
    return failed;
  }, [failedLoadsSignature]);
  // Target-file lookups, keyed by `loadedModKey(modId, targetVersionId)`.
  // An absent key is still resolving; errors are dropped on retry.
  const [resolutions, setResolutions] = React.useState<
    ReadonlyMap<string, ResolvedModFile>
  >(() => new Map());
  const resolvingRef = React.useRef(new Set<string>());
  // Replace / keep choices keyed by version key, then namespace. Reset with
  // the decisions when the schematic mutates.
  const [choicesByVersion, setChoicesByVersion] = React.useState<
    Record<string, Record<string, ModChoice>>
  >({});
  const choices = choicesByVersion[versionKey] ?? EMPTY_CHOICES;

  const modRows = React.useMemo(
    () =>
      describeModNamespaces({
        namespaces,
        mappings,
        loadedMods,
        failedLoads,
        resolutions,
        choices,
        targetVersionId,
        sourceVersionId,
      }),
    [
      namespaces,
      mappings,
      loadedMods,
      failedLoads,
      resolutions,
      choices,
      targetVersionId,
      sourceVersionId,
    ],
  );
  // Identity changes only when a row's mapping outcome does, which re-runs
  // the preview.
  const modContext = React.useMemo(
    () => buildModMappingContext(modRows, targetVersionId),
    [modRows, targetVersionId],
  );
  const hasReplacement = Object.values(choices).some(
    (choice) => choice.kind === "replace",
  );
  // "Suggest a block" candidates: blocks in the target (else source) version
  // from vanilla and from mapped or replacement mods. The mod ids go through
  // a string so the context only changes when that set does.
  const suggestionModIdsSignature = [
    ...new Set(
      modRows.flatMap((row) => [
        ...(row.mapping ? [row.mapping.modId] : []),
        ...(row.choice?.kind === "replace" ? [row.choice.mod.id] : []),
      ]),
    ),
  ]
    .sort((a, b) => a - b)
    .join(",");
  const suggestionContext = React.useMemo<BlockSuggestionContext>(
    () => ({
      version:
        (targetVersionId !== null && KNOWN_VERSIONS[targetVersionId]) ||
        sourceVersion,
      versionId: targetVersionId ?? sourceVersionId,
      sourceVersionId,
      modIds: new Set(
        suggestionModIdsSignature === ""
          ? []
          : suggestionModIdsSignature.split(",").map(Number),
      ),
    }),
    [
      targetVersionId,
      sourceVersion,
      sourceVersionId,
      suggestionModIdsSignature,
    ],
  );
  const { undecidedModCount, failedReplacementCount } =
    countModBlockers(modRows);
  // With no target version, only chosen replacements run.
  const previewWanted =
    targetVersionId !== null || Object.keys(modContext).length > 0;

  // Mapped mods whose source-version file is still loading (e.g. just mapped
  // via the picker). Their target isn't resolved until that file lands, so
  // the resolution can prefer its loader. A string keeps the identity stable
  // across download ticks; the effect below re-runs when a load finishes.
  const sourceLoadsInFlight = [
    ...new Set(
      modRows.flatMap((row) => {
        if (row.mapping === null) return [];
        const entry = loads.get(modLoadKey(row.mapping.modId, sourceVersionId));
        return entry !== undefined && entry.state.phase !== "error"
          ? [row.mapping.modId]
          : [];
      }),
    ),
  ]
    .sort((a, b) => a - b)
    .join(",");

  // Check each mapped mod for a target-version file it doesn't have loaded.
  React.useEffect(() => {
    if (targetVersionId === null) return;
    const waitingOnSource = new Set(
      sourceLoadsInFlight === ""
        ? []
        : sourceLoadsInFlight.split(",").map(Number),
    );
    for (const row of modRows) {
      if (row.mapping === null || row.target?.status !== "resolving") continue;
      const { modId } = row.mapping;
      if (waitingOnSource.has(modId)) continue;
      const key = loadedModKey(modId, targetVersionId);
      if (resolvingRef.current.has(key)) continue;
      resolvingRef.current.add(key);
      const preferredLoader = preferredLoaderFor(
        loadedMods,
        modId,
        sourceVersionId,
      );
      void (async () => {
        const result = await resolveModFileForVersion({
          modId,
          gameVersion: targetVersionId,
          preferredLoader,
        });
        resolvingRef.current.delete(key);
        setResolutions((prev) => new Map(prev).set(key, result));
      })();
    }
  }, [
    modRows,
    loadedMods,
    targetVersionId,
    sourceVersionId,
    sourceLoadsInFlight,
  ]);

  // Start loading target-version files and replacement files. A failed load
  // shows as an error row (not "loading"), so it's retried only by the user.
  React.useEffect(() => {
    const start = (
      key: string,
      mod: ModProject,
      gameVersion: string,
      loader: ModLoader | null,
    ) => {
      if (getModLoads().has(key)) return;
      void startModLoad({ mod, gameVersion, loader });
    };
    for (const row of modRows) {
      if (row.mapping !== null && row.target?.status === "loading") {
        start(
          row.target.loadKey,
          projectFromMapping(row.mapping),
          targetVersionId ?? sourceVersionId,
          row.target.loader,
        );
      }
      if (
        row.choice?.kind === "replace" &&
        row.replacement?.status === "loading"
      ) {
        start(
          row.replacement.loadKey,
          row.choice.mod,
          row.replacement.gameVersion,
          null,
        );
      }
    }
  }, [modRows, targetVersionId, sourceVersionId]);

  const setChoice = React.useCallback(
    (key: string, namespace: string, choice: ModChoice | null) => {
      setChoicesByVersion((prev) => {
        const current = prev[key] ?? {};
        if (choice === null) {
          if (!(namespace in current)) return prev;
          const next = { ...current };
          delete next[namespace];
          return { ...prev, [key]: next };
        }
        return { ...prev, [key]: { ...current, [namespace]: choice } };
      });
    },
    [],
  );

  const modActions = React.useMemo<ModsSectionActions>(
    () => ({
      onMap: (namespace) => {
        onRequestProjectPicker({ mode: "map", namespace });
      },
      onReplace: (namespace) => {
        // The choice lands under the version that was selected when the
        // picker opened.
        const key = versionKey;
        onRequestProjectPicker({
          mode: "replace",
          namespace,
          gameVersion: targetVersionId ?? sourceVersionId,
          onSelect: (mod) => {
            setChoice(key, namespace, {
              kind: "replace",
              mod: {
                id: mod.id,
                name: mod.name,
                slug: mod.slug,
                logoThumbnailUrl: mod.logoThumbnailUrl,
              },
            });
          },
        });
      },
      onKeep: (namespace) => {
        setChoice(versionKey, namespace, { kind: "keep" });
      },
      onClearChoice: (namespace) => {
        setChoice(versionKey, namespace, null);
      },
      onRetryTarget: (row) => {
        const target = row.target;
        if (row.mapping === null || target?.status !== "error") return;
        if (target.retry === "resolve") {
          if (targetVersionId === null) return;
          const key = loadedModKey(row.mapping.modId, targetVersionId);
          setResolutions((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
          return;
        }
        if (targetVersionId === null) return;
        const resolution = resolutions.get(
          loadedModKey(row.mapping.modId, targetVersionId),
        );
        void startModLoad({
          mod: projectFromMapping(row.mapping),
          gameVersion: targetVersionId,
          loader: resolution?.status === "available" ? resolution.loader : null,
        });
      },
      onRetryReplacement: (row) => {
        if (
          row.choice?.kind !== "replace" ||
          row.replacement?.status !== "error"
        ) {
          return;
        }
        void startModLoad({
          mod: row.choice.mod,
          gameVersion: row.replacement.gameVersion,
          loader: null,
        });
      },
    }),
    [
      onRequestProjectPicker,
      versionKey,
      targetVersionId,
      sourceVersionId,
      setChoice,
      resolutions,
    ],
  );

  // --- Preview ------------------------------------------------------------
  const [storedPreviewState, setPreviewState] = React.useState<PreviewState>({
    status: "idle",
  });
  // The effect below only marks a preview loading after a microtask, so a
  // `ready` result can briefly outlive its inputs (e.g. a mod unloads). Treat
  // any mismatch as loading so Apply never uses a preview computed against a
  // different schematic, target, or mod mapping.
  const previewState = React.useMemo<PreviewState>(() => {
    if (
      storedPreviewState.status !== "ready" ||
      (storedPreviewState.schematic === schematic &&
        storedPreviewState.mods === modContext &&
        storedPreviewState.targetVersionId === targetVersionId)
    ) {
      return storedPreviewState;
    }
    return previewWanted
      ? { status: "loading", targetVersionId }
      : { status: "idle" };
  }, [
    storedPreviewState,
    schematic,
    modContext,
    targetVersionId,
    previewWanted,
  ]);
  // Decisions keyed by version key, then by source block-state string.
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

  const decisions = React.useMemo<Record<string, Decision>>(
    () => decisionsByVersion[versionKey] ?? {},
    [decisionsByVersion, versionKey],
  );

  // The schematic just mutated (initial mount, swap from US-010, apply from
  // US-015, or undo of either). Drop every stored decision and mod choice —
  // keys belong to a palette / version pairing that may no longer exist.
  React.useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setDecisionsByVersion({});
      setChoicesByVersion({});
    })();
  }, [schematic]);

  // Kick off a preview pass whenever the target version, the mod mapping or
  // the schematic changes. With no target version the pass runs only when a
  // replacement mod is chosen; otherwise the panel returns to idle.
  //
  // Every `setState` call lives behind an `await` inside the async IIFE so
  // the lint rule against synchronous setState-in-effect stays happy.
  React.useEffect(() => {
    requestKeyRef.current += 1;
    const requestKey = requestKeyRef.current;

    if (!previewWanted) {
      void (async () => {
        await Promise.resolve();
        if (requestKeyRef.current !== requestKey) return;
        setPreviewState({ status: "idle" });
      })();
      return;
    }

    const target =
      targetVersionId === null ? null : KNOWN_VERSIONS[targetVersionId];
    if (target === undefined) return;

    void (async () => {
      await Promise.resolve();
      if (requestKeyRef.current !== requestKey) return;
      setPreviewState({ status: "loading", targetVersionId });
      try {
        const preview = await translatePreviewInWorker(
          schematic,
          target,
          modContext,
        );
        if (requestKeyRef.current !== requestKey) return;
        setPreviewState({
          status: "ready",
          targetVersionId,
          preview,
          schematic,
          mods: modContext,
        });
      } catch (err) {
        if (requestKeyRef.current !== requestKey) return;
        const message =
          err instanceof Error ? err.message : "Translation preview failed.";
        setPreviewState({ status: "error", targetVersionId, message });
      }
    })();
  }, [schematic, targetVersionId, modContext, previewWanted]);

  const setDecisionForCurrentVersion = React.useCallback(
    (key: string, decision: Decision | null) => {
      setDecisionsByVersion((prev) => {
        const current = prev[versionKey] ?? {};
        if (decision === null) {
          if (!(key in current)) return prev;
          const next = { ...current };
          delete next[key];
          return { ...prev, [versionKey]: next };
        }
        return {
          ...prev,
          [versionKey]: { ...current, [key]: decision },
        };
      });
    },
    [versionKey],
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

  const handleChooseSuggestion = React.useCallback(
    (entry: ProblematicEntry, candidate: SuggestionCandidate) => {
      // The candidate's default state: no explicit properties.
      setDecisionForCurrentVersion(entry.sourceBlockState, {
        kind: "override",
        target: { blockId: candidate.id, properties: {} },
      });
    },
    [setDecisionForCurrentVersion],
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
    const target =
      previewState.targetVersionId === null
        ? null
        : KNOWN_VERSIONS[previewState.targetVersionId];
    if (target === undefined) return;
    const currentDecisions =
      decisionsByVersion[choiceVersionKey(previewState.targetVersionId)] ?? {};
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
    const applied = applyVersionMappingAction(
      target,
      overrides,
      previewState.mods,
    );
    if (applied) {
      // Reset the panel: clear the target selection so the dropdown returns
      // to its placeholder and the preview goes back to idle. The schematic
      // also mutated, so the [schematic] effect drops every stored decision
      // and mod choice (their palette / version pairing is no longer current).
      setTargetVersionId(null);
    }
  }, [previewState, decisionsByVersion, setTargetVersionId]);

  const handleUndoTranslation = React.useCallback(() => {
    undoLastTranslation();
  }, []);

  // Apply needs every problematic row decided, every mod that can't carry
  // over replaced or kept, and no mod file still loading (`applyReadiness`).
  const isModOnly = targetVersionId === null;
  const pendingCount =
    previewState.status === "ready" ? previewState.preview.pendingCount : 0;
  const undecidedCount =
    previewState.status === "ready"
      ? previewState.preview.problematic.filter(
          (entry) => !(entry.sourceBlockState in decisions),
        ).length
      : 0;
  const { canApply, title: applyTitle } = applyReadiness({
    previewStatus: previewState.status,
    pendingCount,
    undecidedCount,
    undecidedModCount,
    failedReplacementCount,
    targetVersionId,
    sourceVersionLabel: sourceVersion.versionNumber.join("."),
    hasReplacement,
  });

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

      <VersionMappingModsSection
        rows={modRows}
        loads={loads}
        targetVersionId={targetVersionId}
        actions={modActions}
      />

      <PreviewSummary state={previewState} />

      {previewState.status === "ready" ? (
        <ProblematicList
          preview={previewState.preview}
          decisions={decisions}
          onAccept={handleAccept}
          onPickReplacement={handlePickReplacement}
          onChooseSuggestion={handleChooseSuggestion}
          onClearDecision={handleClearDecision}
          suggestionContext={suggestionContext}
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
          disabled={!canApply}
          style={{ flex: 1 }}
          title={applyTitle}
        >
          {isModOnly ? "Apply mod mapping" : "Apply translation"}
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
          suggestionContext={suggestionContext}
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
  onChooseSuggestion,
  onClearDecision,
  suggestionContext,
}: {
  preview: VersionMappingPreview;
  decisions: Record<string, Decision>;
  onAccept: (entry: ProblematicEntry) => void;
  onPickReplacement: (entry: ProblematicEntry) => void;
  onChooseSuggestion: (
    entry: ProblematicEntry,
    candidate: SuggestionCandidate,
  ) => void;
  onClearDecision: (entry: ProblematicEntry) => void;
  suggestionContext: BlockSuggestionContext;
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
          onChooseSuggestion={(candidate) =>
            onChooseSuggestion(entry, candidate)
          }
          onClearDecision={() => onClearDecision(entry)}
          suggestionContext={suggestionContext}
        />
      ))}
    </div>
  );
}

const REASON_LABELS: Record<
  Exclude<ProblematicReason, "vanilla">,
  { label: string; variant: "warning" | "danger" | "info" }
> = {
  "missing-block": { label: "Missing in mod", variant: "danger" },
  "invalid-state": { label: "Blockstate adjusted", variant: "info" },
  "mod-unmapped": { label: "Unmapped mod", variant: "warning" },
  "mod-not-available": { label: "Mod not available", variant: "warning" },
};

function ProblematicRow({
  entry,
  decision,
  onAccept,
  onPickReplacement,
  onChooseSuggestion,
  onClearDecision,
  suggestionContext,
}: {
  entry: ProblematicEntry;
  decision: Decision | undefined;
  onAccept: () => void;
  onPickReplacement: () => void;
  onChooseSuggestion: (candidate: SuggestionCandidate) => void;
  onClearDecision: () => void;
  suggestionContext: BlockSuggestionContext;
}) {
  const [suggesting, setSuggesting] = React.useState(false);
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
        {entry.reason !== "vanilla" ? (
          <Badge
            variant={REASON_LABELS[entry.reason].variant}
            size="sm"
            style={{ flexShrink: 0, marginLeft: "auto" }}
          >
            {REASON_LABELS[entry.reason].label}
          </Badge>
        ) : null}
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
        suggesting={suggesting}
        onToggleSuggest={() => setSuggesting((open) => !open)}
        onClearDecision={onClearDecision}
      />
      {suggesting ? (
        <BlockSuggestions
          sourceBlockId={entry.sourceBlockId}
          context={suggestionContext}
          onChoose={(candidate) => {
            onChooseSuggestion(candidate);
            setSuggesting(false);
          }}
        />
      ) : null}
    </div>
  );
}

function DecisionFooter({
  decision,
  onAccept,
  onPickReplacement,
  suggesting,
  onToggleSuggest,
  onClearDecision,
}: {
  decision: Decision | undefined;
  onAccept: () => void;
  onPickReplacement: () => void;
  suggesting: boolean;
  onToggleSuggest: () => void;
  onClearDecision: () => void;
}) {
  const suggestButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onToggleSuggest}
      aria-expanded={suggesting}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        fontSize: "var(--text-xs)",
      }}
    >
      <IconBulb size={14} aria-hidden="true" />
      {suggesting ? "Hide suggestions" : "Suggest a block"}
    </Button>
  );

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
        {suggestButton}
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
        {suggestButton}
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
        {suggestButton}
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
        Pick a target version to preview the translation, or replace a mod above
        to rewrite its blocks without changing version.
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
        {state.targetVersionId === null
          ? "Previewing mod mapping…"
          : `Previewing translation to ${state.targetVersionId}…`}
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
      {targetVersionId === null ? (
        "Mapping mods (no version change): "
      ) : (
        <>
          Translating to <strong>{targetVersionId}</strong>:{" "}
        </>
      )}
      <strong>{preview.cleanCount.toLocaleString()}</strong> state
      {preview.cleanCount === 1 ? "" : "s"} translated cleanly,{" "}
      <strong>{preview.problematicCount.toLocaleString()}</strong> state
      {preview.problematicCount === 1 ? "" : "s"} need attention
      {preview.pendingCount > 0 ? (
        <>
          , <strong>{preview.pendingCount.toLocaleString()}</strong> waiting for
          mod files to load
        </>
      ) : null}
      .
    </div>
  );
}
