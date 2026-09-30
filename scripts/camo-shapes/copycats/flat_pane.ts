// Copycats+ `content/copycat/flat_pane/`: CopycatFlatPaneModelCore, ported
// from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatFlatPaneBlock.

import {
  DOWN,
  UP,
  aabb,
  cull,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatFlatPaneModelCore. */
export const CopycatFlatPaneModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const axis = state.axis;
    const xRot = axis === "z" ? 90 : 0;
    const zRot = axis === "x" ? 90 : 0;
    const transform: AssemblyTransform = (t) => t.rotateX(xRot).rotateZ(zRot);
    context.assemblePiece(transform, vec3(0, 7, 0), aabb(16, 1, 16), cull(UP));
    context.assemblePiece(
      transform,
      vec3(0, 8, 0),
      aabb(16, 1, 16),
      cull(DOWN),
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_flat_pane": {
    core: CopycatFlatPaneModelCore,
    properties: {
      axis: ["y", "x", "z"],
    },
  },
};
