// Hand ports of FramedBlocks' `client/model/geometry/slopepanel/*Geometry.java`
// (slope panels, extended and compound slope panels and the flat slope
// panel corners), their `FullFacePredicate`s and the `calculateParts()` of
// their double blocks (double, inverse double, extended double and stacked
// slope panels and flat slope panel corners). Read by
// `scripts/generate-camo-shapes.mts` through `GEOMETRY_SPECS` and
// `DOUBLE_BLOCK_SPECS`. The static helpers the Java classes share
// (`FramedSlopePanelGeometry.createSlope`, `FramedFlatSlopePanelCornerGeometry
// .createSideTriangle`, …) are exported under their Java names.
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class.

import type { Direction } from "../../../src/lib/render/camo/shape-pack";
import {
  BOOL,
  HORIZONTAL,
  HORIZONTAL_ROTATION,
  HorizontalRotation,
  Modifiers,
  QuadModifier,
  axisOf,
  clockWise,
  counterClockWise,
  isTrue,
  isY,
  opposite,
  type BlockState,
  type GeometrySpec,
  type Modifier,
  type QuadPiece,
} from "./geometry-api.ts";
import type { DoubleBlockSpec, PartState } from "./template-specs.ts";

// ── `FramedSlopePanelGeometry` statics ─────────────────────────────────────

/** `FramedSlopePanelGeometry.SLOPE_ANGLE`. */
export const SLOPE_ANGLE = (Math.atan(0.5) * 180) / Math.PI;
/** `FramedSlopePanelGeometry.SLOPE_ANGLE_VERT`. */
export const SLOPE_ANGLE_VERT = 90 - (Math.atan(0.5) * 180) / Math.PI;

function checkPerpendicular(facing: Direction, orientation: Direction) {
  if (axisOf(facing) === axisOf(orientation)) {
    throw new Error("Directions must be perpendicular");
  }
}

/** `FramedSlopePanelGeometry.isVerticalSlopeQuad`. */
export function isVerticalSlopeQuad(
  rotation: string,
  face: Direction,
): boolean {
  if (rotation === "down") return face === "down";
  if (rotation === "up") return face === "up";
  return false;
}

/** `FramedSlopePanelGeometry.createSlope`. */
export function createSlope(
  facing: Direction,
  orientation: Direction,
): Modifier {
  checkPerpendicular(facing, orientation);
  if (isY(orientation)) {
    return Modifiers.makeVerticalSlope(orientation === "up", SLOPE_ANGLE);
  }
  return Modifiers.makeHorizontalSlope(
    orientation === counterClockWise(facing),
    SLOPE_ANGLE,
  );
}

/** `FramedSlopePanelGeometry.createVerticalSlope`. */
export function createVerticalSlope(
  facing: Direction,
  orientation: Direction,
): Modifier {
  checkPerpendicular(facing, orientation);
  return Modifiers.makeVerticalSlope(opposite(facing), SLOPE_ANGLE_VERT);
}

/** Java's `FramedSlopePanelGeometry` statics, for the other slope panel ports. */
export const FramedSlopePanelGeometry = {
  SLOPE_ANGLE,
  SLOPE_ANGLE_VERT,
  isVerticalSlopeQuad,
  createSlope,
  createVerticalSlope,
};

// ── `FramedFlatSlopePanelCornerGeometry` statics ───────────────────────────

/** `FramedFlatSlopePanelCornerGeometry.createSlopeTriangle`. */
export function createSlopeTriangle(
  facing: Direction,
  orientation: Direction,
  second: boolean,
  quadDir: Direction,
): Modifier {
  if (isY(orientation)) {
    const down = orientation === "up";
    const cutDir: Direction = down ? "down" : "up";
    const right = down !== second ? 0 : 1;
    const left = down !== second ? 1 : 0;
    return Modifiers.cut(cutDir, right, left);
  }
  const right = orientation === clockWise(facing);
  const cutDir = right ? clockWise(quadDir) : counterClockWise(quadDir);
  const top = right !== second ? 0 : 1;
  const bot = right !== second ? 1 : 0;
  return Modifiers.cut(cutDir, top, bot);
}

