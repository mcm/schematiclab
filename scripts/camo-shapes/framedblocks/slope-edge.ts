// Hand ports of FramedBlocks' `client/model/geometry/slopeedge/*Geometry.java`
// (slope edges and their corner, threeway, elevated, slab and panel forms)
// and their `FullFacePredicate`s. Read by `scripts/generate-camo-shapes.mts`
// through `GEOMETRY_SPECS`; the double and stacked blocks built from these
// are in `DOUBLE_BLOCK_SPECS` (`template-specs.ts`).
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class.

import type { Direction } from "../../../src/lib/render/camo/shape-pack";
import {
  BOOL,
  CORNER_TYPE,
  CornerType,
  HORIZONTAL,
  Modifiers,
  QuadModifier,
  SLOPE_TYPE,
  clockWise,
  counterClockWise,
  isTrue,
  isY,
  opposite,
  type BlockState,
  type GeometrySpec,
} from "./geometry-api.ts";
import { cornerFullFaces, innerCornerFullFaces } from "./slope.ts";

/** `HorizontalRotation`. */
const HORIZONTAL_ROTATION = ["up", "down", "right", "left"] as const;

/** `HorizontalRotation.withFacing(dir)`. */
function withFacing(rotation: string, dir: Direction): Direction {
  switch (rotation) {
    case "up":
      return "up";
    case "down":
      return "down";
    case "right":
      return clockWise(dir);
    default:
      return counterClockWise(dir);
  }
}

/** `ElevatedSlopeEdgeFullFacePredicate`. */
function elevatedSlopeEdgeFullFaces(s: BlockState): Direction[] {
  const dir = s.facing as Direction;
  switch (s.type) {
    case "bottom":
      return [dir, "down"];
    case "horizontal":
      return [dir, counterClockWise(dir)];
    default:
      return [dir, "up"];
  }
}

// ── Geometries ─────────────────────────────────────────────────────────────

/** `slopeedge/FramedSlopeEdgeGeometry.java` */
function slopeEdge(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      type: SLOPE_TYPE,
      alt_type: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altType = isTrue(s.alt_type);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const top = type === "top";
        if (altType) {
          if (type === "horizontal") {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (quadDir === counterClockWise(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            } else if (altSlope && quadDir === clockWise(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            } else if (isY(quadDir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.cut(opposite(dir), 1.5, 0.5))
                .apply(Modifiers.cut(dir, 0.5))
                .export(quadMap, quadDir);
            }
          } else {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(top ? "up" : "down", 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (
              (!top && quadDir === "down") ||
              (top && quadDir === "up")
            ) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(top ? "up" : "down", 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            } else if (
              altSlope &&
              ((!top && quadDir === "up") || (top && quadDir === "down"))
            ) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(top ? "down" : "up", 0.5))
                .export(quadMap, null);
            } else if (
              quadDir === clockWise(dir) ||
              quadDir === counterClockWise(dir)
            ) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(top ? "up" : "down", 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.cut(dir, 0.5))
                .export(quadMap, quadDir);
            }
          }
          return;
        }

        if (type === "horizontal") {
          if (!altSlope && quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.makeHorizontalSlope(false, 45))
              .apply(Modifiers.offset(dir, 0.5))
              .export(quadMap, null);
          } else if (altSlope && quadDir === clockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.makeHorizontalSlope(true, 45))
              .apply(Modifiers.offset(counterClockWise(dir), 0.5))
              .export(quadMap, null);
          } else if (isY(quadDir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.cut(opposite(dir), 0.5, -0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === dir) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === counterClockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);
          }
        } else {
          if (!altSlope && quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(top ? "down" : "up", 0.5))
              .apply(Modifiers.makeVerticalSlope(!top, 45))
              .apply(Modifiers.offset(dir, 0.5))
              .export(quadMap, null);
          } else if (
            altSlope &&
            ((!top && quadDir === "up") || (top && quadDir === "down"))
          ) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
              .apply(Modifiers.offset(top ? "up" : "down", 0.5))
              .export(quadMap, null);
          } else if (
            quadDir === clockWise(dir) ||
            quadDir === counterClockWise(dir)
          ) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(top ? "down" : "up", 0.5))
              .apply(
                Modifiers.cut(
                  opposite(dir),
                  top ? 0.5 : -0.5,
                  top ? -0.5 : 0.5,
                ),
              )
              .export(quadMap, quadDir);
          } else if (quadDir === dir) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(top ? "down" : "up", 0.5))
              .export(quadMap, quadDir);
          } else if (
            (!top && quadDir === "down") ||
            (top && quadDir === "up")
          ) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);
          }
        }
      };
    },
  };
}

