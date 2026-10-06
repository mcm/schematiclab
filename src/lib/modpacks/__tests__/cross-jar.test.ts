import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  parseModJar,
  readJarAssets,
  readModJarIndex,
} from "../../mods/parse-mod-jar";
import {
  packSwatchSheets,
  SWATCH_SIZE,
  vanillaDescriptorSources,
  type SwatchBlock,
} from "../appearance";
import {
  extractModpack,
  type ModpackModSource,
  type ModpackSource,
} from "../extract";
import { encodeRgbaPng } from "../png";
import { modpackDataSchema, type ModpackBlock } from "../schema";

// Vanilla models only (cube_all, slab…), so mod textures make swatches.
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

type Files = Record<string, Uint8Array>;
type Rgba = [number, number, number, number];

const BLUE: Rgba = [40, 40, 200, 255];
const RED: Rgba = [200, 40, 40, 255];
const GREEN: Rgba = [40, 200, 40, 255];

function solidPng(rgba: Rgba): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return encodeRgbaPng(16, 16, data);
}

const modsToml = (...ids: string[]) =>
  strToU8(
    `modLoader="javafml"\nloaderVersion="[1,)"\n${ids
      .map((id) => `[[mods]]\nmodId="${id}"\nversion="1"\n`)
      .join("")}`,
  );

/** `ns:path` → its entry name under `assets/`. */
function entry(kind: "blockstates" | "models" | "textures", id: string) {
  const [ns, p] = id.split(":");
  return kind === "textures"
    ? `assets/${ns}/textures/${p}.png`
    : `assets/${ns}/${kind}/${p}.json`;
}

/** A blockstate of block `id` using one model. */
function blockstate(id: string, model: string): Files {
  return { [entry("blockstates", id)]: json({ variants: { "": { model } } }) };
}

function model(id: string, value: unknown): Files {
  return { [entry("models", id)]: json(value) };
}

function texture(id: string, rgba: Rgba): Files {
  return { [entry("textures", id)]: solidPng(rgba) };
}

/** A self-contained cube block in `rgba`. */
function cube(id: string, rgba: Rgba): Files {
  const [ns, p] = id.split(":");
  return {
    ...blockstate(id, `${ns}:block/${p}`),
    ...model(`${ns}:block/${p}`, {
      parent: "minecraft:block/cube_all",
      textures: { all: `${ns}:block/${p}` },
    }),
    ...texture(`${ns}:block/${p}`, rgba),
  };
}

function jar(modIds: string[], files: Files): Uint8Array {
  return zipSync({
    ...(modIds.length > 0 && {
      "META-INF/neoforge.mods.toml": modsToml(...modIds),
    }),
    ...files,
  });
}

/** Base mod: a slab model (`base:block/half`) and its texture. */
function base(): Uint8Array {
  return jar(["base"], {
    ...cube("base:plain", GREEN),
    ...model("base:block/half", {
      parent: "minecraft:block/slab",
      textures: {
        bottom: "base:block/plate",
        top: "base:block/plate",
        side: "base:block/plate",
      },
    }),
    ...texture("base:block/plate", GREEN),
  });
}

/**
 * Addon: `addon:servo` uses the base mod's slab model with its own texture,
 * and `addon:own` is a self-contained cube.
 */
function addon(): Uint8Array {
  return jar(["addon"], {
    ...cube("addon:own", BLUE),
    ...blockstate("addon:servo", "addon:block/servo"),
    ...model("addon:block/servo", {
      parent: "base:block/half",
      textures: {
        bottom: "addon:block/servo",
        top: "addon:block/servo",
        side: "addon:block/servo",
      },
    }),
    ...texture("addon:block/servo", RED),
  });
}

function mod(name: string, fileId: number, bytes: Uint8Array) {
  let reads = 0;
  const source: ModpackModSource = {
    name,
    fileName: `${name.toLowerCase()}.jar`,
    curseForgeProjectId: fileId,
    curseForgeFileId: fileId,
    size: bytes.length,
    read: async () => {
      reads += 1;
      return bytes;
    },
  };
  return Object.assign(source, { reads: () => reads });
}

