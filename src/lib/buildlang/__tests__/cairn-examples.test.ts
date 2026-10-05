// Golden tests against Cairn's own examples: `fixtures/cairn/{cottage,manor,
// tower}.json` are Cairn's `examples/` and the `.schem` files next to them
// are the builds Cairn wrote for them (`samples/`). Each compiles for 1.21.4
// to the same blocks and states, cell for cell. Mixes pick their blocks with
// a different hash than Cairn's, so blocks from the same `mix` count as
// equal. Compiled against the whole 1.21.4 block list (the other compiler
// tests use a subset without, for example, dark oak).

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import {
  type BlockRegistry,
  loadBlockRegistry,
} from "../../blockdata/registry";
import { type ParsedSchematicProjection, parseSchematic } from "../../convert";
import { compileForRegistry } from "../build";
import { formatProgramError } from "../program";

const CAIRN = path.join(__dirname, "fixtures/cairn");
const REGISTRY = path.join(
  __dirname,
  "../../blockdata/__tests__/fixtures/registry-mcmeta-1.21.4-full-blocks.json",
);
const BLOCKS_URL =
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json";
const fetch = vi.fn(async (input: RequestInfo | URL) =>
  String(input) === BLOCKS_URL
    ? new Response(readFileSync(REGISTRY, "utf8"), { status: 200 })
    : new Response("not found", { status: 404 }),
);

let registry: BlockRegistry;

beforeAll(async () => {
  clearBlockDataCache();
  registry = await loadBlockRegistry("1.21.4", { fetch });
});

/**
 * Each block named in a `mix` anywhere in the program → the first block of
 * its mix. (Cairn's examples only mix plain block ids.)
 */
