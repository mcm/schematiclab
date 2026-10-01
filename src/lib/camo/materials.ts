// Camo materials per palette entry, for the material list.
//
// Counts the distinct camo states that each camo-capable palette entry's
// placements hold, one count per slot; fluids count under their fluid id.
// Empty slots (including create:copycat_base parts, and every slot of a camo
// block without a block entity yet) count together as one "empty" material,
// so the material list can offer to fill them.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type {
  ParsedCamoMaterial,
  ParsedSchematicPaletteEntry,
  ParsedSchematicProjection,
} from "../convert";
import { isCamoCapableBlockId, placedCamoSlots } from "./extract";
import { stateKey } from "./write";

const posKey = (pos: readonly [number, number, number]) =>
  `${pos[0]},${pos[1]},${pos[2]}`;

/** The material standing for empty slots. */
export const EMPTY_CAMO_MATERIAL_KEY = "";

/**
 * The camo materials of every palette entry, indexed like `palette`: a list
 * (possibly empty) for camo-capable entries and undefined for the rest. Lists
 * are sorted by count (high to low), then by block state, with the empty
 * material last.
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
      const nbtAt = new Map(
        region.blockEntities.map((be) => [posKey(be.pos), be.nbt]),
      );
      for (const placement of region.blocks) {
        const materials = byEntry[placement.paletteIndex];
        if (materials === undefined) continue;
        const entry = palette[placement.paletteIndex];
        const slots = placedCamoSlots(
          entry.blockId,
          entry.properties,
          nbtAt.get(posKey(placement.pos)),
        );
        for (const { state, kind } of slots) {
          const blockState =
            kind === "empty" || state === null
              ? EMPTY_CAMO_MATERIAL_KEY
              : stateKey(state.name, state.properties);
          const key = `${kind}:${blockState}`;
          const existing = materials.get(key);
          if (existing !== undefined) {
            existing.count += 1;
          } else if (kind === "empty" || state === null) {
            materials.set(key, {
              kind: "empty",
              blockState,
              blockId: "",
              properties: {},
              count: 1,
            });
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
            Number(a.kind === "empty") - Number(b.kind === "empty") ||
            b.count - a.count ||
            a.blockState.localeCompare(b.blockState),
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
 * palette entry's own count plus every camo slot holding that state. Empty
 * slots aren't materials.
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
      if (material.kind !== "empty") add(material.blockState, material.count);
    }
  }
  return totals;
}
