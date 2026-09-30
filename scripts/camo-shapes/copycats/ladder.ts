// Copycats+ `content/copycat/ladder/`: CopycatLadderModelCore and
// CopycatMultiLadderModelCore, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatLadderBlock (vanilla LadderBlock, plus `rails` and `steps`).

import {
  aabb,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";

/** CopycatLadderModelCore. It ignores `rails` and `steps`. */
export const CopycatLadderModelCore: ModelCore = {
  copyPropertiesIf: "LadderBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("LadderBlock")) {
      context.assembleAll();
      return;
    }

    const rot = toYRot(state.facing);
    const transform: AssemblyTransform = (t) => t.rotateY(rot);
    assemblePoles(context, transform);
    assembleSteps(context, transform);
  },
};

/** `CopycatLadderModelCore.assemblePoles`. */
export function assemblePoles(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
): void {
  context.assemblePiece(transform, vec3(2, 0, 0), aabb(2, 16, 1), cull(0));
  context.assemblePiece(
    transform,
    vec3(12, 0, 0),
    aabb(2, 16, 1).move(14, 0, 0),
    cull(0),
  );
}

/** `CopycatLadderModelCore.assembleSteps`. */
export function assembleSteps(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
): void {
  context.assemblePiece(transform, vec3(1, 1, 0.1), aabb(14, 2, 0.8), cull(0));
  context.assemblePiece(transform, vec3(1, 5, 0.1), aabb(14, 2, 0.8), cull(0));
  context.assemblePiece(transform, vec3(1, 9, 0.1), aabb(14, 2, 0.8), cull(0));
  context.assemblePiece(transform, vec3(1, 13, 0.1), aabb(14, 2, 0.8), cull(0));
}

/**
 * CopycatMultiLadderModelCore (not registered to a block at 60923e0: the
 * multi-state ladder block entity has no valid blocks). Parts are `rails`
 * and `steps`.
 */
export const CopycatMultiLadderModelCore: ModelCore = {
  emitCopycatQuads(key, state, context) {
    if (key === "rails" && state.rails !== "true") return;
    if (key === "steps" && state.steps !== "true") return;

    const rot = toYRot(state.facing);
    const transform: AssemblyTransform = (t) => t.rotateY(rot);
    if (state.rails === "true") {
      assemblePoles(context, transform);
    }

    if (state.steps === "true") {
      assembleSteps(context, transform);
    }
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_ladder": {
    core: CopycatLadderModelCore,
    properties: {
      facing: ["north", "south", "west", "east"],
    },
  },
};
