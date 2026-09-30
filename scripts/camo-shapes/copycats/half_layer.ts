// Copycats+ `content/copycat/half_layer/`: CopycatHalfLayerModelCore and
// CopycatMultiHalfLayerModelCore, ported from copycats-plus/copycats at
// commit 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatHalfLayerBlock.

import {
  DOWN,
  EAST,
  FALSE_AND_TRUE,
  UP,
  WEST,
  aabb,
  autoCull,
  cull,
  range,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatHalfLayerModelCore (not registered to a block at 60923e0). */
export const CopycatHalfLayerModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const flipY = state.half === "top";
    const rot = state.axis === "x" ? 0 : 90;
    for (const positive of FALSE_AND_TRUE) {
      const layer = Number(
        positive ? state.positive_layers : state.negative_layers,
      );
      if (layer === 0) continue;
      const transform: AssemblyTransform = (t) =>
        t.rotateY(rot + (positive ? 180 : 0)).flipY(flipY);
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(4, layer, 16),
        cull(EAST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(0, layer, 0),
        aabb(4, layer, 16).move(0, 16 - layer, 0),
        cull(EAST | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(4, 0, 0),
        aabb(4, layer, 16).move(12, 0, 0),
        cull(WEST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(4, layer, 0),
        aabb(4, layer, 16).move(12, 16 - layer, 0),
        cull(WEST | DOWN),
      );
    }
  },
};

/** CopycatMultiHalfLayerModelCore. */
export const CopycatMultiHalfLayerModelCore: ModelCore = {
  emitCopycatQuads(key, state, context) {
    if (key === "negative_layers" && Number(state.negative_layers) === 0)
      return;
    if (key === "positive_layers" && Number(state.positive_layers) === 0)
      return;

    const flipY = state.half === "top";
    const rot = state.axis === "x" ? 0 : 90;
    const positive = key === "positive_layers";
    const layer = Number(
      positive ? state.positive_layers : state.negative_layers,
    );
    if (layer === 0) return;
    const transform: AssemblyTransform = (t) =>
      t.rotateY(rot + (positive ? 180 : 0)).flipY(flipY);
    const autoCullBox = autoCull(aabb(8, 16, 16));
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(4, layer, 16),
      cull(EAST | UP),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(0, layer, 0),
      aabb(4, layer, 16).move(0, 16 - layer, 0),
      cull(EAST | DOWN),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(4, 0, 0),
      aabb(4, layer, 16).move(12, 0, 0),
      cull(WEST | UP),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(4, layer, 0),
      aabb(4, layer, 16).move(12, 16 - layer, 0),
      cull(WEST | DOWN),
      autoCullBox,
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_half_layer": {
    core: CopycatMultiHalfLayerModelCore,
    properties: {
      axis: ["x", "z"],
      half: ["bottom", "top"],
      positive_layers: range(0, 8),
      negative_layers: range(0, 8),
    },
    parts: ["positive_layers", "negative_layers"],
  },
};
