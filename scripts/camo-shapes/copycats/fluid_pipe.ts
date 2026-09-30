// Copycats+ `content/copycat/fluid_pipe/`: CopycatFluidPipeModelCore and
// CopycatStraightPipeModelCore, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties from
// CopycatFluidPipeBlock (Create's FluidPipeBlock, vanilla PipeBlock) and
// CopycatGlassFluidPipeBlock (Create's GlassFluidPipeBlock, AxisPipeBlock,
// vanilla RotatedPillarBlock).
//
// Both cores are `CopycatModelCore.WithData<PipeModelData>`. Skipped, as
// they are not camo geometry:
//   - the STATIC "bracket" model entry (a Create bracket model taken from
//     the pipe's bracket behaviour), registered by CopycatFluidPipeModelCore;
//   - the STATIC `SUPER` entry (the glass pipe's own base model), registered
//     by CopycatStraightPipeModelCore.
//
// The model data is filled per render by the loader models
// (CopycatFluidPipeModelNeoForge / ...Fabric): rim attachments from
// `FluidTransportBehaviour.getRenderedRimAttachment`, which looks at the
// neighbouring blocks, and `encased` from `FluidPipeBlock.shouldDrawCasing`.
// A shape pack is per block state, so `pipeModelData` works the data out
// from the state alone, as if every open side met a pipe that connects
// back (the usual case): `shouldDrawCasing` needs only the state, and such
// a side gets CONNECTION on a straight pipe's axis and DETAILED_CONNECTION
// otherwise (`StandardPipeFluidTransportBehaviour.getRenderedRimAttachment`
// when `shouldDrawRim` is false). Open ends facing a tank, pump or nothing
// would get a rim or drain in-game; they render as connections here.

import {
  DOWN,
  DIRECTIONS,
  EAST,
  IDENTITY,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  axisOf,
  cull,
  isPositive,
  toYRot,
  vec3,
  type AssemblyTransform,
  type CopycatBlockSpec,
  type CopycatRenderContext,
  type ModelCore,
} from "./assembly.ts";

// ── Model data ─────────────────────────────────────────────────────────────

/** `FluidTransportBehaviour.AttachmentTypes.ComponentPartials`. */
export type ComponentPartials =
  | "CONNECTION"
  | "RIM_CONNECTOR"
  | "RIM"
  | "DRAIN";

/** `FluidTransportBehaviour.AttachmentTypes`. */
export type AttachmentTypes =
  | "NONE"
  | "CONNECTION"
  | "DETAILED_CONNECTION"
  | "RIM"
  | "PARTIAL_RIM"
  | "DRAIN"
  | "PARTIAL_DRAIN";

/** `AttachmentTypes.partials`. */
export const ATTACHMENT_PARTIALS: Readonly<
  Record<AttachmentTypes, readonly ComponentPartials[]>
> = {
  NONE: [],
  CONNECTION: ["CONNECTION"],
  DETAILED_CONNECTION: ["RIM_CONNECTOR"],
  RIM: ["RIM_CONNECTOR", "RIM"],
  PARTIAL_RIM: ["RIM"],
  DRAIN: ["RIM_CONNECTOR", "DRAIN"],
  PARTIAL_DRAIN: ["DRAIN"],
};

/** CopycatFluidPipeModelCore.PipeModelData (the bracket is skipped). */
export interface PipeModelData {
  /** Attachment per direction; missing directions are NONE. */
  attachments: Readonly<Partial<Record<string, AttachmentTypes>>>;
  encased: boolean;
}

/** `FluidPropagator.getStraightPipeAxis` for a pipe: its two open sides' axis. */
function straightPipeAxis(open: readonly string[]): string | null {
  return open.length === 2 && axisOf(open[0]) === axisOf(open[1])
    ? axisOf(open[0])
    : null;
}

/** `FluidPipeBlock.shouldDrawCasing`. */
function shouldDrawCasing(open: readonly string[]): boolean {
  return (["x", "y", "z"] as const).some(
    (axis) => open.filter((direction) => axisOf(direction) !== axis).length > 2,
  );
}

