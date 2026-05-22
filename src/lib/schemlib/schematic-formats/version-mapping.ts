// Port of schemlib/schematic_formats/version_mapping.py (Python) -> TypeScript.
//
// The Python original delegated block-state translation to PyMCTranslate
// (non-OSS-friendly). Here we use a codegen'd diff chain built from
// PrismarineJS/minecraft-data (1.12 ↔ 1.13 flatten table, 1.13 block schema)
// and misode/mcmeta (per-release block schemas for 1.14+), with a small
// hand-curated overrides file for renames. See:
//   - scripts/generate-block-translations.mts (codegen)
//   - src/lib/schemlib/data/translate.ts      (runtime)
//   - src/lib/schemlib/data/manual-overrides.ts

import { Block, AbstractPos } from "../blocks";
import { KNOWN_VERSIONS } from "./known-versions";
import { translateBlockState, type TranslateOptions } from "../data/translate";

// ── MinecraftVersion ──────────────────────────────────────────────────────

export interface MinecraftVersion {
  readonly platform: "java";
  readonly versionNumber: readonly [number, number, number]; // e.g. [1, 20, 1]
  readonly dataVersion: number;
}

export { KNOWN_VERSIONS };

export function getVersion(versionString: string): MinecraftVersion {
  const v = KNOWN_VERSIONS[versionString];
  if (!v) throw new Error(`Unknown Minecraft version: ${versionString}`);
  return v;
}

export function versionsEqual(
  a: MinecraftVersion,
  b: MinecraftVersion,
): boolean {
  return (
    a.platform === b.platform &&
    a.versionNumber.join(".") === b.versionNumber.join(".")
  );
}

export function getVersionFromDataVersion(
  dataVersion: number,
): MinecraftVersion {
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

  mapBlock(
    block: Block,
    targetVersion: MinecraftVersion,
    options?: TranslateOptions,
  ): Block {
    const translated = translateBlockState(
      block.state,
      this.sourceVersion,
      targetVersion,
      options,
    );
    return new Block(block.pos, translated);
  }
}
