// Runtime block-state translator. Consumes the bundle emitted by
// `scripts/generate-block-translations.mts` and walks the anchor chain.

import { Block, BlockState } from "../blocks";
import type { MinecraftVersion } from "../schematic-formats/version-mapping";
import {
  FLATTEN_TABLE,
  REVERSE_FLATTEN_TABLE,
  VERSION_DIFFS,
} from "./block-translations.generated";
import { FORGE_1_12_FLATTEN } from "./forge-1.12-flatten.generated";
import { ANCHOR_VERSIONS, type AnchorVersion, type VersionDiff } from "./types";

export interface TranslateOptions {
  /** Invoked with a human-readable message when a translation loses info
   *  (e.g. a 1.20-only block being mapped to air for 1.13). */
  onWarning?: (message: string) => void;
}

// ── Version → anchor bucketing ─────────────────────────────────────────────
//
// Block schemas don't change within a single major.minor (1.16.0 has the same
// blocks as 1.16.5), so we bucket each input version to the anchor sharing its
// major.minor. Versions newer than the latest anchor fall back to it (e.g.
// 1.21.9 → 1.21.4); versions older than the oldest anchor fall back to it
// (anything < 1.12.2 we treat as 1.12.2-equivalent, but that's not really
// supported and likely to lose data).

const ANCHOR_TUPLES: ReadonlyArray<{
  anchor: AnchorVersion;
  tuple: readonly [number, number, number];
}> = ANCHOR_VERSIONS.map((anchor) => {
  const [maj, min, patch] = anchor.split(".").map(Number);
  return { anchor, tuple: [maj, min, patch] as const };
});