/** `slopeedge/FramedElevatedSlopeEdgeGeometry.java` */
function elevatedSlopeEdge(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, type: SLOPE_TYPE, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (type === "horizontal") {
          if (quadDir === opposite(dir)) {
            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === clockWise(dir)) {
            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);
          } else if (isY(quadDir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.cut(opposite(dir), 1.5, 0.5))
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .export(quadMap, quadDir);
          }
        } else {
          const top = type === "top";
          const vertEdge: Direction = top ? "down" : "up";
          if (quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(vertEdge, 0.5))
              .export(quadMap, quadDir);

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(vertEdge), 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }
          } else if (
            (!top && quadDir === "up") ||
            (top && quadDir === "down")
          ) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);

            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(top ? "down" : "up", 0.5))
                .export(quadMap, null);
            }
          } else if (
            quadDir === clockWise(dir) ||
            quadDir === counterClockWise(dir)
          ) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(vertEdge), 0.5))
              .apply(
                Modifiers.cut(opposite(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(vertEdge, 0.5))
              .export(quadMap, quadDir);
          }
        }
      };
    },
    fullFaces: elevatedSlopeEdgeFullFaces,
  };
}

/** `slopeedge/FramedCornerSlopeEdgeGeometry.java` */
function cornerSlopeEdge(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      type: CORNER_TYPE,
      alt_type: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altType = isTrue(s.alt_type);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (CornerType.isHorizontal(type)) {
          const top = CornerType.isTop(type);
          const right = CornerType.isRight(type);
          const xBackFace: Direction = right
            ? clockWise(dir)
            : counterClockWise(dir);
          const yBackFace: Direction = top ? "up" : "down";
          if (altType) {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (quadDir === yBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(opposite(xBackFace), 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    right ? 1.5 : 0.5,
                    right ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.cut(xBackFace, 0.5))
                .export(quadMap, quadDir);
            } else if (quadDir === xBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 0.5 : 1.5,
                    right ? 1.5 : 0.5,
                  ),
                )
                .apply(Modifiers.cut(yBackFace, 0.5))
                .export(quadMap, quadDir);
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(opposite(xBackFace), top ? 0 : 1, top ? 1 : 0),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 1 : 0,
                    right ? 0 : 1,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(right, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            } else if (altSlope && quadDir === opposite(yBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    right ? 1.5 : 0.5,
                    right ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(opposite(yBackFace), 0.5))
                .export(quadMap, null);
            } else if (altSlope && quadDir === opposite(xBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 1.5 : 0.5,
                    right ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(!right, 45))
                .apply(Modifiers.offset(opposite(xBackFace), 0.5))
                .export(quadMap, null);
            }
          } else {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(xBackFace), 0.5))
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .export(quadMap, quadDir);
            } else if (quadDir === yBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    right ? 0.5 : -0.5,
                    right ? -0.5 : 0.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (quadDir === xBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? -0.5 : 0.5,
                    right ? 0.5 : -0.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    top ? 0 : 0.5,
                    top ? 0.5 : 0,
                  ),
                )
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(xBackFace, top ? 1 : 0.5, top ? 0.5 : 1))
                .apply(Modifiers.cut(opposite(xBackFace), 0.5))
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.makeHorizontalSlope(right, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);
            } else if (altSlope && quadDir === opposite(yBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    right ? 0.5 : -0.5,
                    right ? -0.5 : 0.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(yBackFace, 0.5))
                .export(quadMap, null);
            } else if (altSlope && quadDir === opposite(xBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 0.5 : -0.5,
                    right ? -0.5 : 0.5,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(!right, 45))
                .apply(Modifiers.offset(xBackFace, 0.5))
                .export(quadMap, null);
            }
          }
        } else {
          const top = type === "top";
          const bottomFace: Direction = top ? "up" : "down";
          if (altType) {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (quadDir === counterClockWise(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (quadDir === bottomFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            } else if (!altSlope && quadDir === clockWise(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            } else if (altSlope && quadDir === opposite(bottomFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 1, 0))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(opposite(bottomFace), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.cut(opposite(dir), 0, 1))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(opposite(bottomFace), 0.5))
                .export(quadMap, null);
            }
          } else {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (quadDir === counterClockWise(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (quadDir === bottomFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .export(quadMap, quadDir);
            } else if (altSlope && quadDir === opposite(bottomFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.cut(clockWise(dir), 1, 0))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(bottomFace, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.cut(opposite(dir), 0, 1))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(bottomFace, 0.5))
                .export(quadMap, null);
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);
            } else if (!altSlope && quadDir === clockWise(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                .export(quadMap, null);
            }
          }
        }
      };
    },
  };
}

