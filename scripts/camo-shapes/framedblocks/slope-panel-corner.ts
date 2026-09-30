// Hand ports of FramedBlocks' `client/model/geometry/slopepanelcorner/*Geometry.java`
// (small, large, inner and extended corner slope panels, the small and
// large (inner) prism slope panel corners, and the `*WallGeometry` classes
// of their `_w` variants) with their `FullFacePredicate`s, and the
// `calculateParts()` of their double and stacked blocks. Read by
// `scripts/generate-camo-shapes.mts` through `GEOMETRY_SPECS` and
// `DOUBLE_BLOCK_SPECS`.
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class.

import type {
  Axis,
  Direction,
  Vec3,
} from "../../../src/lib/render/camo/shape-pack";
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
  isPositive,
  isTrue,
  isY,
  opposite,
  type BlockState,
  type GeometrySpec,
  type QuadPiece,
} from "./geometry-api.ts";
import type { DoubleBlockSpec, PartState } from "./template-specs.ts";

// ── Shared constants and helpers ───────────────────────────────────────────

const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** `FramedSlopePanelGeometry.SLOPE_ANGLE`. */
const SLOPE_ANGLE = toDegrees(Math.atan(0.5));
/** `FramedSlopePanelGeometry.SLOPE_ANGLE_VERT`. */
const SLOPE_ANGLE_VERT = 90 - toDegrees(Math.atan(0.5));

/** `FramedSmallPrismSlopePanelCornerGeometry.PRISM_ANGLE_HOR`/`_VERT`. */
const PRISM_ANGLE_HOR = toDegrees(Math.atan(0.25));
const PRISM_ANGLE_VERT = toDegrees(Math.atan(4));
/** `FramedSmallPrismSlopePanelCornerWallGeometry.PRISM_ANGLE_HOR`/`_VERT` (swapped). */
const WALL_PRISM_ANGLE_HOR = PRISM_ANGLE_VERT;
const WALL_PRISM_ANGLE_VERT = PRISM_ANGLE_HOR;

/** Wall blocks default to `alt_slope=true`. */
const BOOL_TRUE_FIRST = ["true", "false"] as const;

const CORNER_PROPERTIES = { facing: HORIZONTAL, top: BOOL, alt_slope: BOOL };
const WALL_PROPERTIES = {
  facing: HORIZONTAL,
  rotation: HORIZONTAL_ROTATION,
  alt_slope: BOOL_TRUE_FIRST,
};
const PRISM_PROPERTIES = { ...CORNER_PROPERTIES, offset: BOOL };
const PRISM_WALL_PROPERTIES = { ...WALL_PROPERTIES, offset: BOOL };

const STEP: Record<Direction, Vec3> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

/** `HorizontalRotation.rotate(Rotation.COUNTERCLOCKWISE_90).withFacing(dir)`. */
const perpRotDirOf = (rot: string, dir: Direction): Direction =>
  HorizontalRotation.withFacing(HorizontalRotation.rotate(rot, false), dir);

/** The `horRotDir`/`vertRotDir` pair of the non-prism `*WallGeometry` constructors. */
function wallRotDirs(s: BlockState) {
  const dir = s.facing as Direction;
  const rotDir = HorizontalRotation.withFacing(s.rotation, dir);
  const perpRotDir = perpRotDirOf(s.rotation, dir);
  return {
    dir,
    horRotDir: isY(rotDir) ? perpRotDir : rotDir,
    vertRotDir: isY(rotDir) ? rotDir : perpRotDir,
    altSlope: isTrue(s.alt_slope),
  };
}

/** `FramedSmallPrismSlopePanelCornerGeometry.getTiltOrigin` (`TILT_ORIGINS`). */
function smallTiltOrigin(
  dir: Direction,
  top: boolean,
  altSlope: boolean,
): Vec3 {
  const [sx, , sz] = STEP[dir];
  if (!altSlope) return [0.5 + sx * 0.25, top ? 1 : 0, 0.5 + sz * 0.25];
  return [0.5 + sx * 0.5, top ? 0 : 1, 0.5 + sz * 0.5];
}

/** `FramedSmallPrismSlopePanelCornerGeometry.Y_ROT_ORIGIN`. */
const Y_ROT_ORIGIN: Vec3 = [0.5, 0, 0.5];

/** `FramedLargePrismSlopePanelCornerGeometry.getTiltOrigin` (`TILT_ORIGINS`). */
function largeTiltOrigin(
  dir: Direction,
  top: boolean,
  altSlope: boolean,
): Vec3 {
  const [sx, , sz] = STEP[dir];
  return [0.5 - sx * 0.5, top !== altSlope ? 1 : 0, 0.5 - sz * 0.5];
}

/** `FramedLargePrismSlopePanelCornerGeometry.getYRotOrigin` (`Y_ROT_ORIGINS`). */
function largeYRotOrigin(dir: Direction): Vec3 {
  const origins: Partial<Record<Direction, Vec3>> = {
    north: [0, 0, 1],
    south: [1, 0, 0],
    west: [1, 0, 1],
    east: [0, 0, 0],
  };
  return origins[dir]!;
}

/** `FramedSmallPrismSlopePanelCornerWallGeometry.getTiltOrigin` (`TILT_ORIGNS`). */
function smallWallTiltOrigin(
  dir: Direction,
  rot: string,
  altSlope: boolean,
): Vec3 {
  const rotDir = STEP[HorizontalRotation.withFacing(rot, dir)];
  if (!altSlope) {
    const oppDir = STEP[opposite(dir)];
    return [0, 1, 2].map(
      (i) => 0.5 + rotDir[i] * 0.5 + oppDir[i] * 0.5,
    ) as unknown as Vec3;
  }
  const step = STEP[dir];
  return [0, 1, 2].map(
    (i) => 0.5 + rotDir[i] * 0.25 + step[i] * 0.5,
  ) as unknown as Vec3;
}

/** `FramedSmallPrismSlopePanelCornerWallGeometry.invertTiltAngle`. */
function invertTiltAngle(dir: Direction, rot: string): boolean {
  const invAngleRot = isPositive(clockWise(dir))
    ? rot
    : HorizontalRotation.rotate(rot, true);
  return invAngleRot === "up" || invAngleRot === "left";
}

/** `FramedSmallPrismSlopePanelCornerWallGeometry.getDirAxisRotOrigin` (`DIR_AXIS_ROT_ORIGINS`). */
function dirAxisRotOrigin(dir: Direction): Vec3 {
  const origins: Record<Axis, Vec3> = {
    x: [0, 0.5, 0.5],
    y: [0.5, 0, 0.5],
    z: [0.5, 0.5, 0],
  };
  return origins[axisOf(dir)];
}

const max0 = (n: number) => Math.max(0, n);

