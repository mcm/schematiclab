// Whether the Version Mapping tab holds a target version the user picked but
// never applied. Export writes the schematic as-is, so the Export panel shows
// a notice (and names the version on its button) in that state.

import {
  KNOWN_VERSIONS,
  versionsEqual,
  type MinecraftVersion,
} from "@/lib/schemlib/schematic-formats/version-mapping";

/**
 * The selected target version id (e.g. `"1.16.5"`) if it differs from the
 * schematic's current version, else null. Applying a translation clears the
 * selection, so a non-null result means the change is still pending.
 */
export function unappliedTargetVersionId(
  targetVersionId: string | null,
  current: MinecraftVersion,
): string | null {
  if (
    targetVersionId === null ||
    !Object.hasOwn(KNOWN_VERSIONS, targetVersionId)
  ) {
    return null;
  }
  const target = KNOWN_VERSIONS[targetVersionId];
  if (!target || versionsEqual(target, current)) return null;
  return targetVersionId;
}