function pack(
  mods: ModpackModSource[],
  kubejs: Files | null = null,
): ModpackSource {
  return {
    name: "Cross Jar Pack",
    displayVersion: "1.0",
    minecraftVersion: "1.21.1",
    loader: "neoforge",
    curseForgeProjectId: null,
    packFileId: null,
    hasKubeJs: kubejs !== null,
    ...(kubejs !== null && { readKubeJsAssets: async () => kubejs }),
    mods,
    warnings: [],
  };
}

async function extract(mods: ModpackModSource[], kubejs: Files | null = null) {
  const extraction = await extractModpack(pack(mods, kubejs), {
    vanilla,
    now: NOW,
  });
  expect(() => modpackDataSchema.parse(extraction.data)).not.toThrow();
  return extraction;
}

function blockOf(
  blocks: readonly ModpackBlock[],
  id: string,
): ModpackBlock | undefined {
  return blocks.find((block) => block.id === id);
}

/** The colour channel (`0` red, `2` blue…) that dominates `hex`. */
function dominantChannel(hex: string | undefined): number {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  const rgb = [1, 3, 5].map((i) => parseInt(hex!.slice(i, i + 2), 16));
  return rgb.indexOf(Math.max(...rgb));
}

function packKey(png: Uint8Array | undefined): string {
  expect(png).toBeDefined();
  return `pack-${createHash("sha256").update(png!).digest("hex").slice(0, 16)}`;
}

describe("readModJarIndex asset ids", () => {
  it("lists the model and texture ids of the jar, its nested jars and compat packs", () => {
    const nested = jar(["lib"], {
      ...model("lib:block/core", { parent: "minecraft:block/cube_all" }),
      ...texture("lib:block/core", RED),
    });
    const bytes = jar(["outer"], {
      ...cube("outer:thing", BLUE),
      "assets/minecraft/textures/block/stone.png": solidPng(RED),
      "META-INF/jarjar/lib.jar": nested,
      [`compat_packs/create/${entry("models", "outer:block/seat")}`]: json({}),
      [`compat_packs/create/${entry("textures", "outer:block/seat")}`]:
        solidPng(RED),
    });
    const index = readModJarIndex(bytes);
    expect(index.assets).toEqual({
      models: ["outer:block/thing"],
      textures: ["outer:block/thing"],
      blockNamespaces: ["outer"],
      compatPacks: {
        create: {
          models: ["outer:block/seat"],
          textures: ["outer:block/seat"],
        },
      },
    });
    expect(index.nestedJars[0].assets).toEqual({
      models: ["lib:block/core"],
      textures: ["lib:block/core"],
      blockNamespaces: [],
      compatPacks: {},
    });
  });
});

describe("parseModJar unresolvedRefs", () => {
  it("lists the models and textures the jar's blocks reach but it lacks", () => {
    const parsed = parseModJar(addon());
    expect(parsed.unresolvedRefs).toEqual({
      models: ["base:block/half"],
      textures: [],
    });
    const tinted = parseModJar(
      jar([], {
        ...blockstate("paint:tinted", "paint:block/tinted"),
        ...model("paint:block/tinted", {
          parent: "minecraft:block/cube_all",
          textures: { all: "colours:block/red", particle: "#all" },
        }),
      }),
    );
    // `minecraft:` ids are never listed.
    expect(tinted.unresolvedRefs).toEqual({
      models: [],
      textures: ["colours:block/red"],
    });
  });
});