/** The model data the loader would gather, from the state (see header). */
export function pipeModelData(open: readonly string[]): PipeModelData {
  const axis = straightPipeAxis(open);
  return {
    attachments: Object.fromEntries(
      open.map((direction) => [
        direction,
        axis === axisOf(direction) ? "CONNECTION" : "DETAILED_CONNECTION",
      ]),
    ),
    encased: shouldDrawCasing(open),
  };
}

// ── CopycatFluidPipeModelCore ──────────────────────────────────────────────

/** CopycatFluidPipeModelCore. */
export const CopycatFluidPipeModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const enhanced = true;

    const directions: string[] = [];
    for (const direction of DIRECTIONS) {
      if (state[direction] === "true") directions.push(direction);
    }
    const data = pipeModelData(directions);
    if (directions.length === 2) {
      if (axisOf(directions[0]) === axisOf(directions[1])) {
        const yRot = axisOf(directions[0]) === "x" ? 90 : 0;
        const xRot = axisOf(directions[0]) === "y" ? 90 : 0;
        renderStraightCore(context, (t) => t.rotateY(yRot).rotateX(xRot));
      } else {
        let base: string | null = null;
        if (axisOf(directions[0]) === "x") {
          base = directions.splice(0, 1)[0];
        } else if (axisOf(directions[1]) === "x") {
          base = directions.splice(1, 1)[0];
        }
        if (base !== null) {
          const flipX = isPositive(base);
          const xRot = getXRot(directions[0]);
          renderBend(context, (t) => t.flipX(flipX).rotateX(xRot), enhanced);
        } else {
          if (axisOf(directions[0]) === "z") {
            base = directions.splice(0, 1)[0];
          } else if (axisOf(directions[1]) === "z") {
            base = directions.splice(1, 1)[0];
          }
          if (base !== null) {
            const flipZ = isPositive(base);
            const zRot = getZRot(directions[0]);
            renderBend(context, (t) => t.flipZ(flipZ).rotateZ(zRot), enhanced);
          }
        }
      }
    } else if (directions.length === 3) {
      let flipX = false,
        flipY = false,
        flipZ = false;
      for (const direction of directions) {
        if (axisOf(direction) === "x") {
          flipX = !isPositive(direction);
        } else if (axisOf(direction) === "y") {
          flipY = !isPositive(direction);
        } else {
          flipZ = !isPositive(direction);
        }
      }
      const finalFlipX = flipX;
      const finalFlipY = flipY;
      const finalFlipZ = flipZ;
      renderCorner(
        context,
        (t) => t.flipX(finalFlipX).flipY(finalFlipY).flipZ(finalFlipZ),
        enhanced,
      );
    }
    assembleAccessories(context, data);
  },
};

/** CopycatFluidPipeModelCore.assembleAccessories. */
export function assembleAccessories(
  context: CopycatRenderContext,
  data: PipeModelData,
): void {
  for (const direction of DIRECTIONS) {
    for (const partial of ATTACHMENT_PARTIALS[
      data.attachments[direction] ?? "NONE"
    ]) {
      renderComponent(context, direction, partial);
    }
  }
  if (data.encased) {
    renderEncasing(context);
  }
}

/** CopycatFluidPipeModelCore.getXRot. */
export function getXRot(direction: string): number {
  switch (direction) {
    case "north":
      return 0;
    case "down":
      return 90;
    case "south":
      return 180;
    case "up":
      return 270;
    default:
      return 0;
  }
}

/** CopycatFluidPipeModelCore.getZRot. */
export function getZRot(direction: string): number {
  switch (direction) {
    case "west":
      return 0;
    case "up":
      return 90;
    case "east":
      return 180;
    case "down":
      return 270;
    default:
      return 0;
  }
}

