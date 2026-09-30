// Camo materials per palette entry, for the material list.
//
// Counts the distinct camo states that each camo-capable palette entry's
// placements hold, one count per non-empty slot. Empty slots (including
// create:copycat_base parts) aren't counted; fluids count under their fluid id.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type {
  ParsedCamoMaterial,
  ParsedSchematicPaletteEntry,
  ParsedSchematicProjection,
} from "../convert";
import { extractCamoSlots, isCamoCapableBlockId } from "./extract";

function stateKey(name: string, properties: Record<string, string>): string {
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return name;
  return `${name}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`;
}

const posKey = (pos: readonly [number, number, number]) =>
  `${pos[0]},${pos[1]},${pos[2]}`;

/**
 * The camo materials of every palette entry, indexed like `palette`: a list
 * (possibly empty) for camo-capable entries and undefined for the rest. Lists
 * are sorted by count (high to low), then by block state.
 */
export function countCamoMaterials(
  palette: readonly ParsedSchematicPaletteEntry[],
  regions: ParsedSchematicProjection["regions"],
): (ParsedCamoMaterial[] | undefined)[] {
  const byEntry = palette.map((entry) =>
    isCamoCapableBlockId(entry.blockId)
      ? new Map<string, ParsedCamoMaterial>()
      : undefined,
  );
  if (byEntry.some((materials) => materials !== undefined)) {
    for (const region of regions) {
      if (region.blockEntities.length === 0) continue;
      const indexAt = new Map<string, number>();
      for (const placement of region.blocks) {
        if (byEntry[placement.paletteIndex] !== undefined) {
          indexAt.set(posKey(placement.pos), placement.paletteIndex);
        }
      }
      for (const blockEntity of region.blockEntities) {
        const index = indexAt.get(posKey(blockEntity.pos));
        if (index === undefined) continue;
        const entry = palette[index];
        const materials = byEntry[index]!;
        const slots = extractCamoSlots(
          entry.blockId,
          entry.properties,
          blockEntity.nbt,
        );
        for (const { state, kind } of slots) {
          if (kind === "empty" || state === null) continue;
          const blockState = stateKey(state.name, state.properties);
          const key = `${kind}:${blockState}`;
          const existing = materials.get(key);
          if (existing !== undefined) {
            existing.count += 1;
          } else {
            materials.set(key, {
              kind,
              blockState,
              blockId: state.name,
              properties: state.properties,
              count: 1,
            });
          }
        }
      }
    }
  }
  return byEntry.map((materials) =>
    materials === undefined
      ? undefined
      : [...materials.values()].sort(
          (a, b) =>
            b.count - a.count || a.blockState.localeCompare(b.blockState),
        ),
  );
}

/**
 * `palette` with `camoMaterials` filled in from the block entities in
 * `regions`. Call it whenever a palette or its block entities are rebuilt.
 */
export function withCamoMaterials(
  palette: readonly ParsedSchematicPaletteEntry[],
  regions: ParsedSchematicProjection["regions"],
): ParsedSchematicPaletteEntry[] {
  const counts = countCamoMaterials(palette, regions);
  return palette.map((entry, i) => {
    const { camoMaterials: _stale, ...rest } = entry;
    const camoMaterials = counts[i];
    return camoMaterials === undefined ? rest : { ...rest, camoMaterials };
  });
}

/**
 * Material totals keyed by block state (fluid camos by fluid id): each
 * palette entry's own count plus every camo slot holding that state.
 */
export function materialTotals(
  palette: readonly ParsedSchematicPaletteEntry[],
): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (key: string, count: number) =>
    totals.set(key, (totals.get(key) ?? 0) + count);
  for (const entry of palette) {
    add(entry.blockState, entry.count);
    for (const material of entry.camoMaterials ?? []) {
      add(material.blockState, material.count);
    }
  }
  return totals;
}
