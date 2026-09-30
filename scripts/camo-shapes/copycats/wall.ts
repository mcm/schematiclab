// Copycats+ `content/copycat/wall/`: CopycatWallModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatWallBlock (vanilla WallBlock).

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  HORIZONTAL_DIRECTIONS,
  aabb,
  clockWise,
  cull,
  opposite,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

const WALL_SIDES = ["none", "low", "tall"] as const;

/** CopycatWallModelCore. */
export const CopycatWallModelCore: ModelCore = {
  copyPropertiesIf: "WallBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("WallBlock")) {
      context.assembleAll();
      return;
    }

    const pole = state.up === "true";
    if (pole) {
      // Assemble piece by piece if the central pole exists

      // Assemble the central pole
      for (const direction of HORIZONTAL_DIRECTIONS) {
        context.assemblePiece(
          (t) => t.rotateY(toYRot(direction)),
          vec3(4, 0, 4),
          aabb(4, 16, 4),
          cull(SOUTH | EAST),
        );
      }

      // Assemble the sides
      for (const direction of HORIZONTAL_DIRECTIONS) {
        const rot = toYRot(direction);
        const transform: AssemblyTransform = (t) => t.rotateY(rot);
        switch (state[direction]) {
          case "none":
            continue;
          case "low":
            context.assemblePiece(
              transform,
              vec3(5, 0, 12),
              aabb(3, 7, 4),
              cull(UP | NORTH | EAST),
            );
            context.assemblePiece(
              transform,
              vec3(8, 0, 12),
              aabb(3, 7, 4).move(13, 0, 0),
              cull(UP | NORTH | WEST),
            );
            context.assemblePiece(
              transform,
              vec3(5, 7, 12),
              aabb(3, 7, 4).move(0, 9, 0),
              cull(DOWN | NORTH | EAST),
            );
            context.assemblePiece(
              transform,
              vec3(8, 7, 12),
              aabb(3, 7, 4).move(13, 9, 0),
              cull(DOWN | NORTH | WEST),
            );
            break;
          case "tall":
            context.assemblePiece(
              transform,
              vec3(5, 0, 12),
              aabb(3, 16, 4),
              cull(NORTH | EAST),
            );
            context.assemblePiece(
              transform,
              vec3(8, 0, 12),
              aabb(3, 16, 4).move(13, 0, 0),
              cull(NORTH | WEST),
            );
            break;
        }
      }
    } else {
      // Use special logic if the central pole does not exist

      let tall = false;
      const sides: Record<string, string> = {};
      for (const direction of HORIZONTAL_DIRECTIONS) {
        const wall = state[direction];
        sides[direction] = wall;
        if (wall === "tall") tall = true;
      }

      // Special case: A straight panel
      if (
        sides.south === sides.north &&
        sides.east === sides.west &&
        (sides.north === "none" || sides.east === "none") &&
        (sides.north !== "none" || sides.east !== "none")
      ) {
        const rot = sides.south === "none" ? 90 : 0;
        const transform: AssemblyTransform = (t) => t.rotateY(rot);
        if (!tall) {
          context.assemblePiece(
            transform,
            vec3(5, 0, 0),
            aabb(3, 7, 16),
            cull(UP | EAST),
          );
          context.assemblePiece(
            transform,
            vec3(8, 0, 0),
            aabb(3, 7, 16).move(13, 0, 0),
            cull(UP | WEST),
          );
          context.assemblePiece(
            transform,
            vec3(5, 7, 0),
            aabb(3, 7, 16).move(0, 9, 0),
            cull(DOWN | EAST),
          );
          context.assemblePiece(
            transform,
            vec3(8, 7, 0),
            aabb(3, 7, 16).move(13, 9, 0),
            cull(DOWN | WEST),
          );
        } else {
          context.assemblePiece(
            transform,
            vec3(5, 0, 0),
            aabb(3, 16, 16).move(0, 0, 0),
            cull(EAST),
          );
          context.assemblePiece(
            transform,
            vec3(8, 0, 0),
            aabb(3, 16, 16).move(13, 0, 0),
            cull(WEST),
          );
        }

        return;
      }

      // Assemble the center if needed
      let extendSide: string | null = null;
      const sideCount = Object.values(sides).filter((s) => s !== "none").length;
      if (sideCount === 1) {
        extendSide =
          Object.entries(sides).find(([, s]) => s !== "none")?.[0] ?? null;
      } else {
        for (const direction of HORIZONTAL_DIRECTIONS) {
          const rot = toYRot(direction);
          const transform: AssemblyTransform = (t) => t.rotateY(rot);
          if (tall) {
            const cullCurrent = sides[opposite(direction)] === "tall";
            const cullAdjacent = sides[clockWise(direction)] === "tall";
            context.assemblePiece(
              transform,
              vec3(5, 0, 5),
              aabb(3, 16, 3).move(0, 0, 0),
              cull(
                SOUTH |
                  EAST |
                  (cullCurrent ? NORTH : 0) |
                  (cullAdjacent ? WEST : 0),
              ),
            );
          } else {
            const cullCurrent = sides[opposite(direction)] !== "none";
            const cullAdjacent = sides[clockWise(direction)] !== "none";
            context.assemblePiece(
              transform,
              vec3(5, 0, 5),
              aabb(3, 7, 3).move(0, 0, 0),
              cull(
                UP |
                  SOUTH |
                  EAST |
                  (cullCurrent ? NORTH : 0) |
                  (cullAdjacent ? WEST : 0),
              ),
            );
            context.assemblePiece(
              transform,
              vec3(5, 7, 5),
              aabb(3, 7, 3).move(0, 9, 0),
              cull(
                DOWN |
                  SOUTH |
                  EAST |
                  (cullCurrent ? NORTH : 0) |
                  (cullAdjacent ? WEST : 0),
              ),
            );
          }
        }
      }

      // Assemble the sides
      // One side will extend to the center
      for (const direction of HORIZONTAL_DIRECTIONS) {
        const rot = toYRot(direction);
        const extend = extendSide === direction;
        const cullEnd = !extend;
        const transform: AssemblyTransform = (t) => t.rotateY(rot);
        switch (sides[direction]) {
          case "none":
            continue;
          case "low":
            context.assemblePiece(
              transform,
              vec3(5, 0, extend ? 5 : 11),
              aabb(3, 7, extend ? 11 : 5).move(0, 0, 0),
              cull(UP | (cullEnd ? NORTH : 0) | EAST),
            );
            context.assemblePiece(
              transform,
              vec3(8, 0, extend ? 5 : 11),
              aabb(3, 7, extend ? 11 : 5).move(13, 0, 0),
              cull(UP | (cullEnd ? NORTH : 0) | WEST),
            );
            context.assemblePiece(
              transform,
              vec3(5, 7, extend ? 5 : 11),
              aabb(3, 7, extend ? 11 : 5).move(0, 9, 0),
              cull(DOWN | (cullEnd ? NORTH : 0) | EAST),
            );
            context.assemblePiece(
              transform,
              vec3(8, 7, extend ? 5 : 11),
              aabb(3, 7, extend ? 11 : 5).move(13, 9, 0),
              cull(DOWN | (cullEnd ? NORTH : 0) | WEST),
            );
            break;
          case "tall":
            context.assemblePiece(
              transform,
              vec3(5, 0, extend ? 5 : 11),
              aabb(3, 16, extend ? 11 : 5).move(0, 0, 0),
              cull((cullEnd ? NORTH : 0) | EAST),
            );
            context.assemblePiece(
              transform,
              vec3(8, 0, extend ? 5 : 11),
              aabb(3, 16, extend ? 11 : 5).move(13, 0, 0),
              cull((cullEnd ? NORTH : 0) | WEST),
            );
            break;
        }
      }
    }
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_wall": {
    core: CopycatWallModelCore,
    properties: {
      up: ["true", "false"],
      north: WALL_SIDES,
      east: WALL_SIDES,
      south: WALL_SIDES,
      west: WALL_SIDES,
    },
  },
};
