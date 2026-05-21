// Port of schemlib/schematic_formats/structurize/blueprint.py (Python) -> TypeScript.
//
// Structurize (a.k.a. MineColonies) `.blueprint` files. Wire format: gzipped
// NBT with a single top-level Compound containing a `palette`
// (List<Compound>), a `blocks` IntArray whose bytes are reinterpreted as
// uint16 indices into the palette, plus `size_x` / `size_y` / `size_z`
// Shorts, lists of `entities` / `tile_entities` (currently ignored, parity
// with Python), and miscellaneous metadata (`architects`, `mcversion`,
// `name`, `required_mods`, `optional_data`, `version`).
//
// Like the vanilla `.nbt` structure format, this is single-region — so the
// class extends `AbstractRegion` and re-implements `AbstractSchematic`'s
// surface directly.

import * as nbt from "../../nbt";
import { Block, BlockPos, BlockState } from "../../blocks";
import { Entity } from "../../entities";
import { AbstractRegion, AbstractSchematic } from "../abstract";
import {
  MinecraftVersion,
  getVersion,
  getVersionFromDataVersion,
  posKey,
  versionsEqual,
} from "../version-mapping";

// ── Helpers ───────────────────────────────────────────────────────────────

function readInt(tag: nbt.NbtTag | undefined): number {
  if (tag === undefined) return 0;
  const v = (tag as unknown as { value: number | bigint }).value;
  return typeof v === "bigint" ? Number(v) : v;
}

function readString(tag: nbt.NbtTag | undefined): string {
  if (tag instanceof nbt.StringTag) return tag.value;
  return "";
}

function readBlockPosCompound(tag: nbt.NbtTag | undefined): BlockPos {
  if (!(tag instanceof nbt.Compound)) return BlockPos.ORIGIN;
  return new BlockPos(
    readInt(tag.get("x")),
    readInt(tag.get("y")),
    readInt(tag.get("z")),
  );
}

function blockStateFromCompound(c: nbt.Compound): BlockState {
  const name = readString(c.get("Name"));
  const propsTag = c.get("Properties");
  const props: Record<string, string> = {};
  if (propsTag instanceof nbt.Compound) {
    for (const [k, v] of propsTag.entries) {
      if (v instanceof nbt.StringTag) props[k] = v.value;
    }
  }
  return new BlockState({ Name: name, Properties: props });
}

function stringListFrom(tag: nbt.NbtTag | undefined): string[] {
  if (!(tag instanceof nbt.NbtList)) return [];
  const out: string[] = [];
  for (const item of tag.items) {
    if (item instanceof nbt.StringTag) out.push(item.value);
  }
  return out;
}

function compoundListFrom(tag: nbt.NbtTag | undefined): nbt.Compound[] {
  if (!(tag instanceof nbt.NbtList)) return [];
  const out: nbt.Compound[] = [];
  for (const item of tag.items) {
    if (item instanceof nbt.Compound) out.push(item);
  }
  return out;
}

function blockPosCompound(p: { x: number; y: number; z: number }): nbt.Compound {
  return new nbt.Compound({
    x: new nbt.Int(p.x),
    y: new nbt.Int(p.y),
    z: new nbt.Int(p.z),
  });
}

function safeGetVersionFromDataVersion(dataVersion: number): MinecraftVersion {
  try {
    return getVersionFromDataVersion(dataVersion);
  } catch {
    return getVersion("1.12.2");
  }
}

function isSubstitutionState(state: BlockState): boolean {
  // Python uses `state.Name.startswith("structurize")` (no colon) in
  // `get_block_matrix` and `startswith("structurize:")` in `get_palette`. We
  // mirror the looser `get_block_matrix` form here since both checks bracket
  // the same set of names in practice.
  return state.Name.startsWith("structurize") && state.Name.endsWith("substitution");
}

// ── StructurizeOptionalData ───────────────────────────────────────────────

export interface StructurizeOptionalData {
  primaryOffset: BlockPos;
}

export interface OptionalData {
  structurize: StructurizeOptionalData;
}

function optionalDataFromCompound(tag: nbt.NbtTag | undefined): OptionalData | null {
  if (!(tag instanceof nbt.Compound)) return null;
  const structurize = tag.get("structurize");
  if (!(structurize instanceof nbt.Compound)) return null;
  return {
    structurize: {
      primaryOffset: readBlockPosCompound(structurize.get("primary_offset")),
    },
  };
}

function optionalDataToCompound(data: OptionalData): nbt.Compound {
  return new nbt.Compound({
    structurize: new nbt.Compound({
      primary_offset: blockPosCompound(data.structurize.primaryOffset),
    }),
  });
}

// ── StructurizeBlueprint ──────────────────────────────────────────────────

export interface StructurizeBlueprintInit {
  architects?: string[] | null;
  blocks: nbt.IntArray;
  entities: nbt.Compound[];
  mcversion?: number | null;
  name: string;
  optionalData?: OptionalData | null;
  palette: BlockState[];
  requiredMods: string[];
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  tileEntities: nbt.Compound[];
  version: number;
}

