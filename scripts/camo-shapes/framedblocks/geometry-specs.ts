// Hand ports of FramedBlocks' bespoke (non-templated)
// `client/model/geometry/**/*Geometry.java` classes. Read by
// `scripts/generate-camo-shapes.mts`. The `slope/`, `slopeedge/` and
// `prism/` packages live in `slope.ts`, `slope-edge.ts` and `prism.ts` and
// join `GEOMETRY_SPECS` below; `geometry-api.ts` has the shared
// `Direction`, `Modifiers` and `QuadModifier` ports.
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (mod_version in
// gradle.properties). Each spec below names the Java class it ports; when a
// FramedBlocks release changes one of them, update the port and regenerate.
//
// The ports stay close to the Java: FramedBlocks runs a geometry's
// `transformQuad` once per camo face quad, and each
// `QuadModifier.of(quad).apply(...).export(quadMap, cullFace)` becomes one
// shape-pack piece that takes that camo face (`faces: [face]`) through the
// same `Modifiers` (shape-pack `QuadOp`s, run by `quad-ops.ts`). A piece is
// cullable when the Java exports it under its own direction.
//
// Faces that FramedBlocks' `FullFacePredicates` report as full skip
// `transformQuad` (unless the geometry sets `transformAllQuads`) and use the
// camo quad as is; `fullFaces` lists them.
//
// Not ported (render differences only): additional non-camo parts from
// `collectAdditionalParts*` (torch flames, lantern glass, lever handles,
// chest latches, flower pot plants and dirt, item frame leather), overlays,
// light emission and connected textures. Shapes that depend on block entity
// data rather than the block state use their default data: collapsible
// blocks render uncollapsed (no vertex offsets) and chests render without
// the animated lid of their opening/closing states.

import type {
  Axis,
  Direction,
  Vec3,
} from "../../../src/lib/render/camo/shape-pack";
import {
  BOOL,
  DIRECTIONS,
  FACING,
  HORIZONTAL,
  Modifiers,
  MultiQuadModifier,
  NULLABLE_FACE,
  QuadModifier,
  RAIL_SHAPE,
  RAIL_SHAPE_STRAIGHT,
  ROTATION_16,
  WALL_SIDE,
  axisOf,
  clockWise,
  counterClockWise,
  dir,
  from2DDataValue,
  fromAxis,
  isPositive,
  isTrue,
  isX,
  isY,
  isZ,
  opposite,
  perpendicularAxis,
  toYRot,
  type BlockState,
  type GeometrySpec,
  type Modifier,
  type QuadPiece,
  type TransformQuad,
} from "./geometry-api.ts";
import { PRISM_GEOMETRY_SPECS } from "./prism.ts";
import { SLOPE_EDGE_GEOMETRY_SPECS } from "./slope-edge.ts";
import { SLOPE_GEOMETRY_SPECS } from "./slope.ts";

export type { BlockState, GeometrySpec, QuadPiece, TransformQuad };

// ── Cubes ──────────────────────────────────────────────────────────────────

/**
 * `cube/FramedCubeGeometry.java` (and the other geometries with an empty
 * `transformQuad` on a full cube: `FramedMarkedCubeGeometry`,
 * `FramedTargetGeometry`): every face is full.
 */
function cube(): GeometrySpec {
  return {
    properties: {},
    geometry: () => () => {},
    fullFaces: () => DIRECTIONS,
  };
}

/**
 * `cube/FramedOneWayWindowGeometry.java`: the window face shows tinted
 * glass (not ported), every other face is full.
 */
function oneWayWindow(): GeometrySpec {
  return {
    properties: { face: NULLABLE_FACE },
    geometry: () => () => {},
    fullFaces: (s) => DIRECTIONS.filter((d) => d !== s.face),
  };
}

/**
 * `cube/FramedCollapsibleBlockGeometry.java`. The collapsed vertex offsets
 * live in the block entity; without them (offsets 0) every face keeps its
 * full position.
 */
function collapsibleBlock(): GeometrySpec {
  return {
    properties: { face: NULLABLE_FACE, rot_split_line: BOOL },
    geometry: (s) => (quadDir, quadMap) => {
      // `vertexPos` is all 1: the collapsed face stays in place (exported
      // without cull face) and the side cuts are no-ops.
      QuadModifier.of(quadDir).export(
        quadMap,
        quadDir === s.face ? null : quadDir,
      );
    },
    fullFaces: (s) =>
      s.face === "none" ? DIRECTIONS : [opposite(dir(s.face))],
  };
}

/**
 * `cube/FramedCollapsibleCopycatBlockGeometry.java`. Offsets live in the
 * block entity; with none (packed offsets 0) the camo quads are used as is.
 */
function collapsibleCopycatBlock(): GeometrySpec {
  return {
    properties: {},
    geometry: () => () => {},
    fullFaces: () => DIRECTIONS,
  };
}

/** `cube/FramedMiniCubeGeometry.java`. */
function miniCube(): GeometrySpec {
  return {
    properties: { rotation: ROTATION_16, top: BOOL },
    geometry: (s) => {
      const rot = Number(s.rotation);
      const rotAngle = (4 - (rot % 4)) * 22.5;
      const top = isTrue(s.top);
      const bottomFace: Direction = top ? "up" : "down";
      const origin: Vec3 = top ? [0.5, 1, 0.5] : [0.5, 0, 0.5];
      return (quadDir, quadMap) => {
        QuadModifier.of(quadDir)
          .apply(Modifiers.scaleFace(0.5, origin))
          .applyIf(Modifiers.setPosition(0.5), quadDir === opposite(bottomFace))
          .applyIf(Modifiers.setPosition(0.75), !isY(quadDir))
          .apply(Modifiers.rotate("y", origin, rotAngle))
          .export(quadMap, quadDir === bottomFace ? quadDir : null);
      };
    },
  };
}

/** `cube/FramedChestGeometry.java` (the lid of opening chests is animated by the block entity renderer and not ported). */
function chest(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      type: ["single", "left", "right"],
      state: ["closed", "opening", "closing"],
      latch: ["default", "camo", "none"],
    },
    geometry: (s) => {
      const facing = dir(s.facing);
      const type = s.type;
      const closed = s.state === "closed";
      const latch = s.latch;
      return (quadDir, quadMap) => {
        if (isY(quadDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutAxis(axisOf(facing), 15 / 16))
            .applyIf(Modifiers.cut(clockWise(facing), 15 / 16), type !== "left")
            .applyIf(
              Modifiers.cut(counterClockWise(facing), 15 / 16),
              type !== "right",
            )
            .applyIf(
              Modifiers.setPosition(closed ? 14 / 16 : 10 / 16),
              quadDir === "up",
            )
            .export(quadMap, quadDir === "up" ? null : quadDir);
        } else if (axisOf(quadDir) === axisOf(facing)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", closed ? 14 / 16 : 10 / 16))
            .applyIf(Modifiers.cut(clockWise(facing), 15 / 16), type !== "left")
            .applyIf(
              Modifiers.cut(counterClockWise(facing), 15 / 16),
              type !== "right",
            )
            .apply(Modifiers.setPosition(15 / 16))
            .export(quadMap, null);
        } else {
          const offset =
            (type !== "right" || quadDir !== counterClockWise(facing)) &&
            (type !== "left" || quadDir !== clockWise(facing));
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", closed ? 14 / 16 : 10 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 15 / 16))
            .applyIf(Modifiers.setPosition(15 / 16), offset)
            .export(quadMap, offset ? null : quadDir);
        }

        if (latch === "camo" && closed) {
          makeChestLatch(quadMap, quadDir, facing, type);
        }
      };
    },
  };
}

