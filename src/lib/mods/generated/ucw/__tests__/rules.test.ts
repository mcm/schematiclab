// UCW rule parsing, plus reading rules from a jar and keeping them across a
// reload. Rule JSON is hand-written here; no `ucwdefs` files are copied.

import "fake-indexeddb/auto";

import { strFromU8, strToU8, zipSync } from "fflate";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerModJar } from "../../../load-mod";
import {
  isModAssetEntry,
  MAX_ASSET_BYTES,
  NO_BLOCKS_WARNING,
  parseModJar,
} from "../../../parse-mod-jar";
import * as modRegistry from "../../../registry";
import * as store from "../../../store";
import type { LoadedModMeta } from "../../../types";
import { withProviderDataWarnings } from "../../jar-data";
import {
  asUcwProviderData,
  parseUcwBlockState,
  parseUcwRuleFile,
  UCW_RELOAD_WARNING,
  type UcwBlockRule,
} from "../rules";

const DEFS = "assets/unlimitedchiselworks/ucwdefs";

const NATURA_RULES = {
  modid: ["chisel", "natura"],
  blocks: [
    {
      from: { block: "natura:nether_planks", iterate: ["type"] },
      through: { block: "chisel:planks-oak", iterate: ["variation"] },
      based_upon: { state: "minecraft:planks#variant=oak" },
      mode: "plank",
    },
    {
      from: {
        state: [
          "natura:overworld_planks#type=maple",
          "natura:overworld_planks#type=silverbell",
        ],
      },
      through: { block: "chisel:planks-spruce" },
      based_upon: { state: "minecraft:planks#variant=spruce" },
      overlay: { state: "Natura:Overworld_Logs#axis=y,type=maple" },
      mode: "BLEND",
      group: "natura_planks",
      custom_color_class: "pl.asie.ucw.Example",
    },
  ],
};