/** `FramedFlatSlopePanelCornerGeometry.createVerticalSlopeTriangle`. */
export function createVerticalSlopeTriangle(
  facing: Direction,
  orientation: Direction,
  second: boolean,
): Modifier {
  const down = orientation === "down";
  const right = second === down ? 0 : 1;
  const left = second === down ? 1 : 0;
  return Modifiers.cut(opposite(facing), right, left);
}

/** `FramedFlatSlopePanelCornerGeometry.createSideTriangle`. */
export function createSideTriangle(
  quadMap: QuadPiece[],
  face: Direction,
  facing: Direction,
  rotation: string,
  front: boolean,
  extended: boolean,
): void {
  const orientation = HorizontalRotation.withFacing(rotation, facing);
  const yAxis = isY(orientation);
  if (yAxis) {
    const up = orientation === "up";
    const top = up ? (front ? 0.5 : 0) : front ? 1 : 0.5;
    const bottom = up ? (front ? 1 : 0.5) : front ? 0.5 : 0;
    QuadModifier.of(face)
      .apply(Modifiers.cut(opposite(facing), top, bottom))
      .applyIf(Modifiers.cut(facing, 0.5), front && !extended)
      .export(quadMap, face);
  } else {
    const rightRot = rotation === "right";
    const right = rightRot ? (front ? 1 : 0.5) : front ? 0.5 : 0;
    const left = rightRot ? (front ? 0.5 : 0) : front ? 1 : 0.5;
    QuadModifier.of(face)
      .apply(Modifiers.cut(opposite(facing), right, left))
      .applyIf(Modifiers.cut(facing, 0.5), front && !extended)
      .export(quadMap, face);
  }
}

/** Java's `FramedFlatSlopePanelCornerGeometry` statics. */
export const FramedFlatSlopePanelCornerGeometry = {
  createSlopeTriangle,
  createVerticalSlopeTriangle,
  createSideTriangle,
};

// ── Full face predicates (`common/data/facepreds/slopepanel/`) ────────────

/** `SlopePanelFullFacePredicate`. */
export function slopePanelFullFaces(s: BlockState): Direction[] {
  if (isTrue(s.front)) return [];
  return [s.facing as Direction];
}

// ── Geometries ─────────────────────────────────────────────────────────────

const ROTATION_PROPERTIES = {
  facing: HORIZONTAL,
  rotation: HORIZONTAL_ROTATION,
  alt_slope: BOOL,
};
const FRONT_PROPERTIES = {
  facing: HORIZONTAL,
  rotation: HORIZONTAL_ROTATION,
  front: BOOL,
  alt_slope: BOOL,
};

/** `slopepanel/FramedSlopePanelGeometry.java` */
function slopePanel(): GeometrySpec {
  return {
    properties: FRONT_PROPERTIES,
    geometry: (s) => {
      const facing = s.facing as Direction;
      const rotation = s.rotation;
      const orientation = HorizontalRotation.withFacing(rotation, facing);
      const triangleAxis = axisOf(
        HorizontalRotation.withFacing(
          HorizontalRotation.rotate(rotation, true),
          facing,
        ),
      );
      const front = isTrue(s.front);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        const yAxis = isY(orientation);
        if (face === opposite(orientation)) {
          const cutDir = front ? facing : opposite(facing);
          QuadModifier.of(face)
            .apply(Modifiers.cut(cutDir, 0.5))
            .export(quadMap, face);
        } else if (
          (!HorizontalRotation.isVertical(rotation) || !altSlope) &&
          face === opposite(facing)
        ) {
          QuadModifier.of(face)
            .apply(createSlope(facing, orientation))
            .applyIf(Modifiers.offset(facing, 0.5), !front)
            .export(quadMap, null);
        } else if (altSlope && isVerticalSlopeQuad(rotation, face)) {
          QuadModifier.of(face)
            .apply(createVerticalSlope(facing, orientation))
            .applyIf(Modifiers.offset(opposite(facing), 0.5), front)
            .export(quadMap, null);
        } else if (face === facing) {
          if (front) {
            QuadModifier.of(face)
              .apply(Modifiers.setPosition(0.5))
              .export(quadMap, null);
          }
        } else if (axisOf(face) === triangleAxis) {
          if (yAxis) {
            const up = orientation === "up";
            const top = up ? (front ? 0.5 : 0) : front ? 1 : 0.5;
            const bottom = up ? (front ? 1 : 0.5) : front ? 0.5 : 0;
            QuadModifier.of(face)
              .apply(Modifiers.cut(opposite(facing), top, bottom))
              .applyIf(Modifiers.cut(facing, 0.5), front)
              .export(quadMap, face);
          } else {
            const rightRot = rotation === "right";
            const right = rightRot ? (front ? 1 : 0.5) : front ? 0.5 : 0;
            const left = rightRot ? (front ? 0.5 : 0) : front ? 1 : 0.5;
            QuadModifier.of(face)
              .apply(Modifiers.cut(opposite(facing), right, left))
              .applyIf(Modifiers.cut(facing, 0.5), front)
              .export(quadMap, face);
          }
        }
      };
    },
    fullFaces: slopePanelFullFaces,
  };
}

