// Port of schemlib/schematic_formats/building_gadgets/common.py (Python) -> TypeScript.
//
// Building Gadgets stores block positions inside NBT compounds with uppercase
// keys ("X", "Y", "Z"). The Python source defines `BGBlockPos`, a BlockPos
// subclass with a pydantic validator that accepts either case. In TS we don't
// need a subclass — we expose:
//
//   - `readUppercasePos(compound)` — accepts a Compound whose entries use
//     either uppercase or lowercase x/y/z and returns a BlockPos.
//   - `posToUppercaseCompound(pos)` — emits a Compound with `{X, Y, Z}` keys
//     for serialization.

import * as nbt from "../../nbt";
import { BlockPos } from "../../blocks";

function readIntFromTag(tag: nbt.NbtTag | undefined): number {
  if (tag === undefined) return 0;
  const v = (tag as unknown as { value: number | bigint }).value;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  return 0;
}

/**
 * Read a BlockPos from a Compound that may use either lowercase (`x/y/z`) or
 * uppercase (`X/Y/Z`) keys. Mirrors Python `BGBlockPos.upper_case_compound_keys`.
 */
export function readUppercasePos(tag: nbt.NbtTag | undefined): BlockPos {
  if (!(tag instanceof nbt.Compound)) return BlockPos.ORIGIN;
  const xTag = tag.get("x") ?? tag.get("X");
  const yTag = tag.get("y") ?? tag.get("Y");
  const zTag = tag.get("z") ?? tag.get("Z");
  return new BlockPos(
    readIntFromTag(xTag),
    readIntFromTag(yTag),
    readIntFromTag(zTag),
  );
}

/**
 * Serialize a BlockPos to a Compound with uppercase keys, matching
 * Python `BGBlockPos.model_dump_nbt`.
 */
export function posToUppercaseCompound(pos: BlockPos): nbt.Compound {
  return new nbt.Compound({
    X: new nbt.Int(pos.x),
    Y: new nbt.Int(pos.y),
    Z: new nbt.Int(pos.z),
  });
}
