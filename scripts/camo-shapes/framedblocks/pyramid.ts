// Hand ports of FramedBlocks' pyramid geometries in
// `client/model/geometry/slope/` (`FramedPyramidGeometry` and its pyramid
// slab, elevated pyramid slab and upper pyramid slab variants, with the
// pillar/post stub they grow when connected), and the `calculateParts()` of
// the stacked pyramid slab. Read by `scripts/generate-camo-shapes.mts`
// through `GEOMETRY_SPECS` and `DOUBLE_BLOCK_SPECS`.
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class.

import type { Direction, Vec3 } from "../../../src/lib/render/camo/shape-pack";
import {
  BOOL,
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
  type QuadPiece,
} from "./geometry-api.ts";
import { SLOPE_ANGLE, SLOPE_ANGLE_VERT } from "./slope-slab.ts";
import type { DoubleBlockSpec, PartState } from "./template-specs.ts";

/** `FramedSlopePanelGeometry.SLOPE_ANGLE` (the same value). */
const PANEL_SLOPE_ANGLE = SLOPE_ANGLE_VERT;

/** `BlockStateProperties.FACING`; pyramids default to `up`. */
const PYRAMID_FACING = [
  "up",
  "down",
  "north",
  "south",
  "west",
  "east",
] as const;
/** `PillarConnection`. */
const PILLAR_CONNECTION = ["none", "post", "pillar"] as const;

/** `Direction.Plane.HORIZONTAL` order. */
const PLANE_HORIZONTAL: readonly Direction[] = [
  "north",
  "east",
  "south",
  "west",
];

const BOTTOM_CENTER: Vec3 = [0.5, 0, 0.5];
const TOP_CENTER: Vec3 = [0.5, 1, 0.5];

/** `dir.step().max(ZERO)`. */
function positiveStep(dir: Direction): Vec3 {
  return [
    dir === "east" ? 1 : 0,
    dir === "up" ? 1 : 0,
    dir === "south" ? 1 : 0,
  ];
}

/** `facing.getOpposite().step().max(ZERO)`, plus one up for up quads. */
function slopeOrigin(facing: Direction, up: boolean): Vec3 {
  const [x, y, z] = positiveStep(opposite(facing));
  return [x, up ? y + 1 : y, z];
}

/** `FullFacePredicate.DIR_OPPOSITE`. */
const dirOpposite = (s: BlockState): Direction[] => [
  opposite(s.facing as Direction),
];

// ── `FramedPyramidGeometry` and subclasses ─────────────────────────────────

/** The fields `FramedPyramidGeometry`'s constructor computes. */
interface PyramidContext {
  facing: Direction;
  altSlope: boolean;
  hasPillar: boolean;
  slopeHeight: number;
}

type BuildBody = (
  ctx: PyramidContext,
  quadMap: QuadPiece[],
  quadDir: Direction,
) => void;

type Heights = Readonly<Record<string, number>>;

/**
 * `FramedPyramidGeometry`: `buildBody()`, then `buildPillar()` when the
 * pyramid connects to a pillar. Subclasses override `buildBody()` and the
 * slope and pillar heights.
 */
