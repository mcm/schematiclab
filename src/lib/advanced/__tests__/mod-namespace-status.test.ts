import { describe, expect, it } from "vitest";

import type { CurseForgeModFile } from "../../curseforge/types";
import type { ResolvedModFile } from "../../curseforge/resolve-file";
import type { LoadedModMeta, NamespaceMapping } from "../../mods/types";
import {
  applyReadiness,
  buildModMappingContext,
  choiceVersionKey,
  countModBlockers,
  describeModNamespaces,
  replacementNamespace,
  type ModChoice,
  type ModNamespaceInput,
} from "../mod-namespace-status";

function mapping(namespace: string, modId: number): NamespaceMapping {
  return {
    namespace,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    mappedAt: 0,
  };
}

function file(
  modId: number,
  gameVersion: string,
  blockIds: string[],
): LoadedModMeta {
  return {
    key: `${modId}:${gameVersion}`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId: 1,
    fileDisplayName: `mod-${modId}-${gameVersion}.jar`,
    gameVersion,
    gameVersions: [gameVersion],
    loader: "forge",
    namespaces: [...new Set(blockIds.map((id) => id.split(":")[0]))],
    blocks: blockIds.map((id) => ({
      id,
      displayName: id,
      properties: { facing: ["north", "south"] },
    })),
    loadedAt: 0,
  };
}

const CF_FILE: CurseForgeModFile = {
  id: 9,
  displayName: "Create 1.21",
  fileName: "create-1.21.jar",
  fileDate: "",
  fileLength: 1,
  downloadCount: 0,
  gameVersions: ["1.21"],
  loaders: ["neoforge"],
  isServerPack: false,
  isAvailable: true,
} as unknown as CurseForgeModFile;

const available: ResolvedModFile = {
  status: "available",
  file: CF_FILE,
  loader: "neoforge",
  loaderFallback: true,
};

const REPLACEMENT: ModChoice = {
  kind: "replace",
  mod: { id: 7, name: "Other", slug: "other", logoThumbnailUrl: null },
};

function input(overrides: Partial<ModNamespaceInput>): ModNamespaceInput {
  return {
    namespaces: [{ namespace: "create", blockStateCount: 2, blockCount: 10 }],
    mappings: new Map([["create", mapping("create", 1)]]),
    loadedMods: [],
    failedLoads: new Map(),
    resolutions: new Map(),
    choices: {},
    targetVersionId: "1.21",
    sourceVersionId: "1.20.1",
    ...overrides,
  };
}

describe("describeModNamespaces", () => {
  it("shows unmapped namespaces without a target status", () => {
    const [row] = describeModNamespaces(input({ mappings: new Map() }));
    expect(row.mapping).toBeNull();
    expect(row.target).toBeNull();
    expect(row.needsDecision).toBe(false);
  });

  it("has no target status without a target version", () => {
    const [row] = describeModNamespaces(input({ targetVersionId: null }));
    expect(row.mapping?.modId).toBe(1);
    expect(row.target).toBeNull();
  });

  it("is resolving until a resolution arrives", () => {
    const [row] = describeModNamespaces(input({}));
    expect(row.target).toEqual({ status: "resolving" });
  });

  it("uses a loaded target file without resolving", () => {
    const loaded = file(1, "1.21", ["create:a"]);
    const [row] = describeModNamespaces(input({ loadedMods: [loaded] }));
    expect(row.target).toMatchObject({ status: "loaded", file: loaded });
  });

  it("is loading when a file is available, with the loader note", () => {
    const [row] = describeModNamespaces(
      input({ resolutions: new Map([["1:1.21", available]]) }),
    );
    expect(row.target).toEqual({
      status: "loading",
      loadKey: "1:1.21",
      fileName: "Create 1.21",
      loader: "neoforge",
      loaderFallback: true,
    });
  });

  it("reports failed loads and resolve errors, which need a decision", () => {
    const [loadFailed] = describeModNamespaces(
      input({
        resolutions: new Map([["1:1.21", available]]),
        failedLoads: new Map([["1:1.21", "boom"]]),
      }),
    );
    expect(loadFailed.target).toEqual({
      status: "error",
      message: "boom",
      retry: "load",
    });
    expect(loadFailed.needsDecision).toBe(true);

    const [resolveFailed] = describeModNamespaces(
      input({
        resolutions: new Map([["1:1.21", { status: "error", message: "x" }]]),
      }),
    );
    expect(resolveFailed.target).toMatchObject({ retry: "resolve" });
  });

  it("needs a decision when unavailable, until kept or replaced", () => {
    const resolutions = new Map<string, ResolvedModFile>([
      ["1:1.21", { status: "unavailable" }],
    ]);
    expect(describeModNamespaces(input({ resolutions }))[0].needsDecision).toBe(
      true,
    );
    expect(
      describeModNamespaces(
        input({ resolutions, choices: { create: { kind: "keep" } } }),
      )[0].needsDecision,
    ).toBe(false);
    expect(
      describeModNamespaces(
        input({ resolutions, choices: { create: REPLACEMENT } }),
      )[0].needsDecision,
    ).toBe(false);
  });

  it("loads a replacement for the target version, else the source version", () => {
    const [withTarget] = describeModNamespaces(
      input({ choices: { create: REPLACEMENT } }),
    );
    expect(withTarget.replacement).toEqual({
      status: "loading",
      loadKey: "7:1.21",
      gameVersion: "1.21",
    });
    const [noTarget] = describeModNamespaces(
      input({ targetVersionId: null, choices: { create: REPLACEMENT } }),
    );
    expect(noTarget.replacement).toMatchObject({ gameVersion: "1.20.1" });
  });

  it("flags a replacement whose load failed", () => {
    const [row] = describeModNamespaces(
      input({
        choices: { create: REPLACEMENT },
        failedLoads: new Map([["7:1.21", "nope"]]),
      }),
    );
    expect(row.replacement).toMatchObject({ status: "error", message: "nope" });
    expect(row.needsDecision).toBe(true);
  });
});

