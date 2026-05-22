// Port of schemlib/schematic_formats/abstract.py (Python) -> TypeScript.
//
// `AbstractRegion` and `AbstractSchematic` define the contract every concrete
// schematic format implementation must satisfy. Python uses ABCMeta to make
// these uninstantiable; in TS we use the `abstract` keyword for instance
// methods, and have static methods throw at runtime since TS has no notion of
// "abstract static".

import { Block, BlockPos, BlockState } from "../blocks";
import { Entity } from "../entities";
import { MinecraftVersion, MinecraftVersionMapper } from "./version-mapping";
import { fixupDoors } from "../data/translate";

// ── AbstractRegion ────────────────────────────────────────────────────────

export abstract class AbstractRegion {
  abstract getBlockMatrix(): Map<string, Block>;
  abstract getMinecraftVersion(): MinecraftVersion;
  abstract getOrigin(): BlockPos;
  abstract getEntityMatrix(): Map<string, Entity>;
  abstract getTileEntityMatrix(): Map<string, Entity>;

  getBlocks(): Block[] {
    return [...this.getBlockMatrix().values()];
  }

  getEntities(): Entity[] {
    return [...this.getEntityMatrix().values()];
  }

  getTileEntities(): Entity[] {
    return [...this.getTileEntityMatrix().values()];
  }

  getBoundingBox(): [BlockPos, BlockPos] {
    let p0: [number, number, number] | null = null;
    let p1: [number, number, number] | null = null;

    for (const block of this.getBlocks()) {
      const pos = block.pos.astuple();
      if (p0 === null) {
        p0 = [pos[0], pos[1], pos[2]];
      } else {
        p0 = [
          Math.min(p0[0], pos[0]),
          Math.min(p0[1], pos[1]),
          Math.min(p0[2], pos[2]),
        ];
      }
      if (p1 === null) {
        p1 = [pos[0], pos[1], pos[2]];
      } else {
        p1 = [
          Math.max(p1[0], pos[0]),
          Math.max(p1[1], pos[1]),
          Math.max(p1[2], pos[2]),
        ];
      }
    }

    if (p0 === null || p1 === null) {
      return [BlockPos.ORIGIN, BlockPos.ORIGIN];
    }

    return [
      new BlockPos(p0[0], p0[1], p0[2]),
      new BlockPos(p1[0], p1[1], p1[2]),
    ];
  }

  getPalette(): BlockState[] {
    const seen = new Map<string, BlockState>();
    for (const block of this.getBlocks()) {
      const key = block.state.toString();
      if (!seen.has(key)) seen.set(key, block.state);
    }
    return [...seen.values()];
  }

  getSize(): [number, number, number] {
    if (this.getBlocks().length === 0) {
      return [0, 0, 0];
    }
    const [p0, p1] = this.getBoundingBox();
    return [
      Math.abs(p1.x - p0.x) + 1,
      Math.abs(p1.y - p0.y) + 1,
      Math.abs(p1.z - p0.z) + 1,
    ];
  }

  getTranslatedBlocks(targetVersion: MinecraftVersion): Block[] {
    // Delegate through the matrix so we get the cross-block door fixup for
    // free; iteration order matches the matrix.
    return [...this.getTranslatedBlockMatrix(targetVersion).values()];
  }

  getTranslatedBlockMatrix(
    targetVersion: MinecraftVersion,
  ): Map<string, Block> {
    const mapper = new MinecraftVersionMapper(
      this.getBlockMatrix(),
      this.getMinecraftVersion(),
    );
    const out = new Map<string, Block>();
    for (const [k, b] of this.getBlockMatrix()) {
      out.set(k, mapper.mapBlock(b, targetVersion));
    }
    // Cross-block fixup for blocks whose state is split between neighbors
    // (currently: doors, where lower-half facing/open and upper-half
    // hinge/powered need to be copied across the boundary).
    fixupDoors(out);
    return out;
  }

  getTranslatedEntities(_targetVersion: MinecraftVersion): Entity[] {
    return this.getEntities();
  }

  getTranslatedEntityMatrix(
    _targetVersion: MinecraftVersion,
  ): Map<string, Entity> {
    return this.getEntityMatrix();
  }

  getTranslatedTileEntities(_targetVersion: MinecraftVersion): Entity[] {
    return this.getTileEntities();
  }

  getTranslatedTileEntityMatrix(
    _targetVersion: MinecraftVersion,
  ): Map<string, Entity> {
    return this.getTileEntityMatrix();
  }

  getTranslatedPalette(targetVersion: MinecraftVersion): BlockState[] {
    const seen = new Map<string, BlockState>();
    for (const block of this.getTranslatedBlocks(targetVersion)) {
      const key = block.state.toString();
      if (!seen.has(key)) seen.set(key, block.state);
    }
    return [...seen.values()];
  }
}

// ── AbstractSchematic ─────────────────────────────────────────────────────
//
// TS has no notion of "abstract static", so each static method throws at
// runtime; subclasses are expected to override them.

export abstract class AbstractSchematic {
  static getFormatDescription(): string {
    throw new Error("AbstractSchematic.getFormatDescription is abstract");
  }

  static getDefaultExtension(): string {
    throw new Error("AbstractSchematic.getDefaultExtension is abstract");
  }

  static getDefaultVersion(): MinecraftVersion {
    throw new Error("AbstractSchematic.getDefaultVersion is abstract");
  }

  static schematicLoad(_obj: string | Uint8Array): AbstractSchematic {
    throw new Error("AbstractSchematic.schematicLoad is abstract");
  }

  static fromSchematic(
    _schematic: AbstractSchematic,
    _targetVersion: MinecraftVersion | null,
  ): AbstractSchematic {
    throw new Error("AbstractSchematic.fromSchematic is abstract");
  }

  abstract getMetadata(): Record<string, unknown>;
  abstract getName(): string;
  abstract schematicDump(): string | Uint8Array;
  abstract getMinecraftVersion(): MinecraftVersion;
  abstract getRegions(): AbstractRegion[];

  /**
   * The raw on-disk DataVersion of this schematic, if it has one. The default
   * implementation derives it from getMinecraftVersion(), which is lossy for
   * formats whose stored DataVersion isn't in `KNOWN_VERSIONS`. Subclasses
   * that persist a `DataVersion` field SHOULD override this to return the raw
   * int so cross-format conversion can round-trip future / unknown versions.
   */
  getDataVersion(): number {
    return this.getMinecraftVersion().dataVersion;
  }

  getRegion(idx: number): AbstractRegion {
    return this.getRegions()[idx];
  }

  static checkSize(_width: number, _height: number, _length: number): void {
    // Subclasses may impose per-format size limits.
  }
}
