import { describe, expect, it } from "vitest";

import type { LoadedModMeta, ModBlock } from "../../mods/types";
import type { BlockAppearance } from "../../render/block-appearance";
import { KNOWN_VERSIONS } from "../../schemlib/schematic-formats/known-versions";
import { vanillaBlocksForVersion } from "../../schemlib/data/vanilla-blocks";
import {
  editDistance,
  sourceAppearance,
  suggestBlocks,
  suggestionCandidates,
  titleCasePath,
  tokenOverlap,
  nameTokens,
  type SuggestionCandidate,
} from "../suggest-blocks";

function look(
  oklab: [number, number, number],
  fullCube = true,
): BlockAppearance {
  return { oklab, fullCube };
}

function candidate(
  id: string,
  appearance?: BlockAppearance,
): SuggestionCandidate {
  return {
    id,
    displayName: titleCasePath(id),
    sourceLabel: "Vanilla",
    ...(appearance ? { appearance } : {}),
  };
}

function file(
  modId: number,
  gameVersion: string,
  blocks: ModBlock[],
): LoadedModMeta {
  return {
    key: `${modId}:${gameVersion}`,
    modId,
    modName: `Mod ${modId}`,
    modSlug: `mod-${modId}`,
    logoUrl: null,
    fileId: 1,
    fileDisplayName: `mod-${modId}.jar`,
    gameVersion,
    gameVersions: [gameVersion],
    loader: "forge",
    namespaces: [...new Set(blocks.map((b) => b.id.split(":")[0]))],
    blocks,
    appearancesComputed: true,
    loadedAt: 0,
  };
}

function block(id: string, appearance?: BlockAppearance): ModBlock {
  return {
    id,
    displayName: `Display ${id}`,
    properties: {},
    ...(appearance ? { appearance } : {}),
  };
}

const ids = (list: SuggestionCandidate[]) => list.map((c) => c.id);

describe("suggestBlocks by colour", () => {
  const source = { id: "mod:red_brick", appearance: look([0.5, 0.1, 0.05]) };

  it("ranks by OKLab distance", () => {
    const result = suggestBlocks({
      source,
      candidates: [
        candidate("minecraft:far", look([0.9, -0.1, 0.1])),
        candidate("minecraft:near", look([0.51, 0.1, 0.05])),
        candidate("minecraft:mid", look([0.6, 0.1, 0.05])),
      ],
    });
    expect(ids(result)).toEqual([
      "minecraft:near",
      "minecraft:mid",
      "minecraft:far",
    ]);
  });

  it("breaks ties by id and never suggests the source", () => {
    const same = look([0.5, 0.1, 0.05]);
    const result = suggestBlocks({
      source,
      candidates: [
        candidate("minecraft:b", same),
        candidate("mod:red_brick", same),
        candidate("minecraft:a", same),
      ],
    });
    expect(ids(result)).toEqual(["minecraft:a", "minecraft:b"]);
  });

  it("keeps only candidates of the same full-cube class", () => {
    const result = suggestBlocks({
      source,
      candidates: [
        candidate("minecraft:slab", look([0.5, 0.1, 0.05], false)),
        candidate("minecraft:cube", look([0.8, 0, 0])),
      ],
    });
    expect(ids(result)).toEqual(["minecraft:cube"]);

    const flat = suggestBlocks({
      source: { id: "mod:carpet", appearance: look([0.5, 0.1, 0.05], false) },
      candidates: [
        candidate("minecraft:slab", look([0.9, 0, 0], false)),
        candidate("minecraft:cube", look([0.5, 0.1, 0.05])),
      ],
    });
    expect(ids(flat)).toEqual(["minecraft:slab"]);
  });

  it("falls back to every coloured candidate when none share the class", () => {
    const result = suggestBlocks({
      source,
      candidates: [
        candidate("minecraft:far", look([0.9, 0, 0], false)),
        candidate("minecraft:near", look([0.5, 0.1, 0.06], false)),
        candidate("minecraft:unknown"),
      ],
    });
    expect(ids(result)).toEqual(["minecraft:near", "minecraft:far"]);
  });

  it("returns at most `limit` candidates, 5 by default", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      candidate(`minecraft:b${i}`, look([0.5 + i / 100, 0.1, 0.05])),
    );
    expect(suggestBlocks({ source, candidates: many })).toHaveLength(5);
    expect(ids(suggestBlocks({ source, candidates: many, limit: 2 }))).toEqual([
      "minecraft:b0",
      "minecraft:b1",
    ]);
    expect(suggestBlocks({ source, candidates: many, limit: 0 })).toEqual([]);
  });
});

