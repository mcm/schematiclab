// Generates `src/lib/schemlib/data/forge-1.12-flatten.generated.ts`.
//
// For each 1.12 block in minecraft-data's pc/1.12/blocks.json, applies the
// per-block spec from forge-1.12-specs.ts to enumerate every valid (metadata
// 0..15 → Forge state). Emits a Map from canonical Forge state string
// ("minecraft:planks[variant=spruce]") to "id:metadata" ("5:1") that the
// runtime can chain into the existing FLATTEN_TABLE.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FORGE_1_12_SPECS, type BlockSpec } from "../src/lib/schemlib/data/forge-1.12-specs.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_PATH = join(REPO_ROOT, "src/lib/schemlib/data/forge-1.12-flatten.generated.ts");
const MINECRAFT_DATA =
  process.env.MINECRAFT_DATA_PATH ?? join(process.env.HOME ?? "", "projects/minecraft-data");

interface McdataBlock {
  id: number;
  name: string;
  variations?: { metadata: number; displayName?: string; description?: string }[];
}

function loadBlocks(): McdataBlock[] {
  const path = join(MINECRAFT_DATA, "data/pc/1.12/blocks.json");
  return JSON.parse(readFileSync(path, "utf-8")) as McdataBlock[];
}

// ── Per-kind metadata → properties decoders ───────────────────────────────
//
// Returns the property map for a given metadata, or null to skip (invalid
// metadata for this block — e.g. wooden_slab has metadata 0-5 and 8-13 but
// not 6, 7, 14, 15).

type Decoded = Record<string, string> | null;

function intToFacing4(m: number): string | null {
  // Standard 1.12 horizontal facing for blocks like furnace/chest: 2=N 3=S 4=W 5=E.
  return ["north", "south", "west", "east"][m - 2] ?? null;
}

function intToFacing4Horizontal(m: number): string | null {
  // South-first variant used by pumpkin / glazed terracotta: 0=S 1=W 2=N 3=E.
  return ["south", "west", "north", "east"][m] ?? null;
}

function intToFacing6(m: number): string | null {
  return ["down", "up", "north", "south", "west", "east"][m] ?? null;
}

