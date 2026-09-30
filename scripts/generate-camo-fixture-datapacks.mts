// Generates two Minecraft datapacks that place every camo block the camo
// renderer needs fixtures for, so the test schematics in
// `src/lib/__tests__/fixtures/` are saved by the mods themselves instead of
// being hand-written NBT.
//
//   build/camo-fixture-datapacks/schematiclab-framedblocks-26.1.2/
//     FramedBlocks (26.1.2, NeoForge). Every block type: the ones the shape
//     pack doesn't cover yet in every shape-relevant state, the covered ones
//     in every state their shape-pack rules distinguish.
//   build/camo-fixture-datapacks/schematiclab-copycats-1.21.1/
//     Copycats+ and Create copycats (1.21.1, NeoForge), specs in
//     `scripts/camo-fixtures/copycats-specs.ts`.
//
// Each fixture is one function that clears a floor-backed area of at most
// 48×48 (the structure block limit), places the blocks on a 2-block grid and
// drops a structure block preset to SAVE exactly that area. See the README
// written into each pack for the in-game steps.
//
// Inputs (same checkout lookup as `generate-camo-shapes.mts`):
//   - XFactHD/FramedBlocks checkout (FRAMEDBLOCKS_PATH): BlockType.java,
//     FBContent.java and the block classes' createBlockStateDefinition(),
//     FramedProperties/PropertyHolder and their enums
//   - public/camo-shapes/framedblocks.json: rule states of covered types
//
// Usage:
//   node --experimental-strip-types scripts/generate-camo-fixture-datapacks.mts
//   (also wired up as `pnpm gen:camo-fixture-datapacks`)

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ShapePack } from "../src/lib/render/camo/shape-pack.ts";
import {
  COPYCAT_SPECS,
  type CopycatSpec,
} from "./camo-fixtures/copycats-specs.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_DIR = join(REPO_ROOT, "build/camo-fixture-datapacks");
const FRAMED_PACK = join(REPO_ROOT, "public/camo-shapes/framedblocks.json");
const HOME = process.env.HOME ?? "";

function findCheckout(envVar: string, name: string): string {
  const candidates = [
    process.env[envVar],
    join(HOME, "projects", name),
    resolve(REPO_ROOT, "..", name),
  ].filter((path): path is string => path !== undefined && path !== "");
  const found = candidates.find((path) => existsSync(path));
  if (found === undefined) {
    throw new Error(
      `No ${name} checkout found (tried ${candidates.join(", ")}); set ${envVar}`,
    );
  }
  return found;
}

function gitHead(checkout: string): string {
  return execSync("git rev-parse --short HEAD", { cwd: checkout })
    .toString()
    .trim();
}

// ── Placements and layout ──────────────────────────────────────────────────

type State = Record<string, string>;

interface Placement {
  block: string;
  state: State;
  /** Block entity SNBT, or undefined for an empty camo. */
  nbt?: string;
  /** Door: the upper half goes on top, placed after the lower half. */
  door?: boolean;
  /** Offset of a support block the placement needs (wall buttons, ladders). */
  support?: [number, number, number];
  /** Needs a falling-block landing without `strict` (see needsFallingBlock). */
  falling?: boolean;
}

interface Fixture {
  /** Function and structure name; the saved file is `<name>.nbt`. */
  name: string;
  story: string;
  /** One row (or more, when it wraps) per block type. */
  rows: { label: string; placements: Placement[] }[];
}

const GRID = 2;
const MAX_CELLS = 48 / GRID;

interface Plate {
  name: string;
  story: string;
  cells: { x: number; z: number; placement: Placement }[];
  legend: string[];
  width: number;
  depth: number;
}

/**
 * Packs rows into plates of at most MAX_CELLS × MAX_CELLS cells. Short rows
 * share a line (first fit, one empty cell between them); rows longer than a
 * line wrap onto whole lines of their own.
 */
