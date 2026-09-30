// Copycats+ `content/copycat/pressure_plate/`: CopycatPressurePlateModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatPressurePlateBlock (vanilla PressurePlateBlock, `powered`) and
// CopycatWeightedPressurePlate (vanilla WeightedPressurePlateBlock, `power`).

import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  IDENTITY,
  aabb,
  cull,
  range,
  vec3,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/**
 * CopycatPressurePlateModelCore. Its `prepareMaterial` copies the
 * copycat's properties onto a pressure-plate material
 * (`BlockUtils.tryCopyProperties`), hence `copyPropertiesIf`; the extra
 * `powered` <-> `power` remapping between plain and weighted plates
 * (powered = power > 0, power = powered ? 15 : 0) is not ported.
 */
export const CopycatPressurePlateModelCore: ModelCore = {
  copyPropertiesIf: "BasePressurePlateBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("BasePressurePlateBlock")) {
      context.assembleAll();
      return;
    }

    const powered =
      state.powered !== undefined
        ? state.powered === "true"
        : state.power !== undefined
          ? Number(state.power) > 0
          : false;
    if (powered) {
      context.assemblePiece(
        IDENTITY,
        vec3(1, 0, 1),
        aabb(7, 0.5, 7).move(0, 0, 0),
        cull(SOUTH | EAST),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(8, 0, 8),
        aabb(7, 0.5, 7).move(9, 0, 9),
        cull(NORTH | WEST),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(8, 0, 1),
        aabb(7, 0.5, 7).move(9, 0, 0),
        cull(WEST | SOUTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(1, 0, 8),
        aabb(7, 0.5, 7).move(0, 0, 9),
        cull(NORTH | EAST),
      );
    } else {
      context.assemblePiece(
        IDENTITY,
        vec3(1, 0, 1),
        aabb(7, 1, 7).move(0, 0, 0),
        cull(SOUTH | EAST),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(8, 0, 8),
        aabb(7, 1, 7).move(9, 0, 9),
        cull(NORTH | WEST),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(8, 0, 1),
        aabb(7, 1, 7).move(9, 0, 0),
        cull(WEST | SOUTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(1, 0, 8),
        aabb(7, 1, 7).move(0, 0, 9),
        cull(NORTH | EAST),
      );
    }
  },
};

const PLATE_PROPERTIES = { powered: ["false", "true"] } as const;
const WEIGHTED_PLATE_PROPERTIES = { power: range(0, 15) } as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_wooden_pressure_plate": {
    core: CopycatPressurePlateModelCore,
    properties: PLATE_PROPERTIES,
  },
  "copycats:copycat_stone_pressure_plate": {
    core: CopycatPressurePlateModelCore,
    properties: PLATE_PROPERTIES,
  },
  "copycats:copycat_heavy_weighted_pressure_plate": {
    core: CopycatPressurePlateModelCore,
    properties: WEIGHTED_PLATE_PROPERTIES,
  },
  "copycats:copycat_light_weighted_pressure_plate": {
    core: CopycatPressurePlateModelCore,
    properties: WEIGHTED_PLATE_PROPERTIES,
  },
};
