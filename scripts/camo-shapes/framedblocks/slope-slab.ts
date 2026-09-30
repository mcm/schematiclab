// Hand ports of FramedBlocks' `client/model/geometry/slopeslab/*Geometry.java`
// (slope slabs, elevated and compound slope slabs and the flat slope slab
// corners) with their `FullFacePredicate`s, and the `calculateParts()` of
// the double and stacked slope slab blocks built from them. Read by
// `scripts/generate-camo-shapes.mts` through `GEOMETRY_SPECS` and
// `DOUBLE_BLOCK_SPECS`.
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class.

import type { Direction } from "../../../src/lib/render/camo/shape-pack";
import {
  BOOL,
  HORIZONTAL,
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
} from "./geometry-api.ts";
import type { DoubleBlockSpec, PartState } from "./template-specs.ts";

/** `FramedSlopeSlabGeometry.SLOPE_ANGLE`. */
export const SLOPE_ANGLE = 90 - (Math.atan(0.5) * 180) / Math.PI;
/** `FramedSlopeSlabGeometry.SLOPE_ANGLE_VERT`. */
export const SLOPE_ANGLE_VERT = (Math.atan(0.5) * 180) / Math.PI;

/** `alt_slope`: every slope slab block defaults it to `true`. */
const ALT_SLOPE_TRUE = ["true", "false"] as const;

// ── Full face predicates (`common/data/facepreds/slopeslab/`) ─────────────

/** `SlopeSlabFullFacePredicate`. */
function slopeSlabFullFaces(s: BlockState): Direction[] {
  const topHalf = isTrue(s.top_half);
  if (isTrue(s.top)) return topHalf ? ["up"] : [];
  return !topHalf ? ["down"] : [];
}

// ── Geometries ─────────────────────────────────────────────────────────────

/** `slopeslab/FramedSlopeSlabGeometry.java` */
function slopeSlab(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      top_half: BOOL,
      alt_slope: ALT_SLOPE_TRUE,
    },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const top = isTrue(s.top);
      const topHalf = isTrue(s.top_half);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        const offset = top !== topHalf;

        if (!altSlope && face === opposite(facing)) {
          QuadModifier.of(face)
            .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
            .applyIf(Modifiers.offset(top ? "down" : "up", 0.5), offset)
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && face === "up") || (top && face === "down"))
        ) {
          QuadModifier.of(face)
            .apply(
              Modifiers.makeVerticalSlope(opposite(facing), SLOPE_ANGLE_VERT),
            )
            .applyIf(Modifiers.offset(top ? "up" : "down", 0.5), !offset)
            .export(quadMap, null);
        } else if (face === facing) {
          QuadModifier.of(face)
            .apply(Modifiers.cut(topHalf ? "down" : "up", 0.5))
            .export(quadMap, face);
        } else if (
          face === clockWise(facing) ||
          face === counterClockWise(facing)
        ) {
          const rightFace = face === clockWise(facing);
          const right = rightFace ? (offset ? 0.5 : 0) : offset ? 1 : 0.5;
          const left = rightFace ? (offset ? 1 : 0.5) : offset ? 0.5 : 0;

          QuadModifier.of(face)
            .apply(Modifiers.cut(top ? "down" : "up", right, left))
            .applyIf(Modifiers.cut(top ? "up" : "down", 0.5), offset)
            .export(quadMap, face);
        } else if (
          (top && !topHalf && face === "up") ||
          (!top && topHalf && face === "down")
        ) {
          QuadModifier.of(face)
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: slopeSlabFullFaces,
  };
}

/** `slopeslab/FramedElevatedSlopeSlabGeometry.java` */
function elevatedSlopeSlab(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: ALT_SLOPE_TRUE },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        if (face === opposite(facing)) {
          if (!altSlope) {
            QuadModifier.of(face)
              .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
              .apply(Modifiers.offset(top ? "down" : "up", 0.5))
              .export(quadMap, null);
          }

          QuadModifier.of(face)
            .apply(Modifiers.cut(top ? "down" : "up", 0.5))
            .export(quadMap, face);
        } else if (
          altSlope &&
          ((!top && face === "up") || (top && face === "down"))
        ) {
          QuadModifier.of(face)
            .apply(
              Modifiers.makeVerticalSlope(opposite(facing), SLOPE_ANGLE_VERT),
            )
            .export(quadMap, null);
        } else if (
          face === clockWise(facing) ||
          face === counterClockWise(facing)
        ) {
          const rightFace = face === clockWise(facing);
          QuadModifier.of(face)
            .apply(
              Modifiers.cut(
                top ? "down" : "up",
                rightFace ? 0.5 : 1,
                rightFace ? 1 : 0.5,
              ),
            )
            .export(quadMap, face);
        }
      };
    },
    fullFaces: (s) => {
      // `ElevatedSlopeSlabFullFacePredicate`
      return [s.facing as Direction, isTrue(s.top) ? "up" : "down"];
    },
  };
}

