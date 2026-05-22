// Port of schemlib/schematic_formats/building_gadgets/building_gadgets_v0.py
// (Python) -> TypeScript.
//
// Building Gadgets v0 is the Minecraft-1.12-era template format. Wire format:
// SNBT (text). The root compound holds:
//   - stateIntArray  (IntArray): per-position indices into mapIntState
//   - posIntArray    (IntArray): per-position 24-bit packed positions
//   - startPos/endPos (Compound with uppercase X/Y/Z keys)
//   - dim             (Int): dimension id
//   - mapIntState    (List<Compound{mapSlot: Short, mapState: BlockState}>)

import * as nbt from "../../nbt";
import { Block, BlockPos, BlockState } from "../../blocks";
import { Entity } from "../../entities";
import { fromSnbt, toSnbt } from "../../snbt";
import { AbstractRegion, AbstractSchematic } from "../abstract";
import {
  MinecraftVersion,
  getVersion,
  posKey,
} from "../version-mapping";
import { posToUppercaseCompound, readUppercasePos } from "./common";

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Decode a 24-bit packed position into a BlockPos.
 *
 * Ports Python `get_pos_for_int`: each byte is interpreted as a signed 8-bit
 * value. Bits are laid out as `xxxxxxxx yyyyyyyy zzzzzzzz` (high to low).
 */
export function decodePackedPos(packed: number): BlockPos {
  let x = (packed & 0xff0000) >> 16;
  if (x & 0x80) x -= 0x100;
  let y = (packed & 0x00ff00) >> 8;
  if (y & 0x80) y -= 0x100;
  let z = packed & 0xff;
  if (z & 0x80) z -= 0x100;
  return new BlockPos(x, y, z);
}

/** Inverse of `decodePackedPos` — pack a BlockPos back into a 24-bit int. */
export function encodePackedPos(pos: BlockPos): number {
  return ((pos.x & 0xff) << 16) | ((pos.y & 0xff) << 8) | (pos.z & 0xff);
}

function blockStateFromCompound(c: nbt.Compound): BlockState {
  const nameTag = c.get("Name");
  const name = nameTag instanceof nbt.StringTag ? nameTag.value : "";
  const props: Record<string, string> = {};
  const propsTag = c.get("Properties");
  if (propsTag instanceof nbt.Compound) {
    for (const [k, v] of propsTag.entries) {
      if (v instanceof nbt.StringTag) props[k] = v.value;
    }
  }
  return new BlockState({ Name: name, Properties: props });
}

// ── BuildingGadgetsV0MapIntState ──────────────────────────────────────────

export interface BuildingGadgetsV0MapIntStateInit {
  mapSlot: number;
  mapState: BlockState;
}

export class BuildingGadgetsV0MapIntState {
  readonly mapSlot: number;
  readonly mapState: BlockState;

  constructor(init: BuildingGadgetsV0MapIntStateInit) {
    this.mapSlot = init.mapSlot;
    this.mapState = init.mapState;
  }

  static fromCompound(c: nbt.Compound): BuildingGadgetsV0MapIntState {
    const slotTag = c.get("mapSlot");
    const stateTag = c.get("mapState");
    const mapSlot =
      slotTag instanceof nbt.Short || slotTag instanceof nbt.Int
        ? slotTag.value
        : 0;
    const mapState =
      stateTag instanceof nbt.Compound
        ? blockStateFromCompound(stateTag)
        : new BlockState({ Name: "minecraft:air" });
    return new BuildingGadgetsV0MapIntState({ mapSlot, mapState });
  }

  toCompound(): nbt.Compound {
    return new nbt.Compound({
      mapSlot: new nbt.Short(this.mapSlot),
      mapState: this.mapState.toCompound(),
    });
  }
}

// ── BuildingGadgetsV0Schematic ────────────────────────────────────────────

export interface BuildingGadgetsV0SchematicInit {
  stateIntArray: number[];
  dim: number;
  posIntArray: number[];
  startPos: BlockPos;
  endPos: BlockPos;
  mapIntState: BuildingGadgetsV0MapIntState[];
}

