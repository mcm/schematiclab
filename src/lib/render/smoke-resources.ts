// Minimal deepslate `Resources` for the US-005 smoke render.
//
// Real Minecraft block models / textures are out of scope for this story;
// every block in the schematic resolves to the same plain coloured cube.
// Future stories (US-006+) will replace this with proper vanilla assets so
// slabs / stairs / fences render with their real geometry.

import {
  BlockDefinition,
  BlockModel,
  Identifier,
  type BlockFlags,
} from "deepslate";
import type { Resources } from "deepslate";

const SMOKE_TEXTURE_ID = "schematiclab:smoke";
const SMOKE_MODEL_ID = "schematiclab:smoke_cube";
const ATLAS_SIZE = 16; // power-of-two required by WebGL mipmaps.

// Solid pale blue tile; just needs to be visibly non-black so the user can
// confirm the canvas isn't blank.
const SMOKE_COLOR: readonly [number, number, number, number] = [
  0x6b, 0x88, 0xff, 0xff,
];

function buildAtlasImage(): ImageData {
  const data = new Uint8ClampedArray(ATLAS_SIZE * ATLAS_SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = SMOKE_COLOR[0];
    data[i + 1] = SMOKE_COLOR[1];
    data[i + 2] = SMOKE_COLOR[2];
    data[i + 3] = SMOKE_COLOR[3];
  }
  return new ImageData(data, ATLAS_SIZE, ATLAS_SIZE);
}

const SMOKE_CUBE_MODEL = new BlockModel(
  undefined,
  { all: SMOKE_TEXTURE_ID, particle: SMOKE_TEXTURE_ID },
  [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        north: { texture: "#all", uv: [0, 0, 16, 16] },
        south: { texture: "#all", uv: [0, 0, 16, 16] },
        east: { texture: "#all", uv: [0, 0, 16, 16] },
        west: { texture: "#all", uv: [0, 0, 16, 16] },
        up: { texture: "#all", uv: [0, 0, 16, 16] },
        down: { texture: "#all", uv: [0, 0, 16, 16] },
      },
    },
  ],
);

const SMOKE_BLOCK_DEFINITION = new BlockDefinition(
  { "": { model: SMOKE_MODEL_ID } },
  undefined,
);

const OPAQUE_FLAGS: BlockFlags = { opaque: true };

// Block IDs that contribute no visible mesh and should be skipped before
// reaching deepslate. The renderer can technically handle these (it would
// just emit an empty mesh), but skipping at the boundary keeps the chunk
// builder fast for large schematics.
const INVISIBLE_BLOCK_IDS = new Set<string>([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:structure_void",
]);

export function isInvisibleBlockId(blockId: string): boolean {
  return INVISIBLE_BLOCK_IDS.has(blockId);
}

/**
 * Build a smoke-render `Resources` bundle. Returns a fresh atlas `ImageData`
 * per call (cheap — 16×16) so callers can mutate or transfer without
 * worrying about shared state.
 */
export function createSmokeResources(): Resources {
  const atlas = buildAtlasImage();
  return {
    getBlockDefinition(_id: Identifier) {
      return SMOKE_BLOCK_DEFINITION;
    },
    getBlockModel(_id: Identifier) {
      return SMOKE_CUBE_MODEL;
    },
    getTextureAtlas() {
      return atlas;
    },
    getTextureUV(_id: Identifier) {
      // Full-atlas UVs in normalized [0,1] coords — the whole 16×16 image is
      // one tile.
      return [0, 0, 1, 1];
    },
    getPixelSize() {
      return 1 / ATLAS_SIZE;
    },
    getBlockFlags(_id: Identifier) {
      return OPAQUE_FLAGS;
    },
    getBlockProperties(_id: Identifier) {
      return null;
    },
    getDefaultBlockProperties(_id: Identifier) {
      return null;
    },
  };
}
