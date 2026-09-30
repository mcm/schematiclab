import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseSchematic,
  type ParsedSchematicBlockEntity,
  type ParsedSchematicPaletteEntry,
  type ParsedSchematicProjection,
} from "../../convert";
import {
  toNbtCompoundValue,
  type NbtCompoundValue,
  type NbtValue,
} from "../../nbt-value";
import * as nbt from "../../schemlib/nbt";
import { fromSnbt } from "../../schemlib/snbt";
import { swapBlockState } from "../../swap-projection";
import {
  countCamoMaterials,
  materialTotals,
  withCamoMaterials,
} from "../materials";

function be(snbt: string): NbtCompoundValue {
  const tag = fromSnbt(snbt);
  if (!(tag instanceof nbt.Compound))
    throw new Error(`not a compound: ${snbt}`);
  return toNbtCompoundValue(tag);
}

const framed = (state: string) =>
  be(
    `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:block",state:${state}}}`,
  );
const MANGROVE = `{Name:"minecraft:mangrove_planks"}`;

function entry(
  blockId: string,
  count: number,
  properties: Record<string, string> = {},
): ParsedSchematicPaletteEntry {
  const keys = Object.keys(properties).sort();
  const blockState = keys.length
    ? `${blockId}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`
    : blockId;
  return { blockState, blockId, properties, count };
}

// One region laid out along x: placement i sits at (i, 0, 0) and uses
// palette[indices[i]]; `nbts[i]` (when set) is its block entity.
function projection(
  palette: ParsedSchematicPaletteEntry[],
  indices: number[],
  nbts: (NbtCompoundValue | undefined)[],
): ParsedSchematicProjection {
  const blockEntities: ParsedSchematicBlockEntity[] = [];
  nbts.forEach((value, x) => {
    if (value !== undefined) blockEntities.push({ pos: [x, 0, 0], nbt: value });
  });
  const regions = [
    {
      origin: [0, 0, 0] as [number, number, number],
      size: [indices.length, 1, 1] as [number, number, number],
      blocks: indices.map((paletteIndex, x) => ({
        pos: [x, 0, 0] as [number, number, number],
        paletteIndex,
      })),
      blockEntities,
    },
  ];
  return {
    name: "test",
    inputFormat: "Structure",
    minecraftVersion: {
      platform: "java",
      versionNumber: [1, 21, 1],
      dataVersion: 3955,
    },
    totalBlocks: indices.length,
    palette: withCamoMaterials(palette, regions),
    regions,
  };
}

