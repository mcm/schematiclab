// Copycats+ `content/copycat/door/`: CopycatDoorModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatDoorBlock (vanilla DoorBlock, plus `ct`).

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
  type BlockState,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";

/** CopycatDoorModelCore. */
export const CopycatDoorModelCore: ModelCore = {
  copyPropertiesIf: "DoorBlock",
  emitCopycatQuads(_key, state, context, material) {
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

function assembleWithCT(
  state: BlockState,
  context: CopycatRenderContext,
): void {
  const rot = toYRot(state.facing);
  const rightHinge = state.hinge === "right";
  const half = state.half;
  const open = state.open === "true";
  let transform: AssemblyTransform = (t) => t.rotateY(rot);
  if (half === "lower") {
    if (!open) {
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
        cull(SOUTH | DOWN),
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
        cull(NORTH | DOWN),
      );
    } else {
      if (!rightHinge) {
        transform = (t) => t.flipX(true).rotateY(rot);
      }
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(2, 12, 16),
        cull(EAST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(0, 12, 0),
        aabb(2, 4, 16).move(0, 4, 0),
        cull(EAST | DOWN),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(2, 0, 0),
        aabb(1, 12, 16).move(15, 0, 0),
        cull(WEST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(2, 12, 0),
        aabb(1, 4, 16).move(15, 4, 0),
        cull(WEST | DOWN),
      );
    }
  } else {
    if (!open) {
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
        cull(SOUTH | UP),
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
        cull(NORTH | UP),
      );
    } else {
      if (!rightHinge) {
        transform = (t) => t.flipX(true).rotateY(rot);
      }
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 4, 0),
        aabb(2, 12, 16).move(0, 4, 0),
        cull(EAST | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(2, 4, 16).move(0, 8, 0),
        cull(EAST | UP),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(2, 4, 0),
        aabb(1, 12, 16).move(15, 4, 0),
        cull(WEST | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(2, 0, 0),
        aabb(1, 4, 16).move(15, 8, 0),
        cull(WEST | UP),
      );
    }
  }
}

function assembleWithoutCT(
  state: BlockState,
  context: CopycatRenderContext,
): void {
  const rot = toYRot(state.facing);
  const rightHinge = state.hinge === "right";
  const half = state.half;
  const open = state.open === "true";
  let transform: AssemblyTransform = (t) => t.rotateY(rot);
  if (half === "lower") {
    if (!open) {
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 16, 2),
        cull(SOUTH),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(0, 0, 2),
        aabb(16, 16, 1).move(0, 0, 15),
        cull(NORTH),
      );
    } else {
      if (!rightHinge) {
        transform = (t) => t.flipX(true).rotateY(rot);
      }
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(2, 16, 16),
        cull(EAST),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(2, 0, 0),
        aabb(1, 16, 16).move(15, 0, 0),
        cull(WEST),
      );
    }
  } else {
    if (!open) {
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 16, 2).move(0, 0, 0),
        cull(SOUTH),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(0, 0, 2),
        aabb(16, 16, 1).move(0, 0, 15),
        cull(NORTH),
      );
    } else {
      if (!rightHinge) {
        transform = (t) => t.flipX(true).rotateY(rot);
      }
      //Front
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(2, 16, 16).move(0, 0, 0),
        cull(EAST),
      );
      //Back
      context.assemblePiece(
        transform,
        vec3(2, 0, 0),
        aabb(1, 16, 16).move(15, 0, 0),
        cull(WEST),
      );
    }
  }
}

const DOOR_PROPERTIES = {
  facing: ["north", "south", "west", "east"],
  half: ["lower", "upper"],
  hinge: ["left", "right"],
  open: ["false", "true"],
  ct: ["true", "false"],
} as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_door": {
    core: CopycatDoorModelCore,
    properties: DOOR_PROPERTIES,
  },
  "copycats:copycat_iron_door": {
    core: CopycatDoorModelCore,
    properties: DOOR_PROPERTIES,
  },
};
