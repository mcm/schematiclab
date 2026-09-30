// Hand ports of FramedBlocks' `client/model/geometry/prism/*Geometry.java`
// (prisms, sloped prisms and their elevated inner forms) and their
// `FullFacePredicate`s. Read by `scripts/generate-camo-shapes.mts` through
// `GEOMETRY_SPECS`; the double blocks built from these are in
// `DOUBLE_BLOCK_SPECS` (`template-specs.ts`).
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class.

import type { Axis, Direction } from "../../../src/lib/render/camo/shape-pack";
import {
  BOOL,
  COMPOUND_DIRECTION,
  DIRECTION_AXIS,
  DIRECTIONS,
  Modifiers,
  QuadModifier,
  axisOf,
  clockWise,
  counterClockWise,
  fromAxis,
  isTrue,
  isY,
  opposite,
  type GeometrySpec,
} from "./geometry-api.ts";

/** `DirectionAxis.direction()` and `axis()`. */
function directionAxis(value: string): [Direction, Axis] {
  const [direction, axis] = value.split("_");
  return [direction as Direction, axis as Axis];
}

/** `CompoundDirection.direction()` and `orientation()`. */
function compoundDirection(value: string): [Direction, Direction] {
  const [direction, orientation] = value.split("_");
  return [direction as Direction, orientation as Direction];
}

// ── Geometries ─────────────────────────────────────────────────────────────

/** `prism/FramedPrismGeometry.java` */
function prism(): GeometrySpec {
  return {
    properties: { facing_axis: DIRECTION_AXIS, alt_slope: BOOL },
    geometry: (s) => {
      const [facing, axis] = directionAxis(s.facing_axis);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const yFacing = isY(facing);
        const yAxis = axis === "y";
        const quadFace = quadDir;
        const quadOnAxis = axisOf(quadFace) === axis;
        const quadOnFacingAxis = axisOf(quadFace) === axisOf(facing);

        if (!altSlope && yFacing && !quadOnAxis && !quadOnFacingAxis) {
          // Slopes for Y facing without Y_SLOPE
          const up = facing === "up";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(facing, 0.5))
            .apply(Modifiers.makeVerticalSlope(up, 45))
            .export(quadMap, null);
        } else if (altSlope && yFacing && isY(quadFace)) {
          // Slopes for Y facing with Y_SLOPE
          const onAxis: Direction = fromAxis(axis, true);
          const offAxisCW: Direction = clockWise(onAxis);
          const offAxisCCW: Direction = counterClockWise(onAxis);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(offAxisCW, 0.5))
            .apply(Modifiers.makeVerticalSlope(offAxisCCW, 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(offAxisCCW, 0.5))
            .apply(Modifiers.makeVerticalSlope(offAxisCW, 45))
            .export(quadMap, null);
        } else if (!yFacing && yAxis && !quadOnAxis && !quadOnFacingAxis) {
          // Slopes for horizontal facing and vertical axis
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(facing, 0.5))
            .apply(
              Modifiers.makeHorizontalSlope(
                quadFace === counterClockWise(facing),
                45,
              ),
            )
            .export(quadMap, null);
        } else if (!altSlope && !yFacing && !yAxis && quadFace === facing) {
          // Slopes for horizontal facing and horizontal axis without Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 0.5))
            .apply(Modifiers.makeVerticalSlope(false, 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("down", 0.5))
            .apply(Modifiers.makeVerticalSlope(true, 45))
            .export(quadMap, null);
        } else if (altSlope && !yFacing && !yAxis && isY(quadFace)) {
          // Slopes for horizontal facing and horizontal axis with Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(facing, 0.5))
            .apply(Modifiers.makeVerticalSlope(facing, 45))
            .export(quadMap, null);
        } else if (axisOf(quadFace) === axis) {
          // Triangles
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(facing))
            .export(quadMap, quadFace);
        }
      };
    },
    fullFaces: (s) =>
      // `PrismFullFacePredicate`
      [opposite(directionAxis(s.facing_axis)[0])],
  };
}

