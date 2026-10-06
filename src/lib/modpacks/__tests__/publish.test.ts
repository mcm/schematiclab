// The index write of `publishModpack` on the Blob store: read from origin,
// written with `ifMatch`, re-merged and retried when another upload got there
// first.

import { beforeEach, describe, expect, it } from "vitest";

import { createFakeBlob, type FakeBlob } from "../../mcp/__tests__/fake-blob";
import type { ModpackExtraction } from "../extract";
import {
  modFileSwatchesPath,
  modpackDataPath,
  modpackIndexPath,
} from "../paths";
import {
  INDEX_CONFLICT_MESSAGE,
  blobModpackStore,
  mergeModpackIndex,
  publishModpack,
  type ModpackBlobApi,
} from "../publish";
import { clearModpackCache, loadModpackIndex } from "../reader";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackData,
  type ModpackIndex,
} from "../schema";
import { fakeModpackBlobApi } from "./fake-modpack-blob";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const INDEX = modpackIndexPath();

function packData(slug: string): ModpackData {
  return {
    formatVersion: MODPACK_FORMAT_VERSION,
    slug,
    name: slug,
    curseForgeProjectId: null,
    version: {
      key: "v-1",
      packFileId: null,
      displayVersion: "1",
      minecraftVersion: "1.21.1",
      loader: "neoforge",
      modCount: 0,
      uploadedAt: NOW.toISOString(),
    },
    mods: [],
    blocks: [],
    runtimeBlockSources: [],
  };
}

function extraction(slug: string): ModpackExtraction {
  return {
    data: packData(slug),
    swatches: new Map([[`${slug}-mod`, new Uint8Array([1, 2, 3])]]),
    nestedJars: [],
    compatPacks: [],
    droppedCompatBlocks: [],
    packSheets: [],
    crossJar: {
      looks: 0,
      redescribed: 0,
      jarsRead: 0,
      unresolved: { count: 0, namespaces: [] },
    },
    warnings: [],
  };
}

function indexBody(index: ModpackIndex): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(index));
}

function emptyIndex(): ModpackIndex {
  return { formatVersion: MODPACK_FORMAT_VERSION, packs: [] };
}

function storedSlugs(blob: FakeBlob): string[] {
  const object = blob.objects.get(INDEX);
  if (!object) return [];
  const index = JSON.parse(
    new TextDecoder().decode(object.body),
  ) as ModpackIndex;
  return index.packs.map((p) => p.slug);
}

function indexPuts(blob: FakeBlob): unknown[] {
  return blob.calls
    .filter((c) => c.method === "put" && c.args[0] === INDEX)
    .map((c) => c.args[2]);
}

/** Another upload writing its index between this upload's read and write. */
function racingUploads(
  api: ModpackBlobApi,
  blob: FakeBlob,
  slugs: string[],
): ModpackBlobApi {
  const queue = [...slugs];
  return {
    ...api,
    async put(pathname, body, options) {
      const slug = pathname === INDEX ? queue.shift() : undefined;
      if (slug !== undefined) {
        const object = blob.objects.get(INDEX);
        const current = object
          ? (JSON.parse(new TextDecoder().decode(object.body)) as ModpackIndex)
          : emptyIndex();
        await api.put(
          INDEX,
          indexBody(mergeModpackIndex(current, packData(slug))),
          { contentType: "application/json", allowOverwrite: true },
        );
      }
      await api.put(pathname, body, options);
    },
  };
}

let blob: FakeBlob;
let api: ModpackBlobApi;
beforeEach(() => {
  clearModpackCache();
  blob = createFakeBlob(() => NOW);
  api = fakeModpackBlobApi(blob, () => NOW);
});

