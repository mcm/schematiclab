// Pure layout and command builders for `generate-ucw-fixture-functions.mts`
// (unit-tested in `src/lib/__tests__/ucw-fixture-functions.test.ts`).
//
// Layout relative to the execution position: one rule per layer (y = rule
// index), one row per `from` meta 0–15 (z). x = 0 holds the `from` block at
// that meta, x = 1..16 the UCW block for that rule and meta at data value
// (Chisel variation) 0–15. A structure block one block west of the origin is
// preset to SAVE exactly that area.
//
// Commands use the 1.12 syntax (`setblock <x> <y> <z> <block> [dataValue]
// [oldBlockHandling] [dataTag]`, `fill … <block>`): 1.12 world functions only
// check the command name when they load, so a `setblock` of a block that
// doesn't exist fails on its own line when the function runs.

import {
  ucwBlockId,
  ucwSourceBlock,
  type UcwBlockRule,
} from "../../src/lib/mods/generated/ucw/rules.ts";

/** Structure name; the structure block saves `<world>/structures/<name>.nbt`. */
export const UCW_FIXTURE_NAME = "ucw_1_12_2";

/** Function namespace and name: `/function schematiclab:ucw_fixture`. */
export const UCW_FIXTURE_FUNCTION = "schematiclab:ucw_fixture";

/** `from` metadata rows per rule (Java iterates 0..15). */
export const FROM_METAS = 16;

/** UCW data values per `from` meta (Chisel's `variation` 0..15). */
export const VARIATIONS = 16;

/** The structure block's size limit per axis in 1.12. */
export const STRUCTURE_MAX_SIZE = 32;

type Vec3 = readonly [number, number, number];

export interface FixtureArea {
  /** First corner, relative to the execution position (always the origin). */
  min: Vec3;
  /** Opposite corner (inclusive). */
  max: Vec3;
  /** Size in blocks: 17 × rules × 16. */
  size: Vec3;
}

/** The area holding `ruleCount` rule layers. */
export function fixtureArea(ruleCount: number): FixtureArea {
  if (!Number.isInteger(ruleCount) || ruleCount < 1) {
    throw new Error(`Expected at least one rule, got ${ruleCount}`);
  }
  const size: Vec3 = [1 + VARIATIONS, ruleCount, FROM_METAS];
  if (size.some((n) => n > STRUCTURE_MAX_SIZE)) {
    throw new Error(
      `Fixture area ${size.join("×")} exceeds the ${STRUCTURE_MAX_SIZE}³ structure block limit`,
    );
  }
  return { min: [0, 0, 0], max: [size[0] - 1, size[1] - 1, size[2] - 1], size };
}

/** A relative coordinate (`~`, `~3`, `~-1`). */
export function rel(offset: number): string {
  return offset === 0 ? "~" : `~${offset}`;
}

function at([x, y, z]: Vec3): string {
  return `${rel(x)} ${rel(y)} ${rel(z)}`;
}

/** `fill` clearing the whole area. */
export function clearCommand(area: FixtureArea): string {
  return `fill ${at(area.min)} ${at(area.max)} minecraft:air`;
}

/** The `setblock`s of one rule's layer (`from` column first in each row). */
export function ruleCommands(rule: UcwBlockRule, layer: number): string[] {
  const from = ucwSourceBlock(rule.from);
  const commands: string[] = [];
  for (let meta = 0; meta < FROM_METAS; meta++) {
    commands.push(`setblock ${at([0, layer, meta])} ${from} ${meta}`);
    const id = ucwBlockId(rule, meta);
    for (let variation = 0; variation < VARIATIONS; variation++) {
      commands.push(
        `setblock ${at([1 + variation, layer, meta])} ${id} ${variation}`,
      );
    }
  }
  return commands;
}

/** Where the structure block goes: just west of the area's origin. */
export const STRUCTURE_BLOCK_POS: Vec3 = [-1, 0, 0];

/** The structure block's NBT, its `pos*` offsets pointing at the area. */
export function structureBlockNbt(area: FixtureArea): string {
  const [px, py, pz] = area.min.map((n, i) => n - STRUCTURE_BLOCK_POS[i]);
  const [sx, sy, sz] = area.size;
  return `{mode:"SAVE",name:"${UCW_FIXTURE_NAME}",posX:${px},posY:${py},posZ:${pz},sizeX:${sx},sizeY:${sy},sizeZ:${sz},ignoreEntities:1b}`;
}

/** `setblock` of the structure block (data value 0 is SAVE mode). */
export function structureBlockCommand(area: FixtureArea): string {
  return `setblock ${at(STRUCTURE_BLOCK_POS)} minecraft:structure_block 0 replace ${structureBlockNbt(area)}`;
}

/** The whole function: clear, place every rule's layer, structure block. */
export function fixtureFunction(
  rules: readonly UcwBlockRule[],
  header: readonly string[] = [],
): string {
  const area = fixtureArea(rules.length);
  const lines = [...header.map((line) => `# ${line}`.trimEnd())];
  lines.push(clearCommand(area));
  rules.forEach((rule, layer) => {
    lines.push(
      `# y=${layer}: ${ucwSourceBlock(rule.through)} through ${ucwSourceBlock(rule.from)}`,
      ...ruleCommands(rule, layer),
    );
  });
  lines.push(
    structureBlockCommand(area),
    `tellraw @s {"text":"${UCW_FIXTURE_FUNCTION} placed; open the structure block west of where you ran it and press SAVE.","color":"green"}`,
    "",
  );
  return lines.join("\n");
}
