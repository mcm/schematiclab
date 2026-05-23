import { beforeEach, describe, expect, it } from "vitest";

import type { ParsedSchematicProjection } from "../convert";
import {
  __resetEditorStateForTests,
  applyBlockSwap,
  applyVersionMapping,
  clearEditorState,
  getEditorState,
  setOutputFormat,
  setParseStatus,
  setStagedFile,
  setTargetVersion,
  undoLastSwap,
  undoLastTranslation,
  type StagedFile,
} from "../editor-state";
import type { MinecraftVersion } from "../schemlib/schematic-formats/version-mapping";

const sampleStaged: StagedFile = {
  bytes: new Uint8Array([1, 2, 3]),
  filename: "build.litematic",
  inputFormat: "Litematic",
};

const sampleParsed: ParsedSchematicProjection = {
  name: "build",
  inputFormat: "Litematic",
  minecraftVersion: {
    platform: "java",
    versionNumber: [1, 20, 1],
    dataVersion: 3463,
  },
  totalBlocks: 0,
  palette: [],
  regions: [],
};

describe("editor-state store", () => {
  beforeEach(() => {
    __resetEditorStateForTests();
  });

  it("starts empty", () => {
    expect(getEditorState()).toEqual({
      stagedFile: null,
      outputFormat: null,
      targetVersion: null,
      parseStatus: { status: "idle" },
      lastSwapSnapshot: null,
      lastTranslationSnapshot: null,
    });
  });

  it("writes and reads staged file", () => {
    setStagedFile(sampleStaged);
    expect(getEditorState().stagedFile).toBe(sampleStaged);
  });

  it("writes and reads output format and target version independently", () => {
    setOutputFormat("Sponge[v3]");
    setTargetVersion("1.20.4");
    const s = getEditorState();
    expect(s.outputFormat).toBe("Sponge[v3]");
    expect(s.targetVersion).toBe("1.20.4");
    expect(s.stagedFile).toBeNull();
  });

  it("clearEditorState resets everything", () => {
    setStagedFile(sampleStaged);
    setOutputFormat("Litematic");
    setTargetVersion("1.20.4");
    setParseStatus({ status: "ready", schematic: sampleParsed });
    clearEditorState();
    expect(getEditorState()).toEqual({
      stagedFile: null,
      outputFormat: null,
      targetVersion: null,
      parseStatus: { status: "idle" },
      lastSwapSnapshot: null,
      lastTranslationSnapshot: null,
    });
  });

  it("setParseStatus writes the discriminated union", () => {
    setParseStatus({ status: "parsing" });
    expect(getEditorState().parseStatus).toEqual({ status: "parsing" });
    setParseStatus({ status: "ready", schematic: sampleParsed });
    expect(getEditorState().parseStatus).toEqual({
      status: "ready",
      schematic: sampleParsed,
    });
    setParseStatus({ status: "error", error: "boom" });
    expect(getEditorState().parseStatus).toEqual({
      status: "error",
      error: "boom",
    });
  });

  it("replacing the staged file resets a stale parse result", () => {
    setStagedFile(sampleStaged);
    setParseStatus({ status: "ready", schematic: sampleParsed });
    setStagedFile({
      bytes: new Uint8Array([4, 5, 6]),
      filename: "other.litematic",
      inputFormat: "Litematic",
    });
    expect(getEditorState().parseStatus).toEqual({ status: "idle" });
  });

  it("applyBlockSwap is a no-op when there is no ready parse", () => {
    expect(
      applyBlockSwap("minecraft:stone", {
        blockId: "minecraft:dirt",
        properties: {},
      }),
    ).toBe(false);
    expect(getEditorState().lastSwapSnapshot).toBeNull();
  });

  it("applyBlockSwap mutates the ready projection and stashes a snapshot", () => {
    const projection: ParsedSchematicProjection = {
      name: "build",
      inputFormat: "Litematic",
      minecraftVersion: {
        platform: "java",
        versionNumber: [1, 20, 1],
        dataVersion: 3463,
      },
      totalBlocks: 2,
      palette: [
        {
          blockState: "minecraft:stone",
          blockId: "minecraft:stone",
          properties: {},
          count: 1,
        },
        {
          blockState: "minecraft:dirt",
          blockId: "minecraft:dirt",
          properties: {},
          count: 1,
        },
      ],
      regions: [
        {
          origin: [0, 0, 0],
          size: [2, 1, 1],
          blocks: [
            { pos: [0, 0, 0], paletteIndex: 0 },
            { pos: [1, 0, 0], paletteIndex: 1 },
          ],
        },
      ],
    };
    setParseStatus({ status: "ready", schematic: projection });
    const applied = applyBlockSwap("minecraft:stone", {
      blockId: "minecraft:cobblestone",
      properties: {},
    });
    expect(applied).toBe(true);

    const after = getEditorState();
    expect(after.lastSwapSnapshot).toBe(projection);
    if (after.parseStatus.status !== "ready") throw new Error("expected ready");
    const palette = after.parseStatus.schematic.palette;
    expect(palette.map((e) => e.blockId).sort()).toEqual([
      "minecraft:cobblestone",
      "minecraft:dirt",
    ]);
    // Counts preserved across the swap.
    const cobblesIdx = palette.findIndex(
      (e) => e.blockId === "minecraft:cobblestone",
    );
    expect(palette[cobblesIdx].count).toBe(1);
  });

  it("applyVersionMapping is a no-op when there is no ready parse", () => {
    const targetVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 17, 1],
      dataVersion: 2730,
    };
    expect(applyVersionMapping(targetVersion)).toBe(false);
    expect(getEditorState().lastTranslationSnapshot).toBeNull();
  });

  it("applyVersionMapping translates the schematic, stashes a snapshot, and bumps the version", () => {
    const sourceVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 16, 5],
      dataVersion: 2586,
    };
    const targetVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 17, 1],
      dataVersion: 2730,
    };
    const projection: ParsedSchematicProjection = {
      name: "build",
      inputFormat: "Litematic",
      minecraftVersion: sourceVersion,
      totalBlocks: 1,
      palette: [
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          properties: {},
          count: 1,
        },
      ],
      regions: [
        {
          origin: [0, 0, 0],
          size: [1, 1, 1],
          blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
        },
      ],
    };
    setParseStatus({ status: "ready", schematic: projection });
    expect(applyVersionMapping(targetVersion)).toBe(true);

    const after = getEditorState();
    expect(after.lastTranslationSnapshot).toBe(projection);
    if (after.parseStatus.status !== "ready") throw new Error("expected ready");
    expect(after.parseStatus.schematic.minecraftVersion).toEqual(targetVersion);
    // 1.16.5 → 1.17.1 renames grass_path to dirt_path.
    expect(after.parseStatus.schematic.palette.map((e) => e.blockId)).toEqual([
      "minecraft:dirt_path",
    ]);
  });

  it("applyVersionMapping honours per-state overrides", () => {
    const sourceVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 16, 5],
      dataVersion: 2586,
    };
    const targetVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 17, 1],
      dataVersion: 2730,
    };
    const projection: ParsedSchematicProjection = {
      name: "build",
      inputFormat: "Litematic",
      minecraftVersion: sourceVersion,
      totalBlocks: 1,
      palette: [
        {
          blockState: "minecraft:grass_path",
          blockId: "minecraft:grass_path",
          properties: {},
          count: 1,
        },
      ],
      regions: [
        {
          origin: [0, 0, 0],
          size: [1, 1, 1],
          blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
        },
      ],
    };
    setParseStatus({ status: "ready", schematic: projection });
    applyVersionMapping(targetVersion, {
      "minecraft:grass_path": {
        blockId: "minecraft:cobblestone",
        properties: {},
      },
    });

    const after = getEditorState();
    if (after.parseStatus.status !== "ready") throw new Error("expected ready");
    expect(after.parseStatus.schematic.palette.map((e) => e.blockId)).toEqual([
      "minecraft:cobblestone",
    ]);
  });

  it("undoLastTranslation restores the pre-translation projection and clears the snapshot", () => {
    const sourceVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 16, 5],
      dataVersion: 2586,
    };
    const targetVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 17, 1],
      dataVersion: 2730,
    };
    const projection: ParsedSchematicProjection = {
      name: "build",
      inputFormat: "Litematic",
      minecraftVersion: sourceVersion,
      totalBlocks: 1,
      palette: [
        {
          blockState: "minecraft:stone",
          blockId: "minecraft:stone",
          properties: {},
          count: 1,
        },
      ],
      regions: [
        {
          origin: [0, 0, 0],
          size: [1, 1, 1],
          blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
        },
      ],
    };
    setParseStatus({ status: "ready", schematic: projection });
    applyVersionMapping(targetVersion);
    expect(undoLastTranslation()).toBe(true);
    const s = getEditorState();
    if (s.parseStatus.status !== "ready") throw new Error("expected ready");
    expect(s.parseStatus.schematic).toBe(projection);
    expect(s.lastTranslationSnapshot).toBeNull();
    expect(undoLastTranslation()).toBe(false);
  });

  it("applyVersionMapping discards a stale swap-undo snapshot", () => {
    const sourceVersion: MinecraftVersion = {
      platform: "java",
      versionNumber: [1, 20, 1],
      dataVersion: 3463,
    };
    const projection: ParsedSchematicProjection = {
      name: "build",
      inputFormat: "Litematic",
      minecraftVersion: sourceVersion,
      totalBlocks: 1,
      palette: [
        {
          blockState: "minecraft:stone",
          blockId: "minecraft:stone",
          properties: {},
          count: 1,
        },
      ],
      regions: [
        {
          origin: [0, 0, 0],
          size: [1, 1, 1],
          blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
        },
      ],
    };
    setParseStatus({ status: "ready", schematic: projection });
    applyBlockSwap("minecraft:stone", {
      blockId: "minecraft:dirt",
      properties: {},
    });
    expect(getEditorState().lastSwapSnapshot).not.toBeNull();
    applyVersionMapping(sourceVersion);
    expect(getEditorState().lastSwapSnapshot).toBeNull();
  });

  it("undoLastSwap restores the prior projection and clears the snapshot", () => {
    const projection: ParsedSchematicProjection = {
      name: "build",
      inputFormat: "Litematic",
      minecraftVersion: {
        platform: "java",
        versionNumber: [1, 20, 1],
        dataVersion: 3463,
      },
      totalBlocks: 1,
      palette: [
        {
          blockState: "minecraft:stone",
          blockId: "minecraft:stone",
          properties: {},
          count: 1,
        },
      ],
      regions: [
        {
          origin: [0, 0, 0],
          size: [1, 1, 1],
          blocks: [{ pos: [0, 0, 0], paletteIndex: 0 }],
        },
      ],
    };
    setParseStatus({ status: "ready", schematic: projection });
    applyBlockSwap("minecraft:stone", {
      blockId: "minecraft:dirt",
      properties: {},
    });
    expect(undoLastSwap()).toBe(true);
    const s = getEditorState();
    if (s.parseStatus.status !== "ready") throw new Error("expected ready");
    expect(s.parseStatus.schematic).toBe(projection);
    expect(s.lastSwapSnapshot).toBeNull();
    expect(undoLastSwap()).toBe(false);
  });
});