describe("suggestBlocks by name", () => {
  it("ranks by token overlap, then edit distance, then id", () => {
    const result = suggestBlocks({
      source: { id: "mod:oak_log_wall" },
      candidates: [
        candidate("minecraft:stone", look([0.5, 0, 0])),
        candidate("minecraft:oak_log", look([0.5, 0, 0])),
        candidate("minecraft:oak_wall", look([0.5, 0, 0])),
        candidate("minecraft:oak_planks"),
        candidate("minecraft:cobblestone_wall"),
        candidate("minecraft:stonf"),
      ],
      limit: 6,
    });
    // oak_wall and oak_log share two of three tokens; oak_wall is 4 edits
    // away, oak_log 5.
    expect(ids(result)).toEqual([
      "minecraft:oak_wall",
      "minecraft:oak_log",
      "minecraft:oak_planks",
      "minecraft:cobblestone_wall",
      "minecraft:stone",
      "minecraft:stonf",
    ]);
  });

  it("uses names when no candidate has colour data", () => {
    const result = suggestBlocks({
      source: { id: "mod:granite_tiles", appearance: look([0.6, 0.05, 0.03]) },
      candidates: [candidate("minecraft:dirt"), candidate("minecraft:granite")],
      limit: 1,
    });
    expect(ids(result)).toEqual(["minecraft:granite"]);
  });

  it("has helpers for tokens and edit distance", () => {
    expect([...nameTokens("mod:block/Oak-Log.wall")]).toEqual([
      "block",
      "oak",
      "log",
      "wall",
    ]);
    expect(tokenOverlap(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(
      1 / 3,
    );
    expect(tokenOverlap(new Set(), new Set())).toBe(0);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("suggestionCandidates", () => {
  const colors = {
    "minecraft:stone": look([0.6, 0, 0]),
    "minecraft:cherry_planks": look([0.8, 0.05, 0.02]),
  };

  it("keeps only vanilla blocks that exist in the version", () => {
    const older = suggestionCandidates({
      vanillaBlocks: vanillaBlocksForVersion(KNOWN_VERSIONS["1.18.2"]),
      vanillaColors: colors,
      loadedMods: [],
      modIds: new Set(),
      versionId: "1.18.2",
    });
    const newer = suggestionCandidates({
      vanillaBlocks: vanillaBlocksForVersion(KNOWN_VERSIONS["1.20.1"]),
      vanillaColors: colors,
      loadedMods: [],
      modIds: new Set(),
      versionId: "1.20.1",
    });
    expect(ids(older)).not.toContain("minecraft:cherry_planks");
    expect(ids(newer)).toContain("minecraft:cherry_planks");
    expect(ids(newer)).not.toContain("minecraft:air");
    expect(newer.find((c) => c.id === "minecraft:stone")).toEqual({
      id: "minecraft:stone",
      displayName: "Stone",
      sourceLabel: "Vanilla",
      appearance: colors["minecraft:stone"],
    });
  });

  it("adds blocks from mapped or replacement mods' files for the version", () => {
    const result = suggestionCandidates({
      vanillaBlocks: new Set(["minecraft:stone"]),
      vanillaColors: null,
      loadedMods: [
        file(1, "1.20.1", [block("a:tile", look([0.3, 0, 0]))]),
        file(1, "1.18.2", [block("a:old_tile")]),
        file(2, "1.20.1", [block("b:unrelated")]),
        file(3, "1.20.1", [block("minecraft:stone"), block("c:brick")]),
      ],
      modIds: new Set([1, 3]),
      versionId: "1.20.1",
    });
    expect(result).toEqual([
      {
        id: "a:tile",
        displayName: "Display a:tile",
        sourceLabel: "Mod 1",
        appearance: look([0.3, 0, 0]),
      },
      { id: "c:brick", displayName: "Display c:brick", sourceLabel: "Mod 3" },
      { id: "minecraft:stone", displayName: "Stone", sourceLabel: "Vanilla" },
    ]);
  });
});

describe("sourceAppearance", () => {
  it("reads vanilla colours for minecraft blocks", () => {
    const stone = look([0.6, 0, 0]);
    expect(
      sourceAppearance("minecraft:stone", { "minecraft:stone": stone }, [], ""),
    ).toBe(stone);
    expect(sourceAppearance("minecraft:stone", null, [], "")).toBeUndefined();
  });

  it("prefers the mod file for the source version", () => {
    const old = look([0.1, 0, 0]);
    const current = look([0.2, 0, 0]);
    const mods = [
      file(1, "1.20.1", [block("a:tile", current)]),
      file(1, "1.18.2", [block("a:tile", old)]),
    ];
    expect(sourceAppearance("a:tile", null, mods, "1.18.2")).toBe(old);
    expect(sourceAppearance("a:tile", null, mods, "1.16.5")).toBe(current);
    expect(sourceAppearance("a:missing", null, mods, "1.18.2")).toBeUndefined();
  });
});
