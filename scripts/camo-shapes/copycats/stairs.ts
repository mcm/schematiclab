// Copycats+ `content/copycat/stairs/`: CopycatStairsModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatStairsBlock and its vanilla superclass StairBlock.
// The static assemble helpers are exported for vertical_stairs.ts.

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";

/** CopycatStairsModelCore. */
export const CopycatStairsModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const enhanced = true;
    const facing = toYRot(state.facing);
    const top = state.half === "top";
    const shape = state.shape;

    switch (shape) {
      case "straight": {
        const transform: AssemblyTransform = (t) =>
          t.rotateY(facing).flipY(top);
        assembleStraight(context, transform, enhanced);
        break;
      }
      case "inner_left":
      case "inner_right": {
        const flipX = shape === "inner_right";
        const transform: AssemblyTransform = (t) =>
          t.flipX(flipX).rotateY(facing).flipY(top);
        assembleInnerLeft(context, transform, enhanced);
        break;
      }
      case "outer_left":
      case "outer_right": {
        const flipX = shape === "outer_right";
        const transform: AssemblyTransform = (t) =>
          t.flipX(flipX).rotateY(facing).flipY(top);
        assembleOuterLeft(context, transform, enhanced);
        break;
      }
    }
  },
};

/** CopycatStairsModelCore.assembleStraight. */
export function assembleStraight(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  enhanced: boolean,
): void {
  if (enhanced) {
    context.assemblePiece(
      transform,
      vec3(0, 4, 12),
      aabb(16, 12, 4).move(0, 4, 12),
      cull(NORTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 8, 8),
      aabb(16, 8, 2).move(0, 8, 0),
      cull(SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 7, 8),
      aabb(16, 1, 2).move(0, 7, 0),
      cull(NORTH | SOUTH | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 5, 10),
      aabb(16, 11, 2).move(0, 5, 2),
      cull(NORTH | SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, 4, 16).move(0, 0, 0),
      cull(UP),
    );
    context.assemblePiece(
      transform,
      vec3(0, 7, 0),
      aabb(16, 1, 8).move(0, 15, 0),
      cull(SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 5, 0),
      aabb(16, 2, 10).move(0, 13, 0),
      cull(SOUTH | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(16, 1, 12).move(0, 12, 0),
      cull(SOUTH | UP | DOWN),
    );
  } else {
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, 4, 8),
      cull(UP | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(16, 4, 8).move(0, 12, 0),
      cull(DOWN | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 8),
      aabb(16, 8, 8).move(0, 0, 8),
      cull(UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 8, 8),
      aabb(16, 8, 4).move(0, 8, 0),
      cull(DOWN | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 8, 12),
      aabb(16, 8, 4).move(0, 8, 12),
      cull(DOWN | NORTH),
    );
  }
}