function layOut(fixture: Fixture): Plate[] {
  const plates: Plate[] = [];
  let plate: Plate | undefined;
  let z = 0; // first free line
  let x = 0; // first free cell on the line before `z`, 0 when it's full
  const newPlate = () => {
    plate = {
      name: `${fixture.name}_${plates.length + 1}`,
      story: fixture.story,
      cells: [],
      legend: [],
      width: 0,
      depth: 0,
    };
    plates.push(plate);
    z = 0;
    x = 0;
  };
  for (const row of fixture.rows) {
    const count = row.placements.length;
    const lines = Math.ceil(count / MAX_CELLS);
    if (lines > MAX_CELLS) {
      throw new Error(`${row.label}: ${count} placements`);
    }
    let startX: number;
    let startZ: number;
    if (
      plate !== undefined &&
      lines === 1 &&
      x > 0 &&
      x + 1 + count <= MAX_CELLS
    ) {
      startX = x + 1;
      startZ = z - 1;
    } else {
      if (plate === undefined || z + lines > MAX_CELLS) newPlate();
      startX = 0;
      startZ = z;
      z += lines;
    }
    const current = plate!;
    const lastX = lines === 1 ? startX + count - 1 : MAX_CELLS - 1;
    x =
      lines === 1
        ? lastX + 1
        : count % MAX_CELLS === 0
          ? MAX_CELLS
          : count % MAX_CELLS;
    if (x >= MAX_CELLS - 1) x = 0;
    const zRange =
      lines > 1
        ? `${startZ * GRID}..${(startZ + lines - 1) * GRID}`
        : `${startZ * GRID}`;
    current.legend.push(
      `z=${zRange} x=${startX * GRID}..${lastX * GRID}: ${row.label} (${count})`,
    );
    row.placements.forEach((placement, i) => {
      const cellX = lines === 1 ? startX + i : i % MAX_CELLS;
      const cellZ = startZ + (lines === 1 ? 0 : Math.floor(i / MAX_CELLS));
      current.cells.push({ x: cellX, z: cellZ, placement });
      current.width = Math.max(current.width, cellX + 1);
    });
    current.depth = z;
  }
  // A single plate keeps the plain name.
  if (plates.length === 1) plates[0].name = fixture.name;
  return plates;
}

function stateString(state: State): string {
  const entries = Object.entries(state);
  if (entries.length === 0) return "";
  // A bad state stops the whole function file loading, with no chat error.
  for (const [k, v] of entries) {
    if (!/^[a-z0-9_]+$/.test(k) || !/^[a-z0-9_]+$/.test(v)) {
      throw new Error(`Invalid block state property ${k}=${v}`);
    }
  }
  return `[${entries.map(([k, v]) => `${k}=${v}`).join(",")}]`;
}

function snbtState(block: string, state: State): string {
  const props = Object.entries(state)
    .map(([k, v]) => `${k}:"${v}"`)
    .join(",");
  return props === ""
    ? `{Name:"${block}"}`
    : `{Name:"${block}",Properties:{${props}}}`;
}

interface Target {
  pack: string;
  minecraft: string;
  /** `pack.mcmeta` "pack" body. */
  packMeta: Record<string, unknown>;
  /** 26.1+ `strict` skips neighbour shape updates on the placed block. */
  strict: boolean;
  header: string[];
}

/**
 * Without `strict` (1.21.1), `/setblock` runs `updateFromNeighbourShapes`,
 * which turns a lone door half into air and resets wall/fence connections.
 * A landing falling block keeps its exact state and merges TileEntityData,
 * so those placements are summoned instead (see FallingBlockEntity.tick).
 */
function needsFallingBlock(target: Target, placement: Placement): boolean {
  return (
    !target.strict && (placement.door === true || placement.falling === true)
  );
}