/** `slopeslab/FramedCompoundSlopeSlabGeometry.java` */
function compoundSlopeSlab(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, alt_slope: ALT_SLOPE_TRUE },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === dir) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("down", 0.5))
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeVerticalSlope(false, SLOPE_ANGLE))
              .apply(Modifiers.offset("down", 0.5))
              .export(quadMap, null);
          }
        } else if (quadDir === opposite(dir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", 0.5))
            .export(quadMap, quadDir);

          if (!altSlope) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeVerticalSlope(true, SLOPE_ANGLE))
              .apply(Modifiers.offset("up", 0.5))
              .export(quadMap, null);
          }
        } else if (altSlope && isY(quadDir)) {
          const edge = quadDir === "up" ? opposite(dir) : dir;
          QuadModifier.of(quadDir)
            .apply(Modifiers.makeVerticalSlope(edge, SLOPE_ANGLE_VERT))
            .export(quadMap, null);
        } else if (axisOf(quadDir) === axisOf(clockWise(dir))) {
          const cw = quadDir === clockWise(dir);
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut("up", cw ? 0.5 : 1, cw ? 1 : 0.5))
            .apply(Modifiers.cut("down", cw ? 1 : 0.5, cw ? 0.5 : 1))
            .export(quadMap, quadDir);
        }
      };
    },
    // `FullFacePredicate.FALSE`
  };
}

/** `slopeslab/FramedFlatSlopeSlabCornerGeometry.java` */
function flatSlopeSlabCorner(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      top_half: BOOL,
      alt_slope: ALT_SLOPE_TRUE,
    },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const top = isTrue(s.top);
      const topHalf = isTrue(s.top_half);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        const offset = top !== topHalf;

        if (
          !altSlope &&
          (face === opposite(facing) || face === clockWise(facing))
        ) {
          const cutDir =
            face === clockWise(facing)
              ? clockWise(face)
              : counterClockWise(face);
          const lenTop = top ? 1 : 0;
          const lenBot = top ? 0 : 1;

          QuadModifier.of(face)
            .apply(Modifiers.cut(cutDir, lenTop, lenBot))
            .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
            .applyIf(Modifiers.offset(top ? "down" : "up", 0.5), offset)
            .export(quadMap, null);
        } else if (
          altSlope &&
          ((!top && face === "up") || (top && face === "down"))
        ) {
          QuadModifier.of(face)
            .apply(Modifiers.cut(clockWise(facing), 1, 0))
            .apply(
              Modifiers.makeVerticalSlope(opposite(facing), SLOPE_ANGLE_VERT),
            )
            .applyIf(Modifiers.offset(top ? "up" : "down", 0.5), !offset)
            .export(quadMap, null);

          QuadModifier.of(face)
            .apply(Modifiers.cut(opposite(facing), 0, 1))
            .apply(
              Modifiers.makeVerticalSlope(clockWise(facing), SLOPE_ANGLE_VERT),
            )
            .applyIf(Modifiers.offset(top ? "up" : "down", 0.5), !offset)
            .export(quadMap, null);
        } else if (face === facing || face === counterClockWise(facing)) {
          const rightFace = face === facing;
          const right = rightFace ? (offset ? 0.5 : 0) : offset ? 1 : 0.5;
          const left = rightFace ? (offset ? 1 : 0.5) : offset ? 0.5 : 0;

          QuadModifier.of(face)
            .apply(Modifiers.cut(top ? "down" : "up", right, left))
            .applyIf(Modifiers.cut(top ? "up" : "down", 0.5), offset)
            .export(quadMap, face);
        } else if (
          (top && !topHalf && face === "up") ||
          (!top && topHalf && face === "down")
        ) {
          QuadModifier.of(face)
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: slopeSlabFullFaces,
  };
}

