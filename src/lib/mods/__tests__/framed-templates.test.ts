// FramedBlocks templates from a loaded jar: parsed in the jar parser,
// persisted with the mod's assets and applied over the committed shape pack.
// Jars are synthetic zips built here, never the real jars in references/.

import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { IDBFactory } from "fake-indexeddb";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  validateShapePack,
  type TemplateCube,
} from "@/lib/render/camo/shape-pack";
import {
  applyTemplateOverrides,
  mergeTemplates,
} from "@/lib/render/camo/template-overrides";

import { MAX_ASSET_BYTES, parseModJar } from "../parse-mod-jar";
import * as registry from "../registry";
import * as store from "../store";
import { toLoadedModAssets, type LoadedModMeta } from "../types";

const PACK = validateShapePack(
  JSON.parse(
    readFileSync(
      path.resolve(
        __dirname,
        "../../../../public/camo-shapes/framedblocks.json",
      ),
      "utf8",
    ),
  ),
);

const BLOCKSTATE = {
  variants: { "": { model: "framedblocks:block/framed_cube" } },
};

// FramedBlocks' own template for `framed_centered_slab`, split in two.
const CENTERED_SLAB = {
  elements: [
    {
      from: [0, 4, 0],
      to: [16, 8, 16],
      faces: { down: false, north: true, south: true, west: true, east: true },
    },
    {
      from: [0, 8, 0],
      to: [16, 12, 16],
      faces: {
        up: false,
        north: { cullface: "north" },
        south: {},
        west: true,
        east: true,
      },
    },
  ],
};

function jar(files: Record<string, object>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, json]) => [
        name,
        strToU8(JSON.stringify(json)),
      ]),
    ),
  );
}

const WITH_TEMPLATES = () =>
  jar({
    "assets/framedblocks/blockstates/framed_cube.json": BLOCKSTATE,
    "assets/framedblocks/framed_templates/centered_slab.json": CENTERED_SLAB,
  });

// Like the 1.21.1 FramedBlocks-10.6.2 jar: blocks, no framed_templates.
const WITHOUT_TEMPLATES = () =>
  jar({ "assets/framedblocks/blockstates/framed_cube.json": BLOCKSTATE });

function meta(fileId: number): LoadedModMeta {
  return {
    key: "1:26.1.2",
    modId: 1,
    modName: "FramedBlocks",
    modSlug: "framedblocks",
    logoUrl: null,
    fileId,
    fileDisplayName: `FramedBlocks-${fileId}.jar`,
    gameVersion: "26.1.2",
    gameVersions: ["26.1.2"],
    loader: "neoforge",
    namespaces: ["framedblocks"],
    blocks: [],
    loadedAt: fileId,
  };
}

beforeEach(async () => {
  await store.__resetModStoreForTests();
  registry.__resetLoadedModsForTests();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseModJar templates", () => {
  it("parses assets/framedblocks/framed_templates/*.json", () => {
    const result = parseModJar(WITH_TEMPLATES());

    expect(result.warnings).toEqual([]);
    expect(result.templates).toEqual({
      "framedblocks:centered_slab": [
        {
          box: { from: [0, 4, 0], to: [16, 8, 16] },
          faces: {
            down: false,
            north: true,
            south: true,
            west: true,
            east: true,
          },
        },
        {
          box: { from: [0, 8, 0], to: [16, 12, 16] },
          faces: {
            up: false,
            north: true,
            south: false,
            west: true,
            east: true,
          },
        },
      ],
    });
  });

  it("returns no templates for a jar without them", () => {
    const result = parseModJar(WITHOUT_TEMPLATES());
    expect(result.templates).toEqual({});
    expect(toLoadedModAssets(result)).not.toHaveProperty("templates");
  });

  it("ignores templates outside the framedblocks namespace and nested paths", () => {
    const result = parseModJar(
      jar({
        "assets/framedblocks/blockstates/framed_cube.json": BLOCKSTATE,
        "assets/othermod/framed_templates/centered_slab.json": CENTERED_SLAB,
        "assets/framedblocks/framed_templates/sub/x.json": CENTERED_SLAB,
        "framedblocks/framed_templates/centered_slab.json": CENTERED_SLAB,
      }),
    );
    expect(result.templates).toEqual({});
    expect(result.namespaces).toEqual(["framedblocks"]);
  });

  it("skips malformed and invalid templates with a warning", () => {
    const bytes = zipSync({
      "assets/framedblocks/blockstates/framed_cube.json": strToU8(
        JSON.stringify(BLOCKSTATE),
      ),
      "assets/framedblocks/framed_templates/broken.json": strToU8("{"),
      "assets/framedblocks/framed_templates/invalid.json": strToU8(
        JSON.stringify({ elements: [{ from: [0, 0, 0], to: [1, 1, 99] }] }),
      ),
      "assets/framedblocks/framed_templates/centered_slab.json": strToU8(
        JSON.stringify(CENTERED_SLAB),
      ),
    });
    const result = parseModJar(bytes);

    expect(Object.keys(result.templates)).toEqual([
      "framedblocks:centered_slab",
    ]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/broken\.json/);
    expect(result.warnings[1]).toMatch(/invalid\.json/);
  });

  it("counts templates against the zip-bomb budget", () => {
    const name = "assets/framedblocks/framed_templates/centered_slab.json";
    const bomb = WITH_TEMPLATES();
    // Declare the template's uncompressed size past the budget.
    const view = new DataView(bomb.buffer);
    for (let i = 0; i + 46 <= bomb.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const length = view.getUint16(i + 28, true);
      if (
        new TextDecoder().decode(bomb.subarray(i + 46, i + 46 + length)) ===
        name
      ) {
        view.setUint32(i + 24, MAX_ASSET_BYTES + 1, true);
      }
    }
    expect(() => parseModJar(bomb)).toThrow(/too large/);
  });
});