/** `slopepanel/FramedExtendedSlopePanelGeometry.java` */
function extendedSlopePanel(): GeometrySpec {
  return {
    properties: ROTATION_PROPERTIES,
    geometry: (s) => {
      const facing = s.facing as Direction;
      const rotation = s.rotation;
      const orientation = HorizontalRotation.withFacing(rotation, facing);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        const yAxis = isY(orientation);
        if (face === orientation) {
          if (isY(orientation)) {
            QuadModifier.of(face)
              .apply(Modifiers.cut(opposite(facing), 0.5))
              .export(quadMap, face);
            if (altSlope) {
              QuadModifier.of(face)
                .apply(createVerticalSlope(facing, orientation))
                .apply(Modifiers.offset(opposite(facing), 0.5))
                .export(quadMap, null);
            }
          } else {
            QuadModifier.of(face)
              .apply(Modifiers.cut(opposite(facing), 0.5))
              .export(quadMap, face);
          }
        } else if (
          (!HorizontalRotation.isVertical(rotation) || !altSlope) &&
          face === opposite(facing)
        ) {
          QuadModifier.of(face)
            .apply(createSlope(facing, orientation))
            .export(quadMap, null);
        } else if (
          axisOf(face) !== axisOf(facing) &&
          axisOf(face) !== axisOf(orientation)
        ) {
          if (yAxis) {
            const up = orientation === "up";
            QuadModifier.of(face)
              .apply(
                Modifiers.cut(opposite(facing), up ? 0.5 : 1, up ? 1 : 0.5),
              )
              .export(quadMap, face);
          } else {
            const rightRot = rotation === "right";
            QuadModifier.of(face)
              .apply(
                Modifiers.cut(
                  opposite(facing),
                  rightRot ? 1 : 0.5,
                  rightRot ? 0.5 : 1,
                ),
              )
              .export(quadMap, face);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `ExtendedSlopePanelFullFacePredicate`
      const facing = s.facing as Direction;
      const orientation = HorizontalRotation.withFacing(s.rotation, facing);
      return [facing, opposite(orientation)];
    },
  };
}

/** `slopepanel/FramedCompoundSlopePanelGeometry.java` */
function compoundSlopePanel(): GeometrySpec {
  return {
    properties: ROTATION_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const rot = s.rotation;
      const orientation = HorizontalRotation.withFacing(rot, dir);
      const triangleAxis = axisOf(
        HorizontalRotation.withFacing(
          HorizontalRotation.rotate(rot, true),
          dir,
        ),
      );
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === orientation) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .export(quadMap, quadDir);
          if (altSlope && isY(quadDir)) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE_VERT),
              )
              .apply(Modifiers.offset(opposite(dir), 0.5))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(orientation)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, 0.5))
            .export(quadMap, quadDir);
          if (altSlope && isY(quadDir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeVerticalSlope(dir, SLOPE_ANGLE_VERT))
              .apply(Modifiers.offset(dir, 0.5))
              .export(quadMap, null);
          }
        } else if (quadDir === dir) {
          if (!isY(orientation)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeHorizontalSlope(rot === "left", SLOPE_ANGLE))
              .export(quadMap, null);
          } else if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeVerticalSlope(rot === "down", SLOPE_ANGLE))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(dir)) {
          if (!isY(orientation)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeHorizontalSlope(rot === "left", SLOPE_ANGLE))
              .export(quadMap, null);
          } else if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeVerticalSlope(rot === "up", SLOPE_ANGLE))
              .export(quadMap, null);
          }
        } else if (triangleAxis === "y" && isY(quadDir)) {
          const right = rot === "right";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, right ? 1 : 0.5, right ? 0.5 : 1))
            .apply(
              Modifiers.cut(opposite(dir), right ? 1 : 0.5, right ? 0.5 : 1),
            )
            .export(quadMap, quadDir);
        } else if (triangleAxis !== "y" && axisOf(quadDir) === triangleAxis) {
          const up = rot === "up";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, up ? 1 : 0.5, up ? 0.5 : 1))
            .apply(Modifiers.cut(opposite(dir), up ? 0.5 : 1, up ? 1 : 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
    // `FullFacePredicate.FALSE`
  };
}

