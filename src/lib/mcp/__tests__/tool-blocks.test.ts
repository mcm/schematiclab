import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "@/lib/blockdata/load";
import { modpackDataPath, modpackIndexPath } from "@/lib/modpacks/paths";
import { clearModpackCache, encodeModpackData } from "@/lib/modpacks/reader";
import {
  MODPACK_FORMAT_VERSION,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndex,
} from "@/lib/modpacks/schema";
import { modpackInput } from "../input";
import { resolveToolBlocks } from "../tool-blocks";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-06T12:00:00.000Z");

const BLOCKS_URL =
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json";
const BLOCKS_JSON = readFileSync(
  path.join(
    __dirname,
    "../../blockdata/__tests__/fixtures/registry-mcmeta-1.21.4-blocks.json",
  ),
  "utf8",
);

const fetch = vi.fn(async (input: RequestInfo | URL) =>
  String(input) === BLOCKS_URL
    ? new Response(BLOCKS_JSON, { status: 200 })
    : new Response("not found", { status: 404 }),
);

const VERSION = {
  key: "cf-5678901",
  packFileId: 5678901,
  displayVersion: "1.0",
  minecraftVersion: "1.21.4",
  loader: "neoforge" as const,
  modCount: 2,
  uploadedAt: "2026-10-01T00:00:00.000Z",
};

const INDEX: ModpackIndex = {
  formatVersion: MODPACK_FORMAT_VERSION,
  packs: [
    {
      slug: "test-pack",
      name: "Test Pack",
      curseForgeProjectId: null,
      versions: [VERSION],
    },
  ],
};

function block(
  id: string,
  mod: string,
  extra: Partial<ModpackBlock> = {},
): ModpackBlock {
  return {
    id,
    mod,
    displayName: id,
    properties: {},
    defaults: {},
    kind: "block",
    fullCube: true,
    ...extra,
  };
}

const STAIRS_PROPERTIES = {
  facing: ["north", "south", "west", "east"],
  half: ["top", "bottom"],
  shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
  waterlogged: ["true", "false"],
};

const PACK: ModpackData = {
  formatVersion: MODPACK_FORMAT_VERSION,
  slug: "test-pack",
  name: "Test Pack",
  curseForgeProjectId: null,
  version: VERSION,
  mods: [
    {
      key: "cf-1",
      name: "Create",
      curseForgeProjectId: 328085,
      curseForgeFileId: 1,
      fileName: "create.jar",
      namespaces: ["create"],
      status: "ok",
      hasSwatches: true,
    },
    {
      key: "cf-2",
      name: "FramedBlocks",
      curseForgeProjectId: 441647,
      curseForgeFileId: 2,
      fileName: "framedblocks.jar",
      namespaces: ["framedblocks"],
      status: "ok",
      hasSwatches: false,
    },
  ],
  blocks: [
    block("create:andesite_casing", "cf-1"),
    block("create:brass_block", "cf-1", {
      appearance: {
        hex: "#c8a046",
        oklab: [0.74, 0.02, 0.12],
        dominant: [{ hex: "#d0a848", share: 0.7 }],
        variance: 0.1,
      },
      swatch: { file: "cf-1", faces: { side: [0, 0, 16, 16] } },
    }),
    block("create:brass_casing", "cf-1"),
    block("create:copycat_step", "cf-1", {
      properties: {
        facing: ["north", "south", "west", "east"],
        half: ["top", "bottom"],
      },
      // The stored default lacks `facing`: it takes its first value.
      defaults: { half: "bottom" },
      kind: "unknown",
      fullCube: false,
      camo: { slots: 1 },
    }),
    block("framedblocks:framed_stairs", "cf-2", {
      properties: STAIRS_PROPERTIES,
      defaults: {
        facing: "north",
        half: "bottom",
        shape: "straight",
        waterlogged: "false",
      },
      kind: "stairs",
      fullCube: false,
      camo: { slots: 1 },
    }),
  ],
  runtimeBlockSources: [],
};

