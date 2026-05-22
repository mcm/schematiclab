// Port of schemlib/schematic_formats/__init__.py `get_schematic_type` (Python)
// -> TypeScript.
//
// Sniff a raw schematic blob (string or bytes) and identify its format. The
// Python version tries JSON, then NBT, then SNBT, and inspects the resulting
// object for distinguishing keys. We mirror that exactly.

import * as nbt from "../nbt";
import * as snbt from "../snbt";

// What's the "shape" the detector is inspecting? After parsing, it's either a
// plain object (from JSON), an NBT root (`Named` — has a `name` field and is
// itself a `Compound`), an NBT `Compound`, or any other parsed `NbtTag` from
// SNBT.

type Parsed =
  | { kind: "json"; value: Record<string, unknown> }
  | { kind: "nbt"; value: nbt.Named }
  | { kind: "snbt"; value: nbt.NbtTag };

function has(parsed: Parsed, key: string): boolean {
  if (parsed.kind === "json") {
    return Object.prototype.hasOwnProperty.call(parsed.value, key);
  }
  // For NBT (both `Named` and arbitrary tags) check Compound.has if available.
  const v = parsed.value;
  if (v instanceof nbt.Compound) return v.has(key);
  return false;
}

function tryParseJson(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function tryParseNbt(bytes: Uint8Array): nbt.Named | null {
  try {
    return nbt.loadNbtFromBytes(bytes);
  } catch {
    return null;
  }
}

function tryParseSnbt(input: string): nbt.NbtTag | null {
  try {
    return snbt.fromSnbt(input);
  } catch {
    return null;
  }
}

function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input === "string") return new TextEncoder().encode(input);
  return input;
}

function toText(input: string | Uint8Array): string {
  if (typeof input === "string") return input;
  return new TextDecoder().decode(input);
}

/**
 * Detect the schematic format of a serialized blob.
 *
 * Returns one of: `"BuildingGadgets[1.14.4-1.19.3]"`,
 * `"BuildingGadgets[1.12]"`, `"BuildingGadgets2[1.20+]"`, `"JSON"`,
 * `"Litematic"`, `"StructurizeBlueprint"`, `"Sponge[v1]"`, `"Sponge[v2]"`,
 * `"Sponge[v3]"`, or `"Structure"`. Throws `TypeError` if the input cannot be
 * parsed or doesn't match any known format.
 */
export function detectSchematicType(input: string | Uint8Array): string {
  let parsed: Parsed | null = null;

  // 1. Try JSON.
  const jsonResult = tryParseJson(toText(input));
  if (jsonResult !== null) {
    parsed = { kind: "json", value: jsonResult };
  }

  // 2. Try NBT (gzip-aware load).
  if (parsed === null) {
    const nbtResult = tryParseNbt(toBytes(input));
    if (nbtResult !== null) {
      parsed = { kind: "nbt", value: nbtResult };
    }
  }

  // 3. Try SNBT.
  if (parsed === null) {
    const snbtResult = tryParseSnbt(toText(input));
    if (snbtResult !== null) {
      parsed = { kind: "snbt", value: snbtResult };
    }
  }

  if (parsed === null) {
    throw new TypeError("Unable to parse input as JSON, NBT, or SNBT");
  }

  // BuildingGadgets variants are kind-sensitive.
  if (parsed.kind === "json" && has(parsed, "header")) {
    return "BuildingGadgets[1.14.4-1.19.3]";
  }
  if (parsed.kind === "snbt" && has(parsed, "stateIntArray")) {
    return "BuildingGadgets[1.12]";
  }
  if (parsed.kind === "json" && has(parsed, "statePosArrayList")) {
    return "BuildingGadgets2[1.20+]";
  }

  // Our own intermediate JSON format.
  if (parsed.kind === "json" && has(parsed, "minecraft_version")) {
    return "JSON";
  }

  if (parsed.kind === "nbt" && has(parsed, "Regions")) {
    return "Litematic";
  }

  if (parsed.kind === "nbt" && has(parsed, "required_mods")) {
    return "StructurizeBlueprint";
  }

  if (parsed.kind === "nbt" && parsed.value.name === "Schematic") {
    const versionTag = parsed.value.get("Version");
    if (versionTag === undefined) {
      throw new Error("Sponge schematic missing 'Version' tag");
    }
    const version = versionTag.toObject();
    return `Sponge[v${version}]`;
  }

  // Sponge v3 wraps everything in a child "Schematic" compound under an
  // unnamed root (v3 spec §Format), unlike v1/v2 which name the root itself.
  if (parsed.kind === "nbt" && parsed.value.has("Schematic")) {
    const inner = parsed.value.get("Schematic");
    if (inner instanceof nbt.Compound) {
      const versionTag = inner.get("Version");
      if (versionTag === undefined) {
        throw new Error("Sponge schematic missing 'Version' tag");
      }
      const version = versionTag.toObject();
      return `Sponge[v${version}]`;
    }
  }

  if (
    parsed.kind === "nbt" &&
    has(parsed, "blocks") &&
    has(parsed, "DataVersion")
  ) {
    return "Structure";
  }

  throw new TypeError("Unrecognized schematic format");
}