/** `rotation.rotate(Rotation.COUNTERCLOCKWISE_90)` and both orientations. */
function flatCornerDirs(s: BlockState) {
  const facing = s.facing as Direction;
  const rotation = s.rotation;
  const rotRotation = HorizontalRotation.rotate(rotation, false);
  return {
    facing,
    rotation,
    rotRotation,
    orientation: HorizontalRotation.withFacing(rotation, facing),
    rotOrientation: HorizontalRotation.withFacing(rotRotation, facing),
  };
}

/** `slopepanel/FramedFlatSlopePanelCornerGeometry.java` */
function flatSlopePanelCorner(): GeometrySpec {
  return {
    properties: FRONT_PROPERTIES,
    geometry: (s) => {
      const { facing, rotation, rotRotation, orientation, rotOrientation } =
        flatCornerDirs(s);
      const front = isTrue(s.front);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        if (face === opposite(orientation)) {
          createSideTriangle(quadMap, face, facing, rotRotation, front, false);
        } else if (face === opposite(rotOrientation)) {
          createSideTriangle(quadMap, face, facing, rotation, front, false);
        } else if (face === opposite(facing)) {
          if (!altSlope || !isY(orientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, orientation, false, face))
              .apply(createSlope(facing, orientation))
              .applyIf(Modifiers.offset(facing, 0.5), !front)
              .export(quadMap, null);
          }
          if (!altSlope || !isY(rotOrientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, rotOrientation, true, face))
              .apply(createSlope(facing, rotOrientation))
              .applyIf(Modifiers.offset(facing, 0.5), !front)
              .export(quadMap, null);
          }
        } else if (altSlope && isY(orientation) && face === orientation) {
          QuadModifier.of(face)
            .apply(createVerticalSlopeTriangle(facing, orientation, false))
            .apply(createVerticalSlope(facing, orientation))
            .applyIf(Modifiers.offset(opposite(facing), 0.5), front)
            .export(quadMap, null);
        } else if (altSlope && isY(rotOrientation) && face === rotOrientation) {
          QuadModifier.of(face)
            .apply(createVerticalSlopeTriangle(facing, rotOrientation, true))
            .apply(createVerticalSlope(facing, rotOrientation))
            .applyIf(Modifiers.offset(opposite(facing), 0.5), front)
            .export(quadMap, null);
        } else if (face === facing && front) {
          QuadModifier.of(face)
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: slopePanelFullFaces,
  };
}