function decode(_block: McdataBlock, spec: BlockSpec, meta: number): Decoded {
  switch (spec.kind) {
    case "stateless":
      return meta === 0 ? {} : null;

    case "variants":
      return meta < spec.values.length ? { [spec.prop]: spec.values[meta] } : null;

    case "variants_with_stage": {
      const variant = meta & 0x7;
      const stage = (meta >> 3) & 0x1;
      if (variant >= spec.values.length) return null;
      return { [spec.prop]: spec.values[variant], [spec.stageProp]: String(stage) };
    }

    case "leaves": {
      const variant = meta & 0x3;
      const decayable = (meta & 0x4) === 0; // bit 2 set means no decay
      const check_decay = (meta & 0x8) !== 0;
      if (variant >= spec.variants.length) return null;
      return {
        variant: spec.variants[variant],
        decayable: decayable ? "true" : "false",
        check_decay: check_decay ? "true" : "false",
      };
    }

    case "double_plant": {
      const variants = ["sunflower", "syringa", "double_grass", "double_fern", "double_rose", "paeonia"];
      const upper = (meta & 0x8) !== 0;
      if (upper) {
        // Upper half just records facing; variant lives on lower half.
        const facing = meta & 0x1;
        return { half: "upper", facing: facing === 0 ? "south" : "north" };
      }
      const variant = meta & 0x7;
      if (variant >= variants.length) return null;
      return { half: "lower", variant: variants[variant], facing: "south" };
    }

    case "connected":
      // Connection bits expanded by RUNTIME_PROPS post-pass.
      return meta === 0 ? {} : null;

    case "connected_variant":
      return meta < spec.values.length ? { [spec.prop]: spec.values[meta] } : null;

    case "quartz_block": {
      const map = ["default", "chiseled", "lines_y", "lines_x", "lines_z"];
      return meta < map.length ? { variant: map[meta] } : null;
    }

    case "slab": {
      const variant = meta & 0x7;
      const top = (meta & 0x8) !== 0;
      if (variant >= spec.values.length) return null;
      return { [spec.prop]: spec.values[variant], half: top ? "top" : "bottom" };
    }

    case "double_slab":
      return meta < spec.values.length ? { [spec.prop]: spec.values[meta] } : null;

    case "slab_seamless": {
      // Stone slabs add a `seamless=true` flag in the high bit only for
      // double-slabs; the single-slab form uses bit 3 for half=top.
      const variant = meta & 0x7;
      const top = (meta & 0x8) !== 0;
      if (variant >= spec.values.length) return null;
      return { [spec.prop]: spec.values[variant], half: top ? "top" : "bottom" };
    }

    case "double_slab_seamless": {
      const variant = meta & 0x7;
      const seamless = (meta & 0x8) !== 0;
      if (variant >= spec.values.length) return null;
      return { [spec.prop]: spec.values[variant], seamless: seamless ? "true" : "false" };
    }

    case "log": {
      const variant = meta & 0x3;
      const axisBits = (meta >> 2) & 0x3;
      const axis = ["y", "x", "z", "none"][axisBits];
      if (variant >= spec.variants.length) return null;
      return { variant: spec.variants[variant], axis };
    }

    case "stairs": {
      if (meta > 7) return null;
      const facing = ["east", "west", "south", "north"][meta & 0x3];
      const half = (meta & 0x4) !== 0 ? "top" : "bottom";
      return { facing, half }; // shape expanded by RUNTIME_PROPS
    }

    case "door": {
      // Lower-half states (meta 0-7): facing × open. Upper-half states (8-9):
      // hinge. The runtime resolves cross-block state; we emit *both* halves
      // here so a lookup of either half returns *some* id:meta. Forge BG
      // serializes both halves separately.
      if (meta <= 7) {
        const facing = ["east", "south", "west", "north"][meta & 0x3];
        const open = (meta & 0x4) !== 0;
        return { facing, half: "lower", open: open ? "true" : "false", hinge: "left", powered: "false" };
      }
      if (meta === 8 || meta === 9) {
        const hinge = meta === 8 ? "left" : "right";
        // Upper-half forge state omits facing/open/powered.
        return { half: "upper", hinge, powered: "false", facing: "north", open: "false" };
      }
      return null;
    }

    case "trapdoor": {
      if (meta > 15) return null;
      const facing = ["north", "south", "west", "east"][meta & 0x3];
      const open = (meta & 0x4) !== 0;
      const top = (meta & 0x8) !== 0;
      return { facing, open: open ? "true" : "false", half: top ? "top" : "bottom" };
    }

    case "fence_gate": {
      if (meta > 7) return null;
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const open = (meta & 0x4) !== 0;
      return { facing, open: open ? "true" : "false", in_wall: "false", powered: "false" };
    }

    case "facing4": {
      const f = intToFacing4(meta);
      return f ? { facing: f } : null;
    }

    case "facing4_horizontal": {
      const f = intToFacing4Horizontal(meta);
      return f ? { facing: f } : null;
    }

    case "facing6": {
      const f = intToFacing6(meta);
      return f ? { facing: f } : null;
    }

    case "facing6_powered": {
      const facing = intToFacing6(meta & 0x7);
      if (!facing) return null;
      const triggered = (meta & 0x8) !== 0;
      // Property name varies (triggered vs powered) — for our purposes both
      // serialize the same way through PyMCTranslate. Use `triggered` since
      // that's what dropper/dispenser/command_block use.
      return { facing, triggered: triggered ? "true" : "false" };
    }

    case "torch":
      // 1=east 2=west 3=south 4=north 5=up (0 unused)
      return ["", "east", "west", "south", "north", "up"][meta]
        ? { facing: ["", "east", "west", "south", "north", "up"][meta] }
        : null;

    case "piston": {
      const facing = intToFacing6(meta & 0x7);
      if (!facing) return null;
      const extended = (meta & 0x8) !== 0;
      return { facing, extended: extended ? "true" : "false" };
    }

    case "piston_head": {
      const facing = intToFacing6(meta & 0x7);
      if (!facing) return null;
      const sticky = (meta & 0x8) !== 0;
      return { facing, type: sticky ? "sticky" : "normal", short: "false" };
    }

    case "repeater": {
      if (meta > 15) return null;
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const delay = ((meta >> 2) & 0x3) + 1;
      return {
        facing,
        delay: String(delay),
        powered: spec.powered ? "true" : "false",
        locked: "false",
      };
    }

    case "comparator": {
      if (meta > 15) return null;
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const mode = (meta & 0x4) !== 0 ? "subtract" : "compare";
      const powered = (meta & 0x8) !== 0 || spec.powered;
      return { facing, mode, powered: powered ? "true" : "false" };
    }

    case "int_prop": {
      const base = spec.base ?? 0;
      const lo = base;
      const hi = base + spec.max;
      const value = meta + base;
      if (value < lo || value > hi) return null;
      return { [spec.prop]: String(value) };
    }

    case "cocoa": {
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const age = (meta >> 2) & 0x3;
      if (age > 2) return null;
      return { facing, age: String(age) };
    }

    case "end_portal_frame": {
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const eye = (meta & 0x4) !== 0;
      return { facing, eye: eye ? "true" : "false" };
    }

    case "hopper": {
      const facing = ["down", "down", "north", "south", "west", "east"][meta & 0x7];
      if (!facing || (meta & 0x7) === 1) return null; // 1 is unused
      const enabled = (meta & 0x8) === 0;
      return { facing, enabled: enabled ? "true" : "false" };
    }

    case "rail": {
      // Straight rails: 0-5 directions, optional 6-9 for curves.
      const shapes = spec.withDir6
        ? ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south",
           "south_east", "south_west", "north_west", "north_east"]
        : ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south"];
      const shapeIdx = spec.powered ? meta & 0x7 : meta;
      if (shapeIdx >= shapes.length) return null;
      if (spec.powered) {
        const powered = (meta & 0x8) !== 0;
        return { shape: shapes[shapeIdx], powered: powered ? "true" : "false" };
      }
      return { shape: shapes[shapeIdx] };
    }

    case "bed": {
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const occupied = (meta & 0x4) !== 0;
      const head = (meta & 0x8) !== 0;
      return {
        facing,
        occupied: occupied ? "true" : "false",
        part: head ? "head" : "foot",
      };
    }

    case "skull": {
      // 1=floor, 2-5=wall facing
      if (meta === 0) return null;
      if (meta === 1) return { facing: "up", nodrop: "false" };
      const facing = intToFacing4(meta);
      return facing ? { facing, nodrop: "false" } : null;
    }

    case "button": {
      // 0=down, 1-4=side facing, 5=up
      const map = ["down", "east", "west", "south", "north", "up"];
      const idx = meta & 0x7;
      if (idx >= map.length) return null;
      const facing = map[idx] === "down" || map[idx] === "up"
        ? "north"
        : map[idx];
      const face = map[idx] === "down" ? "ceiling" : map[idx] === "up" ? "floor" : "wall";
      const powered = (meta & 0x8) !== 0;
      return { facing, face, powered: powered ? "true" : "false" };
    }

    case "lever": {
      // 0/7=floor S/W, 1-4=wall facings, 5/6=ceiling
      const map: Record<number, { facing: string; face: string }> = {
        0: { facing: "north", face: "ceiling" },
        1: { facing: "east", face: "wall" },
        2: { facing: "west", face: "wall" },
        3: { facing: "south", face: "wall" },
        4: { facing: "north", face: "wall" },
        5: { facing: "north", face: "floor" },
        6: { facing: "east", face: "floor" },
        7: { facing: "east", face: "ceiling" },
      };
      const slot = meta & 0x7;
      if (!(slot in map)) return null;
      const powered = (meta & 0x8) !== 0;
      return { ...map[slot], powered: powered ? "true" : "false" };
    }

    case "pressure_plate":
      return meta === 0 || meta === 1
        ? { powered: meta === 0 ? "false" : "true" }
        : null;

    case "pressure_plate_weighted":
      return meta <= 15 ? { power: String(meta) } : null;

    case "tripwire_hook": {
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const attached = (meta & 0x4) !== 0;
      const powered = (meta & 0x8) !== 0;
      return {
        facing,
        attached: attached ? "true" : "false",
        powered: powered ? "true" : "false",
        suspended: "false",
      };
    }

    case "tripwire": {
      const powered = (meta & 0x1) !== 0;
      const attached = (meta & 0x4) !== 0;
      const disarmed = (meta & 0x8) !== 0;
      return {
        powered: powered ? "true" : "false",
        attached: attached ? "true" : "false",
        disarmed: disarmed ? "true" : "false",
        suspended: "false",
        // east/north/south/west expanded by RUNTIME_PROPS.
      };
    }

    case "axis_only": {
      // 0x4=y, 0x8=x, 0xC=z (bone_block/hay_block/purpur_pillar pack axis in
      // bits 2-3 with rest unused).
      const axisBits = (meta >> 2) & 0x3;
      const axis = ["y", "x", "z"][axisBits];
      return axis ? { axis } : null;
    }

    case "anvil": {
      const facing = ["south", "west", "north", "east"][meta & 0x3];
      const damage = (meta >> 2) & 0x3;
      const damageMap = ["undamaged", "slightly_damaged", "very_damaged"];
      if (damage >= damageMap.length) return null;
      return { facing, damage: damageMap[damage] };
    }

    case "brewing_stand": {
      return {
        has_bottle_0: (meta & 0x1) !== 0 ? "true" : "false",
        has_bottle_1: (meta & 0x2) !== 0 ? "true" : "false",
        has_bottle_2: (meta & 0x4) !== 0 ? "true" : "false",
      };
    }

    case "structure_block": {
      const modes = ["save", "load", "corner", "data"];
      return meta < modes.length ? { mode: modes[meta] } : null;
    }

    case "vine": {
      return {
        up: "false",
        south: (meta & 0x1) !== 0 ? "true" : "false",
        west: (meta & 0x2) !== 0 ? "true" : "false",
        north: (meta & 0x4) !== 0 ? "true" : "false",
        east: (meta & 0x8) !== 0 ? "true" : "false",
      };
    }

    case "portal":
      return meta === 1 || meta === 2 ? { axis: meta === 1 ? "x" : "z" } : null;
  }
}

