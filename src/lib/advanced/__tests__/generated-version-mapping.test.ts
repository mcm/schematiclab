// Version Mapping of generated (Unlimited Chisel Works) blocks, end to end:
// the hand-made UCW, Chisel and Natura files of `ucw-test-files.ts` →
// `describeModNamespaces` → `generatedMappingBlocks` →
// `buildModMappingContext`, then the same cases through
// `previewVersionMapping` and `applyVersionMapping`, which must agree.

import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedModFile } from "../../curseforge/resolve-file";
import {
  __setGeneratedVanillaLoaderForTests,
  loadGeneratedBlockFiles,
} from "../../mods/generated/registry";
import {
  ID,
  UCW,
  VANILLA,
  loadAll,
} from "../../mods/generated/__tests__/ucw-test-files";
import { detectSchematicNamespaces } from "../../mods/namespaces";
import * as modRegistry from "../../mods/registry";
import * as store from "../../mods/store";
import type { NamespaceMapping } from "../../mods/types";
import { BlockState } from "../../schemlib/blocks";
import type { MinecraftVersion } from "../../schemlib/schematic-formats/version-mapping";
import { applyVersionMapping, type Schematic } from "../edit";
import { generatedMappingBlocks } from "../generated-mapping";
import type { ModMappingContext } from "../mod-mapping";
import {
  applyReadiness,
  buildModMappingContext,
  countModBlockers,
  describeModNamespaces,
  type ModNamespaceRow,
} from "../mod-namespace-status";
import { previewVersionMapping } from "../version-mapping-preview";

const V_1_12_2: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 12, 2],
  dataVersion: 1343,
};

const V_1_20_1: MinecraftVersion = {
  platform: "java",
  versionNumber: [1, 20, 1],
  dataVersion: 3463,
};

const VERSIONS: Record<string, MinecraftVersion> = {
  "1.12.2": V_1_12_2,
  "1.20.1": V_1_20_1,
};

const UNKNOWN = "unlimitedchiselworks:not_a_rule_0";
const MOD_NAMES: Record<string, string> = {
  chisel: "Chisel",
  natura: "Natura",
  unlimitedchiselworks: "Unlimited Chisel Works",
};

const UCW_MAPPING: NamespaceMapping = {
  namespace: "unlimitedchiselworks",
  modId: UCW.modId,
  modName: "Unlimited Chisel Works",
  modSlug: UCW.modSlug,
  logoUrl: null,
  mappedAt: 0,
};

function schematic(states: string[]): Schematic {
  const palette = states.map((blockState) => {
    const parsed = BlockState.fromString(blockState);
    return {
      blockState,
      blockId: parsed.Name,
      properties: Object.fromEntries(parsed.Properties),
      count: 1,
    };
  });
  return {
    name: "test",
    inputFormat: "Litematic",
    minecraftVersion: V_1_12_2,
    totalBlocks: palette.length,
    palette,
    regions: [
      {
        origin: [0, 0, 0],
        size: [palette.length, 1, 1],
        blocks: palette.map((_, i) => ({
          pos: [i, 0, 0] as [number, number, number],
          paletteIndex: i,
        })),
        blockEntities: [],
      },
    ],
  };
}

/** Rows and context as the Version Mapping panel builds them. */
async function context(
  s: Schematic,
  targetVersionId: string | null,
  resolutions: ReadonlyMap<string, ResolvedModFile> = new Map(),
): Promise<{ rows: ModNamespaceRow[]; mods: ModMappingContext }> {
  const rows = describeModNamespaces({
    namespaces: detectSchematicNamespaces(s.palette),
    mappings: new Map([["unlimitedchiselworks", UCW_MAPPING]]),
    loadedMods: modRegistry.getSnapshot(),
    failedLoads: new Map(),
    resolutions,
    choices: {},
    targetVersionId,
    sourceVersionId: "1.12.2",
  });
  let blocks = {};
  if (targetVersionId !== null) {
    await loadGeneratedBlockFiles(targetVersionId);
    blocks = generatedMappingBlocks(
      s.palette.map((entry) => entry.blockId),
      targetVersionId,
      (namespace) => MOD_NAMES[namespace] ?? namespace,
    );
  }
  return {
    rows,
    mods: buildModMappingContext(rows, targetVersionId, {
      blocks,
      loading: [],
    }),
  };
}

/**
 * Preview and apply with the same context. Every proposed target of a
 * problematic row must be what apply wrote, and clean rows must apply to
 * themselves (no translation across one version).
 */
