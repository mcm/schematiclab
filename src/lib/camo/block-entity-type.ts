// Block-entity types of camo-capable blocks.
//
// A parent-row swap keeps a camo block's block entity only when the target
// block uses the same block-entity type, since the mods only load a block
// entity whose type matches the block. The lists come from the camo fixtures
// (every FramedBlocks, Copycats+ and Create camo block placed in-game, see
// CAMO_FIXTURES.md): blocks not listed here use their mod's default type.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import { isCamoCapableBlockId } from "./extract";

const SHARED_TYPES: Record<string, readonly string[]> = {
  "copycats:copycat_cogwheel": [
    "copycats:copycat_cogwheel",
    "copycats:copycat_large_cogwheel",
  ],
  "copycats:copycat_sliding_door": [
    "copycats:copycat_folding_door",
    "copycats:copycat_sliding_door",
  ],
  "copycats:multistate_copycat": [
    "copycats:copycat_board",
    "copycats:copycat_byte",
    "copycats:copycat_byte_panel",
    "copycats:copycat_half_layer",
    "copycats:copycat_slab",
    "copycats:copycat_stacked_half_layer",
    "copycats:copycat_vertical_half_layer",
  ],
  "framedblocks:framed_adj_double_copycat_slab": [
    "framedblocks:framed_adj_double_copycat_panel",
    "framedblocks:framed_adj_double_copycat_slab",
  ],
  "framedblocks:framed_adj_double_slab": [
    "framedblocks:framed_adj_double_panel",
    "framedblocks:framed_adj_double_slab",
  ],
  "framedblocks:framed_banner": [
    "framedblocks:framed_banner",
    "framedblocks:framed_wall_banner",
  ],
  "framedblocks:framed_door": [
    "framedblocks:framed_door",
    "framedblocks:framed_iron_door",
  ],
  "framedblocks:framed_double_threeway_corner": [
    "framedblocks:framed_double_prism_corner",
    "framedblocks:framed_double_threeway_corner",
  ],
  "framedblocks:framed_double_tile": [
    "framedblocks:framed_checkered_cube",
    "framedblocks:framed_checkered_panel",
    "framedblocks:framed_checkered_slab",
    "framedblocks:framed_divided_board",
    "framedblocks:framed_divided_panel_horizontal",
    "framedblocks:framed_divided_panel_vertical",
    "framedblocks:framed_divided_slab",
    "framedblocks:framed_divided_slope",
    "framedblocks:framed_divided_stairs",
    "framedblocks:framed_double_corner_board",
    "framedblocks:framed_double_half_stairs",
    "framedblocks:framed_double_panel",
    "framedblocks:framed_double_slab",
    "framedblocks:framed_double_stairs",
    "framedblocks:framed_double_threeway_corner_pillar",
    "framedblocks:framed_flat_inv_double_slope_panel_corner",
    "framedblocks:framed_flat_inv_double_slope_slab_corner",
    "framedblocks:framed_flat_stacked_inner_slope_panel_corner",
    "framedblocks:framed_flat_stacked_inner_slope_slab_corner",
    "framedblocks:framed_flat_stacked_slope_panel_corner",
    "framedblocks:framed_flat_stacked_slope_slab_corner",
    "framedblocks:framed_inv_double_corner_slope_panel",
    "framedblocks:framed_inv_double_corner_slope_panel_w",
    "framedblocks:framed_inv_double_slope_panel",
    "framedblocks:framed_inv_double_slope_slab",
    "framedblocks:framed_masonry_corner",
    "framedblocks:framed_sliced_stairs_panel",
    "framedblocks:framed_sliced_stairs_slab",
    "framedblocks:framed_split_pillar_socket",
    "framedblocks:framed_stacked_corner_slope_edge",
    "framedblocks:framed_stacked_corner_slope_panel",
    "framedblocks:framed_stacked_corner_slope_panel_w",
    "framedblocks:framed_stacked_inner_corner_slope_edge",
    "framedblocks:framed_stacked_inner_corner_slope_panel",
    "framedblocks:framed_stacked_inner_corner_slope_panel_w",
    "framedblocks:framed_stacked_pyramid_slab",
    "framedblocks:framed_stacked_slope_edge",
    "framedblocks:framed_stacked_slope_panel",
    "framedblocks:framed_stacked_slope_slab",
    "framedblocks:framed_vertical_divided_stairs",
    "framedblocks:framed_vertical_double_half_stairs",
    "framedblocks:framed_vertical_double_stairs",
    "framedblocks:framed_vertical_sliced_stairs",
  ],
  "framedblocks:framed_fancy_rail_slope": [
    "framedblocks:framed_fancy_activator_rail_slope",
    "framedblocks:framed_fancy_detector_rail_slope",
    "framedblocks:framed_fancy_powered_rail_slope",
    "framedblocks:framed_fancy_rail_slope",
  ],
  "framedblocks:framed_flat_elev_double_slope_slab_corner": [
    "framedblocks:framed_flat_elev_double_slope_slab_corner",
    "framedblocks:framed_flat_elev_inner_double_slope_slab_corner",
  ],
  "framedblocks:framed_flat_ext_double_slope_panel_corner": [
    "framedblocks:framed_flat_ext_double_slope_panel_corner",
    "framedblocks:framed_flat_ext_inner_double_slope_panel_corner",
  ],
  "framedblocks:framed_hanging_sign": [
    "framedblocks:framed_hanging_sign",
    "framedblocks:framed_wall_hanging_sign",
  ],
  "framedblocks:framed_item_frame": [
    "framedblocks:framed_glowing_item_frame",
    "framedblocks:framed_item_frame",
  ],
  "framedblocks:framed_sign": [
    "framedblocks:framed_sign",
    "framedblocks:framed_wall_sign",
  ],
};

