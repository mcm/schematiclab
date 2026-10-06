// The vanilla shape each camo frame takes, for the frames that are a camo
// version of a vanilla shape. Other frames (slopes, panels, pillars...) take
// no vanilla shape and are never offered for one.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type { BlockKind } from "../blockdata/registry.ts";

export const CAMO_FRAME_KINDS: Readonly<Record<string, BlockKind>> = {
  "framedblocks:framed_cube": "block",
  "copycats:copycat_block": "block",
  "framedblocks:framed_stairs": "stairs",
  "copycats:copycat_stairs": "stairs",
  "framedblocks:framed_slab": "slab",
  "copycats:copycat_slab": "slab",
  "framedblocks:framed_wall": "wall",
  "copycats:copycat_wall": "wall",
  "framedblocks:framed_fence": "fence",
  "copycats:copycat_fence": "fence",
  "framedblocks:framed_fence_gate": "fence_gate",
  "copycats:copycat_fence_gate": "fence_gate",
  "framedblocks:framed_pane": "pane",
  "framedblocks:framed_bars": "pane",
  "copycats:copycat_pane": "pane",
  "framedblocks:framed_door": "door",
  "framedblocks:framed_iron_door": "door",
  "copycats:copycat_door": "door",
  "copycats:copycat_iron_door": "door",
  "framedblocks:framed_trapdoor": "trapdoor",
  "framedblocks:framed_iron_trapdoor": "trapdoor",
  "copycats:copycat_trapdoor": "trapdoor",
  "copycats:copycat_iron_trapdoor": "trapdoor",
  "framedblocks:framed_button": "button",
  "framedblocks:framed_stone_button": "button",
  "copycats:copycat_stone_button": "button",
  "copycats:copycat_wooden_button": "button",
  "framedblocks:framed_pressure_plate": "pressure_plate",
  "framedblocks:framed_stone_pressure_plate": "pressure_plate",
  "framedblocks:framed_gold_pressure_plate": "pressure_plate",
  "framedblocks:framed_iron_pressure_plate": "pressure_plate",
  "framedblocks:framed_obsidian_pressure_plate": "pressure_plate",
  "copycats:copycat_stone_pressure_plate": "pressure_plate",
  "copycats:copycat_wooden_pressure_plate": "pressure_plate",
  "copycats:copycat_light_weighted_pressure_plate": "pressure_plate",
  "copycats:copycat_heavy_weighted_pressure_plate": "pressure_plate",
};

/** The vanilla shape camo frame `id` takes, or undefined. */
export function camoFrameKind(id: string): BlockKind | undefined {
  return Object.hasOwn(CAMO_FRAME_KINDS, id) ? CAMO_FRAME_KINDS[id] : undefined;
}