function jar(files: Record<string, string | object>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = strToU8(
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  return zipSync(entries);
}

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

function rulesOf(file: ReturnType<typeof parseUcwRuleFile>): UcwBlockRule[] {
  expect(file).not.toBeNull();
  return file!.rules;
}

describe("parseUcwBlockState", () => {
  it("splits the id from #-separated prop=value pairs", () => {
    expect(parseUcwBlockState("minecraft:planks#variant=oak")).toEqual({
      block: "minecraft:planks",
      properties: { variant: "oak" },
    });
    expect(parseUcwBlockState("Natura:Logs#axis=y,type=maple")).toEqual({
      block: "natura:logs",
      properties: { axis: "y", type: "maple" },
    });
  });

  it("defaults the namespace and ignores pairs without a value", () => {
    expect(parseUcwBlockState("stone#variant,=x,a=b=c")).toEqual({
      block: "minecraft:stone",
      properties: { a: "b=c" },
    });
  });

  it("keeps a property named __proto__ as an own property", () => {
    const state = parseUcwBlockState("a:b#__proto__=x");
    expect(Object.keys(state.properties)).toEqual(["__proto__"]);
  });
});

describe("parseUcwRuleFile", () => {
  it("parses modids, state sources, overlays and modes", () => {
    const warnings: string[] = [];
    const file = parseUcwRuleFile("chisel/natura.json", NATURA_RULES, warnings);
    expect(warnings).toEqual([]);
    expect(file).toMatchObject({
      path: "chisel/natura.json",
      modids: ["chisel", "natura"],
      loadLate: false,
    });
    expect(rulesOf(file)).toEqual([
      {
        from: {
          kind: "block",
          block: "natura:nether_planks",
          iterate: ["type"],
        },
        through: {
          kind: "block",
          block: "chisel:planks-oak",
          iterate: ["variation"],
        },
        basedUpon: {
          kind: "state",
          states: [
            { block: "minecraft:planks", properties: { variant: "oak" } },
          ],
          list: false,
        },
        mode: "plank",
        hasColor: false,
      },
      {
        from: {
          kind: "state",
          states: [
            { block: "natura:overworld_planks", properties: { type: "maple" } },
            {
              block: "natura:overworld_planks",
              properties: { type: "silverbell" },
            },
          ],
          list: true,
        },
        through: { kind: "block", block: "chisel:planks-spruce", iterate: [] },
        basedUpon: {
          kind: "state",
          states: [
            { block: "minecraft:planks", properties: { variant: "spruce" } },
          ],
          list: false,
        },
        overlay: {
          kind: "state",
          states: [
            {
              block: "natura:overworld_logs",
              properties: { axis: "y", type: "maple" },
            },
          ],
          list: false,
        },
        mode: "blend",
        group: "natura_planks",
        customColorClass: "pl.asie.ucw.Example",
        hasColor: true,
      },
    ]);
  });

  it("defaults mode to none and accepts a single modid string", () => {
    const file = parseUcwRuleFile(
      "a.json",
      {
        modid: "chisel",
        loadLate: true,
        blocks: [
          {
            from: { block: "x:y" },
            through: { block: "chisel:z" },
            based_upon: { block: "minecraft:stone" },
            has_color: true,
          },
        ],
      },
      [],
    );
    expect(file?.modids).toEqual(["chisel"]);
    expect(file?.loadLate).toBe(true);
    expect(rulesOf(file)[0]).toMatchObject({ mode: "none", hasColor: true });
  });

  it("skips malformed rules with a warning and keeps the valid ones", () => {
    const valid = NATURA_RULES.blocks[0];
    const warnings: string[] = [];
    const file = parseUcwRuleFile(
      "bad.json",
      {
        modid: ["chisel"],
        blocks: [
          "not a rule",
          { ...valid, from: undefined },
          { ...valid, through: { iterate: ["variation"] } },
          { ...valid, based_upon: { state: [] } },
          { ...valid, overlay: { block: 7 } },
          { ...valid, mode: "multiply" },
          { ...valid, group: 3 },
          valid,
        ],
      },
      warnings,
      "assets/unlimitedchiselworks/ucwdefs/bad.json",
    );
    expect(rulesOf(file)).toHaveLength(1);
    expect(rulesOf(file)[0].from).toMatchObject({
      block: "natura:nether_planks",
    });
    expect(warnings).toEqual([
      "Skipped rule 0 of assets/unlimitedchiselworks/ucwdefs/bad.json: expected an object",
      'Skipped rule 1 of assets/unlimitedchiselworks/ucwdefs/bad.json: missing "from"',
      'Skipped rule 2 of assets/unlimitedchiselworks/ucwdefs/bad.json: through: expected "block" or "state"',
      "Skipped rule 3 of assets/unlimitedchiselworks/ucwdefs/bad.json: based_upon.state: expected a string or a non-empty list of strings",
      "Skipped rule 4 of assets/unlimitedchiselworks/ucwdefs/bad.json: overlay.block: expected a string",
      'Skipped rule 5 of assets/unlimitedchiselworks/ucwdefs/bad.json: mode: unknown blend mode "multiply"',
      "Skipped rule 6 of assets/unlimitedchiselworks/ucwdefs/bad.json: group: expected a string",
    ]);
  });

  it("skips a malformed file with a warning", () => {
    const warnings: string[] = [];
    expect(parseUcwRuleFile("a.json", [], warnings)).toBeNull();
    expect(parseUcwRuleFile("b.json", { modid: 3 }, warnings)).toBeNull();
    expect(parseUcwRuleFile("c.json", { blocks: {} }, warnings)).toBeNull();
    expect(warnings).toEqual([
      "Skipped a.json: expected a JSON object",
      'Skipped b.json: "modid" must be a string or a list of strings',
      'Skipped c.json: "blocks" must be a list',
    ]);
  });
});

describe("parseModJar with UCW rules", () => {
  it("inflates ucwdefs entries, including nested directories", () => {
    expect(isModAssetEntry(`${DEFS}/natura.json`)).toBe(true);
    expect(isModAssetEntry(`${DEFS}/chisel/natura.json`)).toBe(true);
    expect(isModAssetEntry(`${DEFS}/chisel/readme.txt`)).toBe(false);
    expect(isModAssetEntry("assets/othermod/ucwdefs/natura.json")).toBe(false);
  });

  it("stores the rules as provider data and suppresses NO_BLOCKS_WARNING", () => {
    const result = parseModJar(
      jar({
        [`${DEFS}/chisel/natura.json`]: NATURA_RULES,
        [`${DEFS}/broken.json`]: "{ not json",
        [`${DEFS}/empty.json`]: { modid: ["chisel"], blocks: ["bad"] },
        "pack.mcmeta": { pack: {} },
      }),
    );
    expect(result.blocks).toEqual([]);
    expect(result.namespaces).toEqual(["unlimitedchiselworks"]);
    expect(result.warnings).not.toContain(NO_BLOCKS_WARNING);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(
      /^Skipped malformed JSON assets\/unlimitedchiselworks\/ucwdefs\/broken\.json/,
    );
    expect(result.warnings[1]).toBe(
      "Skipped rule 0 of assets/unlimitedchiselworks/ucwdefs/empty.json: expected an object",
    );

    const data = asUcwProviderData(result.providerData?.unlimitedchiselworks);
    expect(data?.files.map((file) => [file.path, file.rules.length])).toEqual([
      ["chisel/natura.json", 2],
      ["empty.json", 0],
    ]);
  });

  it("keeps NO_BLOCKS_WARNING when no rule is valid", () => {
    const result = parseModJar(
      jar({ [`${DEFS}/empty.json`]: { modid: [], blocks: [] } }),
    );
    expect(result.warnings).toContain(NO_BLOCKS_WARNING);
    expect(result.providerData).toHaveProperty("unlimitedchiselworks");
  });

  it("leaves jars without rules without provider data", () => {
    const result = parseModJar(
      jar({
        "assets/testmod/blockstates/a.json": { variants: { "": {} } },
      }),
    );
    expect(result).not.toHaveProperty("providerData");
  });

  it("counts rule entries toward the asset size budget", () => {
    const name = `${DEFS}/natura.json`;
    const bomb = withDeclaredSize(
      jar({ [name]: NATURA_RULES }),
      name,
      MAX_ASSET_BYTES + 1,
    );
    expect(() => parseModJar(bomb)).toThrow(/too large to read/);
  });
});

const UCW_INFO = {
  modId: 278493,
  modName: "Unlimited Chisel Works",
  modSlug: "unlimited-chisel-works",
  logoUrl: null,
  fileId: 1,
  fileDisplayName: "UnlimitedChiselWorks-0.3.5.jar",
  gameVersion: "1.12.2",
  gameVersions: ["1.12.2"],
  loader: "forge" as const,
};

describe("loading and storing UCW rules", () => {
  beforeEach(async () => {
    await store.__resetModStoreForTests();
    modRegistry.__resetLoadedModsForTests();
    globalThis.indexedDB = new IDBFactory();
  });

  it("registers a block-less jar with rules and keeps them across a reload", async () => {
    const parsed = parseModJar(
      jar({ [`${DEFS}/chisel/natura.json`]: NATURA_RULES }),
    );
    const meta = await registerModJar(new Uint8Array(), UCW_INFO, {
      parse: vi.fn(async () => parsed),
      add: modRegistry.addLoadedMod,
      now: () => 5,
    });
    expect(meta.providerDataRead).toEqual(["unlimitedchiselworks"]);
    expect(meta.warnings).toEqual([]);

    await store.__resetModStoreForTests();
    modRegistry.__resetLoadedModsForTests();
    await modRegistry.hydrateLoadedMods();

    const [restored] = modRegistry.getSnapshot();
    expect(restored.warnings).toEqual([]);
    const assets = await modRegistry.getLoadedModAssets(restored.key);
    expect(
      asUcwProviderData(assets?.providerData?.unlimitedchiselworks)?.files[0]
        .rules,
    ).toHaveLength(2);
  });

  it("still rejects a jar with neither blocks nor rules", async () => {
    const parsed = parseModJar(
      jar({ [`${DEFS}/empty.json`]: { modid: [], blocks: [] } }),
    );
    await expect(
      registerModJar(new Uint8Array(), UCW_INFO, {
        parse: vi.fn(async () => parsed),
        add: modRegistry.addLoadedMod,
        now: () => 5,
      }),
    ).rejects.toMatchObject({ code: "no_blocks" });
  });

  it("warns on a stored UCW file loaded before rules were read", async () => {
    const old: LoadedModMeta = {
      ...UCW_INFO,
      key: "278493:1.12.2",
      namespaces: [],
      blocks: [],
      warnings: ["No blocks found in this mod"],
      loadedAt: 1,
    };
    await store.putLoadedMod(old, {
      blockstates: {},
      models: {},
      textures: {},
      textureMeta: {},
    });
    await store.__resetModStoreForTests();
    await modRegistry.hydrateLoadedMods();

    expect(modRegistry.getSnapshot()[0].warnings).toEqual([
      UCW_RELOAD_WARNING,
      "No blocks found in this mod",
    ]);
    expect(UCW_RELOAD_WARNING).toBe(
      "Reload Unlimited Chisel Works to read its block rules",
    );
  });

  it("recognises an old UCW file by namespace and warns only once", () => {
    const old: LoadedModMeta = {
      ...UCW_INFO,
      modSlug: "ucw-fork",
      key: "1:1.12.2",
      namespaces: ["unlimitedchiselworks"],
      blocks: [],
      loadedAt: 1,
    };
    const warned = withProviderDataWarnings(old);
    expect(warned.warnings).toEqual([UCW_RELOAD_WARNING]);
    expect(withProviderDataWarnings(warned)).toBe(warned);
    const other = { ...old, namespaces: ["create"], modSlug: "create" };
    expect(withProviderDataWarnings(other)).toBe(other);
    const current = { ...old, providerDataRead: ["unlimitedchiselworks"] };
    expect(withProviderDataWarnings(current)).toBe(current);
  });
});
