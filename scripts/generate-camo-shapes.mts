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
//       hand ports of the bespoke (non-templated) *Geometry.java classes
//   - public/minecraft-assets/models.json
//       vanilla models FramedBlocks uses as templates (slab, trapdoor, …)
//
// Output:
//   - public/camo-shapes/framedblocks.json
//
// Usage:
//   node --experimental-strip-types scripts/generate-camo-shapes.mts
//   (also wired up as `pnpm gen:camo-shapes`)
//
// Override the checkout location with FRAMEDBLOCKS_PATH (default
// ~/projects/FramedBlocks, then ../FramedBlocks next to this repo).

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
 * ported `transformQuad`. Quads sharing their ops merge into one piece.
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
  const quads: QuadPiece[] = [];
  for (const dir of DIRECTIONS) {
    if (fullFaces.has(dir)) quads.push({ face: dir, ops: [], cull: true });
    if (!fullFaces.has(dir) || spec.transformAllQuads) {
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
  validateShapePack(pack);

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "framedblocks.json");
  // Prettier-formatted so `prettier --check` passes on the committed pack.
  const json = await format(JSON.stringify(compactPack(pack)), {
    parser: "json",
  });
  writeFileSync(outPath, json);

  const rules = Object.values(blocks).reduce((n, r) => n + r.length, 0);
  process.stderr.write(
    `Wrote ${outPath}: ${Object.keys(blocks).length} blocks, ${rules} rules ` +
      `(FramedBlocks ${pack.source.modVersion} @ ${pack.source.commit.slice(0, 10)})\n`,
  );
  const uncovered = blockTypes.filter(
    (id) => blocks[`framedblocks:${id}`] === undefined,
  );
  process.stderr.write(
    `${uncovered.length} BlockType ids without a shape entry:\n`,
  );
  for (const id of uncovered) process.stdout.write(`framedblocks:${id}\n`);
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
            return out;
          }),
        })),
      ]),
    ),
  };
}

await generateFramedBlocks();
