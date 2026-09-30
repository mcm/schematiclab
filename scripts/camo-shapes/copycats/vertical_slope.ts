// Copycats+ `content/copycat/vertical_slope/`: CopycatVerticalSlopeModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatVerticalSlopeBlock.

import {
  toYRot,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";
import { assembleSlope } from "./slope.ts";

/** CopycatVerticalSlopeModelCore. */
export const CopycatVerticalSlopeModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const enhanced = true;
    const facing = state.facing;
    const rot = toYRot(facing);
    const transform: AssemblyTransform = (t) => t.rotateZ(-90).rotateY(rot);
    assembleSlope(context, transform, 0, 16, enhanced);
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_vertical_slope": {
    core: CopycatVerticalSlopeModelCore,
    properties: { facing: ["north", "south", "west", "east"] },
  },
};
