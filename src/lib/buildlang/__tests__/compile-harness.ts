// Shared by the compiler tests: the 1.21.4 fixture registry (through a stubbed
// fetch) and helpers that compile a validated program and read its blocks.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, expect, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import {
  type BlockRegistry,
  loadBlockRegistry,
} from "../../blockdata/registry";
import { compileProgram, type CompileResult } from "../compiler";
import {
  formatProgramError,
  type MaterialSpec,
  type Operations,
  validateProgram,
} from "../program";

const FIXTURES = path.join(__dirname, "../../blockdata/__tests__/fixtures");
const BLOCKS_URL =
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json";
const fetch = vi.fn(async (input: RequestInfo | URL) =>
  String(input) === BLOCKS_URL
    ? new Response(
        readFileSync(
          path.join(FIXTURES, "registry-mcmeta-1.21.4-blocks.json"),
          "utf8",
        ),
        { status: 200 },
      )
    : new Response("not found", { status: 404 }),
);

/** The 1.21.4 fixture registry, loaded in `beforeAll`. */
export let registry: BlockRegistry;

beforeAll(async () => {
  clearBlockDataCache();
  registry = await loadBlockRegistry("1.21.4", { fetch });
});

export interface Built extends CompileResult {
  /** Block id without `minecraft:` at a world cell, `"air"` when empty. */
  at(x: number, y: number, z: number): string;
  /** World states of the block at a cell (`{}` when empty). */
  states(x: number, y: number, z: number): Record<string, string>;
  /** Every non-air cell as `[x, y, z, id]`. */
  cells: [number, number, number, string][];
}

export function compile(
  build: unknown,
  size: [number, number, number],
  palette: Record<string, MaterialSpec> = {},
  options: { maxPlacements?: number } = {},
): Built {
  const validation = validateProgram({ size, palette, build });
  if (!validation.ok) {
    throw new Error(validation.errors.map(formatProgramError).join("\n"));
  }
  const result = compileProgram(validation.program, registry, options);
  const blocks = new Map<
    string,
    { id: string; states: Record<string, string> }
  >();
  const cells: Built["cells"] = [];
  for (const [[x, y, z], block] of result.log.compose()) {
    const id = block.id.replace(/^minecraft:/, "");
    blocks.set(`${x},${y},${z}`, { id, states: block.states });
    cells.push([x, y, z, id]);
  }
  return {
    ...result,
    at: (x, y, z) => blocks.get(`${x},${y},${z}`)?.id ?? "air",
    states: (x, y, z) => blocks.get(`${x},${y},${z}`)?.states ?? {},
    cells,
  };
}

/** Like `compile`, but fails on any compile error. */
export function run(
  build: Operations,
  size: [number, number, number],
  palette: Record<string, MaterialSpec> = {},
): Built {
  const built = compile(build, size, palette);
  expect(built.errors.map(formatProgramError)).toEqual([]);
  return built;
}

export const messages = (errors: CompileResult["warnings"]) =>
  errors.map(formatProgramError);
