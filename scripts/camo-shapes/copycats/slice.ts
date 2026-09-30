// Copycats+ `content/copycat/slice/`: CopycatSliceModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatSliceBlock.

import {
  DOWN,
  NORTH,
  SOUTH,
  UP,
  aabb,
  cull,
  range,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatSliceModelCore. */
export const CopycatSliceModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const flipY = state.half === "top";
    const rot = toYRot(state.facing);
    const layers = Number(state.layers);
    const transform: AssemblyTransform = (t) => t.rotateY(rot).flipY(flipY);
    context.assemblePiece(
      transform,
      vec3(0, 0, 16 - layers),
      aabb(16, layers, layers).move(0, 0, 16 - layers),
      cull(UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, layers, 16 - layers),
      aabb(16, layers, layers).move(0, 16 - layers, 16 - layers),
      cull(DOWN | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 16 - layers * 2),
      aabb(16, layers, layers).move(0, 0, 0),
      cull(UP | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, layers, 16 - layers * 2),
      aabb(16, layers, layers).move(0, 16 - layers, 0),
      cull(DOWN | SOUTH),
    );
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_slice": {
    core: CopycatSliceModelCore,
    properties: {
      half: ["bottom", "top"],
      facing: ["south", "north", "east", "west"],
      layers: range(1, 8),
    },
  },
};
