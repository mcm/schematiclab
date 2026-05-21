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
import { AbstractRegion, AbstractSchematic } from "./abstract";
import {
  MinecraftVersion,
  getVersion,
  getVersionFromDataVersion,
  posKey,
  versionsEqual,
} from "./version-mapping";

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
    return [readInt(tag.get("x")), readInt(tag.get("y")), readInt(tag.get("z"))];
  }
  return [0, 0, 0];
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

function intListFromTriple(triple: readonly [number, number, number]): nbt.NbtList<nbt.Int> {
  return new nbt.NbtList<nbt.Int>([
    new nbt.Int(triple[0]),
    new nbt.Int(triple[1]),
    new nbt.Int(triple[2]),
  ]);
}

function floatListFromTriple(triple: readonly [number, number, number]): nbt.NbtList<nbt.Float> {
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

  static schematicLoad(obj: string | Uint8Array): StructureSchematic {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const root = nbt.loadNbtFromBytes(bytes);

    const dataVersion = readInt(root.get("DataVersion"));

    const paletteTag = root.get("palette");
    const palette: BlockState[] = [];
    if (paletteTag instanceof nbt.NbtList) {
      for (const item of paletteTag.items) {
        if (item instanceof nbt.Compound) palette.push(blockStateFromCompound(item));
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

    const [sx, sy, sz] = readPosTriple(root.get("size"));

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
    const regions = schematic.getRegions();
    if (regions.length > 1) {
      throw new Error(`Too many regions in source schematic (${regions.length})`);
    }
    const region = schematic.getRegion(0);

    let dataVersion: number;
    let sourcePalette: BlockState[];
    let sourceBlocks: Block[];
    let sourceEntities: Entity[];
    let sourceTileEntityMatrix: Map<string, Entity>;

    if (targetVersion !== null && !versionsEqual(targetVersion, region.getMinecraftVersion())) {
      dataVersion = targetVersion.dataVersion;
      sourcePalette = region.getTranslatedPalette(targetVersion);
      sourceBlocks = region.getTranslatedBlocks(targetVersion);
      sourceEntities = region.getTranslatedEntities(targetVersion);
      sourceTileEntityMatrix = region.getTranslatedTileEntityMatrix(targetVersion);
    } else {
      dataVersion = (targetVersion ?? region.getMinecraftVersion()).dataVersion;
      sourcePalette = region.getPalette();
      sourceBlocks = region.getBlocks();
      sourceEntities = region.getEntities();
      sourceTileEntityMatrix = region.getTileEntityMatrix();
    }

    const indexOfState = (state: BlockState): number => {
      for (let i = 0; i < sourcePalette.length; i++) {
        if (sourcePalette[i].equals(state)) return i;
      }
      throw new Error(`State ${state.toString()} not found in palette`);
    };

    const blocks: StructureBlockRecord[] = [];
    for (const sourceBlock of sourceBlocks) {
      const key = posKey(sourceBlock.pos);
      const tileEntity = sourceTileEntityMatrix.get(key) ?? null;
      blocks.push({
        pos: sourceBlock.pos,
        state: indexOfState(sourceBlock.state),
        nbt: tileEntity,
      });
    }

    const entities: StructureEntityRecord[] = sourceEntities.map((e) => ({
      blockPos: e.blockPos,
      pos: e.pos,
      nbt: e,
    }));

    const [sx, sy, sz] = region.getSize();

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
        throw new Error(`Block at ${posKey(block.pos)} references missing palette index ${block.state}`);
      }
      matrix.set(posKey(block.pos), new Block(block.pos, state));
    }
    return matrix;
  }

  getEntityMatrix(): Map<string, Entity> {
    const matrix = new Map<string, Entity>();
    for (const e of this.entityRecords) {
      matrix.set(posKey(e.pos), e.nbt);
    }
    return matrix;
  }

  getEntities(): Entity[] {
    return this.entityRecords.map((e) => e.nbt);
  }

  getTileEntityMatrix(): Map<string, Entity> {
    const matrix = new Map<string, Entity>();
    for (const block of this.blockRecords) {
      if (block.nbt) matrix.set(posKey(block.pos), block.nbt);
    }
    return matrix;
  }

  // ── Serialization ───────────────────────────────────────────────────────

  schematicDump(): Uint8Array {
    const blocksList = new nbt.NbtList<nbt.Compound>(
      this.blockRecords.map((block) => {
        const entries = new Map<string, nbt.NbtTag>();
        entries.set("pos", intListFromTriple([block.pos.x, block.pos.y, block.pos.z]));
        entries.set("state", new nbt.Int(block.state));
        if (block.nbt) entries.set("nbt", block.nbt.toCompound());
        return new nbt.Compound(entries);
      }),
    );

    const paletteList = new nbt.NbtList<nbt.Compound>(
      this.palette.map((s) => s.toCompound()),
    );

    const entitiesList = new nbt.NbtList<nbt.Compound>(
      this.entityRecords.map((e) =>
        new nbt.Compound({
          blockPos: intListFromTriple([e.blockPos.x, e.blockPos.y, e.blockPos.z]),
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