let blob: FakeBlob;
beforeEach(() => {
  clearModpackCache();
  clearBlockDataCache();
  blob = createFakeBlob(() => NOW);
  blob.objects.set(modpackIndexPath(), {
    body: new TextEncoder().encode(JSON.stringify(INDEX)),
    uploadedAt: NOW,
  });
  blob.objects.set(modpackDataPath("test-pack", VERSION.key), {
    body: encodeModpackData(PACK),
    uploadedAt: NOW,
  });
});

const resolve = (args: { version?: string; modpack?: string }) =>
  resolveToolBlocks(args, { fetch, blob });

describe("modpack input", () => {
  it("is an optional string described with the reference forms", () => {
    expect(modpackInput.safeParse(undefined).success).toBe(true);
    expect(modpackInput.safeParse("test-pack@1.0").success).toBe(true);
    expect(modpackInput.description).toContain("<slug>@");
  });
});

describe("resolveToolBlocks without a modpack", () => {
  it("returns the version's vanilla registry", async () => {
    const blocks = await resolve({ version: "1.21.4" });
    expect(blocks.versionId).toBe("1.21.4");
    expect(blocks.modpack).toBeNull();
    expect(blocks.registry.exists("minecraft:oak_stairs")).toBe(true);
    expect(blocks.registry.exists("create:brass_block")).toBe(false);
    expect(blob.calls).toHaveLength(0);
  });

  it("needs a known version", async () => {
    await expect(resolve({})).rejects.toThrow("Give a version");
    await expect(resolve({ version: "9.9" })).rejects.toThrow(
      "Unknown Minecraft version '9.9'",
    );
  });
});

describe("resolveToolBlocks with a modpack", () => {
  it("takes the pack's version when version is left out", async () => {
    const blocks = await resolve({ modpack: "test-pack" });
    expect(blocks.versionId).toBe("1.21.4");
    expect(blocks.registry.version).toBe("1.21.4");
    expect(blocks.modpack?.minecraftVersion).toBe("1.21.4");
    const same = await resolve({ version: "1.21.4", modpack: "test-pack@1.0" });
    expect(same.versionId).toBe("1.21.4");
  });

  it("rejects another version", async () => {
    await expect(
      resolve({ version: "1.20.1", modpack: "test-pack" }),
    ).rejects.toThrow(
      "Modpack 'test-pack' is Minecraft 1.21.4; leave version out or pass 1.21.4.",
    );
  });

  it("rejects an unknown pack and a missing Blob store", async () => {
    await expect(resolve({ modpack: "nope" })).rejects.toThrow(
      "Unknown modpack 'nope'",
    );
    await expect(
      resolveToolBlocks({ modpack: "test-pack" }, { fetch, blob: null }),
    ).rejects.toThrow("no Blob store");
  });

  it("builds the pack's registry once", async () => {
    const a = await resolve({ modpack: "test-pack" });
    const b = await resolve({ modpack: "test-pack" });
    expect(b.modpack).toBe(a.modpack);
  });
});

