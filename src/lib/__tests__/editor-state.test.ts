import { beforeEach, describe, expect, it } from "vitest";

import type { ParsedSchematicProjection } from "../convert";
import {
  __resetEditorStateForTests,
  clearEditorState,
  getEditorState,
  setOutputFormat,
  setParseStatus,
  setStagedFile,
  setTargetVersion,
  type StagedFile,
} from "../editor-state";

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
});
