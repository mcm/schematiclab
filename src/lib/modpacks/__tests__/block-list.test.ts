import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listModpacksTool } from "../../mcp/list-modpacks";
import { runTool } from "../../mcp/tools";
import { createFakeBlob } from "../../mcp/__tests__/fake-blob";
import { parseModJar } from "../../mods/parse-mod-jar";
import { vanillaDescriptorSources } from "../appearance";
import {
  BLOCK_LIST_MOD_KEY,
  parseBlockListText,
  readBlockList,
  vanillaMismatchWarning,
  type BlockList,
} from "../block-list";
import {
  extractModpack,
  type ModpackModSource,
  type ModpackSource,
} from "../extract";
import { modpackDataPath, modpackIndexPath } from "../paths";
import { countModStatuses } from "../publish";
import { encodeRgbaPng } from "../png";
import { clearModpackCache, encodeModpackData } from "../reader";
import { MODPACK_FORMAT_VERSION, modpackDataSchema } from "../schema";

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

function solidPng(): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([40, 40, 200, 255], i);
  return encodeRgbaPng(16, 16, data);
}

/** A self-contained cube block. */
function cube(id: string): Record<string, Uint8Array> {
  const [ns, p] = id.split(":");
  return {
    [`assets/${ns}/blockstates/${p}.json`]: json({
      variants: { "": { model: `${ns}:block/${p}` } },
    }),
    [`assets/${ns}/models/block/${p}.json`]: json({
      parent: "minecraft:block/cube_all",
      textures: { all: `${ns}:block/${p}` },
    }),
    [`assets/${ns}/textures/block/${p}.png`]: solidPng(),
  };
}

function mod(
  name: string,
  fileId: number,
  bytes: Uint8Array | null,
): ModpackModSource {
  return {
    name,
    fileName: `${name.toLowerCase().replace(/\s+/g, "-")}.jar`,
    curseForgeProjectId: fileId,
    curseForgeFileId: fileId,
    size: bytes?.length ?? null,
    read: bytes === null ? null : async () => bytes,
  };
}

function pack(mods: ModpackModSource[], hasKubeJs = false): ModpackSource {
  return {
    name: "Listed",
    displayVersion: "1.0",
    minecraftVersion: "1.21.1",
    loader: "neoforge",
    curseForgeProjectId: null,
    packFileId: null,
    hasKubeJs,
    warnings: [],
    mods,
  };
}

/** Two cube blocks, a lang name for a block without assets, and a fluid. */
function industry(): Uint8Array {
  return zipSync({
    ...cube("industry:machine"),
    ...cube("industry:old_machine"),
    "assets/industry/lang/en_us.json": json({
      "block.industry.machine": "Machine",
      "block.industry.sludge": "Sludge",
      "item.industry.wrench": "Wrench",
    }),
  });
}

/** Mod "Config": `gated:visible`, and a lang name for `runtime:`. */
function gated(): Uint8Array {
  return zipSync({
    ...cube("gated:visible"),
    // A name for a block of another namespace, as compat mods ship them.
    "assets/gated/lang/en_us.json": json({
      "block.runtime.magical_soil": "Magical Soil",
    }),
  });
}

function list(ids: string[], sha256 = "0".repeat(64)): BlockList {
  return { ids, sha256 };
}

