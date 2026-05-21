// Port of schemlib/blocks.py (Python) -> TypeScript.
//
// Block-related types: positions (BlockPos), block states (BlockState), and
// the Block wrapper that pairs a position with a state.

import * as nbt from "./nbt";

// ── AbstractPos ───────────────────────────────────────────────────────────
//
// A simple 3-tuple base class. The Python version uses pydantic generics + a
// model validator that accepts tuples; in TS we use a base class with an
// abstract `make` factory so subclasses can return their concrete type from
// arithmetic helpers like `.add()` / `.sub()`.

export type PosTuple<T extends number | bigint> = readonly [T, T, T];

export abstract class AbstractPos<T extends number | bigint> {
  constructor(
    public readonly x: T,
    public readonly y: T,
    public readonly z: T,
  ) {}

  astuple(): [T, T, T] {
    return [this.x, this.y, this.z];
  }

  protected abstract make(x: T, y: T, z: T): this;

  add(other: AbstractPos<T> | PosTuple<T>): this {
    const [ox, oy, oz] = other instanceof AbstractPos ? other.astuple() : other;
    // T is constrained to `number | bigint`; both support `+`/`-` and yield
    // the same primitive type. We cast through `unknown` to satisfy TS, which
    // can't narrow the union to a single arithmetic operator signature.
    return this.make(
      ((this.x as unknown as number) + (ox as unknown as number)) as unknown as T,
      ((this.y as unknown as number) + (oy as unknown as number)) as unknown as T,
      ((this.z as unknown as number) + (oz as unknown as number)) as unknown as T,
    );
  }

  sub(other: AbstractPos<T> | PosTuple<T>): this {
    const [ox, oy, oz] = other instanceof AbstractPos ? other.astuple() : other;
    return this.make(
      ((this.x as unknown as number) - (ox as unknown as number)) as unknown as T,
      ((this.y as unknown as number) - (oy as unknown as number)) as unknown as T,
      ((this.z as unknown as number) - (oz as unknown as number)) as unknown as T,
    );
  }

  equals(other: unknown): boolean {
    if (other instanceof AbstractPos) {
      return this.x === other.x && this.y === other.y && this.z === other.z;
    }
    if (Array.isArray(other) && other.length === 3) {
      return this.x === other[0] && this.y === other[1] && this.z === other[2];
    }
    return false;
  }

  toString(): string {
    return `${this.constructor.name}(x=${this.x}, y=${this.y}, z=${this.z})`;
  }
}

// ── BlockPos ──────────────────────────────────────────────────────────────

export class BlockPos extends AbstractPos<number> {
  static ORIGIN: BlockPos;

  protected make(x: number, y: number, z: number): this {
    return new (this.constructor as new (x: number, y: number, z: number) => this)(x, y, z);
  }

  /** Construct from a `[x, y, z]` tuple — mirrors `BlockPos.model_validate((0,0,0))`. */
  static from(tuple: PosTuple<number>): BlockPos {
    return new BlockPos(tuple[0], tuple[1], tuple[2]);
  }
}
BlockPos.ORIGIN = new BlockPos(0, 0, 0);

// ── BlockState ────────────────────────────────────────────────────────────

const BLOCKSTATE_RE = /^(\w+:\w+)(?:\[(.+?)?\])?$/;

export interface BlockStateOptions {
  Name: string | nbt.StringTag;
  Properties?:
    | Record<string, string | nbt.StringTag>
    | Map<string, string | nbt.StringTag>;
}

export class BlockState {
  readonly Name: string;
  readonly Properties: Map<string, string>;
  static AIR_BLOCK: BlockState;

  constructor(opts: BlockStateOptions) {
    this.Name = opts.Name instanceof nbt.StringTag ? opts.Name.value : opts.Name;

    const props = new Map<string, string>();
    const src = opts.Properties;
    if (src) {
      const entries =
        src instanceof Map
          ? Array.from(src.entries())
          : Object.entries(src);
      for (const [k, v] of entries) {
        props.set(k, v instanceof nbt.StringTag ? v.value : v);
      }
    }
    this.Properties = props;
  }

  static fromString(s: string): BlockState {
    const m = BLOCKSTATE_RE.exec(s);
    if (m === null) {
      throw new Error(`${s} is an invalid blockstate representation`);
    }
    const name = m[1];
    const propsStr = m[2];

    const properties: Record<string, string> = {};
    if (propsStr) {
      for (const p of propsStr.split(",")) {
        const trimmed = p.trim();
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq);
        let v = trimmed.slice(eq + 1);
        // Strip surrounding double-quotes (matches Python's `v.strip('"')`).
        v = v.replace(/^"+|"+$/g, "");
        properties[k] = v;
      }
    }

    return new BlockState({ Name: name, Properties: properties });
  }

  toString(): string {
    if (this.Properties.size === 0) {
      return this.Name;
    }
    const keys = Array.from(this.Properties.keys()).sort();
    const propsStr = keys.map((k) => `${k}=${this.Properties.get(k)}`).join(",");
    return `${this.Name}[${propsStr}]`;
  }

  equals(other: unknown): boolean {
    if (typeof other === "string") {
      return this.equals(BlockState.fromString(other));
    }
    if (!(other instanceof BlockState)) return false;
    if (this.Name !== other.Name) return false;
    if (this.Properties.size !== other.Properties.size) return false;
    for (const [k, v] of this.Properties) {
      if (other.Properties.get(k) !== v) return false;
    }
    return true;
  }

  toCompound(): nbt.Compound {
    const entries = new Map<string, nbt.NbtTag>();
    entries.set("Name", new nbt.StringTag(this.Name));
    if (this.Properties.size > 0) {
      const propEntries = new Map<string, nbt.NbtTag>();
      for (const [k, v] of this.Properties) {
        propEntries.set(k, new nbt.StringTag(v));
      }
      entries.set("Properties", new nbt.Compound(propEntries));
    }
    return new nbt.Compound(entries);
  }
}
BlockState.AIR_BLOCK = new BlockState({ Name: "minecraft:air" });

// ── Block ─────────────────────────────────────────────────────────────────

export class Block {
  constructor(
    public pos: BlockPos,
    public state: BlockState,
  ) {}

  get name(): string {
    return this.state.Name;
  }
}
