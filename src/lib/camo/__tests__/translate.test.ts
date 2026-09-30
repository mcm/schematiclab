import { describe, expect, it } from "vitest";

import { applyVersionMapping } from "../../advanced/edit";
import { previewVersionMapping } from "../../advanced/version-mapping-preview";
import {
  convertSchematic,
  parseSchematic,
  serializeSchematic,
  type ParsedSchematicBlockEntity,
  type ParsedSchematicPaletteEntry,
  type ParsedSchematicProjection,
  type SchematicFormatId,
} from "../../convert";
import {
  fromNbtValue,
  toNbtCompoundValue,
  type NbtCompoundValue,
} from "../../nbt-value";
import * as nbt from "../../schemlib/nbt";
import {
  getVersion,
  translateCamoStates,
  type MinecraftVersion,
} from "../../schemlib/schematic-formats/version-mapping";
import { fromSnbt, toSnbt } from "../../schemlib/snbt";
import { withCamoMaterials } from "../materials";

// grass_path was renamed to dirt_path in 1.17; copper_block is new in 1.17.
const V_1_16_5 = getVersion("1.16.5");
const V_1_17_1 = getVersion("1.17.1");

function be(snbt: string): NbtCompoundValue {
  const tag = fromSnbt(snbt);
  if (!(tag instanceof nbt.Compound))
    throw new Error(`not a compound: ${snbt}`);
  return toNbtCompoundValue(tag);
}

const snbt = (value: NbtCompoundValue) => toSnbt(fromNbtValue(value));

function entry(
  blockId: string,
  properties: Record<string, string> = {},
): ParsedSchematicPaletteEntry {
  const keys = Object.keys(properties).sort();
  const blockState = keys.length
    ? `${blockId}[${keys.map((k) => `${k}=${properties[k]}`).join(",")}]`
    : blockId;
  return { blockState, blockId, properties, count: 0 };
}

// One region along x: block i sits at (i, 0, 0), uses palette[blocks[i][0]]
// and has block entity blocks[i][1] when set.
function projection(
  palette: ParsedSchematicPaletteEntry[],
  blocks: [number, NbtCompoundValue?][],
  version: MinecraftVersion,
): ParsedSchematicProjection {
  const counted = palette.map((e, i) => ({
    ...e,
    count: blocks.filter(([index]) => index === i).length,
  }));
  const blockEntities: ParsedSchematicBlockEntity[] = [];
  blocks.forEach(([, value], x) => {
    if (value !== undefined) blockEntities.push({ pos: [x, 0, 0], nbt: value });
  });
  const regions = [
    {
      origin: [0, 0, 0] as [number, number, number],
      size: [blocks.length, 1, 1] as [number, number, number],
      blocks: blocks.map(([paletteIndex], x) => ({
        pos: [x, 0, 0] as [number, number, number],
        paletteIndex,
      })),
      blockEntities,
    },
  ];
  return {
    name: "test",
    inputFormat: "Structure",
    minecraftVersion: version,
    totalBlocks: blocks.length,
    palette: withCamoMaterials(counted, regions),
    regions,
  };
}

const FRAMED_DOUBLE = `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:grass_path"}},camo_two:{type:"framedblocks:block",state:{Name:"minecraft:stone"}}}`;
const COPYCAT = `{id:"create:copycat",Material:{Name:"minecraft:grass_path"},Item:{id:"minecraft:grass_path",count:1}}`;
const MULTI_STATE = `{id:"copycats:multistate_copycat",material_data:{bottom:{material:{Name:"minecraft:grass_path"},consumedItem:{id:"minecraft:grass_path",count:1}},top:{material:{Name:"minecraft:stone"},consumedItem:{id:"minecraft:stone",count:1}}}}`;

/** Framed double slab, copycat panel, copycat slab, plus a placed grass_path. */
function scene(version = V_1_16_5): ParsedSchematicProjection {
  return projection(
    [
      entry("framedblocks:framed_double_slab"),
      entry("create:copycat_panel", { facing: "up" }),
      entry("copycats:copycat_slab", { type: "double" }),
      entry("minecraft:grass_path"),
    ],
    [[0, be(FRAMED_DOUBLE)], [1, be(COPYCAT)], [2, be(MULTI_STATE)], [3]],
    version,
  );
}

