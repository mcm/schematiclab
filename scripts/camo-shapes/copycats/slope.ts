// Copycats+ `content/copycat/slope/`: CopycatSlopeModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.
// Properties from CopycatSlopeBlock. `assembleSlope` is also used by the
// vertical slope and slope layer cores.

import {
  DOWN,
  NORTH,
  SOUTH,
  UP,
  aabb,
  angle,
  cull,
  map,
  pivot,
  rotate,
  scale,
  slope,
  toYRot,
  translate,
  updateUV,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";

const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** CopycatSlopeModelCore. */
export const CopycatSlopeModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const enhanced = true;
    const facing = state.facing;
    const half = state.half;
    const rot = toYRot(facing);
    const flipY = half === "top";
    const transform: AssemblyTransform = (t) => t.flipY(flipY).rotateY(rot);
    assembleSlope(context, transform, 0, 16, enhanced);
  },
};

/** CopycatSlopeModelCore.assembleSlope. */
export function assembleSlope(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  minHeight: number,
  maxHeight: number,
  enhanced: boolean,
): void {
  if (minHeight === 0) {
    if (enhanced) {
      assembleTriangularSlopeEnhanced(
        context,
        transform,
        maxHeight,
        getMarginForHeight(maxHeight),
      );
    } else {
      assembleTriangularSlope(context, transform, maxHeight);
    }
  } else {
    if (enhanced) {
      assembleTrapezoidSlopeEnhanced(
        context,
        transform,
        minHeight,
        maxHeight,
        Math.min(2, getMarginForHeight(maxHeight)),
      );
    } else {
      assembleTrapezoidSlope(context, transform, minHeight, maxHeight);
    }
  }
}

function getMarginForHeight(maxHeight: number): number {
  if (maxHeight <= 2.5) return 0.5;
  if (maxHeight <= 4.5) return 1;
  if (maxHeight <= 8.5) return 2;
  return 3;
}

/** CopycatSlopeModelCore.assembleTriangularSlope(context, transform, maxHeight). */
export function assembleTriangularSlope(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  maxHeight: number,
): void {
  context.assemblePiece(
    transform,
    vec3(0, 0, 0),
    aabb(16, 16, 16),
    cull(NORTH),
    updateUV(slope("up", (_a, b) => map(0, 16, 0, maxHeight, b))),
  );
}

/** CopycatSlopeModelCore.assembleTrapezoidSlope(context, transform, minHeight, maxHeight). */
export function assembleTrapezoidSlope(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  minHeight: number,
  maxHeight: number,
): void {
  context.assemblePiece(
    transform,
    vec3(0, 0, 0),
    aabb(16, 16, 16),
    cull(0),
    updateUV(slope("up", (_a, b) => map(0, 16, minHeight, maxHeight, b))),
  );
}

