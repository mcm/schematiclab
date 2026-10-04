// Shared source preparation for the single-region writers (Sponge, Structure,
// Structurize, Building Gadgets). Not a port: the Python originals threw on
// multi-region sources and indexed raw block positions, which broke for any
// source whose blocks don't start at 0,0,0 (Sponge `Offset`, editor edits).
//
// `flattenRegions` merges every region at its `getOrigin()`, translates to the
// target version when it differs, and rebases blocks, block entities and
// entities together so the bounding-box minimum is 0,0,0.

import * as nbt from "../nbt";
import { Block, BlockPos, BlockState } from "../blocks";
import { Entity } from "../entities";
import { AbstractSchematic } from "./abstract";
import { MinecraftVersion, posKey, versionsEqual } from "./version-mapping";

export interface FlattenedRegion {
  /** Version the blocks are in: the target version, else the source's. */
  minecraftVersion: MinecraftVersion;
  /**
   * DataVersion to stamp on the output: the target's, else the source's raw
   * one (which may be newer than `KNOWN_VERSIONS`).
   */
  dataVersion: number;
  /** Blocks as the source reports them (air included if it lists air). */
  blocks: Block[];
  blockMatrix: Map<string, Block>;
  /** Distinct block states, in first-seen order. */
  palette: BlockState[];
  /** Chunk-shape block entities (`id`, `x`, `y`, `z`) keyed by `posKey`. */
  tileEntityMatrix: Map<string, Entity>;
  entities: Entity[];
  size: [number, number, number];
}

function shiftNumberTag(tag: nbt.NbtTag | undefined, by: number): nbt.NbtTag {
  if (tag instanceof nbt.Double) return new nbt.Double(tag.value - by);
  if (tag instanceof nbt.Float) return new nbt.Float(tag.value - by);
  if (tag instanceof nbt.Int) return new nbt.Int(tag.value - by);
  return tag ?? new nbt.Double(-by);
}

/** Copy of an entity with `Pos` (and a hanging entity's `TileX/Y/Z`) moved. */
export function shiftEntity(entity: Entity, offset: BlockPos): Entity {
  if (offset.equals(BlockPos.ORIGIN)) return entity;
  const src = entity.toCompound();
  const out = new nbt.Compound();
  for (const [k, v] of src.entries) out.set(k, v);
  const posTag = src.get("Pos");
  if (posTag instanceof nbt.NbtList && posTag.items.length >= 3) {
    const [x, y, z] = posTag.items;
    out.set(
      "Pos",
      new nbt.NbtList([
        shiftNumberTag(x, offset.x),
        shiftNumberTag(y, offset.y),
        shiftNumberTag(z, offset.z),
      ]),
    );
  }
  for (const [key, by] of [
    ["TileX", offset.x],
    ["TileY", offset.y],
    ["TileZ", offset.z],
  ] as const) {
    const tag = src.get(key);
    if (tag instanceof nbt.Int) out.set(key, new nbt.Int(tag.value - by));
  }
  return new Entity(out);
}

/** Copy of a block entity with its `x`/`y`/`z` set to `pos`. */
export function placeTileEntity(entity: Entity, pos: BlockPos): Entity {
  const out = new nbt.Compound();
  for (const [k, v] of entity.toCompound().entries) out.set(k, v);
  out.set("x", new nbt.Int(pos.x));
  out.set("y", new nbt.Int(pos.y));
  out.set("z", new nbt.Int(pos.z));
  return new Entity(out);
}

function parsePosKey(key: string): BlockPos {
  const [x, y, z] = key.split(",").map(Number);
  return new BlockPos(x, y, z);
}

export function flattenRegions(
  schematic: AbstractSchematic,
  targetVersion: MinecraftVersion | null,
): FlattenedRegion {
  const regions = schematic.getRegions();
  const sourceVersion = schematic.getMinecraftVersion();
  const translate =
    targetVersion !== null && !versionsEqual(targetVersion, sourceVersion);

  const merged = new Map<string, Block>();
  const tileEntities = new Map<string, Entity>();
  const entities: Entity[] = [];
  let declaredSize: [number, number, number] = [0, 0, 0];

  for (const region of regions) {
    const translateRegion =
      targetVersion !== null &&
      !versionsEqual(targetVersion, region.getMinecraftVersion());
    const origin = region.getOrigin();
    const blocks = translateRegion
      ? region.getTranslatedBlocks(targetVersion)
      : region.getBlocks();
    const regionTileEntities = translateRegion
      ? region.getTranslatedTileEntityMatrix(targetVersion)
      : region.getTileEntityMatrix();
    const regionEntities = translateRegion
      ? region.getTranslatedEntities(targetVersion)
      : region.getEntities();

    for (const block of blocks) {
      const pos = block.pos.add(origin);
      merged.set(posKey(pos), new Block(pos, block.state));
    }
    for (const [key, entity] of regionTileEntities) {
      const pos = parsePosKey(key).add(origin);
      tileEntities.set(posKey(pos), placeTileEntity(entity, pos));
    }
    const negated = new BlockPos(-origin.x, -origin.y, -origin.z);
    for (const entity of regionEntities) {
      entities.push(shiftEntity(entity, negated));
    }
    if (regions.length === 1) declaredSize = region.getSize();
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const block of merged.values()) {
    minX = Math.min(minX, block.pos.x);
    minY = Math.min(minY, block.pos.y);
    minZ = Math.min(minZ, block.pos.z);
    maxX = Math.max(maxX, block.pos.x);
    maxY = Math.max(maxY, block.pos.y);
    maxZ = Math.max(maxZ, block.pos.z);
  }
  const empty = merged.size === 0;
  const offset = empty ? BlockPos.ORIGIN : new BlockPos(minX, minY, minZ);

  const blocks: Block[] = [];
  const blockMatrix = new Map<string, Block>();
  const paletteByKey = new Map<string, BlockState>();
  for (const block of merged.values()) {
    const pos = block.pos.sub(offset);
    const rebased = new Block(pos, block.state);
    blocks.push(rebased);
    blockMatrix.set(posKey(pos), rebased);
    const key = block.state.toString();
    if (!paletteByKey.has(key)) paletteByKey.set(key, block.state);
  }

  // Only block entities that sit on a block are kept; the rest would land on
  // air or outside the written volume.
  const tileEntityMatrix = new Map<string, Entity>();
  for (const [key, entity] of tileEntities) {
    const pos = parsePosKey(key).sub(offset);
    const k = posKey(pos);
    if (!blockMatrix.has(k)) continue;
    tileEntityMatrix.set(k, placeTileEntity(entity, pos));
  }

  const extent: [number, number, number] = empty
    ? [0, 0, 0]
    : [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
  // A single region that already starts at 0,0,0 keeps its declared size, so
  // trailing empty space (a Structure's padding, say) survives a round trip.
  const size: [number, number, number] = offset.equals(BlockPos.ORIGIN)
    ? [
        Math.max(extent[0], declaredSize[0]),
        Math.max(extent[1], declaredSize[1]),
        Math.max(extent[2], declaredSize[2]),
      ]
    : extent;

  return {
    minecraftVersion: translate ? targetVersion : sourceVersion,
    dataVersion: translate
      ? targetVersion.dataVersion
      : (targetVersion?.dataVersion ?? schematic.getDataVersion()),
    blocks,
    blockMatrix,
    palette: [...paletteByKey.values()],
    tileEntityMatrix,
    entities: entities.map((e) => shiftEntity(e, offset)),
    size,
  };
}