export class BuildingGadgetsV0Schematic
  extends AbstractRegion
  implements AbstractSchematic
{
  readonly stateIntArray: number[];
  readonly dim: number;
  readonly posIntArray: number[];
  readonly startPos: BlockPos;
  readonly endPos: BlockPos;
  readonly mapIntState: BuildingGadgetsV0MapIntState[];

  constructor(init: BuildingGadgetsV0SchematicInit) {
    super();
    this.stateIntArray = init.stateIntArray;
    this.dim = init.dim;
    this.posIntArray = init.posIntArray;
    this.startPos = init.startPos;
    this.endPos = init.endPos;
    this.mapIntState = init.mapIntState;
  }

  // ── Format metadata ────────────────────────────────────────────────────

  static getFormatDescription(): string {
    return "Building Gadgets (Minecraft 1.12) Template";
  }

  static getDefaultExtension(): string {
    return "txt";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.12.2");
  }

  // ── Load / dump ────────────────────────────────────────────────────────

  static schematicLoad(obj: string | Uint8Array): BuildingGadgetsV0Schematic {
    const text =
      typeof obj === "string" ? obj : new TextDecoder("utf-8").decode(obj);
    const root = fromSnbt(text);
    if (!(root instanceof nbt.Compound)) {
      throw new TypeError(
        "Building Gadgets v0 SNBT must parse to a Compound",
      );
    }

    const stateIntArrayTag = root.get("stateIntArray");
    if (!(stateIntArrayTag instanceof nbt.IntArray)) {
      throw new TypeError("BG v0: stateIntArray must be IntArray");
    }
    const stateIntArray = stateIntArrayTag.toObject() as number[];

    const posIntArrayTag = root.get("posIntArray");
    if (!(posIntArrayTag instanceof nbt.IntArray)) {
      throw new TypeError("BG v0: posIntArray must be IntArray");
    }
    const posIntArray = posIntArrayTag.toObject() as number[];

    const dimTag = root.get("dim");
    const dim =
      dimTag instanceof nbt.Int || dimTag instanceof nbt.Short
        ? dimTag.value
        : 0;

    const startPos = readUppercasePos(root.get("startPos"));
    const endPos = readUppercasePos(root.get("endPos"));

    const mapIntState: BuildingGadgetsV0MapIntState[] = [];
    const mapIntStateTag = root.get("mapIntState");
    if (mapIntStateTag instanceof nbt.NbtList) {
      for (const item of mapIntStateTag.items) {
        if (item instanceof nbt.Compound) {
          mapIntState.push(BuildingGadgetsV0MapIntState.fromCompound(item));
        }
      }
    }

    return new BuildingGadgetsV0Schematic({
      stateIntArray,
      dim,
      posIntArray,
      startPos,
      endPos,
      mapIntState,
    });
  }

  toCompound(): nbt.Compound {
    return new nbt.Compound({
      stateIntArray: new nbt.IntArray(this.stateIntArray),
      dim: new nbt.Int(this.dim),
      posIntArray: new nbt.IntArray(this.posIntArray),
      startPos: posToUppercaseCompound(this.startPos),
      endPos: posToUppercaseCompound(this.endPos),
      mapIntState: new nbt.NbtList(this.mapIntState.map((m) => m.toCompound())),
    });
  }

  schematicDump(): string {
    return toSnbt(this.toCompound());
  }

  // ── Region API ─────────────────────────────────────────────────────────

  getBlockMatrix(): Map<string, Block> {
    const palette = new Map<number, BlockState>();
    for (const entry of this.mapIntState) {
      palette.set(entry.mapSlot, entry.mapState);
    }

    if (this.posIntArray.length === 0) {
      return new Map();
    }

    const positions = this.posIntArray.map(decodePackedPos);
    const offsetX = Math.min(...positions.map((p) => p.x));
    const offsetY = Math.min(...positions.map((p) => p.y));
    const offsetZ = Math.min(...positions.map((p) => p.z));

    const blocks = new Map<string, Block>();
    for (let idx = 0; idx < this.posIntArray.length; idx++) {
      const decoded = positions[idx];
      const pos = new BlockPos(
        decoded.x - offsetX,
        decoded.y - offsetY,
        decoded.z - offsetZ,
      );
      const stateIdx = this.stateIntArray[idx];
      const state = palette.get(stateIdx);
      if (!state) continue;
      blocks.set(posKey(pos), new Block(pos, state));
    }
    return blocks;
  }

  getEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getTileEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getOrigin(): BlockPos {
    return BlockPos.ORIGIN;
  }

  // ── Schematic API ──────────────────────────────────────────────────────

  getMetadata(): Record<string, unknown> {
    return {};
  }

  getName(): string {
    return "unknown 1.12 building gadgets template";
  }

  getRegions(): AbstractRegion[] {
    return [this];
  }

  getRegion(idx: number): AbstractRegion {
    return this.getRegions()[idx];
  }

  getMinecraftVersion(): MinecraftVersion {
    return getVersion("1.12.2");
  }

  getDataVersion(): number {
    return this.getMinecraftVersion().dataVersion;
  }

  static checkSize(_width: number, _height: number, _length: number): void {
    // No explicit size limit in Python.
  }

  static fromSchematic(
    _schematic: AbstractSchematic,
    _targetVersion: MinecraftVersion | null,
  ): BuildingGadgetsV0Schematic {
    throw new Error("not implemented");
  }
}