describe("persisted templates", () => {
  it("survive a reload through IndexedDB", async () => {
    const assets = toLoadedModAssets(parseModJar(WITH_TEMPLATES()));
    await registry.addLoadedMod(meta(10), assets);

    await store.__resetModStoreForTests();
    registry.__resetLoadedModsForTests();
    await registry.hydrateLoadedMods();

    const reloaded = await registry.getLoadedModAssets("1:26.1.2");
    expect(reloaded?.templates).toEqual(assets.templates);
    expect(Object.keys(reloaded?.templates ?? {})).toEqual([
      "framedblocks:centered_slab",
    ]);
  });

  it("are kept by the in-memory fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // @ts-expect-error simulate an environment without IndexedDB
    delete globalThis.indexedDB;

    await registry.hydrateLoadedMods();
    const assets = toLoadedModAssets(parseModJar(WITH_TEMPLATES()));
    await registry.addLoadedMod(meta(10), assets);

    const kept = await registry.getLoadedModAssets("1:26.1.2");
    expect(kept?.templates).toEqual(assets.templates);
  });
});

describe("templates over the committed pack", () => {
  it("replace the pack's template of the same name", () => {
    const mods = [toLoadedModAssets(parseModJar(WITH_TEMPLATES()))];
    const result = applyTemplateOverrides(PACK, mergeTemplates(mods));

    const [rule] = result.blocks["framedblocks:framed_centered_slab"];
    expect(rule.pieces.map((piece) => [piece.select, piece.cull])).toEqual([
      [
        { from: [0, 4, 0], to: [16, 8, 16] },
        ["north", "south", "west", "east"],
      ],
      [{ from: [0, 8, 0], to: [16, 12, 16] }, ["north", "west", "east"]],
    ]);
    // Other templates still come from the pack.
    expect(result.blocks["framedblocks:framed_stairs"]).toBe(
      PACK.blocks["framedblocks:framed_stairs"],
    );
  });

  it("leave the pack unchanged for a jar without templates", () => {
    const mods = [toLoadedModAssets(parseModJar(WITHOUT_TEMPLATES()))];
    expect(applyTemplateOverrides(PACK, mergeTemplates(mods))).toBe(PACK);
  });

  it("rebuild the pack exactly from the templates it was made from", () => {
    // Every tagged use, rebuilt from the pack's own cubes, is unchanged.
    const templates: Record<string, TemplateCube[]> = {};
    for (const rules of Object.values(PACK.blocks)) {
      for (const rule of rules) {
        for (const piece of rule.pieces) {
          if (piece.template === undefined || piece.ops.length > 0) continue;
          const cubes = (templates[piece.template.id] ??= []);
          cubes[piece.template.element] ??= {
            box: piece.select,
            faces: Object.fromEntries(
              piece.faces.map((dir) => [dir, piece.cull.includes(dir)]),
            ),
          };
        }
      }
    }
    const rebuilt = applyTemplateOverrides(PACK, templates);
    expect(rebuilt).not.toBe(PACK);
    expect(rebuilt).toEqual(PACK);
  });
});
