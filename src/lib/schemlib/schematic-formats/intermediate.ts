// Port of schemlib/schematic_formats/intermediate.py (Python) -> TypeScript.
//
// `IntermediateRegion` / `IntermediateSchematic` are the in-memory schematic
// representation that other formats translate to/from. Python uses pydantic
// BaseModel; in TS we use plain classes with explicit constructor args and a
// hand-written JSON (de)serializer.

import { Block, BlockPos, BlockState } from "../blocks";
import { Entity } from "../entities";
import * as snbt from "../snbt";
import * as nbt from "../nbt";
import { AbstractRegion, AbstractSchematic } from "./abstract";
import { placeTileEntity, shiftEntity } from "./single-region";
import {
  MinecraftVersion,
  getVersion,
  posKey,
  versionName,
  versionsEqual,
} from "./version-mapping";

// ── IntermediateRegion ────────────────────────────────────────────────────

export class IntermediateRegion extends AbstractRegion {
  constructor(
    public readonly minecraftVersion: MinecraftVersion,
    public readonly origin: BlockPos,
    public readonly size: [number, number, number],
    public blocks: Block[],
    public readonly entities: Entity[] = [],
    public readonly tileEntities: Entity[] = [],
  ) {
    super();
  }

  getMinecraftVersion(): MinecraftVersion {
    return this.minecraftVersion;
  }

  getOrigin(): BlockPos {
    return this.origin;
  }

  // Override AbstractRegion.getSize to return the stored size (which may
  // differ from the bbox-derived size, e.g. when the schematic was padded).
  getSize(): [number, number, number] {
    return [this.size[0], this.size[1], this.size[2]];
  }

  getBlocks(): Block[] {
    return this.blocks;
  }

  getBlockMatrix(): Map<string, Block> {
    const out = new Map<string, Block>();
    for (const b of this.blocks) out.set(posKey(b.pos), b);
    return out;
  }

  getEntityMatrix(): Map<string, Entity> {
    const out = new Map<string, Entity>();
    for (const e of this.entities) out.set(posKey(e.pos), e);
    return out;
  }

  getTileEntityMatrix(): Map<string, Entity> {
    // Tile entities are chunk-shape compounds ({id, x, y, z, ...}), not the
    // entity shape `Entity.blockPos` reads (a `Pos` list). Keying through
    // blockPos put every tile entity at 0,0,0, so only one survived.
    const out = new Map<string, Entity>();
    for (const e of this.tileEntities) {
      const c = e.toCompound();
      const xt = c.get("x");
      const yt = c.get("y");
      const zt = c.get("z");
      const key =
        xt instanceof nbt.Int && yt instanceof nbt.Int && zt instanceof nbt.Int
          ? `${xt.value},${yt.value},${zt.value}`
          : posKey(e.blockPos);
      out.set(key, e);
    }
    return out;
  }

  /**
   * Apply a block remap table. Keys may be either bare block names (e.g.
   * `"minecraft:stone"`) or full state strings (e.g.
   * `"minecraft:oak_log[axis=y]"`); values are replacement state strings.
   *
   * Mirrors Python semantics: prefer Name-only match, fall back to full state.
   */
  mapBlocks(blockMapping: Record<string, string>): void {
    const remapped: Block[] = [];
    for (const block of this.blocks) {
      if (blockMapping[block.state.Name] !== undefined) {
        // Replace the Name but keep Properties.
        const newName = blockMapping[block.state.Name];
        const propsObj: Record<string, string> = {};
        for (const [k, v] of block.state.Properties) propsObj[k] = v;
        block.state = new BlockState({ Name: newName, Properties: propsObj });
      } else if (blockMapping[block.state.toString()] !== undefined) {
        block.state = BlockState.fromString(
          blockMapping[block.state.toString()],
        );
      }
      remapped.push(block);
    }
    this.blocks = remapped;
  }

  static fromRegion(
    region: AbstractRegion,
    targetVersion: MinecraftVersion | null,
  ): IntermediateRegion {
    let blocks: Block[];
    let entities: Entity[];
    let tileEntityMatrix: Map<string, Entity>;
    let minecraftVersion: MinecraftVersion;

    if (
      targetVersion !== null &&
      !versionsEqual(targetVersion, region.getMinecraftVersion())
    ) {
      blocks = region.getTranslatedBlocks(targetVersion);
      entities = region.getTranslatedEntities(targetVersion);
      tileEntityMatrix = region.getTranslatedTileEntityMatrix(targetVersion);
      minecraftVersion = targetVersion;
    } else {
      blocks = region.getBlocks();
      entities = region.getEntities();
      tileEntityMatrix = region.getTileEntityMatrix();
      minecraftVersion = region.getMinecraftVersion();
    }

    let offset: BlockPos;
    if (blocks.length === 0) {
      offset = BlockPos.ORIGIN;
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      for (const b of blocks) {
        if (b.pos.x < minX) minX = b.pos.x;
        if (b.pos.y < minY) minY = b.pos.y;
        if (b.pos.z < minZ) minZ = b.pos.z;
      }
      offset = new BlockPos(minX, minY, minZ);
    }

    // Build a new list of (offset-adjusted, non-air) blocks. We create new
    // Block instances rather than mutating in place — `BlockPos` is readonly
    // and we don't want to surprise the caller by editing their objects.
    const adjusted: Block[] = [];
    for (const block of blocks) {
      if (block.state.Name === "minecraft:air") continue;
      adjusted.push(new Block(block.pos.sub(offset), block.state));
    }

    // Block entities and entities move with the blocks.
    const tileEntities = [...tileEntityMatrix].map(([key, entity]) => {
      const [x, y, z] = key.split(",").map(Number);
      return placeTileEntity(entity, new BlockPos(x, y, z).sub(offset));
    });

    return new IntermediateRegion(
      minecraftVersion,
      // Blocks moved back by `offset`, so the region starts that far along.
      region.getOrigin().add(offset),
      region.getSize(),
      adjusted,
      entities.map((e) => shiftEntity(e, offset)),
      tileEntities,
    );
  }
}

