// Hand ports of FramedBlocks' `client/model/geometry/slope/*Geometry.java`
// (slopes, half slopes, corners, prism corners and threeway corners) and
// their `FullFacePredicate`s. Read by `scripts/generate-camo-shapes.mts`
// through `GEOMETRY_SPECS`; the double blocks built from these are in
// `DOUBLE_BLOCK_SPECS` (`template-specs.ts`).
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class. The pyramid geometries in the same package are in
// `pyramid.ts`.

import type { Direction } from "../../../src/lib/render/camo/shape-pack";
import {
  BOOL,
  CORNER_TYPE,
  CornerType,
  DIRECTIONS,
  HORIZONTAL,
  Modifiers,
  QuadModifier,
  SLOPE_TYPE,
  axisOf,
  clockWise,
  counterClockWise,
  isTrue,
  isY,
  opposite,
  type BlockState,
  type GeometrySpec,
  type QuadPiece,
} from "./geometry-api.ts";

// ── Full face predicates (`common/data/facepreds/slope/`) ──────────────────

/** `CornerFullFacePredicate`. */
export function cornerFullFaces(s: BlockState): Direction[] {
  if (s.type === "top") return ["up"];
  if (s.type === "bottom") return ["down"];
  return [s.facing as Direction];
}

/** `InnerCornerFullFacePredicate`. */
export function innerCornerFullFaces(s: BlockState): Direction[] {
  const type = s.type;
  const facing = s.facing as Direction;
  return DIRECTIONS.filter((side) => {
    if (CornerType.isTop(type) && side === "up") return true;
    if (!CornerType.isTop(type) && side === "down") return true;
    if (CornerType.isHorizontal(type)) {
      return (
        facing === side ||
        (CornerType.isRight(type) && clockWise(facing) === side) ||
        (!CornerType.isRight(type) && counterClockWise(facing) === side)
      );
    }
    return facing === side || counterClockWise(facing) === side;
  });
}

/** `InnerThreewayCornerFullFacePredicate`. */
export function innerThreewayCornerFullFaces(s: BlockState): Direction[] {
  const facing = s.facing as Direction;
  return [isTrue(s.top) ? "up" : "down", facing, counterClockWise(facing)];
}

// ── Geometries ─────────────────────────────────────────────────────────────

/** `slope/FramedSlopeGeometry.java` */
function slope(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, type: SLOPE_TYPE, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (type === "horizontal") {
          if (!altSlope && quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeHorizontalSlope(false, 45))
              .export(quadMap, null);
          } else if (altSlope && quadDir === clockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeHorizontalSlope(true, 45))
              .export(quadMap, null);
          } else if (isY(quadDir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 1, 0))
              .export(quadMap, quadDir);
          }
        } else {
          const top = type === "top";
          if (!altSlope && quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeVerticalSlope(!top, 45))
              .export(quadMap, null);
          } else if (altSlope && isY(quadDir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
              .export(quadMap, null);
          } else if (
            quadDir === clockWise(dir) ||
            quadDir === counterClockWise(dir)
          ) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), top ? 1 : 0, top ? 0 : 1))
              .export(quadMap, quadDir);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `SlopeFullFacePredicate`
      const facing = s.facing as Direction;
      if (s.type === "horizontal") return [facing, counterClockWise(facing)];
      return [s.type === "top" ? "up" : "down", facing];
    },
  };
}

/** `slope/FramedHalfSlopeGeometry.java` */
function halfSlope(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, right: BOOL, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const right = isTrue(s.right);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const cutDir: Direction = right
          ? counterClockWise(dir)
          : clockWise(dir);

        if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.makeVerticalSlope(!top, 45))
            .apply(Modifiers.cut(cutDir, 0.5))
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, 0.5))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
            .export(quadMap, null);
        } else if (
          quadDir === clockWise(dir) ||
          quadDir === counterClockWise(dir)
        ) {
          const needOffset = right === (quadDir === counterClockWise(dir));

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), top ? 1 : 0, top ? 0 : 1))
            .applyIf(Modifiers.setPosition(0.5), needOffset)
            .export(quadMap, needOffset ? null : quadDir);
        } else if ((!top && quadDir === "down") || (top && quadDir === "up")) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
  };
}

