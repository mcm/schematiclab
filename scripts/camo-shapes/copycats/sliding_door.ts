// Copycats+ `content/copycat/sliding_door/`: CopycatSlidingDoorModelCore and
// CopycatFoldingDoorModelCore, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatSlidingDoorBlock (Create's SlidingDoorBlock, a vanilla DoorBlock,
// plus `visible` and `ct`).
//
// In-game an open (or animating) door is drawn by CopycatSlidingDoorRenderer;
// only what the cores emit per block state is ported. With `visible` false
// the static model is empty.

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  FALSE_AND_TRUE,
  aabb,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type BlockState,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";

/** CopycatSlidingDoorModelCore. */
export function CopycatSlidingDoorModelCore(kinetic: boolean): ModelCore {
  function assembleWithCT(
    state: BlockState,
    context: CopycatRenderContext,
  ): void {
    const rot = toYRot(state.facing);
    const half = state.half;
    const transform: AssemblyTransform = (t) => t.rotateY(rot);
    if (half === "lower") {
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 12, 2),
        cull(SOUTH | UP),
      );
      context.assemblePiece(
        transform,
        vec3(0, 12, 0),
        aabb(16, 4, 2).move(0, 4, 0),
        cull(SOUTH | DOWN | (kinetic ? UP : 0)),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(0, 0, 2),
        aabb(16, 12, 1).move(0, 0, 15),
        cull(NORTH | UP),
      );
      context.assemblePiece(
        transform,
        vec3(0, 12, 2),
        aabb(16, 4, 1).move(0, 4, 15),
        cull(NORTH | DOWN | (kinetic ? UP : 0)),
      );
    } else {
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 4, 0),
        aabb(16, 12, 2).move(0, 4, 0),
        cull(SOUTH | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 4, 2).move(0, 8, 0),
        cull(SOUTH | UP | (kinetic ? DOWN : 0)),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(0, 4, 2),
        aabb(16, 12, 1).move(0, 4, 15),
        cull(NORTH | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, 2),
        aabb(16, 4, 1).move(0, 8, 15),
        cull(NORTH | UP | (kinetic ? DOWN : 0)),
      );
    }
  }

  function assembleWithoutCT(
    state: BlockState,
    context: CopycatRenderContext,
  ): void {
    const rot = toYRot(state.facing);
    const half = state.half;
    const transform: AssemblyTransform = (t) => t.rotateY(rot);
    if (half === "lower") {
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 16, 2),
        cull(SOUTH | (kinetic ? UP : 0)),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(0, 0, 2),
        aabb(16, 16, 1).move(0, 0, 15),
        cull(NORTH | (kinetic ? UP : 0)),
      );
    } else {
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 16, 2).move(0, 0, 0),
        cull(SOUTH | (kinetic ? DOWN : 0)),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(0, 0, 2),
        aabb(16, 16, 1).move(0, 0, 15),
        cull(NORTH | (kinetic ? DOWN : 0)),
      );
    }
  }

  return {
    copyPropertiesIf: "DoorBlock",
    emitCopycatQuads(_key, state, context, material) {
      if (!kinetic && state.visible !== "true") {
        return;
      }

      if (material.is("DoorBlock")) {
        context.assembleAll();
        return;
      }

      if (state.ct === "true") {
        assembleWithCT(state, context);
      } else {
        assembleWithoutCT(state, context);
      }
    },
  };
}

/**
 * CopycatFoldingDoorModelCore. Unlike the sliding door it has no
 * `updatePropertiesIfMatch` and no same-kind `assembleAll`.
 */
