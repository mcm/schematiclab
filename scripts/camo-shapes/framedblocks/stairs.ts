// Hand ports of FramedBlocks' `client/model/geometry/stairs/*Geometry.java`
// (sloped stairs and vertical sloped stairs) and their `FullFacePredicate`s,
// plus the `calculateParts()` of the double and sliced blocks built on them.
// Read by `scripts/generate-camo-shapes.mts` through `GEOMETRY_SPECS` and
// `DOUBLE_BLOCK_SPECS`.
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
  clockWise,
  counterClockWise,
  dir,
  isTrue,
  isY,
  opposite,
  type BlockState,
  type GeometrySpec,
} from "./geometry-api.ts";
import type { DoubleBlockSpec, PartState } from "./template-specs.ts";

// ── Geometries ─────────────────────────────────────────────────────────────

/** `stairs/FramedSlopedStairsGeometry.java` */
function slopedStairs(): GeometrySpec {
  return {
    properties: { facing: HORIZONTAL, top: BOOL },
    geometry: (s) => {
      const dir = s.facing as Direction;
      const top = isTrue(s.top);
      return (quadDir, quadMap) => {
        if (isY(quadDir)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(dir), 1, 0))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(dir, 1, 0))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        } else {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(top ? "down" : "up", 0.5))
            .export(quadMap, quadDir);

          if (quadDir === opposite(dir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.makeHorizontalSlope(false, 45))
              .apply(Modifiers.cut(top ? "up" : "down", 0.5))
              .export(quadMap, null);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `SlopedStairsFullFacePredicate`
      const dir = s.facing as Direction;
      return [dir, counterClockWise(dir), isTrue(s.top) ? "up" : "down"];
    },
  };
}

/** `stairs/FramedVerticalSlopedStairsGeometry.java` */
function verticalSlopedStairs(): GeometrySpec {
  return {
    properties: {
      facing: HORIZONTAL,
      rotation: HORIZONTAL_ROTATION,
      alt_slope: BOOL,
    },
    geometry: (s) => {
      const facing = s.facing as Direction;
      const rot = s.rotation;
      const rotDir = HorizontalRotation.withFacing(rot, facing);
      const rotDirTwo = HorizontalRotation.withFacing(
        HorizontalRotation.rotate(rot, false),
        facing,
      );
      const altSlope = isTrue(s.alt_slope);
      return (quadDir, quadMap) => {
        if (quadDir === rotDir || quadDir === rotDirTwo) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cut(opposite(facing), 0.5))
            .export(quadMap, quadDir);
        } else if (quadDir === opposite(facing)) {
          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSide(rotDir, 1, 0))
            .export(quadMap, quadDir);

          QuadModifier.of(quadDir)
            .apply(Modifiers.cutSide(opposite(rotDir), 1, 0))
            .apply(Modifiers.setPosition(0.5))
            .export(quadMap, null);
        }

        const useRotDirQuad = isY(rotDir) === altSlope;
        const slopeQuadDir = useRotDirQuad ? rotDir : rotDirTwo;
        const slopeRotDir = useRotDirQuad ? rotDirTwo : rotDir;

        if (quadDir === slopeQuadDir) {
          if (isY(slopeQuadDir)) {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(facing, 0.5))
              .apply(Modifiers.makeVerticalSlope(slopeRotDir, 45))
              .export(quadMap, null);
          } else {
            QuadModifier.of(quadDir)
              .apply(Modifiers.cut(facing, 0.5))
              .apply(Modifiers.makeVerticalSlope(slopeRotDir === "up", 45))
              .export(quadMap, null);
          }
        }
      };
    },
    fullFaces: (s) => {
      // `VerticalSlopedStairsFullFacePredicate`
      const facing = s.facing as Direction;
      const rot = s.rotation;
      return [
        facing,
        HorizontalRotation.withFacing(
          HorizontalRotation.getOpposite(rot),
          facing,
        ),
        HorizontalRotation.withFacing(
          HorizontalRotation.rotate(rot, true),
          facing,
        ),
      ];
    },
  };
}

