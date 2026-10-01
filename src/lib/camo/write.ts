// Camo slot writes.
//
// Replaces the material of chosen camo slots in a block entity, or empties
// them, and creates the block entity of a camo block that has none. Camo
// swaps (swap.ts) and version translation (schemlib version-mapping.ts) both
// write through here, so NBT is written in one place.
//
// NBT written per mod (see extract.ts for the formats):
//   - FramedBlocks: camo / camo_two get the new state, and type
//     framedblocks:block (a fluid camo loses its fluid keys). Emptied, they
//     keep only type framedblocks:empty.
//   - Single-state copycats: Material, plus Item.id, because Copycats+ drops
//     the camo in-game when Item doesn't match Material. Emptied, Material
//     is create:copycat_base and Item is {}.
//   - Copycats+ multi-state: material_data.<part>.material and
//     consumedItem.id, for the same reason. Emptied as above.
//
// New block entities hold only the id and the (empty) camo slots, as the
// mods save an empty block; the mods fill in their other fields on load.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type { NbtCompoundValue, NbtValue } from "../nbt-value";
import { camoBlockEntityType } from "./block-entity-type";
import { defaultCamoSlots, multiStateParts } from "./extract";

export interface CamoTarget {
  blockId: string;
  properties: Record<string, string>;
}

/** Write options. */
export interface CamoWriteOptions {
  /**
   * Item stacks before 1.20.5 save their count as `Count` (a byte) rather
   * than `count` (an int); set it to add a missing count the old way.
   */
  legacyItemCount?: boolean;
}

const FRAMED_BLOCK = "framedblocks:block";
const FRAMED_EMPTY = "framedblocks:empty";
const COPYCAT_BASE = "create:copycat_base";

export function stateKey(
  name: string,
  properties: Record<string, string>,
): string {
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return name;
  return `${name}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`;
}

const str = (value: string): NbtValue => ({ type: "string", value });

/** A `{Name, Properties?}` compound, as NbtUtils.writeBlockState writes it. */
function stateCompound(target: CamoTarget): NbtCompoundValue {
  const entries: Record<string, NbtValue> = { Name: str(target.blockId) };
  const keys = Object.keys(target.properties).sort();
  if (keys.length > 0) {
    entries.Properties = {
      type: "compound",
      entries: Object.fromEntries(
        keys.map((k) => [k, str(target.properties[k])]),
      ),
    };
  }
  return { type: "compound", entries };
}

function compoundAt(
  tag: NbtCompoundValue,
  key: string,
): NbtCompoundValue | undefined {
  const value = Object.hasOwn(tag.entries, key) ? tag.entries[key] : undefined;
  return value?.type === "compound" ? value : undefined;
}

const compound = (entries: Record<string, NbtValue>): NbtCompoundValue => ({
  type: "compound",
  entries,
});

const EMPTY_ITEM = compound({});

/**
 * An item compound with its id set to `id`. Keeps the existing count (either
 * 1.20.1's `Count` or 1.21's `count`) and adds a count of 1 when there is
 * none (`Count:1b` with `legacyItemCount`, else `count:1`).
 */
function itemWithId(
  item: NbtCompoundValue | undefined,
  id: string,
  options: CamoWriteOptions | undefined,
): NbtCompoundValue {
  const entries: Record<string, NbtValue> = {
    ...(item?.entries ?? {}),
    id: str(id),
  };
  if (!Object.hasOwn(entries, "count") && !Object.hasOwn(entries, "Count")) {
    if (options?.legacyItemCount) entries.Count = { type: "byte", value: 1 };
    else entries.count = { type: "int", value: 1 };
  }
  return compound(entries);
}

/**
 * The block entity of `blockId` with every camo slot empty, as the mod saves
 * an empty block, or undefined for blocks that don't save camo.
 */
export function newCamoBlockEntity(
  blockId: string,
  blockProperties: Record<string, string>,
): NbtCompoundValue | undefined {
  const type = camoBlockEntityType(blockId);
  const slots = defaultCamoSlots(blockId, blockProperties);
  if (type === undefined || slots.length === 0) return undefined;
  const entries: Record<string, NbtValue> = { id: str(type) };
  if (blockId.startsWith("framedblocks:")) {
    for (const slot of slots) {
      entries[slot] = compound({ type: str(FRAMED_EMPTY) });
    }
  } else if (multiStateParts(blockId, blockProperties) !== undefined) {
    entries.material_data = compound(
      Object.fromEntries(
        slots.map((part) => [
          part,
          compound({
            material: stateCompound({ blockId: COPYCAT_BASE, properties: {} }),
            enableCT: { type: "byte", value: 1 },
            consumedItem: EMPTY_ITEM,
          }),
        ]),
      ),
    );
  } else {
    entries.Material = stateCompound({ blockId: COPYCAT_BASE, properties: {} });
    entries.Item = EMPTY_ITEM;
    entries.EnableCT = { type: "byte", value: 1 };
  }
  return compound(entries);
}

/**
 * Block-entity NBT with the camo in `slots` replaced by `target`, or emptied
 * when `target` is null.
 */
export function writeCamoSlots(
  blockId: string,
  nbt: NbtCompoundValue,
  slots: ReadonlySet<string>,
  target: CamoTarget | null,
  options?: CamoWriteOptions,
): NbtCompoundValue {
  const entries = { ...nbt.entries };
  const material = stateCompound(
    target ?? { blockId: COPYCAT_BASE, properties: {} },
  );
  const item = (existing: NbtCompoundValue | undefined) =>
    target === null
      ? EMPTY_ITEM
      : itemWithId(existing, target.blockId, options);

  if (blockId.startsWith("framedblocks:")) {
    for (const slot of slots) {
      const camo = compoundAt(nbt, slot);
      if (camo === undefined) continue;
      // Drop the fluid keys a fluid camo carries. Saves without a `type`
      // (older FramedBlocks) stay without one.
      const {
        fluid: _fluid,
        flow_dir: _flowDir,
        state: _state,
        ...rest
      } = camo.entries;
      if (Object.hasOwn(rest, "type")) {
        rest.type = str(target === null ? FRAMED_EMPTY : FRAMED_BLOCK);
      }
      entries[slot] = compound(
        target === null ? rest : { ...rest, state: stateCompound(target) },
      );
    }
    return compound(entries);
  }

  const materialData = compoundAt(nbt, "material_data");
  if (materialData !== undefined) {
    const parts = { ...materialData.entries };
    for (const slot of slots) {
      const part = compoundAt(materialData, slot);
      if (part === undefined) continue;
      parts[slot] = compound({
        ...part.entries,
        material,
        consumedItem: item(compoundAt(part, "consumedItem")),
      });
    }
    entries.material_data = compound(parts);
    return compound(entries);
  }

  // Single-state copycats, and multi-state blocks saved with a legacy plain
  // Material (all of their parts share it).
  entries.Material = material;
  entries.Item = item(compoundAt(nbt, "Item"));
  return compound(entries);
}