export class StructurizeBlueprint extends AbstractRegion {
  readonly architects: string[] | null;
  readonly blocks: nbt.IntArray;
  readonly entities: nbt.Compound[];
  readonly mcversion: number | null;
  readonly name: string;
  readonly optionalData: OptionalData | null;
  readonly palette: BlockState[];
  readonly requiredMods: string[];
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly tileEntities: nbt.Compound[];
  readonly version: number;

  constructor(init: StructurizeBlueprintInit) {
    super();
    this.architects = init.architects ?? null;
    this.blocks = init.blocks;
    this.entities = init.entities;
    this.mcversion = init.mcversion ?? null;
    this.name = init.name;
    this.optionalData = init.optionalData ?? null;
    this.palette = init.palette;
    this.requiredMods = init.requiredMods;
    this.sizeX = init.sizeX;
    this.sizeY = init.sizeY;
    this.sizeZ = init.sizeZ;
    this.tileEntities = init.tileEntities;
    this.version = init.version;
  }

  // ── AbstractSchematic static surface ────────────────────────────────────

  static getFormatDescription(): string {
    return "Structurize / MineColonies Blueprint (.blueprint files)";
  }

  static getDefaultExtension(): string {
    return "blueprint";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.12.2");
  }

  static schematicLoad(obj: string | Uint8Array): StructurizeBlueprint {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const root = nbt.loadNbtFromBytes(bytes);

    const blocksTag = root.get("blocks");
    if (!(blocksTag instanceof nbt.IntArray)) {
      throw new Error("StructurizeBlueprint missing or invalid `blocks` IntArray");
    }

    const paletteTag = root.get("palette");
    const palette: BlockState[] = [];
    if (paletteTag instanceof nbt.NbtList) {
      for (const item of paletteTag.items) {
        if (item instanceof nbt.Compound) palette.push(blockStateFromCompound(item));
      }
    }

    const architectsTag = root.get("architects");
    const architects =
      architectsTag instanceof nbt.NbtList ? stringListFrom(architectsTag) : null;

    const mcversionTag = root.get("mcversion");
    const mcversion = mcversionTag !== undefined ? readInt(mcversionTag) : null;

    return new StructurizeBlueprint({
      architects,
      blocks: blocksTag,
      entities: compoundListFrom(root.get("entities")),
      mcversion,
      name: readString(root.get("name")),
      optionalData: optionalDataFromCompound(root.get("optional_data")),
      palette,
      requiredMods: stringListFrom(root.get("required_mods")),
      sizeX: readInt(root.get("size_x")),
      sizeY: readInt(root.get("size_y")),
      sizeZ: readInt(root.get("size_z")),
      tileEntities: compoundListFrom(root.get("tile_entities")),
      version: readInt(root.get("version")),
    });
  }