// ── JSON shape ────────────────────────────────────────────────────────────
//
// We define a private wire-format we control. `Block` → `{ pos, state }` with
// state stringified to "minecraft:foo[k=v]" form. Entities are serialized via
// SNBT since they wrap NBT compounds.

interface BlockJson {
  pos: { x: number; y: number; z: number };
  state: string;
}

interface RegionJson {
  minecraftVersion: string; // dotted, e.g. "1.20.1"
  origin: { x: number; y: number; z: number };
  size: [number, number, number];
  blocks: BlockJson[];
  entities: string[]; // snbt strings
  tileEntities: string[]; // snbt strings
}

interface SchematicJson {
  metadata: Record<string, unknown>;
  name: string;
  regions: RegionJson[];
  minecraftVersion: string;
}

// The reader resolves names through `getVersion`, so refuse to write one it
// can't read back.
function jsonVersionName(v: MinecraftVersion): string {
  const name = versionName(v);
  getVersion(name);
  return name;
}

function regionToJson(region: IntermediateRegion): RegionJson {
  return {
    minecraftVersion: jsonVersionName(region.minecraftVersion),
    origin: { x: region.origin.x, y: region.origin.y, z: region.origin.z },
    size: [region.size[0], region.size[1], region.size[2]],
    blocks: region.blocks.map((b) => ({
      pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
      state: b.state.toString(),
    })),
    entities: region.entities.map((e) => snbt.toSnbt(e.toCompound())),
    tileEntities: region.tileEntities.map((e) => snbt.toSnbt(e.toCompound())),
  };
}

function regionFromJson(raw: RegionJson): IntermediateRegion {
  const blocks = raw.blocks.map(
    (b) =>
      new Block(
        new BlockPos(b.pos.x, b.pos.y, b.pos.z),
        BlockState.fromString(b.state),
      ),
  );
  const entities = raw.entities.map((s) => {
    const parsed = snbt.fromSnbt(s);
    if (!(parsed instanceof nbt.Compound)) {
      throw new TypeError("Entity SNBT did not parse to a Compound");
    }
    return new Entity(parsed);
  });
  const tileEntities = raw.tileEntities.map((s) => {
    const parsed = snbt.fromSnbt(s);
    if (!(parsed instanceof nbt.Compound)) {
      throw new TypeError("Tile-entity SNBT did not parse to a Compound");
    }
    return new Entity(parsed);
  });
  return new IntermediateRegion(
    getVersion(raw.minecraftVersion),
    new BlockPos(raw.origin.x, raw.origin.y, raw.origin.z),
    [raw.size[0], raw.size[1], raw.size[2]],
    blocks,
    entities,
    tileEntities,
  );
}

// ── IntermediateSchematic ─────────────────────────────────────────────────

export class IntermediateSchematic extends AbstractSchematic {
  constructor(
    public readonly metadata: Record<string, unknown>,
    public readonly name: string,
    public readonly regions: IntermediateRegion[],
    public readonly minecraftVersion: MinecraftVersion,
  ) {
    super();
  }

  static getDefaultExtension(): string {
    return "json";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.20.1");
  }

  static getFormatDescription(): string {
    return "Generic Intermediate JSON Format";
  }

  getMetadata(): Record<string, unknown> {
    return this.metadata;
  }

  getName(): string {
    return this.name;
  }

  getMinecraftVersion(): MinecraftVersion {
    return this.minecraftVersion;
  }

  getRegions(): IntermediateRegion[] {
    return this.regions;
  }

  static schematicLoad(obj: string | Uint8Array): IntermediateSchematic {
    const text = typeof obj === "string" ? obj : new TextDecoder().decode(obj);
    const raw = JSON.parse(text) as SchematicJson;
    const regions = raw.regions.map(regionFromJson);
    return new IntermediateSchematic(
      raw.metadata,
      raw.name,
      regions,
      getVersion(raw.minecraftVersion),
    );
  }

  schematicDump(): string {
    const out: SchematicJson = {
      metadata: this.metadata,
      name: this.name,
      regions: this.regions.map(regionToJson),
      minecraftVersion: jsonVersionName(this.minecraftVersion),
    };
    // Litematic metadata holds Long timestamps (bigint), which JSON can't.
    return JSON.stringify(out, (key, value: unknown) => {
      if (typeof value !== "bigint") return value;
      if (!Number.isSafeInteger(Number(value))) {
        throw new Error(
          `Metadata value ${key}=${value} is too large to write as JSON`,
        );
      }
      return Number(value);
    });
  }

  static fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): IntermediateSchematic {
    const regions = schematic
      .getRegions()
      .map((r) => IntermediateRegion.fromRegion(r, targetVersion));
    const minecraftVersion = targetVersion ?? schematic.getMinecraftVersion();
    return new IntermediateSchematic(
      schematic.getMetadata(),
      schematic.getName(),
      regions,
      minecraftVersion,
    );
  }
}
