import { gzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanupExpiredOutputs } from "@/lib/mcp/cleanup";
import { OUTPUT_PREFIX, OUTPUT_TTL_MS } from "@/lib/mcp/output";
import { createFakeBlob, type FakeBlob } from "@/lib/mcp/__tests__/fake-blob";
import {
  MODPACK_BLOB_PREFIXES,
  modFileSwatchesPath,
  modpackDataPath,
  modpackIndexPath,
} from "../paths";
import {
  clearModpackCache,
  encodeModpackData,
  loadModpack,
  loadModpackIndex,
  resolveModpack,
} from "../reader";
import { parseModpackRef } from "../ref";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackData,
  type ModpackIndex,
} from "../schema";

const NOW = new Date("2026-10-06T12:00:00.000Z");

function version(
  key: string,
  packFileId: number | null,
  displayVersion: string,
  uploadedAt: string,
) {
  return {
    key,
    packFileId,
    displayVersion,
    minecraftVersion: "1.21.1",
    loader: "neoforge" as const,
    modCount: 1,
    uploadedAt,
  };
}

const INDEX: ModpackIndex = {
  formatVersion: MODPACK_FORMAT_VERSION,
  packs: [
    {
      slug: "all-the-mods-10",
      name: "All the Mods 10",
      curseForgeProjectId: 925200,
      versions: [
        version("cf-5000001", 5000001, "4.11", "2026-09-01T00:00:00.000Z"),
        version("cf-5678901", 5678901, "4.12", "2026-10-01T00:00:00.000Z"),
        version("cf-5100000", 5100000, "4.10", "2026-08-01T00:00:00.000Z"),
      ],
    },
  ],
};

function packData(key: string): ModpackData {
  const v = INDEX.packs[0].versions.find((x) => x.key === key)!;
  return {
    formatVersion: MODPACK_FORMAT_VERSION,
    slug: "all-the-mods-10",
    name: "All the Mods 10",
    curseForgeProjectId: 925200,
    version: v,
    mods: [
      {
        key: "cf-6000001",
        name: "Create",
        curseForgeProjectId: 328085,
        curseForgeFileId: 6000001,
        fileName: "create-1.21.1-6.0.6.jar",
        namespaces: ["create"],
        status: "ok",
        hasSwatches: true,
      },
    ],
    blocks: [
      {
        id: "create:brass_block",
        mod: "cf-6000001",
        displayName: "Brass Block",
        properties: {},
        defaults: {},
        kind: "block",
        fullCube: true,
        appearance: {
          average: "#c8a046",
          oklab: [0.74, 0.02, 0.12],
          dominant: [{ color: "#d0a848", share: 0.7 }],
          variance: 0.1,
        },
        swatch: { file: "cf-6000001", faces: { side: [0, 0, 16, 16] } },
      },
    ],
    runtimeBlockSources: [],
  };
}

function seed(blob: FakeBlob, index: unknown = INDEX) {
  blob.objects.set(modpackIndexPath(), {
    body: new TextEncoder().encode(JSON.stringify(index)),
    uploadedAt: NOW,
  });
  for (const v of INDEX.packs[0].versions) {
    blob.objects.set(modpackDataPath("all-the-mods-10", v.key), {
      body: encodeModpackData(packData(v.key)),
      uploadedAt: NOW,
    });
  }
}

function gets(blob: FakeBlob): unknown[] {
  return blob.calls.filter((c) => c.method === "get").map((c) => c.args[0]);
}

let blob: FakeBlob;
beforeEach(() => {
  clearModpackCache();
  blob = createFakeBlob(() => NOW);
  seed(blob);
});

describe("parseModpackRef", () => {
  it("parses a bare slug as the latest version", () => {
    expect(parseModpackRef("all-the-mods-10")).toEqual({
      slug: "all-the-mods-10",
      version: null,
    });
  });

  it("parses a pinned file id or display version", () => {
    expect(parseModpackRef("all-the-mods-10@5678901")).toEqual({
      slug: "all-the-mods-10",
      version: "5678901",
    });
    expect(parseModpackRef("all-the-mods-10@4.12")).toEqual({
      slug: "all-the-mods-10",
      version: "4.12",
    });
  });

  it.each([
    "",
    "All The Mods",
    "all-the-mods-10@",
    "@4.12",
    "all-the-mods-10@4.12@1",
    "../modpacks",
    "atm--10",
  ])("rejects %j naming the expected form", (ref) => {
    expect(() => parseModpackRef(ref)).toThrow(
      /Expected '<slug>' or '<slug>@<pack file id or version>'/,
    );
  });
});

describe("resolveModpack", () => {
  it("picks the latest upload when no version is given", async () => {
    const resolved = await resolveModpack("all-the-mods-10", blob);
    expect(resolved.pack.slug).toBe("all-the-mods-10");
    expect(resolved.version.key).toBe("cf-5678901");
  });

  it("matches a pinned version by pack file id or display version", async () => {
    expect(
      (await resolveModpack("all-the-mods-10@5000001", blob)).version.key,
    ).toBe("cf-5000001");
    expect(
      (await resolveModpack("all-the-mods-10@4.10", blob)).version.key,
    ).toBe("cf-5100000");
  });

  it.each(["no-such-pack", "all-the-mods-10@9999999", "all-the-mods-10@4.0"])(
    "throws for unknown %s",
    async (ref) => {
      await expect(resolveModpack(ref, blob)).rejects.toThrow(
        `Unknown modpack '${ref}'. Call list_modpacks for the uploaded packs.`,
      );
    },
  );

  it("treats a missing index as no uploaded packs", async () => {
    const empty = createFakeBlob(() => NOW);
    await expect(resolveModpack("all-the-mods-10", empty)).rejects.toThrow(
      /Unknown modpack 'all-the-mods-10'/,
    );
  });

  it("caches the index briefly", async () => {
    await resolveModpack("all-the-mods-10", blob);
    await resolveModpack("all-the-mods-10@4.11", blob);
    expect(gets(blob)).toEqual([modpackIndexPath()]);
  });

  it("re-reads the index after the cache expires", async () => {
    let t = 0;
    await loadModpackIndex(blob, () => t);
    t = 60_000;
    await loadModpackIndex(blob, () => t);
    expect(gets(blob)).toHaveLength(2);
  });

  it("rejects an index with another format version", async () => {
    seed(blob, { ...INDEX, formatVersion: 99 });
    await expect(resolveModpack("all-the-mods-10", blob)).rejects.toThrow(
      /format version 99, but this server reads version 1/,
    );
  });
});

