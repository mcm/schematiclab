import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseSchematic,
  serializeSchematic,
  type ParsedSchematicProjection,
  type SchematicFormatId,
} from "../convert";
import { toNbtCompoundValue, type NbtCompoundValue } from "../nbt-value";
import * as nbt from "../schemlib/nbt";
import { fromSnbt } from "../schemlib/snbt";
import { swapBlockState } from "../swap-projection";

const EXPORT_FORMATS: SchematicFormatId[] = [
  "Structure",
  "Sponge[v3]",
  "Litematic",
];

const fixtureBytes = (filename: string): Uint8Array =>
  new Uint8Array(readFileSync(path.resolve(__dirname, "fixtures", filename)));

function compound(snbt: string): nbt.Compound {
  const tag = fromSnbt(snbt);
  if (!(tag instanceof nbt.Compound))
    throw new Error(`not a compound: ${snbt}`);
  return tag;
}

interface TestBlock {
  pos: [number, number, number];
  state: string;
  nbt?: string;
}

// Block entities as each mod saves them (see CAMO_FIXTURES.md for the
// in-game captures these shapes come from).
const CHEST = `{id:"minecraft:chest",Items:[{Slot:0b,id:"minecraft:diamond",count:5},{Slot:13b,id:"minecraft:oak_log",count:64}]}`;
const SIGN = `{id:"minecraft:sign",is_waxed:0b,front_text:{has_glowing_text:0b,color:"black",messages:['"Hello"','"world"','""','""']},back_text:{has_glowing_text:1b,color:"red",messages:['""','""','""','"back"']}}`;
const FRAMED_DOUBLE = `{id:"framedblocks:framed_double_tile",intangible:0b,glowing:0b,reinforced:0b,components:{},camo:{type:"framedblocks:block",state:{Name:"minecraft:oak_log",Properties:{axis:"y"}}},camo_two:{type:"framedblocks:block",state:{Name:"minecraft:stone_bricks"}}}`;
const CREATE_COPYCAT = `{id:"create:copycat",EnableCT:1b,Material:{Name:"minecraft:oak_log",Properties:{axis:"z"}},Item:{id:"minecraft:oak_log",count:1}}`;
const COPYCATS_MULTI = `{id:"copycats:multistate_copycat",material_data:{top:{material:{Name:"minecraft:jungle_log",Properties:{axis:"y"}},enableCT:1b,consumedItem:{id:"minecraft:jungle_log",count:1}},bottom:{material:{Name:"create:copycat_base"},enableCT:1b,consumedItem:{}}}}`;

// Nothing sits at y=0, so the bounding box doesn't start at the origin and
// the Litematic / Sponge writers have to shift block entities with their
// blocks.
const TEST_BLOCKS: TestBlock[] = [
  {
    pos: [0, 1, 0],
    state: "minecraft:chest[facing=north,type=single,waterlogged=false]",
    nbt: CHEST,
  },
  {
    pos: [1, 1, 0],
    state: "minecraft:oak_sign[rotation=0,waterlogged=false]",
    nbt: SIGN,
  },
  {
    pos: [2, 1, 0],
    state:
      "framedblocks:framed_double_slab[glowing=false,propagates_skylight=false,solid=true]",
    nbt: FRAMED_DOUBLE,
  },
  {
    pos: [3, 1, 0],
    state: "create:copycat_panel[facing=up,waterlogged=false]",
    nbt: CREATE_COPYCAT,
  },
  {
    pos: [4, 1, 0],
    state: "copycats:copycat_slab[axis=y,type=double,waterlogged=false]",
    nbt: COPYCATS_MULTI,
  },
  { pos: [5, 1, 1], state: "minecraft:stone" },
];