function writePlate(target: Target, plate: Plate, functionDir: string): void {
  const strict = target.strict ? " strict" : "";
  const width = plate.width * GRID - 1;
  const depth = plate.depth * GRID - 1;
  const height = Math.max(
    ...plate.cells.map(({ placement }) =>
      Math.max(placement.door ? 2 : 1, 1 + (placement.support?.[1] ?? 0)),
    ),
  );
  const lines: string[] = [
    ...target.header,
    `# ${plate.name}: ${plate.story}`,
    `# Run from where the structure block should go; blocks start at ~1 ~1 ~1.`,
    ...plate.legend.map((line) => `#   ${line}`),
    "",
    `fill ~ ~ ~ ~${width + 1} ~${height + 2} ~${depth + 1} minecraft:air${strict}`,
    `fill ~1 ~ ~1 ~${width} ~ ~${depth} minecraft:smooth_stone${strict}`,
  ];
  const upper: string[] = [];
  for (const { x, z, placement } of plate.cells) {
    const px = 1 + x * GRID;
    const pz = 1 + z * GRID;
    if (placement.support) {
      const [sx, sy, sz] = placement.support;
      lines.push(
        `setblock ~${px + sx} ~${1 + sy} ~${pz + sz} minecraft:stone${strict}`,
      );
    }
    const state = placement.door
      ? { ...placement.state, half: "lower" }
      : placement.state;
    if (needsFallingBlock(target, placement)) {
      const data =
        placement.nbt === undefined ? "" : `,TileEntityData:${placement.nbt}`;
      lines.push(
        `summon minecraft:falling_block ~${px + 0.5} ~1 ~${pz + 0.5} {BlockState:${snbtState(placement.block, state)},Time:1${data}}`,
      );
    } else {
      lines.push(
        `setblock ~${px} ~1 ~${pz} ${placement.block}${stateString(state)}${placement.nbt ?? ""}${strict}`,
      );
    }
    if (placement.door) {
      const top = { ...placement.state, half: "upper" };
      upper.push(
        `setblock ~${px} ~2 ~${pz} ${placement.block}${stateString(top)}${placement.nbt ?? ""}${strict}`,
      );
    }
  }
  const structure = [
    `mode:"SAVE"`,
    `name:"schematiclab:${plate.name}"`,
    `posX:1,posY:1,posZ:1`,
    `sizeX:${width},sizeY:${height},sizeZ:${depth}`,
    `ignoreEntities:1b`,
    `showboundingbox:1b`,
  ].join(",");
  if (upper.length > 0) {
    // Scheduled functions run at the world spawn, so the upper halves find
    // the origin through a marker; falling blocks land within a few ticks.
    const upperName = `${plate.name}_upper`;
    lines.push(
      `kill @e[type=minecraft:marker,tag=schematiclab.${plate.name}]`,
      `summon minecraft:marker ~ ~ ~ {Tags:["schematiclab.${plate.name}"]}`,
      `schedule function schematiclab:${upperName} 10t`,
    );
    writeFileSync(
      join(functionDir, `${upperName}.mcfunction`),
      [
        ...target.header,
        `# Upper door halves for ${plate.name}; scheduled by it.`,
        `execute at @e[type=minecraft:marker,tag=schematiclab.${plate.name},limit=1] run function schematiclab:${upperName}_at`,
        `kill @e[type=minecraft:marker,tag=schematiclab.${plate.name}]`,
        `tellraw @a {"text":"schematiclab:${plate.name}: upper door halves placed.","color":"green"}`,
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(functionDir, `${upperName}_at.mcfunction`),
      [...target.header, ...upper, ""].join("\n"),
    );
  }
  lines.push(
    `setblock ~ ~ ~ minecraft:structure_block[mode=save]{${structure}}`,
    `tellraw @s {"text":"schematiclab:${plate.name} placed; open the structure block at your feet and press SAVE.","color":"green"}`,
    "",
  );
  // Falling blocks and the marker sit at `~x.5`, so the body runs from the
  // block the player stands in rather than from their exact position.
  writeFileSync(
    join(functionDir, `${plate.name}_place.mcfunction`),
    lines.join("\n"),
  );
  writeFileSync(
    join(functionDir, `${plate.name}.mcfunction`),
    [
      ...target.header,
      `execute align xyz run function schematiclab:${plate.name}_place`,
      "",
    ].join("\n"),
  );
}

function writeDatapack(target: Target, fixtures: Fixture[], readme: string[]) {
  const root = join(OUT_DIR, target.pack);
  rmSync(root, { recursive: true, force: true });
  const functionDir = join(root, "data/schematiclab/function");
  mkdirSync(functionDir, { recursive: true });
  writeFileSync(
    join(root, "pack.mcmeta"),
    JSON.stringify({ pack: target.packMeta }, null, 2) + "\n",
  );
  const summary: string[] = [];
  let blocks = 0;
  for (const fixture of fixtures) {
    for (const plate of layOut(fixture)) {
      writePlate(target, plate, functionDir);
      blocks += plate.cells.length;
      summary.push(
        `| \`/function schematiclab:${plate.name}\` | \`${plate.name}.nbt\` | ${plate.story} | ${plate.cells.length} | ${plate.width * GRID - 1}×${plate.depth * GRID - 1} |`,
        ...plate.legend.map((line) => `|  |  | ${line} |  |  |`),
      );
    }
  }
  writeFileSync(
    join(root, "README.md"),
    [
      `# ${target.pack}`,
      "",
      ...readme,
      "",
      "| Function | Save as | Story | Blocks | Area (x×z) |",
      "| --- | --- | --- | --- | --- |",
      ...summary,
      "",
    ].join("\n"),
  );
  console.log(`${target.pack}: ${blocks} placements → ${root}`);
}

// ── Java source helpers ────────────────────────────────────────────────────

/** Text between the parenthesis at `open` and its match. */
function parenBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) {
      return text.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced parentheses");
}

function braceBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      return text.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced braces");
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== "");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function indexJava(dir: string, index = new Map<string, string>()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) indexJava(path, index);
    else if (entry.name.endsWith(".java")) {
      index.set(
        entry.name.slice(0, -5),
        stripComments(readFileSync(path, "utf8")),
      );
    }
  }
  return index;
}

// ── FramedBlocks ───────────────────────────────────────────────────────────

interface PropertyDef {
  name: string;
  values: string[];
}

/** Vanilla `BlockStateProperties` the framed blocks use. */
const VANILLA_PROPERTIES: Record<string, PropertyDef> = {
  HORIZONTAL_FACING: {
    name: "facing",
    values: ["north", "south", "west", "east"],
  },
  FACING: {
    name: "facing",
    values: ["down", "up", "north", "south", "west", "east"],
  },
  AXIS: { name: "axis", values: ["x", "y", "z"] },
  RAIL_SHAPE_STRAIGHT: {
    name: "shape",
    values: [
      "north_south",
      "east_west",
      "ascending_east",
      "ascending_west",
      "ascending_north",
      "ascending_south",
    ],
  },
  POWERED: { name: "powered", values: ["true", "false"] },
  WATERLOGGED: { name: "waterlogged", values: ["true", "false"] },
};

/** Enum properties created with a value filter. */
const FILTERED_PROPERTIES: Record<string, string[]> = {
  FACING_NE: ["north", "east"],
  ASCENDING_RAIL_SHAPE: [
    "ascending_east",
    "ascending_west",
    "ascending_north",
    "ascending_south",
  ],
};

/**
 * Vanilla superclasses of framed blocks, by the properties their
 * createBlockStateDefinition() adds. "getShapeProperty" is the subclass's
 * getShapeProperty() override, or the vanilla straight rail shape.
 */
const VANILLA_PARENTS: Record<string, string[]> = {
  BaseRailBlock: ["WATERLOGGED"],
  DetectorRailBlock: ["getShapeProperty", "POWERED", "WATERLOGGED"],
  Block: [],
};

/** Properties that don't change the rendered shape. */
const NON_SHAPE = new Set([
  "solid",
  "glowing",
  "propagates_skylight",
  "waterlogged",
  "locked",
  "copycat_style",
  "powered",
  "alt_slope",
]);

class FramedSource {
  readonly java: Map<string, string>;
  readonly properties = new Map<string, PropertyDef>();
  private readonly resolved = new Map<string, Map<string, PropertyDef>>();

