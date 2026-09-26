import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ParsedSchematicProjection } from "../../convert";
import {
  __resetEditorStateForTests,
  clearEditorState,
  setStagedFile,
} from "../../editor-state";
import {
  getEffectiveModVersion,
  knownVersionIdFor,
} from "../effective-mod-version";
import {
  __resetAdvancedTargetVersionForTests,
  getAdvancedTargetVersion,
  setAdvancedTargetVersion,
  subscribeAdvancedTargetVersion,
} from "../target-version-state";

function projectionAt(
  versionNumber: [number, number, number],
  dataVersion: number,
): Pick<ParsedSchematicProjection, "minecraftVersion"> {
  return { minecraftVersion: { platform: "java", versionNumber, dataVersion } };
}

describe("advanced target version store", () => {
  beforeEach(() => {
    __resetAdvancedTargetVersionForTests();
    __resetEditorStateForTests();
  });

  it("defaults to null", () => {
    expect(getAdvancedTargetVersion()).toBeNull();
  });

  it("sets the value and notifies subscribers", () => {
    const listener = vi.fn();
    subscribeAdvancedTargetVersion(listener);
    setAdvancedTargetVersion("1.20.1");
    expect(getAdvancedTargetVersion()).toBe("1.20.1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the value is unchanged", () => {
    setAdvancedTargetVersion("1.20.1");
    const listener = vi.fn();
    subscribeAdvancedTargetVersion(listener);
    setAdvancedTargetVersion("1.20.1");
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAdvancedTargetVersion(listener);
    unsubscribe();
    setAdvancedTargetVersion("1.21");
    expect(listener).not.toHaveBeenCalled();
  });

  it("resets when a new file is staged or the editor is cleared", () => {
    setAdvancedTargetVersion("1.20.1");
    setStagedFile({
      bytes: new Uint8Array([1]),
      filename: "a.litematic",
      inputFormat: "Litematic",
    });
    expect(getAdvancedTargetVersion()).toBeNull();

    setAdvancedTargetVersion("1.20.1");
    clearEditorState();
    expect(getAdvancedTargetVersion()).toBeNull();
  });
});

describe("getEffectiveModVersion", () => {
  it("returns the target version when set", () => {
    expect(
      getEffectiveModVersion("1.21", projectionAt([1, 20, 1], 3465)),
    ).toEqual({ versionId: "1.21", isFallback: false });
  });

  it("falls back to the schematic's source version key", () => {
    expect(
      getEffectiveModVersion(null, projectionAt([1, 20, 1], 3465)),
    ).toEqual({ versionId: "1.20.1", isFallback: true });
  });

  it("maps x.y.0 source versions to their KNOWN_VERSIONS key", () => {
    expect(
      getEffectiveModVersion(null, projectionAt([1, 20, 0], 3463)),
    ).toEqual({ versionId: "1.20", isFallback: true });
  });

  it("formats unknown versions without a trailing .0", () => {
    expect(
      knownVersionIdFor(projectionAt([1, 99, 0], 1).minecraftVersion),
    ).toBe("1.99");
  });
});
