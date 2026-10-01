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
  IconChecks,
  IconX,
} from "@tabler/icons-react";
import type { ParsedSchematicProjection } from "@/lib/convert";
import { translatePreviewInWorker } from "@/lib/convert-client";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";
import {
  groupProblematicEntries,
  type ProblematicGroup,
  type ProblematicReason,
  type VersionMappingPreview,
} from "@/lib/advanced/version-mapping-preview";
import type { VersionMappingOverrides } from "@/lib/advanced/edit";
import { carryCamoBlockProperties } from "@/lib/camo/block-properties";
import type { CamoChoice } from "@/lib/camo/write";
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
  type BlockStatePickerChoice,
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
// or an override entry — see `allRowsResolved` below. An override's `target`
// is this state's own (a camo block keeps the state's properties); `choice`
// is what the user picked for the whole group, and `camo` goes on the new
// blocks.
type Decision =
  | { kind: "accepted" }
  | {
      kind: "override";
      target: BlockStatePickerResult;
      camo?: CamoChoice;
      choice: OverrideChoice;
    };

// The group-wide part of an override, for display and for telling whether a
// group's states share one decision.
interface OverrideChoice {
  blockId: string;
  typedProperties: Record<string, string>;
  carriedNames: string[];
}

// The replacement picker's open state: the group's first state is shown as
// the source, and the choice lands on every state in the group.
interface PickerRequest {
  source: BlockStatePickerSource;
  sources: BlockStatePickerSource[];
}

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
  const [pickerRequest, setPickerRequest] =
    React.useState<PickerRequest | null>(null);

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

  // Sets (or, with null, clears) the decision for several source states at
  // once: a block group, or every undecided row for "Accept all".
  const setDecisionsForCurrentVersion = React.useCallback(
    (keys: readonly string[], decision: Decision | null) => {
      setDecisionsByVersion((prev) => {
        const next = { ...(prev[versionKey] ?? {}) };
        for (const key of keys) {
          if (decision === null) delete next[key];
          else next[key] = decision;
        }
        return { ...prev, [versionKey]: next };
      });
    },
    [versionKey],
  );

  const handleAccept = React.useCallback(
    (group: ProblematicGroup) => {
      setDecisionsForCurrentVersion(stateKeysOf(group), { kind: "accepted" });
    },
    [setDecisionsForCurrentVersion],
  );

  // Sets one override decision per source state.
  const setOverrides = React.useCallback(
    (
      targets: readonly {
        sourceBlockState: string;
        target: BlockStatePickerResult;
      }[],
      choice: OverrideChoice,
      camo: CamoChoice | undefined,
    ) => {
      setDecisionsByVersion((prev) => {
        const next = { ...(prev[versionKey] ?? {}) };
        for (const { sourceBlockState, target } of targets) {
          next[sourceBlockState] = {
            kind: "override",
            target,
            choice,
            ...(camo ? { camo } : {}),
          };
        }
        return { ...prev, [versionKey]: next };
      });
    },
    [versionKey],
  );

  const handlePickReplacement = React.useCallback((group: ProblematicGroup) => {
    const sources = group.entries.map((entry) => ({
      blockState: entry.sourceBlockState,
      blockId: entry.sourceBlockId,
      properties: entry.sourceProperties,
    }));
    setPickerRequest({ source: sources[0], sources });
  }, []);

  const handleConfirmReplacement = React.useCallback(
    (picked: BlockStatePickerChoice) => {
      setOverrides(
        picked.targets.map(({ source, target }) => ({
          sourceBlockState: source.blockState,
          target,
        })),
        {
          blockId: picked.blockId,
          typedProperties: picked.typedProperties,
          carriedNames: picked.carriedNames,
        },
        picked.camo,
      );
      setPickerRequest(null);
    },
    [setOverrides],
  );

  const handleChooseSuggestion = React.useCallback(
    (group: ProblematicGroup, candidate: SuggestionCandidate) => {
      // The candidate's default state, keeping each state's properties when
      // it's a camo block.
      const targets = group.entries.map((entry) => ({
        sourceBlockState: entry.sourceBlockState,
        target: {
          blockId: candidate.id,
          properties: carryCamoBlockProperties(
            entry.sourceProperties,
            candidate.id,
          ),
        },
      }));
      setOverrides(
        targets,
        {
          blockId: candidate.id,
          typedProperties: {},
          carriedNames: [
            ...new Set(
              targets.flatMap((t) => Object.keys(t.target.properties)),
            ),
          ].sort(),
        },
        undefined,
      );
    },
    [setOverrides],
  );

  const handleCancelPicker = React.useCallback(() => {
    setPickerRequest(null);
  }, []);

  const handleClearDecision = React.useCallback(
    (group: ProblematicGroup) => {
      setDecisionsForCurrentVersion(stateKeysOf(group), null);
    },
    [setDecisionsForCurrentVersion],
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
          ...(decision.camo ? { camo: decision.camo } : {}),
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
  const undecidedKeys =
    previewState.status === "ready"
      ? previewState.preview.problematic
          .map((entry) => entry.sourceBlockState)
          .filter((key) => !(key in decisions))
      : [];
  const undecidedCount = undecidedKeys.length;
  const handleAcceptAll = () => {
    setDecisionsForCurrentVersion(undecidedKeys, { kind: "accepted" });
  };
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
          undecidedCount={undecidedCount}
          onAcceptAll={handleAcceptAll}
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

      {pickerRequest !== null ? (
        <BlockStatePicker
          open
          source={pickerRequest.source}
          sources={pickerRequest.sources}
          allowCamo
          onCancel={handleCancelPicker}
          onConfirm={handleConfirmReplacement}
          title="Pick replacement block"
          description={
            pickerRequest.sources.length > 1
              ? `Choose the block to substitute for all ${pickerRequest.sources.length} states of this block in the translated schematic. The choice overrides the mapper's proposal for this row only. Free-text input is accepted for identifiers outside the catalog.`
              : "Choose the block to substitute for this source state in the translated schematic. The choice overrides the mapper's proposal for this row only. Free-text input is accepted for identifiers outside the catalog."
          }
          confirmLabel="Set replacement"
          suggestionContext={suggestionContext}
        />
      ) : null}
    </div>
  );
}