function pyramidGeometry(
  buildBody: BuildBody,
  slopeHeights: Heights,
  pillarHeights: Heights,
): GeometrySpec["geometry"] {
  return (s) => {
    const facing = s.facing as Direction;
    const altSlope = isTrue(s.alt_slope);
    const pillar = s.pillar ?? "none";
    const hasPillar = pillar !== "none";
    const slopeHeight = slopeHeights[pillar];
    const pillarHeight = pillarHeights[pillar];
    const pillarWidth = { none: 0, post: 10 / 16, pillar: 12 / 16 }[pillar]!;
    const pillarFaceRadius = { none: 0, post: 2 / 16, pillar: 4 / 16 }[pillar]!;
    const pillarFaceMin = 0.5 - pillarFaceRadius;
    const pillarFaceMax = 0.5 + pillarFaceRadius;
    const ctx: PyramidContext = { facing, altSlope, hasPillar, slopeHeight };

    function buildPillar(quadMap: QuadPiece[], quadDir: Direction) {
      if (isY(facing)) {
        if (quadDir === facing) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cutTopBottom(
                pillarFaceMin,
                pillarFaceMin,
                pillarFaceMax,
                pillarFaceMax,
              ),
            )
            .export(quadMap, quadDir);
        } else if (quadDir !== opposite(facing)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(facing), pillarHeight))
            .apply(Modifiers.cutAxis(axisOf(clockWise(quadDir)), pillarWidth))
            .apply(Modifiers.setPosition(pillarWidth))
            .export(quadMap, null);
        }
      } else {
        if (isY(quadDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(facing), pillarHeight))
            .apply(Modifiers.cutAxis(axisOf(clockWise(facing)), pillarWidth))
            .apply(Modifiers.setPosition(pillarWidth))
            .export(quadMap, null);
        } else if (quadDir === facing) {
          QuadModifier.of(quadDir)
            .apply(
              Modifiers.cutSide(
                pillarFaceMin,
                pillarFaceMin,
                pillarFaceMax,
                pillarFaceMax,
              ),
            )
            .export(quadMap, quadDir);
        } else if (quadDir !== opposite(facing)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(facing), pillarHeight))
            .apply(Modifiers.cutAxis("y", pillarWidth))
            .apply(Modifiers.setPosition(pillarWidth))
            .export(quadMap, null);
        }
      }
    }

    return (quadDir, quadMap) => {
      buildBody(ctx, quadMap, quadDir);
      if (hasPillar) {
        buildPillar(quadMap, quadDir);
      }
    };
  };
}

/** `FramedPyramidGeometry.buildBody()`. */
const pyramidBody: BuildBody = (ctx, quadMap, quadDir) => {
  const { facing, altSlope, hasPillar, slopeHeight } = ctx;
  if (isY(facing)) {
    const up = facing === "up";
    if (!altSlope && axisOf(quadDir) !== axisOf(facing)) {
      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut(facing, slopeHeight), hasPillar)
        .apply(
          Modifiers.cut(counterClockWise(quadDir), up ? 0.5 : 1, up ? 1 : 0.5),
        )
        .apply(Modifiers.cut(clockWise(quadDir), up ? 0.5 : 1, up ? 1 : 0.5))
        .apply(Modifiers.makeVerticalSlope(up, PANEL_SLOPE_ANGLE))
        .export(quadMap, null);
    } else if (altSlope && quadDir === facing) {
      for (const dir of PLANE_HORIZONTAL) {
        let angle = up ? -PANEL_SLOPE_ANGLE : PANEL_SLOPE_ANGLE;
        angle = (up ? -90 : 90) - angle;
        if (dir === "north" || dir === "east") {
          angle *= -1;
        }

        const origin = up ? TOP_CENTER : BOTTOM_CENTER;

        QuadModifier.of(quadDir)
          .applyIf(Modifiers.cut(dir, slopeHeight), hasPillar)
          .apply(Modifiers.cut(counterClockWise(dir), 0.5, 1))
          .apply(Modifiers.cut(clockWise(dir), 1, 0.5))
          .apply(Modifiers.offset(opposite(dir), 0.5))
          .apply(Modifiers.rotate(axisOf(clockWise(dir)), origin, angle, true))
          .export(quadMap, null);
      }
    }
  } else {
    if (!altSlope && axisOf(quadDir) === axisOf(facing)) {
      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut("down", slopeHeight), hasPillar)
        .apply(Modifiers.cut(clockWise(facing), 1, 0.5))
        .apply(Modifiers.cut(counterClockWise(facing), 1, 0.5))
        .apply(Modifiers.makeVerticalSlope(true, SLOPE_ANGLE))
        .apply(Modifiers.offset("up", 0.5))
        .export(quadMap, null);

      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut("up", slopeHeight), hasPillar)
        .apply(Modifiers.cut(clockWise(facing), 0.5, 1))
        .apply(Modifiers.cut(counterClockWise(facing), 0.5, 1))
        .apply(Modifiers.makeVerticalSlope(false, SLOPE_ANGLE))
        .apply(Modifiers.offset("down", 0.5))
        .export(quadMap, null);
    } else if (altSlope && isY(quadDir)) {
      const up = quadDir === "up";

      let angle = up ? PANEL_SLOPE_ANGLE : -PANEL_SLOPE_ANGLE;
      if (facing === "north" || facing === "east") {
        angle *= -1;
      }

      const origin = slopeOrigin(facing, up);

      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut(facing, slopeHeight), hasPillar)
        .apply(Modifiers.cut(counterClockWise(facing), 0.5, 1))
        .apply(Modifiers.cut(clockWise(facing), 1, 0.5))
        .apply(Modifiers.rotate(axisOf(clockWise(facing)), origin, angle, true))
        .export(quadMap, null);
    } else if (axisOf(quadDir) === axisOf(clockWise(facing))) {
      const right = quadDir === clockWise(facing);
      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut(facing, slopeHeight), hasPillar)
        .apply(Modifiers.cut("down", right ? 1 : 0.5, right ? 0.5 : 1))
        .apply(Modifiers.cut("up", right ? 1 : 0.5, right ? 0.5 : 1))
        .apply(Modifiers.makeHorizontalSlope(!right, PANEL_SLOPE_ANGLE))
        .export(quadMap, null);
    }
  }
};

