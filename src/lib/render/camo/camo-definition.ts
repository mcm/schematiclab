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
// Rules may also test the camo (`material`, e.g. Create's panel with an iron
// bars or trapdoor material), copy the camo's whole mesh (`whole`), mesh the
// camo with the block's own property values (`copyProperties`) or render a
// block model retextured with the camo (`model`, Create's copycat bars), or
// render a block state as is (`block`, the rail on FramedBlocks' rail slopes).
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

import type { CamoSlot, CamoState } from "../../camo/extract";
import { MISSING_TEXTURE_ID } from "../atlas-layout";
import {
  boundaryFaceDirection,
  buildCamoMesh,
  transformBox,
  transformVector,
} from "./mesh-crop";
import { CAMO_PROPERTY, type CamoTable } from "./camo-table";
import {
  DIRECTIONS,
  matchShapeRule,
  type Box,
  type Direction,
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
 * axes. Sloped, `whole`, `model` and `block` pieces never count.
 */
export function coversFullCube(rule: ShapeRule): boolean {
  const cached = ruleCoversCube.get(rule);
  if (cached !== undefined) return cached;
  const boxes = rule.pieces
    .filter(
      (p) =>
        p.ops.length === 0 &&
        p.faces.length === DIRECTIONS.length &&
        !p.whole &&
        p.model === undefined &&
        p.block === undefined,
    )
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
  private readonly camoTextures = new Map<string, string | null>();

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
    const entry = this.context.getTable()?.get(props[CAMO_PROPERTY]);
    const slots = entry?.slots ?? [];
    const rule = this.rules && matchShapeRule(this.rules, props, slots);
    if (rule === null) return modelMesh(this.frameCube, atlas, cull);
    const slotMesh = (slotName: string, piece: ShapePiece) =>
      this.slotMesh(
        slots.find((s) => s.slot === slotName),
        slotName,
        piece.copyProperties ? props : null,
        atlas,
        blockModelProvider,
      );
    const mesh = buildCamoMesh(rule.pieces, slotMesh, cull);
    for (const piece of rule.pieces) {
      if (piece.block !== undefined) {
        mesh.merge(this.blockPieceMesh(piece, atlas, blockModelProvider, cull));
      }
      if (piece.model === undefined) continue;
      mesh.merge(
        this.modelPieceMesh(
          piece,
          slots.find((s) => s.slot === piece.slot),
          atlas,
          blockModelProvider,
          cull,
        ),
      );
    }
    return mesh;
  }

  /**
   * Whether a block with these properties and slots hides its whole cell:
   * its shape fills the cube and every slot it shows holds an opaque block.
   */
  isOpaque(
    properties: Readonly<Record<string, string>>,
    slots: readonly CamoSlot[],
  ): boolean {
    const rule = this.rules && matchShapeRule(this.rules, properties, slots);
    if (rule === null || !coversFullCube(rule)) return false;
    return rule.pieces.every((piece) => {
      if (piece.block !== undefined) return true;
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
    blockProps: Readonly<Record<string, string>> | null,
    atlas: TextureAtlasProvider,
    blockModelProvider: BlockModelProvider,
  ): Mesh {
    let state = slot?.kind === "empty" ? null : (slot?.state ?? null);
    if (state !== null && blockProps !== null && slot?.kind === "block") {
      state = copyProperties(state, blockProps);
    }
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
      mesh = modelMesh(cubeModel(fluidTexture(state.name)), atlas, {});
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

  /** A `block` piece: the block state's own mesh, unchanged. */
  private blockPieceMesh(
    piece: ShapePiece,
    atlas: TextureAtlasProvider,
    blockModelProvider: BlockModelProvider,
    cull: Cull,
  ): Mesh {
    const { name, properties } = piece.block!;
    try {
      return this.context
        .getBlockDefinition(name)
        .getMesh(
          Identifier.parse(name),
          { ...properties },
          atlas,
          blockModelProvider,
          cull,
        );
    } catch {
      return new Mesh();
    }
  }

  /**
   * A `model` piece: the model, rotated like a blockstate variant, with
   * every texture swapped for the camo's texture on `piece.model.face`
   * (Create's `CopycatBarsModel`). An empty slot keeps the model's own
   * textures, as Create renders the original model without a material.
   */
  private modelPieceMesh(
    piece: ShapePiece,
    slot: CamoSlot | undefined,
    atlas: TextureAtlasProvider,
    blockModelProvider: BlockModelProvider,
    cull: Cull,
  ): Mesh {
    const { id, x, y, face } = piece.model!;
    const texture =
      slot === undefined || slot.state === null || slot.kind === "empty"
        ? null
        : slot.kind === "fluid"
          ? fluidTexture(slot.state.name)
          : this.camoTexture(slot.state, face, atlas, blockModelProvider);
    const retextured: TextureAtlasProvider =
      texture === null
        ? atlas
        : {
            getTextureAtlas: () => atlas.getTextureAtlas(),
            getTextureUV: () => atlas.getTextureUV(Identifier.parse(texture)),
          };
    try {
      return BlockDefinition.fromJson({
        variants: { "": { model: id, x, y } },
      }).getMesh(undefined, {}, retextured, blockModelProvider, cull);
    } catch {
      return new Mesh();
    }
  }

  /**
   * The texture id on the `face` side of the camo's model (the first face
   * quad pointing that way, else the first quad), or null if it has none.
   * Found by meshing the camo with an atlas that gives each texture its own
   * UV cell, then reading the cell back from the quad.
   */
  private camoTexture(
    state: CamoState,
    face: Direction,
    atlas: TextureAtlasProvider,
    blockModelProvider: BlockModelProvider,
  ): string | null {
    const key = `${face}|${JSON.stringify(state)}`;
    const cached = this.camoTextures.get(key);
    if (cached !== undefined) return cached;
    const ids: string[] = [];
    const recorder: TextureAtlasProvider = {
      getTextureAtlas: () => atlas.getTextureAtlas(),
      getTextureUV: (texture) => {
        let index = ids.indexOf(texture.toString());
        if (index === -1) index = ids.push(texture.toString()) - 1;
        return [index, 0, index + 1, 1];
      },
    };
    let texture: string | null = null;
    try {
      const quads = this.context
        .getBlockDefinition(state.name)
        .getMesh(
          Identifier.parse(state.name),
          state.properties,
          recorder,
          blockModelProvider,
          {},
        ).quads;
      const quad =
        quads.find((q) => boundaryFaceDirection(q) === face) ?? quads[0];
      const u = quad?.vertices().map((v) => v.texture?.[0] ?? 0);
      if (u !== undefined) {
        const cell = Math.floor((Math.min(...u) + Math.max(...u)) / 2);
        texture = ids[cell] ?? null;
      }
    } catch {
      texture = null;
    }
    this.camoTextures.set(key, texture);
    return texture;
  }
}

function fluidTexture(fluid: string): string {
  const id = Identifier.parse(fluid);
  return `${id.namespace}:block/${id.path}_still`;
}

/**
 * Copycats+ `BlockUtils.tryCopyProperties`: the camo with the block's value
 * for every property they share. The camo's own property list may be
 * incomplete (it's whatever the save holds), so every block property is
 * copied; blockstates ignore the ones the camo doesn't have.
 */
function copyProperties(
  state: CamoState,
  blockProps: Readonly<Record<string, string>>,
): CamoState {
  const properties = { ...state.properties, ...blockProps };
  delete properties[CAMO_PROPERTY];
  return { name: state.name, properties };
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
