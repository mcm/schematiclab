// Copycats+ `content/copycat/vertical_half_layer/`:
// CopycatVerticalMultiHalfLayerModelCore, ported from copycats-plus/copycats
// at commit 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatVerticalHalfLayerBlock (the layer properties are
// CopycatHalfLayerBlock's).

import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
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

/** CopycatVerticalMultiHalfLayerModelCore. */
export const CopycatVerticalMultiHalfLayerModelCore: ModelCore = {
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
      t.flipX(!positive).rotateY(rot + 180);
    const autoCullBox = autoCull(aabb(8, 16, 16));
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(4, 16, layer),
      cull(EAST | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, layer),
      aabb(4, 16, layer).move(0, 0, 16 - layer),
      cull(EAST | NORTH),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(4, 0, 0),
      aabb(4, 16, layer).move(12, 0, 0),
      cull(WEST | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      transform,
      vec3(4, 0, layer),
      aabb(4, 16, layer).move(12, 0, 16 - layer),
      cull(WEST | NORTH),
      autoCullBox,
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_vertical_half_layer": {
    core: CopycatVerticalMultiHalfLayerModelCore,
    properties: {
      facing: ["north", "east", "south", "west"],
      positive_layers: range(0, 8),
      negative_layers: range(0, 8),
    },
    parts: ["positive_layers", "negative_layers"],
  },
};
