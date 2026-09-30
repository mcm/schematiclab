// Which vanilla blocks exist in a given Minecraft version, from the codegen'd
// translation data: the 1.13.2 block list walked forward through each anchor
// diff (removed blocks dropped, renames applied, added blocks added). 1.12.2
// has no post-flatten schema of its own, so it gets the 1.13.2 blocks that a
// legacy id flattens to.

import type { MinecraftVersion } from "../schematic-formats/version-mapping";
import {
  BASE_BLOCKS_1_13_2,
  FLATTEN_TABLE,
  VERSION_DIFFS,
} from "./block-translations.generated";
import { anchorFor } from "./translate";
import { ANCHOR_VERSIONS, type AnchorVersion } from "./types";

const cache = new Map<AnchorVersion, ReadonlySet<string>>();

function stripProperties(blockState: string): string {
  const bracket = blockState.indexOf("[");
  return bracket === -1 ? blockState : blockState.slice(0, bracket);
}

/** Block ids (`minecraft:<name>`) present at an anchor version. */
export function vanillaBlocksAtAnchor(
  anchor: AnchorVersion,
): ReadonlySet<string> {
  const cached = cache.get(anchor);
  if (cached) return cached;

  let blocks: Set<string>;
  if (anchor === "1.12.2") {
    blocks = new Set(Object.values(FLATTEN_TABLE).map(stripProperties));
  } else {
    blocks = new Set(BASE_BLOCKS_1_13_2);
    const end = ANCHOR_VERSIONS.indexOf(anchor);
    for (let i = 1; i < end; i++) {
      const diff = VERSION_DIFFS.find(
        (d) => d.from === ANCHOR_VERSIONS[i] && d.to === ANCHOR_VERSIONS[i + 1],
      );
      if (!diff) continue;
      for (const id of diff.removedBlocks) blocks.delete(id);
      for (const [from, to] of Object.entries(diff.renamedBlocks)) {
        blocks.delete(from);
        blocks.add(to);
      }
      for (const id of diff.addedBlocks) blocks.add(id);
    }
  }
  cache.set(anchor, blocks);
  return blocks;
}

/** Block ids (`minecraft:<name>`) present in `version`. */
export function vanillaBlocksForVersion(
  version: MinecraftVersion,
): ReadonlySet<string> {
  return vanillaBlocksAtAnchor(anchorFor(version));
}