  static fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: MinecraftVersion | null,
  ): StructurizeBlueprint {
    const regions = schematic.getRegions();
    if (regions.length > 1) {
      throw new Error(`Too many regions in source schematic (${regions.length})`);
    }
    const region = schematic.getRegion(0);

    let dataVersion: number;
    let sourcePalette: BlockState[];
    let sourceBlockMatrix: Map<string, Block>;
    let sourceEntities: Entity[];
    let sourceTileEntities: Entity[];

    if (targetVersion !== null && !versionsEqual(targetVersion, region.getMinecraftVersion())) {
      dataVersion = targetVersion.dataVersion;
      sourcePalette = region.getTranslatedPalette(targetVersion);
      sourceBlockMatrix = region.getTranslatedBlockMatrix(targetVersion);
      sourceEntities = region.getTranslatedEntities(targetVersion);
      sourceTileEntities = region.getTranslatedTileEntities(targetVersion);
    } else {
      dataVersion = (targetVersion ?? schematic.getMinecraftVersion()).dataVersion;
      sourcePalette = region.getPalette();
      sourceBlockMatrix = region.getBlockMatrix();
      sourceEntities = region.getEntities();
      sourceTileEntities = region.getTileEntities();
    }

    const [width, height, length] = region.getSize();

    // Ensure AIR is at a known index in the palette. Python uses
    // `source_palette.insert(0, AIR_BLOCK)` if not present.
    const paletteCopy: BlockState[] = sourcePalette.slice();
    let airIdx = paletteCopy.findIndex((s) => s.equals(BlockState.AIR_BLOCK));
    if (airIdx === -1) {
      paletteCopy.unshift(BlockState.AIR_BLOCK);
      airIdx = 0;
    }

    const indexOfState = (state: BlockState): number => {
      for (let i = 0; i < paletteCopy.length; i++) {
        if (paletteCopy[i].equals(state)) return i;
      }
      paletteCopy.push(state);
      return paletteCopy.length - 1;
    };

    const requiredMods: string[] = [];
    const blocks: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const key = `${x},${y},${z}`;
          const block = sourceBlockMatrix.get(key);
          if (block) {
            const colonIdx = block.state.Name.indexOf(":");
            const modid = colonIdx === -1 ? block.state.Name : block.state.Name.slice(0, colonIdx);
            if (modid !== "minecraft" && modid.length > 0 && !requiredMods.includes(modid)) {
              requiredMods.push(modid);
            }
            blocks.push(indexOfState(block.state));
          } else {
            blocks.push(airIdx);
          }
        }
      }
    }

    const tileEntityCompounds: nbt.Compound[] = sourceTileEntities.map((e) => e.toCompound());
    const entityCompounds: nbt.Compound[] = sourceEntities.map((e) => e.toCompound());

    return new StructurizeBlueprint({
      architects: null,
      blocks: nbt.IntArray.packList(blocks, 16),
      entities: entityCompounds,
      mcversion: dataVersion,
      name: schematic.getName(),
      optionalData: null,
      palette: paletteCopy,
      requiredMods,
      sizeX: width,
      sizeY: height,
      sizeZ: length,
      tileEntities: tileEntityCompounds,
      version: 1,
    });
  }

  // ── AbstractSchematic instance surface ──────────────────────────────────

  getMetadata(): Record<string, unknown> {
    return {};
  }

  getName(): string {
    return this.name;
  }

  getRegions(): AbstractRegion[] {
    return [this];
  }

  getRegion(idx: number): AbstractRegion {
    return this.getRegions()[idx];
  }

  getMinecraftVersion(): MinecraftVersion {
    if (this.mcversion === null) return StructurizeBlueprint.getDefaultVersion();
    return safeGetVersionFromDataVersion(this.mcversion);
  }

  // ── AbstractRegion surface ──────────────────────────────────────────────

  getOrigin(): BlockPos {
    return BlockPos.ORIGIN;
  }

  getSize(): [number, number, number] {
    return [this.sizeX, this.sizeY, this.sizeZ];
  }

  getPalette(): BlockState[] {
    const out: BlockState[] = [];
    for (const state of this.palette) {
      if (state.Name === "minecraft:air") continue;
      if (state.Name.startsWith("structurize:") && state.Name.endsWith("substitution")) continue;
      out.push(state);
    }
    return out;
  }

  getBlockMatrix(): Map<string, Block> {
    const matrix = new Map<string, Block>();
    const blockstates = this.blocks.asUint16Array();

    for (let y = 0; y < this.sizeY; y++) {
      for (let z = 0; z < this.sizeZ; z++) {
        for (let x = 0; x < this.sizeX; x++) {
          const idx = y * this.sizeZ * this.sizeX + z * this.sizeX + x;
          const stateIdx = blockstates[idx];
          if (stateIdx === undefined || stateIdx >= this.palette.length) continue;
          const state = this.palette[stateIdx];
          if (state.Name === "minecraft:air") continue;
          if (isSubstitutionState(state)) continue;

          const pos = new BlockPos(x, y, z);
          matrix.set(posKey(pos), new Block(pos, state));
        }
      }
    }

    return matrix;
  }

  getEntityMatrix(): Map<string, Entity> {
    // Python returns `{}` here (the real lookup is commented out). Mirror.
    return new Map();
  }

  getEntities(): Entity[] {
    return [];
  }

  getTileEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  // ── Serialization ───────────────────────────────────────────────────────

  schematicDump(): Uint8Array {
    const paletteList = new nbt.NbtList<nbt.Compound>(
      this.palette.map((s) => s.toCompound()),
    );
    const entitiesList = new nbt.NbtList<nbt.Compound>(this.entities);
    const tileEntitiesList = new nbt.NbtList<nbt.Compound>(this.tileEntities);
    const requiredModsList = new nbt.NbtList<nbt.StringTag>(
      this.requiredMods.map((m) => new nbt.StringTag(m)),
    );

    const root = new nbt.Compound();
    root.set("blocks", this.blocks);
    root.set("entities", entitiesList);
    root.set("name", new nbt.StringTag(this.name));
    root.set("palette", paletteList);
    root.set("required_mods", requiredModsList);
    root.set("size_x", new nbt.Short(this.sizeX));
    root.set("size_y", new nbt.Short(this.sizeY));
    root.set("size_z", new nbt.Short(this.sizeZ));
    root.set("tile_entities", tileEntitiesList);
    root.set("version", new nbt.Byte(this.version));

    if (this.architects !== null) {
      root.set(
        "architects",
        new nbt.NbtList<nbt.StringTag>(this.architects.map((a) => new nbt.StringTag(a))),
      );
    }
    if (this.mcversion !== null) {
      root.set("mcversion", new nbt.Int(this.mcversion));
    }
    if (this.optionalData !== null) {
      root.set("optional_data", optionalDataToCompound(this.optionalData));
    }

    const named = new nbt.Named({ "": root });
    return named.toBytes({ compress: true });
  }
}