/** CopycatSlopeModelCore.assembleTriangularSlope(context, transform, maxHeight, margin). */
export function assembleTriangularSlopeEnhanced(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  maxHeight: number,
  margin: number,
): void {
  const angleBottom = toDegrees(Math.atan2(maxHeight, 16));
  const marginAdjBottom = margin / Math.tan(toRadians(angleBottom) / 2);
  const angleTop = toDegrees(Math.atan2(16, maxHeight));
  const marginAdjTop = margin / Math.tan(toRadians(angleTop) / 2);

  const halfLength = Math.sqrt(maxHeight * maxHeight + 16 * 16) / 2;

  const midLengthBottom = halfLength - marginAdjBottom;
  const marginAdjExcessBottom = marginAdjBottom - Math.floor(marginAdjBottom);
  const midLengthTop = halfLength - marginAdjTop;
  const marginAdjExcessTop = marginAdjTop - Math.floor(marginAdjTop);

  const alignedLengthBottom = Math.abs(
    Math.floor(midLengthBottom + marginAdjExcessBottom) - marginAdjExcessBottom,
  );
  const alignedLengthTop =
    Math.floor(midLengthTop + marginAdjExcessTop) - marginAdjExcessTop;

  context.assemblePiece(
    transform,
    vec3(0, 0, 0),
    aabb(16, 16, marginAdjBottom),
    cull(UP | NORTH | SOUTH),
    updateUV(slope("up", (_a, b) => map(0, marginAdjBottom, 0, margin, b))),
  );
  context.assemblePiece(
    transform,
    vec3(0, 0, marginAdjBottom),
    aabb(16, 16, 16 - margin - marginAdjBottom).move(0, 0, marginAdjBottom),
    cull(UP | NORTH | SOUTH),
    updateUV(
      slope("up", (_a, b) =>
        map(marginAdjBottom, 16 - margin, margin, maxHeight - marginAdjTop, b),
      ),
    ),
  );
  if (maxHeight === 16) {
    context.assemblePiece(
      transform,
      vec3(0, 0, 16 - margin),
      aabb(16, 16, margin).move(0, 0, 16 - margin),
      cull(UP | NORTH),
      updateUV(
        slope("up", (_a, b) =>
          map(16 - margin, 16, maxHeight - marginAdjTop, maxHeight, b),
        ),
      ),
    );
  } else {
    context.assemblePiece(
      transform,
      vec3(0, 0, 16 - margin),
      aabb(16, maxHeight / 2, margin).move(0, 0, 16 - margin),
      cull(UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 16 - maxHeight / 2, 16 - margin),
      aabb(16, maxHeight / 2, margin).move(0, 16 - maxHeight / 2, 16 - margin),
      cull(UP | DOWN | NORTH),
      scale(pivot(16, 16, 16), scale(1, 32 / maxHeight, 1)),
      updateUV(
        slope("up", (_a, b) =>
          map(16 - margin, 16, 16 - (marginAdjTop / maxHeight) * 32, 16, b),
        ),
      ),
      scale(pivot(16, 16, 16), scale(1, maxHeight / 32, 1)),
      translate(0, -16 + maxHeight, 0),
    );
  }
  context.assemblePiece(
    transform,
    vec3(0, 0, 0),
    aabb(16, 16, marginAdjBottom),
    cull(DOWN | NORTH | SOUTH),
    updateUV(slope("down", (_a, b) => map(0, marginAdjBottom, 0, margin, b))),
    translate(0, -16, 0),
    rotate(pivot(0, 0, 0), angle(-angleBottom, 0, 0)),
  );
  context.assemblePiece(
    transform,
    vec3(0, maxHeight - margin, 16 - alignedLengthBottom),
    aabb(16, margin, alignedLengthBottom).move(0, 16 - margin, marginAdjBottom),
    cull(DOWN | NORTH | SOUTH),
    scale(
      pivot(16, maxHeight, 16),
      scale(1, 1, midLengthBottom / alignedLengthBottom),
    ),
    translate(0, 0, -halfLength),
    rotate(pivot(16, maxHeight, 16), angle(-angleBottom, 0, 0)),
  );
  context.assemblePiece(
    transform,
    vec3(0, maxHeight - margin, 16 - alignedLengthTop),
    aabb(16, margin, alignedLengthTop).move(
      0,
      16 - margin,
      16 - marginAdjTop - alignedLengthTop,
    ),
    cull(DOWN | NORTH | SOUTH),
    scale(
      pivot(16, maxHeight, 16),
      scale(1, 1, midLengthTop / alignedLengthTop),
    ),
    translate(0, 0, -marginAdjTop),
    rotate(pivot(16, maxHeight, 16), angle(-angleBottom, 0, 0)),
  );
  context.assemblePiece(
    transform,
    vec3(0, 0, 16 - marginAdjTop),
    aabb(16, 16, marginAdjTop).move(0, 0, 16 - marginAdjTop),
    cull(DOWN | NORTH | SOUTH),
    updateUV(
      slope("down", (_a, b) => map(16 - marginAdjTop, 16, margin, 0, b)),
    ),
    translate(0, -16 + maxHeight, 0),
    rotate(pivot(16, maxHeight, 16), angle(-angleBottom, 0, 0)),
  );
}