/** `slopepanel/FramedFlatInnerSlopePanelCornerGeometry.java` */
function flatInnerSlopePanelCorner(): GeometrySpec {
  return {
    properties: FRONT_PROPERTIES,
    geometry: (s) => {
      const { facing, rotation, rotRotation, orientation, rotOrientation } =
        flatCornerDirs(s);
      const front = isTrue(s.front);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        if (face === orientation) {
          createSideTriangle(quadMap, face, facing, rotRotation, front, false);
          if (altSlope && isY(orientation)) {
            QuadModifier.of(face)
              .apply(
                createVerticalSlopeTriangle(
                  opposite(facing),
                  orientation,
                  false,
                ),
              )
              .apply(createVerticalSlope(facing, rotOrientation))
              .applyIf(Modifiers.offset(opposite(facing), 0.5), front)
              .export(quadMap, null);
          }
        } else if (face === rotOrientation) {
          createSideTriangle(quadMap, face, facing, rotation, front, false);
          if (altSlope && isY(rotOrientation)) {
            QuadModifier.of(face)
              .apply(
                createVerticalSlopeTriangle(
                  opposite(facing),
                  rotOrientation,
                  true,
                ),
              )
              .apply(createVerticalSlope(facing, orientation))
              .applyIf(Modifiers.offset(opposite(facing), 0.5), front)
              .export(quadMap, null);
          }
        } else if (
          face === opposite(orientation) ||
          face === opposite(rotOrientation)
        ) {
          const cutDir = front ? facing : opposite(facing);
          QuadModifier.of(face)
            .apply(Modifiers.cut(cutDir, 0.5))
            .export(quadMap, face);
        } else if (face === opposite(facing)) {
          if (!altSlope || !isY(orientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, rotOrientation, true, face))
              .apply(createSlope(facing, orientation))
              .applyIf(Modifiers.offset(facing, 0.5), !front)
              .export(quadMap, null);
          }
          if (!altSlope || !isY(rotOrientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, orientation, false, face))
              .apply(createSlope(facing, rotOrientation))
              .applyIf(Modifiers.offset(facing, 0.5), !front)
              .export(quadMap, null);
          }
        } else if (face === facing && front) {
          QuadModifier.of(face)
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: slopePanelFullFaces,
  };
}

/** `slopepanel/FramedFlatExtendedSlopePanelCornerGeometry.java` */
function flatExtendedSlopePanelCorner(): GeometrySpec {
  return {
    properties: ROTATION_PROPERTIES,
    geometry: (s) => {
      const { facing, rotation, rotRotation, orientation, rotOrientation } =
        flatCornerDirs(s);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        if (face === opposite(orientation)) {
          createSideTriangle(quadMap, face, facing, rotRotation, true, true);
        } else if (face === opposite(rotOrientation)) {
          createSideTriangle(quadMap, face, facing, rotation, true, true);
        } else if (face === orientation || face === rotOrientation) {
          QuadModifier.of(face)
            .apply(Modifiers.cut(opposite(facing), 0.5))
            .export(quadMap, face);
          if (altSlope && isY(orientation) && face === orientation) {
            QuadModifier.of(face)
              .apply(createVerticalSlopeTriangle(facing, orientation, false))
              .apply(createVerticalSlope(facing, orientation))
              .apply(Modifiers.offset(opposite(facing), 0.5))
              .export(quadMap, null);
          } else if (
            altSlope &&
            isY(rotOrientation) &&
            face === rotOrientation
          ) {
            QuadModifier.of(face)
              .apply(createVerticalSlopeTriangle(facing, rotOrientation, true))
              .apply(createVerticalSlope(facing, rotOrientation))
              .apply(Modifiers.offset(opposite(facing), 0.5))
              .export(quadMap, null);
          }
        } else if (face === opposite(facing)) {
          if (!altSlope || !isY(orientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, orientation, false, face))
              .apply(createSlope(facing, orientation))
              .export(quadMap, null);
          }
          if (!altSlope || !isY(rotOrientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, rotOrientation, true, face))
              .apply(createSlope(facing, rotOrientation))
              .export(quadMap, null);
          }
        } else if (face === facing) {
          QuadModifier.of(face)
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }
      };
    },
    // `FullFacePredicate.HOR_DIR`
    fullFaces: (s) => [s.facing as Direction],
  };
}