describe("countCamoMaterials", () => {
  it("counts 3 mangrove camos plus 2 placed mangrove planks as 5", () => {
    const schematic = projection(
      [
        entry("framedblocks:framed_panel", 3),
        entry("minecraft:mangrove_planks", 2),
      ],
      [0, 0, 0, 1, 1],
      [framed(MANGROVE), framed(MANGROVE), framed(MANGROVE)],
    );
    const [panel, planks] = schematic.palette;
    expect(panel.camoMaterials).toEqual([
      {
        kind: "block",
        blockState: "minecraft:mangrove_planks",
        blockId: "minecraft:mangrove_planks",
        properties: {},
        count: 3,
      },
    ]);
    // The placed planks keep their own row and count.
    expect(planks.count).toBe(2);
    expect(planks.camoMaterials).toBeUndefined();
    expect(
      materialTotals(schematic.palette).get("minecraft:mangrove_planks"),
    ).toBe(5);
  });

  it("groups by full camo state and sorts by count", () => {
    const schematic = projection(
      [entry("framedblocks:framed_cube", 4)],
      [0, 0, 0, 0],
      [
        framed(`{Name:"minecraft:oak_log",Properties:{axis:"x"}}`),
        framed(`{Name:"minecraft:oak_log",Properties:{axis:"y"}}`),
        framed(`{Name:"minecraft:oak_log",Properties:{axis:"y"}}`),
        undefined,
      ],
    );
    expect(
      schematic.palette[0].camoMaterials?.map((m) => [m.blockState, m.count]),
    ).toEqual([
      ["minecraft:oak_log[axis=y]", 2],
      ["minecraft:oak_log[axis=x]", 1],
    ]);
  });

  it("counts each slot of a double block and multi-state copycat", () => {
    const schematic = projection(
      [
        entry("framedblocks:framed_double_slab", 1),
        entry("copycats:copycat_slab", 1, { type: "double" }),
      ],
      [0, 1],
      [
        be(
          `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:block",state:${MANGROVE}},camo_two:{type:"framedblocks:block",state:${MANGROVE}}}`,
        ),
        be(
          `{id:"copycats:multistate_copycat",material_data:{bottom:{material:${MANGROVE}},top:{material:{Name:"create:copycat_base"}}}}`,
        ),
      ],
    );
    expect(schematic.palette[0].camoMaterials?.[0].count).toBe(2);
    expect(schematic.palette[1].camoMaterials?.[0].count).toBe(1);
  });

  it("skips empty camos and lists fluids by fluid id", () => {
    const schematic = projection(
      [
        entry("framedblocks:framed_cube", 2),
        entry("create:copycat_step", 1),
        entry("create:copycat_panel", 1),
      ],
      [0, 0, 1, 2],
      [
        be(`{id:"framedblocks:framed_tile",camo:{type:"framedblocks:empty"}}`),
        be(
          `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:fluid",fluid:"minecraft:water"}}`,
        ),
        be(`{id:"create:copycat",Material:{Name:"create:copycat_base"}}`),
        undefined,
      ],
    );
    expect(schematic.palette[0].camoMaterials).toEqual([
      {
        kind: "fluid",
        blockState: "minecraft:water",
        blockId: "minecraft:water",
        properties: {},
        count: 1,
      },
    ]);
    expect(schematic.palette[1].camoMaterials).toEqual([]);
    expect(schematic.palette[2].camoMaterials).toEqual([]);
  });

  it("leaves non-camo entries without camoMaterials", () => {
    const counts = countCamoMaterials(
      [entry("minecraft:chest", 1)],
      projection(
        [entry("minecraft:chest", 1)],
        [0],
        [be(`{id:"minecraft:chest"}`)],
      ).regions,
    );
    expect(counts).toEqual([undefined]);
  });

  it("is structured-cloneable", () => {
    const schematic = projection(
      [entry("framedblocks:framed_panel", 1)],
      [0],
      [framed(MANGROVE)],
    );
    expect(structuredClone(schematic.palette)).toEqual(schematic.palette);
  });

  it("is recomputed after a block swap", () => {
    const schematic = projection(
      [entry("framedblocks:framed_panel", 2), entry("minecraft:stone", 1)],
      [0, 0, 1],
      [framed(MANGROVE), framed(MANGROVE)],
    );
    const swapped = swapBlockState(schematic, "framedblocks:framed_panel", {
      blockId: "minecraft:oak_planks",
      properties: {},
    });
    expect(swapped.palette.every((e) => e.camoMaterials === undefined)).toBe(
      true,
    );
    expect(
      materialTotals(swapped.palette).get("minecraft:mangrove_planks"),
    ).toBe(undefined);
  });
});

// ── Fixture ────────────────────────────────────────────────────────────────

// Counts camo materials straight from the raw NBT (not via extractCamoSlots):
// every `Material` / `material_data.<part>.material` compound, by Name.
function rawMaterialNames(tag: NbtCompoundValue): string[] {
  const names: string[] = [];
  const nameOf = (value: NbtValue | undefined) =>
    value?.type === "compound" && value.entries.Name?.type === "string"
      ? value.entries.Name.value
      : undefined;
  const material = nameOf(tag.entries.Material);
  if (material !== undefined) names.push(material);
  const data = tag.entries.material_data;
  if (data?.type === "compound") {
    for (const part of Object.values(data.entries)) {
      if (part.type !== "compound") continue;
      const name = nameOf(part.entries.material);
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

describe("camo materials on copycats_shapes.nbt", () => {
  it("totals oak and cherry logs as the non-empty slots using them", () => {
    const parsed = parseSchematic(
      new Uint8Array(
        readFileSync(
          path.resolve(
            __dirname,
            "../../__tests__/fixtures/copycats_shapes.nbt",
          ),
        ),
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const { palette, regions } = parsed.schematic;

    const expected = new Map<string, number>();
    for (const region of regions) {
      for (const { nbt: tag } of region.blockEntities) {
        for (const name of rawMaterialNames(tag)) {
          expected.set(name, (expected.get(name) ?? 0) + 1);
        }
      }
    }
    // Sanity: the fixture alternates these two materials.
    expect(expected.get("minecraft:oak_log")).toBeGreaterThan(0);
    expect(expected.get("minecraft:cherry_log")).toBeGreaterThan(0);

    const totals = materialTotals(palette);
    // Neither log is placed on its own, so the totals are camo slots only.
    expect(totals.get("minecraft:oak_log[axis=y]")).toBe(
      expected.get("minecraft:oak_log"),
    );
    expect(totals.get("minecraft:cherry_log[axis=y]")).toBe(
      expected.get("minecraft:cherry_log"),
    );
    // Empty parts aren't listed anywhere.
    for (const e of palette) {
      for (const m of e.camoMaterials ?? []) {
        expect(m.blockId).not.toBe("create:copycat_base");
      }
    }
  });
});
