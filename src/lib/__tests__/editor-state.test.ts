import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetEditorStateForTests,
  clearEditorState,
  getEditorState,
  setOutputFormat,
  setStagedFile,
  setTargetVersion,
  type StagedFile,
} from "../editor-state";

const sampleStaged: StagedFile = {
  bytes: new Uint8Array([1, 2, 3]),
  filename: "build.litematic",
  inputFormat: "Litematic",
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
    clearEditorState();
    expect(getEditorState()).toEqual({
      stagedFile: null,
      outputFormat: null,
      targetVersion: null,
    });
  });
});