/** `slopepanel/FramedFlatExtendedInnerSlopePanelCornerGeometry.java` */
function flatExtendedInnerSlopePanelCorner(): GeometrySpec {
  return {
    properties: ROTATION_PROPERTIES,
    geometry: (s) => {
      const { facing, rotation, rotRotation, orientation, rotOrientation } =
        flatCornerDirs(s);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        if (face === orientation) {
          createSideTriangle(quadMap, face, facing, rotRotation, true, true);
          if (altSlope && isY(orientation)) {
            QuadModifier.of(face)
              .apply(
                createVerticalSlopeTriangle(
                  opposite(facing),
                  orientation,
                  false,
                ),
              )
              .apply(createVerticalSlope(facing, orientation))
              .apply(Modifiers.offset(opposite(facing), 0.5))
              .export(quadMap, null);
          }
        } else if (face === rotOrientation) {
          createSideTriangle(quadMap, face, facing, rotation, true, true);
          if (altSlope && isY(rotOrientation)) {
            QuadModifier.of(face)
              .apply(
                createVerticalSlopeTriangle(
                  opposite(facing),
                  rotOrientation,
                  true,
                ),
              )
              .apply(createVerticalSlope(facing, rotOrientation))
              .apply(Modifiers.offset(opposite(facing), 0.5))
              .export(quadMap, null);
          }
        } else if (face === opposite(facing)) {
          if (!altSlope || !isY(orientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, rotOrientation, true, face))
              .apply(createSlope(facing, orientation))
              .export(quadMap, null);
          }
          if (!altSlope || !isY(rotOrientation)) {
            QuadModifier.of(face)
              .apply(createSlopeTriangle(facing, orientation, false, face))
              .apply(createSlope(facing, rotOrientation))
              .export(quadMap, null);
          }
        } else if (face === facing) {
          QuadModifier.of(face)
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: (s) => {
      // `FlatExtendedInnerSlopePanelCornerFullFacePredicate`
      const { facing, orientation, rotOrientation } = flatCornerDirs(s);
      return [facing, opposite(orientation), opposite(rotOrientation)];
    },
  };
}

/** Slope-panel-package geometries, keyed by block id without namespace. */
export const SLOPE_PANEL_GEOMETRY_SPECS: Readonly<
  Record<string, GeometrySpec>
> = {
  framed_slope_panel: slopePanel(),
  framed_extended_slope_panel: extendedSlopePanel(),
  framed_compound_slope_panel: compoundSlopePanel(),
  framed_flat_slope_panel_corner: flatSlopePanelCorner(),
  framed_flat_inner_slope_panel_corner: flatInnerSlopePanelCorner(),
  framed_flat_ext_slope_panel_corner: flatExtendedSlopePanelCorner(),
  framed_flat_ext_inner_slope_panel_corner: flatExtendedInnerSlopePanelCorner(),
};

// ── Double blocks (`common/block/slopepanel/`) ─────────────────────────────

const part = (block: string, props: BlockState = {}): PartState => ({
  block,
  props,
});

/** `rotation.isVertical() ? rotation.getOpposite() : rotation`. */
const flipVertical = (rotation: string) =>
  HorizontalRotation.isVertical(rotation)
    ? HorizontalRotation.getOpposite(rotation)
    : rotation;

/** `rotation.rotate(rotation.isVertical() ? CCW_90 : CW_90)` (`ccwIfVertical`) or the reverse. */
const backRotation = (rotation: string, ccwIfVertical: boolean) =>
  HorizontalRotation.rotate(
    rotation,
    HorizontalRotation.isVertical(rotation) !== ccwIfVertical,
  );

/** `FramedFlatExtendedDoubleSlopePanelCornerBlock.calculateParts`. */
function flatExtendedDouble(
  blockOne: string,
  blockTwo: string,
): DoubleBlockSpec {
  return {
    properties: ROTATION_PROPERTIES,
    parts: (s) => [
      part(blockOne, {
        facing: s.facing,
        rotation: s.rotation,
        alt_slope: s.alt_slope,
      }),
      part(blockTwo, {
        facing: opposite(s.facing as Direction),
        rotation: backRotation(s.rotation, true),
        alt_slope: s.alt_slope,
      }),
    ],
  };
}

/** `FramedFlatStackedSlopePanelCornerBlock.calculateParts`. */
function flatStacked(topBlock: string): DoubleBlockSpec {
  return {
    properties: ROTATION_PROPERTIES,
    parts: (s) => [
      part("framed_panel", { facing: s.facing }),
      part(topBlock, {
        facing: s.facing,
        rotation: s.rotation,
        front: "true",
        alt_slope: s.alt_slope,
      }),
    ],
  };
}

export const SLOPE_PANEL_DOUBLE_BLOCK_SPECS: Readonly<
  Record<string, DoubleBlockSpec>
> = {
  // `FramedDoubleSlopePanelBlock`
  framed_double_slope_panel: {
    properties: FRONT_PROPERTIES,
    parts: (s) => [
      part("framed_slope_panel", {
        facing: s.facing,
        rotation: s.rotation,
        front: s.front,
        alt_slope: s.alt_slope,
      }),
      part("framed_slope_panel", {
        facing: opposite(s.facing as Direction),
        rotation: flipVertical(s.rotation),
        front: String(!isTrue(s.front)),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedInverseDoubleSlopePanelBlock`
  framed_inv_double_slope_panel: {
    properties: ROTATION_PROPERTIES,
    parts: (s) => [
      part("framed_slope_panel", {
        facing: opposite(s.facing as Direction),
        rotation: flipVertical(s.rotation),
        front: "true",
        alt_slope: s.alt_slope,
      }),
      part("framed_slope_panel", {
        facing: s.facing,
        rotation: s.rotation,
        front: "true",
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedExtendedDoubleSlopePanelBlock`
  framed_extended_double_slope_panel: {
    properties: ROTATION_PROPERTIES,
    parts: (s) => [
      part("framed_extended_slope_panel", {
        facing: s.facing,
        rotation: s.rotation,
        alt_slope: s.alt_slope,
      }),
      part("framed_slope_panel", {
        facing: opposite(s.facing as Direction),
        rotation: flipVertical(s.rotation),
        front: "false",
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedStackedSlopePanelBlock`
  framed_stacked_slope_panel: {
    properties: ROTATION_PROPERTIES,
    parts: (s) => [
      part("framed_panel", { facing: s.facing }),
      part("framed_slope_panel", {
        facing: s.facing,
        rotation: s.rotation,
        front: "true",
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedFlatDoubleSlopePanelCornerBlock`
  framed_flat_double_slope_panel_corner: {
    properties: FRONT_PROPERTIES,
    parts: (s) => [
      part("framed_flat_inner_slope_panel_corner", {
        facing: s.facing,
        rotation: s.rotation,
        front: s.front,
        alt_slope: s.alt_slope,
      }),
      part("framed_flat_slope_panel_corner", {
        facing: opposite(s.facing as Direction),
        rotation: backRotation(s.rotation, true),
        front: String(!isTrue(s.front)),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedFlatInverseDoubleSlopePanelCornerBlock`
  framed_flat_inv_double_slope_panel_corner: {
    properties: ROTATION_PROPERTIES,
    parts: (s) => [
      part("framed_flat_inner_slope_panel_corner", {
        facing: opposite(s.facing as Direction),
        rotation: backRotation(s.rotation, false),
        front: "true",
        alt_slope: s.alt_slope,
      }),
      part("framed_flat_slope_panel_corner", {
        facing: s.facing,
        rotation: HorizontalRotation.getOpposite(s.rotation),
        front: "true",
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedFlatExtendedDoubleSlopePanelCornerBlock`
  framed_flat_ext_double_slope_panel_corner: flatExtendedDouble(
    "framed_flat_ext_slope_panel_corner",
    "framed_flat_inner_slope_panel_corner",
  ),
  // `FramedFlatExtendedDoubleSlopePanelCornerBlock` (inner)
  framed_flat_ext_inner_double_slope_panel_corner: flatExtendedDouble(
    "framed_flat_ext_inner_slope_panel_corner",
    "framed_flat_slope_panel_corner",
  ),
  // `FramedFlatStackedSlopePanelCornerBlock`
  framed_flat_stacked_slope_panel_corner: flatStacked(
    "framed_flat_slope_panel_corner",
  ),
  // `FramedFlatStackedSlopePanelCornerBlock` (inner)
  framed_flat_stacked_inner_slope_panel_corner: flatStacked(
    "framed_flat_inner_slope_panel_corner",
  ),
};
