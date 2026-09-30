// Copycats+ `content/copycat/button/`: CopycatButtonModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatButtonBlock (vanilla ButtonBlock).

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
  type ModelCore,
} from "./assembly.ts";

/** CopycatButtonModelCore. */
export const CopycatButtonModelCore: ModelCore = {
  copyPropertiesIf: "ButtonBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("ButtonBlock")) {
      context.assembleAll();
      return;
    }

    const face = state.face;
    const rot = toYRot(state.facing);
    const pressed = state.powered === "true";
    switch (face) {
      case "wall": {
        const transform: AssemblyTransform = (t) => t.rotateY(rot);
        context.assemblePiece(
          transform,
          vec3(5, 6, pressed ? 0 : 1),
          aabb(3, 2, 1).move(1, 1, 1),
          cull(UP | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(5, 8, pressed ? 0 : 1),
          aabb(3, 2, 1).move(1, 13, 1),
          cull(DOWN | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(8, 8, pressed ? 0 : 1),
          aabb(3, 2, 1).move(12, 13, 1),
          cull(DOWN | WEST),
        );
        context.assemblePiece(
          transform,
          vec3(8, 6, pressed ? 0 : 1),
          aabb(3, 2, 1).move(12, 1, 1),
          cull(UP | WEST),
        );
        if (!pressed) {
          context.assemblePiece(
            transform,
            vec3(5, 6, 0),
            aabb(3, 2, 1),
            cull(SOUTH | UP | EAST),
          );
          context.assemblePiece(
            transform,
            vec3(5, 8, 0),
            aabb(3, 2, 1).move(0, 14, 0),
            cull(SOUTH | DOWN | EAST),
          );
          context.assemblePiece(
            transform,
            vec3(8, 8, 0),
            aabb(3, 2, 1).move(13, 14, 0),
            cull(SOUTH | DOWN | WEST),
          );
          context.assemblePiece(
            transform,
            vec3(8, 6, 0),
            aabb(3, 2, 1).move(13, 0, 0),
            cull(SOUTH | UP | WEST),
          );
        }
        break;
      }
      case "ceiling":
      case "floor": {
        const transform: AssemblyTransform = (t) =>
          t.rotateY(rot).flipY(face !== "floor");
        context.assemblePiece(
          transform,
          vec3(5, pressed ? 0 : 1, 6),
          aabb(3, 1, 2).move(1, 0, 1),
          cull(SOUTH | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(5, pressed ? 0 : 1, 8),
          aabb(3, 1, 2).move(1, 0, 13),
          cull(NORTH | EAST),
        );
        context.assemblePiece(
          transform,
          vec3(8, pressed ? 0 : 1, 6),
          aabb(3, 1, 2).move(12, 0, 1),
          cull(SOUTH | WEST),
        );
        context.assemblePiece(
          transform,
          vec3(8, pressed ? 0 : 1, 8),
          aabb(3, 1, 2).move(12, 0, 13),
          cull(NORTH | WEST),
        );
        if (!pressed) {
          context.assemblePiece(
            transform,
            vec3(5, 0, 6),
            aabb(3, 1, 2).move(0, 0, 0),
            cull(UP | SOUTH | EAST),
          );
          context.assemblePiece(
            transform,
            vec3(5, 0, 8),
            aabb(3, 1, 2).move(0, 0, 14),
            cull(UP | NORTH | EAST),
          );
          context.assemblePiece(
            transform,
            vec3(8, 0, 6),
            aabb(3, 1, 2).move(13, 0, 0),
            cull(UP | SOUTH | WEST),
          );
          context.assemblePiece(
            transform,
            vec3(8, 0, 8),
            aabb(3, 1, 2).move(13, 0, 14),
            cull(UP | NORTH | WEST),
          );
        }
        break;
      }
    }
  },
};

const BUTTON_PROPERTIES = {
  face: ["wall", "floor", "ceiling"],
  facing: ["north", "south", "west", "east"],
  powered: ["false", "true"],
} as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_wooden_button": {
    core: CopycatButtonModelCore,
    properties: BUTTON_PROPERTIES,
  },
  "copycats:copycat_stone_button": {
    core: CopycatButtonModelCore,
    properties: BUTTON_PROPERTIES,
  },
};