// ── State string formatter (matches BlockState.toString) ──────────────────

function stateString(name: string, props: Record<string, string>): string {
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return `minecraft:${name}`;
  return `minecraft:${name}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]`;
}

// ── Runtime-computed property expansions ──────────────────────────────────
//
// Some Forge properties are *resolved at place-time* from neighbor state and
// thus don't live in metadata. BG serializes the resolved values verbatim,
// so we have to emit one lookup entry per possible combination. Each entry
// here lists the runtime properties to add and their possible values.

const BOOL = ["false", "true"];

const RUNTIME_PROPS: Record<string, Record<string, readonly string[]>> = {
  // Grass/dirt/mycelium/grass_path: `snowy` true/false from neighbor snow.
  grass: { snowy: BOOL },
  dirt: { snowy: BOOL },
  mycelium: { snowy: BOOL },
  // grass_path: stateless in Forge, no snowy property.

  // Stairs: shape computed from neighbor stairs.
  oak_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  spruce_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  birch_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  jungle_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  acacia_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  dark_oak_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  stone_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  sandstone_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  red_sandstone_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  brick_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  stone_brick_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  nether_brick_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  quartz_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },
  purpur_stairs: { shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] },

  // Fence connections (4 booleans).
  fence: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  spruce_fence: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  birch_fence: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  jungle_fence: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  acacia_fence: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  dark_oak_fence: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  nether_brick_fence: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  iron_bars: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  glass_pane: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },
  chorus_plant: { down: BOOL, east: BOOL, north: BOOL, south: BOOL, up: BOOL, west: BOOL },

  // Stained glass pane has connections too.
  stained_glass_pane: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },

  // Cobblestone wall: 4 connections + up bit (auto-set when adjacent to tall block).
  cobblestone_wall: { east: BOOL, north: BOOL, south: BOOL, up: BOOL, west: BOOL },

  // Tripwire connections.
  tripwire: { east: BOOL, north: BOOL, south: BOOL, west: BOOL },

  // Redstone wire neighbor connections (Forge serializes these too).
  redstone_wire: {
    east: ["none", "side", "up"],
    north: ["none", "side", "up"],
    south: ["none", "side", "up"],
    west: ["none", "side", "up"],
  },
};