/** `prism/FramedElevatedInnerPrismGeometry.java` */
function elevatedInnerPrism(): GeometrySpec {
  return {
    properties: { facing_axis: DIRECTION_AXIS, alt_slope: BOOL },
    geometry: (s) => {
      const [facing, axis] = directionAxis(s.facing_axis);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const yFacing = isY(facing);
        const yAxis = axis === "y";
        const quadFace = quadDir;
        const quadOnFacingAxis = axisOf(quadFace) === axisOf(facing);
        const quadOnAxis = axisOf(quadFace) === axis;

        if (!altSlope && yFacing && !quadOnAxis && !quadOnFacingAxis) {
          // Slopes for Y facing without Y_SLOPE
          const up = facing === "up";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(facing), 0.5))
            .apply(Modifiers.makeVerticalSlope(up, 45))
            .export(quadMap, null);
        } else if (altSlope && yFacing && quadFace === facing) {
          // Slopes for Y facing with Y_SLOPE
          const onAxis: Direction = fromAxis(axis, true);

          const offAxisCW: Direction = clockWise(onAxis);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(offAxisCW, 0.5))
            .apply(Modifiers.makeVerticalSlope(offAxisCW, 45))
            .export(quadMap, null);

          const offAxisCCW: Direction = counterClockWise(onAxis);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(offAxisCCW, 0.5))
            .apply(Modifiers.makeVerticalSlope(offAxisCCW, 45))
            .export(quadMap, null);
        } else if (!yFacing && yAxis && !quadOnAxis && quadOnFacingAxis) {
          // Slopes for horizontal facing and Y axis without Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(facing), 0.5))
            .apply(Modifiers.makeHorizontalSlope(true, 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(counterClockWise(facing), 0.5))
            .apply(Modifiers.makeHorizontalSlope(false, 45))
            .export(quadMap, null);
        } else if (!altSlope && !yFacing && !yAxis && quadFace === facing) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 0.5))
            .apply(Modifiers.makeVerticalSlope(true, 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("down", 0.5))
            .apply(Modifiers.makeVerticalSlope(false, 45))
            .export(quadMap, null);
        } else if (altSlope && !yFacing && !yAxis && isY(quadFace)) {
          // Slopes for horizontal facing and Y axis with Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(facing), 0.5))
            .apply(Modifiers.makeVerticalSlope(facing, 45))
            .export(quadMap, null);
        } else if (quadOnAxis) {
          if (yAxis) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(facing), 0.5))
              .apply(Modifiers.cut(facing, 0, 1))
              .export(quadMap, quadFace);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(facing), 0.5))
              .apply(Modifiers.cut(facing, 1, 0))
              .export(quadMap, quadFace);
          } else if (yFacing) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(quadFace), 0.5))
              .apply(Modifiers.cut(facing, 0, 1))
              .export(quadMap, quadFace);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(quadFace), 0.5))
              .apply(Modifiers.cut(facing, 1, 0))
              .export(quadMap, quadFace);
          } else {
            //!yAxis && !yFacing
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut("down", 0.5))
              .apply(Modifiers.cut(facing, 1, 0))
              .export(quadMap, quadFace);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut("up", 0.5))
              .apply(Modifiers.cut(facing, 0, 1))
              .export(quadMap, quadFace);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `ElevatedInnerPrismFullFacePredicate`
      const [facing, axis] = directionAxis(s.facing_axis);
      return DIRECTIONS.filter(
        (side) => side !== facing && axisOf(side) !== axis,
      );
    },
    transformAllQuads: (s) => {
      const [facing, axis] = directionAxis(s.facing_axis);
      return isTrue(s.alt_slope) || isY(facing) || axis === "y";
    },
  };
}

