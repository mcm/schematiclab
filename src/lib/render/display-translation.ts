// Display-only version translation for the 3D preview.
//
// The vanilla asset bundle is a single Minecraft version (recorded in
// `public/minecraft-assets/version.json`), but the edited schematic stays in
// its own version, so block names renamed since then (`grass` → `short_grass`,
// 1.12 legacy names, ...) have no model in the bundle. The preview renders a
// copy whose palette is translated up to the bundle's version; the edited
// schematic, material list and export are untouched.

import type { ParsedSchematicProjection } from "../convert";
import { BlockState } from "../schemlib/blocks";
import { translateBlockState } from "../schemlib/data/translate";
import type { MinecraftVersion } from "../schemlib/schematic-formats/version-mapping";
import bundleVersionJson from "../../../public/minecraft-assets/version.json";

/** The fields of mcmeta's `version.json` used here. */
export interface McmetaVersion {
  id: string;
  data_version: number;
}

/**
 * `MinecraftVersion` for an mcmeta `version.json`. Pre-releases and snapshots
 * of a release line (`26.2-snapshot-8`, `1.21.5-rc-1`) count as that release,
 * which is how translation buckets versions anyway.
 */
export function minecraftVersionFromMcmeta(
  version: McmetaVersion,
): MinecraftVersion {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.id);
  if (match === null) {
    throw new Error(`Unrecognized Minecraft version id: ${version.id}`);
  }
  return {
    platform: "java",
    versionNumber: [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)],
    dataVersion: version.data_version,
  };
}

/** Minecraft version of the vanilla asset bundle the preview renders with. */
export const BUNDLE_MINECRAFT_VERSION =
  minecraftVersionFromMcmeta(bundleVersionJson);

/**
 * `projection` with every vanilla palette entry translated to `bundleVersion`.
 * Palette indices are unchanged, so regions are shared with the input. Mod
 * blocks pass through. Returns `projection` itself when nothing changes.
 */
export function toDisplayProjection(
  projection: ParsedSchematicProjection,
  bundleVersion: MinecraftVersion = BUNDLE_MINECRAFT_VERSION,
): ParsedSchematicProjection {
  let changed = false;
  const palette = projection.palette.map((entry) => {
    if (!entry.blockId.startsWith("minecraft:")) return entry;
    const translated = translateBlockState(
      new BlockState({ Name: entry.blockId, Properties: entry.properties }),
      projection.minecraftVersion,
      bundleVersion,
    );
    const blockState = translated.toString();
    if (blockState === entry.blockState) return entry;
    changed = true;
    return {
      ...entry,
      blockState,
      blockId: translated.Name,
      properties: Object.fromEntries(translated.Properties),
    };
  });
  return changed ? { ...projection, palette } : projection;
}
