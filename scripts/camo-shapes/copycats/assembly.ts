// A TypeScript port of the Copycats+ model assembly API
// (`foundation/copycat/model/assembly/`: CopycatRenderContext,
// AssemblyTransform, MutableAABB, MutableVec3, MutableCullFace), so the
// `*ModelCore.java` ports in this directory read like the Java. Read by
// `scripts/generate-camo-shapes.mts`, which records every `assemblePiece`
// call as a shape-pack piece.
//
// Ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f.
//
// Units: the Java helpers take voxel units (16 per block) and store block
// units; here everything stays in voxels, as shape packs are in model pixels.
//
// How a call becomes a piece (see CopycatRenderContextNeoForge):
//   - `select` is the crop box and `offset` the corner it moves to, both in
//     the core's canonical frame; the piece's `offset` is their difference.
//   - the AssemblyTransform (90° rotations and flips about the block centre,
//     in call order) becomes the piece's `transform`.
//   - `cull(...)` names camo faces the piece skips, i.e. the piece keeps the
//     other `faces`. It is not neighbour culling.
//   - Copycats+ gives each assembled quad a cull face when it lies on the
//     block boundary (`QuadAutoCull.BLOCK`), so the piece's `cull` lists its
//     faces that end on the boundary. `autoCull(box)` (multi-state parts)
//     culls against the part's box, via the part's scaled occlusion; shape
//     packs only cull against neighbours, so it's treated like the block box.
//   - `assembleAll()` copies the camo model unchanged: a full-cube piece, or
//     for a same-kind material (`material.is(...)`) the camo's whole mesh.
//
// The core ports import this module with its `.ts` extension, which node's
// type stripping needs (tsconfig sets `allowImportingTsExtensions`).

export type BlockState = Readonly<Record<string, string>>;

// ── MutableCullFace masks ──────────────────────────────────────────────────

export const DOWN = 1;
export const UP = 2;
export const NORTH = 4;
export const SOUTH = 8;
export const WEST = 16;
export const EAST = 32;

/** Mask bit of each direction, in shape-pack direction order. */
export const MASK_DIRECTIONS = [
  [DOWN, "down"],
  [UP, "up"],
  [NORTH, "north"],
  [SOUTH, "south"],
  [WEST, "west"],
  [EAST, "east"],
] as const;

// ── Transforms ─────────────────────────────────────────────────────────────

/** `AssemblyTransform.Transformable`; rotations are clockwise, in degrees. */
export interface Transformable {
  rotateX(angle: number): Transformable;
  rotateY(angle: number): Transformable;
  rotateZ(angle: number): Transformable;
  flipX(flip: boolean): Transformable;
  flipY(flip: boolean): Transformable;
  flipZ(flip: boolean): Transformable;
}

export type AssemblyTransform = (t: Transformable) => void;

export const IDENTITY: AssemblyTransform = () => {};

// ── Positions and boxes (voxels) ───────────────────────────────────────────

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export class MutableAABB {
  minX = 0;
  minY = 0;
  minZ = 0;
  maxX: number;
  maxY: number;
  maxZ: number;

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.maxX = sizeX;
    this.maxY = sizeY;
    this.maxZ = sizeZ;
  }

  /** Moves the box by the given amount in voxels. */
  move(dX: number, dY: number, dZ: number): this {
    this.minX += dX;
    this.maxX += dX;
    this.minY += dY;
    this.maxY += dY;
    this.minZ += dZ;
    this.maxZ += dZ;
    return this;
  }
}

/** `CopycatRenderContext.vec3`: a position in voxels. */
export function vec3(x: number, y: number, z: number): MutableVec3 {
  return { x, y, z };
}

/** `CopycatRenderContext.aabb`: a box of this size at the origin. */
export function aabb(sizeX: number, sizeY: number, sizeZ: number): MutableAABB {
  return new MutableAABB(sizeX, sizeY, sizeZ);
}

/** `CopycatRenderContext.cull`: camo faces the piece skips. */
export function cull(mask: number): number {
  return mask;
}

// ── Quad transforms ────────────────────────────────────────────────────────

/**
 * The quad transforms axis-aligned cores use. Both only change culling:
 * `autoCull(box)` is treated as the block box (see the header), and none
 * of the axis-aligned cores use the others. US-016 adds the geometric ones.
 */
export type QuadTransform = { kind: "autoCull"; box: MutableAABB | null };

export function autoCull(box?: MutableAABB): QuadTransform {
  return { kind: "autoCull", box: box ?? null };
}

// ── Render context and cores ───────────────────────────────────────────────