/** `slopeedge/FramedInnerCornerSlopeEdgeGeometry.java` */
function innerCornerSlopeEdge(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      type: CORNER_TYPE,
      alt_type: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altType = isTrue(s.alt_type);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const top = CornerType.isTop(type);
        if (CornerType.isHorizontal(type)) {
          const right = CornerType.isRight(type);
          const xBackFace: Direction = right
            ? clockWise(dir)
            : counterClockWise(dir);
          const yBackFace: Direction = top ? "up" : "down";
          if (altType) {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (quadDir === yBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (quadDir === xBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (quadDir === opposite(yBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    right ? 1.5 : 0.5,
                    right ? 0.5 : 1.5,
                  ),
                )
                .export(quadMap, quadDir);

              if (altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(dir, 0.5))
                  .apply(Modifiers.cut(xBackFace, 0.5))
                  .apply(
                    Modifiers.cut(
                      xBackFace,
                      right ? 0.5 : -0.5,
                      right ? -0.5 : 0.5,
                    ),
                  )
                  .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                  .apply(Modifiers.offset(opposite(yBackFace), 0.5))
                  .export(quadMap, null);
              }
            } else if (quadDir === opposite(xBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 1.5 : 0.5,
                    right ? 0.5 : 1.5,
                  ),
                )
                .export(quadMap, quadDir);

              if (altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(dir, 0.5))
                  .apply(Modifiers.cut(yBackFace, 0.5))
                  .apply(
                    Modifiers.cut(
                      yBackFace,
                      right ? -0.5 : 0.5,
                      right ? 0.5 : -0.5,
                    ),
                  )
                  .apply(Modifiers.makeHorizontalSlope(!right, 45))
                  .apply(Modifiers.offset(opposite(xBackFace), 0.5))
                  .export(quadMap, null);
              }
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 1 : 0,
                    right ? 0 : 1,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(
                  Modifiers.cut(opposite(xBackFace), top ? 0 : 1, top ? 1 : 0),
                )
                .apply(Modifiers.makeHorizontalSlope(right, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }
          } else {
            if (quadDir === dir) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .export(quadMap, quadDir);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(xBackFace), 0.5))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .export(quadMap, quadDir);
            } else if (quadDir === yBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .export(quadMap, quadDir);
            } else if (quadDir === xBackFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .export(quadMap, quadDir);
            } else if (quadDir === opposite(yBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    right ? 0.5 : -0.5,
                    right ? -0.5 : 0.5,
                  ),
                )
                .export(quadMap, quadDir);

              if (altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(opposite(dir), 0.5))
                  .apply(
                    Modifiers.cut(
                      xBackFace,
                      right ? 1.5 : 0.5,
                      right ? 0.5 : 1.5,
                    ),
                  )
                  .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                  .apply(Modifiers.offset(yBackFace, 0.5))
                  .export(quadMap, null);
              }
            } else if (quadDir === opposite(xBackFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 0.5 : -0.5,
                    right ? -0.5 : 0.5,
                  ),
                )
                .export(quadMap, quadDir);

              if (altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(opposite(dir), 0.5))
                  .apply(
                    Modifiers.cut(
                      yBackFace,
                      right ? 0.5 : 1.5,
                      right ? 1.5 : 0.5,
                    ),
                  )
                  .apply(Modifiers.makeHorizontalSlope(!right, 45))
                  .apply(Modifiers.offset(xBackFace, 0.5))
                  .export(quadMap, null);
              }
            } else if (!altSlope && quadDir === opposite(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(xBackFace), 0.5))
                .apply(Modifiers.cut(yBackFace, right ? 0 : 1, right ? 1 : 0))
                .apply(Modifiers.makeHorizontalSlope(right, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(xBackFace, top ? 1 : 0, top ? 0 : 1))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);
            }
          }
        } else {
          const bottomFace: Direction = top ? "up" : "down";
          if (altType) {
            if (quadDir === dir || quadDir === counterClockWise(dir)) {
              const cutDir: Direction =
                quadDir === dir ? counterClockWise(dir) : dir;
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(Modifiers.cut(cutDir, 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (quadDir === bottomFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.setPosition(0.5))
                .export(quadMap, null);
            } else if (altSlope && quadDir === opposite(bottomFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.cut(dir, 0, 1))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(opposite(bottomFace), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 1, 0))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(opposite(bottomFace), 0.5))
                .export(quadMap, null);
            } else if (quadDir === opposite(dir)) {
              if (!altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(bottomFace, 0.5))
                  .apply(
                    Modifiers.cut(
                      counterClockWise(dir),
                      top ? -0.5 : 0.5,
                      top ? 0.5 : -0.5,
                    ),
                  )
                  .apply(Modifiers.makeVerticalSlope(!top, 45))
                  .apply(Modifiers.offset(opposite(dir), 0.5))
                  .export(quadMap, null);
              }

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (quadDir === clockWise(dir)) {
              if (!altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(bottomFace, 0.5))
                  .apply(Modifiers.cut(dir, top ? -0.5 : 0.5, top ? 0.5 : -0.5))
                  .apply(Modifiers.makeVerticalSlope(!top, 45))
                  .apply(Modifiers.offset(clockWise(dir), 0.5))
                  .export(quadMap, null);
              }

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(bottomFace, 0.5))
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .export(quadMap, quadDir);
            }
          } else {
            if (quadDir === dir || quadDir === counterClockWise(dir)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                .export(quadMap, quadDir);
            } else if (quadDir === bottomFace) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .export(quadMap, quadDir);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .export(quadMap, quadDir);
            } else if (altSlope && quadDir === opposite(bottomFace)) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 1, 0))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(bottomFace, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.cut(dir, 0, 1))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(bottomFace, 0.5))
                .export(quadMap, null);
            } else if (quadDir === opposite(dir)) {
              if (!altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                  .apply(
                    Modifiers.cut(
                      counterClockWise(dir),
                      top ? 0.5 : 1.5,
                      top ? 1.5 : 0.5,
                    ),
                  )
                  .apply(Modifiers.makeVerticalSlope(!top, 45))
                  .apply(Modifiers.offset(dir, 0.5))
                  .export(quadMap, null);
              }

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .export(quadMap, quadDir);
            } else if (quadDir === clockWise(dir)) {
              if (!altSlope) {
                QuadModifier.of(quadDir)
                  .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                  .apply(Modifiers.cut(dir, top ? 0.5 : 1.5, top ? 1.5 : 0.5))
                  .apply(Modifiers.makeVerticalSlope(!top, 45))
                  .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                  .export(quadMap, null);
              }

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(bottomFace), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .export(quadMap, quadDir);
            }
          }
        }
      };
    },
  };
}

