// UCW block id → rule and states, against hand-built loaded files. Rule JSON
// and blockstates are hand-written here; no `ucwdefs` or mod files are copied.

import { describe, expect, it } from "vitest";

import type { LoadedModAssets, LoadedModMeta, ModBlock } from "../../../types";
import { getGeneratedBlockProvider } from "../../registry";
import type { GeneratedBlockFiles } from "../../types";
import { UCW_PROVIDER } from "../provider";
import {
  blockstatePropertyOrder,
  parseUcwBlockId,
  resolveUcwBlock,
  ucwBlockId,
  type UcwResolution,
} from "../resolve";
import {
  parseUcwRuleFile,
  UCW_RULES_FORMAT_VERSION,
  type UcwBlockRule,
  type UcwProviderData,
  type UcwRuleFile,
} from "../rules";

function ruleFile(path: string, json: unknown): UcwRuleFile {
  const warnings: string[] = [];
  const file = parseUcwRuleFile(path, json, warnings);
  expect(warnings).toEqual([]);
  return file!;
}

function rule(json: unknown): UcwBlockRule {
  return ruleFile("test.json", { blocks: [json] }).rules[0];
}

interface FakeMod {
  blocks?: ModBlock[];
  blockstates?: Record<string, unknown>;
}

/** Loaded files: UCW with `rules` (unless null) plus `mods` by namespace. */
function fakeFiles(
  rules: UcwRuleFile[] | null,
  mods: Record<string, FakeMod>,
): GeneratedBlockFiles {
  const all: Record<string, FakeMod & { data?: UcwProviderData }> = {
    ...mods,
  };
  if (rules !== null) {
    all.unlimitedchiselworks = {
      data: { formatVersion: UCW_RULES_FORMAT_VERSION, files: rules },
    };
  }
  const metas = new Map<string, LoadedModMeta>();
  const assets = new Map<string, LoadedModAssets>();
  Object.entries(all).forEach(([namespace, mod], index) => {
    const meta = {
      key: `${index}:1.12.2`,
      modId: index,
      gameVersion: "1.12.2",
      namespaces: [namespace],
      blocks: mod.blocks ?? [],
    } as unknown as LoadedModMeta;
    metas.set(namespace, meta);
    assets.set(meta.key, {
      blockstates: mod.blockstates ?? {},
      models: {},
      textures: {},
      textureMeta: {},
      ...(mod.data ? { providerData: { [namespace]: mod.data } } : {}),
    });
  });
  return {
    gameVersion: "1.12.2",
    files: [...metas.values()],
    fileForNamespace: (namespace) => metas.get(namespace) ?? null,
    blocks: (namespace) =>
      new Map(
        (metas.get(namespace)?.blocks ?? []).map((block) => [block.id, block]),
      ),
    assets: (file) => assets.get(file.key) ?? null,
    providerData: (namespace) =>
      assets.get(metas.get(namespace)?.key ?? "")?.providerData?.[namespace],
  };
}

function modBlock(
  id: string,
  displayName: string,
  properties: Record<string, string[]> = {},
): ModBlock {
  return { id, displayName, properties };
}

const VARIATIONS = Array.from({ length: 16 }, (_, i) => String(i));

function chiselMod(...ids: string[]): FakeMod {
  return {
    blocks: ids.map((id) =>
      modBlock(id, `Chisel ${id}`, { variation: [...VARIATIONS].sort() }),
    ),
  };
}

// Forge 1.12 `forge_marker` blockstate: values listed out of sorted order.
const NETHER_PLANKS_TYPES = ["ghostwood", "bloodwood", "darkwood", "fusewood"];
const NATURA: FakeMod = {
  blocks: [modBlock("natura:nether_planks", "Nether Planks")],
  blockstates: {
    "natura:nether_planks": {
      forge_marker: 1,
      defaults: { model: "cube_all" },
      variants: {
        inventory: [{}],
        type: Object.fromEntries(
          NETHER_PLANKS_TYPES.map((type) => [
            type,
            { textures: { all: `natura:blocks/${type}` } },
          ]),
        ),
      },
    },
  },
};