export interface CopycatRenderContext {
  assemblePiece(
    transform: AssemblyTransform,
    offset: MutableVec3,
    select: MutableAABB,
    cull: number,
    ...transforms: QuadTransform[]
  ): void;
  /** Copies every camo quad unchanged. */
  assembleAll(): void;
  /**
   * Not Copycats+ API: renders a block model, rotated like a blockstate
   * variant, with its textures swapped for the camo's texture on `face`
   * (Create's `CopycatBarsModel`).
   */
  assembleModel(id: string, x: number, y: number, face: string): void;
}

/**
 * Vanilla block classes the cores test the material against
 * (`material.getBlock() instanceof ...`). The generator turns each into a
 * shape-pack material condition (`MATERIAL_CLASSES` in the generator).
 */
export type MaterialClass =
  | "BasePressurePlateBlock"
  | "ButtonBlock"
  | "DoorBlock"
  | "FenceBlock"
  | "FenceGateBlock"
  | "IronBarsBlock"
  | "LadderBlock"
  | "TrapDoorBlock"
  | "WallBlock"
  // Create's CopycatSpecialCases, used by its panel.
  | "CopycatSpecialCases.isBarsMaterial"
  | "CopycatSpecialCases.isTrapdoorMaterial";

export interface Material {
  /** `material.getBlock() instanceof <class>`. */
  is(materialClass: MaterialClass): boolean;
}

export interface ModelCore {
  /**
   * `updatePropertiesIfMatch(<class>)` (or a mapper built on it) in
   * `registerModels`: a material of this class takes the copycat's values
   * for the properties they share.
   */
  copyPropertiesIf?: MaterialClass;
  /** Consults the `enhanced` model config (default on, as ported). */
  emitCopycatQuads(
    key: string,
    state: BlockState,
    context: CopycatRenderContext,
    material: Material,
  ): void;
}

/** A Copycats+ block and the core that renders it. */
export interface CopycatBlockSpec {
  core: ModelCore;
  /**
   * Properties the core reads, with every value (from the block's
   * createBlockStateDefinition() and its vanilla superclass); the first
   * value is the default. Other properties are ignored.
   */
  properties: Readonly<Record<string, readonly string[]>>;
  /**
   * Multi-state blocks: `storageProperties()`, the keys the core is called
   * with (and the camo slots, as in `src/lib/camo/extract.ts`). Single-state
   * blocks are called once with `MATERIAL_KEY`.
   */
  parts?: readonly string[];
}

/** `CopycatModelCore.MATERIAL_KEY`, the slot of single-state copycats. */
export const MATERIAL_KEY = "material";

// ── Minecraft helpers ──────────────────────────────────────────────────────

/** `Direction.toYRot()`. */
export function toYRot(direction: string): number {
  switch (direction) {
    case "south":
      return 0;
    case "west":
      return 90;
    case "north":
      return 180;
    case "east":
      return 270;
    default:
      return 0;
  }
}

/** `Direction.getClockWise()` (seen from above). */
export function clockWise(direction: string): string {
  return (
    { north: "east", east: "south", south: "west", west: "north" }[direction] ??
    direction
  );
}

/** `Direction.getCounterClockWise()` (seen from above). */
export function counterClockWise(direction: string): string {
  return (
    { north: "west", west: "south", south: "east", east: "north" }[direction] ??
    direction
  );
}

/** `Direction.getOpposite()`. */
export function opposite(direction: string): string {
  return (
    {
      north: "south",
      south: "north",
      east: "west",
      west: "east",
      up: "down",
      down: "up",
    }[direction] ?? direction
  );
}

/** `Direction.getAxis()`. */
export function axisOf(direction: string): "x" | "y" | "z" {
  if (direction === "east" || direction === "west") return "x";
  if (direction === "up" || direction === "down") return "y";
  return "z";
}

/** `direction.getAxisDirection() == POSITIVE`. */
export function isPositive(direction: string): boolean {
  return direction === "east" || direction === "up" || direction === "south";
}

/** `Iterate.directions`: down, up, north, south, west, east. */
export const DIRECTIONS = [
  "down",
  "up",
  "north",
  "south",
  "west",
  "east",
] as const;

/** `Iterate.horizontalDirections`: `Direction.from2DDataValue(0..3)`. */
export const HORIZONTAL_DIRECTIONS = [
  "south",
  "west",
  "north",
  "east",
] as const;

/** `Iterate.trueAndFalse` / `Iterate.falseAndTrue`. */
export const TRUE_AND_FALSE = [true, false] as const;
export const FALSE_AND_TRUE = [false, true] as const;

/** Values `0..max` (or `min..max`) as strings, for int properties. */
export function range(min: number, max: number): string[] {
  return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
}
