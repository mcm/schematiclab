// Port of schemlib/entities.py (Python) -> TypeScript.
//
// Entity-related types: floating-point positions (EntityPos) and a thin
// wrapper around an NBT Compound that exposes `pos` / `blockPos`.

import * as nbt from "./nbt";
import * as snbt from "./snbt";
import { AbstractPos, BlockPos } from "./blocks";

// ── EntityPos ─────────────────────────────────────────────────────────────

export class EntityPos extends AbstractPos<number> {
  static ORIGIN: EntityPos;

  protected make(x: number, y: number, z: number): this {
    return new (this.constructor as new (x: number, y: number, z: number) => this)(x, y, z);
  }

  static from(tuple: readonly [number, number, number]): EntityPos {
    return new EntityPos(tuple[0], tuple[1], tuple[2]);
  }
}
EntityPos.ORIGIN = new EntityPos(0, 0, 0);

// ── Entity ────────────────────────────────────────────────────────────────

export class Entity {
  static readonly tagTypeId = 10;
  private nbtCompound: nbt.Compound;

  constructor(value: string | nbt.Compound | Record<string, nbt.NbtTag>) {
    if (typeof value === "string") {
      const parsed = snbt.fromSnbt(value);
      if (!(parsed instanceof nbt.Compound)) {
        throw new TypeError("Entity SNBT must parse to a Compound");
      }
      this.nbtCompound = parsed;
    } else if (value instanceof nbt.Compound) {
      this.nbtCompound = value;
    } else {
      this.nbtCompound = new nbt.Compound(value);
    }
  }

  get pos(): EntityPos {
    const posTag = this.nbtCompound.get("Pos");
    if (!(posTag instanceof nbt.NbtList)) {
      return EntityPos.ORIGIN;
    }
    const items = posTag.items;
    if (items.length < 3) return EntityPos.ORIGIN;
    const coord = (idx: number): number => {
      const item = items[idx];
      const v = (item as unknown as { value: number | bigint }).value;
      return typeof v === "bigint" ? Number(v) : v;
    };
    return new EntityPos(coord(0), coord(1), coord(2));
  }

  get blockPos(): BlockPos {
    const p = this.pos;
    return new BlockPos(Math.trunc(p.x), Math.trunc(p.y), Math.trunc(p.z));
  }

  toCompound(): nbt.Compound {
    return this.nbtCompound;
  }

  toBytes(): Uint8Array {
    return this.nbtCompound.toBytes();
  }

  toString(): string {
    return snbt.toSnbt(this.nbtCompound);
  }
}