const NATURA_RULES = ruleFile("chisel/natura.json", {
  modid: ["chisel", "natura"],
  blocks: [
    {
      from: { block: "natura:nether_planks", iterate: ["type"] },
      mode: "plank",
      through: { block: "chisel:planks-oak", iterate: ["variation"] },
      based_upon: { state: "minecraft:planks#variant=oak" },
    },
  ],
});

// Vanilla-format blockstate.
const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime"];
const ALABASTER: FakeMod = {
  blocks: [
    modBlock("environmentalmaterials:alabaster_bricks", "Alabaster Bricks", {
      color: [...COLORS].sort(),
    }),
  ],
  blockstates: {
    "environmentalmaterials:alabaster_bricks": {
      variants: Object.fromEntries(
        COLORS.map((color) => [`color=${color}`, { model: color }]),
      ),
    },
  },
};

// `meta-overrides.ts` pins alabaster's real (dye) order; tests of the
// blockstate-order guess pass no overrides.
const NO_OVERRIDES = {};

const ALABASTER_RULES = ruleFile("chisel/environmentalmaterials.json", {
  modid: ["chisel", "environmentalmaterials"],
  blocks: ["chisel:stonebrick", "chisel:stonebrick1", "chisel:stonebrick2"].map(
    (through) => ({
      from: {
        block: "environmentalmaterials:alabaster_bricks",
        iterate: ["color"],
      },
      through: { block: through, iterate: ["variation"] },
      based_upon: { state: "minecraft:stonebrick#variant=stonebrick" },
    }),
  ),
});

function expectResolved(
  resolution: UcwResolution,
): Extract<UcwResolution, { kind: "resolved" }> {
  expect(resolution.kind).toBe("resolved");
  return resolution as Extract<UcwResolution, { kind: "resolved" }>;
}

describe("ucwBlockId", () => {
  it("names blocks like UCWBlockRule", () => {
    expect(ucwBlockId(NATURA_RULES.rules[0], 0)).toBe(
      "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0",
    );
    expect(
      ucwBlockId(
        rule({
          from: { state: "minecraft:planks#variant=spruce" },
          through: { block: "chisel:planks-oak" },
          based_upon: { state: "minecraft:planks#variant=oak" },
        }),
        1,
      ),
    ).toBe("unlimitedchiselworks:chisel_planks_oak_minecraft_planks_1");
  });

  it("splits ids into prefix and metadata", () => {
    expect(
      parseUcwBlockId(
        "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_12",
      ),
    ).toEqual({
      prefix: "chisel_planks_oak_natura_nether_planks_",
      fromMeta: 12,
    });
    expect(parseUcwBlockId("chisel:planks_oak_0")).toBeNull();
    expect(parseUcwBlockId("unlimitedchiselworks:no_meta")).toBeNull();
    expect(parseUcwBlockId("unlimitedchiselworks:leading_zero_01")).toBeNull();
  });
});

describe("blockstatePropertyOrder", () => {
  it("reads Forge property objects and vanilla keys in listed order", () => {
    expect(
      blockstatePropertyOrder(NATURA.blockstates!["natura:nether_planks"]),
    ).toEqual(new Map([["type", NETHER_PLANKS_TYPES]]));
    expect(
      blockstatePropertyOrder({
        variants: { "axis=y,variant=b": {}, "axis=x,variant=a": {} },
      }),
    ).toEqual(
      new Map([
        ["axis", ["y", "x"]],
        ["variant", ["b", "a"]],
      ]),
    );
    expect(blockstatePropertyOrder({ multipart: [] })).toBeNull();
  });
});

