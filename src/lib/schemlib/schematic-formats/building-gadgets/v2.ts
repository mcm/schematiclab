// Port of schemlib/schematic_formats/building_gadgets/building_gadgets_v2.py
// (Python) -> TypeScript.
//
// Building Gadgets v2 is the Minecraft-1.20+ template format. Wire format:
// JSON with three top-level keys:
//   - `name`: string
//   - `statePosArrayList`: a single SNBT string holding a Compound with
//     `blockstatemap`, `startpos`/`endpos` and `statelist`
//   - `requiredItems`: dict[str, int]

import * as nbt from "../../nbt";
import { Block, BlockPos, BlockState } from "../../blocks";
import { Entity } from "../../entities";
import { fromSnbt, toSnbt } from "../../snbt";
import { AbstractRegion, AbstractSchematic } from "../abstract";
import {
  MinecraftVersion,
  getVersion,
  posKey,
} from "../version-mapping";
import { posToUppercaseCompound, readUppercasePos } from "./common";

// ── Helpers ───────────────────────────────────────────────────────────────

function readString(tag: nbt.NbtTag | undefined): string {
  return tag instanceof nbt.StringTag ? tag.value : "";
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

// ── Types ─────────────────────────────────────────────────────────────────

export interface BuildingGadgetsV2StatePosArrayList {
  blockstatemap: BlockState[];
  startpos: BlockPos;
  endpos: BlockPos;
  statelist: number[];
}

export interface BuildingGadgetsV2SchematicInit {
  name: string;
  statePosArrayList: BuildingGadgetsV2StatePosArrayList;
  requiredItems: Record<string, number>;
}

// ── BuildingGadgetsV2Schematic ────────────────────────────────────────────

export class BuildingGadgetsV2Schematic
  extends AbstractRegion
  implements AbstractSchematic
{
  static readonly MAX_WIDTH = 500;
  static readonly MAX_HEIGHT = 500;
  static readonly MAX_LENGTH = 500;
  static readonly MAX_TOTAL_VOLUME = 100000;

  readonly name: string;
  readonly statePosArrayList: BuildingGadgetsV2StatePosArrayList;
  readonly requiredItems: Record<string, number>;

  constructor(init: BuildingGadgetsV2SchematicInit) {
    super();
    this.name = init.name;
    this.statePosArrayList = init.statePosArrayList;
    this.requiredItems = init.requiredItems;
  }

  // ── Format metadata ────────────────────────────────────────────────────

  static getFormatDescription(): string {
    return "Building Gadgets 2 (Minecraft 1.20+) Template";
  }

  static getDefaultExtension(): string {
    return "txt";
  }

  static getDefaultVersion(): MinecraftVersion {
    return getVersion("1.20.1");
  }

  // ── Load / dump ────────────────────────────────────────────────────────

  static schematicLoad(obj: string | Uint8Array): BuildingGadgetsV2Schematic {
    const text =
      typeof obj === "string" ? obj : new TextDecoder("utf-8").decode(obj);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError("BG v2: top-level JSON must be an object");
    }
    const root = parsed as Record<string, unknown>;
    const name = typeof root.name === "string" ? root.name : "";

    const spalRaw = root.statePosArrayList;
    if (typeof spalRaw !== "string") {
      throw new TypeError("BG v2: statePosArrayList must be a SNBT string");
    }
    const spalTag = fromSnbt(spalRaw);
    if (!(spalTag instanceof nbt.Compound)) {
      throw new TypeError(
        "BG v2: statePosArrayList SNBT must parse to a Compound",
      );
    }

    // blockstatemap: List<Compound>
    const blockstatemap: BlockState[] = [];
    const bsmTag = spalTag.get("blockstatemap");
    if (bsmTag instanceof nbt.NbtList) {
      for (const item of bsmTag.items) {
        if (item instanceof nbt.Compound) {
          blockstatemap.push(blockStateFromCompound(item));
        }
      }
    }

    const startpos = readUppercasePos(spalTag.get("startpos"));
    const endpos = readUppercasePos(spalTag.get("endpos"));

    const statelist: number[] = [];
    const stateListTag = spalTag.get("statelist");
    if (stateListTag instanceof nbt.IntArray) {
      for (const n of stateListTag.toObject() as number[]) {
        statelist.push(n);
      }
    } else if (stateListTag instanceof nbt.NbtList) {
      for (const item of stateListTag.items) {
        const v = (item as unknown as { value: number | bigint }).value;
        statelist.push(typeof v === "bigint" ? Number(v) : (v as number));
      }
    }

    const requiredItems: Record<string, number> = {};
    if (typeof root.requiredItems === "object" && root.requiredItems !== null) {
      for (const [k, v] of Object.entries(
        root.requiredItems as Record<string, unknown>,
      )) {
        requiredItems[k] = typeof v === "number" ? v : Number(v);
      }
    }

    return new BuildingGadgetsV2Schematic({
      name,
      statePosArrayList: { blockstatemap, startpos, endpos, statelist },
      requiredItems,
    });
  }

  /** Build the inner SNBT Compound representation of `statePosArrayList`. */
  private statePosArrayListToCompound(): nbt.Compound {
    return new nbt.Compound({
      blockstatemap: new nbt.NbtList(
        this.statePosArrayList.blockstatemap.map((s) => s.toCompound()),
      ),
      startpos: posToUppercaseCompound(this.statePosArrayList.startpos),
      endpos: posToUppercaseCompound(this.statePosArrayList.endpos),
      statelist: new nbt.IntArray(this.statePosArrayList.statelist),
    });
  }

  schematicDump(): string {
    const out = {
      name: this.name,
      statePosArrayList: toSnbt(this.statePosArrayListToCompound()),
      requiredItems: this.requiredItems,
    };
    return JSON.stringify(out);
  }

  // ── Region API ─────────────────────────────────────────────────────────

  getBlockMatrix(): Map<string, Block> {
    const palette = this.statePosArrayList.blockstatemap;
    const [width, height, length] = this.getSize();

    const blocks = new Map<string, Block>();
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const i = x + y * width + z * height * width;
          const stateIdx = this.statePosArrayList.statelist[i];
          if (stateIdx === undefined) continue;
          const state = palette[stateIdx];
          if (!state) continue;
          const pos = new BlockPos(x, y, z);
          blocks.set(posKey(pos), new Block(pos, state));
        }
      }
    }
    return blocks;
  }

  getEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getTileEntityMatrix(): Map<string, Entity> {
    return new Map();
  }

  getBoundingBox(): [BlockPos, BlockPos] {
    return [this.statePosArrayList.startpos, this.statePosArrayList.endpos];
  }

  getOrigin(): BlockPos {
    return this.statePosArrayList.startpos;
  }

  getSize(): [number, number, number] {
    const dim = this.statePosArrayList.endpos.sub(
      this.statePosArrayList.startpos,
    );
    return [Math.abs(dim.x) + 1, Math.abs(dim.y) + 1, Math.abs(dim.z) + 1];
  }

  // ── Schematic API ──────────────────────────────────────────────────────

  getMetadata(): Record<string, unknown> {
    return {};
  }

  getName(): string {
    return this.name || "unknown building gadgets v2 schematic";
  }

  getRegions(): AbstractRegion[] {
    return [this];
  }

  getRegion(idx: number): AbstractRegion {
    return this.getRegions()[idx];
  }

  getMinecraftVersion(): MinecraftVersion {
    return getVersion("1.20.1");
  }

  getDataVersion(): number {
    return this.getMinecraftVersion().dataVersion;
  }

  static checkSize(width: number, height: number, length: number): void {
    if (width > BuildingGadgetsV2Schematic.MAX_WIDTH) {
      throw new Error(
        `Width axis too big, ${width} > ${BuildingGadgetsV2Schematic.MAX_WIDTH}`,
      );
    }
    if (height > BuildingGadgetsV2Schematic.MAX_HEIGHT) {
      throw new Error(
        `Height axis too big, ${height} > ${BuildingGadgetsV2Schematic.MAX_HEIGHT}`,
      );
    }
    if (length > BuildingGadgetsV2Schematic.MAX_LENGTH) {
      throw new Error(
        `Length axis too big, ${length} > ${BuildingGadgetsV2Schematic.MAX_LENGTH}`,
      );
    }
    const volume = width * height * length;
    if (volume > BuildingGadgetsV2Schematic.MAX_TOTAL_VOLUME) {
      throw new Error(
        `Total schematic area too big, ${volume} > ${BuildingGadgetsV2Schematic.MAX_TOTAL_VOLUME}`,
      );
    }
  }

  static fromSchematic(
    _schematic: AbstractSchematic,
    _targetVersion: MinecraftVersion | null,
  ): BuildingGadgetsV2Schematic {
    throw new Error("not implemented");
  }
}