/** `slope/FramedVerticalHalfSlopeGeometry.java` */
function verticalHalfSlope(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const vertEdge: Direction = top ? "down" : "up";

        if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.makeHorizontalSlope(false, 45))
            .apply(Modifiers.cut(vertEdge, 0.5))
            .export(quadMap, null);
        } else if (altSlope && quadDir === clockWise(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.makeHorizontalSlope(true, 45))
            .apply(Modifiers.cut(vertEdge, 0.5))
            .export(quadMap, null);
        } else if (isY(quadDir)) {
          const needOffset = top === (quadDir === "down");

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .applyIf(Modifiers.setPosition(0.5), needOffset)
            .export(quadMap, needOffset ? null : quadDir);
        } else if (quadDir === dir || quadDir === counterClockWise(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(vertEdge, 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
  };
}

/** `slope/FramedCornerSlopeGeometry.java` */
function cornerSlope(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, type: CORNER_TYPE, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altSlope = isTrue(s.alt_slope);
      function createHorizontalCornerSlope(
        quadDir: Direction,
        quadMap: QuadPiece[],
      ) {
        const top = CornerType.isTop(type);
        const right = CornerType.isRight(type);

        if (
          (quadDir === clockWise(dir) && right) ||
          (quadDir === counterClockWise(dir) && !right)
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);
        } else if ((quadDir === "up" && top) || (quadDir === "down" && !top)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), right ? 0 : 1, right ? 1 : 0))
            .export(quadMap, quadDir);
        } else if (
          (quadDir === counterClockWise(dir) && right) ||
          (quadDir === clockWise(dir) && !right)
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), top ? 1 : 0, top ? 0 : 1))
            .apply(Modifiers.makeHorizontalSlope(!right, 45))
            .export(quadMap, null);
        } else if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(top ? "up" : "down", right ? 0 : 1, right ? 1 : 0),
            )
            .apply(Modifiers.makeVerticalSlope(!top, 45))
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), right ? 0 : 1, right ? 1 : 0))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
            .export(quadMap, null);
        }
      }
      function createVerticalCornerSlope(
        quadDir: Direction,
        quadMap: QuadPiece[],
      ) {
        const yQuad = isY(quadDir);
        if (!altSlope && yQuad) {
          return;
        }

        const top = CornerType.isTop(type);
        const cutDir: Direction =
          axisOf(quadDir) === axisOf(dir) ? clockWise(dir) : opposite(dir);
        const slope = quadDir === opposite(dir) || quadDir === clockWise(dir);

        if ((!slope && !yQuad) || !altSlope) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0, top ? 0 : 1))
            .applyIf(Modifiers.makeVerticalSlope(!top, 45), slope)
            .export(quadMap, slope ? null : quadDir);
        } else if (yQuad) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0, 1))
            .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 1, 0))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
            .export(quadMap, null);
        }
      }
      return (quadDir, quadMap) => {
        if (CornerType.isHorizontal(type)) {
          createHorizontalCornerSlope(quadDir, quadMap);
        } else {
          createVerticalCornerSlope(quadDir, quadMap);
        }
      };
    },
    fullFaces: cornerFullFaces,
  };
}

/** `slope/FramedInnerCornerSlopeGeometry.java` */
function innerCornerSlope(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, type: CORNER_TYPE, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altSlope = isTrue(s.alt_slope);
      function createHorizontalCorner(
        quadDir: Direction,
        quadMap: QuadPiece[],
      ) {
        const top = CornerType.isTop(type);
        const right = CornerType.isRight(type);

        if ((quadDir === "up" && !top) || (quadDir === "down" && top)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), right ? 0 : 1, right ? 1 : 0))
            .export(quadMap, quadDir);

          if (altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, right ? 0 : 1, right ? 1 : 0))
              .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(dir)) {
          const cutDir: Direction = right
            ? counterClockWise(dir)
            : clockWise(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 0 : 1, top ? 1 : 0))
            .apply(Modifiers.makeHorizontalSlope(right, 45))
            .export(quadMap, null);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cut(
                  top ? "down" : "up",
                  right ? 1 : 0,
                  right ? 0 : 1,
                ),
              )
              .apply(Modifiers.makeVerticalSlope(!top, 45))
              .export(quadMap, null);
          }
        } else if (
          (quadDir === clockWise(dir) && !right) ||
          (quadDir === counterClockWise(dir) && right)
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);
        }
      }
      function createVerticalCorner(quadDir: Direction, quadMap: QuadPiece[]) {
        const top = CornerType.isTop(type);

        if (quadDir === clockWise(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, top ? 0 : 1, top ? 1 : 0))
              .apply(Modifiers.makeVerticalSlope(!top, 45))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cut(counterClockWise(dir), top ? 0 : 1, top ? 1 : 0),
              )
              .apply(Modifiers.makeVerticalSlope(!top, 45))
              .export(quadMap, null);
          }
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 1, 0))
            .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0, 1))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
            .export(quadMap, null);
        }
      }
      return (quadDir, quadMap) => {
        if (CornerType.isHorizontal(type)) {
          createHorizontalCorner(quadDir, quadMap);
        } else {
          createVerticalCorner(quadDir, quadMap);
        }
      };
    },
    fullFaces: innerCornerFullFaces,
  };
}

