// Copycats+ `content/copycat/pane/`: CopycatPaneModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatPaneBlock (Create's ConnectedGlassPaneBlock, a
// vanilla IronBarsBlock).

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  FALSE_AND_TRUE,
  HORIZONTAL_DIRECTIONS,
  IDENTITY,
  aabb,
  clockWise,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/**
 * CopycatPaneModelCore. The Java walks `present` (a HashSet) for the arms;
 * this walks it in `Iterate.horizontalDirections` order, which only changes
 * the order of the pieces.
 */
export const CopycatPaneModelCore: ModelCore = {
  copyPropertiesIf: "IronBarsBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("IronBarsBlock")) {
      context.assembleAll();
      return;
    }

    const present = new Set<string>(
      HORIZONTAL_DIRECTIONS.filter((dir) => state[dir] === "true"),
    );

    if (present.size === 2 && present.has("north") && present.has("south")) {
      context.assemblePiece(
        IDENTITY,
        vec3(7, 0, 0),
        aabb(1, 16, 16).move(0, 0, 0),
        cull(EAST),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(8, 0, 0),
        aabb(1, 16, 16).move(15, 0, 0),
        cull(WEST),
      );
      return;
    } else if (
      present.size === 2 &&
      present.has("east") &&
      present.has("west")
    ) {
      context.assemblePiece(
        IDENTITY,
        vec3(0, 0, 7),
        aabb(16, 16, 1).move(0, 0, 0),
        cull(SOUTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(0, 0, 8),
        aabb(16, 16, 1).move(0, 0, 15),
        cull(NORTH),
      );
      return;
    } else if (present.size === 1) {
      const dir = [...present][0];
      const directionTransform: AssemblyTransform = (t) =>
        t.rotateY(toYRot(dir));
      context.assemblePiece(
        directionTransform,
        vec3(7, 0, 7),
        aabb(1, 16, 9).move(0, 0, 7),
        cull(EAST | NORTH),
      );
      context.assemblePiece(
        directionTransform,
        vec3(8, 0, 7),
        aabb(1, 16, 9).move(15, 0, 7),
        cull(WEST | NORTH),
      );
      context.assemblePiece(
        directionTransform,
        vec3(7, 0, 7),
        aabb(1, 16, 9).move(7, 0, 7),
        cull(UP | DOWN | EAST | WEST | SOUTH),
      );
      context.assemblePiece(
        directionTransform,
        vec3(8, 0, 7),
        aabb(1, 16, 9).move(8, 0, 7),
        cull(UP | DOWN | EAST | WEST | SOUTH),
      );
      return;
    }

    for (const direction of HORIZONTAL_DIRECTIONS) {
      const directionTransform: AssemblyTransform = (t) =>
        t.rotateY(toYRot(direction));
      context.assemblePiece(
        directionTransform,
        vec3(7, 0, 8),
        aabb(1, 16, 1).move(0, 0, 8),
        cull(
          (present.has(clockWise(direction)) ? WEST : 0) | SOUTH | NORTH | EAST,
        ),
      );
      if (!present.has(direction)) {
        context.assemblePiece(
          directionTransform,
          vec3(7, 0, 8),
          aabb(1, 16, 1).move(7, 0, 15),
          cull(NORTH | EAST | WEST | UP | DOWN),
        );
      }
    }

    for (const direction of present) {
      const directionTransform: AssemblyTransform = (t) =>
        t.rotateY(toYRot(direction));
      context.assemblePiece(
        directionTransform,
        vec3(7, 0, 9),
        aabb(1, 16, 7).move(0, 0, 9),
        cull(EAST | NORTH),
      );
      context.assemblePiece(
        directionTransform,
        vec3(8, 0, 9),
        aabb(1, 16, 7).move(15, 0, 9),
        cull(WEST | NORTH),
      );
    }
  },
};

const BOOLEAN = FALSE_AND_TRUE.map(String);

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_pane": {
    core: CopycatPaneModelCore,
    properties: {
      north: BOOLEAN,
      east: BOOLEAN,
      south: BOOLEAN,
      west: BOOLEAN,
    },
  },
};
