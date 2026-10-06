import { readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseModJar } from "../../mods/parse-mod-jar";
import { vanillaDescriptorSources } from "../appearance";
import {
  compatBlockRequirement,
  dropAbsentModCompatBlocks,
} from "../compat-blocks";
import {
  extractModpack,
  type ModpackModSource,
  type ModpackSource,
} from "../extract";
import { encodeRgbaPng } from "../png";
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

function solidPng(rgba: [number, number, number, number]): Uint8Array {
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

/** A self-contained cube block under `root` ("" or `compat_packs/<id>/`). */
function cube(id: string, root = ""): Record<string, Uint8Array> {
  const [ns, path] = id.split(":");
  return {
    [`${root}assets/${ns}/blockstates/${path}.json`]: json({
      variants: { "": { model: `${ns}:block/${path}` } },
    }),
    [`${root}assets/${ns}/models/block/${path}.json`]: json({
      parent: "minecraft:block/cube_all",
      textures: { all: `${ns}:block/${path}` },
    }),
    [`${root}assets/${ns}/textures/block/${path}.png`]: solidPng([
      40, 40, 200, 255,
    ]),
  };
}

/**
 * A Dyenamics and Friends-like jar: an unprefixed block, an `assets/`
 * compat block for Another Furniture, and compat packs for Botany Pots and
 * Luminax. Botany Pots' blockstate uses a model of the jar's own assets.
 */
function dyenamicsAndFriends(): Uint8Array {
  return zipSync({
    "META-INF/neoforge.mods.toml": modsToml("dyenamicsandfriends"),
    ...cube("dyenamicsandfriends:amber_wool_carpet"),
    ...cube("dyenamicsandfriends:another_furniture_amber_sofa"),
    "assets/dyenamicsandfriends/models/block/shared_pot.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "dyenamicsandfriends:block/shared_pot" },
    }),
    "assets/dyenamicsandfriends/textures/block/shared_pot.png": solidPng([
      200, 120, 40, 255,
    ]),
    "compat_packs/botanypots/pack.mcmeta": json({ pack: { pack_format: 34 } }),
    "compat_packs/botanypots/assets/dyenamicsandfriends/blockstates/botanypots_amber_terracotta_botany_pot.json":
      json({
        variants: { "": { model: "dyenamicsandfriends:block/shared_pot" } },
      }),
    "compat_packs/botanypots/assets/dyenamicsandfriends/lang/en_us.json": json({
      "block.dyenamicsandfriends.botanypots_amber_terracotta_botany_pot":
        "Amber Terracotta Botany Pot",
    }),
    ...cube("dyenamicsandfriends:luminax_amber_lamp", "compat_packs/luminax/"),
  });
}

function mod(
  name: string,
  fileId: number,
  bytes: Uint8Array,
): ModpackModSource {
  return {
    name,
    fileName: `${name.toLowerCase().replace(/\s+/g, "-")}.jar`,
    curseForgeProjectId: fileId,
    curseForgeFileId: fileId,
    size: bytes.length,
    read: async () => bytes,
  };
}

function pack(mods: ModpackModSource[]): ModpackSource {
  return {
    name: "Compat",
    displayVersion: "1.0",
    minecraftVersion: "1.21.1",
    loader: "neoforge",
    curseForgeProjectId: null,
    packFileId: null,
    hasKubeJs: false,
    warnings: [],
    mods,
  };
}

describe("parseModJar compat packs", () => {
  it("returns compat_packs/<modid>/ blocks separately from the jar's", () => {
    const parsed = parseModJar(dyenamicsAndFriends());
    expect(parsed.blocks.map((b) => b.id)).toEqual([
      "dyenamicsandfriends:amber_wool_carpet",
      "dyenamicsandfriends:another_furniture_amber_sofa",
    ]);
    expect(Object.keys(parsed.compatPacks)).toEqual(["botanypots", "luminax"]);
    const pots = parsed.compatPacks.botanypots;
    expect(pots.namespaces).toEqual(["dyenamicsandfriends"]);
    expect(pots.blocks).toEqual([
      {
        id: "dyenamicsandfriends:botanypots_amber_terracotta_botany_pot",
        displayName: "Amber Terracotta Botany Pot",
        properties: {},
      },
    ]);
    // The pack's blockstate reaches the jar's own model and texture.
    expect(Object.keys(pots.models)).toEqual([
      "dyenamicsandfriends:block/shared_pot",
    ]);
    expect(Object.keys(pots.textures)).toEqual([
      "dyenamicsandfriends:block/shared_pot",
    ]);
    expect(parsed.warnings).toEqual([]);
  });
});

