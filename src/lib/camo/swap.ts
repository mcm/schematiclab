// Camo material swaps.
//
// Rewrites the camo slots whose material equals a source camo state, either
// under one parent palette entry ("Swap…") or under every camo block in the
// schematic ("Replace all"). Placements and the palette's block states are
// untouched; only block-entity NBT changes, and the palette's camoMaterials
// are recomputed.
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

import type {
  ParsedCamoMaterial,
  ParsedSchematicProjection,
  ParsedSchematicRegion,
} from "../convert";
import type { NbtCompoundValue, NbtValue } from "../nbt-value";
import { extractCamoSlots, isCamoCapableBlockId } from "./extract";
import { withCamoMaterials } from "./materials";

/** The camo material to replace, as listed in a palette entry's camoMaterials. */
export type CamoSwapSource = Pick<ParsedCamoMaterial, "kind" | "blockState">;

export interface CamoSwapTarget {
  blockId: string;
  properties: Record<string, string>;
}

/**
 * "parent" changes only the slots under the palette entry with block state
 * `parentBlockState`; "all" changes every camo slot in the schematic.
 */
export type CamoSwapScope =
  | { kind: "parent"; parentBlockState: string }
  | { kind: "all" };

const FRAMED_BLOCK = "framedblocks:block";

function stateKey(name: string, properties: Record<string, string>): string {
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return name;
  return `${name}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`;
}

const posKey = (pos: readonly [number, number, number]) =>
  `${pos[0]},${pos[1]},${pos[2]}`;

const str = (value: string): NbtValue => ({ type: "string", value });

/** A `{Name, Properties?}` compound, as NbtUtils.writeBlockState writes it. */
function stateCompound(target: CamoSwapTarget): NbtCompoundValue {
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
function rewriteSlots(
  blockId: string,
  nbt: NbtCompoundValue,
  slots: ReadonlySet<string>,
  target: CamoSwapTarget,
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

/**
 * `projection` with every camo slot in `scope` whose material is `source`
 * changed to `target`. Returns `projection` itself when nothing matches or
 * the target is the source.
 */
export function swapCamoMaterial(
  projection: ParsedSchematicProjection,
  source: CamoSwapSource,
  target: CamoSwapTarget,
  scope: CamoSwapScope,
): ParsedSchematicProjection {
  const targetKey = stateKey(target.blockId, target.properties);
  if (source.kind === "block" && source.blockState === targetKey) {
    return projection;
  }

  const inScope = projection.palette.map(
    (entry) =>
      isCamoCapableBlockId(entry.blockId) &&
      (scope.kind === "all" || entry.blockState === scope.parentBlockState),
  );
  if (!inScope.includes(true)) return projection;

  let changed = false;
  const regions: ParsedSchematicRegion[] = projection.regions.map((region) => {
    if (region.blockEntities.length === 0) return region;
    const indexAt = new Map<string, number>();
    for (const placement of region.blocks) {
      if (inScope[placement.paletteIndex]) {
        indexAt.set(posKey(placement.pos), placement.paletteIndex);
      }
    }
    let regionChanged = false;
    const blockEntities = region.blockEntities.map((blockEntity) => {
      const index = indexAt.get(posKey(blockEntity.pos));
      if (index === undefined) return blockEntity;
      const entry = projection.palette[index];
      const matching = new Set(
        extractCamoSlots(entry.blockId, entry.properties, blockEntity.nbt)
          .filter(
            ({ kind, state }) =>
              kind === source.kind &&
              state !== null &&
              stateKey(state.name, state.properties) === source.blockState,
          )
          .map(({ slot }) => slot),
      );
      if (matching.size === 0) return blockEntity;
      regionChanged = true;
      return {
        pos: blockEntity.pos,
        nbt: rewriteSlots(entry.blockId, blockEntity.nbt, matching, target),
      };
    });
    if (!regionChanged) return region;
    changed = true;
    return { ...region, blockEntities };
  });
  if (!changed) return projection;

  return {
    ...projection,
    palette: withCamoMaterials(projection.palette, regions),
    regions,
  };
}
