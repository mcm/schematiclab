// deepslate `BlockDefinition` for camo-capable blocks (FramedBlocks, Create
// and Copycats+ copycats): builds each camo slot's full-cube mesh through the
// normal resources (the camo's own blockstate variant, with tints) and cuts
// the block's shape out of it with the mesh engine (`mesh-crop.ts`).
//
// The camo comes from the block's synthetic `__camo` property
// (`camo-table.ts`). Fallbacks:
//   - no shape rule for the block or state: a full cube of the frame texture
//   - empty camo slot (or no camo data): the shape in the frame texture
//     (`framed_block`, `framed_block_alt` for FramedBlocks' second slot,
//     `create:block/copycat_base` for copycats)
//   - unknown camo block: the shape in the missing texture, since unknown
//     ids resolve to the placeholder cube
//
// Uses only deepslate's public API; deepslate itself is unchanged.

import {
  BlockDefinition,
  BlockModel,
  Identifier,
  Mesh,
  type BlockFlags,
  type BlockModelProvider,
  type Cull,
  type TextureAtlasProvider,
} from "deepslate";
import { mat4 } from "gl-matrix";

import type { CamoSlot } from "../../camo/extract";
import { MISSING_TEXTURE_ID } from "../atlas-layout";
import { buildCamoMesh, transformBox, transformVector } from "./mesh-crop";
import { CAMO_PROPERTY, type CamoTable } from "./camo-table";
import {
  DIRECTIONS,
  matchShapeRule,
  type Box,
  type ShapePiece,
  type ShapeRule,
} from "./shape-pack";

const FRAMED_TEXTURE = "framedblocks:block/framed_block";
const FRAMED_ALT_TEXTURE = "framedblocks:block/framed_block_alt";
const COPYCAT_TEXTURE = "create:block/copycat_base";

/** What camo definitions need from the surrounding resources. */
export interface CamoRenderContext {
  /** Definition used to mesh a camo block (unknown ids: the placeholder). */
  getBlockDefinition(id: string): BlockDefinition;
  /** Whether a camo block fills and hides its whole cell. */
  isOpaqueBlock(id: string): boolean;
  /** Table the current structure's `__camo` values index. */
  getTable(): CamoTable | null;
}

/** Texture of an empty camo slot on `blockId`. */
export function frameTexture(blockId: string, slot: string): string {
  if (!blockId.startsWith("framedblocks:")) return COPYCAT_TEXTURE;
  return slot === "camo_two" ? FRAMED_ALT_TEXTURE : FRAMED_TEXTURE;
}

const FULL_CUBE_FACES = Object.fromEntries(
  DIRECTIONS.map((dir) => [dir, { texture: "#all", cullface: dir }]),
);

function cubeModel(texture: string): BlockModel {
  return BlockModel.fromJson({
    textures: { all: texture },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: FULL_CUBE_FACES }],
  });
}

const PIXEL_SCALE = mat4.fromScaling(mat4.create(), [1 / 16, 1 / 16, 1 / 16]);

/** A model's mesh in block units, like `BlockDefinition.getMesh` returns. */
function modelMesh(
  model: BlockModel,
  atlas: TextureAtlasProvider,
  cull: Cull,
): Mesh {
  return model.getMesh(atlas, cull).transform(PIXEL_SCALE);
}

const ruleCoversCube = new WeakMap<ShapeRule, boolean>();

function pieceBox(piece: ShapePiece): Box {
  const box = transformBox(piece.select, piece.transform);
  const offset = transformVector(piece.offset, piece.transform);
  return {
    from: [
      box.from[0] + offset[0],
      box.from[1] + offset[1],
      box.from[2] + offset[2],
    ],
    to: [box.to[0] + offset[0], box.to[1] + offset[1], box.to[2] + offset[2]],
  };
}

/**
 * Whether the rule's pieces fill the whole block: the union of its
 * axis-aligned pieces (no quad ops, every face kept) covers 0..16 on all
 * axes. Sloped pieces never count.
 */
export function coversFullCube(rule: ShapeRule): boolean {
  const cached = ruleCoversCube.get(rule);
  if (cached !== undefined) return cached;
  const boxes = rule.pieces
    .filter((p) => p.ops.length === 0 && p.faces.length === DIRECTIONS.length)
    .map(pieceBox);
  // Check the centre of every cell of the grid the box edges make.
  const cuts = [0, 1, 2].map((axis) =>
    [...new Set([0, 16, ...boxes.flatMap((b) => [b.from[axis], b.to[axis]])])]
      .filter((n) => n >= 0 && n <= 16)
      .sort((a, b) => a - b),
  );
  const mids = cuts.map((axisCuts) =>
    axisCuts.slice(1).map((to, i) => (axisCuts[i] + to) / 2),
  );
  let covered = boxes.length > 0;
  for (const x of mids[0]) {
    for (const y of mids[1]) {
      for (const z of mids[2]) {
        if (!covered) break;
        const p = [x, y, z];
        covered = boxes.some((b) =>
          p.every((v, axis) => v > b.from[axis] && v < b.to[axis]),
        );
      }
    }
  }
  ruleCoversCube.set(rule, covered);
  return covered;
}