// Blocks whose block-entity type has the block's own id.
const OWN_TYPE = new Set([
  "copycats:copycat_fluid_pipe",
  "copycats:copycat_glass_fluid_pipe",
  "copycats:copycat_shaft",
  "framedblocks:framed_chest",
  "framedblocks:framed_chiseled_bookshelf",
  "framedblocks:framed_collapsible_block",
  "framedblocks:framed_collapsible_copycat_block",
  "framedblocks:framed_double_corner",
  "framedblocks:framed_double_half_slope",
  "framedblocks:framed_double_slope",
  "framedblocks:framed_double_slope_panel",
  "framedblocks:framed_double_slope_slab",
  "framedblocks:framed_elev_double_corner_slope_edge",
  "framedblocks:framed_elev_double_inner_corner_slope_edge",
  "framedblocks:framed_elevated_double_slope_edge",
  "framedblocks:framed_elevated_double_slope_slab",
  "framedblocks:framed_elevated_inner_double_prism",
  "framedblocks:framed_elevated_inner_double_sloped_prism",
  "framedblocks:framed_ext_double_corner_slope_panel",
  "framedblocks:framed_ext_double_corner_slope_panel_w",
  "framedblocks:framed_ext_inner_double_corner_slope_panel",
  "framedblocks:framed_ext_inner_double_corner_slope_panel_w",
  "framedblocks:framed_extended_double_slope_panel",
  "framedblocks:framed_flat_double_slope_panel_corner",
  "framedblocks:framed_flat_double_slope_slab_corner",
  "framedblocks:framed_flower_pot",
  "framedblocks:framed_hopper",
  "framedblocks:framed_large_double_corner_slope_panel",
  "framedblocks:framed_large_double_corner_slope_panel_w",
  "framedblocks:framed_one_way_window",
  "framedblocks:framed_secret_storage",
  "framedblocks:framed_shelf",
  "framedblocks:framed_sliced_sloped_stairs_slab",
  "framedblocks:framed_sliced_sloped_stairs_slope",
  "framedblocks:framed_sloped_double_stairs",
  "framedblocks:framed_small_double_corner_slope_panel",
  "framedblocks:framed_small_double_corner_slope_panel_w",
  "framedblocks:framed_tank",
  "framedblocks:framed_target",
  "framedblocks:framed_vertical_double_half_slope",
  "framedblocks:framed_vertical_sliced_sloped_stairs_panel",
  "framedblocks:framed_vertical_sliced_sloped_stairs_slope",
  "framedblocks:framed_vertical_sloped_double_stairs",
]);

const TYPE_BY_BLOCK = new Map<string, string>(
  Object.entries(SHARED_TYPES).flatMap(([type, ids]) =>
    ids.map((id) => [id, type] as const),
  ),
);

/**
 * The block-entity type a camo-capable block saves (e.g.
 * framedblocks:framed_tile), or undefined for blocks without camo data.
 */
export function camoBlockEntityType(blockId: string): string | undefined {
  if (!isCamoCapableBlockId(blockId) || blockId === "create:copycat_base") {
    return undefined;
  }
  const shared = TYPE_BY_BLOCK.get(blockId);
  if (shared !== undefined) return shared;
  if (OWN_TYPE.has(blockId)) return blockId;
  if (blockId.startsWith("framedblocks:")) return "framedblocks:framed_tile";
  if (blockId.startsWith("copycats:")) return "copycats:copycat";
  return "create:copycat";
}

/**
 * Whether a block entity survives swapping `fromBlockId` to `toBlockId`: the
 * same block, or two camo blocks with the same block-entity type.
 */
export function keepsBlockEntity(
  fromBlockId: string,
  toBlockId: string,
): boolean {
  if (fromBlockId === toBlockId) return true;
  const type = camoBlockEntityType(fromBlockId);
  return type !== undefined && type === camoBlockEntityType(toBlockId);
}
