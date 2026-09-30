// Camo slot writes.
//
// Replaces the material of chosen camo slots in a block entity. Camo swaps
// (swap.ts) and version translation (schemlib version-mapping.ts) both write
// through here, so NBT is written in one place.
//
// NBT written per mod (see extract.ts for the formats):
//   - FramedBlocks: camo / camo_two get the new state, and type
//     framedblocks:block (a fluid camo loses its fluid keys).
//   - Single-state copycats: Material, plus Item.id, because Copycats+ drops
//     the camo in-game when Item doesn't match Material.
//   - Copycats+ multi-state: material_data.<part>.material and
//     consumedItem.id, for the same reason.
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import type { NbtCompoundValue, NbtValue } from "../nbt-value";

export interface CamoTarget {
  blockId: string;
  properties: Record<string, string>;
}

const FRAMED_BLOCK = "framedblocks:block";

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

/**
 * An item compound with its id set to `id`. Keeps the existing count (either
 * 1.20.1's `Count` or 1.21's `count`) and adds `count:1` when there is none.
 */
function itemWithId(
  item: NbtCompoundValue | undefined,
  id: string,
): NbtCompoundValue {
  const entries: Record<string, NbtValue> = {
    ...(item?.entries ?? {}),
    id: str(id),
  };
  if (!Object.hasOwn(entries, "count") && !Object.hasOwn(entries, "Count")) {
    entries.count = { type: "int", value: 1 };
  }
  return { type: "compound", entries };
}

/** Block-entity NBT with the camo in `slots` replaced by `target`. */
export function writeCamoSlots(
  blockId: string,
  nbt: NbtCompoundValue,
  slots: ReadonlySet<string>,
  target: CamoTarget,
): NbtCompoundValue {
  const entries = { ...nbt.entries };
  const state = stateCompound(target);

  if (blockId.startsWith("framedblocks:")) {
    for (const slot of slots) {
      const camo = compoundAt(nbt, slot);
      if (camo === undefined) continue;
      // Drop the fluid keys a fluid camo carries. Saves without a `type`
      // (older FramedBlocks) stay without one.
      const { fluid: _fluid, flow_dir: _flowDir, ...rest } = camo.entries;
      if (Object.hasOwn(rest, "type")) rest.type = str(FRAMED_BLOCK);
      entries[slot] = { type: "compound", entries: { ...rest, state } };
    }
    return { type: "compound", entries };
  }

  const materialData = compoundAt(nbt, "material_data");
  if (materialData !== undefined) {
    const parts = { ...materialData.entries };
    for (const slot of slots) {
      const part = compoundAt(materialData, slot);
      if (part === undefined) continue;
      parts[slot] = {
        type: "compound",
        entries: {
          ...part.entries,
          material: state,
          consumedItem: itemWithId(
            compoundAt(part, "consumedItem"),
            target.blockId,
          ),
        },
      };
    }
    entries.material_data = { type: "compound", entries: parts };
    return { type: "compound", entries };
  }

  // Single-state copycats, and multi-state blocks saved with a legacy plain
  // Material (all of their parts share it).
  entries.Material = state;
  entries.Item = itemWithId(compoundAt(nbt, "Item"), target.blockId);
  return { type: "compound", entries };
}