/** CopycatSlopeModelCore.assembleTrapezoidSlope(context, transform, minHeight, maxHeight, margin). */
export function assembleTrapezoidSlopeEnhanced(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  minHeight: number,
  maxHeight: number,
  margin: number,
): void {
  const angleBottom = toDegrees(Math.atan2(maxHeight - minHeight, 16)) + 90;
  const marginAdjBottom = margin / Math.tan(toRadians(angleBottom) / 2);
  const angleTop = toDegrees(Math.atan2(16, maxHeight - minHeight));
  const marginAdjTop = margin / Math.tan(toRadians(angleTop) / 2);

  const halfLength =
    Math.sqrt((maxHeight - minHeight) * (maxHeight - minHeight) + 16 * 16) / 2;

  const midLengthBottom = halfLength - marginAdjBottom;
  const marginAdjExcessBottom = marginAdjBottom - Math.floor(marginAdjBottom);
  const midLengthTop = halfLength - marginAdjTop;
  const marginAdjExcessTop = marginAdjTop - Math.floor(marginAdjTop);

  const alignedLengthBottom = Math.abs(
    Math.floor(midLengthBottom + marginAdjExcessBottom) - marginAdjExcessBottom,
  );
  const alignedLengthTop =
    Math.floor(midLengthTop + marginAdjExcessTop) - marginAdjExcessTop;

  if (minHeight === 16 || minHeight === 0) {
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, 16, margin),
      cull(UP | SOUTH),
      updateUV(
        slope("up", (_a, b) =>
          map(0, margin, minHeight, minHeight - marginAdjBottom, b),
        ),
      ),
    );
  } else {
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, minHeight / 2, margin).move(0, 0, 0),
      cull(UP | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 0, 0),
      aabb(16, minHeight / 2, margin).move(0, 16 - minHeight / 2, 0),
      cull(UP | DOWN | SOUTH),
      scale(pivot(0, 0, 0), scale(1, 32 / minHeight, 1)),
      updateUV(
        slope("up", (_a, b) =>
          map(0, margin, 16, 16 - (marginAdjBottom / minHeight) * 32, b),
        ),
      ),
      scale(pivot(0, 0, 0), scale(1, minHeight / 32, 1)),
      translate(0, minHeight / 2, 0),
    );
  }
  context.assemblePiece(
    transform,
    vec3(0, 0, margin),
    aabb(16, 16, 16 - margin * 2).move(0, 0, margin),
    cull(UP | NORTH | SOUTH),
    updateUV(
      slope("up", (_a, b) =>
        map(
          margin,
          16 - margin,
          minHeight - marginAdjBottom,
          maxHeight - marginAdjTop,
          b,
        ),
      ),
    ),
  );
  if (maxHeight === 16 || maxHeight === 0) {
    context.assemblePiece(
      transform,
      vec3(0, 0, 16 - margin),
      aabb(16, 16, margin).move(0, 0, 16 - margin),
      cull(UP | NORTH),
      updateUV(
        slope("up", (_a, b) =>
          map(16 - margin, 16, maxHeight - marginAdjTop, maxHeight, b),
        ),
      ),
    );
  } else {
    context.assemblePiece(
      transform,
      vec3(0, 0, 16 - margin),
      aabb(16, maxHeight / 2, margin).move(0, 0, 16 - margin),
      cull(UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(0, 16 - maxHeight / 2, 16 - margin),
      aabb(16, maxHeight / 2, margin).move(0, 16 - maxHeight / 2, 16 - margin),
      cull(UP | DOWN | NORTH),
      scale(pivot(16, 16, 16), scale(1, 32 / maxHeight, 1)),
      updateUV(
        slope("up", (_a, b) =>
          map(16 - margin, 16, 16 - (marginAdjTop / maxHeight) * 32, 16, b),
        ),
      ),
      scale(pivot(16, 16, 16), scale(1, maxHeight / 32, 1)),
      translate(0, -16 + maxHeight, 0),
    );
  }
  context.assemblePiece(
    transform,
    vec3(0, 0, 0),
    aabb(16, 16, marginAdjBottom),
    cull(DOWN | NORTH | SOUTH),
    updateUV(slope("down", (_a, b) => map(0, marginAdjBottom, 0, margin, b))),
    translate(0, -16 + minHeight, 0),
    rotate(pivot(0, minHeight, 0), angle(90 - angleBottom, 0, 0)),
  );
  context.assemblePiece(
    transform,
    vec3(0, maxHeight - margin, 16 - alignedLengthBottom),
    aabb(16, margin, alignedLengthBottom).move(0, 16 - margin, marginAdjBottom),
    cull(DOWN | NORTH | SOUTH),
    scale(
      pivot(16, maxHeight, 16),
      scale(1, 1, midLengthBottom / alignedLengthBottom),
    ),
    translate(0, 0, -halfLength),
    rotate(pivot(16, maxHeight, 16), angle(90 - angleBottom, 0, 0)),
  );
  context.assemblePiece(
    transform,
    vec3(0, maxHeight - margin, 16 - alignedLengthTop),
    aabb(16, margin, alignedLengthTop).move(
      0,
      16 - margin,
      16 - marginAdjTop - alignedLengthTop,
    ),
    cull(DOWN | NORTH | SOUTH),
    scale(
      pivot(16, maxHeight, 16),
      scale(1, 1, midLengthTop / alignedLengthTop),
    ),
    translate(0, 0, -marginAdjTop),
    rotate(pivot(16, maxHeight, 16), angle(90 - angleBottom, 0, 0)),
  );
  context.assemblePiece(
    transform,
    vec3(0, 0, 16 - marginAdjTop),
    aabb(16, 16, marginAdjTop).move(0, 0, 16 - marginAdjTop),
    cull(DOWN | NORTH | SOUTH),
    updateUV(
      slope("down", (_a, b) => map(16 - marginAdjTop, 16, margin, 0, b)),
    ),
    translate(0, -16 + maxHeight, 0),
    rotate(pivot(16, maxHeight, 16), angle(90 - angleBottom, 0, 0)),
  );
}

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_slope": {
    core: CopycatSlopeModelCore,
    properties: {
      facing: ["north", "south", "west", "east"],
      half: ["bottom", "top"],
    },
  },
};
