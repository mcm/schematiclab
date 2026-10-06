// Appearance descriptors of vanilla blocks (dominant colours, variance, face
// swatches), computed from the 3D-preview bundle in `public/minecraft-assets/`
// with the same code as mod blocks (`modpacks/appearance.ts`), so vanilla and
// mod results are comparable. Read from disk and computed once per instance
// (about a second); the files are traced into the MCP route by
// `outputFileTracingIncludes` in `next.config.ts`.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  describeVanillaBlocks,
  type BlockDescriptor,
} from "../modpacks/appearance";
import { decodePng } from "../render/block-appearance";

const ASSETS = path.join(process.cwd(), "public", "minecraft-assets");

const readJson = (name: string) =>
  JSON.parse(readFileSync(path.join(ASSETS, name), "utf8")) as Record<
    string,
    unknown
  >;

let descriptors: ReadonlyMap<string, BlockDescriptor> | undefined;

/** Descriptor per vanilla block id of the bundle (`minecraft:stone`). */
export function vanillaBlockDescriptors(): ReadonlyMap<
  string,
  BlockDescriptor
> {
  if (descriptors) return descriptors;
  const atlas = decodePng(readFileSync(path.join(ASSETS, "atlas.png")));
  if (!atlas) throw new Error("Could not decode the vanilla texture atlas");
  descriptors = new Map(
    Object.entries(
      describeVanillaBlocks({
        blockstates: readJson("blockstates.json"),
        models: readJson("models.json"),
        uvs: readJson("atlas-uvs.json"),
        atlas,
      }),
    ),
  );
  return descriptors;
}
