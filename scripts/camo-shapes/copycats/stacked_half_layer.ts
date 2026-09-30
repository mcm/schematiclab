// Copycats+ `content/copycat/stacked_half_layer/`:
// CopycatStackedMultiHalfLayerModelCore, ported from copycats-plus/copycats
// at commit 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatStackedHalfLayerBlock (the layer properties are
// CopycatHalfLayerBlock's).

import {
  DOWN,
  NORTH,
  SOUTH,
  UP,
  aabb,
  autoCull,
  cull,
  range,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatStackedMultiHalfLayerModelCore. */
export const CopycatStackedMultiHalfLayerModelCore: ModelCore = {
  emitCopycatQuads(key, state, context) {
    if (key === "positive_layers" && Number(state.positive_layers) === 0)
      return;
    if (key === "negative_layers" && Number(state.negative_layers) === 0)
      return;

    const rot = toYRot(state.facing);
    const positive = key === "positive_layers";
    const layer = Number(
      positive ? state.positive_layers : state.negative_layers,
    );
    if (layer === 0) return;
    const transform: AssemblyTransform = (t) =>
      t.flipY(positive).rotateY(rot + 180);
    const autoCullBox = autoCull(aabb(16, 8, 16));
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, 4, layer),
      cull(UP | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, layer),
      aabb(16, 4, layer).move(0, 0, 16 - layer),
      cull(UP | NORTH),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, 0),
      aabb(16, 4, layer).move(0, 12, 0),
      cull(DOWN | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(0, 4, layer),
      aabb(16, 4, layer).move(0, 12, 16 - layer),
      cull(DOWN | NORTH),
      autoCullBox,
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_stacked_half_layer": {
    core: CopycatStackedMultiHalfLayerModelCore,
    properties: {
      facing: ["north", "east", "south", "west"],
      positive_layers: range(0, 8),
      negative_layers: range(0, 8),
    },
    parts: ["positive_layers", "negative_layers"],
  },
};