describe("translateCamoStates", () => {
  it("renames camo states in every mod's NBT", () => {
    const framed = translateCamoStates(
      { blockId: "framedblocks:framed_double_slab", properties: {} },
      be(FRAMED_DOUBLE),
      V_1_16_5,
      V_1_17_1,
    );
    expect(snbt(framed)).toBe(
      `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:dirt_path"}},camo_two:{type:"framedblocks:block",state:{Name:"minecraft:stone"}}}`,
    );

    const copycat = translateCamoStates(
      { blockId: "create:copycat_panel", properties: { facing: "up" } },
      be(COPYCAT),
      V_1_16_5,
      V_1_17_1,
    );
    expect(snbt(copycat)).toBe(
      `{id:"create:copycat",Material:{Name:"minecraft:dirt_path"},Item:{id:"minecraft:dirt_path",count:1}}`,
    );

    const multi = translateCamoStates(
      { blockId: "copycats:copycat_slab", properties: { type: "double" } },
      be(MULTI_STATE),
      V_1_16_5,
      V_1_17_1,
    );
    expect(snbt(multi)).toBe(
      `{id:"copycats:multistate_copycat",material_data:{bottom:{material:{Name:"minecraft:dirt_path"},consumedItem:{id:"minecraft:dirt_path",count:1}},top:{material:{Name:"minecraft:stone"},consumedItem:{id:"minecraft:stone",count:1}}}}`,
    );
  });

  it("returns the same NBT when nothing changes", () => {
    const source = be(FRAMED_DOUBLE);
    const parent = {
      blockId: "framedblocks:framed_double_slab",
      properties: {},
    };
    expect(translateCamoStates(parent, source, V_1_16_5, V_1_16_5)).toBe(
      source,
    );
    const stone = be(`{camo:{state:{Name:"minecraft:stone"}}}`);
    expect(translateCamoStates(parent, stone, V_1_16_5, V_1_17_1)).toBe(stone);
    const notCamo = be(`{Items:[]}`);
    expect(
      translateCamoStates(
        { blockId: "minecraft:chest", properties: {} },
        notCamo,
        V_1_16_5,
        V_1_17_1,
      ),
    ).toBe(notCamo);
  });

  it("reports lossy translations naming the parent block and slot", () => {
    const warnings: string[] = [];
    const out = translateCamoStates(
      { blockId: "copycats:copycat_slab", properties: { type: "double" } },
      be(
        `{material_data:{bottom:{material:{Name:"minecraft:stone"}},top:{material:{Name:"minecraft:copper_block"}}}}`,
      ),
      V_1_17_1,
      V_1_16_5,
      { onWarning: (message) => warnings.push(message) },
    );
    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) {
      expect(warning).toMatch(
        /^copycats:copycat_slab\[type=double\] camo slot "top": /,
      );
    }
    expect(snbt(out)).toContain(`top:{material:{Name:"minecraft:air"}`);
  });
});