function stateKeysOf(group: ProblematicGroup): string[] {
  return group.entries.map((entry) => entry.sourceBlockState);
}

// A group's shared decision, or undefined while its states are undecided or
// decided differently (the group's actions then overwrite them all).
function groupDecision(
  group: ProblematicGroup,
  decisions: Record<string, Decision>,
): Decision | undefined {
  const signature = (decision: Decision) =>
    decision.kind === "override"
      ? JSON.stringify([decision.choice, decision.camo ?? null])
      : decision.kind;
  const first = decisions[group.entries[0].sourceBlockState];
  if (first === undefined) return undefined;
  const firstSignature = signature(first);
  for (const entry of group.entries) {
    const decision = decisions[entry.sourceBlockState];
    if (decision === undefined || signature(decision) !== firstSignature) {
      return undefined;
    }
  }
  return first;
}

function ProblematicList({
  preview,
  decisions,
  undecidedCount,
  onAcceptAll,
  onAccept,
  onPickReplacement,
  onChooseSuggestion,
  onClearDecision,
  suggestionContext,
}: {
  preview: VersionMappingPreview;
  decisions: Record<string, Decision>;
  undecidedCount: number;
  onAcceptAll: () => void;
  onAccept: (group: ProblematicGroup) => void;
  onPickReplacement: (group: ProblematicGroup) => void;
  onChooseSuggestion: (
    group: ProblematicGroup,
    candidate: SuggestionCandidate,
  ) => void;
  onClearDecision: (group: ProblematicGroup) => void;
  suggestionContext: BlockSuggestionContext;
}) {
  const groups = React.useMemo(
    () => groupProblematicEntries(preview.problematic),
    [preview],
  );

  if (groups.length === 0) {
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
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          color: "var(--text-tertiary)",
          fontSize: "var(--text-xs)",
        }}
      >
        <span>
          {groups.length.toLocaleString()} block
          {groups.length === 1 ? "" : "s"} to review
          {undecidedCount > 0
            ? `, ${undecidedCount.toLocaleString()} state${undecidedCount === 1 ? "" : "s"} undecided`
            : ""}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAcceptAll}
          disabled={undecidedCount === 0}
          title="Accept the proposed mapping for every row that has no decision yet. Rows with a replacement keep it."
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--text-xs)",
            flexShrink: 0,
          }}
        >
          <IconChecks size={14} aria-hidden="true" />
          Accept all
        </Button>
      </div>
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
        {groups.map((group) => (
          <ProblematicRow
            key={group.key}
            group={group}
            decision={groupDecision(group, decisions)}
            onAccept={() => onAccept(group)}
            onPickReplacement={() => onPickReplacement(group)}
            onChooseSuggestion={(candidate) =>
              onChooseSuggestion(group, candidate)
            }
            onClearDecision={() => onClearDecision(group)}
            suggestionContext={suggestionContext}
          />
        ))}
      </div>
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
  group,
  decision,
  onAccept,
  onPickReplacement,
  onChooseSuggestion,
  onClearDecision,
  suggestionContext,
}: {
  group: ProblematicGroup;
  decision: Decision | undefined;
  onAccept: () => void;
  onPickReplacement: () => void;
  onChooseSuggestion: (candidate: SuggestionCandidate) => void;
  onClearDecision: () => void;
  suggestionContext: BlockSuggestionContext;
}) {
  const [suggesting, setSuggesting] = React.useState(false);
  // A single state shows its properties inline; several are listed below.
  const single = group.entries.length === 1 ? group.entries[0] : null;
  const sourceProps = single ? formatProperties(single.sourceProperties) : "";
  const targetProps = single
    ? formatProperties(single.proposedTargetProperties)
    : "";

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
          title={group.sourceBlockId + sourceProps}
        >
          {group.sourceBlockId}
          {sourceProps ? (
            <span style={{ color: "var(--text-tertiary)" }}>{sourceProps}</span>
          ) : null}
          {single === null ? (
            <span
              style={{
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-sans, inherit)",
              }}
            >
              {" "}
              · {group.entries.length.toLocaleString()} states
            </span>
          ) : null}
        </span>
        {group.reason !== "vanilla" ? (
          <Badge
            variant={REASON_LABELS[group.reason].variant}
            size="sm"
            style={{ flexShrink: 0, marginLeft: "auto" }}
          >
            {REASON_LABELS[group.reason].label}
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
          {group.totalCount.toLocaleString()}
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
        title={group.proposedTargetBlockId + targetProps}
      >
        <span style={{ color: "var(--text-tertiary)" }}>→ </span>
        {group.proposedTargetBlockId}
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
        {group.warnings.map((warning, idx) => (
          <li key={idx}>{warning}</li>
        ))}
      </ul>
      {single === null ? <GroupStates group={group} /> : null}

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
          sourceBlockId={group.sourceBlockId}
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

// The individual states behind a grouped row, collapsed by default.
function GroupStates({ group }: { group: ProblematicGroup }) {
  return (
    <details
      style={{
        color: "var(--text-secondary)",
        fontSize: "var(--text-xs)",
      }}
    >
      <summary style={{ cursor: "pointer", color: "var(--text-tertiary)" }}>
        Show {group.entries.length.toLocaleString()} states
      </summary>
      <ul
        style={{
          margin: 0,
          padding: "var(--space-1) 0 0 var(--space-4)",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          lineHeight: 1.5,
        }}
      >
        {group.entries.map((entry) => {
          const source = formatProperties(entry.sourceProperties) || "[]";
          const target =
            formatProperties(entry.proposedTargetProperties) || "[]";
          return (
            <li
              key={entry.sourceBlockState}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "var(--space-2)",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
                title={`${source} → ${target}`}
              >
                {source}
                <span style={{ color: "var(--text-tertiary)" }}> → </span>
                {target}
              </span>
              <span
                style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
              >
                {entry.sourceCount.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
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

  const { choice, camo } = decision;
  const overrideDisplay = formatStateDisplay(
    choice.blockId,
    choice.typedProperties,
  );
  const camoDisplay = camo
    ? Object.entries(camo)
        .map(
          ([slot, target]) =>
            `${slot}: ${formatStateDisplay(target.blockId, target.properties)}`,
        )
        .join(", ")
    : null;
  const noteStyle: React.CSSProperties = {
    color: "var(--text-tertiary)",
    fontSize: "var(--text-xs)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

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
        <strong>{choice.blockId}</strong>
        {Object.keys(choice.typedProperties).length > 0 ? (
          <span style={{ color: "var(--text-tertiary)" }}>
            {formatProperties(choice.typedProperties)}
          </span>
        ) : null}
      </div>
      {choice.carriedNames.length > 0 ? (
        <div style={noteStyle} title={choice.carriedNames.join(", ")}>
          Keeps each state&apos;s {choice.carriedNames.join(", ")}
        </div>
      ) : null}
      {camoDisplay !== null ? (
        <div style={noteStyle} title={camoDisplay}>
          Camo: {camoDisplay}
        </div>
      ) : null}
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