/** CopycatFluidPipeModelCore.renderStraightCore. */
export function renderStraightCore(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
): void {
  context.assemblePiece(
    transform,
    vec3(4, 4, 4),
    aabb(4, 4, 8).move(0, 0, 4),
    cull(EAST | UP | NORTH | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(8, 4, 4),
    aabb(4, 4, 8).move(12, 0, 4),
    cull(WEST | UP | NORTH | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(4, 8, 4),
    aabb(4, 4, 8).move(0, 12, 4),
    cull(EAST | DOWN | NORTH | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(8, 8, 4),
    aabb(4, 4, 8).move(12, 12, 4),
    cull(WEST | DOWN | NORTH | SOUTH),
  );
}

/** CopycatFluidPipeModelCore.renderBend (`enhanced` is the core's field). */
export function renderBend(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  enhanced: boolean,
): void {
  if (enhanced) {
    context.assemblePiece(
      transform,
      vec3(8, 4, 4),
      aabb(4, 4, 8).move(12, 0, 8),
      cull(WEST | UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(8, 8, 4),
      aabb(4, 4, 8).move(12, 12, 8),
      cull(WEST | DOWN | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(4, 4, 8),
      aabb(4, 4, 4).move(8, 0, 12),
      cull(EAST | WEST | UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(4, 8, 8),
      aabb(4, 4, 4).move(8, 12, 12),
      cull(EAST | WEST | DOWN | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(7, 4, 4),
      aabb(1, 8, 4).move(3, 0, 8),
      cull(EAST | WEST | NORTH | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(5, 4, 4),
      aabb(2, 8, 2).move(1, 0, 8),
      cull(EAST | WEST | NORTH | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(4, 4, 6),
      aabb(3, 8, 2).move(8, 0, 2),
      cull(EAST | WEST | NORTH | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(4, 4, 4),
      aabb(1, 8, 2).move(8, 0, 0),
      cull(EAST | WEST | NORTH | SOUTH),
    );
  } else {
    context.assemblePiece(
      transform,
      vec3(4, 4, 4),
      aabb(8, 4, 8).move(8, 0, 8),
      cull(WEST | UP | NORTH),
    );
    context.assemblePiece(
      transform,
      vec3(4, 8, 4),
      aabb(8, 4, 8).move(8, 12, 8),
      cull(WEST | DOWN | NORTH),
    );
  }
}

/** CopycatFluidPipeModelCore.renderCorner (`enhanced` is the core's field). */
export function renderCorner(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
  enhanced: boolean,
): void {
  if (enhanced) {
    context.assemblePiece(
      transform,
      vec3(4, 4, 4),
      aabb(4, 8, 4).move(0, 0, 0),
      cull(EAST | UP | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(4, 4, 8),
      aabb(4, 4, 4).move(0, 0, 4),
      cull(EAST | UP | NORTH | SOUTH),
    );
    context.assemblePiece(
      transform,
      vec3(8, 4, 4),
      aabb(4, 4, 4).move(4, 0, 0),
      cull(EAST | WEST | UP | SOUTH),
    );
    renderCornerPart(context, transform);
    renderCornerPart(context, (t) => transform(t.rotateY(-90).flipZ(true)));
    renderCornerPart(context, (t) => transform(t.rotateX(90).flipZ(true)));
  } else {
    context.assemblePiece(
      transform,
      vec3(4, 4, 4),
      aabb(8, 8, 8).move(0, 0, 0),
      cull(EAST | UP | SOUTH),
    );
  }
}

/** CopycatFluidPipeModelCore.renderCornerPart. */
export function renderCornerPart(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
): void {
  context.assemblePiece(
    transform,
    vec3(8, 8, 4),
    aabb(4, 1, 4).move(4, 12, 0),
    cull(EAST | WEST | UP | DOWN | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(10, 9, 4),
    aabb(2, 2, 4).move(6, 13, 0),
    cull(EAST | WEST | UP | DOWN | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(8, 9, 4),
    aabb(2, 3, 4).move(12, 5, 0),
    cull(EAST | WEST | UP | DOWN | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(10, 11, 4),
    aabb(2, 1, 4).move(14, 7, 0),
    cull(EAST | WEST | UP | DOWN | SOUTH),
  );
}

/** CopycatFluidPipeModelCore.renderEncasing. */
export function renderEncasing(context: CopycatRenderContext): void {
  context.assemblePiece(
    IDENTITY,
    vec3(3, 3, 3),
    aabb(5, 5, 5).move(0, 0, 0),
    cull(EAST | UP | SOUTH),
  );
  context.assemblePiece(
    IDENTITY,
    vec3(8, 3, 3),
    aabb(5, 5, 5).move(11, 0, 0),
    cull(WEST | UP | SOUTH),
  );
  context.assemblePiece(
    IDENTITY,
    vec3(3, 8, 3),
    aabb(5, 5, 5).move(0, 11, 0),
    cull(EAST | DOWN | SOUTH),
  );
  context.assemblePiece(
    IDENTITY,
    vec3(8, 8, 3),
    aabb(5, 5, 5).move(11, 11, 0),
    cull(WEST | DOWN | SOUTH),
  );
  context.assemblePiece(
    IDENTITY,
    vec3(3, 3, 8),
    aabb(5, 5, 5).move(0, 0, 11),
    cull(EAST | UP | NORTH),
  );
  context.assemblePiece(
    IDENTITY,
    vec3(8, 3, 8),
    aabb(5, 5, 5).move(11, 0, 11),
    cull(WEST | UP | NORTH),
  );
  context.assemblePiece(
    IDENTITY,
    vec3(3, 8, 8),
    aabb(5, 5, 5).move(0, 11, 11),
    cull(EAST | DOWN | NORTH),
  );
  context.assemblePiece(
    IDENTITY,
    vec3(8, 8, 8),
    aabb(5, 5, 5).move(11, 11, 11),
    cull(WEST | DOWN | NORTH),
  );
}

/** CopycatFluidPipeModelCore.renderComponent. */
export function renderComponent(
  context: CopycatRenderContext,
  direction: string,
  component: ComponentPartials,
): void {
  const transform: AssemblyTransform =
    axisOf(direction) === "y"
      ? (t) => t.rotateX(direction === "down" ? 90 : -90)
      : (t) => t.rotateY(toYRot(direction) + 180);
  switch (component) {
    case "RIM": {
      context.assemblePiece(
        transform,
        vec3(3, 3, 0),
        aabb(5, 5, 2).move(0, 0, 14),
        cull(EAST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(8, 3, 0),
        aabb(5, 5, 2).move(11, 0, 14),
        cull(WEST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(3, 8, 0),
        aabb(5, 5, 2).move(0, 11, 14),
        cull(EAST | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(8, 8, 0),
        aabb(5, 5, 2).move(11, 11, 14),
        cull(WEST | DOWN),
      );
      break;
    }
    case "CONNECTION": {
      context.assemblePiece(
        transform,
        vec3(4, 4, 0),
        aabb(4, 4, 4).move(0, 0, 4),
        cull(EAST | UP | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(8, 4, 0),
        aabb(4, 4, 4).move(12, 0, 4),
        cull(WEST | UP | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(4, 8, 0),
        aabb(4, 4, 4).move(0, 12, 4),
        cull(EAST | DOWN | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(8, 8, 0),
        aabb(4, 4, 4).move(12, 12, 4),
        cull(WEST | DOWN | SOUTH | NORTH),
      );
      break;
    }
    case "RIM_CONNECTOR": {
      context.assemblePiece(
        transform,
        vec3(4, 4, 2),
        aabb(4, 4, 2).move(0, 0, 0),
        cull(EAST | UP | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(8, 4, 2),
        aabb(4, 4, 2).move(12, 0, 0),
        cull(WEST | UP | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(4, 8, 2),
        aabb(4, 4, 2).move(0, 12, 0),
        cull(EAST | DOWN | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(8, 8, 2),
        aabb(4, 4, 2).move(12, 12, 0),
        cull(WEST | DOWN | SOUTH | NORTH),
      );

      context.assemblePiece(
        transform,
        vec3(4, 4, 0),
        aabb(4, 4, 2).move(0, 0, 4),
        cull(EAST | UP | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(8, 4, 0),
        aabb(4, 4, 2).move(12, 0, 4),
        cull(WEST | UP | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(4, 8, 0),
        aabb(4, 4, 2).move(0, 12, 4),
        cull(EAST | DOWN | SOUTH | NORTH),
      );
      context.assemblePiece(
        transform,
        vec3(8, 8, 0),
        aabb(4, 4, 2).move(12, 12, 4),
        cull(WEST | DOWN | SOUTH | NORTH),
      );
      break;
    }
    case "DRAIN": {
      context.assemblePiece(
        transform,
        vec3(3, 3, -1),
        aabb(5, 5, 3).move(0, 0, 13),
        cull(EAST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(8, 3, -1),
        aabb(5, 5, 3).move(11, 0, 13),
        cull(WEST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(3, 8, -1),
        aabb(5, 5, 3).move(0, 11, 13),
        cull(EAST | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(8, 8, -1),
        aabb(5, 5, 3).move(11, 11, 13),
        cull(WEST | DOWN),
      );

      context.assemblePiece(
        transform,
        vec3(5, 5, -4),
        aabb(3, 3, 3).move(0, 0, 0),
        cull(EAST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(8, 5, -4),
        aabb(3, 3, 3).move(13, 0, 0),
        cull(WEST | UP),
      );
      context.assemblePiece(
        transform,
        vec3(5, 8, -4),
        aabb(3, 3, 3).move(0, 13, 0),
        cull(EAST | DOWN),
      );
      context.assemblePiece(
        transform,
        vec3(8, 8, -4),
        aabb(3, 3, 3).move(13, 13, 0),
        cull(WEST | DOWN),
      );
      break;
    }
  }
}

// ── CopycatStraightPipeModelCore ───────────────────────────────────────────

/** CopycatStraightPipeModelCore (extends CopycatFluidPipeModelCore). */
export const CopycatStraightPipeModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    const axis = state.axis;
    // GlassFluidPipeBlock (AxisPipeBlock) is open at both ends of its axis.
    const data = pipeModelData(
      DIRECTIONS.filter((direction) => axisOf(direction) === axis),
    );

    const yRot = axis === "x" ? 90 : 0;
    const xRot = axis === "y" ? 90 : 0;
    renderWindowCore(context, (t) => t.rotateY(yRot).rotateX(xRot));
    renderWindowCore(context, (t) => t.rotateZ(90).rotateY(yRot).rotateX(xRot));
    renderWindowCore(context, (t) =>
      t.rotateZ(180).rotateY(yRot).rotateX(xRot),
    );
    renderWindowCore(context, (t) =>
      t.rotateZ(270).rotateY(yRot).rotateX(xRot),
    );

    assembleAccessories(context, data);
  },
};

const EPSILON = 0.02;

/** CopycatStraightPipeModelCore.renderWindowCore. */
export function renderWindowCore(
  context: CopycatRenderContext,
  transform: AssemblyTransform,
): void {
  context.assemblePiece(
    transform,
    vec3(4 + EPSILON, 4 + EPSILON, 0),
    aabb(2, 2, 16).move(0, 0, 0),
    cull(EAST | UP | NORTH | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(5, 4, 0),
    aabb(1, 1, 16).move(0, 0, 0),
    cull(EAST | WEST | DOWN | NORTH | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(4, 5, 0),
    aabb(1, 1, 16).move(0, 0, 0),
    cull(WEST | UP | DOWN | NORTH | SOUTH),
  );
  context.assemblePiece(
    transform,
    vec3(4 + EPSILON, 6 + EPSILON, 0),
    aabb(1, 4 - 2 * EPSILON, 3).move(0, 6, 0),
    cull(UP | DOWN | NORTH),
  );
  context.assemblePiece(
    transform,
    vec3(4 + EPSILON, 6 + EPSILON, 13),
    aabb(1, 4 - 2 * EPSILON, 3).move(0, 6, 13),
    cull(UP | DOWN | SOUTH),
  );
}

const BOOLEAN = ["false", "true"] as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_fluid_pipe": {
    core: CopycatFluidPipeModelCore,
    properties: {
      down: BOOLEAN,
      up: BOOLEAN,
      north: BOOLEAN,
      south: BOOLEAN,
      west: BOOLEAN,
      east: BOOLEAN,
    },
  },
  "copycats:copycat_glass_fluid_pipe": {
    core: CopycatStraightPipeModelCore,
    properties: {
      axis: ["y", "x", "z"],
    },
  },
};
