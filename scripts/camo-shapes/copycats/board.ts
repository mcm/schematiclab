// Copycats+ `content/copycat/board/`: CopycatBoardModelCore and
// CopycatMultiBoardModelCore, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatBoardBlock.

import {
  DIRECTIONS,
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  axisOf,
  clockWise,
  counterClockWise,
  cull,
  toYRot,
  vec3,
  type BlockState,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

function i(b: boolean): number {
  return b ? 1 : 0;
}

/** `state.getValue(byDirection(direction))` for every direction. */
function sidesOf(state: BlockState): Record<string, boolean> {
  const sides: Record<string, boolean> = {};
  for (const direction of DIRECTIONS) {
    sides[direction] = state[direction] === "true";
  }
  return sides;
}

/** CopycatBoardModelCore (not registered to a block at 60923e0). */
export const CopycatBoardModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const sides = sidesOf(state);

    for (const direction of DIRECTIONS) {
      if (!sides[direction]) continue;
      if (axisOf(direction) === "y") {
        context.assemblePiece(
          (t) => t.flipY(direction === "up"),
          vec3(0, 0, 0),
          aabb(16, 1, 16),
          cull(
            (NORTH * i(sides.north)) |
              (SOUTH * i(sides.south)) |
              (EAST * i(sides.east)) |
              (WEST * i(sides.west)),
          ),
        );
      } else {
        const right = clockWise(direction);
        const left = counterClockWise(direction);
        context.assemblePiece(
          (t) => t.rotateY(toYRot(direction) + 180),
          vec3(0, 0, 0),
          aabb(16, 16, 1),
          cull(
            (UP * i(sides.up)) |
              (DOWN * i(sides.down)) |
              (EAST * i(sides[right])) |
              (WEST * i(sides[left])),
          ),
        );
      }
    }
  },
};

/** CopycatMultiBoardModelCore. */
export const CopycatMultiBoardModelCore: ModelCore = {
  emitCopycatQuads(key, state, context) {
    const sides = sidesOf(state);

    const direction = key.toLowerCase();

    if (!sides[direction]) return;

    if (axisOf(direction) === "y") {
      context.assemblePiece(
        (t) => t.flipY(direction === "up"),
        vec3(0, 0, 0),
        aabb(16, 1, 16),
        cull(
          (NORTH * i(sides.north)) |
            (SOUTH * i(sides.south)) |
            (EAST * i(sides.east)) |
            (WEST * i(sides.west)),
        ),
      );
    } else {
      const right = clockWise(direction);
      const left = counterClockWise(direction);
      context.assemblePiece(
        (t) => t.rotateY(toYRot(direction) + 180),
        vec3(0, 0, 0),
        aabb(16, 16, 1),
        cull(
          (UP * i(sides.up)) |
            (DOWN * i(sides.down)) |
            (EAST * i(sides[right])) |
            (WEST * i(sides[left])),
        ),
      );
    }
  },
};

const BOOLEAN = ["false", "true"] as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_board": {
    core: CopycatMultiBoardModelCore,
    properties: {
      up: BOOLEAN,
      down: BOOLEAN,
      north: BOOLEAN,
      south: BOOLEAN,
      east: BOOLEAN,
      west: BOOLEAN,
    },
    parts: ["up", "down", "north", "east", "south", "west"],
  },
};
