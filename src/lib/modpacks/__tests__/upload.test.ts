import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { vanillaDescriptorSources } from "../appearance";
import {
  extractModpack,
  modpackVersionKey,
  slugifyModpackName,
  type ModpackSource,
} from "../extract";
import { readInstanceFolder } from "../instance-folder";
import { encodeRgbaPng } from "../png";
import {
  countModStatuses,
  directoryModpackStore,
  mergeModpackIndex,
  publishModpack,
} from "../publish";
import { modpackDataSchema, modpackIndexSchema } from "../schema";

const ASSETS = path.join(process.cwd(), "public", "minecraft-assets");
const vanilla = vanillaDescriptorSources({
  models: JSON.parse(
    readFileSync(path.join(ASSETS, "models.json"), "utf8"),
  ) as Record<string, unknown>,
  atlas: { width: 1, height: 1, data: new Uint8Array(4) },
  uvs: {},
});

const NOW = () => new Date("2026-10-06T12:00:00.000Z");

function solidPng(rgba: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return encodeRgbaPng(16, 16, data);
}

const json = (value: unknown) => strToU8(JSON.stringify(value));

/** Brass Things: a cube and a stair, with CurseForge ids in the manifest. */
function brassJar(): Uint8Array {
  const stairVariants: Record<string, unknown> = {};
  for (const facing of ["east", "north", "south", "west"]) {
    for (const half of ["bottom", "top"]) {
      for (const shape of ["straight", "inner_left", "outer_left"]) {
        stairVariants[`facing=${facing},half=${half},shape=${shape}`] = {
          model: `brass:block/brass_stairs${shape === "straight" ? "" : `_${shape.split("_")[0]}`}`,
        };
      }
    }
  }
  const stairModel = (parent: string) => ({
    parent,
    textures: {
      bottom: "brass:block/brass_block",
      top: "brass:block/brass_block",
      side: "brass:block/brass_block",
    },
  });
  return zipSync({
    "assets/brass/blockstates/brass_block.json": json({
      variants: { "": { model: "brass:block/brass_block" } },
    }),
    "assets/brass/blockstates/brass_stairs.json": json({
      variants: stairVariants,
    }),
    "assets/brass/models/block/brass_block.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "brass:block/brass_block" },
    }),
    "assets/brass/models/block/brass_stairs.json": json(
      stairModel("minecraft:block/stairs"),
    ),
    "assets/brass/models/block/brass_stairs_inner.json": json(
      stairModel("minecraft:block/inner_stairs"),
    ),
    "assets/brass/models/block/brass_stairs_outer.json": json(
      stairModel("minecraft:block/outer_stairs"),
    ),
    "assets/brass/textures/block/brass_block.png": solidPng([
      200, 140, 40, 255,
    ]),
    "assets/brass/lang/en_us.json": json({
      "block.brass.brass_block": "Block of Brass",
    }),
  });
}

/** A frame block, added by hand (no CurseForge ids). */
function framedJar(): Uint8Array {
  return zipSync({
    "assets/framedblocks/blockstates/framed_cube.json": json({
      variants: {
        "solid=false": { model: "framedblocks:block/framed_cube" },
        "solid=true": { model: "framedblocks:block/framed_cube" },
      },
    }),
    "assets/framedblocks/models/block/framed_cube.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "framedblocks:block/framed_block" },
    }),
    "assets/framedblocks/textures/block/framed_block.png": solidPng([
      120, 90, 60, 255,
    ]),
  });
}

