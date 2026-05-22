import { describe, it, expect } from "vitest";

import { Block, BlockPos, BlockState } from "../blocks";
import { Entity } from "../entities";
import {
  AbstractRegion,
  AbstractSchematic,
} from "../schematic-formats/abstract";
import {
  getVersion,
  MinecraftVersion,
  posKey,
} from "../schematic-formats/version-mapping";

// ── fauxfactory replacement ────────────────────────────────────────────────
const gen = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// ── DummyRegion / DummySchematic ──────────────────────────────────────────

class DummyRegion extends AbstractRegion {
  getBlockMatrix(): Map<string, Block> {
    throw new Error("NotImplementedError");
  }
  getEntityMatrix(): Map<string, Entity> {
    throw new Error("NotImplementedError");
  }
  getTileEntityMatrix(): Map<string, Entity> {
    throw new Error("NotImplementedError");
  }
  getMinecraftVersion(): MinecraftVersion {
    return getVersion("1.20.1");
  }
  getOrigin(): BlockPos {
    throw new Error("NotImplementedError");
  }
}

class DummySchematic extends AbstractSchematic {
  static override getFormatDescription(): string {
    throw new Error("NotImplementedError");
  }
  static override getDefaultExtension(): string {
    throw new Error("NotImplementedError");
  }
  static override getDefaultVersion(): MinecraftVersion {
    throw new Error("NotImplementedError");
  }
  static override fromSchematic(
    _schematic: AbstractSchematic,
    _targetVersion: MinecraftVersion | null,
  ): AbstractSchematic {
    throw new Error("NotImplementedError");
  }
  static override schematicLoad(_obj: string | Uint8Array): AbstractSchematic {
    throw new Error("NotImplementedError");
  }
  getMetadata(): Record<string, unknown> {
    throw new Error("NotImplementedError");
  }
  getName(): string {
    throw new Error("NotImplementedError");
  }
  getRegions(): AbstractRegion[] {
    throw new Error("NotImplementedError");
  }
  schematicDump(): string | Uint8Array {
    throw new Error("NotImplementedError");
  }
  getMinecraftVersion(): MinecraftVersion {
    throw new Error("NotImplementedError");
  }
}

class RegionWithGetBlocks extends DummyRegion {
  private readonly _blocks: Block[];

  constructor(blocks: Block[]) {
    super();
    this._blocks = blocks;
  }

  override getBlockMatrix(): Map<string, Block> {
    const out = new Map<string, Block>();
    for (const block of this._blocks) {
      out.set(posKey(block.pos), block);
    }
    return out;
  }

  override getOrigin(): BlockPos {
    return new BlockPos(0, 0, 0);
  }
}

const AIR_BLOCK = new Block(
  new BlockPos(0, 0, 0),
  new BlockState({ Name: "minecraft:air" }),
);
const regionWithOneAirBlock = (): RegionWithGetBlocks =>
  new RegionWithGetBlocks([AIR_BLOCK]);

class SchematicWithGetRegions extends DummySchematic {
  private readonly _regions: AbstractRegion[];

  constructor(regions: AbstractRegion[]) {
    super();
    this._regions = regions;
  }