/** `slopeslab/FramedFlatInnerSlopeSlabCornerGeometry.java` */
function flatInnerSlopeSlabCorner(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      top_half: BOOL,
      alt_slope: ALT_SLOPE_TRUE,
    },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const top = isTrue(s.top);
      const topHalf = isTrue(s.top_half);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        const offset = top !== topHalf;

        if (face === opposite(facing) || face === clockWise(facing)) {
          if (!altSlope) {
            const cutDir =
              face !== clockWise(facing)
                ? clockWise(face)
                : counterClockWise(face);
            const lenTop = top ? 0 : 1;
            const lenBot = top ? 1 : 0;

            QuadModifier.of(face)
              .apply(Modifiers.cut(cutDir, lenTop, lenBot))
              .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
              .applyIf(Modifiers.offset(top ? "down" : "up", 0.5), offset)
              .export(quadMap, null);
          }

          const rightFace = face === clockWise(facing);
          const lenRight = rightFace ? (offset ? 0.5 : 0) : offset ? 1 : 0.5;
          const lenLeft = rightFace ? (offset ? 1 : 0.5) : offset ? 0.5 : 0;

          QuadModifier.of(face)
            .apply(Modifiers.cut(top ? "down" : "up", lenRight, lenLeft))
            .applyIf(Modifiers.cut(top ? "up" : "down", 0.5), offset)
            .export(quadMap, face);
        } else if (
          altSlope &&
          ((!top && face === "up") || (top && face === "down"))
        ) {
          QuadModifier.of(face)
            .apply(Modifiers.cut(counterClockWise(facing), 1, 0))
            .apply(
              Modifiers.makeVerticalSlope(opposite(facing), SLOPE_ANGLE_VERT),
            )
            .applyIf(Modifiers.offset(top ? "up" : "down", 0.5), !offset)
            .export(quadMap, null);

          QuadModifier.of(face)
            .apply(Modifiers.cut(facing, 0, 1))
            .apply(
              Modifiers.makeVerticalSlope(clockWise(facing), SLOPE_ANGLE_VERT),
            )
            .applyIf(Modifiers.offset(top ? "up" : "down", 0.5), !offset)
            .export(quadMap, null);
        } else if (face === facing || face === counterClockWise(facing)) {
          QuadModifier.of(face)
            .apply(Modifiers.cut(topHalf ? "down" : "up", 0.5))
            .export(quadMap, face);
        } else if (
          (top && !topHalf && face === "up") ||
          (!top && topHalf && face === "down")
        ) {
          QuadModifier.of(face)
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }
      };
    },
    fullFaces: slopeSlabFullFaces,
  };
}

/** `slopeslab/FramedFlatElevatedSlopeSlabCornerGeometry.java` */
function flatElevatedSlopeSlabCorner(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: ALT_SLOPE_TRUE },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        if (face === opposite(facing) || face === clockWise(facing)) {
          if (!altSlope) {
            const cutDir =
              face === clockWise(facing)
                ? clockWise(face)
                : counterClockWise(face);
            const lenTop = top ? 1 : 0;
            const lenBot = top ? 0 : 1;

            QuadModifier.of(face)
              .apply(Modifiers.cut(cutDir, lenTop, lenBot))
              .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
              .apply(Modifiers.offset(top ? "down" : "up", 0.5))
              .export(quadMap, null);
          }

          QuadModifier.of(face)
            .apply(Modifiers.cut(top ? "down" : "up", 0.5))
            .export(quadMap, face);
        } else if (
          altSlope &&
          ((!top && face === "up") || (top && face === "down"))
        ) {
          QuadModifier.of(face)
            .apply(Modifiers.cut(clockWise(facing), 1, 0))
            .apply(
              Modifiers.makeVerticalSlope(opposite(facing), SLOPE_ANGLE_VERT),
            )
            .export(quadMap, null);

          QuadModifier.of(face)
            .apply(Modifiers.cut(opposite(facing), 0, 1))
            .apply(
              Modifiers.makeVerticalSlope(clockWise(facing), SLOPE_ANGLE_VERT),
            )
            .export(quadMap, null);
        } else if (face === facing || face === counterClockWise(facing)) {
          const rightFace = face === facing;
          const right = rightFace ? 0.5 : 1;
          const left = rightFace ? 1 : 0.5;

          QuadModifier.of(face)
            .apply(Modifiers.cut(top ? "down" : "up", right, left))
            .export(quadMap, face);
        }
      };
    },
    fullFaces: (s) => {
      // `FlatElevatedSlopeSlabCornerFullFacePredicate`
      return [isTrue(s.top) ? "up" : "down"];
    },
  };
}