describe("modpack registry", () => {
  it("keeps vanilla blocks", async () => {
    const { registry } = await resolve({ modpack: "test-pack" });
    expect(registry.exists("minecraft:oak_stairs")).toBe(true);
    expect(registry.exists("oak_stairs")).toBe(true);
    expect(registry.kind("minecraft:oak_stairs")).toBe("stairs");
    expect(registry.validateState("minecraft:oak_stairs[half=top]")).toEqual(
      expect.objectContaining({ ok: true, id: "minecraft:oak_stairs" }),
    );
    expect(registry.family("oak").stairs).toBe("minecraft:oak_stairs");
  });

  it("resolves a mod block with its defaults and kind", async () => {
    const { registry } = await resolve({ modpack: "test-pack" });
    expect(registry.exists("framedblocks:framed_stairs")).toBe(true);
    // Camo frames take their state properties from the camo fixtures too.
    const properties = registry.properties("framedblocks:framed_stairs")!;
    for (const [name, values] of Object.entries(STAIRS_PROPERTIES)) {
      expect(properties[name]).toEqual(expect.arrayContaining(values));
    }
    expect(properties.locked).toEqual(["false", "true"]);
    expect(registry.kind("framedblocks:framed_stairs")).toBe("stairs");
    expect(registry.validateState("framedblocks:framed_stairs")).toEqual({
      ok: true,
      id: "framedblocks:framed_stairs",
      properties: {},
      state: expect.objectContaining({
        facing: "north",
        half: "bottom",
        shape: "straight",
        waterlogged: "false",
      }),
    });
    expect(registry.defaults("create:copycat_step")).toEqual({
      facing: "north",
      half: "bottom",
      waterlogged: "false",
    });
    // An unclear kind counts as a plain block.
    expect(registry.kind("create:copycat_step")).toBe("block");
  });

  it("validates mod states against the pack's property domains", async () => {
    const { registry } = await resolve({ modpack: "test-pack" });
    expect(
      registry.validateState("framedblocks:framed_stairs[half=top]"),
    ).toEqual(
      expect.objectContaining({ ok: true, properties: { half: "top" } }),
    );
    expect(
      registry.validateState("framedblocks:framed_stairs[half=middle]"),
    ).toEqual({
      ok: false,
      error:
        'framedblocks:framed_stairs property "half" cannot be "middle"; allowed values for half: bottom, top.',
    });
    expect(registry.validateState("create:brass_block[axis=y]")).toEqual({
      ok: false,
      error: 'create:brass_block has no properties, so "axis" is not allowed.',
    });
  });

  it("fails an unknown mod id with suggestions from the pack", async () => {
    const { registry } = await resolve({ modpack: "test-pack" });
    expect(registry.exists("create:brass_stairs")).toBe(false);
    const result = registry.validateState("create:brass_stairs[half=top]");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(
      /^Unknown block "create:brass_stairs" in modpack 'test-pack' \(Minecraft 1\.21\.4\)\. Did you mean: create:brass_casing, minecraft:/,
    );
    expect(registry.validateState("othermod:thing")).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(registry.repair("create:brass_stairs")).toEqual({
      id: null,
      suggestions: expect.arrayContaining(["create:brass_casing"]),
    });
    expect(registry.suggest("brass_blocks")[0]).toBe("create:brass_block");
  });

  it("repairs sloppy mod names", async () => {
    const { registry } = await resolve({ modpack: "test-pack" });
    expect(registry.repair("create:brass_block")).toEqual({
      id: "create:brass_block",
    });
    expect(registry.repair("Create:Brass Block")).toEqual({
      id: "create:brass_block",
      note: "normalized 'Create:Brass Block' -> 'create:brass_block'",
    });
    expect(registry.repair("brass_block")).toEqual({
      id: "create:brass_block",
      note: "repaired 'brass_block' -> 'create:brass_block'",
    });
    expect(registry.repair("oak planks")).toEqual(
      expect.objectContaining({ id: "minecraft:oak_planks" }),
    );
  });

  it("builds mod families", async () => {
    const { registry } = await resolve({ modpack: "test-pack" });
    expect(registry.family("create:brass_casing")).toEqual({
      block: "create:brass_casing",
    });
    expect(registry.variant("create:brass_casing", "stairs")).toEqual({
      id: "create:brass_casing",
      note: "'brass_casing' has no stairs; used full block create:brass_casing",
    });
    expect(registry.variant("othermod:brass", "stairs")).toBeNull();
  });

  it("exposes mod details outside the registry", async () => {
    const { modpack } = await resolve({ modpack: "test-pack" });
    expect(modpack?.modBlock("create:brass_block")).toEqual({
      id: "create:brass_block",
      namespace: "create",
      mod: { key: "cf-1", name: "Create" },
      displayName: "create:brass_block",
      kind: "block",
      fullCube: true,
      appearance: PACK.blocks[1].appearance,
      swatch: PACK.blocks[1].swatch,
    });
    expect(modpack?.modBlock("create:copycat_step")).toEqual(
      expect.objectContaining({ kind: "unknown", camo: { slots: 1 } }),
    );
    expect(modpack?.modBlock("minecraft:stone")).toBeUndefined();
    expect(modpack?.modBlocks().map((b) => b.id)).toEqual(
      PACK.blocks.map((b) => b.id),
    );
  });
});