/**
 * The half-height pyramid body shared by
 * `FramedElevatedPyramidSlabGeometry.buildBody()` and
 * `FramedUpperPyramidSlabGeometry.buildBody()` (identical up to the part
 * each adds after it).
 */
const upperHalfPyramidBody: BuildBody = (ctx, quadMap, quadDir) => {
  const { facing, altSlope, hasPillar, slopeHeight } = ctx;
  if (isY(facing)) {
    const up = facing === "up";
    if (!altSlope && axisOf(quadDir) !== axisOf(facing)) {
      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut(facing, slopeHeight), hasPillar)
        .apply(Modifiers.cut(opposite(facing), 0.5))
        .apply(
          Modifiers.cut(
            counterClockWise(quadDir),
            up ? 0.5 : 1.5,
            up ? 1.5 : 0.5,
          ),
        )
        .apply(
          Modifiers.cut(clockWise(quadDir), up ? 0.5 : 1.5, up ? 1.5 : 0.5),
        )
        .apply(Modifiers.makeVerticalSlope(up, 45))
        .apply(Modifiers.offset(quadDir, 0.5))
        .export(quadMap, null);
    } else if (altSlope && quadDir === facing) {
      for (const dir of PLANE_HORIZONTAL) {
        const northeast = dir === "north" || dir === "east";
        let angle = up ? -45 : 45;
        if (northeast) {
          angle *= -1;
        }
        QuadModifier.of(quadDir)
          .applyIf(Modifiers.cut(dir, slopeHeight), hasPillar)
          .apply(Modifiers.cut(opposite(dir), 0.5))
          .apply(Modifiers.cut(counterClockWise(dir), 0.5, 1.5))
          .apply(Modifiers.cut(clockWise(dir), 1.5, 0.5))
          .apply(Modifiers.rotateCentered(axisOf(clockWise(dir)), angle, true))
          .apply(Modifiers.offset(opposite(facing), 0.5))
          .export(quadMap, null);
      }
    }
  } else {
    if (!altSlope && axisOf(quadDir) === axisOf(facing)) {
      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut("down", slopeHeight), hasPillar)
        .apply(Modifiers.cut("up", 0.5))
        .apply(Modifiers.cut(clockWise(facing), 1.5, 0.5))
        .apply(Modifiers.cut(counterClockWise(facing), 1.5, 0.5))
        .apply(Modifiers.makeVerticalSlope(true, 45))
        .apply(Modifiers.offset("up", 0.5))
        .export(quadMap, null);

      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut("up", slopeHeight), hasPillar)
        .apply(Modifiers.cut("down", 0.5))
        .apply(Modifiers.cut(clockWise(facing), 0.5, 1.5))
        .apply(Modifiers.cut(counterClockWise(facing), 0.5, 1.5))
        .apply(Modifiers.makeVerticalSlope(false, 45))
        .apply(Modifiers.offset("down", 0.5))
        .export(quadMap, null);
    } else if (altSlope && isY(quadDir)) {
      const up = quadDir === "up";

      let angle = up ? 45 : -45;
      if (facing === "north" || facing === "east") {
        angle *= -1;
      }

      const origin = slopeOrigin(facing, up);

      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut(facing, slopeHeight), hasPillar)
        .apply(Modifiers.cut(opposite(facing), 0.5))
        .apply(Modifiers.cut(counterClockWise(facing), 0.5, 1.5))
        .apply(Modifiers.cut(clockWise(facing), 1.5, 0.5))
        .apply(Modifiers.rotate(axisOf(clockWise(facing)), origin, angle, true))
        .apply(Modifiers.offset(quadDir, 0.5))
        .export(quadMap, null);
    } else if (axisOf(quadDir) === axisOf(clockWise(facing))) {
      const right = quadDir === clockWise(facing);
      QuadModifier.of(quadDir)
        .applyIf(Modifiers.cut(facing, slopeHeight), hasPillar)
        .apply(Modifiers.cut(opposite(facing), 0.5))
        .apply(Modifiers.cut("down", right ? 1.5 : 0.5, right ? 0.5 : 1.5))
        .apply(Modifiers.cut("up", right ? 1.5 : 0.5, right ? 0.5 : 1.5))
        .apply(Modifiers.makeHorizontalSlope(!right, 45))
        .apply(Modifiers.offset(quadDir, 0.5))
        .export(quadMap, null);
    }
  }
};