/** `slopeedge/FramedElevatedCornerSlopeEdgeGeometry.java` */
function elevatedCornerSlopeEdge(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, type: CORNER_TYPE, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (CornerType.isHorizontal(type)) {
          const top = CornerType.isTop(type);
          const right = CornerType.isRight(type);
          const xBackFace: Direction = right
            ? clockWise(dir)
            : counterClockWise(dir);
          const yBackFace: Direction = top ? "up" : "down";
          if (quadDir === opposite(dir)) {
            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(opposite(xBackFace), top ? 0 : 1, top ? 1 : 0),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 1 : 0,
                    right ? 0 : 1,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(right, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .apply(Modifiers.cut(opposite(xBackFace), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === xBackFace) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(
                Modifiers.cut(opposite(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === yBackFace) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(xBackFace, 0.5))
              .apply(
                Modifiers.cut(
                  opposite(dir),
                  right ? 0.5 : 1.5,
                  right ? 1.5 : 0.5,
                ),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(xBackFace), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(xBackFace)) {
            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 1.5 : 0.5,
                    right ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(!right, 45))
                .apply(Modifiers.offset(opposite(xBackFace), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(yBackFace)) {
            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(xBackFace),
                    right ? 1.5 : 0.5,
                    right ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(opposite(yBackFace), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);
          }
        } else {
          const top = type === "top";
          const topDir: Direction = top ? "down" : "up";
          if (quadDir === dir) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(topDir), 0.5))
              .apply(
                Modifiers.cut(clockWise(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(topDir, 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === counterClockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(topDir), 0.5))
              .apply(
                Modifiers.cut(opposite(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(topDir, 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(dir)) {
            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(topDir), 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(topDir, 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === clockWise(dir)) {
            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(topDir), 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(topDir, 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === topDir) {
            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 1, 0))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(topDir, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.cut(opposite(dir), 0, 1))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(topDir, 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .export(quadMap, quadDir);
          }
        }
      };
    },
    fullFaces: cornerFullFaces,
  };
}

/** `slopeedge/FramedElevatedInnerCornerSlopeEdgeGeometry.java` */
function elevatedInnerCornerSlopeEdge(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, type: CORNER_TYPE, alt_slope: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const type = s.type;
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (CornerType.isHorizontal(type)) {
          const top = CornerType.isTop(type);
          const right = CornerType.isRight(type);
          const xBackFace: Direction = right
            ? clockWise(dir)
            : counterClockWise(dir);
          const yBackFace: Direction = top ? "up" : "down";
          if (quadDir === opposite(dir)) {
            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(yBackFace),
                    right ? 1 : 0,
                    right ? 0 : 1,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(
                  Modifiers.cut(opposite(xBackFace), top ? 0 : 1, top ? 1 : 0),
                )
                .apply(Modifiers.makeHorizontalSlope(right, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(opposite(xBackFace), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(xBackFace)) {
            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    yBackFace,
                    right ? -0.5 : 0.5,
                    right ? 0.5 : -0.5,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(!right, 45))
                .apply(Modifiers.offset(opposite(xBackFace), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(
                Modifiers.cut(opposite(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(yBackFace)) {
            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(xBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    xBackFace,
                    right ? 0.5 : -0.5,
                    right ? -0.5 : 0.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(opposite(yBackFace), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(xBackFace, 0.5))
              .apply(
                Modifiers.cut(
                  opposite(dir),
                  right ? 0.5 : 1.5,
                  right ? 1.5 : 0.5,
                ),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(xBackFace), 0.5))
              .export(quadMap, quadDir);
          }
        } else {
          const top = type === "top";
          const topDir: Direction = top ? "down" : "up";
          if (quadDir === opposite(dir)) {
            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(topDir), 0.5))
                .apply(
                  Modifiers.cut(
                    counterClockWise(dir),
                    top ? -0.5 : 0.5,
                    top ? 0.5 : -0.5,
                  ),
                )
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(topDir), 0.5))
              .apply(
                Modifiers.cut(clockWise(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(topDir, 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === clockWise(dir)) {
            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(topDir), 0.5))
                .apply(Modifiers.cut(dir, top ? -0.5 : 0.5, top ? 0.5 : -0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(topDir), 0.5))
              .apply(
                Modifiers.cut(opposite(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(topDir, 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === topDir) {
            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.cut(dir, 0, 1))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(topDir, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 1, 0))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(topDir, 0.5))
                .export(quadMap, null);
            }

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .export(quadMap, quadDir);
          }
        }
      };
    },
    fullFaces: innerCornerFullFaces,
  };
}

/** `slopeedge/FramedThreewayCornerSlopeEdgeGeometry.java` */
function threewayCornerSlopeEdge(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      right: BOOL,
      alt_type: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const top = isTrue(s.top);
      const right = isTrue(s.right);
      const dir = right
        ? clockWise(s.facing as Direction)
        : (s.facing as Direction);
      const altType = isTrue(s.alt_type);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const yBackFace: Direction = top ? "up" : "down";
        if (altType) {
          if (quadDir === dir) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(
                Modifiers.cut(clockWise(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);
          } else if (quadDir === counterClockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(dir, 0.5))
              .apply(
                Modifiers.cut(opposite(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);
          } else if (quadDir === yBackFace) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.cut(clockWise(dir), 0.5, 1.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(dir)) {
            if (!right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.75))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .apply(
                  Modifiers.cut(
                    counterClockWise(dir),
                    top ? 1 : 0,
                    top ? 0 : 1,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.75))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.cut("up", top ? 1 : 1.5, top ? 0 : 0.5))
                .apply(Modifiers.cut("down", top ? 1.5 : 1, top ? 0.5 : 0))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }
          } else if (quadDir === clockWise(dir)) {
            if (right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.75))
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 1.5 : 0.5,
                    top ? 0.5 : 1.5,
                  ),
                )
                .apply(Modifiers.cut(dir, top ? 1 : 0, top ? 0 : 1))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(opposite(dir), 0.75))
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut("up", top ? 0 : 0.5, top ? 1 : 1.5))
                .apply(Modifiers.cut("down", top ? 0.5 : 0, top ? 1.5 : 1))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            }
          } else if (altSlope && quadDir === opposite(yBackFace)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
              .apply(Modifiers.offset(opposite(yBackFace), 0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
              .apply(Modifiers.offset(opposite(yBackFace), 0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.75))
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 1, 0))
              .apply(Modifiers.cut(clockWise(dir), 0.5, 1.5))
              .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
              .apply(Modifiers.offset(opposite(yBackFace), 0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.75))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.cut(dir, 0, 1))
              .apply(Modifiers.cut(opposite(dir), 1.5, 0.5))
              .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
              .apply(Modifiers.offset(opposite(yBackFace), 0.5))
              .export(quadMap, null);
          }
        } else {
          if (quadDir === dir) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .apply(
                Modifiers.cut(
                  clockWise(dir),
                  top ? 0.5 : -0.5,
                  top ? -0.5 : 0.5,
                ),
              )
              .export(quadMap, quadDir);
          } else if (quadDir === counterClockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .apply(
                Modifiers.cut(
                  opposite(dir),
                  top ? 0.5 : -0.5,
                  top ? -0.5 : 0.5,
                ),
              )
              .export(quadMap, quadDir);
          } else if (quadDir === yBackFace) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.cut(clockWise(dir), -0.5, 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(dir)) {
            if (!right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.25))
                .apply(
                  Modifiers.cut(
                    clockWise(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .apply(
                  Modifiers.cut(
                    counterClockWise(dir),
                    top ? 1 : 0,
                    top ? 0 : 1,
                  ),
                )
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.25))
                .apply(Modifiers.cut("up", top ? 1 : 0.5, top ? 0 : -0.5))
                .apply(Modifiers.cut("down", top ? 0.5 : 1, top ? -0.5 : 0))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);
            }
          } else if (quadDir === clockWise(dir)) {
            if (right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.25))
                .apply(
                  Modifiers.cut(
                    opposite(dir),
                    top ? 0.5 : -0.5,
                    top ? -0.5 : 0.5,
                  ),
                )
                .apply(Modifiers.cut(dir, top ? 1 : 0, top ? 0 : 1))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(opposite(dir), 0.25))
                .apply(Modifiers.cut("up", top ? 0 : -0.5, top ? 1 : 0.5))
                .apply(Modifiers.cut("down", top ? -0.5 : 0, top ? 0.5 : 1))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                .export(quadMap, null);
            }
          } else if (altSlope && quadDir === opposite(yBackFace)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.25))
              .apply(Modifiers.cut(clockWise(dir), -0.5, 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 1, 0))
              .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
              .apply(Modifiers.offset(yBackFace, 0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.25))
              .apply(Modifiers.cut(dir, 0, 1))
              .apply(Modifiers.cut(opposite(dir), 0.5, -0.5))
              .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
              .apply(Modifiers.offset(yBackFace, 0.5))
              .export(quadMap, null);
          }
        }
      };
    },
  };
}

