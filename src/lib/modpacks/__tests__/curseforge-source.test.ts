import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  withCurseForgePack,
  type CurseForgePackOptions,
  type FetchLike,
} from "../curseforge-source";
import { extractModpack } from "../extract";
import { encodeRgbaPng } from "../png";

const API = "https://api.curseforge.com";
const CDN = "https://edge.forgecdn.net";
const json = (value: unknown) => strToU8(JSON.stringify(value));

/** A mod jar with one full-cube block `<ns>:<ns>_block`. */
function modJar(ns: string): Uint8Array<ArrayBuffer> {
  const png = new Uint8Array(16 * 16 * 4).fill(200);
  return zipSync({
    [`assets/${ns}/blockstates/${ns}_block.json`]: json({
      variants: { "": { model: `${ns}:block/${ns}_block` } },
    }),
    [`assets/${ns}/models/block/${ns}_block.json`]: json({
      parent: "minecraft:block/cube_all",
      textures: { all: `${ns}:block/${ns}_block` },
    }),
    [`assets/${ns}/textures/block/${ns}_block.png`]: encodeRgbaPng(16, 16, png),
  });
}

const PROJECT = {
  id: 500,
  gameId: 432,
  classId: 4471,
  name: "Test Pack",
  slug: "test-pack",
};

const MANIFEST = {
  minecraft: {
    version: "1.21.1",
    modLoaders: [{ id: "neoforge-21.1.77", primary: true }],
  },
  manifestType: "minecraftModpack",
  name: "Test Pack",
  version: "2.0",
  overrides: "overrides",
  files: [
    { projectID: 11, fileID: 1101, required: true },
    { projectID: 12, fileID: 1201, required: true },
    { projectID: 13, fileID: 1301, required: true },
    { projectID: 14, fileID: 1401, required: true },
    { projectID: 15, fileID: 1501, required: true },
    { projectID: 16, fileID: 1601, required: true },
    { projectID: 17, fileID: 1701, required: false },
  ],
};

function packZip(): Uint8Array<ArrayBuffer> {
  return zipSync({
    "manifest.json": json(MANIFEST),
    "overrides/mods/local-mod.jar": modJar("local"),
    "overrides/kubejs/startup_scripts/blocks.js": strToU8("// blocks"),
    "overrides/config/x.toml": strToU8("x = 1"),
  });
}

const MB = 1024 * 1024;