/** `FramedChestGeometry.makeChestLatch`. */
function makeChestLatch(
  quadMap: QuadPiece[],
  face: Direction,
  facing: Direction,
  type: string,
): void {
  const length = type === "single" ? 9 / 16 : 1 / 16;
  if (face === facing || face === opposite(facing)) {
    QuadModifier.of(face)
      .apply(Modifiers.cut("down", 9 / 16))
      .apply(Modifiers.cut("up", 11 / 16))
      .applyIf(Modifiers.cut(clockWise(facing), length), type !== "left")
      .applyIf(
        Modifiers.cut(counterClockWise(facing), length),
        type !== "right",
      )
      .applyIf(Modifiers.setPosition(1 / 16), face !== facing)
      .export(quadMap, face === facing ? facing : null);
  } else if (isY(face)) {
    QuadModifier.of(face)
      .apply(Modifiers.cut(opposite(facing), 1 / 16))
      .applyIf(Modifiers.cut(clockWise(facing), length), type !== "left")
      .applyIf(
        Modifiers.cut(counterClockWise(facing), length),
        type !== "right",
      )
      .apply(Modifiers.setPosition(face === "up" ? 11 / 16 : 9 / 16))
      .export(quadMap, null);
  } else {
    const offset =
      (type !== "right" || face !== counterClockWise(facing)) &&
      (type !== "left" || face !== clockWise(facing));
    QuadModifier.of(face)
      .apply(Modifiers.cutSide(0, 7 / 16, 1, 11 / 16))
      .apply(Modifiers.cut(opposite(facing), 1 / 16))
      .applyIf(Modifiers.setPosition(length), offset)
      .export(quadMap, offset ? null : face);
  }
}

// ── Pillars ────────────────────────────────────────────────────────────────

/** `pillar/FramedWallGeometry.java`. */
function wall(): GeometrySpec {
  // Wall half segment top/bottom rects: minX, minZ, maxX, maxZ.
  const RECTS: [number, number, number, number][] = [
    [5 / 16, 0, 11 / 16, 5 / 16], // North
    [5 / 16, 11 / 16, 11 / 16, 1], // South
    [0, 5 / 16, 5 / 16, 11 / 16], // West
    [11 / 16, 5 / 16, 1, 11 / 16], // East
    [5 / 16, 0, 11 / 16, 4 / 16], // North, with center pillar
    [5 / 16, 12 / 16, 11 / 16, 1], // South, with center pillar
    [0, 5 / 16, 4 / 16, 11 / 16], // West, with center pillar
    [12 / 16, 5 / 16, 1, 11 / 16], // East, with center pillar
  ];
  const LOW_HEIGHT = 14 / 16;
  const SMALL_MIN = 5 / 16;
  const SMALL_MAX = 11 / 16;
  const LARGE_MIN = 4 / 16;
  const LARGE_MAX = 12 / 16;

  return {
    properties: {
      up: ["true", "false"],
      north: WALL_SIDE,
      east: WALL_SIDE,
      south: WALL_SIDE,
      west: WALL_SIDE,
    },
    geometry: (s) => {
      const center = isTrue(s.up);
      const sides: Record<string, string> = {
        north: s.north,
        east: s.east,
        south: s.south,
        west: s.west,
      };

      const buildWallHalfSegment = (
        quadMap: QuadPiece[],
        quadDir: Direction,
        side: Direction,
        height: string,
      ) => {
        if (height === "none") return;
        if (isY(quadDir)) {
          const [minX, minZ, maxX, maxZ] =
            RECTS[DIRECTIONS.indexOf(side) - 2 + (center ? 4 : 0)];
          const inset = height !== "tall" && quadDir !== "down";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutTopBottom(minX, minZ, maxX, maxZ))
            .applyIf(Modifiers.setPosition(LOW_HEIGHT), inset)
            .export(quadMap, inset ? null : quadDir);
        } else if (axisOf(quadDir) !== axisOf(side)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cut(opposite(side), center ? LARGE_MIN : SMALL_MIN),
            )
            .applyIf(Modifiers.cut("up", LOW_HEIGHT), height !== "tall")
            .apply(Modifiers.setPosition(SMALL_MAX))
            .export(quadMap, null);
        }
      };

      const buildWallEndCap = (
        quadMap: QuadPiece[],
        quadDir: Direction,
        side: Direction,
        height: string,
      ) => {
        if (quadDir === side && height !== "none") {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cutSide(
                SMALL_MIN,
                0,
                SMALL_MAX,
                height === "tall" ? 1 : LOW_HEIGHT,
              ),
            )
            .export(quadMap, side);
        }
      };

      const tall = Object.values(sides).includes("tall");

      const buildSmallCenterSide = (
        quadMap: QuadPiece[],
        quadDir: Direction,
        height: string,
      ) => {
        if (height === "none") {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cutSide(SMALL_MIN, 0, SMALL_MAX, tall ? 1 : LOW_HEIGHT),
            )
            .apply(Modifiers.setPosition(SMALL_MAX))
            .export(quadMap, null);
        } else if (tall && height === "low") {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSide(SMALL_MIN, LOW_HEIGHT, SMALL_MAX, 1))
            .apply(Modifiers.setPosition(SMALL_MAX))
            .export(quadMap, null);
        }
      };

      const buildCenterPillar = (quadMap: QuadPiece[], quadDir: Direction) => {
        if (center) {
          if (isY(quadDir)) {
            QuadModifier.of(quadDir)
              .apply(
                Modifiers.cutTopBottom(
                  LARGE_MIN,
                  LARGE_MIN,
                  LARGE_MAX,
                  LARGE_MAX,
                ),
              )
              .export(quadMap, quadDir);
          } else {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutSide(LARGE_MIN, 0, LARGE_MAX, 1))
              .apply(Modifiers.setPosition(LARGE_MAX))
              .export(quadMap, null);
          }
        } else if (isY(quadDir)) {
          const inset = !tall && quadDir === "up";
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cutTopBottom(
                SMALL_MIN,
                SMALL_MIN,
                SMALL_MAX,
                SMALL_MAX,
              ),
            )
            .applyIf(Modifiers.setPosition(LOW_HEIGHT), inset)
            .export(quadMap, inset ? null : quadDir);
        } else {
          buildSmallCenterSide(quadMap, quadDir, sides[quadDir]);
        }
      };

      return (quadDir, quadMap) => {
        for (const side of ["north", "south", "east", "west"] as const) {
          buildWallHalfSegment(quadMap, quadDir, side, sides[side]);
        }
        for (const side of ["north", "east", "south", "west"] as const) {
          buildWallEndCap(quadMap, quadDir, side, sides[side]);
        }
        buildCenterPillar(quadMap, quadDir);
      };
    },
  };
}

