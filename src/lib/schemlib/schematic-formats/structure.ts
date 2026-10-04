// Port of schemlib/schematic_formats/structure.py (Python) -> TypeScript.
//
// "Structure" is the vanilla Minecraft `.nbt` structure block format (also used
// by the Create mod and others). Wire format: gzipped NBT with `DataVersion`,
// `blocks` (list of `{pos, state, nbt?}`), `palette` (list of blockstate
// compounds), `entities`, `size`.
//
// Unlike litematic (which can have multiple regions), structure is single-
// region — so `StructureSchematic` implements both `AbstractRegion` and
// `AbstractSchematic`. Python achieves this via multiple inheritance; TS only
// has single inheritance, so we extend `AbstractRegion` and re-implement the
// `AbstractSchematic` surface ourselves.

import * as nbt from "../nbt";
import { Block, BlockPos, BlockState } from "../blocks";
import { Entity, EntityPos } from "../entities";
import {
  AbstractRegion,
  AbstractSchematic,
  type SchematicLoadOptions,
  checkDeclaredVolume,
} from "./abstract";
import {
  MinecraftVersion,
  getVersion,
  getVersionFromDataVersion,
  posKey,
} from "./version-mapping";
import { flattenRegions } from "./single-region";

// ── Helpers ───────────────────────────────────────────────────────────────

function readInt(tag: nbt.NbtTag | undefined): number {
  if (tag === undefined) return 0;
  const v = (tag as unknown as { value: number | bigint }).value;
  return typeof v === "bigint" ? Number(v) : v;
}

function readString(tag: nbt.NbtTag | undefined): string {
  if (tag instanceof nbt.StringTag) return tag.value;
  return "";
}

function safeGetVersionFromDataVersion(dataVersion: number): MinecraftVersion {
  try {
    return getVersionFromDataVersion(dataVersion);
  } catch {
    return getVersion("1.20.1");
  }
}

/**
 * Pull a `[x, y, z]` triple from either a List of Ints/Floats OR a Compound
 * with `x`/`y`/`z` keys. Structure stores `pos`/`size` as Lists.
 */
function readPosTriple(tag: nbt.NbtTag | undefined): [number, number, number] {
  if (tag instanceof nbt.NbtList) {
    const items = tag.items;
    const coord = (idx: number): number => {
      const item = items[idx];
      if (item === undefined) return 0;
      const v = (item as unknown as { value: number | bigint }).value;
      return typeof v === "bigint" ? Number(v) : v;
    };
    return [coord(0), coord(1), coord(2)];
  }
  if (tag instanceof nbt.Compound) {
    return [
      readInt(tag.get("x")),
      readInt(tag.get("y")),
      readInt(tag.get("z")),
    ];
  }
  return [0, 0, 0];
}

/**
 * Structure files store block entities without `x`/`y`/`z` (the block's `pos`
 * is the position; Minecraft fills them in on load). Tile entities from other
 * formats arrive in chunk shape, in the source's coordinates, so drop them.
 */
function withoutChunkPos(tileEntity: Entity): Entity {
  const c = tileEntity.toCompound();
  if (!c.has("x") && !c.has("y") && !c.has("z")) return tileEntity;
  const out = new nbt.Compound();
  for (const [k, v] of c.entries) {
    if (k !== "x" && k !== "y" && k !== "z") out.set(k, v);
  }
  return new Entity(out);
}

/**
 * The inverse of `withoutChunkPos`: the chunk shape (`x`/`y`/`z` from the
 * block's `pos`) other formats expect when they export our tile entities.
 */
function withChunkPos(tileEntity: Entity, pos: BlockPos): Entity {
  const out = new nbt.Compound();
  for (const [k, v] of tileEntity.toCompound().entries) {
    if (k !== "x" && k !== "y" && k !== "z") out.set(k, v);
  }
  out.set("x", new nbt.Int(pos.x));
  out.set("y", new nbt.Int(pos.y));
  out.set("z", new nbt.Int(pos.z));
  return new Entity(out);
}

function blockStateFromCompound(c: nbt.Compound): BlockState {
  const name = readString(c.get("Name"));
  const propsTag = c.get("Properties");
  const props: Record<string, string> = {};
  if (propsTag instanceof nbt.Compound) {
    for (const [k, v] of propsTag.entries) {
      if (v instanceof nbt.StringTag) props[k] = v.value;
    }
  }
  return new BlockState({ Name: name, Properties: props });
}

function intListFromTriple(
  triple: readonly [number, number, number],
): nbt.NbtList<nbt.Int> {
  return new nbt.NbtList<nbt.Int>([
    new nbt.Int(triple[0]),
    new nbt.Int(triple[1]),
    new nbt.Int(triple[2]),
  ]);
}

