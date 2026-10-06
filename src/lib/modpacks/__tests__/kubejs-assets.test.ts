import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_ASSET_ENTRIES,
  parseResourcePack,
  resourcePackBudget,
} from "../../mods/parse-mod-jar";
import { vanillaDescriptorSources } from "../appearance";
import { BLOCK_LIST_MOD_KEY, type BlockList } from "../block-list";
import { readPackZipKubeJsAssets } from "../curseforge-source";
import {
  extractModpack,
  type ModpackModSource,
  type ModpackSource,
} from "../extract";
import { readInstanceFolder } from "../instance-folder";
import { encodeRgbaPng } from "../png";
import { directoryModpackStore, publishModpack } from "../publish";
import { modpackDataSchema } from "../schema";

// Vanilla models only (cube_all), so mod textures make swatches.
const vanilla = vanillaDescriptorSources({
  models: JSON.parse(
    readFileSync(
      path.join(process.cwd(), "public", "minecraft-assets", "models.json"),
      "utf8",
    ),
  ) as Record<string, unknown>,
  atlas: { width: 1, height: 1, data: new Uint8Array(4) },
  uvs: {},
});

const NOW = () => new Date("2026-10-06T12:00:00.000Z");
const json = (value: unknown) => strToU8(JSON.stringify(value));

const BLUE = [40, 40, 200, 255];
const RED = [200, 40, 40, 255];
const GREEN = [40, 200, 40, 255];

function solidPng(rgba: number[]): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return encodeRgbaPng(16, 16, data);
}

/** A self-contained cube block in `rgba`. */
function cube(id: string, rgba: number[]): Record<string, Uint8Array> {
  const [ns, p] = id.split(":");
  return {
    [`assets/${ns}/blockstates/${p}.json`]: json({
      variants: { "": { model: `${ns}:block/${p}` } },
    }),
    [`assets/${ns}/models/block/${p}.json`]: json({
      parent: "minecraft:block/cube_all",
      textures: { all: `${ns}:block/${p}` },
    }),
    [`assets/${ns}/textures/block/${p}.png`]: solidPng(rgba),
  };
}

/** Mod "Industry": three blue cubes. */
function industry(): Uint8Array {
  return zipSync({
    ...cube("industry:machine", BLUE),
    ...cube("industry:casing", BLUE),
    ...cube("industry:plain", BLUE),
  });
}

/**
 * The pack's kubejs/assets: a new blockstate (with a `lit` property) and
 * red texture for `industry:machine`, a green texture replacing the one
 * `industry:casing` uses, and a runtime-registered `kubejs:magical_soil`.
 */
function kubejsAssets(): Record<string, Uint8Array> {
  return {
    "assets/industry/blockstates/machine.json": json({
      variants: {
        "lit=false": { model: "industry:block/machine_kjs" },
        "lit=true": { model: "industry:block/machine_kjs" },
      },
    }),
    "assets/industry/models/block/machine_kjs.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "industry:block/machine_kjs" },
    }),
    "assets/industry/textures/block/machine_kjs.png": solidPng(RED),
    "assets/industry/textures/block/casing.png": solidPng(GREEN),
    "assets/industry/lang/en_us.json": json({
      "block.industry.machine": "Retextured Machine",
    }),
    ...cube("kubejs:magical_soil", GREEN),
    "assets/kubejs/lang/en_us.json": json({
      "block.kubejs.magical_soil": "Magical Soil",
    }),
  };
}

function kubejsKey(files: Record<string, Uint8Array>): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    hash.update(`${name}\n${files[name].byteLength}\n`);
    hash.update(files[name]);
  }
  return `kubejs-${hash.digest("hex").slice(0, 16)}`;
}

function mod(
  name: string,
  fileId: number,
  bytes: Uint8Array,
): ModpackModSource {
  return {
    name,
    fileName: `${name.toLowerCase()}.jar`,
    curseForgeProjectId: fileId,
    curseForgeFileId: fileId,
    size: bytes.length,
    read: async () => bytes,
  };
}

function pack(
  mods: ModpackModSource[],
  kubejs: Record<string, Uint8Array> | null,
): ModpackSource {
  return {
    name: "KubeJS Pack",
    displayVersion: "1.0",
    minecraftVersion: "1.21.1",
    loader: "neoforge",
    curseForgeProjectId: null,
    packFileId: null,
    hasKubeJs: kubejs !== null,
    readKubeJsAssets: async () => kubejs,
    warnings: [],
    mods,
  };
}

function list(ids: string[]): BlockList {
  return { ids, sha256: "0".repeat(64) };
}