describe("unmapped namespace replaced with a target version", () => {
  it("loads, rewrites and reports the replacement for the target version", () => {
    const [loading] = describeModNamespaces(
      input({ mappings: new Map(), choices: { create: REPLACEMENT } }),
    );
    expect(loading.target).toBeNull();
    expect(loading.replacement).toEqual({
      status: "loading",
      loadKey: "7:1.21",
      gameVersion: "1.21",
    });
    expect(loading.needsDecision).toBe(false);

    const loadedInput = input({
      mappings: new Map(),
      choices: { create: REPLACEMENT },
      loadedMods: [file(7, "1.21", ["other:a"])],
    });
    expect(
      buildModMappingContext(describeModNamespaces(loadedInput), "1.21"),
    ).toMatchObject({ create: { kind: "replace", newNamespace: "other" } });

    const [failed] = describeModNamespaces(
      input({
        mappings: new Map(),
        choices: { create: REPLACEMENT },
        failedLoads: new Map([["7:1.21", "nope"]]),
      }),
    );
    expect(failed.replacement).toMatchObject({
      status: "error",
      message: "nope",
    });
    expect(failed.needsDecision).toBe(true);
  });
});

describe("countModBlockers", () => {
  it("counts failed replacements apart from mods needing a decision", () => {
    const rows = describeModNamespaces(
      input({
        namespaces: [
          { namespace: "create", blockStateCount: 1, blockCount: 1 },
          { namespace: "gone", blockStateCount: 1, blockCount: 1 },
          { namespace: "fine", blockStateCount: 1, blockCount: 1 },
        ],
        mappings: new Map([
          ["create", mapping("create", 1)],
          ["gone", mapping("gone", 2)],
          ["fine", mapping("fine", 3)],
        ]),
        resolutions: new Map([["2:1.21", { status: "unavailable" }]]),
        loadedMods: [file(3, "1.21", ["fine:a"])],
        choices: { create: REPLACEMENT },
        failedLoads: new Map([["7:1.21", "nope"]]),
      }),
    );
    expect(countModBlockers(rows)).toEqual({
      undecidedModCount: 1,
      failedReplacementCount: 1,
    });
  });
});

describe("replacementNamespace", () => {
  it("picks the namespace with the most blocks", () => {
    expect(replacementNamespace(file(7, "1.21", ["b:x", "a:y", "b:z"]))).toBe(
      "b",
    );
  });

  it("breaks ties by name", () => {
    expect(replacementNamespace(file(7, "1.21", ["b:x", "a:y"]))).toBe("a");
  });
});