// An entity's nested `nbt` keeps the world position it was saved at; the
// record's `pos` and `blockPos` are the structure-relative ones (Minecraft
// overwrites `Pos` with them when it places the structure).
function withRelativePos(record: StructureEntityRecord): Entity {
  const src = record.nbt.toCompound();
  const out = new nbt.Compound();
  for (const [k, v] of src.entries) out.set(k, v);
  out.set(
    "Pos",
    new nbt.NbtList([
      new nbt.Double(record.pos.x),
      new nbt.Double(record.pos.y),
      new nbt.Double(record.pos.z),
    ]),
  );
  for (const [key, value] of [
    ["TileX", record.blockPos.x],
    ["TileY", record.blockPos.y],
    ["TileZ", record.blockPos.z],
  ] as const) {
    if (src.get(key) instanceof nbt.Int) out.set(key, new nbt.Int(value));
  }
  return new Entity(out);
}

function floatListFromTriple(
  triple: readonly [number, number, number],
): nbt.NbtList<nbt.Float> {
  return new nbt.NbtList<nbt.Float>([
    new nbt.Float(triple[0]),
    new nbt.Float(triple[1]),
    new nbt.Float(triple[2]),
  ]);
}

// ── Internal record types ─────────────────────────────────────────────────

interface StructureBlockRecord {
  pos: BlockPos;
  state: number;
  nbt: Entity | null;
}

interface StructureEntityRecord {
  blockPos: BlockPos;
  pos: EntityPos;
  nbt: Entity;
}

// ── StructureSchematic ────────────────────────────────────────────────────

export interface StructureSchematicInit {
  dataVersion: number;
  blocks: StructureBlockRecord[];
  palette: BlockState[];
  entities: StructureEntityRecord[];
  size: BlockPos;
}

export class StructureSchematic extends AbstractRegion {
  readonly dataVersion: number;
  readonly blockRecords: StructureBlockRecord[];
  readonly palette: BlockState[];
  readonly entityRecords: StructureEntityRecord[];
  readonly size: BlockPos;

  constructor(init: StructureSchematicInit) {
    super();
    this.dataVersion = init.dataVersion;
    this.blockRecords = init.blocks;
    this.palette = init.palette;
    this.entityRecords = init.entities;
    this.size = init.size;
  }

  // ── AbstractSchematic static surface ────────────────────────────────────

  static getFormatDescription(): string {
    return "Create schematic / Minecraft structure (.nbt files)";
  }

  static getDefaultExtension(): string {
    return "nbt";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.20.1");
  }

  static schematicLoad(
    obj: string | Uint8Array,
    options?: SchematicLoadOptions,
  ): StructureSchematic {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const root = nbt.loadNbtFromBytes(bytes);
    const [sx, sy, sz] = readPosTriple(root.get("size"));
    checkDeclaredVolume([[sx, sy, sz]], options);

    const dataVersion = readInt(root.get("DataVersion"));

    const paletteTag = root.get("palette");
    const palette: BlockState[] = [];
    if (paletteTag instanceof nbt.NbtList) {
      for (const item of paletteTag.items) {
        if (item instanceof nbt.Compound)
          palette.push(blockStateFromCompound(item));
      }
    }

    const blocksTag = root.get("blocks");
    const blocks: StructureBlockRecord[] = [];
    if (blocksTag instanceof nbt.NbtList) {
      for (const item of blocksTag.items) {
        if (!(item instanceof nbt.Compound)) continue;
        const [x, y, z] = readPosTriple(item.get("pos"));
        const state = readInt(item.get("state"));
        const nbtTag = item.get("nbt");
        const nbtEntity =
          nbtTag instanceof nbt.Compound ? new Entity(nbtTag) : null;
        blocks.push({
          pos: new BlockPos(x, y, z),
          state,
          nbt: nbtEntity,
        });
      }
    }

    const entitiesTag = root.get("entities");
    const entities: StructureEntityRecord[] = [];
    if (entitiesTag instanceof nbt.NbtList) {
      for (const item of entitiesTag.items) {
        if (!(item instanceof nbt.Compound)) continue;
        const [bx, by, bz] = readPosTriple(item.get("blockPos"));
        const [px, py, pz] = readPosTriple(item.get("pos"));
        const entityNbt = item.get("nbt");
        if (!(entityNbt instanceof nbt.Compound)) continue;
        entities.push({
          blockPos: new BlockPos(bx, by, bz),
          pos: new EntityPos(px, py, pz),
          nbt: new Entity(entityNbt),
        });
      }
    }

    return new StructureSchematic({
      dataVersion,
      blocks,
      palette,
      entities,
      size: new BlockPos(sx, sy, sz),
    });
  }

