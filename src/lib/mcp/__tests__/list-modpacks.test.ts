import { beforeEach, describe, expect, it, vi } from "vitest";
import { modpackDataPath, modpackIndexPath } from "@/lib/modpacks/paths";
import { clearModpackCache, encodeModpackData } from "@/lib/modpacks/reader";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackData,
  type ModpackIndex,
  type ModpackIndexVersion,
  type ModpackMod,
} from "@/lib/modpacks/schema";
import {
  listModpacksTool,
  modpackAbbreviations,
  modpackMatches,
} from "../list-modpacks";
import { TOOLS, runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-06T12:00:00.000Z");

function version(
  key: string,
  packFileId: number | null,
  displayVersion: string,
  uploadedAt: string,
): ModpackIndexVersion {
  return {
    key,
    packFileId,
    displayVersion,
    minecraftVersion: "1.21.1",
    loader: "neoforge",
    modCount: 4,
    uploadedAt,
  };
}

const ATM10_OLD = version("cf-100", 100, "4.10", "2026-09-01T00:00:00.000Z");
const ATM10_NEW = version("cf-200", 200, "4.12", "2026-10-01T00:00:00.000Z");
const LOCAL = version("v-dev", null, "dev", "2026-10-02T00:00:00.000Z");

const INDEX: ModpackIndex = {
  formatVersion: MODPACK_FORMAT_VERSION,
  packs: [
    {
      slug: "all-the-mods-10",
      name: "All the Mods 10",
      curseForgeProjectId: 925200,
      versions: [ATM10_OLD, ATM10_NEW],
    },
    {
      slug: "my-test-pack",
      name: "My Test Pack",
      curseForgeProjectId: null,
      versions: [LOCAL],
    },
  ],
};

function mod(key: string, status: ModpackMod["status"]): ModpackMod {
  return {
    key,
    name: key,
    curseForgeProjectId: null,
    curseForgeFileId: null,
    fileName: `${key}.jar`,
    namespaces: [],
    status,
    hasSwatches: false,
  };
}

const ATM10_DATA: ModpackData = {
  formatVersion: MODPACK_FORMAT_VERSION,
  slug: "all-the-mods-10",
  name: "All the Mods 10",
  curseForgeProjectId: 925200,
  version: ATM10_NEW,
  mods: [
    mod("a", "ok"),
    mod("b", "no-blocks"),
    mod("c", "skipped-undistributable"),
    mod("d", "failed"),
    mod("e", "failed"),
  ],
  blocks: [],
  runtimeBlockSources: [
    { kind: "kubejs", name: "kubejs", message: "KubeJS scripts" },
  ],
};

let blob: FakeBlob;

function deps(): McpDeps {
  return { fetch: vi.fn(), now: () => NOW, blob };
}

function store(path: string, value: unknown, raw = false): void {
  blob.objects.set(path, {
    body: raw
      ? (value as Uint8Array)
      : new TextEncoder().encode(JSON.stringify(value)),
    uploadedAt: NOW,
  });
}

async function call(args: Record<string, unknown>, d: McpDeps = deps()) {
  const result = await runTool(listModpacksTool, args, d);
  expect(result.isError).toBeFalsy();
  return result.structuredContent as {
    packs: Record<string, unknown>[];
    note?: string;
  };
}

beforeEach(() => {
  clearModpackCache();
  blob = createFakeBlob(() => NOW);
});

describe("list_modpacks", () => {
  it("is registered and read-only", () => {
    expect(TOOLS).toContain(listModpacksTool);
    expect(listModpacksTool.annotations?.readOnlyHint).toBe(true);
  });

  it("says nothing is uploaded, without a tool error", async () => {
    const out = await call({});
    expect(out.packs).toEqual([]);
    expect(out.note).toMatch(/No modpacks are uploaded/);
    expect(out.note).toMatch(/operator/);
  });

  it("says modpacks are unavailable without a Blob store", async () => {
    const out = await call({}, { ...deps(), blob: null });
    expect(out.packs).toEqual([]);
    expect(out.note).toMatch(/no Blob store/);
    expect(out.note).toMatch(/operator/);
  });

  it("lists every pack with versions newest first and newest details", async () => {
    store(modpackIndexPath(), INDEX);
    store(
      modpackDataPath("all-the-mods-10", ATM10_NEW.key),
      encodeModpackData(ATM10_DATA),
      true,
    );
    const out = await call({});
    expect(out.note).toBeUndefined();
    expect(out.packs.map((p) => p.slug)).toEqual([
      "all-the-mods-10",
      "my-test-pack",
    ]);
    const atm = out.packs[0];
    expect(atm).toEqual({
      slug: "all-the-mods-10",
      name: "All the Mods 10",
      versions: [
        {
          ref: "all-the-mods-10@200",
          display_version: "4.12",
          minecraft_version: "1.21.1",
          loader: "neoforge",
          mod_count: 4,
          uploaded_at: ATM10_NEW.uploadedAt,
        },
        {
          ref: "all-the-mods-10@100",
          display_version: "4.10",
          minecraft_version: "1.21.1",
          loader: "neoforge",
          mod_count: 4,
          uploaded_at: ATM10_OLD.uploadedAt,
        },
      ],
      skipped_mods: {
        "no-blocks": 1,
        "skipped-undistributable": 1,
        "skipped-too-large": 0,
        failed: 2,
      },
      unsupported_sources: [
        { kind: "kubejs", name: "kubejs", message: "KubeJS scripts" },
      ],
    });
    // The older version's data is never read.
    const reads = blob.calls
      .filter((c) => c.method === "get")
      .map((c) => c.args[0]);
    expect(reads).not.toContain(
      modpackDataPath("all-the-mods-10", ATM10_OLD.key),
    );

    // A pack without a file id is pinned by display version; its missing
    // data is reported on the pack, not as a tool error.
    const local = out.packs[1];
    expect(local.versions).toEqual([
      expect.objectContaining({ ref: "my-test-pack@dev" }),
    ]);
    expect(local.skipped_mods).toBeUndefined();
    expect(local.details_error).toMatch(/missing/);
  });

  it("finds a pack by its initials, slug or name", async () => {
    store(modpackIndexPath(), INDEX);
    for (const query of ["ATM10", "atm", "all the mods", "Mods-10", "MTP"]) {
      const out = await call({ query });
      expect(out.packs.length, query).toBeGreaterThan(0);
    }
    expect((await call({ query: "ATM10" })).packs.map((p) => p.slug)).toEqual([
      "all-the-mods-10",
    ]);
    expect((await call({ query: "test" })).packs.map((p) => p.slug)).toEqual([
      "my-test-pack",
    ]);
  });

  it("says when nothing matches, without a tool error", async () => {
    store(modpackIndexPath(), INDEX);
    const out = await call({ query: "skyfactory" });
    expect(out.packs).toEqual([]);
    expect(out.note).toMatch(/No uploaded modpack matches 'skyfactory'/);
    expect(out.note).toMatch(/all-the-mods-10, my-test-pack/);
    expect(out.note).toMatch(/operator/);
  });
});

describe("modpack abbreviations", () => {
  it("takes initials and keeps numbers whole", () => {
    expect(
      modpackAbbreviations({
        slug: "all-the-mods-10",
        name: "All the Mods 10",
      }),
    ).toEqual(["atm10"]);
    expect(
      modpackAbbreviations({ slug: "skyfactory-4", name: "SkyFactory 4" }),
    ).toEqual(["s4", "sf4"]);
    expect(
      modpackMatches(
        { slug: "all-the-mods-9", name: "All the Mods 9" },
        "ATM10",
      ),
    ).toBe(false);
    expect(
      modpackMatches({ slug: "skyfactory-4", name: "SkyFactory 4" }, "SF4"),
    ).toBe(true);
  });
});