/** `FramedLargePrismSlopePanelCornerWallGeometry.getRotTiltOrigin` (`ROT_TILT_ORIGINS`). */
function largeWallRotTiltOrigin(
  dir: Direction,
  rot: string,
  altSlope: boolean,
): Vec3 {
  if (altSlope) {
    dir = opposite(dir);
    if (!HorizontalRotation.isVertical(rot)) {
      rot = HorizontalRotation.getOpposite(rot);
    }
  }
  const step = STEP[dir];
  const one = STEP[opposite(HorizontalRotation.withFacing(rot, dir))];
  const two = STEP[perpRotDirOf(rot, dir)];
  return [
    max0(step[0]) + max0(one[0]) + max0(two[0]),
    max0(one[1]) + max0(two[1]),
    max0(step[2]) + max0(one[2]) + max0(two[2]),
  ];
}

/** `FramedLargeInnerPrismSlopePanelCornerWallGeometry.getRotOrigin` (`ROT_ORIGINS`). */
function largeInnerWallRotOrigin(
  dir: Direction,
  rot: string,
  altSlope: boolean,
): Vec3 {
  if (altSlope) return largeWallRotTiltOrigin(dir, rot, false);
  const one = STEP[opposite(HorizontalRotation.withFacing(rot, dir))];
  const two = STEP[perpRotDirOf(rot, dir)];
  return [0, 1, 2].map(
    (i) => max0(one[i]) + 0.5 * Math.abs(two[i]),
  ) as unknown as Vec3;
}

type SlopeMaker = (quadMap: QuadPiece[], modifier: QuadModifier) => void;

/**
 * The prism geometries' `makePrismSlope`: with `offset`, two half-width
 * slopes pushed out along `sideDir` and its opposite.
 */
function makePrismSlope(
  quadMap: QuadPiece[],
  quadDir: Direction,
  offset: boolean,
  sideDir: Direction,
  slopeMaker: SlopeMaker,
) {
  if (offset) {
    const modOne = QuadModifier.of(quadDir)
      .apply(Modifiers.cut(sideDir, 0.5))
      .apply(Modifiers.offset(sideDir, 0.5));
    const modTwo = QuadModifier.of(quadDir)
      .apply(Modifiers.cut(opposite(sideDir), 0.5))
      .apply(Modifiers.offset(opposite(sideDir), 0.5));
    slopeMaker(quadMap, modTwo);
    slopeMaker(quadMap, modOne);
  } else {
    slopeMaker(quadMap, QuadModifier.of(quadDir));
  }
}

// ── Corner slope panels ────────────────────────────────────────────────────