function cartesian(
  expansions: Record<string, readonly string[]>,
): Array<Record<string, string>> {
  const keys = Object.keys(expansions);
  if (keys.length === 0) return [{}];
  let out: Array<Record<string, string>> = [{}];
  for (const k of keys) {
    const next: Array<Record<string, string>> = [];
    for (const cur of out) {
      for (const v of expansions[k]) {
        next.push({ ...cur, [k]: v });
      }
    }
    out = next;
  }
  return out;
}

function expand(
  blockName: string,
  base: Record<string, string>,
): Array<Record<string, string>> {
  const rt = RUNTIME_PROPS[blockName];
  if (!rt) return [base];
  // Only expand properties not already set by base.
  const toExpand: Record<string, readonly string[]> = {};
  for (const [k, v] of Object.entries(rt)) {
    if (!(k in base)) toExpand[k] = v;
  }
  return cartesian(toExpand).map((extra) => ({ ...base, ...extra }));
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const blocks = loadBlocks();
  const table: Record<string, string> = {};
  const skipped: Array<[string, number, string]> = [];

  for (const block of blocks) {
    const spec: BlockSpec = FORGE_1_12_SPECS[block.name] ?? { kind: "stateless" };

    // Determine the metadata range to enumerate. If the spec is stateless we
    // emit one entry at meta=0. Otherwise we enumerate 0..15 and skip nulls.
    const metas = spec.kind === "stateless" ? [0] : Array.from({ length: 16 }, (_, i) => i);

    for (const meta of metas) {
      const decoded = decode(block, spec, meta);
      if (decoded === null) continue;
      for (const expanded of expand(block.name, decoded)) {
        const key = stateString(block.name, expanded);
        const value = `${block.id}:${meta}`;
        if (table[key] !== undefined && table[key] !== value) {
          skipped.push([key, meta, `collision (was ${table[key]}, now ${value})`]);
          continue;
        }
        table[key] = value;
      }
    }
  }

  // Sanity check: every variation listed in minecraft-data should be reachable
  // from at least one entry in our table (otherwise the spec is wrong).
  let unreached = 0;
  for (const block of blocks) {
    for (const v of block.variations ?? []) {
      const target = `${block.id}:${v.metadata}`;
      if (!Object.values(table).includes(target)) unreached++;
    }
  }

  process.stderr.write(`Wrote ${Object.keys(table).length} entries\n`);
  process.stderr.write(`Skipped ${skipped.length} collisions/errors\n`);
  process.stderr.write(`${unreached} minecraft-data variations have no matching spec entry (the rest is covered)\n`);

  const header = `// AUTO-GENERATED by scripts/generate-forge-1.12-flatten.mts — do NOT edit.
// Regenerate with: pnpm gen:forge-1.12
//
// Maps a Forge 1.12 BlockState string ("minecraft:planks[variant=spruce]") to
// the corresponding legacy "id:metadata" string ("5:1"). The runtime then
// chains this into the standard 1.12 → 1.13 FLATTEN_TABLE.\n`;

  const body = `export const FORGE_1_12_FLATTEN: Readonly<Record<string, string>> = ${JSON.stringify(table, null, 2)};\n`;

  writeFileSync(OUT_PATH, header + "\n" + body);
}

main();
