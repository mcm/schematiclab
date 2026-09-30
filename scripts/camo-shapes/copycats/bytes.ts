// Copycats+ `content/copycat/bytes/`: CopycatByteModelCore and
// CopycatMultiByteModelCore, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f. Properties, `allBytes` and
// `byByte` from CopycatByteBlock.

import {
  DOWN,
  EAST,
  FALSE_AND_TRUE,
  IDENTITY,
  NORTH,
  SOUTH,
  UP,
  WEST,
  aabb,
  autoCull,
  cull,
  vec3,
  type CopycatBlockSpec,
  type ModelCore,
} from "./assembly.ts";

/** `CopycatByteBlock.Byte`: which half of the block on each axis. */
interface Byte {
  x: boolean;
  y: boolean;
  z: boolean;
}

/** `CopycatByteBlock.allBytes`. */
const allBytes: readonly Byte[] = FALSE_AND_TRUE.flatMap((x) =>
  FALSE_AND_TRUE.flatMap((y) => FALSE_AND_TRUE.map((z) => ({ x, y, z }))),
);

/** `CopycatByteBlock.byByte(bite).getName()`. */
function byByte(bite: Byte): string {
  if (bite.y) {
    if (bite.x) return bite.z ? "top_southeast" : "top_northeast";
    return bite.z ? "top_southwest" : "top_northwest";
  }
  if (bite.x) return bite.z ? "bottom_southeast" : "bottom_northeast";
  return bite.z ? "bottom_southwest" : "bottom_northwest";
}

/** `CopycatMultiByteModelCore.byteMap`. */
const byteMap: ReadonlyMap<string, Byte> = new Map(
  allBytes.map((s) => [byByte(s), s]),
);

/** CopycatByteModelCore (not registered to a block at 60923e0). */
export const CopycatByteModelCore: ModelCore = {
  emitCopycatQuads(_key, state, context) {
    for (const bite of allBytes) {
      if (state[byByte(bite)] !== "true") continue;

      const offsetX = bite.x ? 8 : 0;
      const offsetY = bite.y ? 8 : 0;
      const offsetZ = bite.z ? 8 : 0;

      context.assemblePiece(
        IDENTITY,
        vec3(offsetX, offsetY, offsetZ),
        aabb(4, 4, 4),
        cull(UP | EAST | SOUTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(offsetX + 4, offsetY, offsetZ),
        aabb(4, 4, 4).move(12, 0, 0),
        cull(UP | WEST | SOUTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(offsetX, offsetY, offsetZ + 4),
        aabb(4, 4, 4).move(0, 0, 12),
        cull(UP | EAST | NORTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(offsetX + 4, offsetY, offsetZ + 4),
        aabb(4, 4, 4).move(12, 0, 12),
        cull(UP | WEST | NORTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(offsetX, offsetY + 4, offsetZ),
        aabb(4, 4, 4).move(0, 12, 0),
        cull(DOWN | EAST | SOUTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(offsetX + 4, offsetY + 4, offsetZ),
        aabb(4, 4, 4).move(12, 12, 0),
        cull(DOWN | WEST | SOUTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(offsetX, offsetY + 4, offsetZ + 4),
        aabb(4, 4, 4).move(0, 12, 12),
        cull(DOWN | EAST | NORTH),
      );
      context.assemblePiece(
        IDENTITY,
        vec3(offsetX + 4, offsetY + 4, offsetZ + 4),
        aabb(4, 4, 4).move(12, 12, 12),
        cull(DOWN | WEST | NORTH),
      );
    }
  },
};

/** CopycatMultiByteModelCore. */
export const CopycatMultiByteModelCore: ModelCore = {
  emitCopycatQuads(key, state, context) {
    const bite = byteMap.get(key);
    if (bite === undefined) throw new Error(`Invalid property: ${key}`);
    if (state[byByte(bite)] !== "true") return;

    const offsetX = bite.x ? 8 : 0;
    const offsetY = bite.y ? 8 : 0;
    const offsetZ = bite.z ? 8 : 0;

    const autoCullBox = autoCull(aabb(8, 8, 8).move(offsetX, offsetY, offsetZ));

    context.assemblePiece(
      IDENTITY,
      vec3(offsetX, offsetY, offsetZ),
      aabb(4, 4, 4),
      cull(UP | EAST | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      IDENTITY,
      vec3(offsetX + 4, offsetY, offsetZ),
      aabb(4, 4, 4).move(12, 0, 0),
      cull(UP | WEST | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      IDENTITY,
      vec3(offsetX, offsetY, offsetZ + 4),
      aabb(4, 4, 4).move(0, 0, 12),
      cull(UP | EAST | NORTH),
      autoCullBox,
    );
    context.assemblePiece(
      IDENTITY,
      vec3(offsetX + 4, offsetY, offsetZ + 4),
      aabb(4, 4, 4).move(12, 0, 12),
      cull(UP | WEST | NORTH),
      autoCullBox,
    );
    context.assemblePiece(
      IDENTITY,
      vec3(offsetX, offsetY + 4, offsetZ),
      aabb(4, 4, 4).move(0, 12, 0),
      cull(DOWN | EAST | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      IDENTITY,
      vec3(offsetX + 4, offsetY + 4, offsetZ),
      aabb(4, 4, 4).move(12, 12, 0),
      cull(DOWN | WEST | SOUTH),
      autoCullBox,
    );
    context.assemblePiece(
      IDENTITY,
      vec3(offsetX, offsetY + 4, offsetZ + 4),
      aabb(4, 4, 4).move(0, 12, 12),
      cull(DOWN | EAST | NORTH),
      autoCullBox,
    );
    context.assemblePiece(
      IDENTITY,
      vec3(offsetX + 4, offsetY + 4, offsetZ + 4),
      aabb(4, 4, 4).move(12, 12, 12),
      cull(DOWN | WEST | NORTH),
      autoCullBox,
    );
  },
};

const BOOLEAN = ["false", "true"] as const;

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_byte": {
    core: CopycatMultiByteModelCore,
    properties: {
      top_northeast: BOOLEAN,
      top_northwest: BOOLEAN,
      top_southeast: BOOLEAN,
      top_southwest: BOOLEAN,
      bottom_northeast: BOOLEAN,
      bottom_northwest: BOOLEAN,
      bottom_southeast: BOOLEAN,
      bottom_southwest: BOOLEAN,
    },
    parts: [
      "top_northeast",
      "top_northwest",
      "top_southeast",
      "top_southwest",
      "bottom_northeast",
      "bottom_northwest",
      "bottom_southeast",
      "bottom_southwest",
    ],
  },
};