  constructor(checkout: string) {
    this.java = indexJava(join(checkout, "src/main/java"));
    for (const holder of ["FramedProperties", "PropertyHolder"]) {
      const text = this.source(holder);
      const decl =
        /(\w+)\s*=\s*(BooleanProperty|EnumProperty|IntegerProperty)\.create\(/g;
      for (const match of text.matchAll(decl)) {
        const args = splitTopLevel(
          parenBody(text, match.index + match[0].length - 1),
        );
        this.properties.set(
          match[1],
          this.propertyDef(match[1], match[2], args),
        );
      }
      for (const match of text.matchAll(
        /(\w+)\s*=\s*BlockStateProperties\.(\w+)\s*;/g,
      )) {
        this.properties.set(match[1], this.vanillaProperty(match[2]));
      }
    }
  }

  private source(className: string): string {
    const text = this.java.get(className);
    if (text === undefined) throw new Error(`No source for ${className}`);
    return text;
  }

  private vanillaProperty(name: string): PropertyDef {
    const def = VANILLA_PROPERTIES[name];
    if (def === undefined) {
      throw new Error(`Unknown BlockStateProperties.${name}`);
    }
    return def;
  }

  private propertyDef(
    field: string,
    kind: string,
    args: string[],
  ): PropertyDef {
    const name = JSON.parse(args[0]) as string;
    if (kind === "BooleanProperty") return { name, values: ["true", "false"] };
    if (kind === "IntegerProperty") {
      // Bounds like `(1 << 6) - 1` stay unresolved; statePropertiesOf()
      // rejects them if a block without shape-pack rules ever uses one.
      const [lo, hi] = args.slice(1).map(Number);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        return { name, values: [] };
      }
      return {
        name,
        values: Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i)),
      };
    }
    if (args.length > 2) {
      const values = FILTERED_PROPERTIES[field];
      if (values === undefined) {
        throw new Error(`${field}: filtered enum property needs an entry`);
      }
      return { name, values };
    }
    const enumName = args[1].replace(/\.class$/, "");
    return { name, values: this.enumValues(enumName) };
  }

  private enumValues(enumName: string): string[] {
    const text = this.source(enumName);
    if (!/toLowerCase\(Locale\.(ROOT|ENGLISH)\)/.test(text)) {
      throw new Error(`${enumName}: serialized names aren't lower-cased`);
    }
    const open = text.indexOf(
      "{",
      text.search(new RegExp(`enum ${enumName}\\b`)),
    );
    const body = braceBody(text, open);
    let depth = 0;
    let end = body.length;
    for (let i = 0; i < body.length; i++) {
      if ("({".includes(body[i])) depth++;
      else if (")}".includes(body[i])) depth--;
      else if (body[i] === ";" && depth === 0) {
        end = i;
        break;
      }
    }
    return splitTopLevel(body.slice(0, end)).map((constant) =>
      constant.match(/^\s*(\w+)/)![1].toLowerCase(),
    );
  }

  private propertyRef(ref: string): PropertyDef {
    const field = ref.replace(/^(FramedProperties|PropertyHolder)\./, "");
    const own = this.properties.get(field);
    if (own !== undefined) return own;
    const vanilla = field.replace(/^BlockStateProperties\./, "");
    if (
      field.startsWith("BlockStateProperties.") ||
      vanilla in VANILLA_PROPERTIES
    ) {
      return this.vanillaProperty(vanilla);
    }
    throw new Error(`Unknown property ${ref}`);
  }

  /** Class declaration up to `{`, without generic parameters. */
  private declaration(className: string): string {
    let decl = this.source(className).match(
      new RegExp(`class ${className}\\b[^{]*`),
    )![0];
    while (/<[^<>]*>/.test(decl)) decl = decl.replace(/<[^<>]*>/g, "");
    return decl;
  }

  private parentOf(className: string): string | undefined {
    return this.declaration(className).match(/extends\s+(\w+)/)?.[1];
  }

  private implementsSlopeToggle(className: string): boolean {
    if (!this.java.has(className)) return false;
    if (/\bSlopeToggleBlock\b/.test(this.declaration(className))) return true;
    const parent = this.parentOf(className);
    return parent !== undefined && this.implementsSlopeToggle(parent);
  }

  /** Properties added by a vanilla superclass of `className`. */
  private vanillaParentProperties(className: string, parent: string) {
    const refs = VANILLA_PARENTS[parent];
    if (refs === undefined) {
      throw new Error(`${className}: unknown vanilla parent ${parent}`);
    }
    return refs.map((ref) => {
      if (ref !== "getShapeProperty") return this.vanillaProperty(ref);
      const text = this.source(className);
      const method = text.search(/getShapeProperty\s*\(\s*\)\s*\{/);
      if (method < 0) return this.vanillaProperty("RAIL_SHAPE_STRAIGHT");
      const body = braceBody(text, text.indexOf("{", method));
      return this.propertyRef(body.match(/return\s+([\w.]+)\s*;/)![1]);
    });
  }

  /** Every state property of the class, by serialized name. */
  statePropertiesOf(className: string): Map<string, PropertyDef> {
    const cached = this.resolved.get(className);
    if (cached !== undefined) return cached;
    const props = new Map<string, PropertyDef>();
    const text = this.source(className);
    const parent = this.parentOf(className);
    const method = text.search(/void createBlockStateDefinition\s*\(/);
    const inherit = () => {
      if (parent === undefined) return;
      const inherited = this.java.has(parent)
        ? [...this.statePropertiesOf(parent).values()]
        : this.vanillaParentProperties(className, parent);
      for (const def of inherited) props.set(def.name, def);
    };
    if (method < 0) {
      inherit();
    } else {
      const body = braceBody(text, text.indexOf("{", method));
      if (/\bif\s*\(|\?/.test(body)) {
        throw new Error(`${className}: conditional createBlockStateDefinition`);
      }
      if (/super\.createBlockStateDefinition/.test(body)) inherit();
      for (const match of body.matchAll(/builder\.add\(/g)) {
        const args = parenBody(body, match.index + match[0].length - 1);
        for (const ref of splitTopLevel(args)) {
          const def = this.propertyRef(ref);
          if (def.values.length === 0) {
            throw new Error(`${className}: can't resolve ${ref} values`);
          }
          props.set(def.name, def);
        }
      }
      for (const match of body.matchAll(
        /removeProperty\(\s*builder\s*,\s*([\w.]+)\s*\)/g,
      )) {
        props.delete(this.propertyRef(match[1]).name);
      }
    }
    // BlockUtils.addStandardProperties adds alt_slope to SlopeToggleBlocks.
    if (this.implementsSlopeToggle(className)) {
      props.set("alt_slope", { name: "alt_slope", values: ["true", "false"] });
    }
    this.resolved.set(className, props);
    return props;
  }
}

interface FramedType {
  id: string;
  className: string;
  doubleBlock: boolean;
  hasItem: boolean;
}

function readFramedTypes(checkout: string): FramedType[] {
  const base = join(checkout, "src/main/java/io/github/xfacthd/framedblocks");
  const blockTypes = readFileSync(
    join(base, "common/data/BlockType.java"),
    "utf8",
  );
  const content = readFileSync(join(base, "common/FBContent.java"), "utf8");
  const classes = new Map<string, string>();
  for (const match of content.matchAll(
    /registerBlock\((\w+)::\w+,\s*BlockType\.(\w+)\)/g,
  )) {
    classes.set(match[2], match[1]);
  }
  const types: FramedType[] = [];
  for (const match of blockTypes.matchAll(/^ {4}(FRAMED_\w+)\s*\(([^)]*)/gm)) {
    // (canOcclude, specialBlockEntity, waterloggable, blockItem,
    //  allowIntangible, doubleBlock, …)
    const flags = match[2].split(",").map((flag) => flag.trim());
    const className = classes.get(match[1]);
    if (className === undefined) throw new Error(`${match[1]} not registered`);
    types.push({
      id: `framedblocks:${match[1].toLowerCase()}`,
      className,
      hasItem: flags[3] === "true",
      doubleBlock: flags[5] === "true",
    });
  }
  return types;
}

const CAMO = snbtState("minecraft:oak_log", { axis: "y" });
const CAMO_TWO = snbtState("minecraft:cherry_log", { axis: "y" });

function framedCamo(type: FramedType): string {
  const camo = (state: string) => `{type:"framedblocks:block",state:${state}}`;
  return type.doubleBlock
    ? `{camo:${camo(CAMO)},camo_two:${camo(CAMO_TWO)}}`
    : `{camo:${camo(CAMO)}}`;
}

function cartesian(props: PropertyDef[]): State[] {
  let states: State[] = [{}];
  for (const prop of props) {
    states = states.flatMap((state) =>
      prop.values.map((value) => ({ ...state, [prop.name]: value })),
    );
  }
  return states;
}

/**
 * Keeps north and east of the horizontal facings: every facing goes through
 * the same rotation code, so one 90° step shows a rotation bug, and it
 * halves the fixtures. Vertical facings (up/down) are all kept.
 */
function sampledFacing(state: State): boolean {
  const facing = state.facing;
  return facing === undefined || !["south", "west"].includes(facing);
}

/** US-015 per the SCHEM-33 epic; the other uncovered types are US-014. */
function isSlopeSlabPanelStory(id: string): boolean {
  return /stairs|rail|slope_slab|slope_panel|pyramid/.test(id);
}

function framedFixtures(checkout: string): Fixture[] {
  const source = new FramedSource(checkout);
  const pack = JSON.parse(readFileSync(FRAMED_PACK, "utf8")) as ShapePack;
  const types = readFramedTypes(checkout);
  const slopes: Fixture["rows"] = [];
  const slabsPanels: Fixture["rows"] = [];
  const covered: Fixture["rows"] = [];
  const problems: string[] = [];

  for (const type of types) {
    let props: Map<string, PropertyDef> | undefined;
    try {
      props = source.statePropertiesOf(type.className);
    } catch (error) {
      props = undefined;
      if (!(type.id in pack.blocks)) {
        problems.push(`${type.id}: ${(error as Error).message}`);
        continue;
      }
    }
    const camo = framedCamo(type);
    const label = `${type.id}${type.hasItem ? "" : " (no item)"}`;
    const rules = pack.blocks[type.id];
    let states: State[];
    if (rules !== undefined) {
      const seen = new Set<string>();
      states = [];
      // A rule value can list alternatives (`latch=default|none`); each one
      // is a separate block state. A key lists the property's current name
      // first, then its legacy names (`alt_slope|yslope`).
      const ruleStates = rules.flatMap((rule) =>
        cartesian(
          Object.entries(rule.when ?? {}).map(([key, value]) => ({
            name: key.split("|")[0],
            values: value.split("|"),
          })),
        ),
      );
      for (const state of ruleStates) {
        const key = JSON.stringify(Object.entries(state).sort());
        if (seen.has(key)) continue;
        seen.add(key);
        for (const [name, value] of Object.entries(state)) {
          if (props !== undefined && !props.get(name)?.values.includes(value)) {
            problems.push(`${type.id}: shape pack rule uses ${name}=${value}`);
          }
        }
        states.push(state);
      }
    } else {
      const shapeProps = [...props!.values()].filter(
        (prop) => !NON_SHAPE.has(prop.name),
      );
      states = cartesian(shapeProps);
      if (props!.has("alt_slope")) states.push({ alt_slope: "true" });
    }
    const placements: Placement[] = states
      .filter(sampledFacing)
      .map((state) => ({
        block: type.id,
        state,
        nbt: camo,
        // Door rules may leave `half` out; writePlate adds both halves.
        door:
          /_door$/.test(type.id) && state.half !== "upper" ? true : undefined,
      }));
    // Upper door halves are placed on top of their lower half.
    const kept = placements.filter(
      (p) => !(/_door$/.test(type.id) && p.state.half === "upper"),
    );
    const isDoor = kept.some((placement) => placement.door);
    kept.push({ block: type.id, state: {}, door: isDoor || undefined });
    const row = { label, placements: kept };
    if (rules !== undefined) covered.push(row);
    else if (isSlopeSlabPanelStory(type.id)) slabsPanels.push(row);
    else slopes.push(row);
  }
  if (problems.length > 0) {
    throw new Error(`FramedBlocks:\n  ${problems.join("\n  ")}`);
  }
  return [
    { name: "framed_slopes", story: "US-014 (SCHEM-47)", rows: slopes },
    {
      name: "framed_slope_slabs_panels",
      story: "US-015 (SCHEM-48)",
      rows: slabsPanels,
    },
    {
      name: "framed_covered",
      story: "US-006/US-013 regression (types already in the shape pack)",
      rows: covered,
    },
  ];
}

// ── Copycats+ and Create ───────────────────────────────────────────────────

const ITEM = `{id:"minecraft:oak_log",count:1}`;
const ITEM_TWO = `{id:"minecraft:cherry_log",count:1}`;

function copycatPlacements(spec: CopycatSpec): Placement[] {
  const nbtFor = (state: State) => {
    if (spec.parts === undefined) {
      return `{Material:${CAMO},Item:${ITEM},EnableCT:1b}`;
    }
    // Alternate the two camos so each part's material shows.
    const entries = spec.parts(state).map((part, i) => {
      const [camo, item] = i % 2 === 0 ? [CAMO, ITEM] : [CAMO_TWO, ITEM_TWO];
      return `${part}:{material:${camo},enableCT:1b,consumedItem:${item}}`;
    });
    return `{material_data:{${entries.join(",")}}}`;
  };
  const place = (state: State, nbt: string | undefined): Placement => ({
    block: spec.id,
    state,
    nbt,
    door: spec.door,
    falling: spec.falling,
    support: spec.support?.(state),
  });
  const placements = spec.states.map((state) => place(state, nbtFor(state)));
  for (const material of spec.materials ?? []) {
    placements.push(
      place(
        spec.states[0],
        `{Material:${material.state},Item:{id:"${material.item}",count:1},EnableCT:1b}`,
      ),
    );
  }
  placements.push(place(spec.states[0], undefined));
  return placements;
}

function copycatFixtures(): Fixture[] {
  const row = (spec: CopycatSpec) => ({
    label: `${spec.id}${spec.parts !== undefined ? " (multi-state)" : ""}`,
    placements: copycatPlacements(spec),
  });
  return [
    {
      name: "copycats_shapes",
      story: "US-008 (SCHEM-43)",
      rows: COPYCAT_SPECS.filter((spec) => spec.fixture === "shapes").map(row),
    },
    {
      name: "copycats_slopes",
      story: "US-016 (SCHEM-49)",
      rows: COPYCAT_SPECS.filter((spec) => spec.fixture === "slopes").map(row),
    },
  ];
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const framed = findCheckout("FRAMEDBLOCKS_PATH", "FramedBlocks");
  const copycats = findCheckout("COPYCATS_PATH", "copycats");
  const create = findCheckout("CREATE_PATH", "Create");
  mkdirSync(OUT_DIR, { recursive: true });

  const steps = (world: string, extra: string[]) => [
    `Generated by \`scripts/generate-camo-fixture-datapacks.mts\`. Don't edit by hand.`,
    "",
    `1. Copy this folder into \`<world>/datapacks/\` of a creative, flat ${world} world with cheats on, then run \`/reload\`.`,
    "   A function that fails to parse is skipped silently in chat: check `logs/latest.log` for `Failed to load function` and report the line.",
    "2. Stand on open, flat ground and run one function from the table. It clears the area in front of you (+x/+z), lays a smooth stone floor and places the blocks one layer above it.",
    ...extra,
    "3. Look over the build: every block has a camo except the last one in each row, which is deliberately empty. A block missing its camo means its NBT was rejected.",
    "4. Open the structure block at your feet (already in SAVE mode with the right name and size) and press SAVE.",
    "5. Copy `<world>/generated/schematiclab/structures/<name>.nbt` to `src/lib/__tests__/fixtures/`.",
  ];

  writeDatapack(
    {
      pack: "schematiclab-framedblocks-26.1.2",
      minecraft: "26.1.2",
      packMeta: {
        description: "Schematiclab camo fixtures: FramedBlocks",
        min_format: [101, 1],
        max_format: 101,
      },
      strict: true,
      header: [
        `# Generated by scripts/generate-camo-fixture-datapacks.mts; don't edit.`,
        `# FramedBlocks ${gitHead(framed)} for Minecraft 26.1.2.`,
      ],
    },
    framedFixtures(framed),
    steps("Minecraft 26.1.2 + FramedBlocks", []),
  );

  writeDatapack(
    {
      pack: "schematiclab-copycats-1.21.1",
      minecraft: "1.21.1",
      packMeta: {
        description: "Schematiclab camo fixtures: Copycats+ and Create",
        pack_format: 48,
      },
      strict: false,
      header: [
        `# Generated by scripts/generate-camo-fixture-datapacks.mts; don't edit.`,
        `# Copycats+ ${gitHead(copycats)} and Create ${gitHead(create)} for Minecraft 1.21.1.`,
      ],
    },
    copycatFixtures(),
    steps("Minecraft 1.21.1 + Create + Copycats+", [
      "   Doors and wall-like blocks arrive as falling blocks, and the upper door halves appear half a second later; wait for the green message about the upper halves before saving.",
    ]),
  );
}

main();