describe("readJarAssets", () => {
  it("reads only the asked entries, nested and compat packs included", () => {
    const nested = jar(["lib"], texture("lib:block/core", RED));
    const bytes = jar(["outer"], {
      ...cube("outer:thing", BLUE),
      ...texture("outer:block/other", GREEN),
      "META-INF/jarjar/lib.jar": nested,
      [`compat_packs/create/${entry("textures", "outer:block/thing")}`]:
        solidPng(RED),
    });
    const ids = {
      models: ["outer:block/thing", "outer:block/absent"],
      textures: ["outer:block/thing", "lib:block/core"],
    };
    const read = readJarAssets(bytes, ids);
    expect(Object.keys(read.models)).toEqual(["outer:block/thing"]);
    expect(Object.keys(read.textures).sort()).toEqual([
      "lib:block/core",
      "outer:block/thing",
    ]);
    expect(read.textures["outer:block/thing"]).toEqual(solidPng(BLUE));
    // An enabled compat pack sits over the jar's own assets.
    const withPack = readJarAssets(bytes, ids, {
      compatPacks: new Set(["create"]),
    });
    expect(withPack.textures["outer:block/thing"]).toEqual(solidPng(RED));
    // Skipped nested jars aren't read.
    const skipped = readJarAssets(bytes, ids, {
      skipNestedJar: (p) => p === "META-INF/jarjar/lib.jar",
    });
    expect(Object.keys(skipped.textures)).toEqual(["outer:block/thing"]);
  });
});

