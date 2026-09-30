// Copycats+ `content/copycat/shaft/`: CopycatShaftModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from Create's RotatedPillarKineticBlock (default axis y).
//
// In-game the shaft rotates (a kinetic block-entity renderer draws the
// core's partial model); the preview draws it standing still.

import {
  DOWN,
  EAST,
  UP,
  WEST,
  aabb,
  cull,
  noCull,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** Create's `AXIS` values, default first. */
export const AXES = ["y", "x", "z"] as const;

/** CopycatShaftModelCore. */
export const CopycatShaftModelCore: ModelCore = {
  copyPropertiesIf: "ShaftBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("ShaftBlock")) {
      context.assembleAll();
      return;
    }

    const axis = state.axis;

    const transform: AssemblyTransform = (t) =>
      t.rotateY(axis === "x" ? 90 : 0).rotateX(axis === "y" ? 90 : 0);
    context.assemblePiece(
      transform,
      vec3(6, 6, 0),
      aabb(2, 2, 16).move(0, 0, 0),
      cull(UP | EAST),
      noCull(),
    );
    context.assemblePiece(
      transform,
      vec3(8, 6, 0),
      aabb(2, 2, 16).move(14, 0, 0),
      cull(UP | WEST),
      noCull(),
    );
    context.assemblePiece(
      transform,
      vec3(6, 8, 0),
      aabb(2, 2, 16).move(0, 14, 0),
      cull(DOWN | EAST),
      noCull(),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 0),
      aabb(2, 2, 16).move(14, 14, 0),
      cull(DOWN | WEST),
      noCull(),
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_shaft": {
    core: CopycatShaftModelCore,
    properties: { axis: AXES },
  },
};
