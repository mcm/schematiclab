// The texture a camo frame shows where it holds no camo: FramedBlocks'
// `framed_block` (`framed_block_alt` for a double block's second slot) and
// Create's `copycat_base`, which Create: Copycats+ uses too. The 3D preview
// draws empty slots in it, and modpack data gives frames its look when their
// jar model (a placeholder) gives none.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

export const FRAMED_TEXTURE = "framedblocks:block/framed_block";
export const FRAMED_ALT_TEXTURE = "framedblocks:block/framed_block_alt";
export const COPYCAT_TEXTURE = "create:block/copycat_base";

/** Texture of an empty camo slot (`camo`, `camo_two`) on `blockId`. */
export function camoFrameTexture(blockId: string, slot = "camo"): string {
  if (!blockId.startsWith("framedblocks:")) return COPYCAT_TEXTURE;
  return slot === "camo_two" ? FRAMED_ALT_TEXTURE : FRAMED_TEXTURE;
}

/**
 * A block whose look is exactly a frame texture (a cube of it), for frames
 * whose own mod file doesn't ship the texture: Copycats+ frames show Create's
 * `copycat_base`, which is Create's `create:copycat_base` block.
 */
export const CAMO_FRAME_TEXTURE_BLOCKS: Readonly<Record<string, string>> = {
  [COPYCAT_TEXTURE]: "create:copycat_base",
};
