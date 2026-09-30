// Copycats+ `content/copycat/layer/`: CopycatLayerModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatLayerBlock.

import {
  DOWN,
  NORTH,
  SOUTH,
  UP,
  aabb,
  axisOf,
  cull,
  range,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatLayerModelCore. */
export const CopycatLayerModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const layer = Number(state.layers);
    const facing = state.facing;

    if (axisOf(facing) === "y") {
      const flipY = facing === "down";
      const transform: AssemblyTransform = (t) => t.flipY(flipY);
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, layer, 16),
        cull(UP),
      );
      context.assemblePiece(
        transform,
        vec3(0, layer, 0),
        aabb(16, layer, 16).move(0, 16 - layer, 0),
        cull(DOWN),
      );
    } else {
      const rot = toYRot(facing);
      const transform: AssemblyTransform = (t) => t.rotateY(rot);
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 16, layer),
        cull(SOUTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, layer),
        aabb(16, 16, layer).move(0, 0, 16 - layer),
        cull(NORTH),
      );
    }
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_layer": {
    core: CopycatLayerModelCore,
    properties: {
      layers: range(1, 8),
      facing: ["up", "down", "north", "south", "west", "east"],
    },
  },
};
