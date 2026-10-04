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
//   - `templateVersion(...)` — picks the version a template is written in.

import * as nbt from "../../nbt";
import { BlockPos } from "../../blocks";
import {
  KNOWN_VERSIONS,
  MinecraftVersion,
  compareVersions,
  versionName,
} from "../version-mapping";

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
 * `readUppercasePos` for a schematic's bounds, which must be present: a
 * missing or partial position would read as the origin and make the declared
 * size look tiny. Each coordinate must be a whole number JavaScript holds
 * exactly (no fractional Float/Double, no Long past 2^53), or the bounds'
 * span and origin would be silently rounded.
 */
export function readRequiredUppercasePos(
  tag: nbt.NbtTag | undefined,
  what: string,
): BlockPos {
  const complete =
    tag instanceof nbt.Compound &&
    ["x", "y", "z"].every((key) => {
      const coord = tag.get(key) ?? tag.get(key.toUpperCase());
      const value = (coord as { value?: unknown } | undefined)?.value;
      return (
        (typeof value === "number" || typeof value === "bigint") &&
        // A Long past 2^53 converts to a Number that isn't a safe integer.
        Number.isSafeInteger(Number(value))
      );
    });
  if (!complete) throw new Error(`${what} is missing or invalid`);
  return readUppercasePos(tag);
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

// ── Output version ────────────────────────────────────────────────────────
//
// Each Building Gadgets template format belongs to a range of Minecraft
// versions. Not a port: the Python writers took the target version as given.

export interface VersionRange {
  /** Format name for error messages. */
  label: string;
  min: readonly [number, number, number];
  /** Newest version, or null for no upper bound. */
  max: readonly [number, number, number] | null;
}

function asVersion(v: readonly [number, number, number]): MinecraftVersion {
  return { platform: "java", versionNumber: v, dataVersion: 0 };
}

function tupleName(v: readonly [number, number, number]): string {
  return v[2] === 0 ? `${v[0]}.${v[1]}` : v.join(".");
}

/**
 * The version a template is written in: `targetVersion`, which must be inside
 * `range`, else the source's version moved into the range (to the oldest
 * known version for older sources, the newest for newer ones).
 */
export function templateVersion(
  range: VersionRange,
  sourceVersion: MinecraftVersion,
  targetVersion: MinecraftVersion | null,
): MinecraftVersion {
  const min = asVersion(range.min);
  const max = range.max === null ? null : asVersion(range.max);
  const fits = (v: MinecraftVersion): boolean =>
    compareVersions(v, min) >= 0 &&
    (max === null || compareVersions(v, max) <= 0);
  const known = Object.values(KNOWN_VERSIONS)
    .filter(fits)
    .sort(compareVersions);
  const oldest = known[0];
  const newest = known[known.length - 1];

  if (targetVersion !== null) {
    if (fits(targetVersion)) return targetVersion;
    const span =
      range.max === null
        ? `${tupleName(range.min)} or newer`
        : compareVersions(min, asVersion(range.max)) === 0
          ? tupleName(range.min)
          : `${tupleName(range.min)} to ${tupleName(range.max)}`;
    throw new Error(
      `${range.label} templates are for Minecraft ${span}, not ${versionName(targetVersion)}`,
    );
  }
  if (fits(sourceVersion)) return sourceVersion;
  return compareVersions(sourceVersion, oldest) < 0 ? oldest : newest;
}