/**
 * Camo-capable block. `rules` are the block's shape-pack rules, or null
 * when no loaded pack covers it (then every state is a full frame cube).
 */
export class CamoBlockDefinition extends BlockDefinition {
  private readonly frameCube: BlockModel;
  // Full-cube source meshes per slot content. The engine never modifies
  // them, so they're shared between blocks.
  private readonly sourceMeshes = new Map<string, Mesh>();

  constructor(
    readonly blockId: string,
    private readonly rules: readonly ShapeRule[] | null,
    private readonly context: CamoRenderContext,
  ) {
    super(undefined, undefined);
    this.frameCube = cubeModel(frameTexture(blockId, "camo"));
  }

  override getModelVariants(): [] {
    return [];
  }

  override getMesh(
    _name: Identifier | undefined,
    props: { [key: string]: string },
    atlas: TextureAtlasProvider,
    blockModelProvider: BlockModelProvider,
    cull: Cull,
  ): Mesh {
    const rule = this.rules && matchShapeRule(this.rules, props);
    if (rule === null) return modelMesh(this.frameCube, atlas, cull);
    const entry = this.context.getTable()?.get(props[CAMO_PROPERTY]);
    const slots = entry?.slots ?? [];
    return buildCamoMesh(
      rule.pieces,
      (slot) =>
        this.slotMesh(
          slots.find((s) => s.slot === slot),
          slot,
          atlas,
          blockModelProvider,
        ),
      cull,
    );
  }

  /**
   * Whether a block with these properties and slots hides its whole cell:
   * its shape fills the cube and every slot it shows holds an opaque block.
   */
  isOpaque(
    properties: Readonly<Record<string, string>>,
    slots: readonly CamoSlot[],
  ): boolean {
    const rule = this.rules && matchShapeRule(this.rules, properties);
    if (rule === null || !coversFullCube(rule)) return false;
    return rule.pieces.every((piece) => {
      const slot = slots.find((s) => s.slot === piece.slot);
      return (
        slot?.kind === "block" &&
        slot.state !== null &&
        this.context.isOpaqueBlock(slot.state.name)
      );
    });
  }

  private slotMesh(
    slot: CamoSlot | undefined,
    slotName: string,
    atlas: TextureAtlasProvider,
    blockModelProvider: BlockModelProvider,
  ): Mesh {
    const state = slot?.kind === "empty" ? null : (slot?.state ?? null);
    const key =
      state === null
        ? `frame|${frameTexture(this.blockId, slotName)}`
        : `${slot?.kind}|${JSON.stringify(state)}`;
    const cached = this.sourceMeshes.get(key);
    if (cached !== undefined) return cached;

    let mesh: Mesh;
    if (state === null) {
      const texture = frameTexture(this.blockId, slotName);
      mesh = modelMesh(cubeModel(texture), atlas, {});
    } else if (slot?.kind === "fluid") {
      // Only the still texture: fluid rendering is out of scope.
      const fluid = Identifier.parse(state.name);
      const texture = `${fluid.namespace}:block/${fluid.path}_still`;
      mesh = modelMesh(cubeModel(texture), atlas, {});
    } else {
      const definition = this.context.getBlockDefinition(state.name);
      try {
        mesh = definition.getMesh(
          Identifier.parse(state.name),
          state.properties,
          atlas,
          blockModelProvider,
          {},
        );
      } catch {
        mesh = modelMesh(cubeModel(MISSING_TEXTURE_ID), atlas, {});
      }
    }
    this.sourceMeshes.set(key, mesh);
    return mesh;
  }
}

const flagsByTable = new WeakMap<
  CamoTable,
  WeakMap<CamoBlockDefinition, BlockFlags>
>();

/**
 * Flags for a camo-capable block id: opaque only when every placement of it
 * in `table` is (deepslate asks per id, not per state). Cached per table,
 * which doesn't change once the structure is built.
 */
export function camoBlockFlags(
  definition: CamoBlockDefinition,
  table: CamoTable | null,
): BlockFlags {
  if (table === null) return { opaque: false };
  let cache = flagsByTable.get(table);
  if (cache === undefined) {
    cache = new WeakMap();
    flagsByTable.set(table, cache);
  }
  let flags = cache.get(definition);
  if (flags === undefined) {
    const entries = table.entries.filter(
      (e) => e.blockId === definition.blockId,
    );
    flags = {
      opaque:
        entries.length > 0 &&
        entries.every((e) => definition.isOpaque(e.properties, e.slots)),
    };
    cache.set(definition, flags);
  }
  return flags;
}