/** `pillar/FramedChainGeometry.java`. */
function chain(): GeometrySpec {
  const ROT_ORIGIN: Vec3 = [0.5, 0.5, 0.5];
  return {
    properties: { axis: ["y", "x", "z"] },
    geometry: (s) => {
      const axis = s.axis as Axis;
      const dirUp = fromAxis(axis, true);
      const dirDown = fromAxis(axis, false);

      const createChainEdgeParts = (
        quadMap: QuadPiece[],
        quadDir: Direction,
        quadPerpAxis: Axis,
        fourSection: boolean,
      ) => {
        const dirNeg = fromAxis(quadPerpAxis, false);
        const dirPos = fromAxis(quadPerpAxis, true);
        const baseMod = MultiQuadModifier.of(
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dirNeg, 10 / 16))
            .apply(Modifiers.cut(dirPos, 7 / 16))
            .apply(Modifiers.offset(dirPos, 0.5 / 16)),
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dirNeg, 7 / 16))
            .apply(Modifiers.cut(dirPos, 10 / 16))
            .apply(Modifiers.offset(dirNeg, 0.5 / 16)),
        );

        const modifiers: MultiQuadModifier[] = fourSection
          ? [
              baseMod.derive().apply(Modifiers.cut(dirUp, 2 / 16)),
              baseMod
                .derive()
                .apply(Modifiers.cut(dirUp, 7 / 16))
                .apply(Modifiers.cut(dirDown, 13 / 16)),
              baseMod
                .derive()
                .apply(Modifiers.cut(dirDown, 7 / 16))
                .apply(Modifiers.cut(dirUp, 13 / 16)),
              baseMod.derive().apply(Modifiers.cut(dirDown, 2 / 16)),
            ]
          : [
              baseMod
                .derive()
                .apply(Modifiers.cut(dirDown, 4 / 16))
                .apply(Modifiers.cut(dirUp, 15 / 16)),
              baseMod
                .derive()
                .apply(Modifiers.cut(dirDown, 10 / 16))
                .apply(Modifiers.cut(dirUp, 10 / 16)),
              baseMod
                .derive()
                .apply(Modifiers.cut(dirUp, 4 / 16))
                .apply(Modifiers.cut(dirDown, 15 / 16)),
            ];

        for (const mod of modifiers) {
          mod
            .apply(Modifiers.setPosition(0.5))
            .apply(Modifiers.rotate(axis, ROT_ORIGIN, 45))
            .export(quadMap, null);
        }
      };

      const createChainCenterParts = (
        quadMap: QuadPiece[],
        quadDir: Direction,
        horCutAxis: Axis,
      ) => {
        for (let i = 0; i < 6; i++) {
          const height = i === 0 ? 2 : i === 5 ? 15 : 3 * i + 1;
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutAxis(horCutAxis, 8.5 / 16))
            .apply(Modifiers.cut(dirDown, height / 16))
            .apply(Modifiers.cut(dirUp, (16 - height + 1) / 16))
            .apply(Modifiers.setPosition(0.5))
            .apply(Modifiers.rotate(axis, ROT_ORIGIN, 45))
            .export(quadMap, null);
        }
      };

      return (quadDir, quadMap) => {
        if (axisOf(quadDir) === axis) return;

        const quadPerpAxis = perpendicularAxis(axisOf(quadDir), axis);
        if (axis === "y") {
          createChainEdgeParts(quadMap, quadDir, quadPerpAxis, isX(quadDir));
          createChainCenterParts(quadMap, quadDir, quadPerpAxis);
        } else if (isY(quadDir)) {
          const perpAxis: Axis = axis === "x" ? "z" : "x";
          createChainEdgeParts(quadMap, quadDir, quadPerpAxis, axis === "z");
          createChainCenterParts(quadMap, quadDir, perpAxis);
        } else {
          createChainEdgeParts(quadMap, quadDir, quadPerpAxis, axis === "x");
          createChainCenterParts(quadMap, quadDir, "y");
        }
      };
    },
  };
}

/** `pillar/FramedLightningRodGeometry.java`. */
function lightningRod(): GeometrySpec {
  const MIN_FRONT = 6 / 16;
  const MAX_FRONT = 10 / 16;
  const MIN_BACK = 7 / 16;
  const MAX_BACK = 9 / 16;
  return {
    properties: {
      facing: ["up", ...FACING.filter((f) => f !== "up")],
      copycat_style: BOOL,
    },
    geometry: (s) => {
      const facing = dir(s.facing);
      const copycatHead = isTrue(s.copycat_style);
      const getOffset = (offsetDir: Direction) =>
        offsetDir === facing
          ? 12 / 16
          : offsetDir === opposite(facing)
            ? 0
            : 6 / 16;

      return (quadDir, quadMap) => {
        const vertical = isY(quadDir);
        const front = quadDir === facing;
        const back = quadDir === opposite(facing);
        const quadAxis = axisOf(quadDir);

        if (copycatHead) {
          for (const d of DIRECTIONS) {
            if (axisOf(d) === quadAxis) continue;
            const dirCw = clockWise(d, quadAxis);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(d, 2 / 16))
              .apply(Modifiers.cut(dirCw, 2 / 16))
              .apply(Modifiers.offset(d, getOffset(d)))
              .apply(Modifiers.offset(dirCw, getOffset(dirCw)))
              .applyIf(Modifiers.setPosition(back ? 4 / 16 : 10 / 16), !front)
              .export(quadMap, front ? quadDir : null);
          }
        } else if (front || back) {
          QuadModifier.of(quadDir)
            .apply(
              vertical
                ? Modifiers.cutTopBottom(
                    MIN_FRONT,
                    MIN_FRONT,
                    MAX_FRONT,
                    MAX_FRONT,
                  )
                : Modifiers.cutSide(MIN_FRONT, MIN_FRONT, MAX_FRONT, MAX_FRONT),
            )
            .applyIf(Modifiers.setPosition(4 / 16), back)
            .export(quadMap, front ? quadDir : null);
        } else {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(facing), 4 / 16))
            .apply(Modifiers.cut(clockWise(facing, quadAxis), 10 / 16))
            .apply(Modifiers.cut(counterClockWise(facing, quadAxis), 10 / 16))
            .apply(Modifiers.setPosition(10 / 16))
            .export(quadMap, null);
        }

        if (back) {
          QuadModifier.of(quadDir)
            .apply(
              vertical
                ? Modifiers.cutTopBottom(MIN_BACK, MIN_BACK, MAX_BACK, MAX_BACK)
                : Modifiers.cutSide(MIN_BACK, MIN_BACK, MAX_BACK, MAX_BACK),
            )
            .export(quadMap, quadDir);
        } else if (!front) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(facing, 12 / 16))
            .apply(Modifiers.cut(clockWise(facing, quadAxis), 9 / 16))
            .apply(Modifiers.cut(counterClockWise(facing, quadAxis), 9 / 16))
            .apply(Modifiers.setPosition(9 / 16))
            .export(quadMap, null);
        }
      };
    },
  };
}

// ── Panes ──────────────────────────────────────────────────────────────────

const PANE_PROPERTIES = {
  north: BOOL,
  east: BOOL,
  south: BOOL,
  west: BOOL,
} as const;

/** `FramedPaneGeometry.createTopBottomCenterQuad`. */
function createTopBottomCenterQuad(
  quadMap: QuadPiece[],
  quadDir: Direction,
  mirrored: boolean,
): void {
  QuadModifier.of(quadDir)
    .apply(Modifiers.cutTopBottom(7 / 16, 7 / 16, 9 / 16, 9 / 16))
    .applyIf(Modifiers.setPosition(0.001), mirrored)
    .export(quadMap, mirrored ? null : quadDir);
}

/** `FramedPaneGeometry.createTopBottomEdgeQuad`. */
function createTopBottomEdgeQuad(
  quadMap: QuadPiece[],
  quadDir: Direction,
  side: Direction,
  mirrored: boolean,
): void {
  QuadModifier.of(quadDir)
    .apply(Modifiers.cut(opposite(side), 7 / 16))
    .apply(Modifiers.cutAxis(axisOf(clockWise(side)), 9 / 16))
    .applyIf(Modifiers.setPosition(0.001), mirrored)
    .export(quadMap, mirrored ? null : quadDir);
}

/** `FramedPaneGeometry.createSideEdgeQuad`. */
function createSideEdgeQuad(
  quadMap: QuadPiece[],
  quadDir: Direction,
  inset: boolean,
  mirrored: boolean,
): void {
  // A mirrored quad culls against the opposite side, which the shape pack
  // can't express: leave it unculled.
  const exportSide = inset || mirrored ? null : quadDir;
  QuadModifier.of(quadDir)
    .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 9 / 16))
    .applyIf(Modifiers.setPosition(9 / 16), inset)
    .applyIf(Modifiers.setPosition(0.001), !inset && mirrored)
    .export(quadMap, exportSide);
}

function paneConnections(s: BlockState) {
  const connected: Record<string, boolean> = {
    north: isTrue(s.north),
    east: isTrue(s.east),
    south: isTrue(s.south),
    west: isTrue(s.west),
  };
  /** `FramedPaneGeometry.isSideInset`. */
  const isSideInset = (face: Direction) => !connected[face];
  return { connected, isSideInset };
}

