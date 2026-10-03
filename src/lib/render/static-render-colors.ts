// Block colours for the static renders (`static-views.ts`): the average
// texture colour of each block (vanilla from `block-colors.json`, mods from
// `ModBlock.appearance`), a camo block's camo colour, and a stable made-up
// colour for blocks with no colour data.

import type {
  ParsedSchematicBlockEntity,
  ParsedSchematicProjection,
} from "../convert";
import { placedCamoSlots, isCamoCapableBlockId } from "../camo/extract";
import type { BlockAppearance } from "./block-appearance";
import { fallbackBlockColor, oklabToHex } from "./static-views";

export type AppearanceLookup = (blockId: string) => BlockAppearance | undefined;

export interface StaticRenderColors {
  colorFor: (paletteIndex: number) => string;
  colorAt: (
    regionIndex: number,
    pos: [number, number, number],
    paletteIndex: number,
  ) => string | undefined;
}

/** Colour callbacks for `buildVoxelModel`. */
export function staticRenderColors(
  projection: ParsedSchematicProjection,
  appearanceOf: AppearanceLookup,
): StaticRenderColors {
  const byId = new Map<string, string>();
  const colorOfId = (blockId: string) => {
    let color = byId.get(blockId);
    if (color === undefined) {
      const appearance = appearanceOf(blockId);
      color = appearance
        ? oklabToHex(appearance.oklab)
        : fallbackBlockColor(blockId);
      byId.set(blockId, color);
    }
    return color;
  };

  const camoCapable = projection.palette.map((entry) =>
    isCamoCapableBlockId(entry.blockId),
  );
  // Block entities by position, per region, built on first use.
  const entities: (Map<string, ParsedSchematicBlockEntity> | undefined)[] = [];
  const entityAt = (regionIndex: number, pos: [number, number, number]) => {
    let map = entities[regionIndex];
    if (map === undefined) {
      map = new Map(
        projection.regions[regionIndex].blockEntities.map((be) => [
          be.pos.join(","),
          be,
        ]),
      );
      entities[regionIndex] = map;
    }
    return map.get(pos.join(","));
  };

  return {
    colorFor: (paletteIndex) =>
      colorOfId(projection.palette[paletteIndex].blockId),
    colorAt: (regionIndex, pos, paletteIndex) => {
      if (!camoCapable[paletteIndex]) return undefined;
      const entry = projection.palette[paletteIndex];
      const slots = placedCamoSlots(
        entry.blockId,
        entry.properties,
        entityAt(regionIndex, pos)?.nbt,
      );
      const camo = slots.find((slot) => slot.state !== null)?.state;
      return camo ? colorOfId(camo.name) : undefined;
    },
  };
}
