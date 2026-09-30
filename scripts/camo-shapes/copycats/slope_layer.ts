// Copycats+ `content/copycat/slope_layer/`: CopycatSlopeLayerModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatSlopeLayerBlock.

import {
  range,
  toYRot,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";
import { assembleSlope } from "./slope.ts";

/** CopycatSlopeLayerModelCore. */
export const CopycatSlopeLayerModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const enhanced = true;
    const layer = Number(state.layers);
    const facing = state.facing;
    const half = state.half;

    const transform: AssemblyTransform = (t) =>
      t.rotateY(toYRot(facing)).flipY(half === "top");

    if (layer <= 4) assembleSlope(context, transform, 0, layer * 4, enhanced);
    else assembleSlope(context, transform, (layer - 4) * 4, 16, enhanced);
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_slope_layer": {
    core: CopycatSlopeLayerModelCore,
    properties: {
      facing: ["north", "south", "west", "east"],
      half: ["bottom", "top"],
      layers: range(1, 8),
    },
  },
};