describe("parseBlockListText", () => {
  it("reads one trimmed id per line, skipping blanks and # comments", () => {
    expect(
      parseBlockListText(
        "﻿# dumped from the server\n  minecraft:stone  \n\n\tcreate:brass_block\r\n# minecraft:dirt\n   \nminecraft:stone\n",
      ),
    ).toEqual(["minecraft:stone", "create:brass_block"]);
  });

  it("fails on a line that isn't a block id, naming its line number", () => {
    expect(() =>
      parseBlockListText("minecraft:stone\n# ok\nnot a block\n"),
    ).toThrow(/line 3 .*"not a block"/);
    expect(() => parseBlockListText("minecraft:stone\nStone:Bad")).toThrow(
      /line 2/,
    );
    expect(() => parseBlockListText("stone")).toThrow(/line 1/);
  });

  it("hashes the file", async () => {
    const bytes = strToU8("minecraft:stone\nindustry:machine\n");
    const parsed = await readBlockList(bytes);
    expect(parsed.ids).toEqual(["minecraft:stone", "industry:machine"]);
    expect(parsed.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });
});

describe("vanillaMismatchWarning", () => {
  it("is null when the minecraft: ids are the vanilla registry", () => {
    expect(
      vanillaMismatchWarning(
        list(["minecraft:stone", "minecraft:air", "industry:machine"]),
        ["minecraft:air", "minecraft:stone"],
        "1.21.1",
      ),
    ).toBeNull();
  });

  it("names the counts both ways and up to ten examples", () => {
    const vanillaIds = Array.from({ length: 20 }, (_, i) => `minecraft:v${i}`);
    const warning = vanillaMismatchWarning(
      list(["minecraft:v0", "minecraft:new_a", "minecraft:new_b"]),
      vanillaIds,
      "1.21.1",
    );
    expect(warning).toMatch(/Minecraft 1\.21\.1/);
    expect(warning).toMatch(/2 listed ids aren't vanilla blocks/);
    expect(warning).toMatch(/19 vanilla blocks aren't listed/);
    expect(warning).toMatch(/another Minecraft version/);
    const examples = /\(e\.g\. ([^)]*)\)/.exec(warning ?? "")?.[1].split(", ");
    expect(examples).toHaveLength(10);
    expect(examples?.slice(0, 2)).toEqual([
      "minecraft:new_a",
      "minecraft:new_b",
    ]);
  });
});

describe("parseModJar lang block names", () => {
  it("returns the block names no block of the jar uses", () => {
    const parsed = parseModJar(industry());
    expect(parsed.langBlockNames).toEqual({
      "block.industry.sludge": "Sludge",
    });
  });
});

describe("extractModpack with a block list", () => {
  const mods = () => [
    mod("Industry", 1, industry()),
    mod("Config", 2, gated()),
    mod("Broken", 3, null),
  ];

  it("is unchanged without a block list", async () => {
    const { data, blockList } = await extractModpack(pack(mods(), true), {
      vanilla,
      now: NOW,
    });
    expect(blockList).toBeUndefined();
    expect(data.blockList).toBeUndefined();
    expect(data.blocks.map((b) => b.id)).toEqual([
      "gated:visible",
      "industry:machine",
      "industry:old_machine",
    ]);
    expect(data.mods.map((m) => m.key)).toEqual(["cf-1", "cf-2", "cf-3"]);
    expect(data.runtimeBlockSources[0].message).toMatch(/aren't in the pack/);
  });

  it("drops unlisted blocks and adds listed ones bare", async () => {
    const broken = mod("Broken", 3, null);
    const sources = [...mods().slice(0, 2), broken];
    const { data, blockList, warnings } = await extractModpack(
      pack(sources, true),
      {
        vanilla,
        now: NOW,
        blockList: list(
          [
            "minecraft:stone",
            "industry:machine",
            "industry:sludge",
            "gated:hidden",
            "runtime:magical_soil",
            "kubejs:custom_block",
          ],
          "ab".repeat(32),
        ),
        vanillaBlockIds: ["minecraft:stone"],
      },
    );
    expect(() => modpackDataSchema.parse(data)).not.toThrow();
    expect(warnings).toEqual([]);
    expect(data.blocks.map((b) => [b.id, b.mod, b.displayName])).toEqual([
      ["gated:hidden", "cf-2", "Hidden"],
      ["industry:machine", "cf-1", "Machine"],
      // Named by the lang entry no block of the jar used.
      ["industry:sludge", "cf-1", "Sludge"],
      ["kubejs:custom_block", BLOCK_LIST_MOD_KEY, "Custom Block"],
      // Another jar's lang names a namespace no mod ships.
      ["runtime:magical_soil", BLOCK_LIST_MOD_KEY, "Magical Soil"],
    ]);
    const machine = data.blocks.find((b) => b.id === "industry:machine");
    expect(machine?.appearance).toBeDefined();
    expect(machine?.swatch).toBeDefined();
    expect(data.blocks.find((b) => b.id === "industry:sludge")).toEqual({
      id: "industry:sludge",
      mod: "cf-1",
      displayName: "Sludge",
      properties: {},
      defaults: {},
      kind: "unknown",
      fullCube: false,
    });
    expect(data.mods.at(-1)).toEqual({
      key: BLOCK_LIST_MOD_KEY,
      name: "Server block list",
      curseForgeProjectId: null,
      curseForgeFileId: null,
      fileName: null,
      namespaces: ["kubejs", "runtime"],
      status: "ok",
      hasSwatches: false,
    });
    // The synthetic mod isn't counted as one of the pack's mods.
    expect(data.version.modCount).toBe(3);
    expect(data.blockList).toEqual({ blocks: 6, sha256: "ab".repeat(32) });
    expect(blockList).toEqual({
      listed: 6,
      dropped: [
        { namespace: "gated", count: 1 },
        { namespace: "industry", count: 1 },
      ],
      added: 4,
    });
    expect(data.runtimeBlockSources[0].message).toMatch(
      /server block list was applied.*unknown looks/,
    );
  });

  it("gives a bare block to an ok mod of its namespace before others", async () => {
    // A jar with only lang assets: no blocks, but the namespace.
    const langOnly = zipSync({
      "assets/industry/lang/en_us.json": json({ "item.industry.x": "X" }),
    });
    const { data } = await extractModpack(
      pack([mod("Industry Lang", 9, langOnly), mod("Industry", 1, industry())]),
      { vanilla, now: NOW, blockList: list(["industry:sludge"]) },
    );
    expect(data.mods.map((m) => [m.key, m.status, m.namespaces])).toEqual([
      ["cf-9", "no-blocks", ["industry"]],
      ["cf-1", "ok", ["industry"]],
    ]);
    expect(data.blocks).toEqual([
      expect.objectContaining({ id: "industry:sludge", mod: "cf-1" }),
    ]);
    expect(data.mods.some((m) => m.key === BLOCK_LIST_MOD_KEY)).toBe(false);
  });

  it("warns when the list's minecraft: ids aren't the version's vanilla blocks", async () => {
    const { data, warnings } = await extractModpack(pack(mods()), {
      vanilla,
      now: NOW,
      blockList: list(["minecraft:stone", "minecraft:copper_golem_statue"]),
      vanillaBlockIds: ["minecraft:stone", "minecraft:dirt"],
    });
    expect(warnings).toEqual([
      expect.stringMatching(
        /1 listed id isn't a vanilla block, 1 vanilla block isn't listed \(e\.g\. minecraft:copper_golem_statue, minecraft:dirt\)\. The list may come from another Minecraft version/,
      ),
    ]);
    // Vanilla data isn't part of the pack record.
    expect(data.blocks.some((b) => b.id.startsWith("minecraft:"))).toBe(false);
  });
});

describe("list_modpacks with a block list", () => {
  beforeEach(() => clearModpackCache());

  it("reports block_list and the runtime sources' note", async () => {
    const { data } = await extractModpack(
      pack([mod("Industry", 1, industry())], true),
      {
        vanilla,
        now: NOW,
        blockList: list(["industry:machine", "kubejs:custom_block"]),
      },
    );
    const plain = await extractModpack(
      { ...pack([mod("Industry", 1, industry())], true), name: "Plain" },
      { vanilla, now: NOW },
    );
    const blob = createFakeBlob(NOW);
    const put = (p: string, body: Uint8Array) =>
      blob.objects.set(p, { body, uploadedAt: NOW() });
    put(
      modpackIndexPath(),
      strToU8(
        JSON.stringify({
          formatVersion: MODPACK_FORMAT_VERSION,
          packs: [data, plain.data].map((d) => ({
            slug: d.slug,
            name: d.name,
            curseForgeProjectId: null,
            versions: [d.version],
          })),
        }),
      ),
    );
    for (const d of [data, plain.data]) {
      put(modpackDataPath(d.slug, d.version.key), encodeModpackData(d));
    }
    const result = await runTool(
      listModpacksTool,
      {},
      { fetch: vi.fn(), now: NOW, blob },
    );
    expect(result.isError).toBeFalsy();
    const packs = (
      result.structuredContent as { packs: Record<string, unknown>[] }
    ).packs;
    const listed = packs.find((p) => p.slug === "listed");
    expect(listed?.block_list).toBe(true);
    expect(listed?.unsupported_sources).toEqual([
      {
        kind: "kubejs",
        name: "kubejs",
        message: expect.stringMatching(
          /server block list was applied.*included, with unknown looks/,
        ),
      },
    ]);
    const unlisted = packs.find((p) => p.slug === "plain");
    expect(unlisted).not.toHaveProperty("block_list");
  });
});

describe("countModStatuses with a block list", () => {
  it("leaves the synthetic block-list mod out", async () => {
    const { data } = await extractModpack(
      pack([mod("Industry", 1, industry())]),
      {
        vanilla,
        now: NOW,
        blockList: list(["industry:machine", "kubejs:custom_block"]),
      },
    );
    expect(data.mods.map((m) => m.key)).toEqual(["cf-1", BLOCK_LIST_MOD_KEY]);
    expect(countModStatuses(data).ok).toBe(1);
  });
});
