// Copycats+ `content/copycat/vertical_stairs/`: CopycatVerticalStairsModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatVerticalStairBlock (FACING, SIDE, VERTICAL_STAIR_SHAPE in
// CCBlockStateProperties).

import {
  toYRot,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";
import {
  assembleInnerLeft,
  assembleOuterLeft,
  assembleStraight,
} from "./stairs.ts";

/** `VerticalStairShape.isTop()`. */
function isTop(shape: string): boolean {
  return shape === "outer_top" || shape === "inner_top";
}

/** CopycatVerticalStairsModelCore. */
export const CopycatVerticalStairsModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const enhanced = true;
    const facing = toYRot(state.facing);
    const shape = state.vertical_stair_shape;
    const side = state.side;

    switch (shape) {
      case "straight": {
        const flipX = side === "right";
        const transform: AssemblyTransform = (t) =>
          t.rotateX(90).rotateZ(90).flipX(flipX).rotateY(facing);
        assembleStraight(context, transform, enhanced);
        break;
      }
      case "inner_bottom":
      case "inner_top": {
        const flipY = isTop(shape);
        const flipX = side === "right";
        const transform: AssemblyTransform = (t) =>
          t.rotateX(90).rotateZ(90).flipX(flipX).flipY(flipY).rotateY(facing);
        assembleInnerLeft(context, transform, enhanced);
        break;
      }
      case "outer_bottom":
      case "outer_top": {
        const flipY = isTop(shape);
        const flipX = side === "right";
        const transform: AssemblyTransform = (t) =>
          t.rotateX(90).rotateZ(90).flipX(flipX).flipY(flipY).rotateY(facing);
        assembleOuterLeft(context, transform, enhanced);
        break;
      }
    }
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_vertical_stairs": {
    core: CopycatVerticalStairsModelCore,
    properties: {
      facing: ["north", "south", "west", "east"],
      side: ["left", "right"],
      vertical_stair_shape: [
        "straight",
        "outer_top",
        "outer_bottom",
        "inner_top",
        "inner_bottom",
      ],
    },
  },
};
