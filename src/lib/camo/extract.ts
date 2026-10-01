// Camo slots of framed (FramedBlocks) and copycat (Create, Copycats+) blocks.
//
// Reads a block entity's camo data into one normalized, ordered slot list, so
// rendering, the material list and swapping agree on what a camo block holds.
//
// Block-entity formats (see tasks/prd.json US-001 notes and CAMO_FIXTURES.md):
//   - FramedBlocks: camo:{type, state:{Name, Properties?}}, doubles add
//     camo_two. `type` is framedblocks:block, framedblocks:empty or
//     framedblocks:fluid (with fluid and flow_dir).
//   - Create / Copycats+ single-state: Material:{Name, Properties?},
//     Item:{id, count} (Count on 1.20.1), EnableCT. create:copycat_base is an
//     empty camo.
//   - Copycats+ multi-state: material_data:{<part>:{material, enableCT,
//     consumedItem}}. Older saves hold a plain Material instead, which Copycats+
//     migrates onto the parts that the block state enables.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type { NbtCompoundValue, NbtValue } from "../nbt-value";
import { CAMO_BLOCK_IDS, DOUBLE_CAMO_BLOCK_IDS } from "./camo-blocks.generated";

export interface CamoState {
  name: string;
  properties: Record<string, string>;
}

export type CamoSlotKind = "block" | "fluid" | "empty";

export interface CamoSlot {
  slot: string;
  /** null when `kind` is "empty". For a fluid, `name` is the fluid id. */
  state: CamoState | null;
  kind: CamoSlotKind;
}

const COPYCAT_BASE = "create:copycat_base";
const FRAMED_EMPTY = "framedblocks:empty";
const FRAMED_FLUID = "framedblocks:fluid";
const FRAMED_SLOTS = ["camo", "camo_two"];
const COPYCAT_SLOT = "material";
const CAMO_BLOCKS: ReadonlySet<string> = new Set(CAMO_BLOCK_IDS);
const DOUBLE_CAMO_BLOCKS: ReadonlySet<string> = new Set(DOUBLE_CAMO_BLOCK_IDS);

export function isCamoCapableBlockId(id: string): boolean {
  return (
    id.startsWith("framedblocks:") ||
    id.startsWith("copycats:") ||
    id.startsWith("create:copycat_")
  );
}

// ── Copycats+ multi-state parts ─────────────────────────────────────────────
//
// Part names come from each block's storageProperties(), and `enabled` ports
// its partExists(state, part). `parts` fixes the slot order.

interface MultiStateParts {
  parts: string[];
  enabled: (properties: Record<string, string>, part: string) => boolean;
}

const isTrue = (properties: Record<string, string>, part: string) =>
  properties[part] === "true";

const hasLayers = (properties: Record<string, string>, part: string) =>
  Number(properties[part] ?? "0") > 0;

const LAYER_PARTS: MultiStateParts = {
  parts: ["positive_layers", "negative_layers"],
  enabled: hasLayers,
};

const COGWHEEL_PARTS: MultiStateParts = {
  parts: ["cogwheel", "shaft"],
  enabled: () => true,
};

const MULTI_STATE_BLOCKS: Record<string, MultiStateParts> = {
  "copycats:copycat_slab": {
    parts: ["bottom", "top"],
    enabled: (properties, part) =>
      properties.type === "double" || properties.type === part,
  },
  "copycats:copycat_board": {
    parts: ["up", "down", "north", "east", "south", "west"],
    enabled: isTrue,
  },
  "copycats:copycat_byte": {
    parts: [
      "top_northeast",
      "top_northwest",
      "top_southeast",
      "top_southwest",
      "bottom_northeast",
      "bottom_northwest",
      "bottom_southeast",
      "bottom_southwest",
    ],
    enabled: isTrue,
  },
  "copycats:copycat_byte_panel": {
    parts: ["bottom_left", "bottom_right", "top_left", "top_right"],
    enabled: isTrue,
  },
  "copycats:copycat_half_layer": LAYER_PARTS,
  "copycats:copycat_vertical_half_layer": LAYER_PARTS,
  "copycats:copycat_stacked_half_layer": LAYER_PARTS,
  "copycats:copycat_cogwheel": COGWHEEL_PARTS,
  "copycats:copycat_large_cogwheel": COGWHEEL_PARTS,
};

// ── NBT helpers ─────────────────────────────────────────────────────────────

function compoundEntry(
  tag: NbtCompoundValue | undefined,
  key: string,
): NbtCompoundValue | undefined {
  const value =
    tag && Object.hasOwn(tag.entries, key) ? tag.entries[key] : undefined;
  return value?.type === "compound" ? value : undefined;
}

function stringEntry(
  tag: NbtCompoundValue | undefined,
  key: string,
): string | undefined {
  const value =
    tag && Object.hasOwn(tag.entries, key) ? tag.entries[key] : undefined;
  return value?.type === "string" ? value.value : undefined;
}

function scalarString(value: NbtValue): string | undefined {
  switch (value.type) {
    case "string":
      return value.value;
    case "byte":
    case "short":
    case "int":
    case "float":
    case "double":
      return String(value.value);
    case "long":
      return value.value.toString();
    default:
      return undefined;
  }
}