/** `slopeslab/FramedFlatElevatedInnerSlopeSlabCornerGeometry.java` */
function flatElevatedInnerSlopeSlabCorner(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL, alt_slope: ALT_SLOPE_TRUE },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const top = isTrue(s.top);
      const altSlope = isTrue(s.alt_slope);
      return (face, quadMap) => {
        if (face === opposite(facing) || face === clockWise(facing)) {
          if (!altSlope) {
            const cutDir =
              face !== clockWise(facing)
                ? clockWise(face)
                : counterClockWise(face);
            const lenTop = top ? 0 : 1;
            const lenBot = top ? 1 : 0;

            QuadModifier.of(face)
              .apply(Modifiers.cut(cutDir, lenTop, lenBot))
              .apply(Modifiers.makeVerticalSlope(!top, SLOPE_ANGLE))
              .apply(Modifiers.offset(top ? "down" : "up", 0.5))
              .export(quadMap, null);
          }

          const rightFace = face === opposite(facing);
          const lenRight = rightFace ? 1 : 0.5;
          const lenLeft = rightFace ? 0.5 : 1;

          QuadModifier.of(face)
            .apply(Modifiers.cut(top ? "down" : "up", lenRight, lenLeft))
            .export(quadMap, face);
        } else if (
          altSlope &&
          ((!top && face === "up") || (top && face === "down"))
        ) {
          QuadModifier.of(face)
            .apply(Modifiers.cut(counterClockWise(facing), 1, 0))
            .apply(
              Modifiers.makeVerticalSlope(opposite(facing), SLOPE_ANGLE_VERT),
            )
            .export(quadMap, null);

          QuadModifier.of(face)
            .apply(Modifiers.cut(facing, 0, 1))
            .apply(
              Modifiers.makeVerticalSlope(clockWise(facing), SLOPE_ANGLE_VERT),
            )
            .export(quadMap, null);
        }
      };
    },
    fullFaces: (s) => {
      // `FlatElevatedInnerSlopeSlabCornerFullFacePredicate`
      const dir = s.facing as Direction;
      return [dir, counterClockWise(dir), isTrue(s.top) ? "up" : "down"];
    },
  };
}

/** Slope slab geometries, keyed by block id without namespace. */
export const SLOPE_SLAB_GEOMETRY_SPECS: Readonly<Record<string, GeometrySpec>> =
  {
    framed_slope_slab: slopeSlab(),
    framed_elevated_slope_slab: elevatedSlopeSlab(),
    framed_compound_slope_slab: compoundSlopeSlab(),
    framed_flat_slope_slab_corner: flatSlopeSlabCorner(),
    framed_flat_inner_slope_slab_corner: flatInnerSlopeSlabCorner(),
    framed_flat_elev_slope_slab_corner: flatElevatedSlopeSlabCorner(),
    framed_flat_elev_inner_slope_slab_corner:
      flatElevatedInnerSlopeSlabCorner(),
  };

// ── Double blocks (ports of `calculateParts()`) ────────────────────────────

const part = (block: string, props: BlockState = {}): PartState => ({
  block,
  props,
});

const bool = (value: boolean) => String(value);
const not = (value: string) => bool(!isTrue(value));

const TOP_PROPERTIES = {
  facing: HORIZONTAL,
  top: BOOL,
  alt_slope: ALT_SLOPE_TRUE,
} as const;

/** `FramedFlatElevatedDoubleSlopeSlabCornerBlock` (both block types). */
function flatElevatedDoubleSlopeSlabCorner(
  partOne: string,
  partTwo: string,
): DoubleBlockSpec {
  return {
    properties: TOP_PROPERTIES,
    parts: (s) => [
      part(partOne, { facing: s.facing, top: s.top, alt_slope: s.alt_slope }),
      part(partTwo, {
        facing: opposite(s.facing as Direction),
        top: not(s.top),
        top_half: not(s.top),
        alt_slope: s.alt_slope,
      }),
    ],
  };
}

/** `FramedFlatStackedSlopeSlabCornerBlock` (both block types). */
function flatStackedSlopeSlabCorner(topBlock: string): DoubleBlockSpec {
  return {
    properties: TOP_PROPERTIES,
    parts: (s) => [
      part("framed_slab", { top: s.top }),
      part(topBlock, {
        facing: s.facing,
        top: s.top,
        top_half: not(s.top),
        alt_slope: s.alt_slope,
      }),
    ],
  };
}