function addon(
  addonID: number,
  name: string,
  fileId: number,
  fileName: string,
): unknown {
  return {
    addonID,
    name,
    fileNameOnDisk: fileName,
    categorySection: { path: "mods" },
    isEnabled: true,
    installedFile: {
      id: fileId,
      fileName,
      gameVersion: ["NeoForge", "1.21.1"],
    },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "modpack-upload-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeInstance(): string {
  const instance = path.join(dir, "instance");
  mkdirSync(path.join(instance, "mods"), { recursive: true });
  mkdirSync(path.join(instance, "kubejs", "startup_scripts"), {
    recursive: true,
  });
  writeFileSync(path.join(instance, "mods", "brass-1.0.jar"), brassJar());
  writeFileSync(path.join(instance, "mods", "framed-2.0.jar"), framedJar());
  writeFileSync(
    path.join(instance, "minecraftinstance.json"),
    JSON.stringify({
      name: "Test Pack: Deluxe",
      gameVersion: "1.21.1",
      baseModLoader: { name: "neoforge-21.1.77", type: 6 },
      installedModpack: { addonID: 9000, installedFile: { id: 777 } },
      manifest: { version: "1.2.3" },
      installedAddons: [
        addon(11, "Brass Things", 1111, "brass-1.0.jar"),
        addon(12, "Gone Mod", 1212, "gone-1.0.jar"),
      ],
    }),
  );
  return instance;
}

describe("modpack upload extraction", () => {
  it("extracts an instance folder into pack.json.gz and swatch sheets", async () => {
    const source = await readInstanceFolder(writeInstance());
    expect(source).toMatchObject({
      name: "Test Pack: Deluxe",
      displayVersion: "1.2.3",
      minecraftVersion: "1.21.1",
      loader: "neoforge",
      curseForgeProjectId: 9000,
      packFileId: 777,
      hasKubeJs: true,
    });

    const extraction = await extractModpack(source, { vanilla, now: NOW });
    const out = path.join(dir, "out");
    const store = directoryModpackStore(out);
    const published = await publishModpack(store, extraction);
    expect(published.swatchesWritten).toBe(2);
    expect(published.swatchesSkipped).toBe(0);

    const packFile = path.join(
      out,
      "modpacks",
      "test-pack-deluxe",
      "cf-777",
      "pack.json.gz",
    );
    const data = modpackDataSchema.parse(
      JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(packFile)))),
    );
    expect(data).toMatchObject({
      slug: "test-pack-deluxe",
      name: "Test Pack: Deluxe",
      curseForgeProjectId: 9000,
      version: {
        key: "cf-777",
        packFileId: 777,
        displayVersion: "1.2.3",
        minecraftVersion: "1.21.1",
        loader: "neoforge",
        modCount: 3,
        uploadedAt: "2026-10-06T12:00:00.000Z",
      },
      runtimeBlockSources: [{ kind: "kubejs", name: "kubejs" }],
    });

    const mods = Object.fromEntries(data.mods.map((m) => [m.name, m]));
    expect(mods["Brass Things"]).toMatchObject({
      key: "cf-1111",
      curseForgeProjectId: 11,
      curseForgeFileId: 1111,
      fileName: "brass-1.0.jar",
      namespaces: ["brass"],
      status: "ok",
      hasSwatches: true,
    });
    expect(mods["Gone Mod"]).toMatchObject({
      key: "cf-1212",
      status: "failed",
      hasSwatches: false,
    });
    expect(mods["Gone Mod"].message).toMatch(/isn't in mods\//);
    const framed = mods["framed-2.0"];
    expect(framed).toMatchObject({
      curseForgeProjectId: null,
      curseForgeFileId: null,
      status: "ok",
    });
    expect(framed.key).toMatch(/^sha256-[0-9a-f]{64}$/);

    expect(data.blocks.map((b) => b.id)).toEqual([
      "brass:brass_block",
      "brass:brass_stairs",
      "framedblocks:framed_cube",
    ]);
    const [block, stairs, frame] = data.blocks;
    expect(block).toMatchObject({
      mod: "cf-1111",
      displayName: "Block of Brass",
      properties: {},
      defaults: {},
      kind: "block",
      fullCube: true,
      appearance: { hex: "#c88c28", variance: 0 },
      swatch: { file: "cf-1111" },
    });
    expect(Object.keys(block.swatch!.faces).sort()).toEqual([
      "bottom",
      "side",
      "top",
    ]);
    expect(block.camo).toBeUndefined();
    expect(stairs).toMatchObject({
      kind: "stairs",
      fullCube: false,
      defaults: { facing: "east", half: "bottom", shape: "straight" },
    });
    // Completed from the vanilla domains: the jar only shows three shapes.
    expect(stairs.properties.shape).toEqual(
      expect.arrayContaining(["inner_right", "outer_right"]),
    );
    expect(frame).toMatchObject({
      mod: framed.key,
      properties: { solid: ["false", "true"] },
      camo: { slots: 1 },
    });

    // Swatch sheets are stored once per mod file.
    expect(
      readFileSync(path.join(out, "mod-files", "cf-1111", "swatches.png"))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");

    const index = modpackIndexSchema.parse(
      JSON.parse(
        readFileSync(path.join(out, "modpacks", "index.json"), "utf8"),
      ),
    );
    expect(index.packs).toEqual([
      {
        slug: "test-pack-deluxe",
        name: "Test Pack: Deluxe",
        curseForgeProjectId: 9000,
        versions: [data.version],
      },
    ]);

    expect(countModStatuses(data)).toEqual({
      ok: 2,
      "no-blocks": 0,
      "skipped-undistributable": 0,
      "skipped-too-large": 0,
      failed: 1,
    });
  });

  it("skips stored swatches and keeps other packs and versions in the index", async () => {
    const instance = writeInstance();
    const out = path.join(dir, "out");
    const store = directoryModpackStore(out);
    const first = await extractModpack(await readInstanceFolder(instance), {
      vanilla,
      slug: "other-pack",
      now: NOW,
    });
    await publishModpack(store, first);

    const second = await extractModpack(await readInstanceFolder(instance), {
      vanilla,
      now: NOW,
    });
    const again = await publishModpack(store, second);
    expect(again.swatchesWritten).toBe(0);
    expect(again.swatchesSkipped).toBe(2);

    const index = modpackIndexSchema.parse(
      JSON.parse(
        readFileSync(path.join(out, "modpacks", "index.json"), "utf8"),
      ),
    );
    expect(index.packs.map((p) => p.slug)).toEqual([
      "other-pack",
      "test-pack-deluxe",
    ]);
  });

  it("reads an exported pack's overrides/mods and lists files it lacks", async () => {
    const pack = path.join(dir, "export");
    mkdirSync(path.join(pack, "overrides", "mods"), { recursive: true });
    writeFileSync(
      path.join(pack, "overrides", "mods", "brass-1.0.jar"),
      brassJar(),
    );
    writeFileSync(
      path.join(pack, "manifest.json"),
      JSON.stringify({
        minecraft: {
          version: "1.21.1",
          modLoaders: [{ id: "neoforge-21.1.77", primary: true }],
        },
        manifestType: "minecraftModpack",
        name: "Exported",
        version: "4.0",
        files: [{ projectID: 5, fileID: 55, required: true }],
        overrides: "overrides",
      }),
    );
    const source = await readInstanceFolder(pack);
    expect(source).toMatchObject({
      name: "Exported",
      displayVersion: "4.0",
      loader: "neoforge",
      packFileId: null,
      hasKubeJs: false,
    });
    const { data } = await extractModpack(source, { vanilla, now: NOW });
    expect(data.version.key).toBe("v-4.0");
    expect(data.mods.map((m) => [m.name, m.status])).toEqual([
      ["brass-1.0", "ok"],
      ["CurseForge project 5", "failed"],
    ]);
  });

  it("gives every mod a status", async () => {
    const tooBig = new Uint8Array(0);
    const source: ModpackSource = {
      name: "Statuses",
      displayVersion: null,
      minecraftVersion: "1.20.1",
      loader: "forge",
      curseForgeProjectId: null,
      packFileId: null,
      hasKubeJs: false,
      warnings: [],
      mods: [
        {
          name: "Library",
          fileName: "lib.jar",
          curseForgeProjectId: 1,
          curseForgeFileId: 10,
          size: null,
          read: async () =>
            zipSync({ "assets/lib/lang/en_us.json": json({ a: "b" }) }),
        },
        {
          name: "Huge",
          fileName: "huge.jar",
          curseForgeProjectId: 2,
          curseForgeFileId: 20,
          size: 4 * 1024 * 1024 * 1024,
          read: async () => tooBig,
        },
        {
          name: "Broken",
          fileName: "broken.jar",
          curseForgeProjectId: 3,
          curseForgeFileId: 30,
          size: null,
          read: async () => strToU8("not a zip"),
        },
        {
          name: "Every Compat",
          fileName: "everycomp-2.6.jar",
          curseForgeProjectId: 4,
          curseForgeFileId: 40,
          size: null,
          read: async () =>
            zipSync({ "assets/everycomp/lang/en_us.json": json({}) }),
        },
      ],
    };
    await expect(
      extractModpack(source, { vanilla: null, now: NOW }),
    ).rejects.toThrow(/--version/);
    const { data } = await extractModpack(source, {
      vanilla: null,
      displayVersion: "1.0",
      now: NOW,
    });
    expect(data.slug).toBe("statuses");
    expect(data.mods.map((m) => [m.name, m.status])).toEqual([
      ["Library", "no-blocks"],
      ["Huge", "skipped-too-large"],
      ["Broken", "failed"],
      ["Every Compat", "no-blocks"],
    ]);
    expect(data.mods[2].message).toBeTruthy();
    expect(data.runtimeBlockSources).toEqual([
      expect.objectContaining({
        kind: "generated-block-provider",
        name: "Every Compat",
      }),
    ]);
  });
});

