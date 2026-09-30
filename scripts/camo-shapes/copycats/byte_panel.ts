// Copycats+ `content/copycat/byte_panel/`: CopycatMultiBytePanelModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatBytePanelBlock.

import {
  DOWN,
  EAST,
  IDENTITY,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  autoCull,
  axisOf,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

const PARTS = ["bottom_left", "bottom_right", "top_left", "top_right"];

/** CopycatMultiBytePanelModelCore. */
export const CopycatMultiBytePanelModelCore: ModelCore = {
  emitCopycatQuads(key, state, context) {
    // `fromProperty(key)` throws for other keys.
    if (!PARTS.includes(key)) throw new Error(`Invalid property: ${key}`);
    if (state[key] !== "true") return;

    const i = key === "bottom_left" || key === "top_left" ? 1 : 0;
    const j = key === "top_left" || key === "top_right" ? 1 : 0;
    const facing = state.facing;

    if (axisOf(facing) !== "y") {
      const rot = toYRot(facing);
      const transform: AssemblyTransform = (t) => t.rotateY(rot);

      const autoCullBox = autoCull(aabb(8, 8, 16).move(i * 8, j * 8, 0));

      context.assemblePiece(
        transform,
        vec3(i * 8, j * 8, 13),
        aabb(4, 4, 2),
        cull(UP | EAST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(i * 8 + 4, j * 8, 13),
        aabb(4, 4, 2).move(12, 0, 0),
        cull(UP | WEST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(i * 8, j * 8 + 4, 13),
        aabb(4, 4, 2).move(0, 12, 0),
        cull(DOWN | EAST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(i * 8 + 4, j * 8 + 4, 13),
        aabb(4, 4, 2).move(12, 12, 0),
        cull(DOWN | WEST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(i * 8, j * 8, 15),
        aabb(4, 4, 1).move(0, 0, 15),
        cull(UP | EAST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(i * 8 + 4, j * 8, 15),
        aabb(4, 4, 1).move(12, 0, 15),
        cull(UP | WEST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(i * 8, j * 8 + 4, 15),
        aabb(4, 4, 1).move(0, 12, 15),
        cull(DOWN | EAST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        transform,
        vec3(i * 8 + 4, j * 8 + 4, 15),
        aabb(4, 4, 1).move(12, 12, 15),
        cull(DOWN | WEST | NORTH),
        autoCullBox,
      );
    } else if (facing === "down") {
      const autoCullBox = autoCull(aabb(8, 16, 8).move(i * 8, 0, j * 8));

      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 0, j * 8),
        aabb(4, 2, 4),
        cull(UP | EAST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 0, j * 8),
        aabb(4, 2, 4).move(12, 0, 0),
        cull(UP | WEST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 0, j * 8 + 4),
        aabb(4, 2, 4).move(0, 0, 12),
        cull(UP | EAST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 0, j * 8 + 4),
        aabb(4, 2, 4).move(12, 0, 12),
        cull(UP | WEST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 2, j * 8),
        aabb(4, 1, 4),
        cull(DOWN | EAST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 2, j * 8),
        aabb(4, 1, 4).move(12, 0, 0),
        cull(DOWN | WEST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 2, j * 8 + 4),
        aabb(4, 1, 4).move(0, 0, 12),
        cull(DOWN | EAST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 2, j * 8 + 4),
        aabb(4, 1, 4).move(12, 0, 12),
        cull(DOWN | WEST | NORTH),
        autoCullBox,
      );
    } else if (facing === "up") {
      const autoCullBox = autoCull(aabb(8, 16, 8).move(i * 8, 0, 8 - j * 8));

      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 13, 8 - j * 8),
        aabb(4, 2, 4),
        cull(UP | EAST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 13, 8 - j * 8),
        aabb(4, 2, 4).move(12, 0, 0),
        cull(UP | WEST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 13, 8 - j * 8 + 4),
        aabb(4, 2, 4).move(0, 0, 12),
        cull(UP | EAST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 13, 8 - j * 8 + 4),
        aabb(4, 2, 4).move(12, 0, 12),
        cull(UP | WEST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 15, 8 - j * 8),
        aabb(4, 1, 4),
        cull(DOWN | EAST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 15, 8 - j * 8),
        aabb(4, 1, 4).move(12, 0, 0),
        cull(DOWN | WEST | SOUTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8, 15, 8 - j * 8 + 4),
        aabb(4, 1, 4).move(0, 0, 12),
        cull(DOWN | EAST | NORTH),
        autoCullBox,
      );
      context.assemblePiece(
        IDENTITY,
        vec3(i * 8 + 4, 15, 8 - j * 8 + 4),
        aabb(4, 1, 4).move(12, 0, 12),
        cull(DOWN | WEST | NORTH),
        autoCullBox,
      );
    }
  },
};

const BOOLEAN = ["false", "true"] as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_byte_panel": {
    core: CopycatMultiBytePanelModelCore,
    properties: {
      bottom_left: BOOLEAN,
      bottom_right: BOOLEAN,
      top_left: BOOLEAN,
      top_right: BOOLEAN,
      facing: ["down", "up", "north", "south", "west", "east"],
    },
    parts: PARTS,
  },
};