/** `pane/FramedPaneGeometry.java`. */
function pane(): GeometrySpec {
  return {
    properties: PANE_PROPERTIES,
    geometry: (s) => {
      const { connected, isSideInset } = paneConnections(s);
      const createSideQuad = (
        quadMap: QuadPiece[],
        quadDir: Direction,
        side: Direction,
      ) => {
        QuadModifier.of(quadDir)
          .apply(Modifiers.cut(opposite(side), 7 / 16))
          .apply(Modifiers.setPosition(9 / 16))
          .export(quadMap, null);
      };

      return (face, quadMap) => {
        if (isY(face)) {
          createTopBottomCenterQuad(quadMap, face, false);
          for (const side of ["north", "east", "south", "west"] as const) {
            if (connected[side]) {
              createTopBottomEdgeQuad(quadMap, face, side, false);
            }
          }
        } else {
          // `isPillarVisible()` is always true for panes.
          createSideEdgeQuad(quadMap, face, isSideInset(face), false);
          if (isX(face)) {
            if (connected.north) createSideQuad(quadMap, face, "north");
            if (connected.south) createSideQuad(quadMap, face, "south");
          }
          if (isZ(face)) {
            if (connected.east) createSideQuad(quadMap, face, "east");
            if (connected.west) createSideQuad(quadMap, face, "west");
          }
        }
      };
    },
  };
}

/** `pane/FramedBarsGeometry.java`. */
function bars(): GeometrySpec {
  /**
   * `perpNeg`/`perpPos`: connections perpendicular to the quad, negative
   * and positive; `parNeg`/`parPos`: connections in the quad's plane.
   */
  const createCenterPillarQuad = (
    quadMap: QuadPiece[],
    quadDir: Direction,
    perpNeg: boolean,
    perpPos: boolean,
    parNeg: boolean,
    parPos: boolean,
  ) => {
    if (perpNeg && perpPos && !parNeg && !parPos) return;

    const perpendicular = perpNeg || perpPos;
    const oneParallel = parNeg !== parPos;
    const minXZ = perpendicular && oneParallel && !parPos ? 8 / 16 : 7 / 16;
    const maxXZ = perpendicular && oneParallel && !parNeg ? 8 / 16 : 9 / 16;

    let offset: number;
    if (parNeg || parPos) {
      offset = 0.5;
    } else {
      offset = perpNeg ? 9 / 16 : perpPos ? 7 / 16 : 0.5;
      if (isPositive(quadDir)) offset = 1 - offset;
    }

    QuadModifier.of(quadDir)
      .apply(Modifiers.cutSide(minXZ, 0, maxXZ, 1))
      .apply(Modifiers.setPosition(offset))
      .export(quadMap, null);
  };

  const createPillarQuad = (
    quadMap: QuadPiece[],
    quadDir: Direction,
    side: Direction,
  ) => {
    const positive = isPositive(side);
    QuadModifier.of(quadDir)
      .apply(
        Modifiers.cutSide(
          positive ? 12 / 16 : 2 / 16,
          0,
          positive ? 14 / 16 : 4 / 16,
          1,
        ),
      )
      .apply(Modifiers.setPosition(0.5))
      .export(quadMap, null);
  };

  const createBarQuads = (
    quadMap: QuadPiece[],
    quadDir: Direction,
    side: Direction,
  ) => {
    const positive = isPositive(side);
    const northeast = side === "north" || side === "east";
    QuadModifier.of(quadDir)
      .apply(
        Modifiers.cutSide(
          positive ? 9 / 16 : 4 / 16,
          northeast ? 2 / 16 : 12 / 16,
          positive ? 12 / 16 : 7 / 16,
          northeast ? 4 / 16 : 14 / 16,
        ),
      )
      .apply(Modifiers.setPosition(0.5))
      .export(quadMap, null);

    QuadModifier.of(quadDir)
      .apply(
        Modifiers.cutSide(
          positive ? 14 / 16 : 0,
          7 / 16,
          positive ? 1 : 2 / 16,
          9 / 16,
        ),
      )
      .apply(Modifiers.setPosition(0.5))
      .export(quadMap, null);
  };

  return {
    properties: PANE_PROPERTIES,
    geometry: (s) => {
      const { connected, isSideInset } = paneConnections(s);
      const { north, east, south, west } = connected;
      return (face, quadMap) => {
        if (isY(face)) {
          createTopBottomCenterQuad(quadMap, face, false);
          createTopBottomCenterQuad(quadMap, face, true);
          for (const side of ["north", "east", "south", "west"] as const) {
            if (connected[side]) {
              createTopBottomEdgeQuad(quadMap, face, side, false);
              createTopBottomEdgeQuad(quadMap, face, side, true);
            }
          }
          return;
        }

        if (!isSideInset(face)) {
          createSideEdgeQuad(quadMap, face, false, false);
        }
        if (!isSideInset(opposite(face))) {
          createSideEdgeQuad(quadMap, face, false, true);
        }

        if (isX(face)) {
          createCenterPillarQuad(quadMap, face, east, west, south, north);
          for (const side of ["north", "south"] as const) {
            if (connected[side]) {
              createPillarQuad(quadMap, face, side);
              createBarQuads(quadMap, face, side);
            }
          }
        }
        if (isZ(face)) {
          createCenterPillarQuad(quadMap, face, south, north, east, west);
          for (const side of ["east", "west"] as const) {
            if (connected[side]) {
              createPillarQuad(quadMap, face, side);
              createBarQuads(quadMap, face, side);
            }
          }
        }
      };
    },
  };
}

/** `pane/FramedBoardGeometry.java`. */
function board(): GeometrySpec {
  const DEPTH = 1 / 16;
  // Per axis, the directions not on it, in `Direction.values()` order.
  const EDGES: Record<Axis, Direction[]> = {
    x: DIRECTIONS.filter((d) => axisOf(d) !== "x"),
    y: DIRECTIONS.filter((d) => axisOf(d) !== "y"),
    z: DIRECTIONS.filter((d) => axisOf(d) !== "z"),
  };
  const hasFace = (faces: number, side: Direction) =>
    (faces & (1 << DIRECTIONS.indexOf(side))) !== 0;

  return {
    properties: {
      faces: Array.from({ length: 63 }, (_, i) => String(i + 1)),
    },
    geometry: (s) => {
      const faces = Number(s.faces);
      // `canCullInner` also needs a solid camo; assume one, as that is what
      // boards are built from.
      const canCullInner = faces === 0b111111;
      return (quadDir, quadMap) => {
        const edges = EDGES[axisOf(quadDir)];
        if (hasFace(faces, opposite(quadDir)) && !canCullInner) {
          const modifier = QuadModifier.of(quadDir).apply(
            Modifiers.setPosition(DEPTH),
          );
          for (const edge of edges) {
            if (hasFace(faces, edge)) {
              modifier.apply(Modifiers.cut(edge, 1 - DEPTH));
            }
          }
          modifier.export(quadMap, null);
        }
        if (!hasFace(faces, quadDir)) {
          for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            if (!hasFace(faces, edge)) continue;

            const modifier = QuadModifier.of(quadDir).apply(
              Modifiers.cut(opposite(edge), DEPTH),
            );
            if (i % 2 !== 0) {
              const cornerOne = edges[i - 1];
              const cornerTwo = edges[(i + 1) % 4];
              if (hasFace(faces, cornerOne)) {
                modifier.apply(Modifiers.cut(cornerOne, 1 - DEPTH));
              }
              if (hasFace(faces, cornerTwo)) {
                modifier.apply(Modifiers.cut(cornerTwo, 1 - DEPTH));
              }
            }
            modifier.export(quadMap, quadDir);
          }
        }
      };
    },
    // `BoardFullFacePredicate`.
    fullFaces: (s) => DIRECTIONS.filter((d) => hasFace(Number(s.faces), d)),
    transformAllQuads: true,
  };
}

// ── Torches ────────────────────────────────────────────────────────────────

const TORCH_HEIGHT = 8 / 16;
const TORCH_HEIGHT_REDSTONE_LIT = 7 / 16;

