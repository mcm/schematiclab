// UCW fixture coverage (GENERATED_FIXTURES.md): every Unlimited Chisel Works
// placement in the fixtures saved in-game resolves to a rule, and to the
// `from` state the game saved beside it. Rules, blockstates and blocks are
// hand-written here; no mod jar or `ucwdefs` file is read or copied.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSchematic } from "../../../convert";
import type { LoadedModAssets, LoadedModMeta, ModBlock } from "../../types";
import type { GeneratedBlockFiles } from "../types";
import { UCW_PROVIDER } from "../ucw/provider";
import {
  resolveUcwBlock,
  ucwFromStates,
  type UcwResolved,
} from "../ucw/resolve";
import {
  parseUcwRuleFile,
  UCW_RULES_FORMAT_VERSION,
  ucwBlockId,
  ucwSourceBlock,
  type UcwRuleFile,
} from "../ucw/rules";

// The structure-block saves of `pnpm gen:ucw-fixture-functions`. There is no
// Litematica save: Litematica wasn't available for the 1.12.2 instance
// (SCHEM-82).
const FIXTURES = ["ucw_1_12_2.nbt"];

const UCW_NAMESPACE = "unlimitedchiselworks";

function ruleFile(entry: string, json: unknown): UcwRuleFile {
  const warnings: string[] = [];
  const file = parseUcwRuleFile(entry, json, warnings);
  expect(warnings).toEqual([]);
  return file!;
}

const iterate = (block: string, property: string) => ({
  block,
  iterate: [property],
});

// Hand-written equivalents of the two rule files the fixture function places
// (`chisel/natura.json` and `chisel/environmentalmaterials.json` in UCW
// 0.3.5), in their file order: one fixture layer per rule.
const RULE_FILES = [
  ruleFile("chisel/environmentalmaterials.json", {
    modid: ["chisel", "environmentalmaterials"],
    blocks: [
      "chisel:stonebrick",
      "chisel:stonebrick1",
      "chisel:stonebrick2",
    ].map((through) => ({
      from: iterate("environmentalmaterials:alabaster_bricks", "color"),
      through: iterate(through, "variation"),
      based_upon: { state: "minecraft:stonebrick#variant=stonebrick" },
    })),
  }),
  ruleFile("chisel/natura.json", {
    modid: ["chisel", "natura"],
    blocks: ["natura:nether_planks", "natura:overworld_planks"].map((from) => ({
      from: iterate(from, "type"),
      mode: "plank",
      through: iterate("chisel:planks-oak", "variation"),
      based_upon: { state: "minecraft:planks#variant=oak" },
    })),
  }),
];

// Natura 1.12 (`forge_marker` blockstates list `type` in its enum order).
const NETHER_PLANKS = ["ghostwood", "bloodwood", "darkwood", "fusewood"];
const OVERWORLD_PLANKS = [
  "maple",
  "silverbell",
  "amaranth",
  "tiger",
  "willow",
  "eucalyptus",
  "hopseed",
  "sakura",
  "redwood",
];

const forgeBlockstate = (property: string, values: readonly string[]) => ({
  forge_marker: 1,
  defaults: { model: "cube_all" },
  variants: {
    [property]: Object.fromEntries(values.map((value) => [value, {}])),
  },
});

// The dye colours, as a jar whose blockstate order isn't known would list
// them (sorted). Their metadata order comes from `meta-overrides.ts`.
const COLORS = [
  "black",
  "blue",
  "brown",
  "cyan",
  "gray",
  "green",
  "light_blue",
  "lime",
  "magenta",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow",
];

interface FakeMod {
  blocks?: ModBlock[];
  blockstates?: Record<string, unknown>;
  providerData?: LoadedModAssets["providerData"];
}

const block = (
  id: string,
  properties: Record<string, string[]> = {},
): ModBlock => ({ id, displayName: id, properties });

const MODS: Record<string, FakeMod> = {
  [UCW_NAMESPACE]: {
    providerData: {
      [UCW_NAMESPACE]: {
        formatVersion: UCW_RULES_FORMAT_VERSION,
        files: RULE_FILES,
      },
    },
  },
  // Chisel's 1.12 states come from `ucw/chisel.ts` once its file is loaded.
  chisel: {},
  natura: {
    blocks: [block("natura:nether_planks"), block("natura:overworld_planks")],
    blockstates: {
      "natura:nether_planks": forgeBlockstate("type", NETHER_PLANKS),
      "natura:overworld_planks": forgeBlockstate("type", OVERWORLD_PLANKS),
    },
  },
  environmentalmaterials: {
    blocks: [
      block("environmentalmaterials:alabaster_bricks", { color: COLORS }),
    ],
  },
};