function blockStateCompound(state: string): nbt.Compound {
  const m = /^([^[]+)(?:\[(.*)\])?$/.exec(state);
  if (!m) throw new Error(state);
  const out = new nbt.Compound<nbt.NbtTag>({ Name: new nbt.StringTag(m[1]) });
  if (m[2]) {
    const props = new nbt.Compound();
    for (const pair of m[2].split(",")) {
      const [k, v] = pair.split("=");
      props.set(k, new nbt.StringTag(v));
    }
    out.set("Properties", props);
  }
  return out;
}

function intList(values: number[]): nbt.NbtList {
  return new nbt.NbtList(values.map((v) => new nbt.Int(v)));
}

// A vanilla structure file, built the way Minecraft writes one: block
// entities sit in each block's `nbt` without x/y/z.
function buildStructure(blocks: TestBlock[]): Uint8Array {
  const states = [...new Set(blocks.map((b) => b.state))];
  const root = new nbt.Compound({
    DataVersion: new nbt.Int(3955),
    size: intList([6, 2, 2]),
    palette: new nbt.NbtList(states.map(blockStateCompound)),
    entities: new nbt.NbtList([]),
    blocks: new nbt.NbtList(
      blocks.map((b) => {
        const c = new nbt.Compound<nbt.NbtTag>({
          pos: intList(b.pos),
          state: new nbt.Int(states.indexOf(b.state)),
        });
        if (b.nbt) c.set("nbt", compound(b.nbt));
        return c;
      }),
    ),
  });
  return new nbt.Named({ "": root }).toBytes({ compress: true });
}

function parse(bytes: Uint8Array): ParsedSchematicProjection {
  const result = parseSchematic(bytes);
  if (!result.ok) throw new Error(result.error);
  return result.schematic;
}

function roundTrip(
  projection: ParsedSchematicProjection,
  outputFormat: SchematicFormatId,
): ParsedSchematicProjection {
  const result = serializeSchematic({
    schematic: projection,
    inputFilename: "test.nbt",
    outputFormat,
  });
  if (!result.ok) throw new Error(result.error);
  return parse(result.bytes);
}

// Block entities keyed by position relative to the lowest block corner
// (exports rebase positions onto the bounding box), each with the block
// state it sits on.
function blockEntitiesByPos(
  projection: ParsedSchematicProjection,
): Map<string, { blockState: string; nbt: NbtCompoundValue }> {
  expect(projection.regions).toHaveLength(1);
  const region = projection.regions[0];
  const min = [0, 1, 2].map((axis) =>
    Math.min(...region.blocks.map((b) => b.pos[axis])),
  );
  const rel = (pos: [number, number, number]): string =>
    pos.map((v, axis) => v - min[axis]).join(",");
  const stateAt = new Map(
    region.blocks.map((b) => [
      rel(b.pos),
      projection.palette[b.paletteIndex].blockState,
    ]),
  );
  const out = new Map<string, { blockState: string; nbt: NbtCompoundValue }>();
  for (const be of region.blockEntities) {
    const key = rel(be.pos);
    const blockState = stateAt.get(key);
    expect(blockState, `block entity at ${key} has no block`).toBeDefined();
    out.set(key, { blockState: blockState!, nbt: be.nbt });
  }
  return out;
}

describe("block entities in the parse projection", () => {
  it("projects each block entity from the parsed schematic", () => {
    const parsed = parse(buildStructure(TEST_BLOCKS));
    const byPos = blockEntitiesByPos(parsed);
    const expected = TEST_BLOCKS.filter((b) => b.nbt).map((b) => [
      `${b.pos[0]},${b.pos[1] - 1},${b.pos[2]}`,
      { blockState: b.state, nbt: toNbtCompoundValue(compound(b.nbt!)) },
    ]);
    expect(byPos).toEqual(new Map(expected as never));
  });

  it("survives structured cloning across the worker boundary", () => {
    const parsed = parse(buildStructure(TEST_BLOCKS));
    expect(structuredClone(parsed)).toEqual(parsed);
  });

  it.each(EXPORT_FORMATS)(
    "keeps chest, sign and camo block entities through %s",
    (format) => {
      const parsed = parse(buildStructure(TEST_BLOCKS));
      const before = blockEntitiesByPos(parsed);
      expect(before.size).toBe(5);
      const after = blockEntitiesByPos(roundTrip(parsed, format));
      expect(after).toEqual(before);
    },
  );

  describe.each(["framed_covered_1.nbt", "copycats_shapes.nbt"])(
    "fixture %s",
    (fixture) => {
      it.each(EXPORT_FORMATS)(
        "keeps every block entity through %s",
        (format) => {
          const parsed = parse(fixtureBytes(fixture));
          const before = blockEntitiesByPos(parsed);
          expect(before.size).toBeGreaterThan(300);
          const after = blockEntitiesByPos(roundTrip(parsed, format));
          expect(after.size).toBe(before.size);
          expect(after).toEqual(before);
        },
      );
    },
  );
});

describe("block entities through a block swap", () => {
  const CHEST_STATE =
    "minecraft:chest[facing=north,type=single,waterlogged=false]";
  const blocks: TestBlock[] = [
    { pos: [0, 0, 0], state: CHEST_STATE, nbt: CHEST },
    {
      pos: [1, 0, 0],
      state: "create:copycat_panel[facing=up,waterlogged=false]",
      nbt: CREATE_COPYCAT,
    },
  ];

  it("drops the block entity when the block id changes and keeps the others", () => {
    const parsed = parse(buildStructure(blocks));
    const swapped = swapBlockState(parsed, CHEST_STATE, {
      blockId: "minecraft:barrel",
      properties: { facing: "north", open: "false" },
    });
    expect(swapped.regions[0].blockEntities.map((be) => be.pos)).toEqual([
      [1, 0, 0],
    ]);

    // The export agrees: only the unswapped copycat still has its data.
    const after = blockEntitiesByPos(roundTrip(swapped, "Structure"));
    expect([...after.keys()]).toEqual(["1,0,0"]);
    expect(after.get("1,0,0")?.nbt).toEqual(
      toNbtCompoundValue(compound(CREATE_COPYCAT)),
    );
  });

  it("keeps the block entity when only properties change", () => {
    const parsed = parse(buildStructure(blocks));
    const swapped = swapBlockState(parsed, CHEST_STATE, {
      blockId: "minecraft:chest",
      properties: { facing: "south", type: "single", waterlogged: "false" },
    });
    expect(swapped.regions[0].blockEntities).toEqual(
      parsed.regions[0].blockEntities,
    );
    const after = blockEntitiesByPos(roundTrip(swapped, "Litematic"));
    expect(after.get("0,0,0")).toEqual({
      blockState: "minecraft:chest[facing=south,type=single,waterlogged=false]",
      nbt: toNbtCompoundValue(compound(CHEST)),
    });
  });
});