/** `slopepanelcorner/FramedSmallCornerSlopePanelGeometry.java` */
function smallCornerSlopePanel(): GeometrySpec {
  const ORIGIN_BOTTOM: Vec3 = [0.5, 0, 0.5];
  const ORIGIN_TOP: Vec3 = [0.5, 1, 0.5];
  return {
    properties: CORNER_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 0.5 : 0, top ? 0 : 0.5))
            .export(quadMap, quadDir);
        } else if (
          !altSlope &&
          (quadDir === opposite(dir) || quadDir === clockWise(dir))
        ) {
          const cutDir =
            quadDir === opposite(dir) ? clockWise(dir) : opposite(dir);
          let angle = top ? SLOPE_ANGLE : -SLOPE_ANGLE;
          if (quadDir === "north" || quadDir === "east") {
            angle *= -1;
          }

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 0.5 : 0, top ? 0 : 0.5))
            .apply(Modifiers.setPosition(0.5))
            .apply(
              Modifiers.rotate(
                axisOf(cutDir),
                top ? ORIGIN_TOP : ORIGIN_BOTTOM,
                angle,
                true,
              ),
            )
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0, 0.5))
            .apply(
              Modifiers.makeVerticalSlope(clockWise(dir), SLOPE_ANGLE_VERT),
            )
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 0.5, 0))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE_VERT))
            .export(quadMap, null);
        } else if ((!top && quadDir === "down") || (top && quadDir === "up")) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .apply(Modifiers.cut(clockWise(dir), 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedSmallCornerSlopePanelWallGeometry.java` */
function smallCornerSlopePanelWall(): GeometrySpec {
  return {
    properties: WALL_PROPERTIES,
    geometry: (s) => {
      const { dir, horRotDir, vertRotDir, altSlope } = wallRotDirs(s);
      return (quadDir, quadMap) => {
        const cw = horRotDir === clockWise(dir);
        const up = vertRotDir === "up";
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.cut(opposite(vertRotDir), 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === horRotDir) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 0 : 0.5, cw ? 0.5 : 0),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === vertRotDir) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), cw ? 0.5 : 0, cw ? 0 : 0.5),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(horRotDir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 0.5 : 0, cw ? 0 : 0.5),
            )
            .apply(Modifiers.makeHorizontalSlope(!cw, SLOPE_ANGLE))
            .apply(Modifiers.offset(horRotDir, 0.5))
            .export(quadMap, null);
        } else if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), up ? 0 : 0.5, up ? 0.5 : 0),
            )
            .apply(Modifiers.makeVerticalSlope(!up, SLOPE_ANGLE_VERT))
            .export(quadMap, null);
        } else if (altSlope && quadDir === opposite(vertRotDir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), cw ? 0.5 : 0, cw ? 0 : 0.5),
            )
            .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE))
            .apply(Modifiers.offset(vertRotDir, 0.5))
            .export(quadMap, null);
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedLargeCornerSlopePanelGeometry.java` */
function largeCornerSlopePanel(): GeometrySpec {
  return {
    properties: CORNER_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0.5, top ? 0.5 : 1))
            .apply(Modifiers.cut(opposite(cutDir), 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, 0.5))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        } else if (
          !altSlope &&
          (quadDir === opposite(dir) || quadDir === clockWise(dir))
        ) {
          const cutDir =
            quadDir === opposite(dir) ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0.5, top ? 0.5 : 1))
            .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5, 1))
            .apply(
              Modifiers.makeVerticalSlope(clockWise(dir), SLOPE_ANGLE_VERT),
            )
            .apply(Modifiers.offset(clockWise(dir), 0.5))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 1, 0.5))
            .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE_VERT))
            .apply(Modifiers.offset(opposite(dir), 0.5))
            .export(quadMap, null);
        } else if ((!top && quadDir === "down") || (top && quadDir === "up")) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(counterClockWise(dir), 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, 0.5))
            .apply(Modifiers.cut(clockWise(dir), 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedLargeCornerSlopePanelWallGeometry.java` */
function largeCornerSlopePanelWall(): GeometrySpec {
  return {
    properties: WALL_PROPERTIES,
    geometry: (s) => {
      const { dir, horRotDir, vertRotDir, altSlope } = wallRotDirs(s);
      return (quadDir, quadMap) => {
        const cw = horRotDir === clockWise(dir);
        const up = vertRotDir === "up";
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(horRotDir, 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.cut(vertRotDir, 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === horRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(vertRotDir, 0.5))
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 0.5 : 1, cw ? 1 : 0.5),
            )
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(vertRotDir), 0.5))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        } else if (quadDir === vertRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(horRotDir, 0.5))
            .apply(
              Modifiers.cut(opposite(horRotDir), cw ? 1 : 0.5, cw ? 0.5 : 1),
            )
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        } else if (quadDir === opposite(horRotDir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 1 : 0.5, cw ? 0.5 : 1),
            )
            .apply(Modifiers.makeHorizontalSlope(!cw, SLOPE_ANGLE))
            .export(quadMap, null);
        } else if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), up ? 0.5 : 1, up ? 1 : 0.5),
            )
            .apply(Modifiers.makeVerticalSlope(!up, SLOPE_ANGLE_VERT))
            .apply(Modifiers.offset(opposite(vertRotDir), 0.5))
            .export(quadMap, null);
        } else if (altSlope && quadDir === opposite(vertRotDir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), cw ? 1 : 0.5, cw ? 0.5 : 1),
            )
            .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE))
            .export(quadMap, null);
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedSmallInnerCornerSlopePanelGeometry.java` */
function smallInnerCornerSlopePanel(): GeometrySpec {
  return {
    properties: CORNER_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(cutDir), top ? 1 : 0.5, top ? 0.5 : 1),
            )
            .apply(Modifiers.cut(cutDir, 0.5))
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(cutDir, top ? 0 : 0.5, top ? 0.5 : 0))
              .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(dir) || quadDir === clockWise(dir)) {
          const cutDir =
            quadDir === opposite(dir) ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, 0.5))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0, 0.5))
            .apply(
              Modifiers.makeVerticalSlope(
                counterClockWise(dir),
                SLOPE_ANGLE_VERT,
              ),
            )
            .apply(Modifiers.offset(counterClockWise(dir), 0.5))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 0.5, 0))
            .apply(Modifiers.makeVerticalSlope(dir, SLOPE_ANGLE_VERT))
            .apply(Modifiers.offset(dir, 0.5))
            .export(quadMap, null);
        } else if ((!top && quadDir === "down") || (top && quadDir === "up")) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .apply(Modifiers.cut(clockWise(dir), 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedSmallInnerCornerSlopePanelWallGeometry.java` */
function smallInnerCornerSlopePanelWall(): GeometrySpec {
  return {
    properties: WALL_PROPERTIES,
    geometry: (s) => {
      const { dir, horRotDir, vertRotDir, altSlope } = wallRotDirs(s);
      return (quadDir, quadMap) => {
        const cw = horRotDir === clockWise(dir);
        const up = vertRotDir === "up";
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.cut(opposite(vertRotDir), 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(horRotDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(vertRotDir), 0.5))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        } else if (quadDir === opposite(vertRotDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        } else if (quadDir === horRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(vertRotDir), 0.5))
            .apply(Modifiers.cut(vertRotDir, cw ? 0.5 : 1, cw ? 1 : 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 0.5 : 0, cw ? 0 : 0.5),
            )
            .apply(Modifiers.makeHorizontalSlope(cw, SLOPE_ANGLE))
            .export(quadMap, null);
        } else if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), up ? 0 : 0.5, up ? 0.5 : 0),
            )
            .apply(Modifiers.makeVerticalSlope(up, SLOPE_ANGLE_VERT))
            .apply(Modifiers.offset(vertRotDir, 0.5))
            .export(quadMap, null);
        } else if (quadDir === vertRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.cut(horRotDir, cw ? 0.5 : 1, cw ? 1 : 0.5))
            .export(quadMap, quadDir);

          if (altSlope) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cut(opposite(horRotDir), cw ? 0 : 0.5, cw ? 0.5 : 0),
              )
              .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE))
              .export(quadMap, null);
          }
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedLargeInnerCornerSlopePanelGeometry.java` */
function largeInnerCornerSlopePanel(): GeometrySpec {
  return {
    properties: CORNER_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);

          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(cutDir), top ? 0.5 : 0, top ? 0 : 0.5),
            )
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(cutDir, top ? 0.5 : 1, top ? 1 : 0.5))
              .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
              .apply(Modifiers.offset(opposite(quadDir), 0.5))
              .export(quadMap, null);
          }
        } else if (
          altSlope &&
          ((!top && quadDir === "up") || (top && quadDir === "down"))
        ) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5, 1))
            .apply(
              Modifiers.makeVerticalSlope(
                counterClockWise(dir),
                SLOPE_ANGLE_VERT,
              ),
            )
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 1, 0.5))
            .apply(Modifiers.makeVerticalSlope(dir, SLOPE_ANGLE_VERT))
            .export(quadMap, null);
        } else if ((!top && quadDir === "down") || (top && quadDir === "up")) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .apply(Modifiers.cut(counterClockWise(dir), 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
    fullFaces: (s) => {
      // `LargeInnerCornerSlopePanelFullFacePredicate`
      const dir = s.facing as Direction;
      return [opposite(dir), clockWise(dir)];
    },
  };
}

/** `slopepanelcorner/FramedLargeInnerCornerSlopePanelWallGeometry.java` */
function largeInnerCornerSlopePanelWall(): GeometrySpec {
  return {
    properties: WALL_PROPERTIES,
    geometry: (s) => {
      const { dir, horRotDir, vertRotDir, altSlope } = wallRotDirs(s);
      return (quadDir, quadMap) => {
        const cw = horRotDir === clockWise(dir);
        const up = vertRotDir === "up";
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(horRotDir, 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.cut(vertRotDir, 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === horRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(vertRotDir, cw ? 0 : 0.5, cw ? 0.5 : 0))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 1 : 0.5, cw ? 0.5 : 1),
            )
            .apply(Modifiers.makeHorizontalSlope(cw, SLOPE_ANGLE))
            .apply(Modifiers.offset(opposite(horRotDir), 0.5))
            .export(quadMap, null);
        } else if (!altSlope && quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), up ? 0.5 : 1, up ? 1 : 0.5),
            )
            .apply(Modifiers.makeVerticalSlope(up, SLOPE_ANGLE_VERT))
            .export(quadMap, null);
        } else if (quadDir === vertRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(horRotDir, cw ? 0 : 0.5, cw ? 0.5 : 0))
            .export(quadMap, quadDir);

          if (altSlope) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cut(opposite(horRotDir), cw ? 0.5 : 1, cw ? 1 : 0.5),
              )
              .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE))
              .apply(Modifiers.offset(opposite(vertRotDir), 0.5))
              .export(quadMap, null);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `LargeInnerCornerSlopePanelWallFullFacePredicate`
      const dir = s.facing as Direction;
      return [
        HorizontalRotation.withFacing(
          HorizontalRotation.getOpposite(s.rotation),
          dir,
        ),
        HorizontalRotation.withFacing(
          HorizontalRotation.rotate(s.rotation, true),
          dir,
        ),
      ];
    },
  };
}