/** `slopeedge/FramedInnerThreewayCornerSlopeEdgeGeometry.java` */
function innerThreewayCornerSlopeEdge(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      right: BOOL,
      alt_type: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const top = isTrue(s.top);
      const right = isTrue(s.right);
      const dir = right
        ? clockWise(s.facing as Direction)
        : (s.facing as Direction);
      const altType = isTrue(s.alt_type);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        const yBackFace: Direction = top ? "up" : "down";
        if (altType) {
          if (quadDir === dir || quadDir === counterClockWise(dir)) {
            const cutDir: Direction =
              quadDir === dir ? counterClockWise(dir) : dir;
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(cutDir, 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);
          } else if (quadDir === yBackFace) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);
          } else if (quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(
                Modifiers.cut(clockWise(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            if (!right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.25))
                .apply(
                  Modifiers.cut(
                    counterClockWise(dir),
                    top ? -0.5 : 0.5,
                    top ? 0.5 : -0.5,
                  ),
                )
                .apply(Modifiers.cut(clockWise(dir), top ? 0 : 1, top ? 1 : 0))
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.25))
                .apply(Modifiers.cut("up", top ? -0.5 : 0, top ? 0.5 : 1))
                .apply(Modifiers.cut("down", top ? 0 : -0.5, top ? 1 : 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(opposite(dir), 0.5))
                .export(quadMap, null);
            }
          } else if (quadDir === clockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(Modifiers.cut(dir, 0.5))
              .apply(
                Modifiers.cut(opposite(dir), top ? 1.5 : 0.5, top ? 0.5 : 1.5),
              )
              .export(quadMap, quadDir);

            if (right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.25))
                .apply(Modifiers.cut(dir, top ? -0.5 : 0.5, top ? 0.5 : -0.5))
                .apply(Modifiers.cut(opposite(dir), top ? 0 : 1, top ? 1 : 0))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.25))
                .apply(Modifiers.cut("up", top ? 0.5 : 1, top ? -0.5 : 0))
                .apply(Modifiers.cut("down", top ? 1 : 0.5, top ? 0 : -0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(clockWise(dir), 0.5))
                .export(quadMap, null);
            }
          } else if (quadDir === opposite(yBackFace)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.cut(counterClockWise(dir), 0.5))
              .apply(Modifiers.cut(clockWise(dir), 0.5, 1.5))
              .export(quadMap, quadDir);

            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.25))
                .apply(Modifiers.cut(clockWise(dir), 1, 0))
                .apply(Modifiers.cut(counterClockWise(dir), -0.5, 0.5))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(opposite(yBackFace), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.25))
                .apply(Modifiers.cut(dir, 0.5, -0.5))
                .apply(Modifiers.cut(opposite(dir), 0, 1))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(opposite(yBackFace), 0.5))
                .export(quadMap, null);
            }
          }
        } else {
          if (quadDir === dir || quadDir === counterClockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(yBackFace, 0.5))
              .apply(
                Modifiers.cut(
                  quadDir === dir ? clockWise(dir) : opposite(dir),
                  0.5,
                ),
              )
              .export(quadMap, quadDir);
          } else if (quadDir === yBackFace) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .export(quadMap, quadDir);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.cut(clockWise(dir), 0.5))
              .export(quadMap, quadDir);
          } else if (quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .apply(
                Modifiers.cut(
                  clockWise(dir),
                  top ? 0.5 : -0.5,
                  top ? -0.5 : 0.5,
                ),
              )
              .export(quadMap, quadDir);

            if (!right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.75))
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(
                  Modifiers.cut(
                    counterClockWise(dir),
                    top ? 0.5 : 1.5,
                    top ? 1.5 : 0.5,
                  ),
                )
                .apply(Modifiers.cut(clockWise(dir), top ? 0 : 1, top ? 1 : 0))
                .apply(Modifiers.makeHorizontalSlope(false, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.75))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.cut("up", top ? 0.5 : 0, top ? 1.5 : 1))
                .apply(Modifiers.cut("down", top ? 0 : 0.5, top ? 1 : 1.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(dir, 0.5))
                .export(quadMap, null);
            }
          } else if (quadDir === clockWise(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(yBackFace), 0.5))
              .apply(
                Modifiers.cut(
                  opposite(dir),
                  top ? 0.5 : -0.5,
                  top ? -0.5 : 0.5,
                ),
              )
              .export(quadMap, quadDir);

            if (right) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.5))
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(yBackFace, 0.75))
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(dir, top ? 0.5 : 1.5, top ? 1.5 : 0.5))
                .apply(Modifiers.cut(opposite(dir), top ? 0 : 1, top ? 1 : 0))
                .apply(Modifiers.makeHorizontalSlope(true, 45))
                .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                .export(quadMap, null);
            }

            if (!altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(opposite(yBackFace), 0.5))
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.75))
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.cut("up", top ? 1.5 : 1, top ? 0.5 : 0))
                .apply(Modifiers.cut("down", top ? 1 : 1.5, top ? 0 : 0.5))
                .apply(Modifiers.makeVerticalSlope(!top, 45))
                .apply(Modifiers.offset(counterClockWise(dir), 0.5))
                .export(quadMap, null);
            }
          } else if (quadDir === opposite(yBackFace)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(Modifiers.cut(clockWise(dir), -0.5, 0.5))
              .export(quadMap, quadDir);

            if (altSlope) {
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(yBackFace, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.5))
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(yBackFace, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.75))
                .apply(Modifiers.cut(opposite(dir), 0.5))
                .apply(Modifiers.cut(clockWise(dir), 1, 0))
                .apply(Modifiers.cut(counterClockWise(dir), 0.5, 1.5))
                .apply(Modifiers.makeVerticalSlope(clockWise(dir), 45))
                .apply(Modifiers.offset(yBackFace, 0.5))
                .export(quadMap, null);

              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(counterClockWise(dir), 0.75))
                .apply(Modifiers.cut(clockWise(dir), 0.5))
                .apply(Modifiers.cut(opposite(dir), 0, 1))
                .apply(Modifiers.cut(dir, 1.5, 0.5))
                .apply(Modifiers.makeVerticalSlope(opposite(dir), 45))
                .apply(Modifiers.offset(yBackFace, 0.5))
                .export(quadMap, null);
            }
          }
        }
      };
    },
  };
}

