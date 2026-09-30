// Copycats+ `content/copycat/slab/`: CopycatSlabModelCore and
// CopycatMultiSlabModelCore, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatSlabBlock.

import {
  DOWN,
  NORTH,
  SOUTH,
  UP,
  aabb,
  autoCull,
  axisOf,
  cull,
  isPositive,
  opposite,
  toYRot,
  vec3,
  type AssemblyTransform,
  type BlockState,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";

/** `Direction.fromAxisAndDirection`. */
function fromAxisAndDirection(axis: string, positive: boolean): string {
  if (axis === "x") return positive ? "east" : "west";
  if (axis === "z") return positive ? "south" : "north";
  return positive ? "up" : "down";
}

/** `CopycatSlabBlock.getApparentDirection`. */
function apparentDirection(state: BlockState): string {
  return fromAxisAndDirection(state.axis, state.type !== "bottom");
}

/** CopycatSlabModelCore (not registered to a block at 60923e0). */
export const CopycatSlabModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const facing = state.type !== undefined ? apparentDirection(state) : "up";
    const isDouble = (state.type ?? "bottom") === "double";

    assembleSlab(context, facing);
    if (isDouble) assembleSlab(context, opposite(facing));
  },
};

function assembleSlab(context: CopycatRenderContext, facing: string): void {
  if (axisOf(facing) !== "y") {
    const transform: AssemblyTransform = (t) => t.rotateY(toYRot(facing));
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, 16, 4),
      cull(SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 4),
      aabb(16, 16, 4).move(0, 0, 12),
      cull(NORTH),
    );
  } else {
    const transform: AssemblyTransform = (t) => t.flipY(!isPositive(facing));
    context.assemblePiece(transform, vec3(0, 0, 0), aabb(16, 4, 16), cull(UP));
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(16, 4, 16).move(0, 12, 0),
      cull(DOWN),
    );
  }
}

/** CopycatMultiSlabModelCore. */
export const CopycatMultiSlabModelCore: ModelCore = {
  emitCopycatQuads(key, state, context) {
    if (key === "top" && state.type === "bottom") return;
    if (key === "bottom" && state.type === "top") return;

    const facing = fromAxisAndDirection(state.axis, key === "bottom");

    if (axisOf(facing) !== "y") {
      const autoCullBox = autoCull(aabb(16, 16, 8));
      const transform: AssemblyTransform = (t) => t.rotateY(toYRot(facing));
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 16, 4),
        cull(SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, 4),
        aabb(16, 16, 4).move(0, 0, 12),
        cull(NORTH),
        autoCullBox,
      );
    } else {
      const autoCullBox = autoCull(aabb(16, 8, 16));
      const transform: AssemblyTransform = (t) => t.flipY(!isPositive(facing));
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 4, 16),
        cull(UP),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(0, 4, 0),
        aabb(16, 4, 16).move(0, 12, 0),
        cull(DOWN),
        autoCullBox,
      );
    }
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_slab": {
    core: CopycatMultiSlabModelCore,
    properties: {
      axis: ["y", "x", "z"],
      type: ["bottom", "top", "double"],
    },
    parts: ["bottom", "top"],
  },
};