/** The synthetic 1.12.2 loaded-file set: UCW, Chisel, Natura, EM. */
function loadedFiles(): GeneratedBlockFiles {
  const metas = new Map<string, LoadedModMeta>();
  const assets = new Map<string, LoadedModAssets>();
  Object.entries(MODS).forEach(([namespace, mod], index) => {
    const meta = {
      key: `${index + 1}:1.12.2`,
      modId: index + 1,
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
      ...(mod.providerData ? { providerData: mod.providerData } : {}),
    });
  });
  return {
    gameVersion: "1.12.2",
    files: [...metas.values()],
    fileForNamespace: (namespace) => metas.get(namespace) ?? null,
    blocks: (namespace) =>
      new Map(
        (metas.get(namespace)?.blocks ?? []).map((entry) => [entry.id, entry]),
      ),
    assets: (file) => assets.get(file.key) ?? null,
    providerData: (namespace) =>
      assets.get(metas.get(namespace)?.key ?? "")?.providerData?.[namespace],
  };
}

const fixtureBytes = (filename: string): Uint8Array =>
  new Uint8Array(
    readFileSync(
      path.resolve(__dirname, "../../../__tests__/fixtures", filename),
    ),
  );

interface Cell {
  id: string;
  properties: Readonly<Record<string, string>>;
}

function fixtureCells(filename: string) {
  const parsed = parseSchematic(fixtureBytes(filename));
  if (!parsed.ok) throw new Error(parsed.error);
  const { palette, regions, minecraftVersion } = parsed.schematic;
  const cells = new Map<string, Cell>();
  for (const region of regions) {
    for (const placement of region.blocks) {
      const entry = palette[placement.paletteIndex];
      cells.set(placement.pos.join(","), {
        id: entry.blockId,
        properties: entry.properties,
      });
    }
  }
  return { cells, minecraftVersion };
}

describe.each(FIXTURES)("UCW coverage of %s", (filename) => {
  const { cells, minecraftVersion } = fixtureCells(filename);
  const files = loadedFiles();
  const ucwCells = [...cells].filter(([, cell]) =>
    cell.id.startsWith(`${UCW_NAMESPACE}:`),
  );

  it("parses as Minecraft 1.12.2", () => {
    expect(minecraftVersion?.versionNumber).toEqual([1, 12, 2]);
    expect(ucwCells.length).toBeGreaterThan(0);
  });

  it("resolves every UCW placement to a rule and the saved from state", () => {
    const problems = new Set<string>();
    const resolvedRules = new Set<number>();
    const rules = RULE_FILES.flatMap((file) => file.rules);
    for (const [pos, cell] of ucwCells) {
      const label = `${cell.id}[${Object.entries(cell.properties)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")}] at ${pos}`;
      const provided = UCW_PROVIDER.resolve(cell.id, cell.properties, files);
      if (provided.kind !== "resolved") {
        problems.add(`${label}: ${provided.kind}`);
        continue;
      }
      const resolution = resolveUcwBlock(cell.id, cell.properties, files);
      if (resolution.kind !== "resolved") {
        problems.add(`${label}: ${resolution.kind}`);
        continue;
      }
      resolvedRules.add(rules.indexOf(resolution.rule));
      if (ucwBlockId(resolution.rule, resolution.fromMeta) !== cell.id) {
        problems.add(`${label}: resolved to another rule's id`);
      }
      if (resolution.warnings.length > 0) {
        problems.add(`${label}: ${resolution.warnings.join("; ")}`);
      }

      // Column x = 0 of the row holds the `from` block placed at this meta.
      const [, y, z] = pos.split(",");
      const reference = cells.get(`0,${y},${z}`);
      const saved =
        reference === undefined
          ? "nothing"
          : `${reference.id}${JSON.stringify(reference.properties)}`;
      const picked = `${resolution.from.block}${JSON.stringify(resolution.from.properties)}`;
      if (
        reference === undefined ||
        reference.id !== resolution.from.block ||
        !sameProperties(reference.properties, resolution.from.properties)
      ) {
        problems.add(
          `${cell.id} (meta ${resolution.fromMeta}): saved ${saved}, resolved ${picked}; add a meta-overrides.ts entry`,
        );
      }
    }
    expect([...problems]).toEqual([]);
    // Every rule's layer is in the fixture.
    expect([...resolvedRules].sort((a, b) => a - b)).toEqual(
      rules.map((_, i) => i),
    );
  });

  it("covers an ambiguous id prefix and an iterate rule", () => {
    const resolutions = ucwCells
      .map(([, cell]) => resolveUcwBlock(cell.id, cell.properties, files))
      .filter((r): r is UcwResolved => r.kind === "resolved");
    // More than one `from` state shares the id prefix; only the meta suffix
    // tells them apart.
    expect(
      resolutions.some((r) => ucwFromStates(r.rule.from, files).size > 1),
    ).toBe(true);
    expect(resolutions.some((r) => r.rule.from.kind === "block")).toBe(true);
    expect(
      new Set(resolutions.map((r) => ucwSourceBlock(r.rule.from))),
    ).toEqual(
      new Set([
        "natura:nether_planks",
        "natura:overworld_planks",
        "environmentalmaterials:alabaster_bricks",
      ]),
    );
  });
});

function sameProperties(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}
