// Copycats+ `content/copycat/half_panel/`: CopycatHalfPanelModelCore, ported
// from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatHalfPanelBlock.

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  axisOf,
  counterClockWise,
  cull,
  isPositive,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatHalfPanelModelCore. */
export const CopycatHalfPanelModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const facing = state.facing;
    const offset = state.offset;

    if (axisOf(facing) === "y") {
      const flipY = facing === "up";
      const rot = toYRot(offset);
      const transform: AssemblyTransform = (t) => t.rotateY(rot).flipY(flipY);
      context.assemblePiece(
        transform,
        vec3(0, 0, 12),
        aabb(16, 1, 4).move(0, 0, 12),
        cull(UP | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, 8),
        aabb(16, 1, 4).move(0, 0, 0),
        cull(UP | SOUTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 1, 12),
        aabb(16, 2, 4).move(0, 14, 12),
        cull(DOWN | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 1, 8),
        aabb(16, 2, 4).move(0, 14, 0),
        cull(DOWN | SOUTH),
      );
    } else if (axisOf(offset) === axisOf(facing)) {
      const flipY = isPositive(offset);
      const rot = toYRot(facing);
      const transform: AssemblyTransform = (t) => t.rotateY(rot).flipY(flipY);
      context.assemblePiece(
        transform,
        vec3(0, 0, 15),
        aabb(16, 4, 1).move(0, 0, 15),
        cull(UP | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 4, 15),
        aabb(16, 4, 1).move(0, 12, 15),
        cull(DOWN | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, 13),
        aabb(16, 4, 2).move(0, 0, 0),
        cull(UP | SOUTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 4, 13),
        aabb(16, 4, 2).move(0, 12, 0),
        cull(DOWN | SOUTH),
      );
    } else {
      const leftOffset = offset === counterClockWise(facing) ? 8 : 0;
      const rot = toYRot(facing);
      const transform: AssemblyTransform = (t) => t.rotateY(rot);
      context.assemblePiece(
        transform,
        vec3(leftOffset, 0, 15),
        aabb(4, 16, 1).move(0, 0, 15),
        cull(EAST | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(4 + leftOffset, 0, 15),
        aabb(4, 16, 1).move(12, 0, 15),
        cull(WEST | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(leftOffset, 0, 13),
        aabb(4, 16, 2).move(0, 0, 0),
        cull(EAST | SOUTH),
      );
      context.assemblePiece(
        transform,
        vec3(4 + leftOffset, 0, 13),
        aabb(4, 16, 2).move(12, 0, 0),
        cull(WEST | SOUTH),
      );
    }
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_half_panel": {
    core: CopycatHalfPanelModelCore,
    properties: {
      facing: ["north", "down", "up", "south", "west", "east"],
      offset: ["north", "east", "south", "west"],
    },
  },
};