  static fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): StructureSchematic {
    const {
      dataVersion,
      palette: sourcePalette,
      blocks: sourceBlocks,
      entities: sourceEntities,
      tileEntityMatrix: sourceTileEntityMatrix,
      size: [sx, sy, sz],
    } = flattenRegions(schematic, targetVersion);

    const indexOfState = (state: BlockState): number => {
      for (let i = 0; i < sourcePalette.length; i++) {
        if (sourcePalette[i].equals(state)) return i;
      }
      throw new Error(`State ${state.toString()} not found in palette`);
    };

    const blocks: StructureBlockRecord[] = [];
    for (const sourceBlock of sourceBlocks) {
      const key = posKey(sourceBlock.pos);
      const tileEntity = sourceTileEntityMatrix.get(key);
      blocks.push({
        pos: sourceBlock.pos,
        state: indexOfState(sourceBlock.state),
        nbt: tileEntity ? withoutChunkPos(tileEntity) : null,
      });
    }

    const entities: StructureEntityRecord[] = sourceEntities.map((e) => ({
      blockPos: e.blockPos,
      pos: e.pos,
      nbt: e,
    }));

    return new StructureSchematic({
      dataVersion,
      blocks,
      palette: sourcePalette,
      entities,
      size: new BlockPos(sx, sy, sz),
    });
  }

  // ── AbstractSchematic instance surface ──────────────────────────────────

  getMetadata(): Record<string, unknown> {
    return {};
  }

  getName(): string {
    return "unknown nbt structure schematic";
  }

  getRegions(): AbstractRegion[] {
    return [this];
  }

  getRegion(idx: number): AbstractRegion {
    return this.getRegions()[idx];
  }

  getMinecraftVersion(): MinecraftVersion {
    return safeGetVersionFromDataVersion(this.dataVersion);
  }

  getDataVersion(): number {
    return this.dataVersion;
  }

  // ── AbstractRegion surface ──────────────────────────────────────────────

  getOrigin(): BlockPos {
    return BlockPos.ORIGIN;
  }

  getSize(): [number, number, number] {
    return [this.size.x, this.size.y, this.size.z];
  }

  getPalette(): BlockState[] {
    return this.palette;
  }

  getBlockMatrix(): Map<string, Block> {
    const matrix = new Map<string, Block>();
    for (const block of this.blockRecords) {
      const state = this.palette[block.state];
      if (!state) {
        throw new Error(
          `Block at ${posKey(block.pos)} references missing palette index ${block.state}`,
        );
      }
      matrix.set(posKey(block.pos), new Block(block.pos, state));
    }
    return matrix;
  }

  getEntityMatrix(): Map<string, Entity> {
    const matrix = new Map<string, Entity>();
    for (const e of this.entityRecords) {
      matrix.set(posKey(e.pos), withRelativePos(e));
    }
    return matrix;
  }

  getEntities(): Entity[] {
    return this.entityRecords.map(withRelativePos);
  }

  getTileEntityMatrix(): Map<string, Entity> {
    const matrix = new Map<string, Entity>();
    for (const block of this.blockRecords) {
      if (block.nbt) {
        matrix.set(posKey(block.pos), withChunkPos(block.nbt, block.pos));
      }
    }
    return matrix;
  }

  // ── Serialization ───────────────────────────────────────────────────────

  schematicDump(): Uint8Array {
    const blocksList = new nbt.NbtList<nbt.Compound>(
      this.blockRecords.map((block) => {
        const entries = new Map<string, nbt.NbtTag>();
        entries.set(
          "pos",
          intListFromTriple([block.pos.x, block.pos.y, block.pos.z]),
        );
        entries.set("state", new nbt.Int(block.state));
        if (block.nbt) entries.set("nbt", block.nbt.toCompound());
        return new nbt.Compound(entries);
      }),
    );

    const paletteList = new nbt.NbtList<nbt.Compound>(
      this.palette.map((s) => s.toCompound()),
    );

    const entitiesList = new nbt.NbtList<nbt.Compound>(
      this.entityRecords.map(
        (e) =>
          new nbt.Compound({
            blockPos: intListFromTriple([
              e.blockPos.x,
              e.blockPos.y,
              e.blockPos.z,
            ]),
            nbt: e.nbt.toCompound(),
            pos: floatListFromTriple([e.pos.x, e.pos.y, e.pos.z]),
          }),
      ),
    );

    const root = new nbt.Compound({
      DataVersion: new nbt.Int(this.dataVersion),
      blocks: blocksList,
      palette: paletteList,
      entities: entitiesList,
      size: intListFromTriple([this.size.x, this.size.y, this.size.z]),
    });

    const named = new nbt.Named({ "": root });
    return named.toBytes({ compress: true });
  }
}
