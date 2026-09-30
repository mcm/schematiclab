// Copycats+ `content/copycat/cogwheel/`: CopycatCogWheelModelCore and
// CopycatLargeCogWheelModelCore, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from Create's
// RotatedPillarKineticBlock (default axis y); parts from
// CopycatCogWheelBlock.
//
// In-game both cogwheels rotate: CopycatCogWheelRenderer draws the
// `cogwheel` part with these cores and the `shaft` part with
// CopycatShaftModelCore (`CCCopycatPartialModels`). The preview draws them
// standing still.

import {
  DOWN,
  EAST,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  angle,
  cull,
  keepBetween,
  noCull,
  pivot,
  rotate,
  scale,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";
import { AXES, CopycatShaftModelCore } from "./shaft.ts";

/**
 * The cogwheel material case both cores share: the material's own model,
 * minus the quads touching its axis ends (its shaft), in the inline lambda.
 */
function assembleCogWheelMaterial(
  context: CopycatRenderContext,
  axis: string,
): void {
  context.assemblePiece(
    (t) => t.rotateX(axis === "z" ? 90 : 0).rotateZ(axis === "x" ? 90 : 0),
    vec3(-8, -8, -8),
    aabb(32, 32, 32).move(-8, -8, -8),
    cull(0),
    noCull(),
    // vertex.xyz.y < 0.01 || vertex.xyz.y > 0.99 → discard
    keepBetween("y", 0.16, 15.84),
  );
}

/** CopycatCogWheelModelCore. */
export const CopycatCogWheelModelCore: ModelCore = {
  copyPropertiesIf: "CogWheelBlock",
  emitCopycatQuads(_key, state, context, material) {
    const axis = state.axis;

    if (material.is("CogWheelBlock")) {
      assembleCogWheelMaterial(context, axis);
      return;
    }

    for (let i = 0; i < 4; i++) {
      const rotation = i * 90;
      const transform: AssemblyTransform = (t) =>
        t
          .rotateZ(rotation)
          .rotateY(axis === "x" ? 90 : 0)
          .rotateX(axis === "y" ? 90 : 0);
      context.assemblePiece(
        transform,
        vec3(4, 4, 6),
        aabb(4, 4, 2),
        cull(EAST | SOUTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(4, 4, 8),
        aabb(4, 4, 2).move(0, 0, 14),
        cull(EAST | NORTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(2, 2, 6.55),
        aabb(6, 6, 1.45),
        cull(EAST | SOUTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(2, 2, 8),
        aabb(6, 6, 1.45).move(0, 0, 14.55),
        cull(EAST | NORTH | UP),
        noCull(),
      );
      for (let j = 0; j < 2; j++) {
        const gearRotation = j * 45;
        context.assemblePiece(
          transform,
          vec3(6.5, 0, 6.5),
          aabb(1.5, 16, 1.5),
          cull(EAST | SOUTH),
          scale(pivot(8, 8, 8), scale(1, 18 / 16.0, 1 + j * 0.02)),
          rotate(pivot(8, 8, 8), angle(0, 0, gearRotation)),
          noCull(),
        );
        context.assemblePiece(
          transform,
          vec3(6.5, 0, 8),
          aabb(1.5, 16, 1.5).move(0, 0, 14.5),
          cull(EAST | NORTH),
          scale(pivot(8, 8, 8), scale(1, 18 / 16.0, 1 + j * 0.02)),
          rotate(pivot(8, 8, 8), angle(0, 0, gearRotation)),
          noCull(),
        );
      }
    }
  },
};

/** CopycatLargeCogWheelModelCore. */
export const CopycatLargeCogWheelModelCore: ModelCore = {
  copyPropertiesIf: "CogWheelBlock",
  emitCopycatQuads(_key, state, context, material) {
    const axis = state.axis;

    if (material.is("CogWheelBlock")) {
      assembleCogWheelMaterial(context, axis);
      return;
    }

    for (let i = 0; i < 4; i++) {
      const rotation = i * 90;
      const transform: AssemblyTransform = (t) =>
        t
          .rotateZ(rotation)
          .rotateY(axis === "x" ? 90 : 0)
          .rotateX(axis === "y" ? 90 : 0);
      context.assemblePiece(
        transform,
        vec3(1, -1, 5.975),
        aabb(7, 2, 2.025),
        cull(EAST | SOUTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(8, -1, 5.975),
        aabb(7, 2, 2.025).move(9, 0, 0),
        cull(WEST | SOUTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(1, -1, 8),
        aabb(7, 2, 2.025).move(0, 0, 13.975),
        cull(EAST | NORTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(8, -1, 8),
        aabb(7, 2, 2.025).move(9, 0, 13.975),
        cull(WEST | NORTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(1, 1, 5.975),
        aabb(7, 7, 4.05).move(3, 3, 0),
        cull(EAST | WEST | UP | DOWN),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(-2, -2, 6.4),
        aabb(10, 10, 1.6),
        cull(EAST | SOUTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(-2, -2, 8),
        aabb(10, 10, 1.6).move(0, 0, 14.4),
        cull(EAST | NORTH | UP),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(-2, -2, 6.625),
        aabb(10, 10, 1.375),
        cull(EAST | SOUTH | UP),
        rotate(pivot(8, 8, 8), angle(0, 0, 45)),
        noCull(),
      );
      context.assemblePiece(
        transform,
        vec3(-2, -2, 8),
        aabb(10, 10, 1.375).move(0, 0, 14.625),
        cull(EAST | NORTH | UP),
        rotate(pivot(8, 8, 8), angle(0, 0, 45)),
        noCull(),
      );
    }

    for (let i = 0; i < 4; i++) {
      const rotation = i * 90;
      const transform: AssemblyTransform = (t) =>
        t
          .rotateZ(rotation)
          .rotateY(axis === "x" ? 90 : 0)
          .rotateX(axis === "y" ? 90 : 0);
      for (let j = 0; j < 4; j++) {
        const gearRotation = j * 22.5;
        const delta = -0.025 + j * 0.025;
        context.assemblePiece(
          transform,
          vec3(6.5, -7, 6.6 + delta),
          aabb(1.5, 6, 1.5),
          cull(EAST | SOUTH | UP),
          rotate(pivot(8, 8, 8), angle(0, 0, gearRotation)),
          noCull(),
        );
        context.assemblePiece(
          transform,
          vec3(6.5, -7, 8 + delta),
          aabb(1.5, 6, 1.5).move(0, 0, 14.5),
          cull(EAST | NORTH | UP),
          rotate(pivot(8, 8, 8), angle(0, 0, gearRotation)),
          noCull(),
        );
        context.assemblePiece(
          transform,
          vec3(8, -7, 6.6 + delta),
          aabb(1.5, 6, 1.5).move(14.5, 0, 0),
          cull(WEST | SOUTH | UP),
          rotate(pivot(8, 8, 8), angle(0, 0, gearRotation)),
          noCull(),
        );
        context.assemblePiece(
          transform,
          vec3(8, -7, 8 + delta),
          aabb(1.5, 6, 1.5).move(14.5, 0, 14.5),
          cull(WEST | NORTH | UP),
          rotate(pivot(8, 8, 8), angle(0, 0, gearRotation)),
          noCull(),
        );
      }
    }
  },
};

const COGWHEEL_PARTS = ["cogwheel", "shaft"] as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_cogwheel": {
    core: CopycatCogWheelModelCore,
    properties: { axis: AXES },
    parts: COGWHEEL_PARTS,
    partCores: { shaft: CopycatShaftModelCore },
  },
  "copycats:copycat_large_cogwheel": {
    core: CopycatLargeCogWheelModelCore,
    properties: { axis: AXES },
    parts: COGWHEEL_PARTS,
    partCores: { shaft: CopycatShaftModelCore },
  },
};