function previewAndApply(
  s: Schematic,
  targetVersionId: string | null,
  mods: ModMappingContext,
) {
  const target = targetVersionId === null ? null : VERSIONS[targetVersionId];
  const preview = previewVersionMapping(s, target, mods);
  const applied = applyVersionMapping(s, target, {}, mods);
  const appliedStates = applied.palette.map((e) => e.blockState).sort();
  const problematicSources = new Set(
    preview.problematic.map((e) => e.sourceBlockState),
  );
  const expected = [
    ...preview.problematic.map((e) => e.proposedTargetBlockState),
    ...s.palette
      .map((e) => e.blockState)
      .filter((state) => !problematicSources.has(state)),
  ].sort();
  expect(appliedStates).toEqual([...new Set(expected)].sort());
  return { preview, appliedStates };
}

beforeEach(async () => {
  await store.__resetModStoreForTests();
  modRegistry.__resetLoadedModsForTests();
  globalThis.indexedDB = new IDBFactory();
  __setGeneratedVanillaLoaderForTests(async () => VANILLA);
});

afterEach(() => {
  __setGeneratedVanillaLoaderForTests(null);
});

describe("Version Mapping of generated blocks", () => {
  it("treats a resolved block as known for 1.12.2", async () => {
    await loadAll();
    const s = schematic([`${ID}[variation=3]`, "minecraft:stone"]);
    const { mods } = await context(s, "1.12.2");
    expect(mods.unlimitedchiselworks).toMatchObject({
      kind: "target",
      generated: { [ID]: { kind: "resolved" } },
    });
    const { preview, appliedStates } = previewAndApply(s, "1.12.2", mods);
    expect(preview.problematic).toEqual([]);
    expect(preview.cleanCount).toBe(2);
    expect(appliedStates).toEqual(
      ["minecraft:stone", `${ID}[variation=3]`].sort(),
    );
  });

  it("fits a resolved block's state to the generated block", async () => {
    await loadAll();
    const s = schematic([`${ID}[variation=99]`]);
    const { mods } = await context(s, "1.12.2");
    const { preview } = previewAndApply(s, "1.12.2", mods);
    expect(preview.problematic).toMatchObject([
      {
        reason: "invalid-state",
        proposedTargetBlockState: `${ID}[variation=0]`,
      },
    ]);
  });

  it("leaves generated blocks alone with no target version", async () => {
    // Not even Natura loaded: with no target only replacements run.
    await loadAll(false);
    const s = schematic([`${ID}[variation=3]`, UNKNOWN]);
    const { mods } = await context(s, null);
    expect(mods).toEqual({});
    const { preview, appliedStates } = previewAndApply(s, null, mods);
    expect(preview.problematic).toEqual([]);
    expect(appliedStates).toEqual([`${ID}[variation=3]`, UNKNOWN].sort());
  });

  it("explains which mods to load when a source mod is missing", async () => {
    await loadAll(false);
    const s = schematic([`${ID}[variation=3]`, UNKNOWN]);
    const { rows, mods } = await context(s, "1.12.2");
    const { preview, appliedStates } = previewAndApply(s, "1.12.2", mods);
    expect(preview.problematic).toEqual([
      expect.objectContaining({
        sourceBlockState: `${ID}[variation=3]`,
        proposedTargetBlockState: `${ID}[variation=3]`,
        reason: "generated-sources-missing",
        warnings: [
          "Generated by Unlimited Chisel Works from natura:nether_planks — load Natura for 1.12.2 to resolve it",
        ],
      }),
      // A UCW id no rule produces is still missing.
      expect.objectContaining({
        sourceBlockState: UNKNOWN,
        reason: "missing-block",
      }),
    ]);
    expect(appliedStates).toEqual([`${ID}[variation=3]`, UNKNOWN].sort());
    // Like any problematic row: decided by accepting, nothing new blocks it.
    expect(countModBlockers(rows)).toEqual({
      undecidedModCount: 0,
      failedReplacementCount: 0,
    });
    expect(
      applyReadiness({
        previewStatus: "ready",
        pendingCount: preview.pendingCount,
        undecidedCount: 0,
        undecidedModCount: 0,
        failedReplacementCount: 0,
        targetVersionId: "1.12.2",
        sourceVersionLabel: "1.12.2",
        hasReplacement: false,
      }).canApply,
    ).toBe(true);
  });

  it("keeps the replace / keep flow for a later version", async () => {
    await loadAll();
    const s = schematic([`${ID}[variation=3]`]);
    const { rows, mods } = await context(
      s,
      "1.20.1",
      new Map([[`${UCW.modId}:1.20.1`, { status: "unavailable" }]]),
    );
    // UCW has no file for 1.20.1: the user must replace or keep it.
    expect(rows[0].target).toEqual({ status: "unavailable" });
    expect(countModBlockers(rows).undecidedModCount).toBe(1);
    expect(mods).toEqual({ unlimitedchiselworks: { kind: "keep" } });
    const { preview, appliedStates } = previewAndApply(s, "1.20.1", mods);
    expect(preview.problematic).toEqual([
      expect.objectContaining({ reason: "mod-not-available" }),
    ]);
    expect(appliedStates).toEqual([`${ID}[variation=3]`]);
  });
});
