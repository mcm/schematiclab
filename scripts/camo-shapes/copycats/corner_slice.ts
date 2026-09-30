// Copycats+ `content/copycat/corner_slice/`: CopycatCornerSliceModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatCornerSliceBlock.

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  cull,
  range,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatCornerSliceModelCore. */
export const CopycatCornerSliceModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const flipY = state.half === "top";
    const rot = toYRot(state.facing);
    const layers = Number(state.layers);
    const transform: AssemblyTransform = (t) => t.rotateY(rot).flipY(flipY);
    context.assemblePiece(
      transform,
      vec3(16 - layers, 0, 16 - layers),
      aabb(layers, layers, layers).move(16 - layers, 0, 16 - layers),
      cull(UP | NORTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers * 2, 0, 16 - layers),
      aabb(layers, layers, layers).move(0, 0, 16 - layers),
      cull(UP | NORTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers, 0, 16 - layers * 2),
      aabb(layers, layers, layers).move(16 - layers, 0, 0),
      cull(UP | SOUTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers * 2, 0, 16 - layers * 2),
      aabb(layers, layers, layers).move(0, 0, 0),
      cull(UP | SOUTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers, layers, 16 - layers),
      aabb(layers, layers, layers).move(16 - layers, 16 - layers, 16 - layers),
      cull(DOWN | NORTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers * 2, layers, 16 - layers),
      aabb(layers, layers, layers).move(0, 16 - layers, 16 - layers),
      cull(DOWN | NORTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers, layers, 16 - layers * 2),
      aabb(layers, layers, layers).move(16 - layers, 16 - layers, 0),
      cull(DOWN | SOUTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers * 2, layers, 16 - layers * 2),
      aabb(layers, layers, layers).move(0, 16 - layers, 0),
      cull(DOWN | SOUTH | EAST),
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_corner_slice": {
    core: CopycatCornerSliceModelCore,
    properties: {
      facing: ["north", "east", "south", "west"],
      layers: range(1, 8),
      half: ["bottom", "top"],
    },
  },
};
