// Hand port of FramedBlocks' `client/model/geometry/rail/FramedRailSlopeGeometry.java`
// (the slopes with a vanilla rail on top) and of the `calculateParts()` of
// the fancy rail slopes (`common/block/rail/fancyslope/`). Read by
// `scripts/generate-camo-shapes.mts` through `GEOMETRY_SPECS` and
// `DOUBLE_BLOCK_SPECS`.
//
// The vanilla rail slopes add the vanilla rail's own model unchanged, so it
// becomes a `block` piece. The fancy rail slopes' second part is the fancy
// rail geometry (`geometry-specs.ts`), which only builds the camo sleepers:
// the rails come from FramedBlocks' own base model and aren't rendered, as
// on the flat fancy rails.
//
// Ported from XFactHD/FramedBlocks at commit
// 8267f80b6893dabb7f6cef469182a0b969de465e (11.4.0). Each spec names its
// Java class.

import type { Direction } from "../../../src/lib/render/camo/shape-pack";
import { BOOL, type BlockState, type GeometrySpec } from "./geometry-api.ts";
import { SLOPE_GEOMETRY_SPECS } from "./slope.ts";
import type { DoubleBlockSpec } from "./template-specs.ts";

/** `PropertyHolder.ASCENDING_RAIL_SHAPE`, in `RailShape` order. */
const ASCENDING_RAIL_SHAPE = [
  "ascending_east",
  "ascending_west",
  "ascending_north",
  "ascending_south",
] as const;

/** `FramedUtils.getDirectionFromAscendingRailShape`. */
const directionFromAscendingRailShape = (shape: string): Direction =>
  shape.replace("ascending_", "") as Direction;

/** `FramedRailSlopeGeometry.getSlopeState`: a bottom slope facing up the rail. */
const slopeState = (s: BlockState): BlockState => ({
  facing: directionFromAscendingRailShape(s.shape),
  type: "bottom",
  alt_slope: s.alt_slope,
});

/**
 * `rail/FramedRailSlopeGeometry.java` (`normal`, `powered`, `detector`,
 * `activator`): `FramedSlopeGeometry` for the slope state, plus the vanilla
 * `rail` block's model for the same shape (and `powered` value).
 */
function railSlope(rail: string, powered: boolean): GeometrySpec {
  const slope = SLOPE_GEOMETRY_SPECS.framed_slope;
  return {
    properties: {
      shape: ASCENDING_RAIL_SHAPE,
      alt_slope: BOOL,
      ...(powered ? { powered: BOOL } : {}),
    },
    geometry: (s) => slope.geometry(slopeState(s)),
    // `SlopeFullFacePredicate`, on the rail slope's facing and bottom type.
    fullFaces: (s) => slope.fullFaces!(slopeState(s)),
    additionalBlock: (s) => ({
      name: `minecraft:${rail}`,
      properties: {
        shape: s.shape,
        ...(powered ? { powered: s.powered } : {}),
      },
    }),
  };
}

export const RAIL_SLOPE_GEOMETRY_SPECS: Readonly<Record<string, GeometrySpec>> =
  {
    framed_rail_slope: railSlope("rail", false),
    framed_powered_rail_slope: railSlope("powered_rail", true),
    framed_detector_rail_slope: railSlope("detector_rail", true),
    framed_activator_rail_slope: railSlope("activator_rail", true),
  };

/**
 * `FramedFancyRailSlopeBlock`, `FramedFancyPoweredRailSlopeBlock` (powered
 * and activator) and `FramedFancyDetectorRailSlopeBlock`: a bottom slope,
 * then the fancy rail with the same shape.
 */
function fancyRailSlope(rail: string): DoubleBlockSpec {
  return {
    properties: { shape: ASCENDING_RAIL_SHAPE, alt_slope: BOOL },
    parts: (s) => [
      { block: "framed_slope", props: slopeState(s) },
      { block: rail, props: { shape: s.shape } },
    ],
  };
}

export const RAIL_SLOPE_DOUBLE_BLOCK_SPECS: Readonly<
  Record<string, DoubleBlockSpec>
> = {
  framed_fancy_rail_slope: fancyRailSlope("framed_fancy_rail"),
  framed_fancy_powered_rail_slope: fancyRailSlope("framed_fancy_powered_rail"),
  framed_fancy_detector_rail_slope: fancyRailSlope(
    "framed_fancy_detector_rail",
  ),
  framed_fancy_activator_rail_slope: fancyRailSlope(
    "framed_fancy_activator_rail",
  ),
};