/** CopycatStairsModelCore.assembleInnerLeft. */
export function assembleInnerLeft(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  enhanced: boolean,
): void {
  if (enhanced) {
    context.assemblePiece(
      transform,
      vec3(0, 4, 12),
      aabb(16, 12, 4).move(0, 4, 12),
      cull(NORTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(12, 4, 0),
      aabb(4, 12, 12).move(12, 4, 0),
      cull(SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, 4, 16).move(0, 0, 0),
      cull(UP),
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(12, 1, 12).move(0, 12, 0),
      cull(EAST | SOUTH | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 5, 0),
      aabb(10, 2, 10).move(0, 13, 0),
      cull(EAST | SOUTH | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 7, 0),
      aabb(8, 1, 8).move(0, 15, 0),
      cull(EAST | SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 8, 8),
      aabb(8, 8, 2).move(0, 8, 0),
      cull(EAST | SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 8),
      aabb(1, 8, 2).move(8, 8, 0),
      cull(NORTH | EAST | SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(9, 8, 8),
      aabb(1, 8, 2).move(1, 8, 8),
      cull(NORTH | EAST | SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 5, 10),
      aabb(11, 11, 2).move(0, 5, 2),
      cull(NORTH | EAST | SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 7, 8),
      aabb(10, 1, 2).move(0, 7, 0),
      cull(NORTH | EAST | SOUTH | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 7, 0),
      aabb(2, 1, 8).move(0, 7, 0),
      cull(EAST | SOUTH | WEST | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 0),
      aabb(2, 8, 8).move(0, 8, 0),
      cull(EAST | SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(10, 5, 0),
      aabb(2, 11, 10).move(2, 5, 0),
      cull(EAST | SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(11, 5, 10),
      aabb(1, 11, 2).move(3, 5, 10),
      cull(NORTH | EAST | SOUTH | WEST | DOWN),
    );
  } else {
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(8, 4, 8),
      cull(UP | SOUTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(8, 4, 8).move(0, 12, 0),
      cull(DOWN | SOUTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 8),
      aabb(16, 8, 8).move(0, 0, 8),
      cull(UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 8),
      aabb(8, 8, 8).move(8, 8, 8),
      cull(DOWN | NORTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(0, 8, 12),
      aabb(8, 8, 4).move(0, 8, 12),
      cull(DOWN | NORTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(0, 8, 8),
      aabb(8, 8, 4).move(0, 8, 0),
      cull(DOWN | SOUTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(12, 8, 0),
      aabb(4, 8, 8).move(12, 8, 0),
      cull(DOWN | SOUTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 0),
      aabb(4, 8, 8).move(0, 8, 0),
      cull(DOWN | SOUTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 0, 0),
      aabb(8, 8, 8).move(8, 0, 0),
      cull(UP | SOUTH | WEST),
    );
  }
}

/** CopycatStairsModelCore.assembleOuterLeft. */
export function assembleOuterLeft(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  enhanced: boolean,
): void {
  if (enhanced) {
    context.assemblePiece(
      transform,
      vec3(12, 4, 12),
      aabb(4, 12, 4).move(12, 4, 12),
      cull(NORTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(12, 8, 8),
      aabb(4, 8, 1).move(12, 8, 0),
      cull(SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(12, 6, 9),
      aabb(4, 10, 2).move(12, 6, 1),
      cull(NORTH | SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(12, 4, 11),
      aabb(4, 12, 1).move(12, 4, 3),
      cull(NORTH | SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 12),
      aabb(1, 8, 4).move(0, 8, 12),
      cull(NORTH | EAST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(9, 6, 12),
      aabb(2, 10, 4).move(1, 6, 12),
      cull(NORTH | EAST | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(11, 4, 12),
      aabb(1, 12, 4).move(3, 4, 12),
      cull(NORTH | EAST | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 8),
      aabb(4, 8, 4).move(0, 8, 0),
      cull(EAST | SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, 4, 16).move(0, 0, 0),
      cull(UP),
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(8, 4, 8).move(0, 12, 0),
      cull(EAST | SOUTH | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 6, 0),
      aabb(8, 2, 8).move(8, 14, 0),
      cull(SOUTH | WEST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 4, 0),
      aabb(8, 2, 11).move(8, 12, 0),
      cull(SOUTH | WEST | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 6, 8),
      aabb(8, 2, 1).move(8, 14, 8),
      cull(NORTH | SOUTH | WEST | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 6, 8),
      aabb(8, 2, 8).move(0, 14, 8),
      cull(NORTH | EAST | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 8),
      aabb(11, 2, 8).move(0, 12, 8),
      cull(NORTH | EAST | UP | DOWN),
    );
    context.assemblePiece(
      transform,
      vec3(8, 6, 8),
      aabb(1, 2, 8).move(8, 14, 8),
      cull(NORTH | EAST | WEST | UP | DOWN),
    );
  } else {
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(8, 4, 16).move(0, 0, 0),
      cull(UP | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(8, 4, 16).move(0, 12, 0),
      cull(DOWN | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 0, 0),
      aabb(8, 4, 8).move(8, 0, 0),
      cull(UP | SOUTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 4, 0),
      aabb(8, 4, 8).move(8, 12, 0),
      cull(DOWN | SOUTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 0, 8),
      aabb(8, 8, 8).move(8, 0, 8),
      cull(UP | NORTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(12, 8, 12),
      aabb(4, 8, 4).move(12, 8, 12),
      cull(DOWN | NORTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 12),
      aabb(4, 8, 4).move(0, 8, 12),
      cull(DOWN | NORTH | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(12, 8, 8),
      aabb(4, 8, 4).move(12, 8, 0),
      cull(DOWN | SOUTH | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 8),
      aabb(4, 8, 4).move(0, 8, 0),
      cull(DOWN | SOUTH | EAST),
    );
  }
}

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_stairs": {
    core: CopycatStairsModelCore,
    properties: {
      facing: ["north", "south", "west", "east"],
      half: ["bottom", "top"],
      shape: [
        "straight",
        "inner_left",
        "inner_right",
        "outer_left",
        "outer_right",
      ],
    },
  },
};