function mixClasses(program: unknown): Map<string, string> {
  const classes = new Map<string, string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === "object" && node !== null) {
      const { mix } = node as { mix?: unknown };
      if (typeof mix === "object" && mix !== null) {
        const [first, ...rest] = Object.keys(mix);
        for (const name of [first, ...rest]) classes.set(name, first);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(program);
  return classes;
}

/** `"x,y,z" → "id[state=value,…]"` with every state, mixes merged. */
function describeProjection(
  projection: ParsedSchematicProjection,
  classes: Map<string, string>,
): Map<string, string> {
  const cells = new Map<string, string>();
  for (const region of projection.regions) {
    for (const { pos, paletteIndex } of region.blocks) {
      const { blockId, properties } = projection.palette[paletteIndex];
      const id = blockId.replace(/^minecraft:/, "");
      const states = Object.entries({
        ...registry.defaults(blockId),
        ...properties,
      })
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`);
      const key = pos.map((v, a) => v + region.origin[a]).join(",");
      cells.set(key, `${classes.get(id) ?? id}[${states.join(",")}]`);
    }
  }
  return cells;
}

const example = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(CAIRN, `${name}.json`), "utf8"));

/** Every block an example compiles to, in world coordinates. */
function compiledBlocks(name: string) {
  const built = compileForRegistry(example(name), "1.21.4", registry);
  const { palette, regions } = built.projection!;
  return regions.flatMap((region) =>
    region.blocks.map(({ pos, paletteIndex }) => ({
      pos: pos.map((v, a) => v + region.origin[a]),
      id: palette[paletteIndex].blockId.replace(/^minecraft:/, ""),
      properties: palette[paletteIndex].properties as Record<string, string>,
    })),
  );
}

describe("Cairn's examples", () => {
  it.each(["cottage", "manor", "tower"])(
    "%s compiles clean to the blocks and states of Cairn's build",
    (name) => {
      const program: unknown = JSON.parse(
        readFileSync(path.join(CAIRN, `${name}.json`), "utf8"),
      );
      const built = compileForRegistry(program, "1.21.4", registry);
      expect(built.errors.map(formatProgramError)).toEqual([]);
      expect(built.warnings.map(formatProgramError)).toEqual([]);

      const analysis = built.analysis!;
      expect(analysis.outOfBounds).toBe(0);
      expect(analysis.components).toBe(1);
      expect(analysis.floating).toEqual([]);
      expect(analysis.blockedDoors).toEqual([]);
      expect(analysis.enclosedSpaces.length).toBeGreaterThan(0);
      expect(analysis.roofLeaks).toEqual([]);
      expect(built.report).not.toMatch(/FLOATING|BLOCKED DOOR|NOT SEALED/);

      const sample = parseSchematic(
        readFileSync(path.join(CAIRN, `${name}.schem`)),
      );
      if (!sample.ok) throw new Error(sample.error);
      const classes = mixClasses(program);
      const ours = describeProjection(built.projection!, classes);
      const cairn = describeProjection(sample.schematic, classes);
      expect(ours.size).toBe(cairn.size);
      const differences = [...new Set([...ours.keys(), ...cairn.keys()])]
        .filter((pos) => ours.get(pos) !== cairn.get(pos))
        .map((pos) => `${pos}: ${ours.get(pos)} vs Cairn ${cairn.get(pos)}`);
      expect(differences).toEqual([]);
    },
  );

  it.each([
    ["cottage", [535, 289]],
    ["manor", [1307, 516, 196]],
    ["tower", [1289, 605, 605, 605, 168]],
  ])("%s has the interior spaces of Cairn's report", (name, spaces) => {
    // `samples/*.report.md`; the tower's are its 4 storeys (the top one with
    // the attic) and the annex (test_tower_roofs_are_sealed).
    const built = compileForRegistry(example(name), "1.21.4", registry);
    expect(built.analysis!.enclosedSpaces).toEqual(spaces);
  });

  it("gives the manor's merged roof no cliffs and proper corners (test_merged_roof_has_no_cliffs_and_proper_corners)", () => {
    const blocks = compiledBlocks("manor");
    const top = new Map<string, number>();
    for (const { pos, id } of blocks) {
      if (pos[1] < 10 || !id.startsWith("deepslate_tile")) continue;
      const key = `${pos[0]},${pos[2]}`;
      top.set(key, Math.max(top.get(key) ?? -1, pos[1]));
    }
    expect(top.size).toBeGreaterThan(0);
    const cliffs = [...top].flatMap(([key, y]) => {
      const [x, z] = key.split(",").map(Number);
      return [
        [x + 1, z],
        [x, z + 1],
      ]
        .map(([nx, nz]) => top.get(`${nx},${nz}`))
        .filter((ny) => ny !== undefined && Math.abs(ny - y) > 1)
        .map(() => key);
    });
    expect(cliffs).toEqual([]);
    const shapes = new Set(
      blocks
        .filter(({ id }) => id.endsWith("_stairs"))
        .map(({ properties }) => properties.shape),
    );
    expect(shapes.has("inner_left") || shapes.has("outer_left")).toBe(true);
    expect([...shapes].some((shape) => shape?.startsWith("inner"))).toBe(true);
  });

  it("keeps the tower's annex roof below its cone (test_roofs_at_different_heights_stay_independent)", () => {
    const annex = compiledBlocks("tower").filter(
      ({ pos, id }) =>
        pos[0] >= 17 && id.startsWith("spruce") && id !== "spruce_fence",
    );
    expect(annex.length).toBeGreaterThan(0);
    expect(Math.max(...annex.map(({ pos }) => pos[1]))).toBeLessThanOrEqual(10);
  });

  it("warns when the cottage's bed is moved into the chimney", () => {
    const program = example("cottage");
    const beds: { at: number[] }[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (typeof node === "object" && node !== null) {
        const { block } = node as { block?: { material?: unknown } };
        if (block?.material === "red_bed") beds.push(block as { at: number[] });
        Object.values(node).forEach(walk);
      }
    };
    walk(program);
    expect(beds.map(({ at }) => at)).toEqual([[-1, 0, 4]]);
    beds[0].at = [-1, 0, 0];

    const built = compileForRegistry(program, "1.21.4", registry);
    expect(
      built.warnings
        .map(formatProgramError)
        .some((w) => w.includes("red_bed") && w.includes("bricks")),
    ).toBe(true);
  });

  it("treats only blocks from the same mix as equal", () => {
    const program: unknown = JSON.parse(
      readFileSync(path.join(CAIRN, "cottage.json"), "utf8"),
    );
    const classes = mixClasses(program);
    expect(classes.get("mossy_cobblestone")).toBe("cobblestone");
    expect(classes.get("cracked_stone_bricks")).toBe("stone_bricks");
    expect(classes.has("calcite")).toBe(false);
    // Mixes do vary: some cells hold another block of the mix than Cairn's.
    const built = compileForRegistry(program, "1.21.4", registry);
    const sample = parseSchematic(
      readFileSync(path.join(CAIRN, "cottage.schem")),
    );
    if (!sample.ok) throw new Error(sample.error);
    const ours = describeProjection(built.projection!, new Map());
    const cairn = describeProjection(sample.schematic, new Map());
    const differing = [...ours.keys()].filter(
      (pos) => ours.get(pos) !== cairn.get(pos),
    );
    expect(differing.length).toBeGreaterThan(0);
  });
});
