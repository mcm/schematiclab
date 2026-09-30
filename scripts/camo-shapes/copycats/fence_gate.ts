// Copycats+ `content/copycat/fence_gate/`: CopycatFenceGateModelCore, ported
// from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatFenceGateBlock (vanilla FenceGateBlock).

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
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatFenceGateModelCore. */
export const CopycatFenceGateModelCore: ModelCore = {
  copyPropertiesIf: "FenceGateBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("FenceGateBlock")) {
      context.assembleAll();
      return;
    }

    const offsetWall = state.in_wall === "true" ? -3 : 0;
    const rot = toYRot(state.facing);
    const transform: AssemblyTransform = (t) => t.rotateY(rot);

    // Assemble the poles
    for (const eastSide of FALSE_AND_TRUE) {
      const offsetX = eastSide ? 14 : 0;
      context.assemblePiece(
        transform,
        vec3(offsetX, 5 + offsetWall, 7),
        aabb(1, 6, 1),
        cull(UP | SOUTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(offsetX + 1, 5 + offsetWall, 7),
        aabb(1, 6, 1).move(15, 0, 0),
        cull(UP | SOUTH | WEST),
      );
      context.assemblePiece(
        transform,
        vec3(offsetX, 5 + offsetWall, 8),
        aabb(1, 6, 1).move(0, 0, 15),
        cull(UP | NORTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(offsetX + 1, 5 + offsetWall, 8),
        aabb(1, 6, 1).move(15, 0, 15),
        cull(UP | NORTH | WEST),
      );
      context.assemblePiece(
        transform,
        vec3(offsetX, 11 + offsetWall, 7),
        aabb(1, 5, 1).move(0, 11, 0),
        cull(DOWN | SOUTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(offsetX + 1, 11 + offsetWall, 7),
        aabb(1, 5, 1).move(15, 11, 0),
        cull(DOWN | SOUTH | WEST),
      );
      context.assemblePiece(
        transform,
        vec3(offsetX, 11 + offsetWall, 8),
        aabb(1, 5, 1).move(0, 11, 15),
        cull(DOWN | NORTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(offsetX + 1, 11 + offsetWall, 8),
        aabb(1, 5, 1).move(15, 11, 15),
        cull(DOWN | NORTH | WEST),
      );
    }

    if (state.open === "true") {
      for (const eastDoor of FALSE_AND_TRUE) {
        for (const eastSide of FALSE_AND_TRUE) {
          const offsetX = (eastDoor ? 14 : 0) + (eastSide ? 1 : 0);
          context.assemblePiece(
            transform,
            vec3(offsetX, 12 + offsetWall, 9),
            aabb(1, 3, 6).move(eastSide ? 15 : 0, 13, 10),
            cull(NORTH | (eastSide ? WEST : EAST)),
          );
          context.assemblePiece(
            transform,
            vec3(offsetX, 9 + offsetWall, 13),
            aabb(1, 3, 2).move(eastSide ? 15 : 0, 7, 14),
            cull(UP | DOWN | (eastSide ? WEST : EAST)),
          );
          context.assemblePiece(
            transform,
            vec3(offsetX, 6 + offsetWall, 9),
            aabb(1, 3, 6).move(eastSide ? 15 : 0, 0, 10),
            cull(NORTH | (eastSide ? WEST : EAST)),
          );
        }
      }
    } else {
      for (const southSide of FALSE_AND_TRUE) {
        const rot2 = rot + (southSide ? 180 : 0);
        const transform2: AssemblyTransform = (t) => t.rotateY(rot2);
        context.assemblePiece(
          transform2,
          vec3(8, 12 + offsetWall, 7),
          aabb(6, 3, 1).move(0, 13, 0),
          cull(SOUTH | EAST | WEST),
        );
        context.assemblePiece(
          transform2,
          vec3(8, 9 + offsetWall, 7),
          aabb(2, 3, 1).move(0, 7, 0),
          cull(UP | DOWN | SOUTH | WEST),
        );
        context.assemblePiece(
          transform2,
          vec3(8, 6 + offsetWall, 7),
          aabb(6, 3, 1),
          cull(SOUTH | EAST | WEST),
        );
        context.assemblePiece(
          transform2,
          vec3(2, 12 + offsetWall, 7),
          aabb(6, 3, 1).move(10, 13, 0),
          cull(SOUTH | EAST | WEST),
        );
        context.assemblePiece(
          transform2,
          vec3(6, 9 + offsetWall, 7),
          aabb(2, 3, 1).move(14, 7, 0),
          cull(UP | DOWN | SOUTH | EAST),
        );
        context.assemblePiece(
          transform2,
          vec3(2, 6 + offsetWall, 7),
          aabb(6, 3, 1).move(10, 0, 0),
          cull(SOUTH | EAST | WEST),
        );
      }
    }
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_fence_gate": {
    core: CopycatFenceGateModelCore,
    properties: {
      facing: ["north", "south", "west", "east"],
      open: ["false", "true"],
      in_wall: ["false", "true"],
    },
  },
};
