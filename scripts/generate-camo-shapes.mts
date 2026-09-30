// Generates the camo shape packs in `public/camo-shapes/` (schema:
// `src/lib/render/camo/shape-pack.ts`).
//
// Inputs:
//   - XFactHD/FramedBlocks checkout
//       src/generated/resources/assets/framedblocks/framed_templates/*.json
//       src/main/java/.../common/data/BlockType.java  → every block id
//       gradle.properties (mod_version), git HEAD (commit)
//   - scripts/camo-shapes/framedblocks/template-specs.ts
//       hand port of TemplateSpecs.java and double-block calculateParts()
//   - scripts/camo-shapes/framedblocks/geometry-specs.ts
//       hand ports of the bespoke (non-templated) *Geometry.java classes,
//       with the slope, slopeedge and prism packages in slope.ts,
//       slope-edge.ts and prism.ts (shared API in geometry-api.ts)
//   - public/minecraft-assets/models.json
//       vanilla models FramedBlocks uses as templates (slab, trapdoor, …)
//
//   - copycats-plus/copycats checkout
//       common/.../CCBlocks.java             → every block id
//       gradle.properties (mod_version), git HEAD (commit)
//   - scripts/camo-shapes/copycats/*.ts
//       hand ports of the content/copycat/*/*ModelCore.java classes, on a
//       port of their assembly API (assembly.ts)
//   - Creators-of-Create/Create checkout
//       src/main/java/.../AllBlocks.java     → the copycat block ids
//       gradle.properties (mod_version), git HEAD (commit)
//   - scripts/camo-shapes/create/copycat-models.ts
//       hand port of CopycatPanelModel, CopycatStepModel, CopycatBarsModel
//
// Output:
//   - public/camo-shapes/framedblocks.json
//   - public/camo-shapes/copycats.json
//   - public/camo-shapes/create.json
//
// Usage:
//   node --experimental-strip-types scripts/generate-camo-shapes.mts
//   (also wired up as `pnpm gen:camo-shapes`)
//
// Override the checkout locations with FRAMEDBLOCKS_PATH, COPYCATS_PATH and
// CREATE_PATH (default ~/projects/<Name>, then ../<Name> next to this repo,
// with the names FramedBlocks, copycats and Create).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import {
  DIRECTIONS,
  SHAPE_PACK_FORMAT_VERSION,
  parseFramedTemplate,
  validateShapePack,
  type Box,
  type Direction,
  type ShapePack,
  type ShapePiece,
  type ShapeRule,
  type TemplateCube,
  type TransformOp,
} from "../src/lib/render/camo/shape-pack.ts";
import {
  DOUBLE_BLOCK_SPECS,
  TEMPLATE_SPECS,
  type BlockState,
  type TemplateSpec,
  type Xform,
} from "./camo-shapes/framedblocks/template-specs.ts";
import {
  GEOMETRY_SPECS,
  type QuadPiece,
} from "./camo-shapes/framedblocks/geometry-specs.ts";
import { LEGACY_PROPERTY_NAMES } from "./camo-shapes/framedblocks/geometry-api.ts";
import {
  MASK_DIRECTIONS,
  MATERIAL_KEY,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type MaterialClass,
  type MutableAABB,
  type Transformable,
} from "./camo-shapes/copycats/assembly.ts";
import { BLOCKS as CREATE_BLOCKS } from "./camo-shapes/create/copycat-models.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_DIR = join(REPO_ROOT, "public/camo-shapes");
const VANILLA_MODELS = join(REPO_ROOT, "public/minecraft-assets/models.json");

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

// ── Templates ──────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

function toVec3(value: unknown, where: string): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((n) => typeof n === "number")
  ) {
    throw new Error(`${where}: expected [x, y, z]`);
  }
  return [value[0], value[1], value[2]];
}