function compareTuples(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function anchorFor(version: MinecraftVersion): AnchorVersion {
  const [maj, min] = version.versionNumber;
  // Exact major.minor match first.
  for (const { anchor, tuple } of ANCHOR_TUPLES) {
    if (tuple[0] === maj && tuple[1] === min) return anchor;
  }
  // Newer-than-latest: clamp to the latest anchor.
  const last = ANCHOR_TUPLES[ANCHOR_TUPLES.length - 1];
  if (compareTuples(version.versionNumber, last.tuple) > 0) return last.anchor;
  // Older-than-oldest: clamp to the oldest anchor.
  return ANCHOR_TUPLES[0].anchor;
}

// ── Flatten table (1.12 ↔ 1.13) ────────────────────────────────────────────

function applyFlatten(
  state: BlockState,
  opts: TranslateOptions | undefined,
): BlockState {
  // Pre-flatten blocks arrive in one of two shapes:
  //   1. Synthetic "minecraft:#id:meta" (produced by a hypothetical MCEdit
  //      .schematic reader so legacy id+metadata round-trips through BlockState).
  //   2. Forge 1.12 IBlockState NBT form, like "minecraft:planks[variant=spruce]"
  //      — this is what Building Gadgets V0 templates and similar Forge-era
  //      formats actually serialize.
  // We try (1) first, then (2), then fall through to identity.
  const raw = state.Name.startsWith("minecraft:#")
    ? state.Name.slice("minecraft:#".length)
    : state.Name.startsWith("#")
      ? state.Name.slice(1)
      : null;
  if (raw !== null) {
    const flattened = FLATTEN_TABLE[raw];
    if (!flattened) {
      opts?.onWarning?.(`No flatten mapping for legacy id ${raw}; using air`);
      return BlockState.AIR_BLOCK;
    }
    return BlockState.fromString(flattened);
  }

  // Forge-named lookup. Try exact match on full state string first; fall back
  // to bare name (for blocks where BG omitted runtime-computed props).
  const exact = FORGE_1_12_FLATTEN[state.toString()];
  if (exact !== undefined) {
    const flattened = FLATTEN_TABLE[exact];
    if (flattened) return BlockState.fromString(flattened);
    opts?.onWarning?.(
      `Forge name ${state.toString()} mapped to legacy id ${exact}, but no post-flatten mapping exists; leaving as-is`,
    );
    return state;
  }
  const bare = FORGE_1_12_FLATTEN[state.Name];
  if (bare !== undefined) {
    const flattened = FLATTEN_TABLE[bare];
    if (flattened) return BlockState.fromString(flattened);
    opts?.onWarning?.(
      `Forge name ${state.Name} mapped to legacy id ${bare}, but no post-flatten mapping exists; leaving as-is`,
    );
    return state;
  }
  // Unknown Forge name — pass through and let the diff walker have a try.
  return state;
}

function applyReverseFlatten(
  state: BlockState,
  opts: TranslateOptions | undefined,
): BlockState {
  // Try an exact match on the canonical blockstate string first.
  const exact = REVERSE_FLATTEN_TABLE[state.toString()];
  if (exact !== undefined) {
    return new BlockState({ Name: `minecraft:#${exact}` });
  }
  // Fallback: strip properties and try the bare name (e.g. for stairs whose
  // shape/waterlogged properties post-date the flatten).
  const bare = REVERSE_FLATTEN_TABLE[state.Name];
  if (bare !== undefined) {
    return new BlockState({ Name: `minecraft:#${bare}` });
  }
  opts?.onWarning?.(
    `No reverse flatten mapping for ${state.toString()}; using air`,
  );
  return new BlockState({ Name: "minecraft:#0:0" });
}

// ── Per-property default value heuristic ───────────────────────────────────

function defaultValueFor(values: readonly string[]): string {
  if (
    values.length === 2 &&
    values.includes("true") &&
    values.includes("false")
  ) {
    return "false";
  }
  // Integers like ["0","1",...] — pick lowest.
  if (values.every((v) => /^\d+$/.test(v))) {
    return values[0];
  }
  // Enums — first declared value.
  return values[0];
}

// ── Forward / backward diff application ────────────────────────────────────

function applyDiffForward(
  state: BlockState,
  diff: VersionDiff,
  opts: TranslateOptions | undefined,
): BlockState {
  const originalName = state.Name;
  const props = new Map(state.Properties);

  // Property changes are keyed by the from-side name (pre-rename).
  const change = diff.propertyChanges[originalName];
  if (change) {
    for (const p of change.removed) props.delete(p);
    for (const [p, values] of Object.entries(change.added)) {
      const userDefault = diff.addedDefaults[originalName]?.[p];
      props.set(p, userDefault ?? defaultValueFor(values));
    }
    for (const [p, renames] of Object.entries(change.valueRenames)) {
      const cur = props.get(p);
      if (cur !== undefined && renames[cur] !== undefined) {
        props.set(p, renames[cur]);
      }
    }
  }

  const renamed = diff.renamedBlocks[originalName];
  const name = renamed ?? originalName;

  // Removed-block check uses the from-side name (renames consume their
  // sources during codegen, so a renamed block won't appear in removedBlocks).
  if (!renamed && diff.removedBlocks.includes(originalName)) {
    const fallback = diff.removedFallbacks[originalName];
    if (fallback) {
      opts?.onWarning?.(
        `Block ${originalName} was removed in ${diff.to}; substituting ${fallback}`,
      );
      return BlockState.fromString(fallback);
    }
    opts?.onWarning?.(
      `Block ${originalName} was removed in ${diff.to}; replacing with air`,
    );
    return BlockState.AIR_BLOCK;
  }

  return new BlockState({ Name: name, Properties: props });
}

function applyDiffBackward(
  state: BlockState,
  diff: VersionDiff,
  opts: TranslateOptions | undefined,
): BlockState {
  // Invert the rename so we're working in from-side names.
  let name = state.Name;
  for (const [src, tgt] of Object.entries(diff.renamedBlocks)) {
    if (tgt === name) {
      name = src;
      break;
    }
  }

  // If this block didn't exist in `from` at all (added forward), we have to
  // drop it.
  if (name === state.Name && diff.addedBlocks.includes(state.Name)) {
    opts?.onWarning?.(
      `Block ${state.Name} didn't exist in ${diff.from}; replacing with air`,
    );
    return BlockState.AIR_BLOCK;
  }

  const props = new Map(state.Properties);
  const change = diff.propertyChanges[name];
  if (change) {
    // Forward added these properties — backward removes them.
    for (const p of Object.keys(change.added)) props.delete(p);
    // Forward removed these properties — backward re-adds with a default.
    // We don't have the from-side schema at runtime, so addedDefaults can
    // optionally supply a value; otherwise "false" is the safest guess (most
    // such props are booleans).
    for (const p of change.removed) {
      const userDefault = diff.addedDefaults[name]?.[p];
      props.set(p, userDefault ?? "false");
    }
    // Invert value renames.
    for (const [p, renames] of Object.entries(change.valueRenames)) {
      const cur = props.get(p);
      if (cur === undefined) continue;
      for (const [oldV, newV] of Object.entries(renames)) {
        if (newV === cur) {
          props.set(p, oldV);
          break;
        }
      }
    }
  }

  return new BlockState({ Name: name, Properties: props });
}

// ── Top-level translator ───────────────────────────────────────────────────

export function translateBlockState(
  state: BlockState,
  fromVersion: MinecraftVersion,
  toVersion: MinecraftVersion,
  opts?: TranslateOptions,
): BlockState {
  if (compareTuples(fromVersion.versionNumber, toVersion.versionNumber) === 0) {
    return state;
  }

  const fromAnchor = anchorFor(fromVersion);
  const toAnchor = anchorFor(toVersion);
  if (fromAnchor === toAnchor) return state;

  let cur = state;
  let fromIdx = ANCHOR_VERSIONS.indexOf(fromAnchor);
  let toIdx = ANCHOR_VERSIONS.indexOf(toAnchor);

  // Cross the 1.12 ↔ 1.13 flatten boundary if needed. Anchor 0 is 1.12.2.
  if (fromIdx === 0 && toIdx > 0) {
    cur = applyFlatten(cur, opts);
    fromIdx = 1; // we're now at 1.13.2
  }
  let endWithReverseFlatten = false;
  if (toIdx === 0 && fromIdx > 0) {
    endWithReverseFlatten = true;
    toIdx = 1; // walk to 1.13.2 first, then reverse-flatten
  }

  if (fromIdx < toIdx) {
    for (let i = fromIdx; i < toIdx; i++) {
      const diff = VERSION_DIFFS.find(
        (d) => d.from === ANCHOR_VERSIONS[i] && d.to === ANCHOR_VERSIONS[i + 1],
      );
      if (!diff) continue;
      cur = applyDiffForward(cur, diff, opts);
    }
  } else if (fromIdx > toIdx) {
    for (let i = fromIdx; i > toIdx; i--) {
      const diff = VERSION_DIFFS.find(
        (d) => d.from === ANCHOR_VERSIONS[i - 1] && d.to === ANCHOR_VERSIONS[i],
      );
      if (!diff) continue;
      cur = applyDiffBackward(cur, diff, opts);
    }
  }

  if (endWithReverseFlatten) {
    cur = applyReverseFlatten(cur, opts);
  }

  return cur;
}

// ── Cross-block fixup: doors ──────────────────────────────────────────────
//
// Pre-flatten doors split state between their two halves: the lower half's
// metadata encodes facing + open; the upper half's metadata encodes hinge +
// powered. The legacy flatten table can't see across blocks, so it fills the
// missing properties with placeholders (lower gets hinge=right/powered=false;
// upper gets facing=east/open=false). After per-block translation we patch
// both halves from each other's real values.
//
// This runs unconditionally — on post-flatten inputs each half already has
// the correct full state, so the copy is a no-op.

const DOOR_NAMES = new Set([
  "minecraft:oak_door",
  "minecraft:spruce_door",
  "minecraft:birch_door",
  "minecraft:jungle_door",
  "minecraft:acacia_door",
  "minecraft:dark_oak_door",
  "minecraft:iron_door",
  // 1.16+ additions
  "minecraft:crimson_door",
  "minecraft:warped_door",
  // 1.19+
  "minecraft:mangrove_door",
  // 1.20+
  "minecraft:bamboo_door",
  "minecraft:cherry_door",
  // 1.21+
  "minecraft:pale_oak_door",
  // copper doors (1.21)
  "minecraft:copper_door",
  "minecraft:exposed_copper_door",
  "minecraft:weathered_copper_door",
  "minecraft:oxidized_copper_door",
  "minecraft:waxed_copper_door",
  "minecraft:waxed_exposed_copper_door",
  "minecraft:waxed_weathered_copper_door",
  "minecraft:waxed_oxidized_copper_door",
]);

function posKeyXYZ(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function fixupDoors(matrix: Map<string, Block>): void {
  // First pass: collect intended patches without mutating, since both passes
  // read from the original state.
  type Patch = { key: string; props: Map<string, string> };
  const patches: Patch[] = [];

  for (const [key, block] of matrix) {
    if (!DOOR_NAMES.has(block.state.Name)) continue;
    const half = block.state.Properties.get("half");
    if (half !== "lower" && half !== "upper") continue;

    const neighborY = half === "lower" ? block.pos.y + 1 : block.pos.y - 1;
    const neighborKey = posKeyXYZ(block.pos.x, neighborY, block.pos.z);
    const neighbor = matrix.get(neighborKey);
    if (!neighbor || neighbor.state.Name !== block.state.Name) continue;
    const neighborHalf = neighbor.state.Properties.get("half");
    const expected = half === "lower" ? "upper" : "lower";
    if (neighborHalf !== expected) continue;

    const props = new Map(block.state.Properties);
    if (half === "lower") {
      // Copy hinge + powered from upper neighbor.
      const hinge = neighbor.state.Properties.get("hinge");
      const powered = neighbor.state.Properties.get("powered");
      if (hinge !== undefined) props.set("hinge", hinge);
      if (powered !== undefined) props.set("powered", powered);
    } else {
      // Copy facing + open from lower neighbor.
      const facing = neighbor.state.Properties.get("facing");
      const open = neighbor.state.Properties.get("open");
      if (facing !== undefined) props.set("facing", facing);
      if (open !== undefined) props.set("open", open);
    }
    patches.push({ key, props });
  }

  for (const { key, props } of patches) {
    const block = matrix.get(key);
    if (!block) continue;
    matrix.set(
      key,
      new Block(
        block.pos,
        new BlockState({ Name: block.state.Name, Properties: props }),
      ),
    );
  }
}