describe("helpers", () => {
  it("slugifies pack names and builds version keys", () => {
    expect(slugifyModpackName("All the Mods 10")).toBe("all-the-mods-10");
    expect(slugifyModpackName("Café — Édition!")).toBe("cafe-edition");
    expect(slugifyModpackName("!!!")).toBe("modpack");
    expect(modpackVersionKey(123, "x")).toBe("cf-123");
    expect(modpackVersionKey(null, "2.30 beta")).toBe("v-2.30-beta");
  });

  it("merges a version into the index without losing others", () => {
    const version = (key: string) => ({
      key,
      packFileId: null,
      displayVersion: key,
      minecraftVersion: "1.21.1",
      loader: "neoforge" as const,
      modCount: 1,
      uploadedAt: "2026-10-01T00:00:00.000Z",
    });
    const index = {
      formatVersion: 1,
      packs: [
        {
          slug: "a",
          name: "A",
          curseForgeProjectId: 5,
          versions: [version("v-1")],
        },
        {
          slug: "b",
          name: "B",
          curseForgeProjectId: null,
          versions: [version("v-1")],
        },
      ],
    };
    const merged = mergeModpackIndex(index, {
      formatVersion: 1,
      slug: "a",
      name: "A",
      curseForgeProjectId: null,
      version: { ...version("v-2") },
      mods: [],
      blocks: [],
      runtimeBlockSources: [],
    });
    expect(merged.packs[0]).toEqual({
      slug: "a",
      name: "A",
      curseForgeProjectId: 5,
      versions: [version("v-1"), version("v-2")],
    });
    expect(merged.packs[1]).toEqual(index.packs[1]);
  });
});