/** `torch/FramedTorchGeometry.java`; `redstone` reads `lit`. */
function torch(redstone: boolean): GeometrySpec {
  const MIN = 7 / 16;
  const MAX = 9 / 16;
  return {
    properties: redstone ? { lit: ["true", "false"] } : {},
    geometry: (s) => {
      const height =
        redstone && isTrue(s.lit) ? TORCH_HEIGHT_REDSTONE_LIT : TORCH_HEIGHT;
      return (quadDir, quadMap) => {
        if (quadDir === "down") {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutTopBottom(MIN, MIN, MAX, MAX))
            .export(quadMap, quadDir);
        } else if (quadDir !== "up") {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSide(MIN, 0, MAX, height))
            .apply(Modifiers.setPosition(MAX))
            .export(quadMap, null);
        }
      };
    },
  };
}

/** `torch/FramedWallTorchGeometry.java`; `redstone` reads `lit`. */
function wallTorch(redstone: boolean): GeometrySpec {
  const ROTATION_ORIGIN: Vec3 = [0, 3.5 / 16, 8 / 16];
  const MIN = 7 / 16;
  const MAX = 9 / 16;
  const BOTTOM = 12.5 / 16;
  return {
    properties: redstone
      ? { facing: HORIZONTAL, lit: ["true", "false"] }
      : { facing: HORIZONTAL },
    geometry: (s) => {
      const yAngle = 270 - toYRot(dir(s.facing));
      const height =
        redstone && isTrue(s.lit) ? TORCH_HEIGHT_REDSTONE_LIT : TORCH_HEIGHT;
      const applyRotation: Modifier = [
        ...Modifiers.rotate("z", ROTATION_ORIGIN, -22.5),
        ...Modifiers.rotateCentered("y", yAngle),
      ];
      return (quadDir, quadMap) => {
        if (quadDir === "down") {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutTopBottom(MIN, MIN, MAX, MAX))
            .apply(Modifiers.setPosition(BOTTOM))
            .apply(Modifiers.offset("west", 0.5))
            .apply(applyRotation)
            .export(quadMap, null);
        } else if (quadDir !== "up") {
          const xAxis = isX(quadDir);
          const east = quadDir === "east";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSide(MIN, 0, MAX, height))
            .applyIf(Modifiers.setPosition(east ? 1 / 16 : 17 / 16), xAxis)
            .applyIf(Modifiers.setPosition(MAX), !xAxis)
            .applyIf(Modifiers.offset("west", 0.5), !xAxis)
            .apply(Modifiers.offset("up", 3.5 / 16))
            .apply(applyRotation)
            .export(quadMap, null);
        }
      };
    },
  };
}

/** `torch/FramedLanternGeometry.java`; soul and copper lanterns have a closed head. */
function lantern(closedHead: boolean): GeometrySpec {
  const ROT_ORIGIN: Vec3 = [0.5, 0.5, 0.5];
  return {
    properties: { hanging: BOOL, chain: ["camo", "metal", "none"] },
    geometry: (s) => {
      const hanging = isTrue(s.hanging);
      const camoChain = s.chain === "camo";

      const createCamoChain = (quadMap: QuadPiece[], quadDir: Direction) => {
        const quadPerpAxis: Axis = isX(quadDir) ? "z" : "x";
        const dirNeg = fromAxis(quadPerpAxis, false);
        const dirPos = fromAxis(quadPerpAxis, true);

        const modifiers: MultiQuadModifier[] = [];
        const baseEdgeMod = MultiQuadModifier.of(
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dirNeg, 10 / 16))
            .apply(Modifiers.cut(dirPos, 7 / 16))
            .apply(Modifiers.offset(dirPos, 0.5 / 16)),
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dirNeg, 7 / 16))
            .apply(Modifiers.cut(dirPos, 10 / 16))
            .apply(Modifiers.offset(dirNeg, 0.5 / 16)),
        );

        if (isX(quadDir) || !hanging) {
          modifiers.push(
            baseEdgeMod
              .derive()
              .apply(Modifiers.cut("down", hanging ? 6 / 16 : 7 / 16))
              .apply(Modifiers.cut("up", hanging ? 12 / 16 : 11 / 16)),
          );
        }
        for (let i = 0; i < 2; i++) {
          if (!hanging && i === 0) continue;
          const height = i === 0 ? 2 : hanging ? 5 : 6;
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 8.5 / 16))
            .apply(Modifiers.cut("down", height / 16))
            .apply(Modifiers.cut("up", (16 - height + 1) / 16))
            .apply(Modifiers.setPosition(0.5))
            .apply(Modifiers.rotate("y", ROT_ORIGIN, 45))
            .export(quadMap, null);
        }

        if (hanging) {
          if (isX(quadDir)) {
            modifiers.push(
              baseEdgeMod.derive().apply(Modifiers.cut("down", 2 / 16)),
            );
          } else if (isZ(quadDir)) {
            modifiers.push(
              baseEdgeMod
                .derive()
                .apply(Modifiers.cut("down", 5 / 16))
                .apply(Modifiers.cut("up", 15 / 16)),
            );
          }
        }

        for (const mod of modifiers) {
          mod
            .apply(Modifiers.setPosition(0.5))
            .apply(Modifiers.rotate("y", ROT_ORIGIN, 45))
            .export(quadMap, null);
        }
      };

      return (quadDir, quadMap) => {
        if (isY(quadDir)) {
          const up = quadDir === "up";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutTopBottom(5 / 16, 5 / 16, 11 / 16, 11 / 16))
            .applyIf(Modifiers.setPosition(15 / 16), hanging && !up)
            .applyIf(Modifiers.setPosition(hanging ? 8 / 16 : 7 / 16), up)
            .export(quadMap, hanging || up ? null : "down");

          if (up) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutTopBottom(6 / 16, 6 / 16, 10 / 16, 10 / 16))
              .apply(Modifiers.setPosition(hanging ? 10 / 16 : 9 / 16))
              .export(quadMap, null);
          }
          return;
        }

        const sideMods = [
          Modifiers.cutSide(5 / 16, 0, 6 / 16, 7 / 16),
          Modifiers.cutSide(10 / 16, 0, 11 / 16, 7 / 16),
          Modifiers.cutSide(6 / 16, 0, 10 / 16, 1 / 16),
          Modifiers.cutSide(6 / 16, 6 / 16, 10 / 16, 7 / 16),
        ];
        for (const cut of sideMods) {
          QuadModifier.of(quadDir)
            .apply(cut)
            .applyIf(Modifiers.offset("up", 1 / 16), hanging)
            .apply(Modifiers.setPosition(11 / 16))
            .export(quadMap, null);
        }

        QuadModifier.of(quadDir)
          .apply(
            Modifiers.cutSide(
              6 / 16,
              closedHead ? 7 / 16 : 8 / 16,
              10 / 16,
              9 / 16,
            ),
          )
          .applyIf(Modifiers.offset("up", 1 / 16), hanging)
          .apply(Modifiers.setPosition(10 / 16))
          .export(quadMap, null);

        if (camoChain) createCamoChain(quadMap, quadDir);
      };
    },
  };
}

// ── Interactive ────────────────────────────────────────────────────────────

/** `interactive/FramedSignGeometry.java`. */
function sign(): GeometrySpec {
  const Y_OFF = 1.75 / 16;
  const POS = 9 / 16;
  return {
    properties: { rotation: ROTATION_16 },
    geometry: (s) => {
      const rotation = Number(s.rotation);
      const signDir = from2DDataValue(Math.floor(rotation / 4));
      const rotDegrees = (rotation % 4) * -22.5;
      const rotate = Modifiers.rotateCentered("y", rotDegrees);
      return (quadDir, quadMap) => {
        if (axisOf(quadDir) === axisOf(signDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("down", 0.5))
            .apply(Modifiers.setPosition(POS))
            .apply(Modifiers.offset("up", Y_OFF))
            .apply(rotate)
            .export(quadMap, null);
        } else if (isY(quadDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutAxis(axisOf(signDir), 9 / 16))
            .applyIf(Modifiers.setPosition(0.5), quadDir === "down")
            .apply(Modifiers.offset("up", Y_OFF))
            .apply(rotate)
            .export(quadMap, null);
        } else {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSide(7 / 16, 0.5, 9 / 16, 1))
            .apply(Modifiers.offset("up", Y_OFF))
            .apply(rotate)
            .export(quadMap, null);
        }

        if (!isY(quadDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSide(7 / 16, 0, 9 / 16, 9.75 / 16))
            .apply(Modifiers.setPosition(POS))
            .apply(rotate)
            .export(quadMap, null);
        } else if (quadDir === "down") {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutTopBottom(7 / 16, 7 / 16, 9 / 16, 9 / 16))
            .apply(rotate)
            .export(quadMap, "down");
        }
      };
    },
  };
}