describe("compat blocks across a pack", () => {
  it("reads compat packs of present mods and drops compat blocks of absent ones", async () => {
    const { data, swatches, compatPacks, droppedCompatBlocks } =
      await extractModpack(
        pack([
          mod("Dyenamics and Friends", 1, dyenamicsAndFriends()),
          mod(
            "Botany Pots",
            2,
            zipSync({
              "META-INF/neoforge.mods.toml": modsToml("botanypots"),
              ...cube("botanypots:terracotta_botany_pot"),
            }),
          ),
        ]),
        { vanilla, now: NOW },
      );
    expect(() => modpackDataSchema.parse(data)).not.toThrow();
    expect(data.blocks.map((b) => [b.id, b.mod])).toEqual([
      // The unprefixed block is kept, as before.
      ["botanypots:terracotta_botany_pot", "cf-2"],
      ["dyenamicsandfriends:amber_wool_carpet", "cf-1"],
      ["dyenamicsandfriends:botanypots_amber_terracotta_botany_pot", "cf-1"],
    ]);
    const pot = data.blocks.find(
      (b) =>
        b.id === "dyenamicsandfriends:botanypots_amber_terracotta_botany_pot",
    );
    expect(pot).toMatchObject({
      displayName: "Amber Terracotta Botany Pot",
      properties: {},
      kind: "block",
      fullCube: true,
      swatch: { file: "cf-1" },
    });
    expect(pot?.appearance).toBeDefined();
    expect(swatches.has("cf-1")).toBe(true);
    expect(compatPacks).toEqual([
      { mod: "Dyenamics and Friends", modId: "botanypots", blocks: 1 },
    ]);
    expect(droppedCompatBlocks).toEqual([
      {
        namespace: "dyenamicsandfriends",
        prefix: "another_furniture_",
        modId: "another_furniture",
        count: 1,
      },
    ]);
  });

  it("enables a compat pack for a mod nested in another jar", async () => {
    const { data, compatPacks } = await extractModpack(
      pack([
        mod("Dyenamics and Friends", 1, dyenamicsAndFriends()),
        mod(
          "Lights",
          3,
          zipSync({
            "META-INF/neoforge.mods.toml": modsToml("lights"),
            "META-INF/jarjar/luminax.jar": zipSync({
              "META-INF/neoforge.mods.toml": modsToml("luminax"),
            }),
          }),
        ),
      ]),
      { vanilla, now: NOW },
    );
    expect(compatPacks.map((p) => p.modId)).toEqual(["luminax"]);
    expect(data.blocks.map((b) => b.id)).toContain(
      "dyenamicsandfriends:luminax_amber_lamp",
    );
  });
});

describe("compatBlockRequirement", () => {
  it("takes the longest matching prefix of the block's namespace", () => {
    const table = { mod: { a_: "a", a_b_: "ab" } };
    expect(compatBlockRequirement("mod:a_b_c", table)).toEqual({
      namespace: "mod",
      prefix: "a_b_",
      modId: "ab",
    });
    expect(compatBlockRequirement("mod:a_c", table)?.modId).toBe("a");
    expect(compatBlockRequirement("other:a_c", table)).toBeNull();
    expect(compatBlockRequirement("mod:c", table)).toBeNull();
  });

  it("counts dropped blocks per prefix", () => {
    const { kept, dropped } = dropAbsentModCompatBlocks(
      [
        { id: "dyenamicsandfriends:quark_amber_shingles" },
        { id: "dyenamicsandfriends:quark_amber_shingles_slab" },
        { id: "dyenamicsandfriends:bumblezone_amber_candle" },
        { id: "dyenamicsandfriends:amber_carpet" },
      ],
      new Set(["the_bumblezone"]),
    );
    expect(kept.map((b) => b.id)).toEqual([
      "dyenamicsandfriends:bumblezone_amber_candle",
      "dyenamicsandfriends:amber_carpet",
    ]);
    expect(dropped).toEqual([
      {
        namespace: "dyenamicsandfriends",
        prefix: "quark_",
        modId: "quark",
        count: 2,
      },
    ]);
  });
});