/** `slopeedge/FramedSlopeEdgeSlabGeometry.java` */
function slopeEdgeSlab(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      top_half: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const topHalf = isTrue(s.top_half);
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      const backfaceAligned = top === topHalf;
      return (quadDir, quadMap) => {
        const backFace: Direction = top ? "up" : "down";
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(topHalf ? "down" : "up", 0.5))
            .export(quadMap, dir);
        } else if (quadDir === backFace) {
          if (!backfaceAligned) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(backFace)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .applyIf(Modifiers.setPosition(0.5), backfaceAligned)
            .export(quadMap, backfaceAligned ? null : quadDir);

          if (altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(dir, 0.5))
              .apply(Modifiers.makeVerticalSlope(dir, -45))
              .apply(Modifiers.offset(backFace, backfaceAligned ? 1 : 0.5))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(dir)) {
          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(backFace), 0.5))
              .apply(Modifiers.makeVerticalSlope(top, -45))
              .apply(Modifiers.offset(dir, 1))
              .applyIf(
                Modifiers.offset(opposite(backFace), 0.5),
                !backfaceAligned,
              )
              .export(quadMap, null);
          }
        } else {
          const lenTop = (top ? 1 : 0) + (backfaceAligned ? 0 : 0.5);
          const lenBot = (top ? 0 : 1) + (backfaceAligned ? 0 : 0.5);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(topHalf ? "down" : "up", 0.5))
            .apply(Modifiers.cut(opposite(dir), lenTop, lenBot))
            .export(quadMap, quadDir);
        }
      };
    },
    fullFaces: (s) => {
      // `SlopeSlabFullFacePredicate`
      const topHalf = isTrue(s.top_half);
      if (isTrue(s.top)) return topHalf ? ["up"] : [];
      return topHalf ? [] : ["down"];
    },
  };
}

