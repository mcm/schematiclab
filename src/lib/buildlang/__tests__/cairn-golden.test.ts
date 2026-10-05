// Golden tests: Cairn's example programs (`fixtures/cairn/*.json`) compile for
// 1.21.4 to the same blocks as Cairn's own outputs (`fixtures/cairn/*.schem`),
// with blocks of one `mix` treated as equal (the hash that picks them
// differs). Also ports the example-based cases of Cairn's
// `tests/test_spec.py`. The fixtures are Cairn's files, unchanged.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSchematic } from "../../convert";
import { analyze } from "../analyze";
import { compileWithRegistry } from "../compiler";
import { formatProgramError, validateProgram } from "../program";
import { registry } from "./compile-harness";

const FIXTURES = path.join(__dirname, "fixtures/cairn");
const EXAMPLES = ["cottage", "manor", "tower"] as const;

function program(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

function compileProgram(source: Record<string, unknown>) {
  const validation = validateProgram(source);
  if (!validation.ok) {
    throw new Error(validation.errors.map(formatProgramError).join("\n"));
  }
  return compileWithRegistry(validation.program, registry);
}

const compileExample = (name: string) => compileProgram(program(name));

/** Every block of a mix maps to the mix's first block. */
function mixGroups(source: Record<string, unknown>): Map<string, string> {
  const groups = new Map<string, string>();
  const palette = (source.palette ?? {}) as Record<string, unknown>;
  for (const spec of Object.values(palette)) {
    if (typeof spec !== "object" || spec === null || !("mix" in spec)) continue;
    const ids = Object.keys((spec as { mix: object }).mix);
    for (const id of ids) groups.set(`minecraft:${id}`, `minecraft:${ids[0]}`);
  }
  return groups;
}

const stateString = (states: Record<string, string>) =>
  Object.entries(states)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

describe.each(EXAMPLES)("Cairn's %s", (name) => {
  it("compiles to Cairn's blocks and states", () => {
    const source = program(name);
    const result = compileProgram(source);
    const groups = mixGroups(source);
    const block = (id: string, states: string) =>
      `${groups.get(id) ?? id}[${states}]`;

    const parsed = parseSchematic(
      new Uint8Array(readFileSync(path.join(FIXTURES, `${name}.schem`))),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const { palette, regions } = parsed.schematic;
    const expected = new Map<string, string>();
    for (const region of regions) {
      for (const { pos, paletteIndex } of region.blocks) {
        const entry = palette[paletteIndex];
        expected.set(
          pos.join(),
          block(entry.blockId, stateString(entry.properties)),
        );
      }
    }
    // the samples spell out every state; fill ours from the defaults
    const actual = new Map<string, string>();
    for (const [pos, b] of result.blocks.entries()) {
      const states = { ...(registry.defaults(b.id) ?? {}), ...b.states };
      actual.set(pos.join(), block(b.id, stateString(states)));
    }
    expect(actual.size).toBe(expected.size);
    const differences = [...expected]
      .filter(([pos, b]) => actual.get(pos) !== b)
      .map(([pos, b]) => `${pos}: expected ${b}, got ${actual.get(pos)}`);
    expect(differences).toEqual([]);
  });

  it("compiles clean: one piece, no blocked doors, sealed roofs and rooms (Cairn)", () => {
    const result = compileExample(name);
    expect(result.errors).toEqual([]);
    const analysis = analyze(result, registry);
    expect(analysis.components).toBe(1);
    expect(analysis.floatingCount).toBe(0);
    expect(analysis.blockedDoors).toEqual([]);
    expect(analysis.roofLeaks).toEqual([]);
    expect(analysis.enclosedSpaces.length).toBeGreaterThan(0);
  });
});

describe("Cairn's examples in detail", () => {
  it("finds the rooms Cairn's reports list", () => {
    const rooms = (name: string) =>
      analyze(compileExample(name), registry).enclosedSpaces;
    expect(rooms("cottage")).toEqual([535, 289]);
    expect(rooms("manor")).toEqual([1307, 516, 196]);
    // 4 storeys (the top one includes the attic) and the annex
    expect(rooms("tower")).toEqual([1289, 605, 605, 605, 168]);
  });

  it("merges the manor's roofs with no cliffs and proper corners (Cairn)", () => {
    const result = compileExample("manor");
    const top = new Map<string, number>();
    for (const [[x, y, z], b] of result.blocks.entries()) {
      if (y >= 10 && b.id.startsWith("minecraft:deepslate_tile")) {
        top.set(`${x},${z}`, Math.max(top.get(`${x},${z}`) ?? -1, y));
      }
    }
    const cliffs: string[] = [];
    for (const [k, y] of top) {
      const [x, z] = k.split(",").map(Number);
      for (const n of [`${x + 1},${z}`, `${x},${z + 1}`]) {
        const ny = top.get(n);
        if (ny !== undefined && Math.abs(ny - y) > 1) cliffs.push(`${k}→${n}`);
      }
    }
    expect(cliffs).toEqual([]);
    const shapes = new Set<string | undefined>();
    for (const [, b] of result.blocks.entries()) {
      if (b.id.endsWith("_stairs")) shapes.add(b.states.shape);
    }
    expect(shapes.has("inner_left") || shapes.has("outer_left")).toBe(true);
    expect([...shapes].some((s) => s?.startsWith("inner"))).toBe(true);
  });

  it("keeps the tower's annex roof below its cone (Cairn)", () => {
    const result = compileExample("tower");
    const annex = [...result.blocks.entries()].filter(
      ([[x], b]) =>
        x >= 17 &&
        b.id.startsWith("minecraft:spruce") &&
        b.id !== "minecraft:spruce_fence",
    );
    expect(annex.length).toBeGreaterThan(0);
    expect(Math.max(...annex.map(([[, y]]) => y))).toBeLessThanOrEqual(10);
  });

  it("reports the cottage's bed placed inside the chimney (Cairn)", () => {
    const text = JSON.stringify(program("cottage")).replace(
      '"at":[-1,0,4],"material":"red_bed"',
      '"at":[-1,0,0],"material":"red_bed"',
    );
    expect(text).toContain('"at":[-1,0,0],"material":"red_bed"');
    const result = compileProgram(JSON.parse(text));
    expect(
      result.warnings
        .map(formatProgramError)
        .some((w) => w.includes("red_bed") && w.includes("bricks")),
    ).toBe(true);
  });
});