/** `interactive/FramedCeilingHangingSignGeometry.java`. */
function ceilingHangingSign(): GeometrySpec {
  return {
    properties: { rotation: ROTATION_16, attached: BOOL },
    geometry: (s) => {
      const rotation = Number(s.rotation);
      const signDir = from2DDataValue(Math.floor(rotation / 4));
      const rotDegrees = (rotation % 4) * -22.5;
      const attached = isTrue(s.attached);
      const rotate = Modifiers.rotateCentered("y", rotDegrees);
      return (quadDir, quadMap) => {
        if (axisOf(quadDir) === axisOf(signDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 10 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 15 / 16))
            .apply(Modifiers.setPosition(9 / 16))
            .applyIf(rotate, attached)
            .export(quadMap, null);
        } else if (axisOf(quadDir) === axisOf(clockWise(signDir))) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 10 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 9 / 16))
            .apply(Modifiers.setPosition(15 / 16))
            .applyIf(rotate, attached)
            .export(quadMap, null);
        } else {
          const up = quadDir === "up";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutAxis(axisOf(signDir), 9 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(signDir)), 15 / 16))
            .applyIf(Modifiers.setPosition(10 / 16), up)
            .applyIf(rotate, attached)
            .export(quadMap, up ? null : quadDir);
        }
      };
    },
  };
}

/** `interactive/FramedWallHangingSignGeometry.java`. */
function wallHangingSign(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL },
    geometry: (s) => {
      const signDir = dir(s.facing);
      return (quadDir, quadMap) => {
        if (axisOf(quadDir) === axisOf(signDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 10 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 15 / 16))
            .apply(Modifiers.setPosition(9 / 16))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("down", 2 / 16))
            .apply(Modifiers.setPosition(10 / 16))
            .export(quadMap, null);
        } else if (axisOf(quadDir) === axisOf(clockWise(signDir))) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 10 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 9 / 16))
            .apply(Modifiers.setPosition(15 / 16))
            .export(quadMap, null);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("down", 2 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), 10 / 16))
            .export(quadMap, quadDir);
        } else {
          const up = quadDir === "up";
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutAxis(axisOf(signDir), 9 / 16))
            .apply(Modifiers.cutAxis(axisOf(clockWise(signDir)), 15 / 16))
            .applyIf(Modifiers.setPosition(10 / 16), up)
            .export(quadMap, up ? null : quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cutAxis(axisOf(signDir), 10 / 16))
            .applyIf(Modifiers.setPosition(2 / 16), !up)
            .export(quadMap, up ? quadDir : null);
        }
      };
    },
  };
}

/** `interactive/FramedLeverGeometry.java`. */
function lever(): GeometrySpec {
  const MIN_SMALL = 5 / 16;
  const MAX_SMALL = 11 / 16;
  const MIN_LARGE = 4 / 16;
  const MAX_LARGE = 12 / 16;
  const HEIGHT = 3 / 16;
  return {
    properties: { face: ["wall", "floor", "ceiling"], facing: HORIZONTAL },
    geometry: (s) => {
      const leverDir = dir(s.facing);
      const facing: Direction =
        s.face === "floor" ? "up" : s.face === "ceiling" ? "down" : leverDir;
      return (quadDir, quadMap) => {
        const quadInDir = quadDir === facing;
        if (isY(facing)) {
          if (axisOf(quadDir) === axisOf(facing)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cutAxis(axisOf(leverDir), MAX_LARGE))
              .apply(Modifiers.cutAxis(axisOf(clockWise(leverDir)), MAX_SMALL))
              .applyIf(Modifiers.setPosition(HEIGHT), quadInDir)
              .export(quadMap, quadInDir ? null : quadDir);
          } else {
            const smallSide = axisOf(leverDir) === axisOf(quadDir);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(facing, HEIGHT))
              .apply(
                Modifiers.cutAxis(
                  axisOf(clockWise(quadDir)),
                  smallSide ? MAX_SMALL : MAX_LARGE,
                ),
              )
              .apply(Modifiers.setPosition(smallSide ? MAX_LARGE : MAX_SMALL))
              .export(quadMap, null);
          }
        } else if (axisOf(quadDir) === axisOf(facing)) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cutSide(MIN_SMALL, MIN_LARGE, MAX_SMALL, MAX_LARGE),
            )
            .applyIf(Modifiers.setPosition(HEIGHT), quadInDir)
            .export(quadMap, quadInDir ? null : quadDir);
        } else if (isY(quadDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(leverDir, HEIGHT))
            .apply(Modifiers.cutAxis(axisOf(clockWise(leverDir)), MAX_SMALL))
            .apply(Modifiers.setPosition(MAX_LARGE))
            .export(quadMap, null);
        } else {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(leverDir, HEIGHT))
            .apply(Modifiers.cutAxis("y", MAX_LARGE))
            .apply(Modifiers.setPosition(MAX_SMALL))
            .export(quadMap, null);
        }
      };
    },
  };
}

/** `interactive/FramedFlowerPotGeometry.java` (the plant and dirt are not ported). */
function flowerPot(): GeometrySpec {
  return {
    properties: {},
    geometry: () => (quadDir, quadMap) => {
      if (quadDir === "down") {
        QuadModifier.of(quadDir)
          .apply(Modifiers.cutTopBottom(5 / 16, 5 / 16, 11 / 16, 11 / 16))
          .export(quadMap, "down");
      } else if (quadDir === "up") {
        const rims: [number, number, number, number][] = [
          [5 / 16, 5 / 16, 11 / 16, 6 / 16],
          [5 / 16, 10 / 16, 11 / 16, 11 / 16],
          [5 / 16, 6 / 16, 6 / 16, 10 / 16],
          [10 / 16, 6 / 16, 11 / 16, 10 / 16],
        ];
        for (const [minX, minZ, maxX, maxZ] of rims) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutTopBottom(minX, minZ, maxX, maxZ))
            .apply(Modifiers.setPosition(6 / 16))
            .export(quadMap, null);
        }
      } else {
        QuadModifier.of(quadDir)
          .apply(Modifiers.cutSide(5 / 16, 0, 11 / 16, 6 / 16))
          .apply(Modifiers.setPosition(11 / 16))
          .export(quadMap, null);

        QuadModifier.of(quadDir)
          .apply(Modifiers.cutSide(6 / 16, 1 / 16, 10 / 16, 6 / 16))
          .apply(Modifiers.setPosition(6 / 16))
          .export(quadMap, null);
      }
    },
  };
}

