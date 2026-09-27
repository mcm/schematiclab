import { describe, expect, it } from "vitest";

import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";
import { unappliedTargetVersionId } from "../unapplied-version";

const V1_21 = KNOWN_VERSIONS["1.21"];

describe("unappliedTargetVersionId", () => {
  it("returns the target when it differs from the schematic's version", () => {
    expect(unappliedTargetVersionId("1.16.5", V1_21)).toBe("1.16.5");
  });

  it("is null with no selection", () => {
    expect(unappliedTargetVersionId(null, V1_21)).toBeNull();
  });

  it("is null when the target is the schematic's version", () => {
    expect(unappliedTargetVersionId("1.21", V1_21)).toBeNull();
  });

  it("is null for an unknown version id", () => {
    expect(unappliedTargetVersionId("0.0.1", V1_21)).toBeNull();
  });
});
