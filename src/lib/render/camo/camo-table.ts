// Camo data for the 3D preview's structure.
//
// deepslate's ChunkBuilder only passes a block's id and properties to
// `BlockDefinition.getMesh`, never its block-entity NBT. So the preview gives
// each camo-capable block a synthetic `__camo` property whose value indexes
// this table of unique (block state + camo slots) combinations, and
// `CamoBlockDefinition` looks the camo up here. Real block ids don't change.

import {
  extractCamoSlots,
  isCamoCapableBlockId,
  type CamoSlot,
} from "../../camo/extract";
import type { NbtCompoundValue } from "../../nbt-value";

/** Synthetic block-state property carrying a `CamoTable` index. */
export const CAMO_PROPERTY = "__camo";

export interface CamoTableEntry {
  blockId: string;
  properties: Readonly<Record<string, string>>;
  slots: readonly CamoSlot[];
}

export class CamoTable {
  readonly entries: CamoTableEntry[] = [];
  private readonly byKey = new Map<string, number>();

  /** Index (as a property value) of this combination, added if new. */
  add(
    blockId: string,
    properties: Readonly<Record<string, string>>,
    slots: readonly CamoSlot[],
  ): string {
    const sortedProps = Object.keys(properties)
      .sort()
      .map((key) => [key, properties[key]]);
    const key = JSON.stringify([blockId, sortedProps, slots]);
    let index = this.byKey.get(key);
    if (index === undefined) {
      index = this.entries.length;
      this.entries.push({ blockId, properties, slots });
      this.byKey.set(key, index);
    }
    return String(index);
  }

  /** The entry a `__camo` property value points at, or null. */
  get(value: string | undefined): CamoTableEntry | null {
    if (value === undefined || !/^\d+$/.test(value)) return null;
    return this.entries[Number(value)] ?? null;
  }
}

/**
 * Properties to render a block with: camo-capable blocks get `__camo`
 * pointing at their (state + slots) entry in `table`; others are returned
 * unchanged.
 */
export function withCamoProperty(
  table: CamoTable,
  blockId: string,
  properties: Record<string, string>,
  blockEntityNbt: NbtCompoundValue | undefined,
): Record<string, string> {
  if (!isCamoCapableBlockId(blockId)) return properties;
  const slots = extractCamoSlots(blockId, properties, blockEntityNbt);
  return {
    ...properties,
    [CAMO_PROPERTY]: table.add(blockId, properties, slots),
  };
}

// The table of the structure the preview is currently building. Resources
// outlive structures (they're rebuilt per loaded-mods snapshot), so the
// camo definitions read the table from here at mesh time.
let activeTable: CamoTable | null = null;

export function setActiveCamoTable(table: CamoTable | null): void {
  activeTable = table;
}

export function getActiveCamoTable(): CamoTable | null {
  return activeTable;
}