/** `interactive/FramedItemFrameGeometry.java` (normal and glowing). */
function itemFrame(): GeometrySpec {
  return {
    properties: { facing: FACING, leather: BOOL, map_frame: BOOL },
    geometry: (s) => {
      const facing = dir(s.facing);
      const leather = isTrue(s.leather);
      const mapFrame = isTrue(s.map_frame);
      const innerLength = mapFrame ? 15 / 16 : 13 / 16;
      const innerPos = mapFrame ? 1 / 16 : 3 / 16;
      const innerMin = mapFrame ? 1 / 16 : 3 / 16;
      const innerMax = mapFrame ? 15 / 16 : 13 / 16;
      const outerMin = mapFrame ? 0 : 2 / 16;
      const outerMax = mapFrame ? 1 : 14 / 16;

      /** `cutTopBottom` for vertical frames, `cutSide` for horizontal ones. */
      const cutRect = isY(facing) ? Modifiers.cutTopBottom : Modifiers.cutSide;

      const makeFrontAndBack = (quadMap: QuadPiece[], quadFace: Direction) => {
        if (quadFace === facing) {
          QuadModifier.of(quadFace)
            .applyIf(cutRect(outerMin, outerMin, outerMax, outerMax), !mapFrame)
            .export(quadMap, quadFace);
          return;
        }
        if (!leather && !mapFrame) {
          QuadModifier.of(quadFace)
            .apply(cutRect(innerMin, innerMin, innerMax, innerMax))
            .apply(Modifiers.setPosition(0.5 / 16))
            .export(quadMap, null);
        }
        if (!mapFrame || leather) {
          const rects: [number, number, number, number][] = [
            [outerMin, outerMin, innerMin, outerMax],
            [innerMax, outerMin, outerMax, outerMax],
            [innerMin, outerMin, innerMax, innerMin],
            [innerMin, innerMax, innerMax, outerMax],
          ];
          for (const [a, b, c, d] of rects) {
            QuadModifier.of(quadFace)
              .apply(cutRect(a, b, c, d))
              .apply(Modifiers.setPosition(1 / 16))
              .export(quadMap, null);
          }
        }
        if (mapFrame && !leather) {
          QuadModifier.of(quadFace)
            .apply(Modifiers.setPosition(1 / 16))
            .export(quadMap, quadFace);
        }
      };

      /** The four rim sides; `rimCut` cuts the rim to the frame's width. */
      const makeRimSide = (
        quadMap: QuadPiece[],
        quadFace: Direction,
        rimCut: (length: number) => Modifier,
      ) => {
        QuadModifier.of(quadFace)
          .apply(Modifiers.cut(opposite(facing), 1 / 16))
          .applyIf(rimCut(outerMax), !mapFrame)
          .applyIf(Modifiers.setPosition(outerMax), !mapFrame)
          .export(quadMap, null);

        if (!mapFrame) {
          QuadModifier.of(quadFace)
            .apply(Modifiers.cut(facing, 15.5 / 16))
            .apply(Modifiers.cut(opposite(facing), 1 / 16))
            .apply(rimCut(innerLength))
            .apply(Modifiers.setPosition(innerPos))
            .export(quadMap, null);
        }
      };

      return (quadFace, quadMap) => {
        if (axisOf(quadFace) === axisOf(facing)) {
          makeFrontAndBack(quadMap, quadFace);
        } else if (isY(facing)) {
          // `makeVerticalFrame`.
          makeRimSide(quadMap, quadFace, (length) =>
            Modifiers.cutAxis(axisOf(clockWise(quadFace)), length),
          );
        } else if (isY(quadFace)) {
          // `makeHorizontalFrame`, top and bottom rims.
          makeRimSide(quadMap, quadFace, (length) =>
            Modifiers.cutAxis(axisOf(clockWise(facing)), length),
          );
        } else {
          // `makeHorizontalFrame`, side rims.
          makeRimSide(quadMap, quadFace, (length) =>
            Modifiers.cutAxis("y", length),
          );
        }
      };
    },
  };
}

/**
 * `interactive/FramedBannerFlagGeometry.java` placed by
 * `FramedBannerRenderer` (the banner block itself has no camo model; the
 * flag is rendered by the block entity renderer). The flag geometry turns
 * the flag into a canonical orientation, then the renderer's transform
 * (`createTransform`) scales it and turns it to the banner's rotation. The
 * wind swing (a fraction of a degree) and the vanilla pole are not ported.
 */
function bannerFlag(wall: boolean): GeometrySpec {
  const SCALE = 0.6666667 * (20 / 16);
  return {
    properties: wall ? { facing: HORIZONTAL } : { rotation: ROTATION_16 },
    geometry: (s) => {
      let flagDir: Direction;
      let angle: number;
      let transform: [number, number, number];
      if (wall) {
        flagDir = dir(s.facing);
        angle = toYRot(flagDir);
        transform = [1, -0.175, 0.125];
      } else {
        // `FramedBannerFlagModel.getModel(rotation)`.
        const rotation = Number(s.rotation);
        const horizontal = ["north", "east", "south", "west"] as const;
        flagDir = horizontal[((rotation + 8) >> 2) & 0b11];
        angle = rotation * 22.5;
        transform = [2, -0.2, 0.65];
      }
      const [yOffPreScale, yOffPostScale, zOffPostScale] = transform;
      // `createTransform`: translate(.5, 0, .5), rotate -angle about Y,
      // translate(0, yOffPreScale, -.5), scale, translate(-.5,
      // yOffPostScale, zOffPostScale); applied to vertices last step first.
      const rendererTransform: Modifier = [
        ...Modifiers.translate([-0.5, yOffPostScale, zOffPostScale]),
        ...Modifiers.scale([0, 0, 0], SCALE),
        ...Modifiers.translate([0.5, yOffPreScale, 0]),
        ...Modifiers.rotate("y", [0.5, 0, 0.5], -angle),
      ];

      return (quadDir, quadMap) => {
        // `BannerFlagBlockModel` renders both halves; `glowing` marks the top.
        for (const top of [true, false]) {
          if ((top && quadDir === "down") || (!top && quadDir === "up")) {
            continue;
          }
          const modifier = QuadModifier.of(quadDir).apply(
            Modifiers.offset("down", top ? 1 : 2),
          );
          if (quadDir === flagDir) {
            modifier.apply(Modifiers.setPosition(1 / 16));
          } else if (quadDir !== opposite(flagDir)) {
            modifier.apply(Modifiers.cut(flagDir, 1 / 16));
          }
          modifier
            .apply(Modifiers.rotateCentered("y", toYRot(flagDir)))
            .apply(rendererTransform)
            .export(quadMap, null);
        }
      };
    },
  };
}

// ── Rails ──────────────────────────────────────────────────────────────────