function toBox(from: unknown, to: unknown, where: string): Box {
  const a = toVec3(from, `${where}.from`);
  const b = toVec3(to, `${where}.to`);
  return {
    from: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    to: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

function isDirection(value: string): value is Direction {
  return (DIRECTIONS as readonly string[]).includes(value);
}

/** Every `framed_templates/*.json`, parsed as a loaded jar's would be. */
function readFramedTemplates(dir: string): Map<string, TemplateCube[]> {
  const templates = new Map<string, TemplateCube[]>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    templates.set(
      `framedblocks:${basename(file, ".json")}`,
      parseFramedTemplate(
        JSON.parse(readFileSync(join(dir, file), "utf-8")),
        file,
      ),
    );
  }
  return templates;
}

interface VanillaModel {
  parent?: string;
  elements?: {
    from: unknown;
    to: unknown;
    faces: Record<string, { cullface?: string }>;
  }[];
}

/**
 * A vanilla model as a template (`SourceType.MODEL`): elements come from the
 * nearest model in the parent chain that has them, and a face is cullable
 * when it has a `cullface`.
 */
function vanillaTemplate(
  models: Record<string, VanillaModel>,
  id: string,
): TemplateCube[] {
  let name = id.replace(/^minecraft:/, "").replace(/^block\//, "");
  for (let depth = 0; depth < 16; depth++) {
    const model = models[name];
    if (model === undefined) throw new Error(`Unknown vanilla model ${id}`);
    if (model.elements !== undefined) {
      return model.elements.map((element, i) => ({
        box: toBox(element.from, element.to, `${name}.elements[${i}]`),
        faces: Object.fromEntries(
          Object.entries(element.faces)
            .filter(([face]) => isDirection(face))
            .map(([face, spec]) => [face, spec.cullface !== undefined]),
        ),
      }));
    }
    if (model.parent === undefined) break;
    name = model.parent.replace(/^minecraft:/, "").replace(/^block\//, "");
  }
  throw new Error(`Vanilla model ${id} has no elements`);
}

// ── Spec evaluation ────────────────────────────────────────────────────────

/** `TemplateTransformBuilder.build()`: X, Y, Z rotations, then mirrors. */
function xformOps(xform: Xform | undefined): TransformOp[] {
  if (xform === undefined) return [];
  const ops: TransformOp[] = [];
  if (xform.x) ops.push(`rotateX${xform.x}` as TransformOp);
  if (xform.y) ops.push(`rotateY${xform.y}` as TransformOp);
  if (xform.z) ops.push(`rotateZ${xform.z}` as TransformOp);
  if (xform.mirrorX) ops.push("flipX");
  if (xform.mirrorY) ops.push("flipY");
  if (xform.mirrorZ) ops.push("flipZ");
  return ops;
}

type TemplateLookup = (id: string) => TemplateCube[];

function defaultState(spec: { properties: TemplateSpec["properties"] }) {
  return Object.fromEntries(
    Object.entries(spec.properties).map(([key, values]) => [key, values[0]]),
  );
}

/** Pieces of a templated block in `state`, all in camo slot `slot`. */
function templatePieces(
  block: string,
  state: BlockState,
  slot: string,
  template: TemplateLookup,
): ShapePiece[] {
  const spec = TEMPLATE_SPECS[block];
  if (spec === undefined) throw new Error(`No template spec for ${block}`);
  const geometry = spec.geometry({ ...defaultState(spec), ...state });
  const specOps = xformOps(geometry.transform);
  const pieces: ShapePiece[] = [];
  for (const source of geometry.sources) {
    const transform = [...xformOps(source.xform), ...specOps];
    // Tagged so a loaded jar's copy of the template can replace them.
    const tagged = !source.id.startsWith("minecraft:");
    for (const [element, cube] of template(source.id).entries()) {
      const faces = DIRECTIONS.filter((dir) => cube.faces[dir] !== undefined);
      const piece: ShapePiece = {
        slot,
        select: cube.box,
        offset: [0, 0, 0],
        transform,
        // Post modifiers move faces off their cull side, so drop culling.
        cull: geometry.postModifier
          ? []
          : faces.filter((dir) => cube.faces[dir] === true),
        faces,
        ops: [],
        ...(tagged ? { template: { id: source.id, element } } : {}),
      };
      if (geometry.postModifier) {
        const { axis, origin, angle } = geometry.postModifier;
        piece.ops.push({
          op: "rotate",
          axis,
          origin,
          angle,
          rescale: false,
          scaleMult: [1, 1, 1],
        });
      }
      pieces.push(piece);
    }
  }
  return pieces;
}

const FULL_CUBE: Box = { from: [0, 0, 0], to: [16, 16, 16] };

/**
 * Pieces of a bespoke-geometry block in `state`, all in camo slot `slot`:
 * full faces pass the camo quad through, every other face goes through the
 * ported `transformQuad` (full faces too when the geometry transforms all
 * quads). Quads sharing their ops merge into one piece.
 */
function geometryPieces(
  block: string,
  state: BlockState,
  slot: string,
): ShapePiece[] {
  const spec = GEOMETRY_SPECS[block];
  if (spec === undefined) throw new Error(`No geometry spec for ${block}`);
  const fullState = { ...defaultState(spec), ...state };
  const fullFaces = new Set(spec.fullFaces?.(fullState) ?? []);
  const transformQuad = spec.geometry(fullState);
  const transformAll =
    typeof spec.transformAllQuads === "function"
      ? spec.transformAllQuads(fullState)
      : spec.transformAllQuads === true;
  const quads: QuadPiece[] = [];
  for (const dir of DIRECTIONS) {
    if (fullFaces.has(dir)) quads.push({ face: dir, ops: [], cull: true });
    if (fullFaces.has(dir) && transformAll) {
      // FramedBlocks hides transformed quads whose cull face is a full
      // face (the camo quad is drawn as is there); the rest still render.
      const transformed: QuadPiece[] = [];
      transformQuad(dir, transformed);
      quads.push(...transformed.filter((quad) => !quad.cull));
    } else if (!fullFaces.has(dir)) {
      transformQuad(dir, quads);
    }
  }

  const merged = new Map<
    string,
    { faces: Set<Direction>; cull: Set<Direction>; quad: QuadPiece }
  >();
  for (const quad of quads) {
    const key = JSON.stringify(quad.ops);
    let entry = merged.get(key);
    if (entry === undefined) {
      entry = { faces: new Set(), cull: new Set(), quad };
      merged.set(key, entry);
    }
    entry.faces.add(quad.face);
    if (quad.cull) entry.cull.add(quad.face);
  }
  return [...merged.values()].map(({ faces, cull, quad }) => ({
    slot,
    select: FULL_CUBE,
    offset: [0, 0, 0],
    transform: [],
    cull: DIRECTIONS.filter((dir) => cull.has(dir)),
    faces: DIRECTIONS.filter((dir) => faces.has(dir)),
    ops: quad.ops,
  }));
}

/** Pieces of a templated or bespoke-geometry block. */
function partPieces(
  block: string,
  state: BlockState,
  slot: string,
  template: TemplateLookup,
): ShapePiece[] {
  return GEOMETRY_SPECS[block] !== undefined
    ? geometryPieces(block, state, slot)
    : templatePieces(block, state, slot, template);
}

/** Every combination of `properties`, in declaration order. */
function allStates(
  properties: Readonly<Record<string, readonly string[]>>,
): Record<string, string>[] {
  let states: Record<string, string>[] = [{}];
  for (const [key, values] of Object.entries(properties)) {
    states = states.flatMap((state) =>
      values.map((value) => ({ ...state, [key]: value })),
    );
  }
  return states;
}

// ── Rule compression ───────────────────────────────────────────────────────

interface DraftRule {
  when: Map<string, string[]>;
  pieces: ShapePiece[];
  piecesKey: string;
}

/**
 * Merges rules that differ in one property's value and share their pieces
 * (`a|b` alternatives), dropping a property once every value is covered,
 * until nothing changes. Rules stay disjoint, so order doesn't matter.
 */
function compressRules(
  properties: Readonly<Record<string, readonly string[]>>,
  rules: DraftRule[],
): ShapeRule[] {
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of Object.keys(properties)) {
      const groups = new Map<string, DraftRule[]>();
      for (const rule of rules) {
        if (!rule.when.has(key)) continue;
        const rest = [...rule.when]
          .filter(([k]) => k !== key)
          .map(([k, v]) => `${k}=${v.join("|")}`)
          .join(",");
        const groupKey = `${rule.piecesKey}#${rest}`;
        const group = groups.get(groupKey) ?? [];
        group.push(rule);
        groups.set(groupKey, group);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        changed = true;
        const [first, ...others] = group;
        const values = new Set(group.flatMap((rule) => rule.when.get(key)!));
        if (values.size === properties[key].length) {
          first.when.delete(key);
        } else {
          first.when.set(
            key,
            properties[key].filter((value) => values.has(value)),
          );
        }
        rules = rules.filter((rule) => !others.includes(rule));
      }
    }
  }
  return rules.map(({ when, pieces }) =>
    when.size === 0
      ? { pieces }
      : {
          when: Object.fromEntries(
            [...when].map(([key, values]) => [key, values.join("|")]),
          ),
          pieces,
        },
  );
}

function blockRules(
  properties: Readonly<Record<string, readonly string[]>>,
  piecesFor: (state: BlockState) => ShapePiece[],
): ShapeRule[] {
  const drafts = allStates(properties).map((state): DraftRule => {
    const pieces = piecesFor(state);
    return {
      when: new Map(Object.entries(state).map(([k, v]) => [k, [v]])),
      pieces,
      piecesKey: JSON.stringify(pieces),
    };
  });
  return compressRules(properties, drafts);
}

// ── FramedBlocks ───────────────────────────────────────────────────────────

/** Block ids of every `BlockType` constant (`FRAMED_CUBE` → `framed_cube`). */
function readBlockTypes(checkout: string): string[] {
  const path = join(
    checkout,
    "src/main/java/io/github/xfacthd/framedblocks/common/data/BlockType.java",
  );
  const source = readFileSync(path, "utf-8");
  return [...source.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\s*\(/gm)].map((m) =>
    m[1].toLowerCase(),
  );
}

function readModVersion(checkout: string): string {
  const props = readFileSync(join(checkout, "gradle.properties"), "utf-8");
  const match = /^mod_version\s*=\s*(\S+)/m.exec(props);
  if (match === null) throw new Error("No mod_version in gradle.properties");
  return match[1];
}

function gitCommit(checkout: string): string {
  return execSync(`git -C "${checkout}" rev-parse HEAD`, {
    encoding: "utf-8",
  }).trim();
}

async function generateFramedBlocks(): Promise<void> {
  const checkout = findCheckout("FRAMEDBLOCKS_PATH", "FramedBlocks");
  process.stderr.write(`FramedBlocks: ${checkout}\n`);

  const framedTemplates = readFramedTemplates(
    join(
      checkout,
      "src/generated/resources/assets/framedblocks/framed_templates",
    ),
  );
  const vanillaModels = JSON.parse(
    readFileSync(VANILLA_MODELS, "utf-8"),
  ) as Record<string, VanillaModel>;
  const vanilla = new Map<string, TemplateCube[]>();
  const template: TemplateLookup = (id) => {
    const framed = framedTemplates.get(id);
    if (framed !== undefined) return framed;
    if (!id.startsWith("minecraft:")) {
      throw new Error(`Missing FramedBlocks template ${id}`);
    }
    let cubes = vanilla.get(id);
    if (cubes === undefined) {
      cubes = vanillaTemplate(vanillaModels, id);
      vanilla.set(id, cubes);
    }
    return cubes;
  };

  const blockTypes = readBlockTypes(checkout);
  const known = new Set(blockTypes);
  const blocks: Record<string, ShapeRule[]> = {};

  for (const [block, spec] of Object.entries(TEMPLATE_SPECS)) {
    if (!known.has(block)) throw new Error(`${block} is not a BlockType`);
    blocks[`framedblocks:${block}`] = blockRules(spec.properties, (state) =>
      templatePieces(block, state, "camo", template),
    );
  }
  for (const [block, spec] of Object.entries(GEOMETRY_SPECS)) {
    if (!known.has(block)) throw new Error(`${block} is not a BlockType`);
    if (blocks[`framedblocks:${block}`] !== undefined) {
      throw new Error(`${block} has both a template and a geometry spec`);
    }
    blocks[`framedblocks:${block}`] = blockRules(spec.properties, (state) =>
      geometryPieces(block, state, "camo"),
    );
  }
  for (const [block, spec] of Object.entries(DOUBLE_BLOCK_SPECS)) {
    if (!known.has(block)) throw new Error(`${block} is not a BlockType`);
    blocks[`framedblocks:${block}`] = blockRules(spec.properties, (state) => {
      const [one, two] = spec.parts(state);
      return [
        ...partPieces(one.block, one.props, "camo", template),
        ...partPieces(two.block, two.props, "camo_two", template),
      ];
    });
  }

  // Rule keys also list a renamed property's older names (`alt_slope|yslope`).
  for (const rules of Object.values(blocks)) {
    for (const rule of rules) {
      if (rule.when === undefined) continue;
      rule.when = Object.fromEntries(
        Object.entries(rule.when).map(([key, value]) => [
          [key, ...(LEGACY_PROPERTY_NAMES[key] ?? [])].join("|"),
          value,
        ]),
      );
    }
  }

  const pack: ShapePack = {
    formatVersion: SHAPE_PACK_FORMAT_VERSION,
    source: {
      mod: "framedblocks",
      repository: "https://github.com/XFactHD/FramedBlocks",
      commit: gitCommit(checkout),
      modVersion: readModVersion(checkout),
      license: "LGPL-3.0",
    },
    blocks: Object.fromEntries(
      Object.entries(blocks).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  await writePack("framedblocks", pack);

  const uncovered = blockTypes.filter(
    (id) => blocks[`framedblocks:${id}`] === undefined,
  );
  process.stderr.write(
    `${uncovered.length} BlockType ids without a shape entry:\n`,
  );
  for (const id of uncovered) process.stdout.write(`framedblocks:${id}\n`);
}

/** Validates `pack` and writes it to `public/camo-shapes/<name>.json`. */
async function writePack(name: string, pack: ShapePack): Promise<void> {
  validateShapePack(pack);
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${name}.json`);
  // Prettier-formatted so `prettier --check` passes on the committed pack.
  const json = await format(JSON.stringify(compactPack(pack)), {
    parser: "json",
  });
  writeFileSync(outPath, json);

  const blockCount = Object.keys(pack.blocks).length;
  const rules = Object.values(pack.blocks).reduce((n, r) => n + r.length, 0);
  process.stderr.write(
    `Wrote ${outPath}: ${blockCount} blocks, ${rules} rules ` +
      `(${pack.source.mod} ${pack.source.modVersion} @ ${pack.source.commit.slice(0, 10)})\n`,
  );
}

/** Drops fields that `validateShapePack` defaults, to keep the pack small. */
function compactPack(pack: ShapePack): unknown {
  const all = DIRECTIONS.join(",");
  return {
    ...pack,
    blocks: Object.fromEntries(
      Object.entries(pack.blocks).map(([id, rules]) => [
        id,
        rules.map((rule) => ({
          ...rule,
          pieces: rule.pieces.map((piece) => {
            const out: Record<string, unknown> = {
              slot: piece.slot,
              select: piece.select,
            };
            if (piece.offset.some((n) => n !== 0)) out.offset = piece.offset;
            if (piece.transform.length > 0) out.transform = piece.transform;
            if (piece.cull.length > 0) out.cull = piece.cull;
            if (piece.faces.join(",") !== all) out.faces = piece.faces;
            if (piece.ops.length > 0) out.ops = piece.ops;
            if (piece.template !== undefined) out.template = piece.template;
            if (piece.whole) out.whole = true;
            if (piece.copyProperties) out.copyProperties = true;
            if (piece.model !== undefined) out.model = piece.model;
            return out;
          }),
        })),
      ]),
    ),
  };
}

// ── Copycats+ and Create ───────────────────────────────────────────────────

/**
 * Shape-pack stand-ins for the block classes the cores test the material
 * against (`MaterialCondition`: id suffixes, as vanilla names blocks by
 * kind). `IronBarsBlock` covers glass panes too; Create's bars special case
 * excludes them, as `CopycatSpecialCases.isBarsMaterial` does.
 */
const MATERIAL_CLASSES: Readonly<
  Record<MaterialClass, { suffixes: string[]; properties?: string[] }>
> = {
  BasePressurePlateBlock: { suffixes: ["_pressure_plate"] },
  ButtonBlock: { suffixes: ["_button"] },
  DoorBlock: { suffixes: ["_door"] },
  FenceBlock: { suffixes: ["_fence"] },
  FenceGateBlock: { suffixes: ["_fence_gate"] },
  IronBarsBlock: { suffixes: ["_bars", "iron_bars", "_pane", "glass_pane"] },
  LadderBlock: { suffixes: ["ladder"] },
  TrapDoorBlock: { suffixes: ["trapdoor"] },
  WallBlock: { suffixes: ["_wall"] },
  "CopycatSpecialCases.isBarsMaterial": { suffixes: ["_bars", "iron_bars"] },
  "CopycatSpecialCases.isTrapdoorMaterial": {
    suffixes: ["trapdoor"],
    properties: ["half", "open", "facing"],
  },
};

const ROTATIONS = new Set([90, 180, 270]);

/** The ops an `AssemblyTransform` applies, in call order. */
function recordTransform(transform: AssemblyTransform): TransformOp[] {
  const ops: TransformOp[] = [];
  const rotate = (axis: "X" | "Y" | "Z", angle: number) => {
    const quarter = ((angle % 360) + 360) % 360;
    if (quarter === 0) return;
    if (!ROTATIONS.has(quarter)) throw new Error(`Bad rotation ${angle}`);
    ops.push(`rotate${axis}${quarter}` as TransformOp);
  };
  const recorder: Transformable = {
    rotateX: (angle) => (rotate("X", angle), recorder),
    rotateY: (angle) => (rotate("Y", angle), recorder),
    rotateZ: (angle) => (rotate("Z", angle), recorder),
    flipX: (flip) => (flip && ops.push("flipX"), recorder),
    flipY: (flip) => (flip && ops.push("flipY"), recorder),
    flipZ: (flip) => (flip && ops.push("flipZ"), recorder),
  };
  transform(recorder);
  return ops;
}

/** Rounds away float noise (the cores use values like 0.02 and 0.1). */
function tidy(n: number): number {
  return Math.round(n * 1e6) / 1e6 + 0;
}

function boxOf(select: MutableAABB): Box {
  return {
    from: [tidy(select.minX), tidy(select.minY), tidy(select.minZ)],
    to: [tidy(select.maxX), tidy(select.maxY), tidy(select.maxZ)],
  };
}

/**
 * Faces of the canonical box `from..to` that lie on the block boundary:
 * Copycats+ gives exactly those quads a cull face (`QuadAutoCull.BLOCK`).
 */
function boundaryFaces(from: Vec3, to: Vec3, faces: Direction[]): Direction[] {
  const onBoundary: Record<Direction, boolean> = {
    down: from[1] === 0,
    up: to[1] === 16,
    north: from[2] === 0,
    south: to[2] === 16,
    west: from[0] === 0,
    east: to[0] === 16,
  };
  return faces.filter((dir) => onBoundary[dir]);
}

/**
 * A render context recording each call as a shape piece in camo slot
 * `slot` (see `scripts/camo-shapes/copycats/assembly.ts`). `sameKind` is
 * set while the core runs for a material of its own kind, where
 * `assembleAll()` copies the camo's whole mesh.
 */
function recordingContext(
  slot: string,
  pieces: ShapePiece[],
  sameKind: { copyProperties: boolean } | null,
): CopycatRenderContext {
  return {
    assemblePiece(transform, offset, select, cullMask) {
      const box = boxOf(select);
      const move: Vec3 = [
        tidy(offset.x - select.minX),
        tidy(offset.y - select.minY),
        tidy(offset.z - select.minZ),
      ];
      const faces = MASK_DIRECTIONS.filter(
        ([bit]) => (cullMask & bit) === 0,
      ).map(([, dir]) => dir);
      const destFrom = box.from.map((n, i) => tidy(n + move[i])) as Vec3;
      const destTo = box.to.map((n, i) => tidy(n + move[i])) as Vec3;
      pieces.push({
        slot,
        select: box,
        offset: move,
        transform: recordTransform(transform),
        cull: boundaryFaces(destFrom, destTo, faces),
        faces,
        ops: [],
      });
    },
    assembleAll() {
      pieces.push({
        slot,
        select: FULL_CUBE,
        offset: [0, 0, 0],
        transform: [],
        cull: [...DIRECTIONS],
        faces: [...DIRECTIONS],
        ops: [],
        ...(sameKind === null
          ? {}
          : {
              whole: true,
              ...(sameKind.copyProperties ? { copyProperties: true } : {}),
            }),
      });
    },
    assembleModel(id, x, y, face) {
      if (!isDirection(face)) throw new Error(`Bad face ${face}`);
      pieces.push({
        slot,
        select: FULL_CUBE,
        offset: [0, 0, 0],
        transform: [],
        cull: [],
        faces: [...DIRECTIONS],
        ops: [],
        model: { id, x, y, face },
      });
    },
  };
}

/**
 * Rules for one copycat block: first one rule set per material class the
 * core tests (`material.is(...)`), each with a `material` condition, then
 * the rules for any other material.
 */
function copycatRules(id: string, spec: CopycatBlockSpec): ShapeRule[] {
  const tested = new Set<MaterialClass>();
  const piecesFor = (
    state: BlockState,
    keys: readonly string[],
    kind: MaterialClass | null,
  ) => {
    const pieces: ShapePiece[] = [];
    const fullState = { ...defaultState(spec), ...state };
    for (const key of keys) {
      const sameKind =
        kind === null
          ? null
          : { copyProperties: spec.core.copyPropertiesIf === kind };
      spec.core.emitCopycatQuads(
        key,
        fullState,
        recordingContext(key, pieces, sameKind),
        {
          is: (materialClass) => {
            tested.add(materialClass);
            return materialClass === kind;
          },
        },
      );
    }
    return pieces;
  };

  if (spec.parts !== undefined) {
    // One rule group per part: its rules only keep the properties it reads.
    const rules = spec.parts.flatMap((part) =>
      blockRules(spec.properties, (state) =>
        piecesFor(state, [part], null),
      ).map((rule): ShapeRule => ({ ...rule, group: part })),
    );
    if (tested.size > 0) {
      throw new Error(`${id}: multi-state cores can't test the material`);
    }
    return rules;
  }

  const rules = blockRules(spec.properties, (state) =>
    piecesFor(state, [MATERIAL_KEY], null),
  );
  const materialRules = [...tested].flatMap((kind) =>
    blockRules(spec.properties, (state) =>
      piecesFor(state, [MATERIAL_KEY], kind),
    ).map(
      (rule): ShapeRule => ({
        ...(rule.when === undefined ? {} : { when: rule.when }),
        material: { slot: MATERIAL_KEY, ...MATERIAL_CLASSES[kind] },
        pieces: rule.pieces,
      }),
    ),
  );
  return [...materialRules, ...rules];
}

/** Block ids `REGISTRATE.block("<name>", ...)` registers in `file`. */
function registratedIds(file: string, namespace: string): string[] {
  const source = readFileSync(file, "utf-8");
  return [...source.matchAll(/REGISTRATE\.block\("([a-z0-9_]+)"/g)].map(
    (m) => `${namespace}:${m[1]}`,
  );
}

/** `BLOCKS` of every core port in `scripts/camo-shapes/copycats/`. */
async function copycatSpecs(): Promise<Record<string, CopycatBlockSpec>> {
  const dir = join(HERE, "camo-shapes/copycats");
  const specs: Record<string, CopycatBlockSpec> = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".ts") || file === "assembly.ts") continue;
    const port = (await import(join(dir, file))) as {
      BLOCKS?: Record<string, CopycatBlockSpec>;
    };
    for (const [id, spec] of Object.entries(port.BLOCKS ?? {})) {
      if (specs[id] !== undefined) throw new Error(`${id} is in two ports`);
      specs[id] = spec;
    }
  }
  return specs;
}

