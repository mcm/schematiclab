// Camo frames (FramedBlocks, copycats) in modpack data, corrected at read
// time. Their jar blockstates point every state at one placeholder model and
// don't name the block's state properties (`facing`, `half`, `shape`...), so
// an upload records them with few or no properties and classifies them from
// the placeholder (`framed_stairs` as a full-cube `block`). This takes their
// properties from the camo fixtures (`block-properties.generated.ts`),
// merged with the jar's, completes their defaults, and takes their kind from
// the vanilla shape they copy. Packs uploaded before this need no re-upload.
//
// Frames whose placeholder model gives them no look take it from their frame
// texture (`withCamoFrameLooks`): the upload describes it when the frame's
// own jar ships it (FramedBlocks, Create), and Copycats+ frames, which show
// Create's `copycat_base`, take the look of the block that is a cube of it.
//
// Imports carry their `.ts` extension so node's strip-types can load it.

import type { BlockRegistry } from "../blockdata/registry.ts";
import { CAMO_BLOCK_PROPERTIES } from "../camo/block-properties.generated.ts";
import { camoFrameKind } from "../camo/frame-kinds.ts";
import {
  CAMO_FRAME_TEXTURE_BLOCKS,
  camoFrameTexture,
} from "../camo/frame-textures.ts";
import { completePropertyValues } from "../mods/property-domains.ts";
import type { ModpackBlock } from "./schema.ts";

// A vanilla block of each frame shape, whose defaults a frame takes for the
// properties they share (stairs face north, bottom half, straight).
const VANILLA_OF_KIND: Readonly<Record<string, string>> = {
  stairs: "minecraft:oak_stairs",
  slab: "minecraft:oak_slab",
  wall: "minecraft:cobblestone_wall",
  fence: "minecraft:oak_fence",
  fence_gate: "minecraft:oak_fence_gate",
  pane: "minecraft:glass_pane",
  door: "minecraft:oak_door",
  trapdoor: "minecraft:oak_trapdoor",
  button: "minecraft:oak_button",
  pressure_plate: "minecraft:oak_pressure_plate",
};

// Defaults for frames without a vanilla shape (slopes, panels...), where the
// property has one of these values; else its first value.
const PREFERRED_DEFAULTS: Readonly<Record<string, string>> = {
  facing: "north",
  half: "bottom",
  type: "bottom",
  shape: "straight",
  axis: "y",
  face: "floor",
  hinge: "left",
};

/**
 * `block` with a camo frame's state properties, defaults, kind and
 * `fullCube`, or `block` itself when it isn't a camo block with fixture
 * properties.
 */
export function withCamoFrameState(
  block: ModpackBlock,
  vanilla: BlockRegistry,
): ModpackBlock {
  if (!Object.hasOwn(CAMO_BLOCK_PROPERTIES, block.id)) return block;
  const sampled = CAMO_BLOCK_PROPERTIES[block.id];
  const properties: Record<string, string[]> = {};
  for (const name of new Set([
    ...Object.keys(sampled),
    ...Object.keys(block.properties),
  ])) {
    const values = [...(sampled[name] ?? [])];
    for (const value of block.properties[name] ?? []) {
      if (!values.includes(value)) values.push(value);
    }
    properties[name] = completePropertyValues(name, values);
  }

  const kind = camoFrameKind(block.id);
  const like = kind === undefined ? undefined : VANILLA_OF_KIND[kind];
  const vanillaDefaults: Readonly<Record<string, string>> =
    (like !== undefined && vanilla.defaults(like)) || {};
  const defaults: Record<string, string> = {};
  for (const [name, values] of Object.entries(properties)) {
    const candidates = [
      block.defaults[name],
      vanillaDefaults[name],
      PREFERRED_DEFAULTS[name],
    ];
    const value = candidates.find((v) => v !== undefined && values.includes(v));
    if (value !== undefined) defaults[name] = value;
    else if (values.length > 0) defaults[name] = values[0];
  }

  return {
    ...block,
    properties,
    defaults,
    kind: kind ?? "unknown",
    fullCube: kind === "block",
  };
}

/**
 * `blocks` with each camo frame that has no appearance or no swatch given
 * those of the pack block that is a cube of its frame texture
 * (`create:copycat_base` for Copycats+ frames). The swatch keeps pointing at
 * that block's mod file, so `show_blocks` reads Create's sheet for it.
 */
export function withCamoFrameLooks(
  blocks: readonly ModpackBlock[],
): ModpackBlock[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  return blocks.map((block) => {
    if (block.camo === undefined) return block;
    if (block.appearance !== undefined && block.swatch !== undefined) {
      return block;
    }
    const lookId = CAMO_FRAME_TEXTURE_BLOCKS[camoFrameTexture(block.id)];
    const look = lookId === undefined ? undefined : byId.get(lookId);
    if (look === undefined) return block;
    const appearance = block.appearance ?? look.appearance;
    const swatch = block.swatch ?? look.swatch;
    return {
      ...block,
      ...(appearance !== undefined ? { appearance } : {}),
      ...(swatch !== undefined ? { swatch } : {}),
    };
  });
}