/** `slopepanelcorner/FramedExtendedCornerSlopePanelGeometry.java` */
function extendedCornerSlopePanel(): GeometrySpec {
  return {
    properties: CORNER_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0.5, top ? 0.5 : 1))
            .export(quadMap, quadDir);
        } else if (
          !altSlope &&
          (quadDir === opposite(dir) || quadDir === clockWise(dir))
        ) {
          const cutDir =
            quadDir === opposite(dir) ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0.5, top ? 0.5 : 1))
            .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
            .export(quadMap, null);
        } else if ((!top && quadDir === "up") || (top && quadDir === "down")) {
          if (altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0.5, 1))
              .apply(
                Modifiers.makeVerticalSlope(clockWise(dir), SLOPE_ANGLE_VERT),
              )
              .apply(Modifiers.offset(clockWise(dir), 0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 1, 0.5))
              .apply(
                Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE_VERT),
              )
              .apply(Modifiers.offset(opposite(dir), 0.5))
              .export(quadMap, null);
          }

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .apply(Modifiers.cut(clockWise(dir), 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
    // `FullFacePredicate.TOP`
    fullFaces: (s) => [isTrue(s.top) ? "up" : "down"],
  };
}

/** `slopepanelcorner/FramedExtendedCornerSlopePanelWallGeometry.java` */
function extendedCornerSlopePanelWall(): GeometrySpec {
  return {
    properties: WALL_PROPERTIES,
    geometry: (s) => {
      const { dir, horRotDir, vertRotDir, altSlope } = wallRotDirs(s);
      return (quadDir, quadMap) => {
        const cw = horRotDir === clockWise(dir);
        const up = vertRotDir === "up";
        if (quadDir === horRotDir) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 0.5 : 1, cw ? 1 : 0.5),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === vertRotDir) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), cw ? 1 : 0.5, cw ? 0.5 : 1),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(horRotDir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 1 : 0.5, cw ? 0.5 : 1),
            )
            .apply(Modifiers.makeHorizontalSlope(!cw, SLOPE_ANGLE))
            .export(quadMap, null);
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(horRotDir), 0.5))
            .apply(Modifiers.cut(opposite(vertRotDir), 0.5))
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cut(opposite(horRotDir), up ? 0.5 : 1, up ? 1 : 0.5),
              )
              .apply(Modifiers.makeVerticalSlope(!up, SLOPE_ANGLE_VERT))
              .apply(Modifiers.offset(opposite(vertRotDir), 0.5))
              .export(quadMap, null);
          }
        } else if (altSlope && quadDir === opposite(vertRotDir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(horRotDir), cw ? 1 : 0.5, cw ? 0.5 : 1),
            )
            .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE))
            .export(quadMap, null);
        }
      };
    },
    // `FullFacePredicate.HOR_DIR`
    fullFaces: (s) => [s.facing as Direction],
  };
}

/** `slopepanelcorner/FramedExtendedInnerCornerSlopePanelGeometry.java` */
function extendedInnerCornerSlopePanel(): GeometrySpec {
  return {
    properties: CORNER_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(cutDir), top ? 1 : 0.5, top ? 0.5 : 1),
            )
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(cutDir, top ? 0 : 0.5, top ? 0.5 : 0))
              .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
              .export(quadMap, null);
          }
        } else if ((!top && quadDir === "up") || (top && quadDir === "down")) {
          if (altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(opposite(dir), 0, 0.5))
              .apply(
                Modifiers.makeVerticalSlope(
                  counterClockWise(dir),
                  SLOPE_ANGLE_VERT,
                ),
              )
              .apply(Modifiers.offset(counterClockWise(dir), 0.5))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(clockWise(dir), 0.5, 0))
              .apply(Modifiers.makeVerticalSlope(dir, SLOPE_ANGLE_VERT))
              .apply(Modifiers.offset(dir, 0.5))
              .export(quadMap, null);
          }

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .apply(Modifiers.cut(counterClockWise(dir), 0.5))
            .export(quadMap, quadDir);
        }
      };
    },
    fullFaces: (s) => {
      // `ExtendedInnerCornerSlopePanelFullFacePredicate`
      const dir = s.facing as Direction;
      return [opposite(dir), clockWise(dir), isTrue(s.top) ? "up" : "down"];
    },
  };
}

/** `slopepanelcorner/FramedExtendedInnerCornerSlopePanelWallGeometry.java` */
function extendedInnerCornerSlopePanelWall(): GeometrySpec {
  return {
    properties: WALL_PROPERTIES,
    geometry: (s) => {
      const { dir, horRotDir, vertRotDir, altSlope } = wallRotDirs(s);
      return (quadDir, quadMap) => {
        const cw = horRotDir === clockWise(dir);
        const up = vertRotDir === "up";
        if (quadDir === horRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(vertRotDir, cw ? 0.5 : 1, cw ? 1 : 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(vertRotDir), cw ? 0.5 : 0, cw ? 0 : 0.5),
            )
            .apply(Modifiers.makeHorizontalSlope(cw, SLOPE_ANGLE))
            .export(quadMap, null);
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(vertRotDir, 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(vertRotDir), 0.5))
            .apply(Modifiers.cut(horRotDir, 0.5))
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cut(opposite(horRotDir), up ? 0 : 0.5, up ? 0.5 : 0),
              )
              .apply(Modifiers.makeVerticalSlope(up, SLOPE_ANGLE_VERT))
              .apply(Modifiers.offset(vertRotDir, 0.5))
              .export(quadMap, null);
          }
        } else if (quadDir === vertRotDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(horRotDir, cw ? 0.5 : 1, cw ? 1 : 0.5))
            .export(quadMap, quadDir);

          if (altSlope) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cut(opposite(horRotDir), cw ? 0 : 0.5, cw ? 0.5 : 0),
              )
              .apply(Modifiers.makeVerticalSlope(opposite(dir), SLOPE_ANGLE))
              .export(quadMap, null);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `ExtendedInnerCornerSlopePanelWallFullFacePredicate`
      const dir = s.facing as Direction;
      return [
        dir,
        opposite(HorizontalRotation.withFacing(s.rotation, dir)),
        opposite(perpRotDirOf(s.rotation, dir)),
      ];
    },
  };
}

// ── Prism slope panel corners ──────────────────────────────────────────────

