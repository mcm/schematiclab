import { readFileSync } from "node:fs";
import { join } from "node:path";

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import vanillaRects from "../../../../public/minecraft-assets/atlas-uvs.json";
import vanillaBlockstates from "../../../../public/minecraft-assets/blockstates.json";
import { planAtlas, type PixelRect } from "../atlas-layout";
import {
  isSupersededEntityTexture,
  specialRendererTextures,
} from "../special-textures";

const ASSETS_DIR = join(__dirname, "../../../../public/minecraft-assets");
const VANILLA = vanillaRects as unknown as Record<string, PixelRect>;

const entityZip = unzipSync(
  readFileSync(join(ASSETS_DIR, "entity-textures.zip")),
);
/** `minecraft:entity/...` → PNG bytes. */
const entityTextures = new Map(
  Object.entries(entityZip).map(([name, bytes]) => [
    `minecraft:${name.replace(/\.png$/, "")}`,
    bytes,
  ]),
);

const requested = specialRendererTextures(
  vanillaBlockstates as Record<string, unknown>,
);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

// Fails when a deepslate upgrade or `pnpm gen:mc-assets` changes which
// textures the block-entity renderers need; regenerate the bundle, or extend
// SUPERSEDED_ENTITY_TEXTURE_PREFIXES for textures Minecraft removed.
describe("deepslate block-entity textures", () => {
  it("are all bundled or deliberately hidden", () => {
    expect(requested).toContain("minecraft:entity/chest/normal");
    const uncovered = [...requested].filter(
      (id) =>
        !(id.replace(/^minecraft:/, "") in VANILLA) &&
        !entityTextures.has(id) &&
        !isSupersededEntityTexture(id),
    );
    expect(uncovered).toEqual([]);
  });

  it("bundles only textures deepslate requests", () => {
    const unused = [...entityTextures.keys()].filter(
      (id) => !requested.has(id),
    );
    expect(unused).toEqual([]);
  });

  it("fit a 2048px atlas alongside vanilla without downscaling", () => {
    const plan = planAtlas({
      baseWidth: 1024,
      baseHeight: 1024,
      vanillaRects: VANILLA,
      modTextures: [...entityTextures].map(([id, bytes]) => {
        const [width, height] = pngSize(bytes);
        return { id, width, height };
      }),
      maxSize: 2048,
    });
    expect(plan.downscaled).toBe(false);
    expect(plan.dropped).toEqual([]);
    expect(plan.placements).toHaveLength(entityTextures.size);
  });
});