export const SLOPED_STAIRS_GEOMETRY_SPECS: Readonly<
  Record<string, GeometrySpec>
> = {
  framed_sloped_stairs: slopedStairs(),
  framed_vertical_sloped_stairs: verticalSlopedStairs(),
};

// ── Double blocks (ports of `calculateParts()`) ────────────────────────────

const part = (block: string, props: BlockState = {}): PartState => ({
  block,
  props,
});

const bool = (value: boolean) => String(value);

const VERTICAL_PROPERTIES = {
  facing: HORIZONTAL,
  rotation: HORIZONTAL_ROTATION,
  alt_slope: BOOL,
} as const;

export const SLOPED_STAIRS_DOUBLE_BLOCK_SPECS: Readonly<
  Record<string, DoubleBlockSpec>
> = {
  // `FramedSlopedDoubleStairsBlock`
  framed_sloped_double_stairs: {
    properties: { facing: HORIZONTAL, top: BOOL },
    parts: (s) => [
      part("framed_sloped_stairs", { facing: s.facing, top: s.top }),
      part("framed_vertical_half_slope", {
        facing: opposite(dir(s.facing)),
        top: bool(!isTrue(s.top)),
      }),
    ],
  },
  // `FramedSlicedSlopedStairsSlabBlock`
  framed_sliced_sloped_stairs_slab: {
    properties: { facing: HORIZONTAL, top: BOOL },
    parts: (s) => [
      part("framed_slab", { top: s.top }),
      part("framed_vertical_half_slope", {
        facing: s.facing,
        top: bool(!isTrue(s.top)),
      }),
    ],
  },
  // `FramedSlicedSlopedStairsSlopeBlock`
  framed_sliced_sloped_stairs_slope: {
    properties: { facing: HORIZONTAL, top: BOOL },
    parts: (s) => [
      part("framed_slope", { facing: s.facing, type: "horizontal" }),
      part("framed_vertical_half_slope", {
        facing: opposite(dir(s.facing)),
        top: s.top,
      }),
    ],
  },
  // `FramedVerticalSlopedDoubleStairsBlock`
  framed_vertical_sloped_double_stairs: {
    properties: VERTICAL_PROPERTIES,
    parts: (s) => {
      const rot = s.rotation;
      const top = rot === "right" || rot === "up";
      const right = rot === "right" || rot === "down";
      return [
        part("framed_vertical_sloped_stairs", {
          facing: s.facing,
          rotation: rot,
          alt_slope: s.alt_slope,
        }),
        part("framed_half_slope", {
          facing: right
            ? clockWise(dir(s.facing))
            : counterClockWise(dir(s.facing)),
          top: bool(top),
          right: bool(right),
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
  // `FramedVerticalSlicedSlopedStairsPanelBlock`
  framed_vertical_sliced_sloped_stairs_panel: {
    properties: VERTICAL_PROPERTIES,
    parts: (s) => {
      const rot = s.rotation;
      const top = rot === "left" || rot === "down";
      const right = rot === "left" || rot === "up";
      return [
        part("framed_panel", { facing: s.facing }),
        part("framed_half_slope", {
          facing: right
            ? clockWise(dir(s.facing))
            : counterClockWise(dir(s.facing)),
          top: bool(top),
          right: bool(right),
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
  // `FramedVerticalSlicedSlopedStairsSlopeBlock`
  framed_vertical_sliced_sloped_stairs_slope: {
    properties: VERTICAL_PROPERTIES,
    parts: (s) => {
      const rot = s.rotation;
      const top = rot === "left" || rot === "down";
      const right = rot === "left" || rot === "up";
      const facingTwo = right
        ? clockWise(dir(s.facing))
        : counterClockWise(dir(s.facing));
      return [
        part("framed_slope", {
          facing: facingTwo,
          type: top ? "top" : "bottom",
          alt_slope: s.alt_slope,
        }),
        part("framed_half_slope", {
          facing: opposite(facingTwo),
          top: bool(!top),
          right: bool(right),
          alt_slope: s.alt_slope,
        }),
      ];
    },
  },
};
