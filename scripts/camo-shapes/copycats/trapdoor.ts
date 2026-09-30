// Copycats+ `content/copycat/trapdoor/`: CopycatTrapdoorModelCore, ported
// from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatTrapdoorBlock (vanilla TrapDoorBlock).

import {
  DOWN,
  NORTH,
  SOUTH,
  UP,
  aabb,
  cull,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** CopycatTrapdoorModelCore. */
export const CopycatTrapdoorModelCore: ModelCore = {
  copyPropertiesIf: "TrapDoorBlock",
  emitCopycatQuads(_key, state, context, material) {
    if (material.is("TrapDoorBlock")) {
      context.assembleAll();
      return;
    }

    const rot = toYRot(state.facing);
    const flipY = state.half === "top";
    const open = state.open === "true";
    const transform: AssemblyTransform = (t) => t.rotateY(rot).flipY(flipY);
    if (!open) {
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 1, 16),
        cull(UP),
      );
      context.assemblePiece(
        transform,
        vec3(0, 1, 0),
        aabb(16, 2, 16).move(0, 14, 0),
        cull(DOWN),
      );
    } else {
      context.assemblePiece(
        transform,
        vec3(0, 0, 0),
        aabb(16, 16, 1),
        cull(SOUTH),
      );
      context.assemblePiece(
        transform,
        vec3(0, 0, 1),
        aabb(16, 16, 2).move(0, 0, 14),
        cull(NORTH),
      );
    }
  },
};

const TRAPDOOR_PROPERTIES = {
  facing: ["north", "south", "west", "east"],
  half: ["bottom", "top"],
  open: ["false", "true"],
} as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_trapdoor": {
    core: CopycatTrapdoorModelCore,
    properties: TRAPDOOR_PROPERTIES,
  },
  "copycats:copycat_iron_trapdoor": {
    core: CopycatTrapdoorModelCore,
    properties: TRAPDOOR_PROPERTIES,
  },
};