/** `rail/FramedFancyRailGeometry.java`; `straight` for the powered/detector/activator rails. */
function fancyRail(straight: boolean): GeometrySpec {
  const SLEEPER_COUNT = 4;
  const SLEEPER_COUNT_CURVE = 3;
  const SLEEPER_BASE_OFFSET = 1 / 16;
  const SLEEPER_DIST = 4 / 16;
  const SLEEPER_DIST_CURVE = 6 / 16;
  const SLEEPER_WIDTH = 2 / 16;
  const SLEEPER_HEIGHT = 1 / 16;
  const SLEEPER_DIAGONAL_OFFSET = 1.85 / 16;
  const SLOPE_ORIGINS: Record<string, Vec3> = {
    north: [0, 0, 1],
    east: [0, 0, 0],
    south: [0, 0, 0],
    west: [1, 0, 0],
  };

  /** `getDirectionFromRailShape`, `getSecondaryDirectionFromRailShape`. */
  const RAIL_DIRECTIONS: Record<string, [Direction, Direction | null]> = {
    north_south: ["north", null],
    east_west: ["east", null],
    ascending_north: ["north", null],
    ascending_east: ["east", null],
    ascending_south: ["south", null],
    ascending_west: ["west", null],
    north_east: ["north", "east"],
    north_west: ["north", "west"],
    south_east: ["south", "east"],
    south_west: ["south", "west"],
  };

  type SleeperConsumer = (i: number, distDir: number, distOpp: number) => void;
  const forAllSleepers = (consumer: SleeperConsumer) => {
    for (let i = 0; i < SLEEPER_COUNT; i++) {
      const distDir = SLEEPER_BASE_OFFSET + i * SLEEPER_DIST + SLEEPER_WIDTH;
      consumer(i, distDir, 1 - distDir + SLEEPER_WIDTH);
    }
  };
  const forAllSleepersCurve = (consumer: SleeperConsumer) => {
    for (let i = 0; i < SLEEPER_COUNT_CURVE; i++) {
      const distDir =
        SLEEPER_BASE_OFFSET + i * SLEEPER_DIST_CURVE + SLEEPER_WIDTH;
      consumer(i, distDir, 1 - distDir + SLEEPER_WIDTH);
    }
  };

  const makeStraightRailSleepers = (
    quadMap: QuadPiece[],
    quadDir: Direction,
    railDir: Direction,
    lastMod: Modifier,
    cullFaceMod: (cullFace: Direction | null) => Direction | null,
  ) => {
    if (isY(quadDir)) {
      const targetDir = cullFaceMod(quadDir === "up" ? null : quadDir);
      forAllSleepers((_, distDir, distOpp) =>
        QuadModifier.of(quadDir)
          .apply(Modifiers.cut(railDir, distDir))
          .apply(Modifiers.cut(opposite(railDir), distOpp))
          .applyIf(Modifiers.setPosition(SLEEPER_HEIGHT), quadDir === "up")
          .apply(lastMod)
          .export(quadMap, targetDir),
      );
    } else if (axisOf(quadDir) === axisOf(railDir)) {
      forAllSleepers((_, distDir) =>
        QuadModifier.of(quadDir)
          .apply(Modifiers.cut("up", SLEEPER_HEIGHT))
          .apply(Modifiers.setPosition(distDir))
          .apply(lastMod)
          .export(quadMap, null),
      );
    } else {
      const targetDir = cullFaceMod(quadDir);
      forAllSleepers((_, distDir, distOpp) =>
        QuadModifier.of(quadDir)
          .apply(Modifiers.cut("up", SLEEPER_HEIGHT))
          .apply(Modifiers.cut(railDir, distDir))
          .apply(Modifiers.cut(opposite(railDir), distOpp))
          .apply(lastMod)
          .export(quadMap, targetDir),
      );
    }
  };

  const makeAscendingRailSleepers = (
    quadMap: QuadPiece[],
    quadDir: Direction,
    railDir: Direction,
  ) => {
    const axis = axisOf(clockWise(railDir));
    const angle = isPositive(railDir) === isX(railDir) ? 45 : -45;
    const scaleVec: Vec3 = isX(railDir) ? [1, 0, 0] : [0, 0, 1];
    makeStraightRailSleepers(
      quadMap,
      quadDir,
      railDir,
      Modifiers.rotate(axis, SLOPE_ORIGINS[railDir], angle, true, scaleVec),
      (cullFace) => (cullFace === "down" ? null : cullFace),
    );
  };

  const rotateCurveSleeper = (
    railDir: Direction,
    secDir: Direction,
    i: number,
  ): Modifier => {
    let angle = 45 * (SLEEPER_COUNT_CURVE - 1 - i);
    if (secDir === counterClockWise(railDir)) angle *= -1;
    return Modifiers.rotateCentered("y", angle);
  };

  const makeCurvedRailSleepers = (
    quadMap: QuadPiece[],
    quadDir: Direction,
    railDir: Direction,
    secDir: Direction,
  ) => {
    const curveMods = (mod: QuadModifier, i: number) =>
      mod
        .applyIf(rotateCurveSleeper(railDir, secDir, i), i < 2)
        .applyIf(Modifiers.offset(railDir, SLEEPER_DIAGONAL_OFFSET), i === 1)
        .applyIf(Modifiers.offset(secDir, SLEEPER_DIAGONAL_OFFSET), i === 1);

    if (isY(quadDir)) {
      const targetDir = quadDir === "up" ? null : quadDir;
      forAllSleepersCurve((i, distDir, distOpp) => {
        const nonDiagUp = quadDir === "up" && i !== 1;
        const height = nonDiagUp ? SLEEPER_HEIGHT - 0.001 : SLEEPER_HEIGHT;
        const mod = QuadModifier.of(quadDir)
          .apply(Modifiers.cut(railDir, distDir))
          .apply(Modifiers.cut(opposite(railDir), distOpp))
          .applyIf(Modifiers.setPosition(height), quadDir === "up");
        curveMods(mod, i).export(quadMap, targetDir);
      });
    } else if (axisOf(quadDir) === axisOf(railDir)) {
      const inDir = quadDir === railDir;
      forAllSleepersCurve((i, distDir, distOpp) => {
        const mod = QuadModifier.of(quadDir)
          .apply(Modifiers.cut("up", SLEEPER_HEIGHT))
          .apply(Modifiers.setPosition(inDir ? distDir : distOpp));
        curveMods(mod, i).export(quadMap, null);
      });
    } else {
      forAllSleepersCurve((i, distDir, distOpp) => {
        const mod = QuadModifier.of(quadDir)
          .apply(Modifiers.cut("up", SLEEPER_HEIGHT))
          .apply(Modifiers.cut(railDir, distDir))
          .apply(Modifiers.cut(opposite(railDir), distOpp));
        curveMods(mod, i).export(quadMap, quadDir);
      });
    }
  };

  return {
    properties: { shape: straight ? RAIL_SHAPE_STRAIGHT : RAIL_SHAPE },
    geometry: (s) => {
      const shape = s.shape;
      const [railDir, secDir] = RAIL_DIRECTIONS[shape];
      return (quadDir, quadMap) => {
        if (shape.startsWith("ascending")) {
          makeAscendingRailSleepers(quadMap, quadDir, railDir);
        } else if (shape === "north_south" || shape === "east_west") {
          makeStraightRailSleepers(quadMap, quadDir, railDir, [], (c) => c);
        } else {
          makeCurvedRailSleepers(quadMap, quadDir, railDir, secDir!);
        }
      };
    },
  };
}

// ── Bespoke blocks, keyed by block id without namespace ────────────────────

export const GEOMETRY_SPECS: Readonly<Record<string, GeometrySpec>> = {
  framed_cube: cube(),
  framed_secret_storage: cube(),
  framed_tank: cube(),
  // `FramedMarkedCubeGeometry`: a cube plus a non-camo frame overlay.
  framed_bouncy_cube: cube(),
  framed_redstone_block: cube(),
  // `FramedTargetGeometry`: a cube plus a non-camo target overlay.
  framed_target: cube(),
  framed_one_way_window: oneWayWindow(),
  framed_collapsible_block: collapsibleBlock(),
  framed_collapsible_copycat_block: collapsibleCopycatBlock(),
  framed_mini_cube: miniCube(),
  framed_chest: chest(),
  framed_wall: wall(),
  framed_chain: chain(),
  framed_lightning_rod: lightningRod(),
  framed_pane: pane(),
  framed_bars: bars(),
  framed_board: board(),
  framed_torch: torch(false),
  framed_soul_torch: torch(false),
  framed_copper_torch: torch(false),
  framed_redstone_torch: torch(true),
  framed_wall_torch: wallTorch(false),
  framed_soul_wall_torch: wallTorch(false),
  framed_copper_wall_torch: wallTorch(false),
  framed_redstone_wall_torch: wallTorch(true),
  framed_lantern: lantern(false),
  framed_soul_lantern: lantern(true),
  framed_copper_lantern: lantern(true),
  framed_sign: sign(),
  framed_hanging_sign: ceilingHangingSign(),
  framed_wall_hanging_sign: wallHangingSign(),
  framed_lever: lever(),
  framed_flower_pot: flowerPot(),
  framed_item_frame: itemFrame(),
  framed_glowing_item_frame: itemFrame(),
  framed_banner: bannerFlag(false),
  framed_wall_banner: bannerFlag(true),
  framed_fancy_rail: fancyRail(false),
  framed_fancy_powered_rail: fancyRail(true),
  framed_fancy_detector_rail: fancyRail(true),
  framed_fancy_activator_rail: fancyRail(true),
  ...SLOPE_GEOMETRY_SPECS,
  ...SLOPE_EDGE_GEOMETRY_SPECS,
  ...PRISM_GEOMETRY_SPECS,
};