  override getRegions(): AbstractRegion[] {
    return this._regions;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("AbstractSchematic", () => {
  // Skipped: `test_cannot_instantiate_abstract_schematic` — TS abstract is
  // enforced at compile time, not runtime.
  // Skipped: `test_get_translation_manager` — we don't have a translation
  // manager.

  it("schematic_get_region returns the region by index", () => {
    const region = regionWithOneAirBlock();
    const schem = new SchematicWithGetRegions([region]);
    expect(schem.getRegion(0)).toBe(region);
  });

  it("get_block_matrix returns the expected entry", () => {
    const region = regionWithOneAirBlock();
    const schem = new SchematicWithGetRegions([region]);

    const matrix = schem.getRegion(0).getBlockMatrix();
    expect(matrix.size).toBe(1);
    const entry = matrix.get(posKey(new BlockPos(0, 0, 0)));
    expect(entry).toBeDefined();
    expect(entry!.pos.equals(AIR_BLOCK.pos)).toBe(true);
    expect(entry!.state.equals(AIR_BLOCK.state)).toBe(true);
  });

  it("default check_size passes for huge sizes", () => {
    // `1 << 64` in Python is a bigint; in JS we use Number.MAX_SAFE_INTEGER
    // (the test only asserts that the call does not throw).
    expect(() =>
      AbstractSchematic.checkSize(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ),
    ).not.toThrow();
  });

  it("get_palette returns the single block state", () => {
    const schem = new SchematicWithGetRegions([regionWithOneAirBlock()]);
    const palette = schem.getRegion(0).getPalette();
    expect(palette.length).toBe(1);
    expect(palette[0].equals(AIR_BLOCK.state)).toBe(true);
  });

  it("get_size for an empty region is (0, 0, 0)", () => {
    const schem = new SchematicWithGetRegions([new RegionWithGetBlocks([])]);
    expect(schem.getRegion(0).getSize()).toEqual([0, 0, 0]);
  });

  it("get_size for one block is (1, 1, 1)", () => {
    const schem = new SchematicWithGetRegions([regionWithOneAirBlock()]);
    expect(schem.getRegion(0).getSize()).toEqual([1, 1, 1]);
  });

  it("get_size for two random blocks", () => {
    const p0: [number, number, number] = [
      gen(-128, 127),
      gen(-128, 127),
      gen(-128, 127),
    ];
    const p1: [number, number, number] = [
      gen(-128, 127),
      gen(-128, 127),
      gen(-128, 127),
    ];

    const size: [number, number, number] = [
      Math.abs(p0[0] - p1[0]) + 1,
      Math.abs(p0[1] - p1[1]) + 1,
      Math.abs(p0[2] - p1[2]) + 1,
    ];

    const b1 = new Block(
      new BlockPos(p0[0], p0[1], p0[2]),
      new BlockState({ Name: "minecraft:stone" }),
    );
    const b2 = new Block(
      new BlockPos(p1[0], p1[1], p1[2]),
      new BlockState({ Name: "minecraft:stone" }),
    );

    const schem = new SchematicWithGetRegions([
      new RegionWithGetBlocks([b1, b2]),
    ]);
    expect(schem.getRegion(0).getSize()).toEqual(size);
  });

  it("get_bounding_box for an empty region is (ORIGIN, ORIGIN)", () => {
    const schem = new SchematicWithGetRegions([new RegionWithGetBlocks([])]);
    const [a, b] = schem.getRegion(0).getBoundingBox();
    expect(a.equals(BlockPos.ORIGIN)).toBe(true);
    expect(b.equals(BlockPos.ORIGIN)).toBe(true);
  });

  it("get_bounding_box for one block is (ORIGIN, ORIGIN)", () => {
    const schem = new SchematicWithGetRegions([regionWithOneAirBlock()]);
    const [a, b] = schem.getRegion(0).getBoundingBox();
    expect(a.equals(BlockPos.ORIGIN)).toBe(true);
    expect(b.equals(BlockPos.ORIGIN)).toBe(true);
  });

  it("get_bounding_box for two random blocks", () => {
    const p0: [number, number, number] = [
      gen(-128, 0),
      gen(-128, 0),
      gen(-128, 0),
    ];
    const p1: [number, number, number] = [
      gen(0, 127),
      gen(0, 127),
      gen(0, 127),
    ];

    const b1 = new Block(
      new BlockPos(p0[0], p0[1], p0[2]),
      new BlockState({ Name: "minecraft:stone" }),
    );
    const b2 = new Block(
      new BlockPos(p1[0], p1[1], p1[2]),
      new BlockState({ Name: "minecraft:stone" }),
    );

    const schem = new SchematicWithGetRegions([
      new RegionWithGetBlocks([b1, b2]),
    ]);
    const [a, b] = schem.getRegion(0).getBoundingBox();
    expect(a.equals(p0)).toBe(true);
    expect(b.equals(p1)).toBe(true);
  });
});