describe("parseResourcePack", () => {
  it("keeps every asset, not only those a blockstate reaches", () => {
    const parsed = parseResourcePack({
      ...kubejsAssets(),
      "assets/minecraft/textures/block/stone.png": solidPng(RED),
      "assets/industry/sounds.json": json({}),
    });
    expect(parsed.namespaces).toEqual(["industry", "kubejs"]);
    expect(Object.keys(parsed.blockstates).sort()).toEqual([
      "industry:machine",
      "kubejs:magical_soil",
    ]);
    expect(Object.keys(parsed.textures).sort()).toEqual([
      "industry:block/casing",
      "industry:block/machine_kjs",
      "kubejs:block/magical_soil",
    ]);
    expect(parsed.lang["block.industry.machine"]).toBe("Retextured Machine");
    expect(parsed.warnings).toEqual([]);
  });

  it("budgets files like parseModJar", () => {
    const budget = resourcePackBudget("kubejs/assets/");
    for (let i = 0; i < MAX_ASSET_ENTRIES; i++) budget.charge(1);
    expect(() => budget.charge(1)).toThrow(/kubejs\/assets\/ is too large/);
  });
});

describe("extractModpack with kubejs/assets", () => {
  it("overrides a jar block's blockstate, models and textures", async () => {
    const files = kubejsAssets();
    const key = kubejsKey(files);
    const plain = await extractModpack(
      pack([mod("Industry", 1, industry())], null),
      { vanilla, now: NOW },
    );
    expect(plain.kubejs).toBeUndefined();
    const before = new Map(plain.data.blocks.map((b) => [b.id, b]));

    const { data, swatches, kubejs, warnings } = await extractModpack(
      pack([mod("Industry", 1, industry())], files),
      { vanilla, now: NOW },
    );
    expect(() => modpackDataSchema.parse(data)).not.toThrow();
    expect(warnings).toEqual([]);
    const blocks = new Map(data.blocks.map((b) => [b.id, b]));
    // Without a block list, the runtime block isn't in the pack.
    expect([...blocks.keys()]).toEqual([
      "industry:casing",
      "industry:machine",
      "industry:plain",
    ]);

    const machine = blocks.get("industry:machine")!;
    expect(machine).toMatchObject({
      mod: "cf-1",
      displayName: "Retextured Machine",
      properties: { lit: ["false", "true"] },
      defaults: { lit: "false" },
      kind: "block",
    });
    expect(machine.appearance?.hex).not.toBe(
      before.get("industry:machine")?.appearance?.hex,
    );
    expect(machine.swatch?.file).toBe(key);

    // A texture override alone changes the look too.
    const casing = blocks.get("industry:casing")!;
    expect(casing.appearance?.hex).not.toBe(
      before.get("industry:casing")?.appearance?.hex,
    );
    expect(casing.swatch?.file).toBe(key);

    // Untouched blocks keep the jar's look and sheet.
    expect(blocks.get("industry:plain")).toEqual(before.get("industry:plain"));

    // The jar's sheet is the same as without kubejs/assets.
    expect(swatches.get("cf-1")).toEqual(plain.swatches.get("cf-1"));
    expect(swatches.has(key)).toBe(true);
    expect(kubejs).toEqual({ sheet: key, overridden: 2, added: 0, ignored: 1 });
  });

  it("adds a listed block from kubejs/assets with its look", async () => {
    const files = kubejsAssets();
    const key = kubejsKey(files);
    const { data, kubejs, blockList } = await extractModpack(
      pack([mod("Industry", 1, industry())], files),
      {
        vanilla,
        now: NOW,
        blockList: list([
          "industry:machine",
          "kubejs:magical_soil",
          "kubejs:no_assets",
        ]),
      },
    );
    expect(() => modpackDataSchema.parse(data)).not.toThrow();
    const soil = data.blocks.find((b) => b.id === "kubejs:magical_soil");
    expect(soil).toMatchObject({
      // No jar has the kubejs namespace.
      mod: BLOCK_LIST_MOD_KEY,
      displayName: "Magical Soil",
      properties: {},
      defaults: {},
      kind: "block",
      fullCube: true,
      swatch: { file: key },
    });
    expect(soil?.appearance).toBeDefined();
    expect(data.blocks.find((b) => b.id === "kubejs:no_assets")?.kind).toBe(
      "unknown",
    );
    expect(blockList?.added).toBe(1);
    expect(kubejs).toEqual({ sheet: key, overridden: 1, added: 1, ignored: 0 });
  });

  it("gives an added block to the mod of its namespace", async () => {
    const files = {
      ...kubejsAssets(),
      ...cube("industry:runtime_press", RED),
    };
    const { data } = await extractModpack(
      pack([mod("Industry", 1, industry())], files),
      { vanilla, now: NOW, blockList: list(["industry:runtime_press"]) },
    );
    expect(data.blocks.map((b) => [b.id, b.mod])).toEqual([
      ["industry:runtime_press", "cf-1"],
    ]);
  });

  it("uploads the kubejs sheet once", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "kubejs-sheet-"));
    try {
      const store = directoryModpackStore(out);
      const source = pack([mod("Industry", 1, industry())], kubejsAssets());
      const first = await publishModpack(
        store,
        await extractModpack(source, { vanilla, now: NOW }),
      );
      expect(first.swatchesWritten).toBe(2);
      const second = await publishModpack(
        store,
        await extractModpack(source, { vanilla, now: NOW }),
      );
      expect(second).toMatchObject({ swatchesWritten: 0, swatchesSkipped: 2 });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("warns and goes on when kubejs/assets can't be read", async () => {
    const source = pack([mod("Industry", 1, industry())], null);
    source.readKubeJsAssets = async () => {
      throw new Error("too large");
    };
    const { kubejs, warnings, data } = await extractModpack(source, {
      vanilla,
      now: NOW,
    });
    expect(kubejs).toBeUndefined();
    expect(warnings).toEqual(["kubejs/assets wasn't read: too large"]);
    expect(data.blocks).toHaveLength(3);
  });
});

