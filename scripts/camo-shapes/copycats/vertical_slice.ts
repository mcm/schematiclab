// Copycats+ `content/copycat/vertical_slice/`: CopycatVerticalSliceModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatVerticalSliceBlock.

import {
  EAST,
  NORTH,
  SOUTH,
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

/** CopycatVerticalSliceModelCore. */
export const CopycatVerticalSliceModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const rot = toYRot(state.facing);
    const layers = Number(state.layers);
    const transform: AssemblyTransform = (t) => t.rotateY(rot);
    context.assemblePiece(
      transform,
      vec3(16 - layers, 0, 16 - layers),
      aabb(layers, 16, layers).move(16 - layers, 0, 16 - layers),
      cull(WEST | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers, 0, 16 - layers * 2),
      aabb(layers, 16, layers).move(16 - layers, 0, 0),
      cull(WEST | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers * 2, 0, 16 - layers),
      aabb(layers, 16, layers).move(0, 0, 16 - layers),
      cull(EAST | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(16 - layers * 2, 0, 16 - layers * 2),
      aabb(layers, 16, layers).move(0, 0, 0),
      cull(EAST | SOUTH),
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_vertical_slice": {
    core: CopycatVerticalSliceModelCore,
    properties: {
      facing: ["north", "east", "south", "west"],
      layers: range(1, 8),
    },
  },
};