describe("resolveUcwBlock", () => {
  const naturaFiles = fakeFiles([NATURA_RULES], {
    chisel: chiselMod("chisel:planks-oak"),
    natura: NATURA,
  });

  it("resolves an unambiguous prefix through an iterate rule", () => {
    const resolved = expectResolved(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_2",
        { variation: "3" },
        naturaFiles,
      ),
    );
    expect(resolved.rule).toBe(NATURA_RULES.rules[0]);
    expect(resolved.fromMeta).toBe(2);
    // Blockstate order, not the sorted ModBlock order.
    expect(resolved.from).toEqual({
      block: "natura:nether_planks",
      properties: { type: "darkwood" },
    });
    expect(resolved.through).toEqual({
      block: "chisel:planks-oak",
      properties: { variation: "3" },
    });
    expect(resolved.approximate).toBe(true);
    expect(resolved.warnings).toEqual([]);
  });

  it("iterates only the rule's iterate properties", () => {
    const files = fakeFiles(
      [
        ruleFile("logs.json", {
          modid: ["chisel", "logmod"],
          blocks: [
            {
              from: { block: "logmod:log", iterate: ["variant"] },
              through: { block: "chisel:planks-oak" },
              based_upon: { state: "minecraft:log#variant=oak" },
            },
          ],
        }),
      ],
      {
        chisel: chiselMod("chisel:planks-oak"),
        logmod: {
          blockstates: {
            "logmod:log": {
              variants: {
                "axis=y,variant=maple": {},
                "axis=y,variant=pine": {},
                "axis=x,variant=maple": {},
              },
            },
          },
        },
      },
    );
    const resolved = expectResolved(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_logmod_log_1",
        { variation: "0" },
        files,
      ),
    );
    expect(resolved.from.properties).toEqual({ variant: "pine" });
  });

  it("picks the rule of an ambiguous from block by its through block", () => {
    const files = fakeFiles([ALABASTER_RULES], {
      chisel: chiselMod(
        "chisel:stonebrick",
        "chisel:stonebrick1",
        "chisel:stonebrick2",
      ),
      environmentalmaterials: ALABASTER,
    });
    const id = (through: string, meta: number) =>
      `unlimitedchiselworks:chisel_${through}_environmentalmaterials_alabaster_bricks_${meta}`;

    const plain = expectResolved(
      resolveUcwBlock(
        id("stonebrick", 3),
        { variation: "0" },
        files,
        NO_OVERRIDES,
      ),
    );
    expect(plain.rule).toBe(ALABASTER_RULES.rules[0]);
    expect(plain.from.properties).toEqual({ color: "light_blue" });
    expect(plain.through.block).toBe("chisel:stonebrick");
    expect(plain.approximate).toBe(true);

    const one = expectResolved(
      // Chisel's stonebrick1 has 10 variations (`chisel.ts`).
      resolveUcwBlock(
        id("stonebrick1", 5),
        { variation: "9" },
        files,
        NO_OVERRIDES,
      ),
    );
    expect(one.rule).toBe(ALABASTER_RULES.rules[1]);
    expect(one.from.properties).toEqual({ color: "lime" });
    expect(one.through).toEqual({
      block: "chisel:stonebrick1",
      properties: { variation: "9" },
    });
  });

  it("picks the rule sharing a prefix whose from state has the meta", () => {
    const shared = (color: string) => ({
      from: { state: `environmentalmaterials:alabaster_bricks#color=${color}` },
      through: { block: "chisel:stonebrick" },
      based_upon: { state: "minecraft:stonebrick#variant=stonebrick" },
    });
    const file = ruleFile("dupes.json", {
      modid: ["chisel", "environmentalmaterials"],
      blocks: [shared("magenta"), shared("orange"), shared("orange")],
    });
    const files = fakeFiles([file], {
      chisel: chiselMod("chisel:stonebrick"),
      environmentalmaterials: ALABASTER,
    });
    const id = (meta: number) =>
      `unlimitedchiselworks:chisel_stonebrick_environmentalmaterials_alabaster_bricks_${meta}`;

    const magenta = expectResolved(resolveUcwBlock(id(2), {}, files));
    expect(magenta.rule).toBe(file.rules[0]);
    expect(magenta.from.properties).toEqual({ color: "magenta" });

    // Rules 1 and 2 both have meta 1: the first in file order wins.
    const orange = expectResolved(resolveUcwBlock(id(1), {}, files));
    expect(orange.rule).toBe(file.rules[1]);
    expect(orange.from.properties).toEqual({ color: "orange" });

    // No rule has meta 9: the first is shown, with a warning.
    const unknown = expectResolved(resolveUcwBlock(id(9), {}, files));
    expect(unknown.rule).toBe(file.rules[0]);
    expect(unknown.approximate).toBe(true);
    expect(unknown.warnings[0]).toMatch(/metadata 9/);
  });

  it("registers loadLate files after the others", () => {
    const early = ruleFile("b.json", {
      modid: ["chisel", "natura"],
      blocks: [
        {
          from: { block: "natura:nether_planks" },
          through: { block: "chisel:planks-oak" },
          based_upon: { state: "minecraft:planks#variant=oak" },
        },
      ],
    });
    const late = { ...early, path: "a.json", loadLate: true };
    const files = fakeFiles([late, early], {
      chisel: chiselMod("chisel:planks-oak"),
      natura: NATURA,
    });
    const resolved = expectResolved(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0",
        { variation: "0" },
        files,
      ),
    );
    expect(resolved.file).toBe(early);
  });

  it("indexes explicit state lists in listed order", () => {
    const file = ruleFile("list.json", {
      modid: ["chisel", "environmentalmaterials"],
      blocks: [
        {
          from: {
            state: [
              "environmentalmaterials:alabaster_bricks#color=yellow",
              "environmentalmaterials:alabaster_bricks#color=white",
            ],
          },
          through: { block: "chisel:stonebrick" },
          based_upon: { state: "minecraft:stonebrick#variant=stonebrick" },
        },
      ],
    });
    const files = fakeFiles([file], {
      chisel: chiselMod("chisel:stonebrick"),
      environmentalmaterials: ALABASTER,
    });
    const id = (meta: number) =>
      `unlimitedchiselworks:chisel_stonebrick_environmentalmaterials_alabaster_bricks_${meta}`;
    const first = expectResolved(
      resolveUcwBlock(id(0), {}, files, NO_OVERRIDES),
    );
    expect(first.from.properties).toEqual({ color: "yellow" });
    expect(first.approximate).toBe(true);
    const second = expectResolved(
      resolveUcwBlock(id(1), {}, files, NO_OVERRIDES),
    );
    expect(second.from.properties).toEqual({ color: "white" });
  });

  it("uses the Forge 1.12 table for minecraft states (exact)", () => {
    const file = ruleFile("vanilla.json", {
      modid: ["chisel"],
      blocks: [
        {
          from: { state: "minecraft:planks#variant=spruce" },
          through: { block: "chisel:planks-oak" },
          based_upon: { state: "minecraft:planks#variant=oak" },
        },
        {
          from: { block: "minecraft:stone", iterate: ["variant"] },
          through: { block: "chisel:planks-oak" },
          based_upon: { state: "minecraft:planks#variant=oak" },
        },
      ],
    });
    const files = fakeFiles([file], {
      chisel: chiselMod("chisel:planks-oak"),
    });
    const spruce = expectResolved(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_minecraft_planks_1",
        { variation: "0" },
        files,
      ),
    );
    expect(spruce.from).toEqual({
      block: "minecraft:planks",
      properties: { variant: "spruce" },
    });
    expect(spruce.approximate).toBe(false);
    // The single state's real meta is 1, so meta 0 doesn't exist.
    expect(
      expectResolved(
        resolveUcwBlock(
          "unlimitedchiselworks:chisel_planks_oak_minecraft_planks_0",
          { variation: "0" },
          files,
        ),
      ).warnings[0],
    ).toMatch(/metadata 0/);

    const diorite = expectResolved(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_minecraft_stone_3",
        { variation: "0" },
        files,
      ),
    );
    expect(diorite.from.properties).toEqual({ variant: "diorite" });
    expect(diorite.approximate).toBe(false);
  });

  it("prefers the override table, which is exact", () => {
    const overrides = {
      "natura:nether_planks": [
        "type=fusewood",
        null,
        "type=ghostwood",
        "type=bloodwood",
      ],
    };
    const resolve = (meta: number) =>
      resolveUcwBlock(
        `unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_${meta}`,
        { variation: "0" },
        naturaFiles,
        overrides,
      );
    const fusewood = expectResolved(resolve(0));
    expect(fusewood.from.properties).toEqual({ type: "fusewood" });
    expect(fusewood.approximate).toBe(false);
    expect(expectResolved(resolve(3)).from.properties).toEqual({
      type: "bloodwood",
    });
    expect(expectResolved(resolve(1)).warnings[0]).toMatch(/metadata 1/);
  });

  it("falls back to the through block's meta 0 state for bad properties", () => {
    const cases: Record<string, string>[] = [
      { variation: "99" },
      {},
      { color: "red" },
    ];
    for (const properties of cases) {
      const resolved = expectResolved(
        resolveUcwBlock(
          "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0",
          properties,
          naturaFiles,
        ),
      );
      expect(resolved.through.properties).toEqual({ variation: "0" });
      expect(resolved.warnings).toHaveLength(1);
      expect(resolved.warnings[0]).toMatch(/metadata 0 state \[variation=0\]/);
    }
  });

  it("needs the rule file's mods for the version", () => {
    const resolution = resolveUcwBlock(
      "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0",
      { variation: "0" },
      fakeFiles([NATURA_RULES], { chisel: chiselMod("chisel:planks-oak") }),
    );
    expect(resolution).toMatchObject({
      kind: "needs-mods",
      namespaces: ["natura"],
      ref: { rule: NATURA_RULES.rules[0] },
    });
    expect(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0",
        {},
        fakeFiles([NATURA_RULES], {}),
      ),
    ).toMatchObject({ kind: "needs-mods", namespaces: ["chisel", "natura"] });
  });

  it("needs UCW itself when its rules aren't loaded", () => {
    expect(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_0",
        {},
        fakeFiles(null, { natura: NATURA }),
      ),
    ).toEqual({ kind: "needs-mods", namespaces: ["unlimitedchiselworks"] });
  });

  it("doesn't recognise unknown prefixes or other namespaces", () => {
    expect(
      resolveUcwBlock(
        "unlimitedchiselworks:chisel_planks_oak_natura_other_planks_0",
        {},
        naturaFiles,
      ),
    ).toEqual({ kind: "unrecognised" });
    expect(resolveUcwBlock("natura:nether_planks", {}, naturaFiles)).toEqual({
      kind: "unrecognised",
    });
  });
});