export function CopycatFoldingDoorModelCore(
  left: boolean,
  kinetic: boolean,
): ModelCore {
  const thisLeft = left;

  function assembleWithCT(
    state: BlockState,
    context: CopycatRenderContext,
  ): void {
    for (const left of FALSE_AND_TRUE) {
      if (kinetic && left !== thisLeft) continue;

      // The renderer handles rotation and left/right offset when animating
      // So transforms are only applied to the model when static
      const facing = state.facing;
      const rot = kinetic ? 270 : toYRot(facing);
      const offset = left || kinetic ? 8 : 0;

      const half = state.half;
      const transform: AssemblyTransform = (t) => t.rotateY(rot);
      if (half === "lower") {
        //Front
        context.assemblePiece(
          transform,
          vec3(offset, 0, 0),
          aabb(4, 12, 2).move(0, 0, 0),
          cull(SOUTH | UP | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 0),
          aabb(4, 12, 2).move(12, 0, 0),
          cull(SOUTH | UP | WEST),
        );
        context.assemblePiece(
          transform,
          vec3(offset, 12, 0),
          aabb(4, 4, 2).move(0, 4, 0),
          cull(SOUTH | DOWN | (kinetic ? UP : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 12, 0),
          aabb(4, 4, 2).move(12, 4, 0),
          cull(SOUTH | DOWN | (kinetic ? UP : 0) | WEST),
        );
        //Back
        context.assemblePiece(
          transform,
          vec3(offset, 0, 2),
          aabb(4, 12, 1).move(0, 0, 15),
          cull(NORTH | UP | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 2),
          aabb(4, 12, 1).move(12, 0, 15),
          cull(NORTH | UP | WEST),
        );
        context.assemblePiece(
          transform,
          vec3(offset, 12, 2),
          aabb(4, 4, 1).move(0, 4, 15),
          cull(NORTH | DOWN | (kinetic ? UP : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 12, 2),
          aabb(4, 4, 1).move(12, 4, 15),
          cull(NORTH | DOWN | (kinetic ? UP : 0) | WEST),
        );
      } else {
        //Front
        context.assemblePiece(
          transform,
          vec3(offset, 4, 0),
          aabb(4, 12, 2).move(0, 4, 0),
          cull(SOUTH | DOWN | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 4, 0),
          aabb(4, 12, 2).move(12, 4, 0),
          cull(SOUTH | DOWN | WEST),
        );
        context.assemblePiece(
          transform,
          vec3(offset, 0, 0),
          aabb(4, 4, 2).move(0, 8, 0),
          cull(SOUTH | UP | (kinetic ? DOWN : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 0),
          aabb(4, 4, 2).move(12, 8, 0),
          cull(SOUTH | UP | (kinetic ? DOWN : 0) | WEST),
        );
        //Back
        context.assemblePiece(
          transform,
          vec3(offset, 4, 2),
          aabb(4, 12, 1).move(0, 4, 15),
          cull(NORTH | DOWN | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 4, 2),
          aabb(4, 12, 1).move(12, 4, 15),
          cull(NORTH | DOWN | WEST),
        );
        context.assemblePiece(
          transform,
          vec3(offset, 0, 2),
          aabb(4, 4, 1).move(0, 8, 15),
          cull(NORTH | UP | (kinetic ? DOWN : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 2),
          aabb(4, 4, 1).move(12, 8, 15),
          cull(NORTH | UP | (kinetic ? DOWN : 0) | WEST),
        );
      }
    }
  }

  function assembleWithoutCT(
    state: BlockState,
    context: CopycatRenderContext,
  ): void {
    for (const left of FALSE_AND_TRUE) {
      if (kinetic && left !== thisLeft) continue;

      // The renderer handles rotation and left/right offset when animating
      // So transforms are only applied to the model when static
      const facing = state.facing;
      const rot = kinetic ? 270 : toYRot(facing);
      const offset = left || kinetic ? 8 : 0;

      const half = state.half;
      const transform: AssemblyTransform = (t) => t.rotateY(rot);
      if (half === "lower") {
        //Front
        context.assemblePiece(
          transform,
          vec3(offset, 0, 0),
          aabb(4, 16, 2).move(0, 0, 0),
          cull(SOUTH | (kinetic ? UP : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 0),
          aabb(4, 16, 2).move(12, 0, 0),
          cull(SOUTH | (kinetic ? UP : 0) | WEST),
        );
        //Back
        context.assemblePiece(
          transform,
          vec3(offset, 0, 2),
          aabb(4, 16, 1).move(0, 0, 15),
          cull(NORTH | (kinetic ? UP : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 2),
          aabb(4, 16, 1).move(12, 0, 15),
          cull(NORTH | (kinetic ? UP : 0) | WEST),
        );
      } else {
        //Front
        context.assemblePiece(
          transform,
          vec3(offset, 0, 0),
          aabb(4, 16, 2).move(0, 0, 0),
          cull(SOUTH | (kinetic ? DOWN : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 0),
          aabb(4, 16, 2).move(12, 0, 0),
          cull(SOUTH | (kinetic ? DOWN : 0) | WEST),
        );
        //Back
        context.assemblePiece(
          transform,
          vec3(offset, 0, 2),
          aabb(4, 16, 1).move(0, 0, 15),
          cull(NORTH | (kinetic ? DOWN : 0) | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(offset + 4, 0, 2),
          aabb(4, 16, 1).move(12, 0, 15),
          cull(NORTH | (kinetic ? DOWN : 0) | WEST),
        );
      }
    }
  }

  return {
    emitCopycatQuads(_key, state, context) {
      if (!kinetic && state.visible !== "true") {
        return;
      }
      if (state.ct === "true") {
        assembleWithCT(state, context);
      } else {
        assembleWithoutCT(state, context);
      }
    },
  };
}

const SLIDING_DOOR_PROPERTIES = {
  visible: ["true", "false"],
  facing: ["north", "south", "west", "east"],
  half: ["lower", "upper"],
  ct: ["true", "false"],
} as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_sliding_door": {
    core: CopycatSlidingDoorModelCore(false),
    properties: SLIDING_DOOR_PROPERTIES,
  },
  "copycats:copycat_folding_door": {
    core: CopycatFoldingDoorModelCore(false, false),
    properties: SLIDING_DOOR_PROPERTIES,
  },
};