function readGradleVersion(checkout: string): string {
  const props = readFileSync(join(checkout, "gradle.properties"), "utf-8");
  const match = /^mod_version\s*=\s*(\S+)/m.exec(props);
  if (match !== null) return match[1];
  // Copycats+ keeps its version in the git tags (`v<version>...`).
  return execSync(`git -C "${checkout}" describe --tags --always`, {
    encoding: "utf-8",
  })
    .trim()
    .replace(/^v/, "");
}

/**
 * Writes the pack for `mod` from `specs` and prints the ids in `allIds`
 * that have no entry.
 */
async function generateCopycatPack(options: {
  mod: string;
  checkout: string;
  repository: string;
  license: string;
  specs: Readonly<Record<string, CopycatBlockSpec>>;
  allIds: string[];
  /** Registered blocks that aren't copycats (no block entity). */
  notCopycats: string[];
}): Promise<void> {
  const { mod, checkout, specs, allIds } = options;
  const known = new Set(allIds);
  const blocks: Record<string, ShapeRule[]> = {};
  for (const [id, spec] of Object.entries(specs)) {
    if (!known.has(id)) throw new Error(`${id} is not a registered block`);
    blocks[id] = copycatRules(id, spec);
  }
  await writePack(mod, {
    formatVersion: SHAPE_PACK_FORMAT_VERSION,
    source: {
      mod,
      repository: options.repository,
      commit: gitCommit(checkout),
      modVersion: readGradleVersion(checkout),
      license: options.license,
    },
    blocks: Object.fromEntries(
      Object.entries(blocks).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
  const uncovered = allIds.filter(
    (id) => blocks[id] === undefined && !options.notCopycats.includes(id),
  );
  process.stderr.write(
    `${uncovered.length} ${mod} ids without a shape entry:\n`,
  );
  for (const id of uncovered) process.stdout.write(`${id}\n`);
}

async function generateCopycats(): Promise<void> {
  const checkout = findCheckout("COPYCATS_PATH", "copycats");
  process.stderr.write(`Copycats+: ${checkout}\n`);
  await generateCopycatPack({
    mod: "copycats",
    checkout,
    repository: "https://github.com/copycats-plus/copycats",
    // All rights reserved; the pack ships with the authors' permission.
    license: "LicenseRef-All-Rights-Reserved",
    specs: await copycatSpecs(),
    allIds: registratedIds(
      join(
        checkout,
        "common/src/main/java/com/copycatsplus/copycats/CCBlocks.java",
      ),
      "copycats",
    ),
    notCopycats: ["copycats:copycat_base"],
  });
}

async function generateCreate(): Promise<void> {
  const checkout = findCheckout("CREATE_PATH", "Create");
  process.stderr.write(`Create: ${checkout}\n`);
  await generateCopycatPack({
    mod: "create",
    checkout,
    repository: "https://github.com/Creators-of-Create/Create",
    // The code license; the pack is derived from Create's Java, not assets.
    license: "MIT",
    specs: CREATE_BLOCKS,
    allIds: registratedIds(
      join(checkout, "src/main/java/com/simibubi/create/AllBlocks.java"),
      "create",
    ).filter((id) => id.startsWith("create:copycat_")),
    notCopycats: ["create:copycat_base"],
  });
}

await generateFramedBlocks();
await generateCopycats();
await generateCreate();