describe("UCW_PROVIDER", () => {
  it("is registered for its namespace", () => {
    expect(getGeneratedBlockProvider("unlimitedchiselworks")).toBe(
      UCW_PROVIDER,
    );
  });

  it("resolves to a synthesized block", () => {
    const files = fakeFiles([NATURA_RULES], {
      chisel: chiselMod("chisel:planks-oak"),
      natura: NATURA,
    });
    const resolution = UCW_PROVIDER.resolve(
      "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_1",
      { variation: "2" },
      files,
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      provider: "unlimitedchiselworks",
      block: {
        id: "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_1",
        displayName: "Nether Planks (Chisel chisel:planks-oak)",
        // Chisel's oak planks have 15 variations (`chisel.ts`).
        properties: { variation: VARIATIONS.slice(0, 15).sort() },
      },
      approximate: true,
      sourceNamespaces: ["chisel", "natura"],
    });
    expect(resolution).not.toHaveProperty("warnings");
  });

  it("reports missing mods with the through block as fallback", () => {
    const resolution = UCW_PROVIDER.resolve(
      "unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_1",
      { variation: "2" },
      fakeFiles([NATURA_RULES], { chisel: chiselMod("chisel:planks-oak") }),
    );
    expect(resolution).toEqual({
      kind: "needs-mods",
      provider: "unlimitedchiselworks",
      namespaces: ["natura"],
      sourceBlocks: ["natura:nether_planks", "chisel:planks-oak"],
      fallback: { id: "chisel:planks-oak", properties: { variation: "2" } },
    });
  });

  it("enumerates the blocks of rules whose mods are loaded", () => {
    const files = fakeFiles([NATURA_RULES, ALABASTER_RULES], {
      chisel: chiselMod("chisel:planks-oak"),
      natura: NATURA,
    });
    expect(UCW_PROVIDER.enumerate(files).map((block) => block.id)).toEqual(
      [0, 1, 2, 3].map(
        (meta) =>
          `unlimitedchiselworks:chisel_planks_oak_natura_nether_planks_${meta}`,
      ),
    );
  });
});
