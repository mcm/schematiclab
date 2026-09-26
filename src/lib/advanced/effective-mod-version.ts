// Resolves which Minecraft version the Mods tab filters CurseForge by (SCHEM-7):
// the Advanced Editor's target version when one is chosen, otherwise the
// schematic's source version.

import type { ParsedSchematicProjection } from "../convert";
import {
  KNOWN_VERSIONS,
  type MinecraftVersion,
} from "../schemlib/schematic-formats/version-mapping";

export interface EffectiveModVersion {
  versionId: string;
  isFallback: boolean;
}

// Map a MinecraftVersion to its `KNOWN_VERSIONS` key (e.g. `1.20.1`, `1.21`).
// Matches on version number first, then data version; falls back to the
// dotted version number with a trailing `.0` dropped (CurseForge form).
export function knownVersionIdFor(version: MinecraftVersion): string {
  const dotted = version.versionNumber.join(".");
  for (const [id, known] of Object.entries(KNOWN_VERSIONS)) {
    if (known.versionNumber.join(".") === dotted) return id;
  }
  for (const [id, known] of Object.entries(KNOWN_VERSIONS)) {
    if (known.dataVersion === version.dataVersion) return id;
  }
  const [major, minor, patch] = version.versionNumber;
  return patch === 0 ? `${major}.${minor}` : dotted;
}

export function getEffectiveModVersion(
  targetVersionId: string | null,
  projection: Pick<ParsedSchematicProjection, "minecraftVersion">,
): EffectiveModVersion {
  if (targetVersionId !== null) {
    return { versionId: targetVersionId, isFallback: false };
  }
  return {
    versionId: knownVersionIdFor(projection.minecraftVersion),
    isFallback: true,
  };
}
