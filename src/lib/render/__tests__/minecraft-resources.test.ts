import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedModAssets } from "../../mods/types";
import { decodeModTextures } from "../minecraft-resources";

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
