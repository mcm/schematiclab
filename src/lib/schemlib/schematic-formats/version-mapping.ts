// Port of schemlib/schematic_formats/version_mapping.py (Python) -> TypeScript.
//
// The Python original delegated block-state translation to PyMCTranslate
// (non-OSS-friendly). Here we use a codegen'd diff chain built from
// PrismarineJS/minecraft-data (1.12 ↔ 1.13 flatten table, 1.13 block schema)
// and misode/mcmeta (per-release block schemas for 1.14+), with a small
// hand-curated overrides file for renames. See:
//   - scripts/generate-block-translations.mts (codegen)
//   - src/lib/schemlib/data/translate.ts      (runtime)
//   - src/lib/schemlib/data/manual-overrides.ts

import { Block, AbstractPos, BlockState } from "../blocks";
import { Entity } from "../entities";
import { KNOWN_VERSIONS } from "./known-versions";
import { translateBlockState, type TranslateOptions } from "../data/translate";
import {
  fromNbtCompoundValue,
  toNbtCompoundValue,
  type NbtCompoundValue,
} from "../../nbt-value";
import { extractCamoSlots, isCamoCapableBlockId } from "../../camo/extract";
import { stateKey, writeCamoSlots, type CamoTarget } from "../../camo/write";

// ── MinecraftVersion ──────────────────────────────────────────────────────

export interface MinecraftVersion {
  readonly platform: "java";
  readonly versionNumber: readonly [number, number, number]; // e.g. [1, 20, 1]
  readonly dataVersion: number;
}

export { KNOWN_VERSIONS };

export function getVersion(versionString: string): MinecraftVersion {
  const v = KNOWN_VERSIONS[versionString];
  if (!v) throw new Error(`Unknown Minecraft version: ${versionString}`);
  return v;
}

export function versionsEqual(
  a: MinecraftVersion,
  b: MinecraftVersion,
): boolean {
  return (
    a.platform === b.platform &&
    a.versionNumber.join(".") === b.versionNumber.join(".")
  );
}

export function getVersionFromDataVersion(
  dataVersion: number,
): MinecraftVersion {
  for (const v of Object.values(KNOWN_VERSIONS)) {
    if (v.dataVersion === dataVersion) return v;
  }
  throw new Error(`No known version for data version ${dataVersion}`);
}

// ── posKey ────────────────────────────────────────────────────────────────
//
// JavaScript's `Map` uses reference equality for object keys, so we can't key
// a block matrix by tuple position objects. We canonicalize to a `"x,y,z"`
// string instead.

export function posKey(pos: AbstractPos<number>): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

// ── MinecraftVersionMapper ────────────────────────────────────────────────

export class MinecraftVersionMapper {
  constructor(
    public readonly blockMatrix: Map<string, Block>,
    public readonly sourceVersion: MinecraftVersion,
  ) {}

  static getVersion(versionString: string): MinecraftVersion {
    return getVersion(versionString);
  }

  mapBlock(
    block: Block,
    targetVersion: MinecraftVersion,
    options?: TranslateOptions,
  ): Block {
    const translated = translateBlockState(
      block.state,
      this.sourceVersion,
      targetVersion,
      options,
    );
    return new Block(block.pos, translated);
  }

  /**
   * `blockEntity` with its camo states (FramedBlocks / copycat materials)
   * translated to `targetVersion`. `block` is the block the entity belongs
   * to, in the source version. Returns `blockEntity` itself when nothing
   * changes.
   */
  mapBlockEntity(
    block: Block,
    blockEntity: Entity,
    targetVersion: MinecraftVersion,
    options?: CamoTranslateOptions,
  ): Entity {
    if (!isCamoCapableBlockId(block.state.Name)) return blockEntity;
    const properties = Object.fromEntries(block.state.Properties);
    const source = toNbtCompoundValue(blockEntity.toCompound());
    const translated = translateCamoStates(
      { blockId: block.state.Name, properties },
      source,
      this.sourceVersion,
      targetVersion,
      options,
    );
    if (translated === source) return blockEntity;
    return new Entity(fromNbtCompoundValue(translated));
  }
}

// ── Camo states ───────────────────────────────────────────────────────────

export interface CamoTranslateOptions extends TranslateOptions {
  /**
   * A target for `state` that replaces the natural translation (a user
   * override, or a loaded mod's state passing through). Return undefined to
   * translate normally.
   */
  resolve?: (state: CamoTarget, stateKey: string) => CamoTarget | undefined;
}

/** A translation warning for a camo state, naming its parent block and slot. */
export function camoWarning(
  parentBlockState: string,
  slot: string,
  message: string,
): string {
  return `${parentBlockState} camo slot "${slot}": ${message}`;
}

/**
 * Block-entity NBT with every block camo slot translated from `fromVersion`
 * to `toVersion`, like a placed block. Fluid and empty slots are left alone.
 * Warnings name the parent block state and the slot. Returns `nbt` itself
 * when no slot changes.
 */
export function translateCamoStates(
  parent: CamoTarget,
  nbt: NbtCompoundValue,
  fromVersion: MinecraftVersion,
  toVersion: MinecraftVersion,
  options?: CamoTranslateOptions,
): NbtCompoundValue {
  const slots = extractCamoSlots(parent.blockId, parent.properties, nbt);
  if (slots.length === 0) return nbt;
  const parentKey = stateKey(parent.blockId, parent.properties);

  // Slots grouped by their new state, so each state is written once.
  const targets = new Map<string, { target: CamoTarget; slots: Set<string> }>();
  for (const { slot, state, kind } of slots) {
    if (kind !== "block" || state === null) continue;
    const sourceKey = stateKey(state.name, state.properties);
    const source = { blockId: state.name, properties: state.properties };
    let target = options?.resolve?.(source, sourceKey);
    if (target === undefined) {
      const translated = translateBlockState(
        new BlockState({ Name: state.name, Properties: state.properties }),
        fromVersion,
        toVersion,
        {
          onWarning: (message) =>
            options?.onWarning?.(camoWarning(parentKey, slot, message)),
        },
      );
      target = {
        blockId: translated.Name,
        properties: Object.fromEntries(translated.Properties),
      };
    }
    const targetKey = stateKey(target.blockId, target.properties);
    if (targetKey === sourceKey) continue;
    const group = targets.get(targetKey);
    if (group) group.slots.add(slot);
    else targets.set(targetKey, { target, slots: new Set([slot]) });
  }

  let out = nbt;
  for (const { target, slots: group } of targets.values()) {
    out = writeCamoSlots(parent.blockId, out, group, target);
  }
  return out;
}