describe("buildModMappingContext", () => {
  function context(overrides: Partial<ModNamespaceInput>) {
    const full = input(overrides);
    return buildModMappingContext(
      describeModNamespaces(full),
      full.targetVersionId,
    );
  }

  it("maps each status to a context entry with a target version", () => {
    expect(context({ mappings: new Map() })).toEqual({
      create: { kind: "unmapped" },
    });
    expect(context({})).toEqual({ create: { kind: "pending" } });
    expect(context({ resolutions: new Map([["1:1.21", available]]) })).toEqual({
      create: { kind: "pending" },
    });
    expect(
      context({
        resolutions: new Map([["1:1.21", { status: "unavailable" }]]),
      }),
    ).toEqual({ create: { kind: "keep" } });
    expect(context({ choices: { create: { kind: "keep" } } })).toEqual({
      create: { kind: "keep" },
    });
  });

  it("validates against the target file's blocks in the namespace", () => {
    expect(
      context({ loadedMods: [file(1, "1.21", ["create:a", "other:b"])] }),
    ).toEqual({
      create: {
        kind: "target",
        blocks: { "create:a": { facing: ["north", "south"] } },
      },
    });
  });

  it("adds generated blocks, pending while they're resolved", () => {
    const rows = describeModNamespaces(
      input({ loadedMods: [file(1, "1.21", ["create:a"])] }),
    );
    const generated = {
      "create:gen_0": { kind: "resolved" as const, properties: {} },
    };
    expect(
      buildModMappingContext(rows, "1.21", {
        blocks: { create: generated, other: {} },
        loading: [],
      }),
    ).toEqual({
      create: {
        kind: "target",
        blocks: { "create:a": { facing: ["north", "south"] } },
        generated,
      },
    });
    expect(
      buildModMappingContext(rows, "1.21", {
        blocks: {},
        loading: ["create"],
      }),
    ).toEqual({ create: { kind: "pending" } });
  });

  it("adds the mapped mod's file for the schematic's version as evidence", () => {
    const sourceFile = file(1, "1.20.1", ["create:old", "other:c"]);
    const [row] = describeModNamespaces(input({ loadedMods: [sourceFile] }));
    expect(row.sourceFile).toBe(sourceFile);

    const sourceBlocks = { "create:old": { facing: ["north", "south"] } };
    expect(
      context({
        loadedMods: [sourceFile, file(1, "1.21", ["create:a"])],
      }),
    ).toEqual({
      create: {
        kind: "target",
        blocks: { "create:a": { facing: ["north", "south"] } },
        sourceBlocks,
      },
    });
    expect(
      context({
        choices: { create: REPLACEMENT },
        loadedMods: [sourceFile, file(7, "1.21", ["other:a"])],
      }),
    ).toMatchObject({ create: { kind: "replace", sourceBlocks } });
  });

  it("rewrites to a loaded replacement, pending until then", () => {
    expect(context({ choices: { create: REPLACEMENT } })).toEqual({
      create: { kind: "pending" },
    });
    expect(
      context({
        choices: { create: REPLACEMENT },
        loadedMods: [file(7, "1.21", ["other:a"])],
      }),
    ).toEqual({
      create: {
        kind: "replace",
        newNamespace: "other",
        blocks: { "other:a": { facing: ["north", "south"] } },
      },
    });
  });

  it("lists only replacements without a target version", () => {
    expect(context({ targetVersionId: null })).toEqual({});
    expect(context({ targetVersionId: null, mappings: new Map() })).toEqual({});
    expect(
      context({
        targetVersionId: null,
        choices: { create: REPLACEMENT },
        loadedMods: [file(7, "1.20.1", ["other:a"])],
      }),
    ).toMatchObject({ create: { kind: "replace", newNamespace: "other" } });
    expect(
      context({
        targetVersionId: null,
        choices: { create: REPLACEMENT },
        failedLoads: new Map([["7:1.20.1", "x"]]),
      }),
    ).toEqual({});
  });
});

describe("choiceVersionKey", () => {
  it("uses 'none' without a target version", () => {
    expect(choiceVersionKey(null)).toBe("none");
    expect(choiceVersionKey("1.21")).toBe("1.21");
  });
});

describe("applyReadiness", () => {
  const ready = {
    previewStatus: "ready" as const,
    pendingCount: 0,
    undecidedCount: 0,
    undecidedModCount: 0,
    failedReplacementCount: 0,
    targetVersionId: "1.21" as string | null,
    sourceVersionLabel: "1.20.1",
    hasReplacement: false,
  };

  it("enables Apply when everything is decided", () => {
    expect(applyReadiness(ready)).toEqual({
      canApply: true,
      title: "Commit this translation to the in-memory schematic.",
    });
  });

  it("is disabled until the preview is ready", () => {
    for (const previewStatus of ["idle", "loading", "error"] as const) {
      expect(applyReadiness({ ...ready, previewStatus }).canApply).toBe(false);
    }
  });

  it("is disabled while a target mod file is loading", () => {
    const result = applyReadiness({ ...ready, pendingCount: 2 });
    expect(result.canApply).toBe(false);
    expect(result.title).toMatch(
      /Waiting for mod files to load \(2 block states/,
    );
  });

  it("is disabled while a mod or problematic row is undecided", () => {
    const mod = applyReadiness({ ...ready, undecidedModCount: 1 });
    expect(mod.canApply).toBe(false);
    expect(mod.title).toMatch(/1 mod has no file for 1\.21/);
    const row = applyReadiness({ ...ready, undecidedCount: 3 });
    expect(row.canApply).toBe(false);
    expect(row.title).toMatch(/3 flagged blocks still need a decision/);
  });

  it("never names a null target version", () => {
    const result = applyReadiness({
      ...ready,
      targetVersionId: null,
      undecidedModCount: 1,
    });
    expect(result.title).toMatch(/1 mod has no file for 1\.20\.1/);
    expect(result.title).not.toMatch(/null/);
  });

  it("asks to retry, change or clear failed replacement loads", () => {
    for (const targetVersionId of ["1.21", null]) {
      const one = applyReadiness({
        ...ready,
        targetVersionId,
        hasReplacement: true,
        failedReplacementCount: 1,
      });
      expect(one).toEqual({
        canApply: false,
        title: "1 replacement mod failed to load: retry, change or clear it.",
      });
    }
    expect(
      applyReadiness({ ...ready, failedReplacementCount: 2 }).title,
    ).toMatch(/^2 replacement mods failed to load/);
  });

  it("needs a replacement without a target version", () => {
    const none = { ...ready, targetVersionId: null };
    expect(applyReadiness(none)).toEqual({
      canApply: false,
      title: "Choose a replacement mod first.",
    });
    expect(applyReadiness({ ...none, hasReplacement: true }).canApply).toBe(
      true,
    );
  });
});
