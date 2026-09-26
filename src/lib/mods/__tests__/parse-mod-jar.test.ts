import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  NO_BLOCKS_WARNING,
  parseModJar,
  textureTransferables,
} from "../parse-mod-jar";

// Minimal bytes standing in for PNGs — the parser never decodes them.
const PNG = (tag: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, tag]);

function jar(files: Record<string, string | Uint8Array | object>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] =
      value instanceof Uint8Array
        ? value
        : strToU8(typeof value === "string" ? value : JSON.stringify(value));
  }
  return zipSync(entries);
}

describe("parseModJar", () => {
  it("extracts properties from variants keys", () => {
    const result = parseModJar(
      jar({
        "assets/testmod/blockstates/fancy_stairs.json": {
          variants: {
            "facing=north,half=top": { model: "testmod:block/fancy_stairs" },
            "facing=south,half=bottom": [
              { model: "testmod:block/fancy_stairs", y: 180 },
            ],
          },
        },
        "assets/testmod/blockstates/plain.json": {
          variants: { "": { model: "testmod:block/plain" } },
        },
      }),
    );

    expect(result.namespaces).toEqual(["testmod"]);
    expect(result.blocks.map((b) => b.id)).toEqual([
      "testmod:fancy_stairs",
      "testmod:plain",
    ]);
    expect(result.blocks[0].properties).toEqual({
      facing: ["north", "south"],
      half: ["bottom", "top"],
    });
    expect(result.blocks[1].properties).toEqual({});
    expect(Object.keys(result.blockstates)).toEqual([
      "testmod:fancy_stairs",
      "testmod:plain",
    ]);
  });

  it("extracts properties from multipart when conditions", () => {
    const result = parseModJar(
      jar({
        "assets/testmod/blockstates/pipe.json": {
          multipart: [
            { apply: { model: "testmod:block/pipe_core" } },
            {
              when: { north: "true", axis: "x|z" },
              apply: { model: "testmod:block/pipe_side" },
            },
            {
              when: {
                OR: [{ east: "true" }, { west: "false|true", powered: true }],
              },
              apply: { model: "testmod:block/pipe_side" },
            },
            {
              when: { AND: [{ level: 1 }, { level: "2" }] },
              apply: { model: "testmod:block/pipe_side" },
            },
          ],
        },
      }),
    );

    expect(result.blocks[0].properties).toEqual({
      axis: ["x", "z"],
      east: ["true"],
      level: ["1", "2"],
      north: ["true"],
      powered: ["true"],
      west: ["false", "true"],
    });
  });

  it("uses lang display names with title-cased fallback", () => {
    const result = parseModJar(
      jar({
        "assets/create/blockstates/andesite_casing.json": { variants: {} },
        "assets/create/blockstates/brass_casing.json": { variants: {} },
        "assets/create/lang/en_us.json": {
          "block.create.brass_casing": "Brass Casing (Shiny)",
        },
      }),
    );

    expect(result.blocks).toEqual([
      {
        id: "create:andesite_casing",
        displayName: "Andesite Casing",
        properties: {},
      },
      {
        id: "create:brass_casing",
        displayName: "Brass Casing (Shiny)",
        properties: {},
      },
    ]);
  });

  it("ignores assets/minecraft/** and non-asset entries", () => {
    const result = parseModJar(
      jar({
        "assets/minecraft/blockstates/stone.json": {
          variants: { "": { model: "minecraft:block/stone" } },
        },
        "assets/minecraft/textures/block/stone.png": PNG(1),
        "assets/testmod/blockstates/gem_block.json": {
          variants: { "": { model: "testmod:block/gem_block" } },
        },
        "com/example/TestMod.class": new Uint8Array([0xca, 0xfe]),
        "data/testmod/recipes/gem.json": { type: "crafting" },
      }),
    );

    expect(result.namespaces).toEqual(["testmod"]);
    expect(result.blocks.map((b) => b.id)).toEqual(["testmod:gem_block"]);
    expect(Object.keys(result.textures)).toEqual([]);
  });

  it("keeps only textures transitively referenced by reachable models", () => {
    const result = parseModJar(
      jar({
        "assets/testmod/blockstates/machine.json": {
          variants: {
            "lit=false": { model: "testmod:block/machine" },
            "lit=true": { model: "testmod:block/machine_on" },
          },
        },
        "assets/testmod/models/block/machine_base.json": {
          parent: "block/cube",
          textures: {
            particle: "#side",
            down: "testmod:block/machine_bottom",
            up: "#top",
          },
        },
        "assets/testmod/models/block/machine.json": {
          parent: "testmod:block/machine_base",
          textures: { side: "testmod:block/machine_side", top: "#side" },
        },
        "assets/testmod/models/block/machine_on.json": {
          parent: "testmod:block/machine",
          textures: { side: { sprite: "testmod:block/machine_side_on" } },
        },
        "assets/testmod/models/item/unused.json": {
          textures: { layer0: "testmod:item/unused" },
        },
        "assets/testmod/textures/block/machine_side.png": PNG(1),
        "assets/testmod/textures/block/machine_side_on.png": PNG(2),
        "assets/testmod/textures/block/machine_side_on.png.mcmeta": {
          animation: { frametime: 2 },
        },
        "assets/testmod/textures/block/machine_bottom.png": PNG(3),
        "assets/testmod/textures/item/unused.png": PNG(4),
        "assets/testmod/textures/block/orphan.png": PNG(5),
      }),
    );

    expect(Object.keys(result.textures).sort()).toEqual([
      "testmod:block/machine_bottom",
      "testmod:block/machine_side",
      "testmod:block/machine_side_on",
    ]);
    expect(result.textures["testmod:block/machine_side_on"]).toEqual(PNG(2));
    expect(result.textureMeta).toEqual({
      "testmod:block/machine_side_on": { animation: { frametime: 2 } },
    });
    expect(Object.keys(result.models).sort()).toEqual([
      "testmod:block/machine",
      "testmod:block/machine_base",
      "testmod:block/machine_on",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("skips malformed JSON with a warning instead of throwing", () => {
    const result = parseModJar(
      jar({
        "assets/testmod/blockstates/broken.json": "{ not json",
        "assets/testmod/blockstates/fine.json": { variants: {} },
        "assets/testmod/models/block/bad.json": "[1,",
      }),
    );

    expect(result.blocks.map((b) => b.id)).toEqual(["testmod:fine"]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain(
      "assets/testmod/blockstates/broken.json",
    );
    expect(result.warnings[1]).toContain(
      "assets/testmod/models/block/bad.json",
    );
  });

  it("returns no blocks and a warning for a mod without blockstates", () => {
    const result = parseModJar(
      jar({
        "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\n",
        "assets/libmod/lang/en_us.json": { "item.libmod.thing": "Thing" },
      }),
    );

    expect(result.blocks).toEqual([]);
    expect(result.warnings).toEqual([NO_BLOCKS_WARNING]);
  });
});

describe("textureTransferables", () => {
  it("returns one exactly-sized, unique buffer per texture", () => {
    const shared = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const textures = {
      "a:x": shared.subarray(0, 3),
      "a:y": shared.subarray(3),
      "a:z": new Uint8Array([7, 8]),
    };
    const result = {
      namespaces: ["a"],
      blocks: [],
      blockstates: {},
      models: {},
      textures,
      textureMeta: {},
      warnings: [],
    };

    const buffers = textureTransferables(result);

    expect(buffers).toHaveLength(3);
    expect(new Set(buffers).size).toBe(3);
    for (const bytes of Object.values(result.textures)) {
      expect(bytes.byteOffset).toBe(0);
      expect(bytes.byteLength).toBe(bytes.buffer.byteLength);
      expect(buffers).toContain(bytes.buffer);
    }
    expect(result.textures["a:y"]).toEqual(new Uint8Array([4, 5, 6]));
  });
});
