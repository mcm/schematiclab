// Copycats+ `content/copycat/fence/`: CopycatFenceModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatFenceBlock (vanilla FenceBlock).

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  FALSE_AND_TRUE,
  HORIZONTAL_DIRECTIONS,
  aabb,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatFenceModelCore. */
export const CopycatFenceModelCore: ModelCore = {
  copyPropertiesIf: "FenceBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("FenceBlock")) {
      context.assembleAll();
      return;
    }

    for (const direction of HORIZONTAL_DIRECTIONS) {
      context.assemblePiece(
        (t) => t.rotateY(toYRot(direction)),
        vec3(6, 0, 6),
        aabb(2, 16, 2),
        cull(SOUTH | EAST),
      );
    }

    for (const direction of HORIZONTAL_DIRECTIONS) {
      if (state[direction] !== "true") continue;

      const rot = toYRot(direction);
      const transform: AssemblyTransform = (t) => t.rotateY(rot);
      context.assemblePiece(
        transform,
        vec3(7, 6, 10),
        aabb(1, 1, 6),
        cull(UP | NORTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(8, 6, 10),
        aabb(1, 1, 6).move(15, 0, 0),
        cull(UP | NORTH | WEST),
      );
      context.assemblePiece(
        transform,
        vec3(7, 7, 10),
        aabb(1, 2, 6).move(0, 14, 0),
        cull(DOWN | NORTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(8, 7, 10),
        aabb(1, 2, 6).move(15, 14, 0),
        cull(DOWN | NORTH | WEST),
      );

      context.assemblePiece(
        transform,
        vec3(7, 12, 10),
        aabb(1, 1, 6),
        cull(UP | NORTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(8, 12, 10),
        aabb(1, 1, 6).move(15, 0, 0),
        cull(UP | NORTH | WEST),
      );
      context.assemblePiece(
        transform,
        vec3(7, 13, 10),
        aabb(1, 2, 6).move(0, 14, 0),
        cull(DOWN | NORTH | EAST),
      );
      context.assemblePiece(
        transform,
        vec3(8, 13, 10),
        aabb(1, 2, 6).move(15, 14, 0),
        cull(DOWN | NORTH | WEST),
      );
    }
  },
};

const BOOLEAN = FALSE_AND_TRUE.map(String);

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_fence": {
    core: CopycatFenceModelCore,
    properties: {
      north: BOOLEAN,
      east: BOOLEAN,
      south: BOOLEAN,
      west: BOOLEAN,
    },
  },
};
