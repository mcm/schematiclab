import { strFromU8, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  extractProperties,
  MAX_ASSET_BYTES,
  NO_BLOCKS_WARNING,
  parseModJar,
  textureTransferables,
} from "../parse-mod-jar";

// Minimal bytes standing in for PNGs — the parser never decodes them.
const PNG = (tag: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, tag]);

/** Overwrite `name`'s declared uncompressed size in the central directory. */
function withDeclaredSize(
  zip: Uint8Array,
  name: string,
  size: number,
): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(i + 28, true);
    if (strFromU8(out.subarray(i + 46, i + 46 + nameLength)) === name) {
      view.setUint32(i + 24, size, true);
    }
  }
  return out;
}

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

  describe("lenient JSON, as Minecraft's Gson reads it", () => {
    const BLOCKSTATE = { variants: { "": { model: "a:block/b" } } };
    const parseBlockstate = (text: string) =>
      parseModJar(jar({ "assets/a/blockstates/b.json": text }));

    it("ignores trailing junk after the JSON value", () => {
      const result = parseBlockstate(`${JSON.stringify(BLOCKSTATE)}r`);
      expect(result.blockstates["a:b"]).toEqual(BLOCKSTATE);
      expect(result.blocks.map((b) => b.id)).toEqual(["a:b"]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("assets/a/blockstates/b.json");
      expect(result.warnings[0]).toContain("leniently");
    });

    it("ignores a trailing second object", () => {
      const result = parseBlockstate(
        `${JSON.stringify(BLOCKSTATE)}\n{"variants":{"x=1":{"model":"a:block/c"}}}`,
      );
      expect(result.blockstates["a:b"]).toEqual(BLOCKSTATE);
      expect(result.warnings).toHaveLength(1);
    });

    it("ignores line and block comments outside strings", () => {
      const result = parseBlockstate(
        [
          "// header",
          "{ /* the only variant */",
          '  "variants": { "": { "model": "a:block/b" } } // trailing',
          "}",
        ].join("\n"),
      );
      expect(result.blockstates["a:b"]).toEqual(BLOCKSTATE);
      expect(result.warnings).toHaveLength(1);
    });

    it("leaves comment markers inside strings alone", () => {
      const result = parseBlockstate(
        '{"variants":{"":{"model":"a://block/b/*c*/"}}} // note',
      );
      expect(result.blockstates["a:b"]).toEqual({
        variants: { "": { model: "a://block/b/*c*/" } },
      });
      expect(result.warnings).toHaveLength(1);
    });

    it("parses strict-valid files without a warning", () => {
      const result = parseBlockstate(JSON.stringify(BLOCKSTATE, null, 2));
      expect(result.blockstates["a:b"]).toEqual(BLOCKSTATE);
      expect(result.warnings).toEqual([]);
    });

    it.each([
      ["empty", ""],
      ["whitespace", "  \n"],
      ["truncated", '{"variants":{"":{"model":"a:block/b"}}'],
      ["an unterminated string", '{"variants":{"":{"model":"a:block/b}}}'],
      ["an unterminated comment", '/* {"variants":{}}'],
      ["junk before the value", 'r{"variants":{}}'],
    ])("still skips %s input", (_label, text) => {
      const result = parseBlockstate(text);
      expect(result.blockstates).toEqual({});
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toMatch(
        /^Skipped malformed JSON assets\/a\/blockstates\/b\.json: /,
      );
      expect(result.warnings[1]).toBe(NO_BLOCKS_WARNING);
    });
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
  it("keeps a blockstate property named __proto__ as an own property", () => {
    const props = extractProperties({
      variants: {
        "__proto__=a": { model: "testmod:block/x" },
        "__proto__=b,facing=north": { model: "testmod:block/x" },
      },
    });

    expect(Object.keys(props)).toEqual(["__proto__", "facing"]);
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(props, "__proto__")?.value).toEqual([
      "a",
      "b",
    ]);
    // Survives the worker → main thread structured clone.
    const cloned = structuredClone(props);
    expect(Object.entries(cloned)).toEqual([
      ["__proto__", ["a", "b"]],
      ["facing", ["north"]],
    ]);
  });

  it("rejects archives whose declared asset sizes exceed the budget", () => {
    const name = "assets/testmod/blockstates/x.json";
    const bomb = withDeclaredSize(
      jar({ [name]: { variants: {} } }),
      name,
      MAX_ASSET_BYTES + 1,
    );

    expect(() => parseModJar(bomb)).toThrow(/too large/);
  });

  it("never inflates an entry past its declared size", () => {
    // 1 MiB of zeros declared as 16 bytes: output is capped, not grown.
    const name = "assets/testmod/textures/block/x.png";
    const lying = withDeclaredSize(
      jar({
        "assets/testmod/blockstates/x.json": {
          variants: { "": { model: "testmod:block/x" } },
        },
        "assets/testmod/models/block/x.json": {
          textures: { all: "testmod:block/x" },
        },
        [name]: new Uint8Array(1 << 20),
      }),
      name,
      16,
    );

    const result = parseModJar(lying);

    expect(result.textures["testmod:block/x"].byteLength).toBe(16);
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
      templates: {},
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
