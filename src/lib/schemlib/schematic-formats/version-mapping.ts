// Port of schemlib/schematic_formats/version_mapping.py (Python) -> TypeScript.
//
// Python uses PyMCTranslate's `Version` object and a `MinecraftVersionMapper`
// that delegates to amulet-nbt / PyMCTranslate for actual block-state
// translation between Minecraft versions. We do NOT have that infrastructure
// in JS yet, so this module is a STUB: it defines the shape of a
// `MinecraftVersion`, a hard-coded table of known versions, and a
// `MinecraftVersionMapper` whose `mapBlock` is a no-op.
//
// A real implementation would need a block-state translation database
// (prismarine-registry, minecraft-data, or a port of PyMCTranslate).

import { Block, AbstractPos } from "../blocks";

// ── MinecraftVersion ──────────────────────────────────────────────────────

export interface MinecraftVersion {
  readonly platform: "java";
  readonly versionNumber: readonly [number, number, number]; // e.g. [1, 20, 1]
  readonly dataVersion: number;
}

export const KNOWN_VERSIONS: Record<string, MinecraftVersion> = {
  "1.12.2": { platform: "java", versionNumber: [1, 12, 2], dataVersion: 1343 },
  "1.13.1": { platform: "java", versionNumber: [1, 13, 1], dataVersion: 1628 },
  "1.16.2": { platform: "java", versionNumber: [1, 16, 2], dataVersion: 2578 },
  "1.17.1": { platform: "java", versionNumber: [1, 17, 1], dataVersion: 2730 },
  "1.18.2": { platform: "java", versionNumber: [1, 18, 2], dataVersion: 2975 },
  "1.19.4": { platform: "java", versionNumber: [1, 19, 4], dataVersion: 3337 },
  "1.20.1": { platform: "java", versionNumber: [1, 20, 1], dataVersion: 3465 },
};

export function getVersion(versionString: string): MinecraftVersion {
  const v = KNOWN_VERSIONS[versionString];
  if (!v) throw new Error(`Unknown Minecraft version: ${versionString}`);
  return v;
}

export function versionsEqual(a: MinecraftVersion, b: MinecraftVersion): boolean {
  return a.platform === b.platform && a.versionNumber.join(".") === b.versionNumber.join(".");
}

export function getVersionFromDataVersion(dataVersion: number): MinecraftVersion {
  for (const v of Object.values(KNOWN_VERSIONS)) {
    if (v.dataVersion === dataVersion) return v;
  }
  throw new Error(`No known version for data version ${dataVersion}`);
}

// ── posKey ────────────────────────────────────────────────────────────────
//
// JavaScript's `Map` uses reference equality for object keys, so we can't key
// a block matrix by tuple position objects. We canonicalize to a `"x,y,z"`
// string instead.

export function posKey(pos: AbstractPos<number>): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

// ── MinecraftVersionMapper ────────────────────────────────────────────────

export class MinecraftVersionMapper {
  constructor(
    public readonly blockMatrix: Map<string, Block>,
    public readonly sourceVersion: MinecraftVersion,
  ) {}

  static getVersion(versionString: string): MinecraftVersion {
    return getVersion(versionString);
  }

  /**
   * Translate a block between Minecraft versions.
   *
   * STUB: a real implementation needs a Minecraft block-state translation
   * database (prismarine-registry, minecraft-data, or a port of PyMCTranslate).
   * For now this is a no-op that returns the block unchanged.
   */
  mapBlock(block: Block, _targetVersion: MinecraftVersion): Block {
    return block;
  }
}