function file(
  id: number,
  modId: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    modId,
    displayName: `File ${id}`,
    fileName: `mod-${id}.jar`,
    fileLength: 1000,
    fileDate: "2026-01-01T00:00:00Z",
    downloadUrl: `${CDN}/files/${id}/mod-${id}.jar`,
    isServerPack: false,
    ...extra,
  };
}

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** A fake CurseForge API + CDN. */
function fakeCurseForge() {
  const calls: Call[] = [];
  let flaky = 0;
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: input, body });
    const ok = (data: unknown) => Response.json(data);
    if (url.origin === API) {
      expect(new Headers(init?.headers).get("x-api-key")).toBe("key");
      const p = url.pathname;
      if (p === "/v1/mods/search") {
        expect(url.searchParams.get("gameId")).toBe("432");
        expect(url.searchParams.get("classId")).toBe("4471");
        return ok({
          data: url.searchParams.get("slug") === "test-pack" ? [PROJECT] : [],
        });
      }
      if (p === "/v1/mods/500") return ok({ data: PROJECT });
      if (p === "/v1/mods/600") {
        return ok({ data: { ...PROJECT, id: 600, classId: 6 } });
      }
      if (p === "/v1/mods/500/files") {
        return ok({
          data: [
            file(700, 500, {
              displayName: "Test Pack 1.0",
              fileDate: "2026-01-01T00:00:00Z",
              downloadUrl: `${CDN}/files/700/pack.zip`,
            }),
            file(702, 500, {
              fileDate: "2026-03-01T00:00:00Z",
              isServerPack: true,
            }),
            file(701, 500, {
              displayName: "Test Pack 2.0",
              fileDate: "2026-02-01T00:00:00Z",
              downloadUrl: `${CDN}/files/701/pack.zip`,
            }),
          ],
          pagination: { index: 0, pageSize: 50, resultCount: 3, totalCount: 3 },
        });
      }
      if (p === "/v1/mods/500/files/700") {
        return ok({
          data: file(700, 500, { downloadUrl: `${CDN}/files/700/pack.zip` }),
        });
      }
      if (p === "/v1/mods/files" && method === "POST") {
        const all: Record<number, unknown> = {
          // Downloads through a redirect to the other CDN host.
          1101: file(1101, 11, {
            fileLength: 100,
            downloadUrl: `https://mediafilez.forgecdn.net/files/1101/brass.jar`,
          }),
          // Author disallows distribution.
          1201: file(1201, 12, { downloadUrl: null }),
          // Listed as too large.
          1301: file(1301, 13, { fileLength: 5 * MB }),
          // A resource pack.
          1401: file(1401, 14),
          // The CDN fails once, then serves it.
          1501: file(1501, 15),
          // Points off the CDN allowlist.
          1601: file(1601, 16, {
            downloadUrl: "https://evil.example.com/x.jar",
          }),
        };
        return ok({
          data: (body as { fileIds: number[] }).fileIds
            .map((id) => all[id])
            .filter(Boolean),
        });
      }
      if (p === "/v1/mods" && method === "POST") {
        const names: Record<number, [string, number]> = {
          11: ["Brass", 6],
          12: ["Hidden Mod", 6],
          13: ["Huge Mod", 6],
          14: ["Pretty Textures", 12],
          15: ["Flaky Mod", 6],
          16: ["Evil Mod", 6],
        };
        return ok({
          data: (body as { modIds: number[] }).modIds.map((id) => ({
            id,
            name: names[id][0],
            classId: names[id][1],
          })),
        });
      }
      return new Response("not found", { status: 404 });
    }
    expect(init?.redirect).toBe("manual");
    if (input === "https://mediafilez.forgecdn.net/files/1101/brass.jar") {
      return new Response(null, {
        status: 302,
        headers: { Location: `${CDN}/files/1101/brass.jar` },
      });
    }
    if (input === `${CDN}/files/1101/brass.jar`) {
      return new Response(modJar("brass"));
    }
    if (input === `${CDN}/files/1501/mod-1501.jar`) {
      if (flaky++ === 0) {
        return new Response("busy", {
          status: 503,
          headers: { "Retry-After": "1" },
        });
      }
      return new Response(modJar("flaky"));
    }
    if (input === `${CDN}/files/701/pack.zip`) return new Response(packZip());
    if (input === `${CDN}/files/700/pack.zip`) return new Response(packZip());
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls };
}