export const SLOPE_SLAB_DOUBLE_BLOCK_SPECS: Readonly<
  Record<string, DoubleBlockSpec>
> = {
  // `FramedDoubleSlopeSlabBlock`
  framed_double_slope_slab: {
    properties: {
      facing: HORIZONTAL,
      top_half: BOOL,
      alt_slope: ALT_SLOPE_TRUE,
    },
    parts: (s) => [
      part("framed_slope_slab", {
        facing: s.facing,
        top_half: s.top_half,
        top: "false",
        alt_slope: s.alt_slope,
      }),
      part("framed_slope_slab", {
        facing: opposite(s.facing as Direction),
        top_half: s.top_half,
        top: "true",
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedInverseDoubleSlopeSlabBlock`
  framed_inv_double_slope_slab: {
    properties: { facing: HORIZONTAL, alt_slope: ALT_SLOPE_TRUE },
    parts: (s) => [
      part("framed_slope_slab", {
        facing: opposite(s.facing as Direction),
        top_half: "false",
        top: "true",
        alt_slope: s.alt_slope,
      }),
      part("framed_slope_slab", {
        facing: s.facing,
        top_half: "true",
        top: "false",
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedElevatedDoubleSlopeSlabBlock`
  framed_elevated_double_slope_slab: {
    properties: TOP_PROPERTIES,
    parts: (s) => [
      part("framed_elevated_slope_slab", {
        facing: s.facing,
        top: s.top,
        alt_slope: s.alt_slope,
      }),
      part("framed_slope_slab", {
        facing: opposite(s.facing as Direction),
        top_half: not(s.top),
        top: not(s.top),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedStackedSlopeSlabBlock`
  framed_stacked_slope_slab: {
    properties: TOP_PROPERTIES,
    parts: (s) => [
      part("framed_slab", { top: s.top }),
      part("framed_slope_slab", {
        facing: s.facing,
        top: s.top,
        top_half: not(s.top),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedFlatDoubleSlopeSlabCornerBlock`
  framed_flat_double_slope_slab_corner: {
    properties: {
      facing: HORIZONTAL,
      top: BOOL,
      top_half: BOOL,
      alt_slope: ALT_SLOPE_TRUE,
    },
    parts: (s) => [
      part("framed_flat_inner_slope_slab_corner", {
        facing: s.facing,
        top_half: s.top_half,
        top: s.top,
        alt_slope: s.alt_slope,
      }),
      part("framed_flat_slope_slab_corner", {
        facing: opposite(s.facing as Direction),
        top_half: s.top_half,
        top: not(s.top),
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedFlatInverseDoubleSlopeSlabCornerBlock`
  framed_flat_inv_double_slope_slab_corner: {
    properties: TOP_PROPERTIES,
    parts: (s) => [
      part("framed_flat_inner_slope_slab_corner", {
        facing: opposite(s.facing as Direction),
        top_half: s.top,
        top: not(s.top),
        alt_slope: s.alt_slope,
      }),
      part("framed_flat_slope_slab_corner", {
        facing: s.facing,
        top_half: not(s.top),
        top: s.top,
        alt_slope: s.alt_slope,
      }),
    ],
  },
  // `FramedFlatElevatedDoubleSlopeSlabCornerBlock`
  framed_flat_elev_double_slope_slab_corner: flatElevatedDoubleSlopeSlabCorner(
    "framed_flat_elev_slope_slab_corner",
    "framed_flat_inner_slope_slab_corner",
  ),
  // `FramedFlatElevatedDoubleSlopeSlabCornerBlock`
  framed_flat_elev_inner_double_slope_slab_corner:
    flatElevatedDoubleSlopeSlabCorner(
      "framed_flat_elev_inner_slope_slab_corner",
      "framed_flat_slope_slab_corner",
    ),
  // `FramedFlatStackedSlopeSlabCornerBlock`
  framed_flat_stacked_slope_slab_corner: flatStackedSlopeSlabCorner(
    "framed_flat_slope_slab_corner",
  ),
  // `FramedFlatStackedSlopeSlabCornerBlock`
  framed_flat_stacked_inner_slope_slab_corner: flatStackedSlopeSlabCorner(
    "framed_flat_inner_slope_slab_corner",
  ),
};