/** `slope/FramedPrismCornerGeometry.java` */
function prismCorner(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      offset: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const offset = isTrue(s.offset);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if ((quadDir === "up" && top) || (quadDir === "down" && !top)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .export(quadMap, quadDir);
        } else if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir: Direction =
            quadDir === dir ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);
        } else if (!altSlope && quadDir === opposite(dir)) {
          if (offset) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.offset(clockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(!top, true))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.offset(counterClockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(!top, true))
              .export(quadMap, null);
          } else {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutPrismTriangle(!top, true))
              .export(quadMap, null);
          }
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          if (offset) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.offset(clockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(dir, true))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.offset(counterClockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(dir, true))
              .export(quadMap, null);
          } else {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutPrismTriangle(dir, true))
              .export(quadMap, null);
          }
        }
      };
    },
  };
}

/** `slope/FramedInnerPrismCornerGeometry.java` */
function innerPrismCorner(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      offset: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const offset = isTrue(s.offset);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if ((quadDir === "down" && top) || (quadDir === "up" && !top)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(dir) || quadDir === clockWise(dir)) {
          const cutDir: Direction =
            quadDir === opposite(dir) ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);
        }

        if (!altSlope && quadDir === opposite(dir)) {
          if (offset) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.offset(clockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(top, false))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.offset(counterClockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(top, false))
              .export(quadMap, null);
          } else {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutPrismTriangle(top, false))
              .export(quadMap, null);
          }
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          if (offset) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.offset(clockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(opposite(dir), false))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.offset(counterClockWise(dir), 0.5))
              .apply(Modifiers.cutPrismTriangle(opposite(dir), false))
              .export(quadMap, null);
          } else {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutPrismTriangle(opposite(dir), false))
              .export(quadMap, null);
          }
        }
      };
    },
    fullFaces: innerThreewayCornerFullFaces,
  };
}

/** `slope/FramedThreewayCornerGeometry.java` */
function threewayCorner(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if ((quadDir === "up" && top) || (quadDir === "down" && !top)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .export(quadMap, quadDir);
        } else if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir: Direction =
            quadDir === dir ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(dir)) {
          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutSmallTriangle(clockWise(dir)))
              .apply(Modifiers.makeVerticalSlope(!top, 45))
              .export(quadMap, null);
          }

          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(top ? "down" : "up"))
            .apply(Modifiers.makeHorizontalSlope(false, 45))
            .export(quadMap, null);
        } else if (!altSlope && quadDir === clockWise(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(opposite(dir)))
            .apply(Modifiers.makeVerticalSlope(!top, 45))
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(opposite(dir)))
            .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(clockWise(dir)))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
            .export(quadMap, null);
        }
      };
    },
  };
}

/** `slope/FramedInnerThreewayCornerGeometry.java` */
function innerThreewayCorner(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if ((quadDir === "down" && top) || (quadDir === "up" && !top)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .export(quadMap, quadDir);
        } else if (quadDir === clockWise(dir) || quadDir === opposite(dir)) {
          const cutDir: Direction =
            quadDir === opposite(dir) ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0, top ? 0 : 1))
            .export(quadMap, quadDir);
        }

        if (quadDir === clockWise(dir)) {
          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutSmallTriangle(dir))
              .apply(Modifiers.makeVerticalSlope(!top, 45))
              .export(quadMap, null);
          }

          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(top ? "up" : "down"))
            .apply(Modifiers.makeHorizontalSlope(true, 45))
            .export(quadMap, null);
        } else if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(counterClockWise(dir)))
            .apply(Modifiers.makeVerticalSlope(!top, 45))
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(dir))
            .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(counterClockWise(dir)))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: innerThreewayCornerFullFaces,
  };
}

/** Slope-package geometries, keyed by block id without namespace. */
export const SLOPE_GEOMETRY_SPECS: Readonly<Record<string, GeometrySpec>> = {
  framed_slope: slope(),
  framed_half_slope: halfSlope(),
  framed_vertical_half_slope: verticalHalfSlope(),
  framed_corner_slope: cornerSlope(),
  framed_inner_corner_slope: innerCornerSlope(),
  framed_prism_corner: prismCorner(),
  framed_inner_prism_corner: innerPrismCorner(),
  framed_threeway_corner: threewayCorner(),
  framed_inner_threeway_corner: innerThreewayCorner(),
};