/** `slopepanelcorner/FramedSmallPrismSlopePanelCornerGeometry.java` */
function smallPrismSlopePanelCorner(): GeometrySpec {
  return {
    properties: PRISM_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const upDir: Direction = top ? "down" : "up";
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const invAngle = (isPositive(clockWise(dir)) !== top) !== altSlope;
      const tiltOrigin = smallTiltOrigin(dir, top, altSlope);

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_HOR : PRISM_ANGLE_HOR;
        modifier
          .apply(
            Modifiers.cut(clockWise(dir), top ? 0.75 : 0.5, top ? 0.5 : 0.75),
          )
          .apply(
            Modifiers.cut(
              counterClockWise(dir),
              top ? 0.75 : 0.5,
              top ? 0.5 : 0.75,
            ),
          )
          .apply(Modifiers.setPosition(0.25))
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.rotate("y", Y_ROT_ORIGIN, 45, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_VERT : PRISM_ANGLE_VERT;
        modifier
          .apply(Modifiers.cut(clockWise(dir), 0.75, 0.5))
          .apply(Modifiers.cut(counterClockWise(dir), 0.5, 0.75))
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.rotate("y", Y_ROT_ORIGIN, 45, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 0.5 : 0, top ? 0 : 0.5))
            .export(quadMap, quadDir);
        } else if (!altSlope && quadDir === opposite(dir)) {
          makePrismSlope(
            quadMap,
            quadDir,
            offset,
            clockWise(dir),
            makePrismSlopeHorizontal,
          );
        } else if (altSlope && quadDir === upDir) {
          makePrismSlope(
            quadMap,
            quadDir,
            offset,
            clockWise(dir),
            makePrismSlopeVertical,
          );
        } else if (quadDir === opposite(upDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 0.5))
            .apply(Modifiers.cut(opposite(dir), 0.5, -0.5))
            .export(quadMap, quadDir);
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedSmallPrismSlopePanelCornerWallGeometry.java` */
function smallPrismSlopePanelCornerWall(): GeometrySpec {
  return {
    properties: PRISM_WALL_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const rot = s.rotation;
      const rotDirOne = HorizontalRotation.withFacing(rot, dir);
      const rotDirTwo = perpRotDirOf(rot, dir);
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const flipSideTris = rot === "down" || rot === "left";
      const flipPrismTri = rot === "left" || rot === (altSlope ? "down" : "up");
      const flipPrismTriOpp = rot === "right" || rot === "down";
      const tiltOrigin = smallWallTiltOrigin(dir, rot, altSlope);
      const invAngle = invertTiltAngle(dir, rot) === altSlope;
      const rotOrigin = dirAxisRotOrigin(dir);

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_HOR
          : WALL_PRISM_ANGLE_HOR;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 0.5 : 0.75,
              flipPrismTri ? 0.75 : 0.5,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 0.75 : 0.5,
              flipPrismTriOpp ? 0.5 : 0.75,
            ),
          )
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), tiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.rotate(axisOf(dir), rotOrigin, rotAngle, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_VERT
          : WALL_PRISM_ANGLE_VERT;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 0.5 : 0.75,
              flipPrismTri ? 0.75 : 0.5,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 0.75 : 0.5,
              flipPrismTriOpp ? 0.5 : 0.75,
            ),
          )
          .apply(Modifiers.setPosition(0.25))
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), tiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.rotate(axisOf(dir), rotOrigin, rotAngle, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(rotDirOne), 0.5))
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? -0.5 : 0.5,
                flipSideTris ? 0.5 : -0.5,
              ),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === rotDirOne) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? 0.5 : 0,
                flipSideTris ? 0 : 0.5,
              ),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === rotDirTwo) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirOne),
                flipSideTris ? 0 : 0.5,
                flipSideTris ? 0.5 : 0,
              ),
            )
            .export(quadMap, quadDir);
        } else if (altSlope && quadDir === opposite(rotDirOne)) {
          makePrismSlope(
            quadMap,
            quadDir,
            offset,
            rotDirTwo,
            makePrismSlopeVertical,
          );
        } else if (!altSlope && quadDir === opposite(dir)) {
          makePrismSlope(
            quadMap,
            quadDir,
            offset,
            rotDirTwo,
            makePrismSlopeHorizontal,
          );
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedLargePrismSlopePanelCornerGeometry.java` */
function largePrismSlopePanelCorner(): GeometrySpec {
  return {
    properties: PRISM_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const upDir: Direction = top ? "down" : "up";
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const tiltOrigin = largeTiltOrigin(dir, top, false);
      const invAngle = (isPositive(clockWise(dir)) !== top) !== altSlope;
      const yRotOrigin = largeYRotOrigin(dir);

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_HOR : PRISM_ANGLE_HOR;
        modifier
          .apply(Modifiers.cut(clockWise(dir), top ? 1 : 0.75, top ? 0.75 : 1))
          .apply(
            Modifiers.cut(
              counterClockWise(dir),
              top ? 1 : 0.75,
              top ? 0.75 : 1,
            ),
          )
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.rotate("y", yRotOrigin, 45, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_VERT : PRISM_ANGLE_VERT;
        modifier
          .apply(Modifiers.cut(clockWise(dir), 1, 0.75))
          .apply(Modifiers.cut(counterClockWise(dir), 0.75, 1))
          .apply(Modifiers.setPosition(0))
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.rotate("y", yRotOrigin, 45, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === dir || quadDir === counterClockWise(dir)) {
          const cutDir = quadDir === dir ? clockWise(dir) : opposite(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(cutDir, top ? 1 : 0.5, top ? 0.5 : 1))
            .export(quadMap, quadDir);
        } else if (!altSlope && quadDir === opposite(dir)) {
          makePrismSlope(
            quadMap,
            quadDir,
            offset,
            clockWise(dir),
            makePrismSlopeHorizontal,
          );
        } else if (quadDir === upDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), 0.5))
            .apply(Modifiers.cut(opposite(dir), 0.5, -0.5))
            .export(quadMap, quadDir);

          if (altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              clockWise(dir),
              makePrismSlopeVertical,
            );
          }
        } else if (quadDir === opposite(upDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .export(quadMap, quadDir);
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedLargePrismSlopePanelCornerWallGeometry.java` */
function largePrismSlopePanelCornerWall(): GeometrySpec {
  return {
    properties: PRISM_WALL_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const rot = s.rotation;
      const rotDirOne = HorizontalRotation.withFacing(rot, dir);
      const rotDirTwo = perpRotDirOf(rot, dir);
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const flipSideTris = rot === "down" || rot === "left";
      const flipPrismTri =
        rot === (altSlope ? "up" : "down") || rot === "right";
      const flipPrismTriOpp = rot === "down" || rot === "right";
      const rotTiltOrigin = largeWallRotTiltOrigin(dir, rot, altSlope);
      const invAngle = invertTiltAngle(dir, rot) === altSlope;

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_HOR
          : WALL_PRISM_ANGLE_HOR;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 1 : 0.75,
              flipPrismTri ? 0.75 : 1,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 1 : 0.75,
              flipPrismTriOpp ? 0.75 : 1,
            ),
          )
          .apply(Modifiers.setPosition(0))
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), rotTiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.rotate(axisOf(dir), rotTiltOrigin, rotAngle, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_VERT
          : WALL_PRISM_ANGLE_VERT;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 1 : 0.75,
              flipPrismTri ? 0.75 : 1,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 1 : 0.75,
              flipPrismTriOpp ? 0.75 : 1,
            ),
          )
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), rotTiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.rotate(axisOf(dir), rotTiltOrigin, rotAngle, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? 0 : 1,
                flipSideTris ? 1 : 0,
              ),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(rotDirTwo), 0.5))
            .apply(
              Modifiers.cut(
                opposite(rotDirOne),
                flipSideTris ? -0.5 : 0.5,
                flipSideTris ? 0.5 : -0.5,
              ),
            )
            .export(quadMap, quadDir);

          if (!altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              rotDirTwo,
              makePrismSlopeHorizontal,
            );
          }
        } else if (quadDir === rotDirOne) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? 1 : 0.5,
                flipSideTris ? 0.5 : 1,
              ),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === rotDirTwo) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirOne),
                flipSideTris ? 0.5 : 1,
                flipSideTris ? 1 : 0.5,
              ),
            )
            .export(quadMap, quadDir);
        } else if (altSlope && quadDir === opposite(rotDirOne)) {
          makePrismSlope(
            quadMap,
            quadDir,
            offset,
            rotDirTwo,
            makePrismSlopeVertical,
          );
        }
      };
    },
  };
}

/** `slopepanelcorner/FramedSmallInnerPrismSlopePanelCornerGeometry.java` */
function smallInnerPrismSlopePanelCorner(): GeometrySpec {
  return {
    properties: PRISM_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const upDir: Direction = top ? "down" : "up";
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const invAngle = (isPositive(clockWise(dir)) !== top) !== altSlope;
      const tiltOrigin = smallTiltOrigin(opposite(dir), !top, altSlope);

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_HOR : PRISM_ANGLE_HOR;
        modifier
          .apply(
            Modifiers.cut(clockWise(dir), top ? 0.5 : 0.75, top ? 0.75 : 0.5),
          )
          .apply(
            Modifiers.cut(
              counterClockWise(dir),
              top ? 0.5 : 0.75,
              top ? 0.75 : 0.5,
            ),
          )
          .apply(Modifiers.setPosition(0.75))
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.rotate("y", Y_ROT_ORIGIN, 45, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_VERT : PRISM_ANGLE_VERT;
        modifier
          .apply(Modifiers.cut(clockWise(dir), 0.5, 0.75))
          .apply(Modifiers.cut(counterClockWise(dir), 0.75, 0.5))
          .apply(Modifiers.setPosition(0))
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.rotate("y", Y_ROT_ORIGIN, 45, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === clockWise(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), top ? 1 : 0.5, top ? 0.5 : 1))
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), top ? 1 : 0.5, top ? 0.5 : 1))
            .export(quadMap, quadDir);

          if (!altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              clockWise(dir),
              makePrismSlopeHorizontal,
            );
          }
        } else if (quadDir === upDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, 0.5))
            .apply(Modifiers.cut(clockWise(dir), 0.5, 1.5))
            .export(quadMap, quadDir);

          if (altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              clockWise(dir),
              makePrismSlopeVertical,
            );
          }
        }
      };
    },
    fullFaces: (s) => innerPrismFullFaces(s, true),
  };
}

/** `InnerPrismSlopePanelCornerFullFacePredicate` (`small`: the small block also has a full bottom). */
function innerPrismFullFaces(s: BlockState, small: boolean): Direction[] {
  const dir = s.facing as Direction;
  const downDir: Direction = isTrue(s.top) ? "up" : "down";
  return small
    ? [dir, counterClockWise(dir), downDir]
    : [dir, counterClockWise(dir)];
}

/** `InnerPrismSlopePanelCornerWallFullFacePredicate` (`small`: the small block also has a full `facing` face). */
function innerPrismWallFullFaces(s: BlockState, small: boolean): Direction[] {
  const dir = s.facing as Direction;
  const faces = [
    HorizontalRotation.withFacing(s.rotation, dir),
    perpRotDirOf(s.rotation, dir),
  ];
  return small ? [dir, ...faces] : faces;
}

/** `slopepanelcorner/FramedSmallInnerPrismSlopePanelCornerWallGeometry.java` */
function smallInnerPrismSlopePanelCornerWall(): GeometrySpec {
  return {
    properties: PRISM_WALL_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const rot = s.rotation;
      const rotDirOne = HorizontalRotation.withFacing(rot, dir);
      const rotDirTwo = perpRotDirOf(rot, dir);
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const flipSideTris = rot === "down" || rot === "right";
      const flipPrismTri = rot === "left" || rot === (altSlope ? "down" : "up");
      const flipPrismTriOpp = rot === "right" || rot === "down";
      const tiltRot = HorizontalRotation.isVertical(rot)
        ? HorizontalRotation.getOpposite(rot)
        : rot;
      const tiltOrigin = smallWallTiltOrigin(opposite(dir), tiltRot, altSlope);
      const invAngle = invertTiltAngle(dir, rot) === altSlope;
      const rotOrigin = dirAxisRotOrigin(dir);

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_HOR
          : WALL_PRISM_ANGLE_HOR;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 0.75 : 0.5,
              flipPrismTri ? 0.5 : 0.75,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 0.5 : 0.75,
              flipPrismTriOpp ? 0.75 : 0.5,
            ),
          )
          .apply(Modifiers.setPosition(0))
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), tiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.rotate(axisOf(dir), rotOrigin, rotAngle, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_VERT
          : WALL_PRISM_ANGLE_VERT;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 0.75 : 0.5,
              flipPrismTri ? 0.5 : 0.75,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 0.5 : 0.75,
              flipPrismTriOpp ? 0.75 : 0.5,
            ),
          )
          .apply(Modifiers.setPosition(0.75))
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), tiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.rotate(axisOf(dir), rotOrigin, rotAngle, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(rotDirOne), 0.5))
            .export(quadMap, quadDir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(rotDirOne, 0.5))
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? 0.5 : 1.5,
                flipSideTris ? 1.5 : 0.5,
              ),
            )
            .export(quadMap, quadDir);

          if (!altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              rotDirTwo,
              makePrismSlopeHorizontal,
            );
          }
        } else if (quadDir === opposite(rotDirOne)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? 1 : 0.5,
                flipSideTris ? 0.5 : 1,
              ),
            )
            .export(quadMap, quadDir);

          if (altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              rotDirTwo,
              makePrismSlopeVertical,
            );
          }
        } else if (quadDir === opposite(rotDirTwo)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirOne),
                flipSideTris ? 1 : 0.5,
                flipSideTris ? 0.5 : 1,
              ),
            )
            .export(quadMap, quadDir);
        }
      };
    },
    fullFaces: (s) => innerPrismWallFullFaces(s, true),
  };
}

/** `slopepanelcorner/FramedLargeInnerPrismSlopePanelCornerGeometry.java` */
function largeInnerPrismSlopePanelCorner(): GeometrySpec {
  return {
    properties: PRISM_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      const upDir: Direction = top ? "down" : "up";
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const tiltOrigin = largeTiltOrigin(dir, !top, altSlope);
      const invAngle = (isPositive(clockWise(dir)) !== top) !== altSlope;
      const yRotOrigin = largeYRotOrigin(dir);

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_HOR : PRISM_ANGLE_HOR;
        modifier
          .apply(Modifiers.cut(clockWise(dir), top ? 0.75 : 1, top ? 1 : 0.75))
          .apply(
            Modifiers.cut(
              counterClockWise(dir),
              top ? 0.75 : 1,
              top ? 1 : 0.75,
            ),
          )
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.rotate("y", yRotOrigin, 45, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle ? -PRISM_ANGLE_VERT : PRISM_ANGLE_VERT;
        modifier
          .apply(Modifiers.cut(clockWise(dir), 0.75, 1))
          .apply(Modifiers.cut(counterClockWise(dir), 1, 0.75))
          .apply(Modifiers.setPosition(0))
          .apply(
            Modifiers.rotate(
              axisOf(clockWise(dir)),
              tiltOrigin,
              tiltAngle,
              true,
            ),
          )
          .apply(Modifiers.offset(opposite(dir), 0.25))
          .apply(Modifiers.rotate("y", yRotOrigin, 45, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === clockWise(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), top ? 0.5 : 0, top ? 0 : 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(clockWise(dir), top ? 0.5 : 0, top ? 0 : 0.5))
            .export(quadMap, quadDir);

          if (!altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              clockWise(dir),
              makePrismSlopeHorizontal,
            );
          }
        } else if (quadDir === upDir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .export(quadMap, quadDir);

          if (altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              clockWise(dir),
              makePrismSlopeVertical,
            );
          }
        } else if (quadDir === opposite(upDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 0.5))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, 0.5))
            .apply(Modifiers.cut(clockWise(dir), 0.5, 1.5))
            .export(quadMap, quadDir);
        }
      };
    },
    fullFaces: (s) => innerPrismFullFaces(s, false),
  };
}

/** `slopepanelcorner/FramedLargeInnerPrismSlopePanelCornerWallGeometry.java` */
function largeInnerPrismSlopePanelCornerWall(): GeometrySpec {
  return {
    properties: PRISM_WALL_PROPERTIES,
    geometry: (s) => {
      const dir = s.facing as Direction;
      const rot = s.rotation;
      const rotDirOne = HorizontalRotation.withFacing(rot, dir);
      const rotDirTwo = perpRotDirOf(rot, dir);
      const altSlope = isTrue(s.alt_slope);
      const offset = isTrue(s.offset);
      const flipSideTris = rot === "down" || rot === "right";
      const flipPrismTri =
        rot === (altSlope ? "up" : "down") || rot === "right";
      const flipPrismTriOpp = rot === "down" || rot === "right";
      const tiltRot = HorizontalRotation.isVertical(rot)
        ? rot
        : HorizontalRotation.getOpposite(rot);
      const tiltOrigin = largeWallRotTiltOrigin(
        opposite(dir),
        tiltRot,
        !altSlope,
      );
      const invAngle = invertTiltAngle(dir, rot) === altSlope;
      const rotOrigin = largeInnerWallRotOrigin(dir, rot, altSlope);

      const makePrismSlopeHorizontal: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_HOR
          : WALL_PRISM_ANGLE_HOR;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 0.75 : 1,
              flipPrismTri ? 1 : 0.75,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 0.75 : 1,
              flipPrismTriOpp ? 1 : 0.75,
            ),
          )
          .apply(Modifiers.setPosition(0))
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), tiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.offset(opposite(rotDirTwo), 0.25))
          .apply(Modifiers.rotate(axisOf(dir), rotOrigin, rotAngle, true))
          .export(quadMap, null);
      };
      const makePrismSlopeVertical: SlopeMaker = (quadMap, modifier) => {
        const tiltAngle = invAngle
          ? -WALL_PRISM_ANGLE_VERT
          : WALL_PRISM_ANGLE_VERT;
        const rotAngle = isPositive(dir) ? -45 : 45;
        modifier
          .apply(
            Modifiers.cut(
              rotDirTwo,
              flipPrismTri ? 0.75 : 1,
              flipPrismTri ? 1 : 0.75,
            ),
          )
          .apply(
            Modifiers.cut(
              opposite(rotDirTwo),
              flipPrismTriOpp ? 0.75 : 1,
              flipPrismTriOpp ? 1 : 0.75,
            ),
          )
          .apply(
            Modifiers.rotate(axisOf(rotDirTwo), tiltOrigin, tiltAngle, true),
          )
          .apply(Modifiers.rotate(axisOf(dir), rotOrigin, rotAngle, true))
          .export(quadMap, null);
      };

      return (quadDir, quadMap) => {
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(rotDirTwo), 0.5))
            .export(quadMap, quadDir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(rotDirTwo, 0.5))
            .apply(
              Modifiers.cut(
                opposite(rotDirOne),
                flipSideTris ? 1.5 : 0.5,
                flipSideTris ? 0.5 : 1.5,
              ),
            )
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? 0 : 1,
                flipSideTris ? 1 : 0,
              ),
            )
            .export(quadMap, quadDir);

          if (!altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              rotDirTwo,
              makePrismSlopeHorizontal,
            );
          }
        } else if (quadDir === opposite(rotDirOne)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirTwo),
                flipSideTris ? 0.5 : 0,
                flipSideTris ? 0 : 0.5,
              ),
            )
            .export(quadMap, quadDir);

          if (altSlope) {
            makePrismSlope(
              quadMap,
              quadDir,
              offset,
              rotDirTwo,
              makePrismSlopeVertical,
            );
          }
        } else if (quadDir === opposite(rotDirTwo)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(
                opposite(rotDirOne),
                flipSideTris ? 0.5 : 0,
                flipSideTris ? 0 : 0.5,
              ),
            )
            .export(quadMap, quadDir);
        }
      };
    },
    fullFaces: (s) => innerPrismWallFullFaces(s, false),
  };
}

/** Slope-panel-corner-package geometries, keyed by block id without namespace. */
export const SLOPE_PANEL_CORNER_GEOMETRY_SPECS: Readonly<
  Record<string, GeometrySpec>
> = {
  framed_small_corner_slope_panel: smallCornerSlopePanel(),
  framed_small_corner_slope_panel_w: smallCornerSlopePanelWall(),
  framed_large_corner_slope_panel: largeCornerSlopePanel(),
  framed_large_corner_slope_panel_w: largeCornerSlopePanelWall(),
  framed_small_inner_corner_slope_panel: smallInnerCornerSlopePanel(),
  framed_small_inner_corner_slope_panel_w: smallInnerCornerSlopePanelWall(),
  framed_large_inner_corner_slope_panel: largeInnerCornerSlopePanel(),
  framed_large_inner_corner_slope_panel_w: largeInnerCornerSlopePanelWall(),
  framed_ext_corner_slope_panel: extendedCornerSlopePanel(),
  framed_ext_corner_slope_panel_w: extendedCornerSlopePanelWall(),
  framed_ext_inner_corner_slope_panel: extendedInnerCornerSlopePanel(),
  framed_ext_inner_corner_slope_panel_w: extendedInnerCornerSlopePanelWall(),
  framed_small_prism_corner_slope_panel: smallPrismSlopePanelCorner(),
  framed_small_prism_corner_slope_panel_w: smallPrismSlopePanelCornerWall(),
  framed_large_prism_corner_slope_panel: largePrismSlopePanelCorner(),
  framed_large_prism_corner_slope_panel_w: largePrismSlopePanelCornerWall(),
  framed_small_inner_prism_corner_slope_panel:
    smallInnerPrismSlopePanelCorner(),
  framed_small_inner_prism_corner_slope_panel_w:
    smallInnerPrismSlopePanelCornerWall(),
  framed_large_inner_prism_corner_slope_panel:
    largeInnerPrismSlopePanelCorner(),
  framed_large_inner_prism_corner_slope_panel_w:
    largeInnerPrismSlopePanelCornerWall(),
};

// ── Double and stacked blocks ──────────────────────────────────────────────

const part = (block: string, props: BlockState): PartState => ({
  block,
  props,
});

/** Two parts of a non-wall double: part one as-is, part two flipped `top`. */
function cornerParts(one: string, two: string) {
  return (s: BlockState): [PartState, PartState] => [
    part(one, { facing: s.facing, top: s.top, alt_slope: s.alt_slope }),
    part(two, {
      facing: s.facing,
      top: String(!isTrue(s.top)),
      alt_slope: s.alt_slope,
    }),
  ];
}

/** Two parts of a wall double: part two faces back, with `backRot`. */
function wallParts(one: string, two: string) {
  return (s: BlockState): [PartState, PartState] => {
    const backRot = HorizontalRotation.rotate(
      s.rotation,
      HorizontalRotation.isVertical(s.rotation),
    );
    return [
      part(one, {
        facing: s.facing,
        rotation: s.rotation,
        alt_slope: s.alt_slope,
      }),
      part(two, {
        facing: opposite(s.facing as Direction),
        rotation: backRot,
        alt_slope: s.alt_slope,
      }),
    ];
  };
}

/** `FramedStackedCornerSlopePanelWallBlock.calculateParts`'s `otherDir`/`top`. */
function stackedWallOther(s: BlockState): {
  otherDir: Direction;
  top: boolean;
} {
  const dir = s.facing as Direction;
  switch (s.rotation) {
    case "up":
      return { otherDir: counterClockWise(dir), top: true };
    case "down":
      return { otherDir: clockWise(dir), top: false };
    case "right":
      return { otherDir: clockWise(dir), top: true };
    default:
      return { otherDir: counterClockWise(dir), top: false };
  }
}

export const SLOPE_PANEL_CORNER_DOUBLE_BLOCK_SPECS: Readonly<
  Record<string, DoubleBlockSpec>
> = {
  // `FramedDoubleCornerSlopePanelBlock`
  framed_small_double_corner_slope_panel: {
    properties: CORNER_PROPERTIES,
    parts: cornerParts(
      "framed_small_inner_corner_slope_panel",
      "framed_small_corner_slope_panel",
    ),
  },
  // `FramedDoubleCornerSlopePanelBlock`
  framed_large_double_corner_slope_panel: {
    properties: CORNER_PROPERTIES,
    parts: cornerParts(
      "framed_large_inner_corner_slope_panel",
      "framed_large_corner_slope_panel",
    ),
  },
  // `FramedDoubleCornerSlopePanelWallBlock`
  framed_small_double_corner_slope_panel_w: {
    properties: WALL_PROPERTIES,
    parts: wallParts(
      "framed_small_inner_corner_slope_panel_w",
      "framed_small_corner_slope_panel_w",
    ),
  },
  // `FramedDoubleCornerSlopePanelWallBlock`
  framed_large_double_corner_slope_panel_w: {
    properties: WALL_PROPERTIES,
    parts: wallParts(
      "framed_large_inner_corner_slope_panel_w",
      "framed_large_corner_slope_panel_w",
    ),
  },
  // `FramedInverseDoubleCornerSlopePanelBlock`
  framed_inv_double_corner_slope_panel: {
    properties: CORNER_PROPERTIES,
    parts: cornerParts(
      "framed_large_corner_slope_panel",
      "framed_small_inner_corner_slope_panel",
    ),
  },
  // `FramedInverseDoubleCornerSlopePanelWallBlock`
  framed_inv_double_corner_slope_panel_w: {
    properties: WALL_PROPERTIES,
    parts: wallParts(
      "framed_large_corner_slope_panel_w",
      "framed_small_inner_corner_slope_panel_w",
    ),
  },
  // `FramedExtendedDoubleCornerSlopePanelBlock`
  framed_ext_double_corner_slope_panel: {
    properties: CORNER_PROPERTIES,
    parts: cornerParts(
      "framed_ext_corner_slope_panel",
      "framed_large_inner_corner_slope_panel",
    ),
  },
  // `FramedExtendedDoubleCornerSlopePanelBlock`
  framed_ext_inner_double_corner_slope_panel: {
    properties: CORNER_PROPERTIES,
    parts: cornerParts(
      "framed_ext_inner_corner_slope_panel",
      "framed_small_corner_slope_panel",
    ),
  },
  // `FramedExtendedDoubleCornerSlopePanelWallBlock`
  framed_ext_double_corner_slope_panel_w: {
    properties: WALL_PROPERTIES,
    parts: wallParts(
      "framed_ext_corner_slope_panel_w",
      "framed_large_inner_corner_slope_panel_w",
    ),
  },
  // `FramedExtendedDoubleCornerSlopePanelWallBlock`
  framed_ext_inner_double_corner_slope_panel_w: {
    properties: WALL_PROPERTIES,
    parts: wallParts(
      "framed_ext_inner_corner_slope_panel_w",
      "framed_small_corner_slope_panel_w",
    ),
  },
  // `FramedStackedCornerSlopePanelBlock`
  framed_stacked_corner_slope_panel: {
    properties: CORNER_PROPERTIES,
    parts: (s) => [
      part("framed_corner_pillar", { facing: s.facing }),
      part("framed_large_corner_slope_panel", {
        facing: s.facing,
        top: s.top,
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedStackedCornerSlopePanelBlock`
  framed_stacked_inner_corner_slope_panel: {
    properties: CORNER_PROPERTIES,
    parts: (s) => [
      part("framed_vertical_stairs", {
        facing: opposite(s.facing as Direction),
      }),
      part("framed_small_inner_corner_slope_panel", {
        facing: s.facing,
        top: s.top,
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedStackedCornerSlopePanelWallBlock`
  framed_stacked_corner_slope_panel_w: {
    properties: WALL_PROPERTIES,
    parts: (s) => {
      const { otherDir, top } = stackedWallOther(s);
      return [
        part("framed_slab_edge", { facing: otherDir, top: String(top) }),
        part("framed_large_corner_slope_panel_w", {
          facing: s.facing,
          rotation: s.rotation,
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
  // `FramedStackedCornerSlopePanelWallBlock`
  framed_stacked_inner_corner_slope_panel_w: {
    properties: WALL_PROPERTIES,
    parts: (s) => {
      const { otherDir, top } = stackedWallOther(s);
      return [
        part("framed_stairs", {
          facing: opposite(otherDir),
          half: top ? "bottom" : "top",
        }),
        part("framed_small_inner_corner_slope_panel_w", {
          facing: s.facing,
          rotation: s.rotation,
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
};