/** `FramedElevatedPyramidSlabGeometry.buildBody()`. */
const elevatedPyramidSlabBody: BuildBody = (ctx, quadMap, quadDir) => {
  const { facing } = ctx;
  upperHalfPyramidBody(ctx, quadMap, quadDir);
  if (isY(facing)) {
    if (axisOf(quadDir) !== axisOf(facing)) {
      QuadModifier.of(quadDir)
        .apply(Modifiers.cut(facing, 0.5))
        .export(quadMap, quadDir);
    }
  } else {
    if (isY(quadDir)) {
      QuadModifier.of(quadDir)
        .apply(Modifiers.cut(facing, 0.5))
        .export(quadMap, quadDir);
    } else if (axisOf(quadDir) !== axisOf(facing)) {
      QuadModifier.of(quadDir)
        .apply(Modifiers.cut(facing, 0.5))
        .export(quadMap, quadDir);
    }
  }
};

/** `FramedUpperPyramidSlabGeometry.buildBody()`. */
const upperPyramidSlabBody: BuildBody = (ctx, quadMap, quadDir) => {
  upperHalfPyramidBody(ctx, quadMap, quadDir);
  if (quadDir === opposite(ctx.facing)) {
    QuadModifier.of(quadDir)
      .apply(Modifiers.setPosition(0.5))
      .export(quadMap, null);
  }
};

/** `computeSlopeHeight()` / `computePillarHeight()` of `FramedPyramidGeometry`. */
const PYRAMID_SLOPE_HEIGHT = { none: 1, post: 12 / 16, pillar: 8 / 16 };
const PYRAMID_PILLAR_HEIGHT = { none: 0, post: 4 / 16, pillar: 8 / 16 };
/** The overrides in the elevated and upper pyramid slab geometries. */
const SLAB_SLOPE_HEIGHT = { none: 1, post: 14 / 16, pillar: 12 / 16 };
const SLAB_PILLAR_HEIGHT = { none: 0, post: 2 / 16, pillar: 4 / 16 };

const CONNECTING_PYRAMID_PROPERTIES = {
  facing: PYRAMID_FACING,
  pillar: PILLAR_CONNECTION,
  alt_slope: BOOL,
} as const;

/** `slope/FramedPyramidGeometry.java` */
function pyramid(): GeometrySpec {
  return {
    properties: CONNECTING_PYRAMID_PROPERTIES,
    geometry: pyramidGeometry(
      pyramidBody,
      PYRAMID_SLOPE_HEIGHT,
      PYRAMID_PILLAR_HEIGHT,
    ),
    fullFaces: dirOpposite,
  };
}

/** `slope/FramedElevatedPyramidSlabGeometry.java` */
function elevatedPyramidSlab(): GeometrySpec {
  return {
    properties: CONNECTING_PYRAMID_PROPERTIES,
    geometry: pyramidGeometry(
      elevatedPyramidSlabBody,
      SLAB_SLOPE_HEIGHT,
      SLAB_PILLAR_HEIGHT,
    ),
    fullFaces: dirOpposite,
  };
}

/** `slope/FramedUpperPyramidSlabGeometry.java` */
function upperPyramidSlab(): GeometrySpec {
  return {
    properties: CONNECTING_PYRAMID_PROPERTIES,
    geometry: pyramidGeometry(
      upperPyramidSlabBody,
      SLAB_SLOPE_HEIGHT,
      SLAB_PILLAR_HEIGHT,
    ),
    // `FullFacePredicate.FALSE`
  };
}

