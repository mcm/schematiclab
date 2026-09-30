import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedModMeta } from "../../mods/types";
import {
  clearResolvedModFileCache,
  preferredLoaderFor,
  resolveModFileForVersion,
} from "../resolve-file";
import type { CurseForgeModFile, ModLoader } from "../types";

function file(
  id: number,
  loaders: ModLoader[],
  downloadable = true,
): CurseForgeModFile {
  return {
    id,
    modId: 1,
    displayName: `f${id}`,
    fileName: `f${id}.jar`,
    fileLength: 1,
    fileDate: `2024-01-0${id}T00:00:00Z`,
    gameVersions: ["1.21.1"],
    loaders,
    downloadable,
  };
}

// Stub `fetch` answering the files route by its `loader` query parameter.
function stubFetch(byLoader: Record<string, CurseForgeModFile[] | number>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const answer = byLoader[url.searchParams.get("loader") ?? "any"] ?? [];
    return typeof answer === "number"
      ? new Response(JSON.stringify({ error: "upstream down" }), {
          status: answer,
        })
      : new Response(JSON.stringify(answer), { status: 200 });
  });
}

const PARAMS = {
  modId: 1,
  gameVersion: "1.21.1",
  preferredLoader: "forge" as ModLoader | null,
};

beforeEach(() => clearResolvedModFileCache());

describe("resolveModFileForVersion", () => {
  it("uses the preferred loader when it has a file", async () => {
    const fetchImpl = stubFetch({ forge: [file(1, ["forge"])] });
    await expect(
      resolveModFileForVersion(PARAMS, undefined, fetchImpl),
    ).resolves.toEqual({
      status: "available",
      file: file(1, ["forge"]),
      loader: "forge",
      loaderFallback: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to another loader", async () => {
    const fetchImpl = stubFetch({ forge: [], any: [file(2, ["neoforge"])] });
    await expect(
      resolveModFileForVersion(PARAMS, undefined, fetchImpl),
    ).resolves.toEqual({
      status: "available",
      file: file(2, ["neoforge"]),
      loader: "neoforge",
      loaderFallback: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("queries any loader once when there's no preference", async () => {
    const fetchImpl = stubFetch({ any: [file(3, ["fabric"])] });
    await expect(
      resolveModFileForVersion(
        { ...PARAMS, preferredLoader: null },
        undefined,
        fetchImpl,
      ),
    ).resolves.toMatchObject({ loader: "fabric", loaderFallback: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable when there's no file at all", async () => {
    await expect(
      resolveModFileForVersion(PARAMS, undefined, stubFetch({})),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("treats non-downloadable files as unavailable", async () => {
    const fetchImpl = stubFetch({
      forge: [file(1, ["forge"], false)],
      any: [file(1, ["forge"], false), file(2, ["fabric"], false)],
    });
    await expect(
      resolveModFileForVersion(PARAMS, undefined, fetchImpl),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("memoises per mod, version and loader", async () => {
    const fetchImpl = stubFetch({
      forge: [file(1, ["forge"])],
      fabric: [file(2, ["fabric"])],
    });
    await resolveModFileForVersion(PARAMS, undefined, fetchImpl);
    await resolveModFileForVersion(PARAMS, undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(
      resolveModFileForVersion(
        { ...PARAMS, preferredLoader: "fabric" },
        undefined,
        fetchImpl,
      ),
    ).resolves.toMatchObject({ file: { id: 2 } });
    await resolveModFileForVersion(
      { ...PARAMS, gameVersion: "1.20.1" },
      undefined,
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("propagates errors without caching them", async () => {
    const failing = stubFetch({ forge: 502 });
    await expect(
      resolveModFileForVersion(PARAMS, undefined, failing),
    ).resolves.toEqual({ status: "error", message: "upstream down" });

    const fetchImpl = stubFetch({ forge: [file(1, ["forge"])] });
    await expect(
      resolveModFileForVersion(PARAMS, undefined, fetchImpl),
    ).resolves.toMatchObject({ status: "available" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps network failures to an error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(
      resolveModFileForVersion(PARAMS, undefined, fetchImpl),
    ).resolves.toEqual({
      status: "error",
      message: "Could not reach the server.",
    });
  });

  it("rethrows when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      resolveModFileForVersion(PARAMS, controller.signal, fetchImpl),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("preferredLoaderFor", () => {
  const meta = (
    modId: number,
    gameVersions: string[],
    loader: ModLoader | null,
  ) =>
    ({
      modId,
      gameVersion: gameVersions[0],
      gameVersions,
      loader,
    }) as LoadedModMeta;

  it("uses the loader of the mod's source-version file", () => {
    const mods = [
      meta(1, ["1.21.1"], "neoforge"),
      meta(1, ["1.20.1"], "forge"),
      meta(2, ["1.20.1"], "fabric"),
    ];
    expect(preferredLoaderFor(mods, 1, "1.20.1")).toBe("forge");
    expect(preferredLoaderFor(mods, 1, "1.19.2")).toBeNull();
    expect(preferredLoaderFor(mods, 3, "1.20.1")).toBeNull();
    expect(preferredLoaderFor(mods, 1, null)).toBeNull();
  });
});