/** A `{Name, Properties?}` compound as written by NbtUtils.writeBlockState. */
function readState(tag: NbtCompoundValue | undefined): CamoState | null {
  const name = stringEntry(tag, "Name");
  if (name === undefined) return null;
  const properties: Record<string, string> = {};
  const props = compoundEntry(tag, "Properties");
  for (const [key, value] of Object.entries(props?.entries ?? {})) {
    const text = scalarString(value);
    if (text !== undefined) properties[key] = text;
  }
  return { name, properties };
}

const empty = (slot: string): CamoSlot => ({
  slot,
  state: null,
  kind: "empty",
});

// ── Extraction ──────────────────────────────────────────────────────────────

function framedSlot(slot: string, camo: NbtCompoundValue): CamoSlot {
  const type = stringEntry(camo, "type");
  if (type === FRAMED_EMPTY) return empty(slot);
  if (type === FRAMED_FLUID) {
    // Saved as the fluid's registry name; accept a {Name} compound too.
    const name =
      stringEntry(camo, "fluid") ??
      readState(compoundEntry(camo, "fluid"))?.name;
    return name === undefined
      ? empty(slot)
      : { slot, state: { name, properties: {} }, kind: "fluid" };
  }
  const state = readState(compoundEntry(camo, "state"));
  return state === null ? empty(slot) : { slot, state, kind: "block" };
}

function copycatSlot(slot: string, state: CamoState | null): CamoSlot {
  return state === null || state.name === COPYCAT_BASE
    ? empty(slot)
    : { slot, state, kind: "block" };
}

function sameState(state: CamoState | null): CamoState | null {
  return state && { name: state.name, properties: { ...state.properties } };
}

/**
 * The camo slots of the block entity on a camo-capable block, in slot order.
 * Returns [] for blocks that aren't camo-capable and for block entities with
 * no camo data. `Item` / `consumedItem` are never read, so 1.20.1's `Count`
 * and 1.21.1+'s `count` both work.
 */
export function extractCamoSlots(
  blockId: string,
  blockProperties: Record<string, string>,
  blockEntityNbt: NbtCompoundValue | undefined,
): CamoSlot[] {
  if (!isCamoCapableBlockId(blockId) || blockEntityNbt === undefined) return [];

  if (blockId.startsWith("framedblocks:")) {
    return FRAMED_SLOTS.flatMap((slot) => {
      const camo = compoundEntry(blockEntityNbt, slot);
      return camo === undefined ? [] : [framedSlot(slot, camo)];
    });
  }

  const multi = Object.hasOwn(MULTI_STATE_BLOCKS, blockId)
    ? MULTI_STATE_BLOCKS[blockId]
    : undefined;
  const materialData = compoundEntry(blockEntityNbt, "material_data");
  if (materialData !== undefined) {
    // Known parts first, in the block's order, then any the table misses.
    const known = multi?.parts ?? [];
    const parts = [
      ...known.filter((part) => Object.hasOwn(materialData.entries, part)),
      ...Object.keys(materialData.entries).filter(
        (part) => !known.includes(part),
      ),
    ];
    return parts.flatMap((part) => {
      const entry = compoundEntry(materialData, part);
      if (entry === undefined) return [];
      return [copycatSlot(part, readState(compoundEntry(entry, "material")))];
    });
  }

  const material = compoundEntry(blockEntityNbt, "Material");
  if (material === undefined) return [];
  const state = readState(material);
  if (multi !== undefined) {
    return multi.parts
      .filter((part) => multi.enabled(blockProperties, part))
      .map((part) => copycatSlot(part, sameState(state)));
  }
  return [copycatSlot(COPYCAT_SLOT, state)];
}

/** The Copycats+ multi-state parts `blockId` has, or undefined. */
export function multiStateParts(
  blockId: string,
  blockProperties: Record<string, string>,
): string[] | undefined {
  if (!Object.hasOwn(MULTI_STATE_BLOCKS, blockId)) return undefined;
  const multi = MULTI_STATE_BLOCKS[blockId];
  return multi.parts.filter((part) => multi.enabled(blockProperties, part));
}

/**
 * The camo slots a camo block has before it has any camo data (a block just
 * swapped in, whose block entity was dropped): `camo` (plus `camo_two` on
 * double blocks), a multi-state copycat's enabled parts, or `material`.
 * Empty for blocks that don't save camo (create:copycat_base, the framing
 * saw).
 */
export function defaultCamoSlots(
  blockId: string,
  blockProperties: Record<string, string>,
): string[] {
  if (!CAMO_BLOCKS.has(blockId)) return [];
  if (blockId.startsWith("framedblocks:")) {
    return DOUBLE_CAMO_BLOCKS.has(blockId)
      ? [...FRAMED_SLOTS]
      : [FRAMED_SLOTS[0]];
  }
  return multiStateParts(blockId, blockProperties) ?? [COPYCAT_SLOT];
}

/**
 * The camo slots of a placed camo block: `extractCamoSlots` of its block
 * entity, or every `defaultCamoSlots` slot, empty, when it has none.
 */
export function placedCamoSlots(
  blockId: string,
  blockProperties: Record<string, string>,
  blockEntityNbt: NbtCompoundValue | undefined,
): CamoSlot[] {
  if (blockEntityNbt !== undefined) {
    return extractCamoSlots(blockId, blockProperties, blockEntityNbt);
  }
  return defaultCamoSlots(blockId, blockProperties).map(empty);
}