describe("loadModpack", () => {
  it("reads, gunzips and validates pack.json.gz", async () => {
    const resolved = await resolveModpack("all-the-mods-10", blob);
    const data = await loadModpack(resolved, blob);
    expect(data).toEqual(packData("cf-5678901"));
    expect(gets(blob)).toContain(
      "modpacks/all-the-mods-10/cf-5678901/pack.json.gz",
    );
  });

  it("does no Blob read on a second call", async () => {
    const resolved = await resolveModpack("all-the-mods-10", blob);
    const first = await loadModpack(resolved, blob);
    const before = gets(blob).length;
    const second = await loadModpack(resolved, blob);
    expect(second).toBe(first);
    expect(gets(blob)).toHaveLength(before);
  });

  it("rejects a pack.json.gz with another format version", async () => {
    const resolved = await resolveModpack("all-the-mods-10", blob);
    const body = gzipSync(
      new TextEncoder().encode(
        JSON.stringify({ ...packData("cf-5678901"), formatVersion: 2 }),
      ),
    );
    blob.objects.set(modpackDataPath("all-the-mods-10", "cf-5678901"), {
      body,
      uploadedAt: NOW,
    });
    await expect(loadModpack(resolved, blob)).rejects.toThrow(
      /format version 2, but this server reads version 1\. Re-upload/,
    );
  });

  it("rejects data that doesn't match the schema, naming the field", async () => {
    const resolved = await resolveModpack("all-the-mods-10", blob);
    const bad = packData("cf-5678901");
    (bad.blocks[0] as { kind: string }).kind = "spaceship";
    blob.objects.set(modpackDataPath("all-the-mods-10", "cf-5678901"), {
      body: gzipSync(new TextEncoder().encode(JSON.stringify(bad))),
      uploadedAt: NOW,
    });
    await expect(loadModpack(resolved, blob)).rejects.toThrow(
      /is invalid at blocks\.0\.kind/,
    );
  });

  it("does not cache a failed read", async () => {
    const resolved = await resolveModpack("all-the-mods-10", blob);
    const path = modpackDataPath("all-the-mods-10", "cf-5678901");
    const body = blob.objects.get(path)!;
    blob.objects.delete(path);
    await expect(loadModpack(resolved, blob)).rejects.toThrow(/missing/);
    blob.objects.set(path, body);
    await expect(loadModpack(resolved, blob)).resolves.toMatchObject({
      slug: "all-the-mods-10",
    });
  });

  it("rejects bytes that aren't gzip", async () => {
    const resolved = await resolveModpack("all-the-mods-10", blob);
    blob.objects.set(modpackDataPath("all-the-mods-10", "cf-5678901"), {
      body: new TextEncoder().encode("{}"),
      uploadedAt: NOW,
    });
    await expect(loadModpack(resolved, blob)).rejects.toThrow(
      /could not be gunzipped/,
    );
  });
});

describe("modpack Blob paths", () => {
  it("never start with the MCP output prefix", () => {
    const paths = [
      modpackIndexPath(),
      modpackDataPath("all-the-mods-10", "cf-5678901"),
      modFileSwatchesPath("sha256-abc123"),
      ...MODPACK_BLOB_PREFIXES,
    ];
    for (const path of paths)
      expect(path.startsWith(OUTPUT_PREFIX)).toBe(false);
  });

  it("reject keys that would escape their folder", () => {
    expect(() => modpackDataPath("all-the-mods-10", "../x")).toThrow();
    expect(() => modpackDataPath("../mcp", "cf-1")).toThrow();
    expect(() => modFileSwatchesPath("a/b")).toThrow();
  });

  it("are never listed or deleted by the cleanup cron", async () => {
    const old = new Date(NOW.getTime() - 10 * OUTPUT_TTL_MS);
    for (const [path, object] of blob.objects) {
      blob.objects.set(path, { ...object, uploadedAt: old });
    }
    blob.objects.set(modFileSwatchesPath("cf-6000001"), {
      body: new Uint8Array(),
      uploadedAt: old,
    });
    const stored = [...blob.objects.keys()];
    blob.calls.length = 0;
    await cleanupExpiredOutputs({ blob, now: () => NOW });
    expect([...blob.objects.keys()]).toEqual(stored);
    for (const call of blob.calls) {
      if (call.method === "list") {
        const { prefix } = call.args[0] as { prefix: string };
        for (const p of MODPACK_BLOB_PREFIXES) {
          expect(p.startsWith(prefix)).toBe(false);
          expect(prefix.startsWith(p)).toBe(false);
        }
      }
      expect(call.method).not.toBe("del");
    }
  });
});