describe("camo translation on version conversion", () => {
  function exportedAt(
    source: ParsedSchematicProjection,
    outputFormat: SchematicFormatId,
    targetVersion: string,
  ): string[] {
    // Write the source file at its own version, then convert it the Simple
    // Mode way.
    const file = serializeSchematic({
      schematic: source,
      inputFilename: "test.nbt",
      outputFormat: "Structure",
    });
    if (!file.ok) throw new Error(file.error);
    const converted = convertSchematic({
      bytes: file.bytes,
      inputFilename: "test.nbt",
      outputFormat,
      targetVersion,
    });
    if (!converted.ok) throw new Error(converted.error);
    const parsed = parseSchematic(converted.bytes);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.schematic.regions
      .flatMap((r) => r.blockEntities)
      .map((b) => snbt(b.nbt));
  }

  it.each<SchematicFormatId>(["Structure", "Litematic", "Sponge[v3]"])(
    "renames a camo in Simple Mode output (%s)",
    (format) => {
      const blockEntities = exportedAt(scene(), format, "1.17.1").join("\n");
      expect(blockEntities).toContain(`state:{Name:"minecraft:dirt_path"}`);
      expect(blockEntities).toContain(`Material:{Name:"minecraft:dirt_path"}`);
      expect(blockEntities).toContain(
        `bottom:{material:{Name:"minecraft:dirt_path"}`,
      );
      expect(blockEntities).not.toContain("grass_path");
    },
  );

  it("renames camos in the Advanced Editor's applyVersionMapping", () => {
    const mapped = applyVersionMapping(scene(), V_1_17_1);
    const blockEntities = mapped.regions[0].blockEntities.map((b) =>
      snbt(b.nbt),
    );
    expect(blockEntities.join("\n")).not.toContain("grass_path");
    expect(blockEntities[0]).toContain(`state:{Name:"minecraft:dirt_path"}`);
    const camo = mapped.palette.flatMap((e) => e.camoMaterials ?? []);
    expect(camo.filter((m) => m.blockId === "minecraft:dirt_path")).toEqual([
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
    ]);
  });

  it("applies overrides and mod passthrough to camo states", () => {
    const withModCamo = projection(
      [entry("framedblocks:framed_cube")],
      [
        [
          0,
          be(
            `{camo:{type:"framedblocks:block",state:{Name:"minecraft:grass_path"}}}`,
          ),
        ],
        [0, be(`{camo:{state:{Name:"framedblocks:framed_cube"}}}`)],
      ],
      V_1_16_5,
    );
    const mapped = applyVersionMapping(
      withModCamo,
      V_1_17_1,
      {
        "minecraft:grass_path": {
          blockId: "minecraft:moss_block",
          properties: {},
        },
      },
      {
        framedblocks: {
          kind: "target",
          blocks: { "framedblocks:framed_cube": {} },
        },
      },
    );
    const [first, second] = mapped.regions[0].blockEntities.map((b) =>
      snbt(b.nbt),
    );
    expect(first).toContain(`state:{Name:"minecraft:moss_block"}`);
    expect(second).toContain(`state:{Name:"framedblocks:framed_cube"}`);
  });
});

describe("previewVersionMapping with camo states", () => {
  it("counts clean camo-only states and merges camo slots into palette rows", () => {
    const preview = previewVersionMapping(scene(), V_1_17_1);
    // Four parent/placed palette states plus the camo-only stone.
    expect(preview.cleanCount).toBe(5);
    expect(preview.problematicCount).toBe(0);
  });

  it("flags a lossy camo state with the parent block and slot", () => {
    const source = projection(
      [
        entry("framedblocks:framed_double_slab"),
        entry("minecraft:copper_block"),
      ],
      [
        [
          0,
          be(
            `{camo:{state:{Name:"minecraft:copper_block"}},camo_two:{state:{Name:"minecraft:stone"}}}`,
          ),
        ],
        [
          0,
          be(
            `{camo:{state:{Name:"minecraft:stone"}},camo_two:{state:{Name:"minecraft:copper_block"}}}`,
          ),
        ],
        [1],
      ],
      V_1_17_1,
    );
    const preview = previewVersionMapping(source, V_1_16_5);
    expect(preview.problematicCount).toBe(1);
    const [row] = preview.problematic;
    expect(row.sourceBlockState).toBe("minecraft:copper_block");
    // One placed block plus two camo slots.
    expect(row.sourceCount).toBe(3);
    expect(row.proposedTargetBlockId).toBe("minecraft:air");
    expect(
      row.warnings.some((w) =>
        w.startsWith(`framedblocks:framed_double_slab camo slot "camo": `),
      ),
    ).toBe(true);
    expect(
      row.warnings.some((w) =>
        w.startsWith(`framedblocks:framed_double_slab camo slot "camo_two": `),
      ),
    ).toBe(true);
  });

  it("leaves camo states from loaded mods clean", () => {
    const source = projection(
      [entry("framedblocks:framed_cube")],
      [[0, be(`{camo:{state:{Name:"othermod:thing"}}}`)]],
      V_1_12_2(),
    );
    const preview = previewVersionMapping(source, V_1_17_1, {
      framedblocks: {
        kind: "target",
        blocks: { "framedblocks:framed_cube": {} },
      },
      othermod: { kind: "target", blocks: { "othermod:thing": {} } },
    });
    expect(preview.problematicCount).toBe(0);
    expect(preview.cleanCount).toBe(2);
  });
});

function V_1_12_2(): MinecraftVersion {
  return getVersion("1.12.2");
}