describe("CurseForge pack source", () => {
  let tempRoot: string;
  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "cf-source-test-"));
  });
  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function options(
    fake: ReturnType<typeof fakeCurseForge>,
    extra: Partial<CurseForgePackOptions> = {},
  ): CurseForgePackOptions {
    return {
      apiKey: "key",
      project: "test-pack",
      maxJarBytes: MB,
      tempRoot,
      fetch: fake.fetch,
      sleep: async () => {},
      ...extra,
    };
  }

  it("downloads the latest pack file and its mods and gives each a status", async () => {
    const fake = fakeCurseForge();
    const sleeps: number[] = [];
    const extraction = await withCurseForgePack(
      options(fake, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
      async (source) => {
        // Jars are held in the run's temp directory while it's in use.
        expect(readdirSync(tempRoot)).toHaveLength(1);
        return extractModpack(source, { vanilla: null });
      },
    );
    // …which is removed afterwards.
    expect(readdirSync(tempRoot)).toEqual([]);

    const { data } = extraction;
    expect(data).toMatchObject({
      slug: "test-pack",
      name: "Test Pack",
      curseForgeProjectId: 500,
      version: {
        key: "cf-701",
        packFileId: 701,
        displayVersion: "2.0",
        minecraftVersion: "1.21.1",
        loader: "neoforge",
      },
      runtimeBlockSources: [{ kind: "kubejs" }],
    });
    const mods = Object.fromEntries(data.mods.map((m) => [m.name, m]));
    expect(Object.keys(mods).sort()).toEqual([
      "Brass",
      "Evil Mod",
      "Flaky Mod",
      "Hidden Mod",
      "Huge Mod",
      "local-mod",
    ]);
    expect(mods.Brass).toMatchObject({
      key: "cf-1101",
      curseForgeProjectId: 11,
      curseForgeFileId: 1101,
      fileName: "mod-1101.jar",
      status: "ok",
    });
    expect(mods["Hidden Mod"]).toMatchObject({
      key: "cf-1201",
      status: "skipped-undistributable",
    });
    expect(mods["Hidden Mod"].message).toMatch(/--instance/);
    expect(mods["Huge Mod"]).toMatchObject({ status: "skipped-too-large" });
    expect(mods["Flaky Mod"]).toMatchObject({ status: "ok" });
    expect(sleeps).toEqual([1000]);
    expect(mods["Evil Mod"]).toMatchObject({ status: "failed" });
    expect(mods["Evil Mod"].message).toMatch(/isn't a CurseForge CDN host/);
    expect(mods["local-mod"]).toMatchObject({ status: "ok" });
    expect(mods["local-mod"].key).toMatch(/^sha256-/);
    expect(data.blocks.map((b) => b.id)).toEqual([
      "brass:brass_block",
      "flaky:flaky_block",
      "local:local_block",
    ]);
    expect(extraction.warnings.join("\n")).toMatch(/Pretty Textures/);

    // The undistributable and too-large files were never requested, nor was
    // anything off the allowlist.
    const fetched = fake.calls.map((c) => c.url);
    expect(fetched.some((u) => u.includes("/files/1201/"))).toBe(false);
    expect(fetched.some((u) => u.includes("/files/1301/"))).toBe(false);
    expect(fetched.some((u) => u.includes("evil.example.com"))).toBe(false);
    expect(fetched.some((u) => u.includes("/files/1401/"))).toBe(false);
  });

  it("takes the project by id and a pinned file", async () => {
    const fake = fakeCurseForge();
    const source = await withCurseForgePack(
      options(fake, { project: "500", fileId: 700 }),
      async (s) => s,
    );
    expect(source).toMatchObject({ packFileId: 700, curseForgeProjectId: 500 });
    expect(fake.calls.map((c) => new URL(c.url).pathname)).toContain(
      "/v1/mods/500/files/700",
    );
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("marks jars over the cap found mid-download as too large", async () => {
    const fake = fakeCurseForge();
    const { data } = await withCurseForgePack(
      // The brass jar is listed as 100 bytes but is bigger.
      options(fake, { maxJarBytes: 200 }),
      (source) => extractModpack(source, { vanilla: null }),
    );
    const statuses = Object.fromEntries(
      data.mods.map((m) => [m.name, m.status]),
    );
    // Real jar bytes exceed the cap even though the listing said 100.
    expect(statuses.Brass).toBe("skipped-too-large");
    expect(statuses["local-mod"]).toBe("skipped-too-large");
  });

  it("rejects projects that aren't modpacks and unknown slugs", async () => {
    const fake = fakeCurseForge();
    await expect(
      withCurseForgePack(options(fake, { project: "600" }), async () => 0),
    ).rejects.toThrow(/isn't a Minecraft modpack/);
    await expect(
      withCurseForgePack(options(fake, { project: "nope" }), async () => 0),
    ).rejects.toThrow(/no modpack with the slug "nope"/);
  });

  it("removes the temp directory when the upload fails", async () => {
    const fake = fakeCurseForge();
    await expect(
      withCurseForgePack(options(fake), async () => {
        throw new Error("upload failed");
      }),
    ).rejects.toThrow("upload failed");
    expect(readdirSync(tempRoot)).toEqual([]);
  });
});
