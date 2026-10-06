import { describe, expect, it } from "vitest";
import type { BlockData } from "../../blockdata/load";
import type { ModpackBlocks } from "../../modpacks/registry";
import type { ModpackData } from "../../modpacks/schema";
import { scopeNote, type SearchScope } from "../block-tools";

function scope(data: Partial<ModpackData>): SearchScope {
  return {
    versionId: "1.21.1",
    data: {} as BlockData,
    registry: {} as SearchScope["registry"],
    modpack: {
      data: { runtimeBlockSources: [], ...data },
    } as unknown as ModpackBlocks,
  };
}

const RUNTIME: ModpackData["runtimeBlockSources"] = [
  { kind: "kubejs", name: "kubejs", message: "" },
  {
    kind: "generated-block-provider",
    name: "Every Compat",
    message: "",
  },
];

describe("scopeNote", () => {
  it("says runtime blocks aren't listed without a block list", () => {
    expect(scopeNote(scope({ runtimeBlockSources: RUNTIME }))).toBe(
      "This pack also registers blocks at runtime, which aren't listed: kubejs, Every Compat.",
    );
  });

  it("says runtime blocks are included with a block list", () => {
    expect(
      scopeNote(
        scope({
          runtimeBlockSources: RUNTIME,
          blockList: { blocks: 10, sha256: "0".repeat(64) },
        }),
      ),
    ).toBe(
      "A server block list was applied, so blocks this pack registers at runtime (kubejs, Every Compat) are included; those with visual_info: false have no visual information.",
    );
  });

  it("has no note without runtime sources", () => {
    expect(scopeNote(scope({}))).toBeUndefined();
    expect(
      scopeNote(scope({ blockList: { blocks: 1, sha256: "0".repeat(64) } })),
    ).toBeUndefined();
  });
});
