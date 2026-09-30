// Create's copycat models (`content/decoration/copycat/`): CopycatPanelModel,
// CopycatStepModel and CopycatBarsModel, with the panel's special cases from
// CopycatSpecialCases and the bars blockstate from
// SpecialCopycatPanelBlockState. Ported from Creators-of-Create/Create at
// commit fc9535d82a29419164a1e9dc9c678bdcddeab30d (branch mc1.21.1/dev,
// mod_version 6.0.11). Read by `scripts/generate-camo-shapes.mts`.
//
// Create crops the material's quads with `BakedModelHelper.cropAndMove(bb,
// move)` instead of Copycats+' `assemblePiece`; each crop is written here as
// `assemblePiece(IDENTITY, vec3(<bb min + move>), aabb(<bb size>).move(<bb
// min>), cull(<skipped quad direction>))`, which records the same piece.
// Positions are voxels (Create's block units × 16).

import {
  DIRECTIONS,
  DOWN,
  EAST,
  IDENTITY,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  cull,
  opposite,
  toYRot,
  vec3,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "../copycats/assembly.ts";

type Vec = [number, number, number];

const NORMALS: Record<string, Vec> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

const MASKS: Record<string, number> = {
  down: DOWN,
  up: UP,
  north: NORTH,
  south: SOUTH,
  west: WEST,
  east: EAST,
};

/** An AABB in voxels as [min, max]. */
type Box = [Vec, Vec];

const CUBE: Box = [
  [0, 0, 0],
  [16, 16, 16],
];

/** `AABB.contract(x, y, z)` (amounts in voxels). */
function contract([min, max]: Box, amount: Vec): Box {
  const from: Vec = [...min];
  const to: Vec = [...max];
  for (let axis = 0; axis < 3; axis++) {
    if (amount[axis] < 0) from[axis] -= amount[axis];
    else if (amount[axis] > 0) to[axis] -= amount[axis];
  }
  return [from, to];
}

function moveBox([min, max]: Box, by: Vec): Box {
  return [
    [min[0] + by[0], min[1] + by[1], min[2] + by[2]],
    [max[0] + by[0], max[1] + by[1], max[2] + by[2]],
  ];
}

function scale(v: Vec, factor: number): Vec {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

/** `BakedModelHelper.cropAndMove(bb, move)` of the quads not facing `skip`. */
function cropAndMove(
  context: CopycatRenderContext,
  [min, max]: Box,
  move: Vec,
  skip: number,
): void {
  context.assemblePiece(
    IDENTITY,
    vec3(min[0] + move[0], min[1] + move[1], min[2] + move[2]),
    aabb(max[0] - min[0], max[1] - min[1], max[2] - min[2]).move(...min),
    cull(skip),
  );
}

/** `SpecialCopycatPanelBlockState` for `create:copycat_bars`. */
function assembleBars(context: CopycatRenderContext, facing: string): void {
  const vertical = facing === "up" || facing === "down";
  context.assembleModel(
    vertical
      ? "create:block/copycat_panel/bars_vertical"
      : "create:block/copycat_panel/bars",
    facing === "down" ? 180 : 0,
    vertical ? 0 : toYRot(facing),
    // CopycatBarsModel takes the material's up-face sprite for vertical
    // bars and for the horizontal bars' top and bottom edges, and its
    // particle sprite otherwise; one face stands in for both here.
    vertical ? "up" : "north",
  );
}

/** CopycatPanelModel. */
export const CopycatPanelModel: ModelCore = {
  emitCopycatQuads(_key, state, context, material) {
    const facing = state.facing ?? "up";

    if (material.is("CopycatSpecialCases.isBarsMaterial")) {
      // The COPYCAT_BARS model for this facing, retextured.
      assembleBars(context, facing);
      return;
    }
    if (material.is("CopycatSpecialCases.isTrapdoorMaterial")) {
      // The material's own model.
      context.assembleAll();
      return;
    }

    const normal = NORMALS[facing];
    const normalScaled14 = scale(normal, 14);

    // 2 Pieces
    for (const front of [true, false]) {
      const normalScaledN13 = scale(normal, front ? 0 : -13);
      const contractBy = 16 - (front ? 1 : 2);
      let bb = contract(CUBE, scale(normal, contractBy));
      if (!front) bb = moveBox(bb, normalScaled14);

      const skip = front ? facing : opposite(facing);
      cropAndMove(context, bb, normalScaledN13, MASKS[skip]);
    }
  },
};

/** CopycatStepModel. */
export const CopycatStepModel: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const facing = state.facing ?? "south";
    const upperHalf = (state.half ?? "bottom") === "top";

    const normal = NORMALS[facing];
    const normalScaled2 = scale(normal, 8);
    const normalScaledN3 = scale(normal, -12);
    const bb = contract(CUBE, [-normal[0] * 12, 12, -normal[2] * 12]);

    // 4 Pieces
    for (const top of [true, false]) {
      for (const front of [true, false]) {
        let bb1 = bb;
        if (front) bb1 = moveBox(bb1, normalScaledN3);
        if (top) bb1 = moveBox(bb1, [0, 12, 0]);

        let offset: Vec = [0, 0, 0];
        if (front) offset = moveBox([offset, offset], normalScaled2)[0];
        if (top !== upperHalf) {
          offset = moveBox([offset, offset], [0, upperHalf ? 8 : -8, 0])[0];
        }

        let skip = 0;
        if (front) skip |= MASKS[facing];
        if (!front) skip |= MASKS[opposite(facing)];
        if (!top) skip |= UP;
        if (top) skip |= DOWN;
        cropAndMove(context, bb1, offset, skip);
      }
    }
  },
};

/**
 * CopycatBarsModel, for `create:copycat_bars` itself: the bars model of its
 * facing, retextured with the material (Create renders it without one).
 */
export const CopycatBarsModel: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    assembleBars(context, state.facing ?? "up");
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "create:copycat_panel": {
    core: CopycatPanelModel,
    // CopycatPanelBlock: FACING (all six), default up.
    properties: { facing: ["up", ...DIRECTIONS.filter((d) => d !== "up")] },
  },
  "create:copycat_step": {
    core: CopycatStepModel,
    // CopycatStepBlock: HORIZONTAL_FACING and HALF.
    properties: {
      facing: ["south", "west", "north", "east"],
      half: ["bottom", "top"],
    },
  },
  "create:copycat_bars": {
    core: CopycatBarsModel,
    // WrenchableDirectionalBlock: FACING.
    properties: { facing: [...DIRECTIONS] },
  },
};
