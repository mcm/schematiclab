// Copycats+ `content/copycat/beam/`: CopycatBeamModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatBeamBlock.

import {
  DOWN,
  EAST,
  UP,
  WEST,
  aabb,
  cull,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatBeamModelCore. */
export const CopycatBeamModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const axis = state.axis;

    const transform: AssemblyTransform = (t) =>
      t.rotateX(axis === "y" ? 90 : 0).rotateY(axis === "x" ? 90 : 0);

    context.assemblePiece(
      transform,
      vec3(4, 4, 0),
      aabb(4, 4, 16),
      cull(UP | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 4, 0),
      aabb(4, 4, 16).move(12, 0, 0),
      cull(UP | WEST),
    );
    context.assemblePiece(
      transform,
      vec3(4, 8, 0),
      aabb(4, 4, 16).move(0, 12, 0),
      cull(DOWN | EAST),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 0),
      aabb(4, 4, 16).move(12, 12, 0),
      cull(DOWN | WEST),
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_beam": {
    core: CopycatBeamModelCore,
    properties: {
      axis: ["y", "x", "z"],
    },
  },
};
