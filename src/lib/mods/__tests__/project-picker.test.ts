import { describe, expect, it, vi } from "vitest";

import type { CurseForgeModSummary } from "../../curseforge/types";
import {
  exactSlugMatch,
  isRestrictedProject,
  mapNamespaceToProject,
} from "../project-picker";

function mod(id: number, slug: string): CurseForgeModSummary {
  return {
    id,
    name: slug,
    slug,
    summary: "",
    authors: [],
    logoThumbnailUrl: `https://example/${slug}.png`,
    downloadCount: 0,
    websiteUrl: null,
    allowModDistribution: true,
  };
}

describe("exactSlugMatch", () => {
  it("returns the result whose slug equals the namespace", () => {
    const results = [mod(1, "create-deco"), mod(2, "create"), mod(3, "x")];
    expect(exactSlugMatch("create", results)?.id).toBe(2);
  });

  it("matches case-insensitively", () => {
    expect(exactSlugMatch("Create", [mod(2, "CREATE")])?.id).toBe(2);
  });

  it("never matches partial or fuzzy slugs", () => {
    const results = [
      mod(1, "create-deco"),
      mod(2, "createaddition"),
      mod(3, "creat"),
      mod(4, "cre-ate"),
      mod(5, "create_"),
    ];
    expect(exactSlugMatch("create", results)).toBeNull();
  });

  it("returns null for no results or an empty namespace", () => {
    expect(exactSlugMatch("create", [])).toBeNull();
    expect(exactSlugMatch("", [mod(1, "")])).toBeNull();
  });

  it("picks the first when several match", () => {
    expect(exactSlugMatch("a", [mod(1, "a"), mod(2, "A")])?.id).toBe(1);
  });

  it("never matches a restricted project", () => {
    const restricted = { ...mod(1, "create"), allowModDistribution: false };
    expect(exactSlugMatch("create", [restricted])).toBeNull();
    expect(exactSlugMatch("create", [restricted, mod(2, "create")])?.id).toBe(
      2,
    );
  });
});

describe("isRestrictedProject", () => {
  it("is true when the author disallows third-party downloads", () => {
    expect(isRestrictedProject({ allowModDistribution: false })).toBe(true);
    expect(isRestrictedProject({ allowModDistribution: true })).toBe(false);
  });
});

describe("mapNamespaceToProject", () => {
  it("records the mapping and starts loading the source-version file", async () => {
    const setMapping = vi.fn(async () => {});
    const startLoad = vi.fn(async () => {});
    const create = mod(328085, "create");

    await mapNamespaceToProject("create", create, "1.20.1", {
      setMapping,
      startLoad,
      now: () => 1234,
    });

    expect(setMapping).toHaveBeenCalledWith({
      namespace: "create",
      modId: 328085,
      modName: "create",
      modSlug: "create",
      logoUrl: "https://example/create.png",
      mappedAt: 1234,
    });
    expect(startLoad).toHaveBeenCalledWith({
      mod: create,
      gameVersion: "1.20.1",
      loader: null,
    });
  });
});