/** `prism/FramedSlopedPrismGeometry.java` */
function slopedPrism(): GeometrySpec {
  return {
    properties: { facing_dir: COMPOUND_DIRECTION, alt_slope: BOOL },
    geometry: (s) => {
      const [facing, orientation] = compoundDirection(s.facing_dir);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const yFacing = isY(facing);
        const yOrient = isY(orientation);
        const orientOpp: Direction = opposite(orientation);
        const quadFace = quadDir;

        if (quadFace === orientOpp && !yOrient) {
          if (!yFacing) {
            // Triangle for horizontal facing and horizontal orientation
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutSmallTriangle(facing))
              .apply(
                Modifiers.makeHorizontalSlope(
                  orientation === clockWise(facing),
                  45,
                ),
              )
              .export(quadMap, null);
          } else if (!altSlope) {
            // Triangle for horizontal facing and vertical orientation without Y_SLOPE
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutSmallTriangle(facing))
              .apply(Modifiers.makeVerticalSlope(facing === "up", 45))
              .export(quadMap, null);
          }
        } else if (altSlope && yFacing && isY(quadFace)) {
          // Triangle and slopes for vertical facing with Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(orientation))
            .apply(Modifiers.makeVerticalSlope(orientOpp, 45))
            .export(quadMap, null);

          const offAxisCW: Direction = clockWise(orientation);
          const offAxisCCW: Direction = counterClockWise(orientation);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(offAxisCW, 0.5))
            .apply(Modifiers.cut(orientOpp, 1, 0))
            .apply(Modifiers.makeVerticalSlope(offAxisCCW, 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(offAxisCCW, 0.5))
            .apply(Modifiers.cut(orientOpp, 0, 1))
            .apply(Modifiers.makeVerticalSlope(offAxisCW, 45))
            .export(quadMap, null);
        } else if (!altSlope && yOrient && quadFace === facing) {
          // Tilted triangle for horizontal facing and vertical orientation without Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(orientation))
            .apply(Modifiers.makeVerticalSlope(orientation === "down", 45))
            .export(quadMap, null);
        } else if (altSlope && yOrient && quadFace === orientOpp) {
          // Tilted triangle for horizontal facing and vertical orientation with Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(facing))
            .apply(Modifiers.makeVerticalSlope(facing, 45))
            .export(quadMap, null);
        } else if (quadFace === orientation) {
          // Triangle
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSmallTriangle(facing))
            .export(quadMap, quadFace);
        } else if (
          !altSlope &&
          yFacing &&
          axisOf(quadFace) === axisOf(clockWise(orientation))
        ) {
          // Slopes for Y facing without Y_SLOPE
          const up = facing === "up";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(facing, 0.5))
            .apply(Modifiers.cut(opposite(orientation), up ? 0 : 1, up ? 1 : 0))
            .apply(Modifiers.makeVerticalSlope(up, 45))
            .export(quadMap, null);
        } else if (yOrient && axisOf(quadFace) === axisOf(clockWise(facing))) {
          // Slopes for horizontal facing and vertical orientation
          const right = quadFace === clockWise(facing);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(facing, 0.5))
            .apply(
              Modifiers.cut(
                opposite(orientation),
                right ? 1 : 0,
                right ? 0 : 1,
              ),
            )
            .apply(
              Modifiers.makeHorizontalSlope(
                quadFace === counterClockWise(facing),
                45,
              ),
            )
            .export(quadMap, null);
        } else if (!altSlope && !yOrient && !yFacing && quadFace === facing) {
          // Slopes for horizontal facing and horizontal orientation without Y_SLOPE
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 0.5))
            .apply(Modifiers.cut(opposite(orientation), 0, 1))
            .apply(Modifiers.makeVerticalSlope(false, 45))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("down", 0.5))
            .apply(Modifiers.cut(opposite(orientation), 1, 0))
            .apply(Modifiers.makeVerticalSlope(true, 45))
            .export(quadMap, null);
        } else if (altSlope && !yOrient && !yFacing && isY(quadFace)) {
          // Slopes for horizontal facing and horizontal orientation with Y_SLOPE
          const right = orientation === clockWise(facing);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(facing, 0.5))
            .apply(Modifiers.cut(orientOpp, right ? 0 : 1, right ? 1 : 0))
            .apply(Modifiers.makeVerticalSlope(facing, 45))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: (s) =>
      // `SlopedPrismFullFacePredicate`
      [opposite(compoundDirection(s.facing_dir)[0])],
  };
}