describe("pack sources' kubejs/assets", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kubejs-source-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFiles(root: string, files: Record<string, Uint8Array>) {
    for (const [name, bytes] of Object.entries(files)) {
      const file = path.join(root, ...name.split("/"));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
  }

  const extra = {
    "assets/industry/sounds.json": json({}),
    "assets/minecraft/textures/block/stone.png": solidPng(RED),
  };

  it("reads an instance folder's kubejs/assets", async () => {
    mkdirSync(path.join(dir, "mods"));
    writeFileSync(path.join(dir, "mods", "industry.jar"), industry());
    writeFileSync(
      path.join(dir, "minecraftinstance.json"),
      JSON.stringify({
        name: "Instance",
        gameVersion: "1.21.1",
        baseModLoader: { name: "neoforge-21.1.77", type: 6 },
        manifest: { version: "1.0" },
        installedAddons: [],
      }),
    );
    writeFiles(path.join(dir, "kubejs"), { ...kubejsAssets(), ...extra });
    writeFiles(path.join(dir, "kubejs"), {
      "startup_scripts/blocks.js": strToU8("// blocks"),
    });
    const source = await readInstanceFolder(dir);
    expect(source.hasKubeJs).toBe(true);
    const files = await source.readKubeJsAssets!();
    expect(files).toEqual(kubejsAssets());

    const { kubejs } = await extractModpack(source, { vanilla, now: NOW });
    expect(kubejs).toMatchObject({ overridden: 2, ignored: 1 });
  });

  it("reads an exported pack's overrides/kubejs/assets", async () => {
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        minecraft: {
          version: "1.21.1",
          modLoaders: [{ id: "neoforge-21.1.77", primary: true }],
        },
        manifestType: "minecraftModpack",
        name: "Exported",
        version: "4.0",
        files: [],
        overrides: "overrides",
      }),
    );
    writeFiles(path.join(dir, "overrides", "kubejs"), kubejsAssets());
    const source = await readInstanceFolder(dir);
    expect(await source.readKubeJsAssets!()).toEqual(kubejsAssets());
  });

  it("is null for an instance without kubejs/assets", async () => {
    writeFileSync(
      path.join(dir, "minecraftinstance.json"),
      JSON.stringify({
        name: "Instance",
        gameVersion: "1.21.1",
        baseModLoader: { name: "neoforge-21.1.77", type: 6 },
        installedAddons: [],
      }),
    );
    mkdirSync(path.join(dir, "kubejs", "startup_scripts"), { recursive: true });
    const source = await readInstanceFolder(dir);
    expect(await source.readKubeJsAssets!()).toBeNull();
  });

  it("reads a pack zip's <overrides>/kubejs/assets", () => {
    const prefixed = (files: Record<string, Uint8Array>) =>
      Object.fromEntries(
        Object.entries(files).map(([name, bytes]) => [
          `files/kubejs/${name}`,
          bytes,
        ]),
      );
    const zip = zipSync({
      "manifest.json": json({}),
      ...prefixed({ ...kubejsAssets(), ...extra }),
      "files/kubejs/startup_scripts/blocks.js": strToU8("// blocks"),
      "overrides/kubejs/assets/other/blockstates/x.json": json({}),
    });
    expect(readPackZipKubeJsAssets(zip, "files")).toEqual(kubejsAssets());
    expect(
      readPackZipKubeJsAssets(
        zipSync({ "files/kubejs/startup_scripts/a.js": strToU8("") }),
        "files",
      ),
    ).toBeNull();
  });
});