/** `slope/FramedPyramidSlabGeometry.java` */
function pyramidSlab(): GeometrySpec {
  return {
    properties: { facing: PYRAMID_FACING, alt_slope: BOOL },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (isY(facing)) {
          const up = facing === "up";
          if (!altSlope && axisOf(quadDir) !== axisOf(facing)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(facing, 0.5))
              .apply(
                Modifiers.cut(
                  counterClockWise(quadDir),
                  up ? 0 : 1,
                  up ? 1 : 0,
                ),
              )
              .apply(Modifiers.cut(clockWise(quadDir), up ? 0 : 1, up ? 1 : 0))
              .apply(Modifiers.makeVerticalSlope(up, 45))
              .export(quadMap, null);
          } else if (altSlope && quadDir === facing) {
            for (const dir of PLANE_HORIZONTAL) {
              const northeast = dir === "north" || dir === "east";
              let angle = up ? -45 : 45;
              if (northeast) {
                angle *= -1;
              }
              QuadModifier.of(quadDir)
                .apply(Modifiers.cut(dir, 0.5))
                .apply(Modifiers.cut(counterClockWise(dir), 0, 1))
                .apply(Modifiers.cut(clockWise(dir), 1, 0))
                .apply(Modifiers.setPosition(0.5))
                .apply(
                  Modifiers.rotateCentered(axisOf(clockWise(dir)), angle, true),
                )
                .export(quadMap, null);
            }
          }
        } else {
          if (!altSlope && axisOf(quadDir) === axisOf(facing)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut("down", 0.5))
              .apply(Modifiers.cut(clockWise(facing), 1, 0))
              .apply(Modifiers.cut(counterClockWise(facing), 1, 0))
              .apply(Modifiers.makeVerticalSlope(true, 45))
              .export(quadMap, null);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut("up", 0.5))
              .apply(Modifiers.cut(clockWise(facing), 0, 1))
              .apply(Modifiers.cut(counterClockWise(facing), 0, 1))
              .apply(Modifiers.makeVerticalSlope(false, 45))
              .export(quadMap, null);
          } else if (altSlope && isY(quadDir)) {
            const up = quadDir === "up";

            let angle = up ? 45 : -45;
            if (facing === "north" || facing === "east") {
              angle *= -1;
            }

            const origin = slopeOrigin(facing, up);

            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(facing, 0.5))
              .apply(Modifiers.cut(counterClockWise(facing), 0, 1))
              .apply(Modifiers.cut(clockWise(facing), 1, 0))
              .apply(
                Modifiers.rotate(
                  axisOf(clockWise(facing)),
                  origin,
                  angle,
                  true,
                ),
              )
              .export(quadMap, null);
          } else if (axisOf(quadDir) === axisOf(clockWise(facing))) {
            const right = quadDir === clockWise(facing);
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(facing, 0.5))
              .apply(Modifiers.cut("down", right ? 1 : 0, right ? 0 : 1))
              .apply(Modifiers.cut("up", right ? 1 : 0, right ? 0 : 1))
              .apply(Modifiers.makeHorizontalSlope(!right, 45))
              .export(quadMap, null);
          }
        }
      };
    },
    fullFaces: dirOpposite,
  };
}

/** Pyramid geometries, keyed by block id without namespace. */
export const PYRAMID_GEOMETRY_SPECS: Readonly<Record<string, GeometrySpec>> = {
  framed_pyramid: pyramid(),
  framed_pyramid_slab: pyramidSlab(),
  framed_elevated_pyramid_slab: elevatedPyramidSlab(),
  framed_upper_pyramid_slab: upperPyramidSlab(),
};

// ── Double blocks (ports of `calculateParts()`) ────────────────────────────

const part = (block: string, props: BlockState = {}): PartState => ({
  block,
  props,
});

export const PYRAMID_DOUBLE_BLOCK_SPECS: Readonly<
  Record<string, DoubleBlockSpec>
> = {
  // `FramedStackedPyramidSlabBlock`
  framed_stacked_pyramid_slab: {
    properties: CONNECTING_PYRAMID_PROPERTIES,
    parts: (s) => {
      const facing = s.facing as Direction;
      const stateOne = isY(facing)
        ? part("framed_slab", { top: String(facing === "down") })
        : part("framed_panel", { facing: opposite(facing) });
      return [
        stateOne,
        part("framed_upper_pyramid_slab", {
          facing,
          pillar: s.pillar,
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
};