/** `slopeedge/FramedSlopeEdgePanelGeometry.java` */
function slopeEdgePanel(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      rotation: HORIZONTAL_ROTATION,
      front: BOOL,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const backEdge = opposite(withFacing(s.rotation, dir));
      const front = isTrue(s.front);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir) {
          if (front) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(backEdge), 0.5))
            .applyIf(Modifiers.setPosition(0.5), !front)
            .export(quadMap, front ? quadDir : null);

          if (altSlope) {
            const vert = isY(backEdge);
            const topEdge = backEdge === "down";
            const rightEdge = backEdge === clockWise(dir);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(backEdge, 0.5))
              .apply(
                vert
                  ? Modifiers.makeVerticalSlope(topEdge, 45)
                  : Modifiers.makeHorizontalSlope(rightEdge, 45),
              )
              .applyIf(Modifiers.offset(opposite(dir), 0.5), front)
              .export(quadMap, null);
          }
        } else if (quadDir === backEdge) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(front ? dir : opposite(dir), 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(backEdge)) {
          if (!altSlope) {
            const vert = isY(backEdge);
            const rightEdge = backEdge === clockWise(dir);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5))
              .apply(
                vert
                  ? Modifiers.makeVerticalSlope(dir, -45)
                  : Modifiers.makeHorizontalSlope(rightEdge, -45),
              )
              .apply(Modifiers.offset(backEdge, 1))
              .applyIf(Modifiers.offset(opposite(dir), 0.5), front)
              .export(quadMap, null);
          }
        } else {
          const flip = isY(backEdge)
            ? quadDir === clockWise(dir)
            : backEdge === counterClockWise(dir);
          const lenOne = (flip ? 0 : 1) + (front ? 0.5 : 0);
          const lenTwo = (flip ? 1 : 0) + (front ? 0.5 : 0);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(front ? dir : opposite(dir), 0.5))
            .apply(Modifiers.cut(opposite(backEdge), lenOne, lenTwo))
            .export(quadMap, quadDir);
        }
      };
    },
    fullFaces: (s) =>
      // `SlopePanelFullFacePredicate`
      isTrue(s.front) ? [] : [s.facing as Direction],
  };
}

/** Slope-edge-package geometries, keyed by block id without namespace. */
export const SLOPE_EDGE_GEOMETRY_SPECS: Readonly<Record<string, GeometrySpec>> =
  {
    framed_slope_edge: slopeEdge(),
    framed_elevated_slope_edge: elevatedSlopeEdge(),
    framed_corner_slope_edge: cornerSlopeEdge(),
    framed_inner_corner_slope_edge: innerCornerSlopeEdge(),
    framed_elevated_corner_slope_edge: elevatedCornerSlopeEdge(),
    framed_elevated_inner_corner_slope_edge: elevatedInnerCornerSlopeEdge(),
    framed_threeway_corner_slope_edge: threewayCornerSlopeEdge(),
    framed_inner_threeway_corner_slope_edge: innerThreewayCornerSlopeEdge(),
    framed_slope_edge_slab: slopeEdgeSlab(),
    framed_slope_edge_panel: slopeEdgePanel(),
  };