describe("publishModpack's index write", () => {
  it("creates the index in an empty store, after the pack's data", async () => {
    await publishModpack(blobModpackStore(api), extraction("a"));

    expect(storedSlugs(blob)).toEqual(["a"]);
    expect(indexPuts(blob)).toEqual([{ contentType: "application/json" }]);
    const puts = blob.calls
      .filter((c) => c.method === "put")
      .map((c) => c.args[0]);
    expect(puts).toEqual([
      modFileSwatchesPath("a-mod"),
      modpackDataPath("a", "v-1"),
      INDEX,
    ]);
  });

  it("merges into the index on origin, never a stale cached copy", async () => {
    await publishModpack(blobModpackStore(api), extraction("a"));
    const stale = blob.objects.get(INDEX)!;
    await publishModpack(blobModpackStore(api), extraction("b"));
    // The CDN cache still serves the index from before pack "b".
    const cdn: ModpackBlobApi = {
      ...api,
      get: (pathname, options) =>
        pathname === INDEX && options.useCache !== false
          ? Promise.resolve({
              stream: new Blob([new Uint8Array(stale.body)]).stream(),
              size: stale.body.byteLength,
              uploadedAt: stale.uploadedAt,
              etag: stale.etag!,
            })
          : api.get(pathname, options),
    };

    await publishModpack(blobModpackStore(cdn), extraction("c"));

    expect(storedSlugs(blob)).toEqual(["a", "b", "c"]);
    const indexGets = blob.calls.filter(
      (c) => c.method === "get" && c.args[0] === INDEX,
    );
    expect(indexGets.map((c) => c.args[1])).toEqual([
      { access: "private", useCache: false },
      { access: "private", useCache: false },
      { access: "private", useCache: false },
    ]);
    // The MCP server's own reads keep the cache.
    blob.calls.length = 0;
    await loadModpackIndex(blob);
    expect(blob.calls.map((c) => c.args[1])).toEqual([{ access: "private" }]);
  });

  it("writes with ifMatch on the ETag it read", async () => {
    await publishModpack(blobModpackStore(api), extraction("a"));
    const etag = blob.objects.get(INDEX)!.etag;

    await publishModpack(blobModpackStore(api), extraction("b"));

    expect(indexPuts(blob).at(-1)).toEqual({
      contentType: "application/json",
      ifMatch: etag,
    });
  });

  it("re-reads and re-merges when another upload changed the index", async () => {
    await publishModpack(blobModpackStore(api), extraction("a"));
    blob.calls.length = 0;

    await publishModpack(
      blobModpackStore(racingUploads(api, blob, ["other"])),
      extraction("b"),
    );

    expect(storedSlugs(blob)).toEqual(["a", "b", "other"]);
    // The racing upload's write, the failed one, then the re-merged one.
    expect(indexPuts(blob)).toHaveLength(3);
  });

  it("re-merges when another upload created the index first", async () => {
    await publishModpack(
      blobModpackStore(racingUploads(api, blob, ["other"])),
      extraction("a"),
    );

    expect(storedSlugs(blob)).toEqual(["a", "other"]);
  });

  it("gives up after 3 conflicting writes, with the pack data written", async () => {
    await publishModpack(blobModpackStore(api), extraction("a"));
    blob.calls.length = 0;

    const upload = publishModpack(
      blobModpackStore(racingUploads(api, blob, ["x", "y", "z", "w"])),
      extraction("b"),
    );

    await expect(upload).rejects.toThrow(INDEX_CONFLICT_MESSAGE);
    await expect(upload).rejects.toThrow(/Another upload changed/);
    expect(storedSlugs(blob)).toEqual(["a", "x", "y", "z"]);
    expect(blob.objects.has(modpackDataPath("b", "v-1"))).toBe(true);
    const ours = indexPuts(blob).filter(
      (o) => (o as { allowOverwrite?: boolean }).allowOverwrite !== true,
    );
    expect(ours).toHaveLength(3);
  });

  it("stops on index write errors other than a precondition failure", async () => {
    const failing: ModpackBlobApi = {
      ...api,
      async put(pathname, body, options) {
        if (pathname === INDEX) throw new Error("network down");
        await api.put(pathname, body, options);
      },
    };

    await expect(
      publishModpack(blobModpackStore(failing), extraction("a")),
    ).rejects.toThrow("network down");
    expect(indexPuts(blob)).toHaveLength(0);
  });
});
