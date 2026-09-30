import { afterEach, describe, expect, it, vi } from "vitest";

import { strToU8, zipSync } from "fflate";

import type { LoadedModAssets, LoadedModMeta } from "../../mods/types";
import {
  decodeModTextures,
  entityTexturesFromZip,
  previewFilesChanged,
} from "../minecraft-resources";

function mod(textures: Record<string, Blob>): LoadedModAssets {
  return { blockstates: {}, models: {}, textures, textureMeta: {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("decodeModTextures", () => {
  it("prefers later mods and falls back to an earlier copy that decodes", async () => {
    const good = new Blob(["good"]);
    const bad = new Blob(["bad"]);
    const later = new Blob(["later"]);
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
      if (blob === bad) throw new Error("undecodable");
      return { source: blob };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bitmaps = await decodeModTextures([
      mod({ "m:block/a": good, "m:block/b": good }),
      mod({ "m:block/a": bad, "m:block/b": later, "m:block/c": bad }),
    ]);
    expect(bitmaps.get("m:block/a")).toEqual({ source: good });
    expect(bitmaps.get("m:block/b")).toEqual({ source: later });
    expect(bitmaps.has("m:block/c")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("entityTexturesFromZip", () => {
  it("keys PNGs by minecraft texture id and skips other files", async () => {
    const textures = entityTexturesFromZip(
      zipSync({
        "entity/chest/normal.png": strToU8("chest"),
        "entity/readme.txt": strToU8("skip me"),
      }),
    );
    expect(Object.keys(textures)).toEqual(["minecraft:entity/chest/normal"]);
    const blob = textures["minecraft:entity/chest/normal"];
    expect(blob?.type).toBe("image/png");
    expect(await blob?.text()).toBe("chest");
  });
});

describe("previewFilesChanged", () => {
  const file = (key: string) => ({ key }) as LoadedModMeta;

  it("compares preview file selections by record identity", () => {
    const a = file("1:1.20.1");
    const b = file("2:1.20.1");
    expect(previewFilesChanged([a, b], [a, b])).toBe(false);
    expect(previewFilesChanged([a, b], [a])).toBe(true);
    expect(previewFilesChanged([a, b], [b, a])).toBe(true);
    // A replaced file in the same (mod, version) slot keeps its key.
    expect(previewFilesChanged([a], [file("1:1.20.1")])).toBe(true);
  });
});