/** `prism/FramedElevatedInnerSlopedPrismGeometry.java` */
function elevatedInnerSlopedPrism(): GeometrySpec {
  return {
    properties: { facing_dir: COMPOUND_DIRECTION, alt_slope: BOOL },
    geometry: (s) => {
      const [facing, orientation] = compoundDirection(s.facing_dir);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const yFacing = isY(facing);
        const yOrient = isY(orientation);
        const quadFace = quadDir;

        if (quadFace === facing) {
          if (altSlope && yFacing) {
            const up = orientation === "up";

            // Tilted triangle for vertical facing with Y_SLOPE
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutSmallTriangle(orientation))
              .apply(Modifiers.makeVerticalSlope(orientation, up ? -45 : 45))
              .export(quadMap, null);

            // Side slope for vertical facing with Y_SLOPE
            const oriCW: Direction = clockWise(orientation);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(oriCW, 0.5))
              .apply(Modifiers.cut(opposite(orientation), 1, 0))
              .apply(Modifiers.makeVerticalSlope(oriCW, up ? -45 : 45))
              .export(quadMap, null);

            // Side slope for vertical facing with Y_SLOPE
            const oriCCW: Direction = counterClockWise(orientation);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(oriCCW, 0.5))
              .apply(Modifiers.cut(opposite(orientation), 0, 1))
              .apply(Modifiers.makeVerticalSlope(oriCCW, up ? -45 : 45))
              .export(quadMap, null);
          } else if (!altSlope && !yFacing && yOrient) {
            // Tilted triangle for horizontal facing and vertical orientation without Y_SLOPE
            const up = orientation === "up";
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutSmallTriangle(orientation))
              .apply(Modifiers.makeVerticalSlope(up, 45))
              .export(quadMap, null);
          }

          if (!yFacing && !yOrient) {
            // Tilted triangle for horizontal facing and horizontal orientation
            const right = orientation === clockWise(facing);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(orientation, 0.5))
              .apply(Modifiers.cutSmallTriangle(orientation))
              .apply(Modifiers.makeHorizontalSlope(right, 45))
              .export(quadMap, null);

            if (!altSlope) {
              // Side slope for horizontal facing and horizontal orientation without Y_SLOPE
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut("down", 0.5))
                .apply(Modifiers.cut(opposite(orientation), 1, 0))
                .apply(Modifiers.makeVerticalSlope(false, 45))
                .export(quadMap, null);

              // Side slope for horizontal facing and horizontal orientation without Y_SLOPE
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut("up", 0.5))
                .apply(Modifiers.cut(opposite(orientation), 0, 1))
                .apply(Modifiers.makeVerticalSlope(true, 45))
                .export(quadMap, null);
            }
          } else if (!yFacing /* && yOrient*/) {
            // Side slope for horizontal facing and vertical orientation
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(quadFace), 0.5))
              .apply(Modifiers.cut(opposite(orientation), 0, 1))
              .apply(Modifiers.makeHorizontalSlope(true, 45))
              .export(quadMap, null);

            // Side slope for horizontal facing and vertical orientation
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(quadFace), 0.5))
              .apply(Modifiers.cut(opposite(orientation), 1, 0))
              .apply(Modifiers.makeHorizontalSlope(false, 45))
              .export(quadMap, null);
          }
        } else if (quadFace === orientation) {
          if (yOrient) {
            // Front face for horizontal facing and vertical orientation
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(facing), 0.5))
              .apply(Modifiers.cut(facing, 0, 1))
              .export(quadMap, quadFace);

            // Front face for horizontal facing and vertical orientation
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(facing), 0.5))
              .apply(Modifiers.cut(facing, 1, 0))
              .export(quadMap, quadFace);

            if (altSlope) {
              // Tilted triangle for horizontal facing and vertical orientation with Y_SLOPE
              QuadModifier.of(quadDir)
                .apply(Modifiers.cutSmallTriangle(opposite(facing)))
                .apply(Modifiers.makeVerticalSlope(facing, 45))
                .export(quadMap, null);
            }
          } else if (yFacing) {
            // Front face for vertical facing
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(quadFace), 0.5))
              .apply(Modifiers.cut(facing, 0, 1))
              .export(quadMap, quadFace);

            // Front face for vertical facing
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(quadFace), 0.5))
              .apply(Modifiers.cut(facing, 1, 0))
              .export(quadMap, quadFace);

            if (!altSlope) {
              // Tilted triangle for vertical facing without Y_SLOPE
              const up = facing === "up";
              QuadModifier.of(quadDir)
                .apply(Modifiers.cutSmallTriangle(opposite(facing)))
                .apply(Modifiers.makeVerticalSlope(up, 45))
                .export(quadMap, null);
            }
          } else {
            //!yOrient && !yFacing
            // Front face for horizontal facing and horizontal orientation
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut("down", 0.5))
              .apply(Modifiers.cut(facing, 1, 0))
              .export(quadMap, quadFace);

            // Front face for horizontal facing and horizontal orientation
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut("up", 0.5))
              .apply(Modifiers.cut(facing, 0, 1))
              .export(quadMap, quadFace);
          }
        } else if (
          axisOf(quadFace) != axisOf(orientation) &&
          axisOf(quadFace) != axisOf(facing)
        ) {
          if (altSlope && !yFacing && !yOrient) {
            // Side slope for horizontal facing and horizontal orientation with Y_SLOPE
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(facing), 0.5))
              .apply(Modifiers.cut(opposite(orientation), 1, 0))
              .apply(Modifiers.makeVerticalSlope(facing, 45))
              .export(quadMap, null);

            // Side slope for horizontal facing and horizontal orientation with Y_SLOPE
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(facing), 0.5))
              .apply(Modifiers.cut(opposite(orientation), 0, 1))
              .apply(Modifiers.makeVerticalSlope(facing, 45))
              .export(quadMap, null);
          } else if (!altSlope && yFacing) {
            // Side slope for vertical facing without Y_SLOPE
            const up = facing === "up";
            const top = up ? 1 : 0;
            const bottom = up ? 0 : 1;
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(facing), 0.5))
              .apply(Modifiers.cut(opposite(orientation), top, bottom))
              .apply(Modifiers.makeVerticalSlope(up, 45))
              .export(quadMap, null);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `ElevatedInnerSlopedPrismFullFacePredicate`
      const [facing, orientation] = compoundDirection(s.facing_dir);
      return DIRECTIONS.filter(
        (side) => side !== facing && side !== orientation,
      );
    },
    transformAllQuads: (s) => {
      const [facing, orientation] = compoundDirection(s.facing_dir);
      return isTrue(s.alt_slope) || isY(facing) || isY(orientation);
    },
  };
}

/** Prism-package geometries, keyed by block id without namespace. */
export const PRISM_GEOMETRY_SPECS: Readonly<Record<string, GeometrySpec>> = {
  framed_prism: prism(),
  framed_elevated_inner_prism: elevatedInnerPrism(),
  framed_sloped_prism: slopedPrism(),
  framed_elevated_inner_sloped_prism: elevatedInnerSlopedPrism(),
};
