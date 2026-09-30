// Copycats+ `content/copycat/vertical_step/`: CopycatVerticalStepModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatVerticalStepBlock.

import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  aabb,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatVerticalStepModelCore. */
export const CopycatVerticalStepModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const facing = state.facing;

    const transform: AssemblyTransform = (t) => t.rotateY(toYRot(facing));

    context.assemblePiece(
      transform,
      vec3(8, 0, 8),
      aabb(4, 16, 4),
      cull(EAST | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(12, 0, 8),
      aabb(4, 16, 4).move(12, 0, 0),
      cull(WEST | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(8, 0, 12),
      aabb(4, 16, 4).move(0, 0, 12),
      cull(EAST | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(12, 0, 12),
      aabb(4, 16, 4).move(12, 0, 12),
      cull(WEST | NORTH),
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_vertical_step": {
    core: CopycatVerticalStepModelCore,
    properties: {
      facing: ["north", "east", "south", "west"],
    },
  },
};