describe("extractModpack across jars", () => {
  it("gives an addon block the look and kind of its base mod's parent model", async () => {
    const alone = await extract([mod("Addon", 2, addon())]);
    const servoAlone = blockOf(alone.data.blocks, "addon:servo")!;
    expect(servoAlone.appearance).toBeUndefined();
    expect(alone.crossJar).toEqual({
      looks: 0,
      redescribed: 0,
      jarsRead: 0,
      unresolved: { count: 1, namespaces: [{ namespace: "base", count: 1 }] },
    });

    const baseMod = mod("Base", 1, base());
    const both = await extract([baseMod, mod("Addon", 2, addon())]);
    const servo = blockOf(both.data.blocks, "addon:servo")!;
    expect(servo).toMatchObject({ mod: "cf-2", kind: "slab", fullCube: false });
    expect(dominantChannel(servo.appearance?.hex)).toBe(0);
    expect(servo.swatch?.file).toMatch(/^pack-[0-9a-f]{16}$/);
    expect(servo.swatch?.file).toBe(
      packKey(both.swatches.get(servo.swatch!.file)),
    );
    expect(both.packSheets).toEqual([servo.swatch?.file]);
    expect(both.crossJar).toEqual({
      looks: 1,
      redescribed: 1,
      jarsRead: 1,
      unresolved: { count: 0, namespaces: [] },
    });
    // Its jar was read once for the index, once to extract it and once
    // for the addon's model.
    expect(baseMod.reads()).toBe(3);
    // Blocks without refs to other jars are unchanged.
    expect(blockOf(both.data.blocks, "addon:own")).toEqual(
      blockOf(alone.data.blocks, "addon:own"),
    );
  });

  it("keeps a jar's own sheet the same with and without the base jar", async () => {
    const alone = await extract([mod("Addon", 2, addon())]);
    const both = await extract([
      mod("Base", 1, base()),
      mod("Addon", 2, addon()),
    ]);
    expect(alone.swatches.get("cf-2")).toBeDefined();
    expect(both.swatches.get("cf-2")).toEqual(alone.swatches.get("cf-2"));
    expect(blockOf(both.data.blocks, "addon:own")?.swatch?.file).toBe("cf-2");
  });

  it("takes a texture from a third jar", async () => {
    const painted = jar(["painted"], {
      ...blockstate("painted:wall", "painted:block/wall"),
      ...model("painted:block/wall", {
        parent: "minecraft:block/cube_all",
        textures: { all: "colours:block/green" },
      }),
    });
    const colours = jar(["colours"], texture("colours:block/green", GREEN));
    const { data, crossJar } = await extract([
      mod("Base", 1, base()),
      mod("Painted", 2, painted),
      mod("Colours", 3, colours),
    ]);
    const wall = blockOf(data.blocks, "painted:wall")!;
    expect(wall).toMatchObject({ kind: "block", fullCube: true });
    expect(dominantChannel(wall.appearance?.hex)).toBe(1);
    expect(wall.swatch?.file).toMatch(/^pack-/);
    expect(crossJar.jarsRead).toBe(1);
  });

  it("follows a parent chain across three jars", async () => {
    const top = jar(["top"], {
      ...blockstate("top:block", "top:block/block"),
      ...model("top:block/block", { parent: "mid:block/frame" }),
    });
    const mid = jar(["mid"], {
      ...model("mid:block/frame", { parent: "root:block/cube" }),
    });
    const root = jar(["root"], {
      ...model("root:block/cube", {
        parent: "minecraft:block/cube_all",
        textures: { all: "root:block/skin" },
      }),
      ...texture("root:block/skin", BLUE),
    });
    const { data, crossJar } = await extract([
      mod("Root", 1, root),
      mod("Mid", 2, mid),
      mod("Top", 3, top),
    ]);
    const block = blockOf(data.blocks, "top:block")!;
    expect(block.kind).toBe("block");
    expect(dominantChannel(block.appearance?.hex)).toBe(2);
    expect(crossJar).toMatchObject({ looks: 1, jarsRead: 2 });
    expect(crossJar.unresolved.count).toBe(0);
  });

  it("counts refs no jar provides as unresolved", async () => {
    const ghostly = jar(["ghostly"], {
      ...blockstate("ghostly:wisp", "ghost:block/wisp"),
      ...blockstate("ghostly:shade", "ghostly:block/shade"),
      ...model("ghostly:block/shade", {
        parent: "minecraft:block/cube_all",
        textures: { all: "ghost:block/shade" },
      }),
    });
    const { data, crossJar } = await extract([
      mod("Base", 1, base()),
      mod("Ghostly", 2, ghostly),
    ]);
    expect(blockOf(data.blocks, "ghostly:wisp")?.appearance).toBeUndefined();
    expect(blockOf(data.blocks, "ghostly:shade")?.appearance).toBeUndefined();
    expect(crossJar).toEqual({
      looks: 0,
      redescribed: 0,
      jarsRead: 0,
      unresolved: { count: 2, namespaces: [{ namespace: "ghost", count: 2 }] },
    });
  });

  it("prefers the jar of the id's namespace, then the first jar", async () => {
    const user = jar(["user"], {
      ...blockstate("user:block", "user:block/block"),
      ...model("user:block/block", {
        parent: "minecraft:block/cube_all",
        textures: { all: "shared:block/skin" },
      }),
    });
    const other = jar(["other"], texture("shared:block/skin", RED));
    const shared = jar(["shared"], texture("shared:block/skin", GREEN));
    const third = jar(["third"], texture("shared:block/skin", BLUE));
    const owner = await extract([
      mod("Other", 1, other),
      mod("Shared", 2, shared),
      mod("User", 3, user),
    ]);
    expect(
      dominantChannel(
        blockOf(owner.data.blocks, "user:block")?.appearance?.hex,
      ),
    ).toBe(1);
    const first = await extract([
      mod("Other", 1, other),
      mod("Third", 2, third),
      mod("User", 3, user),
    ]);
    expect(
      dominantChannel(
        blockOf(first.data.blocks, "user:block")?.appearance?.hex,
      ),
    ).toBe(0);
  });

  it("uses a jar's own copy of an id over another jar's", async () => {
    // The base model names `shared:block/skin`, which the user jar ships
    // (blue) but doesn't reach on its own; the `shared` mod ships it red.
    const frame = jar(["frame"], {
      ...model("frame:block/cube", {
        parent: "minecraft:block/cube_all",
        textures: { all: "shared:block/skin" },
      }),
    });
    const user = jar(["user"], {
      ...blockstate("user:block", "frame:block/cube"),
      ...texture("shared:block/skin", BLUE),
    });
    const shared = jar(["shared"], texture("shared:block/skin", RED));
    const { data } = await extract([
      mod("Shared", 1, shared),
      mod("Frame", 2, frame),
      mod("User", 3, user),
    ]);
    expect(
      dominantChannel(blockOf(data.blocks, "user:block")?.appearance?.hex),
    ).toBe(2);
  });

  it("resolves a compat-pack block's parent from the compat mod's jar", async () => {
    const seatId = "dyenamicsandfriends:red_seat";
    const compat = (name: string) => `compat_packs/create/${name}`;
    const dnf = jar(["dyenamicsandfriends"], {
      ...cube("dyenamicsandfriends:base", BLUE),
      [compat(entry("blockstates", seatId))]: json({
        variants: { "": { model: "dyenamicsandfriends:block/red_seat" } },
      }),
      [compat(entry("models", "dyenamicsandfriends:block/red_seat"))]: json({
        parent: "create:block/seat/block",
        textures: { 1: "dyenamicsandfriends:block/red_seat" },
      }),
      [compat(entry("textures", "dyenamicsandfriends:block/red_seat"))]:
        solidPng(RED),
    });
    const create = jar(["create"], {
      ...model("create:block/seat/block", {
        textures: { particle: "#1" },
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: Object.fromEntries(
              ["north", "south", "east", "west", "up", "down"].map((face) => [
                face,
                { texture: "#1" },
              ]),
            ),
          },
        ],
      }),
    });
    const { data, compatPacks } = await extract([
      mod("Create", 1, create),
      mod("DnF", 2, dnf),
    ]);
    expect(compatPacks).toEqual([{ mod: "DnF", modId: "create", blocks: 1 }]);
    const seat = blockOf(data.blocks, seatId)!;
    expect(dominantChannel(seat.appearance?.hex)).toBe(0);
    expect(seat.swatch?.file).toMatch(/^pack-/);
    expect(seat).toMatchObject({ kind: "block", fullCube: true });
  });

  it("puts kubejs looks and cross-jar looks in one pack sheet", async () => {
    const kubejs = texture("addon:block/own", GREEN);
    const {
      data,
      packSheets,
      swatches,
      kubejs: kube,
    } = await extract(
      [mod("Base", 1, base()), mod("Addon", 2, addon())],
      kubejs,
    );
    expect(packSheets).toHaveLength(1);
    const [key] = packSheets;
    expect(key).toBe(packKey(swatches.get(key)));
    expect(blockOf(data.blocks, "addon:own")?.swatch?.file).toBe(key);
    expect(blockOf(data.blocks, "addon:servo")?.swatch?.file).toBe(key);
    expect(kube).toMatchObject({ overridden: 1 });
    expect([...swatches.keys()].some((k) => k.startsWith("kubejs-"))).toBe(
      false,
    );
  });

  it("lays kubejs/assets over another jar's model", async () => {
    const kubejs = model("base:block/half", {
      parent: "minecraft:block/cube_all",
      textures: { all: "addon:block/servo" },
    });
    const { data } = await extract(
      [mod("Base", 1, base()), mod("Addon", 2, addon())],
      kubejs,
    );
    expect(blockOf(data.blocks, "addon:servo")).toMatchObject({
      kind: "block",
      fullCube: true,
    });
  });
});

describe("packSwatchSheets", () => {
  it("splits sheets over the size limit instead of posterizing", () => {
    // Noise swatches barely compress.
    let seed = 1;
    const noise = () => {
      const data = new Uint8Array(SWATCH_SIZE * SWATCH_SIZE * 4);
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        data[i] = i % 4 === 3 ? 255 : seed & 0xff;
      }
      return { width: SWATCH_SIZE, height: SWATCH_SIZE, data };
    };
    const blocks: SwatchBlock[] = Array.from({ length: 8 }, (_, i) => ({
      id: `noise:block_${i}`,
      faces: { top: noise(), side: noise(), bottom: noise() },
    }));
    const whole = packSwatchSheets(blocks);
    expect(whole).toHaveLength(1);
    const limit = Math.ceil(whole[0].png.length / 3);
    const sheets = packSwatchSheets(blocks, limit);
    expect(sheets.length).toBeGreaterThan(1);
    for (const sheet of sheets)
      expect(sheet.png.length).toBeLessThanOrEqual(limit);
    expect(sheets.flatMap((sheet) => Object.keys(sheet.uvs))).toEqual(
      blocks.map((block) => block.id),
    );
  });
});
