import { beforeEach, describe, expect, it } from "vitest";

import {
  parseSchematic,
  serializeSchematic,
  type ParsedSchematicBlockEntity,
  type ParsedSchematicPaletteEntry,
  type ParsedSchematicProjection,
} from "../../convert";
import {
  __resetEditorStateForTests,
  getEditorState,
  setParseStatus,
} from "../../editor-state";
import {
  applyBlockSwap,
  applyCamoSwap,
  applyVersionMapping,
  undoLastSwap,
  undoLastTranslation,
} from "../../editor-state-edits";
import {
  fromNbtValue,
  toNbtCompoundValue,
  type NbtCompoundValue,
} from "../../nbt-value";
import type {
  ModBlockProperties,
  ModMappingContext,
} from "../../advanced/mod-mapping";
import * as nbt from "../../schemlib/nbt";
import { fromSnbt, toSnbt } from "../../schemlib/snbt";
import { swapBlockState } from "../../swap-projection";
import { camoBlockEntityType, keepsBlockEntity } from "../block-entity-type";
import { withCamoMaterials } from "../materials";
import { swapCamoMaterial, type CamoSwapTarget } from "../swap";

function be(snbt: string): NbtCompoundValue {
  const tag = fromSnbt(snbt);
  if (!(tag instanceof nbt.Compound))
    throw new Error(`not a compound: ${snbt}`);
  return toNbtCompoundValue(tag);
}

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

// One region laid out along x: block i sits at (i, 0, 0), uses
// palette[blocks[i][0]] and has block entity blocks[i][1] when set.
function projection(
  palette: ParsedSchematicPaletteEntry[],
  blocks: [number, NbtCompoundValue?][],
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
    minecraftVersion: {
      platform: "java",
      versionNumber: [1, 21, 1],
      dataVersion: 3955,
    },
    totalBlocks: blocks.length,
    palette: withCamoMaterials(counted, regions),
    regions,
  };
}

/** The block entity at x as SNBT, for readable assertions. */
function snbtAt(p: ParsedSchematicProjection, x: number): string {
  const found = p.regions[0].blockEntities.find((b) => b.pos[0] === x);
  if (found === undefined) throw new Error(`no block entity at x=${x}`);
  return toSnbt(fromNbtValue(found.nbt));
}

const framed = (camo: string, camoTwo?: string) =>
  be(
    `{id:"framedblocks:${camoTwo ? "framed_double_tile" : "framed_tile"}",camo:{type:"framedblocks:block",state:{Name:"${camo}"}}${
      camoTwo
        ? `,camo_two:{type:"framedblocks:block",state:{Name:"${camoTwo}"}}`
        : ""
    }}`,
  );

const DARK_OAK = "minecraft:dark_oak_planks";
const SPRUCE: CamoSwapTarget = {
  blockId: "minecraft:spruce_planks",
  properties: {},
};
const DARK_OAK_SOURCE = { kind: "block", blockState: DARK_OAK } as const;

const PANEL_PROPS = { solid: "false", glowing: "false" };
const SOUTH = entry("framedblocks:framed_double_panel", {
  facing: "south",
  ...PANEL_PROPS,
});
const NORTH = entry("framedblocks:framed_double_panel", {
  facing: "north",
  ...PANEL_PROPS,
});
const WALL = entry("framedblocks:framed_wall", { up: "true" });
const PANEL = entry("framedblocks:framed_panel", { facing: "east" });

// The loaded FramedBlocks file for the translation target, offering every
// state the scene uses.
const FRAMED_BLOCKS: Record<string, ModBlockProperties> = {};
for (const { blockId, properties } of [SOUTH, NORTH, WALL, PANEL]) {
  const block = (FRAMED_BLOCKS[blockId] ??= {});
  for (const [key, value] of Object.entries(properties)) {
    const values = (block[key] ??= []);
    if (!values.includes(value)) values.push(value);
  }
}
const FRAMED_TARGET: ModMappingContext = {
  framedblocks: { kind: "target", blocks: FRAMED_BLOCKS },
};

// x=0,1: south double panels (dark oak + oak, dark oak + dark oak), x=2:
// north double panel, x=3: wall, x=4: panel with a stone camo.
function scene(): ParsedSchematicProjection {
  return projection(
    [SOUTH, NORTH, WALL, PANEL],
    [
      [0, framed(DARK_OAK, "minecraft:oak_planks")],
      [0, framed(DARK_OAK, DARK_OAK)],
      [1, framed(DARK_OAK, DARK_OAK)],
      [2, framed(DARK_OAK)],
      [3, framed("minecraft:stone")],
    ],
  );
}

const camoNames = (p: ParsedSchematicProjection, x: number) =>
  [...snbtAt(p, x).matchAll(/Name:"([^"]+)"/g)].map((m) => m[1]);

describe("swapCamoMaterial scope", () => {
  it("Replace all changes the camo under every parent block and state", () => {
    const next = swapCamoMaterial(scene(), DARK_OAK_SOURCE, SPRUCE, {
      kind: "all",
    });
    expect(camoNames(next, 0)).toEqual([
      "minecraft:spruce_planks",
      "minecraft:oak_planks",
    ]);
    expect(camoNames(next, 1)).toEqual([
      "minecraft:spruce_planks",
      "minecraft:spruce_planks",
    ]);
    expect(camoNames(next, 2)).toEqual([
      "minecraft:spruce_planks",
      "minecraft:spruce_planks",
    ]);
    expect(camoNames(next, 3)).toEqual(["minecraft:spruce_planks"]);
    expect(camoNames(next, 4)).toEqual(["minecraft:stone"]);
    expect(
      next.palette.flatMap((e) => e.camoMaterials ?? []).map((m) => m.blockId),
    ).not.toContain(DARK_OAK);
  });

  it("Swap… changes only the slots under that parent block state", () => {
    const before = scene();
    const next = swapCamoMaterial(before, DARK_OAK_SOURCE, SPRUCE, {
      kind: "parent",
      parentBlockState: SOUTH.blockState,
    });
    expect(camoNames(next, 0)).toEqual([
      "minecraft:spruce_planks",
      "minecraft:oak_planks",
    ]);
    expect(camoNames(next, 1)).toEqual([
      "minecraft:spruce_planks",
      "minecraft:spruce_planks",
    ]);
    for (const x of [2, 3, 4]) {
      expect(snbtAt(next, x)).toBe(snbtAt(before, x));
    }
    const southMaterials = next.palette.find(
      (e) => e.blockState === SOUTH.blockState,
    )!.camoMaterials;
    expect(southMaterials?.map((m) => [m.blockState, m.count]).sort()).toEqual([
      ["minecraft:oak_planks", 1],
      ["minecraft:spruce_planks", 3],
    ]);
    const northMaterials = next.palette.find(
      (e) => e.blockState === NORTH.blockState,
    )!.camoMaterials;
    expect(northMaterials?.map((m) => [m.blockState, m.count])).toEqual([
      [DARK_OAK, 2],
    ]);
  });

  it("returns the same projection when nothing matches", () => {
    const before = scene();
    expect(
      swapCamoMaterial(
        before,
        { kind: "block", blockState: "minecraft:dirt" },
        SPRUCE,
        { kind: "all" },
      ),
    ).toBe(before);
    expect(
      swapCamoMaterial(
        before,
        DARK_OAK_SOURCE,
        { blockId: DARK_OAK, properties: {} },
        { kind: "all" },
      ),
    ).toBe(before);
    expect(
      swapCamoMaterial(before, DARK_OAK_SOURCE, SPRUCE, {
        kind: "parent",
        parentBlockState: PANEL.blockState,
      }),
    ).toBe(before);
  });

  it("does not mutate the input projection", () => {
    const before = scene();
    const snapshot = structuredClone(before);
    swapCamoMaterial(before, DARK_OAK_SOURCE, SPRUCE, { kind: "all" });
    expect(before).toEqual(snapshot);
  });

  it("matches the full camo state, properties included", () => {
    const logY = be(
      `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:oak_log",Properties:{axis:"y"}}}}`,
    );
    const logX = be(
      `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:oak_log",Properties:{axis:"x"}}}}`,
    );
    const before = projection(
      [PANEL],
      [
        [0, logY],
        [0, logX],
      ],
    );
    const next = swapCamoMaterial(
      before,
      { kind: "block", blockState: "minecraft:oak_log[axis=y]" },
      { blockId: "minecraft:birch_log", properties: { axis: "z" } },
      { kind: "all" },
    );
    expect(snbtAt(next, 0)).toContain(
      `state:{Name:"minecraft:birch_log",Properties:{axis:"z"}}`,
    );
    expect(snbtAt(next, 1)).toBe(snbtAt(before, 1));
  });
});

describe("swapCamoMaterial NBT", () => {
  const target: CamoSwapTarget = {
    blockId: "minecraft:cherry_log",
    properties: { axis: "y" },
  };
  const swapAll = (p: ParsedSchematicProjection, blockState: string) =>
    swapCamoMaterial(p, { kind: "block", blockState }, target, {
      kind: "all",
    });

  it("rewrites FramedBlocks camo_two and leaves camo alone", () => {
    const p = projection(
      [SOUTH],
      [[0, framed("minecraft:stone", "minecraft:oak_planks")]],
    );
    const text = snbtAt(swapAll(p, "minecraft:oak_planks"), 0);
    expect(text).toContain(
      `camo:{type:"framedblocks:block",state:{Name:"minecraft:stone"}}`,
    );
    expect(text).toContain(
      `camo_two:{type:"framedblocks:block",state:{Name:"minecraft:cherry_log",Properties:{axis:"y"}}}`,
    );
  });

  it("turns a FramedBlocks fluid camo into a block camo", () => {
    const p = projection(
      [PANEL],
      [
        [
          0,
          be(
            `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:fluid",fluid:"minecraft:water",flow_dir:"up"}}`,
          ),
        ],
      ],
    );
    const next = swapCamoMaterial(
      p,
      { kind: "fluid", blockState: "minecraft:water" },
      target,
      { kind: "all" },
    );
    expect(snbtAt(next, 0)).toBe(
      `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:cherry_log",Properties:{axis:"y"}}}}`,
    );
  });

  it("sets single-state copycat Material and Item.id", () => {
    const p = projection(
      [entry("create:copycat_panel", { facing: "up" })],
      [
        [
          0,
          be(
            `{id:"create:copycat",EnableCT:1b,Material:{Name:"minecraft:oak_log",Properties:{axis:"z"}},Item:{id:"minecraft:oak_log",count:1}}`,
          ),
        ],
      ],
    );
    expect(snbtAt(swapAll(p, "minecraft:oak_log[axis=z]"), 0)).toBe(
      `{id:"create:copycat",EnableCT:1B,Material:{Name:"minecraft:cherry_log",Properties:{axis:"y"}},Item:{id:"minecraft:cherry_log",count:1}}`,
    );
  });

  it("keeps 1.20.1's Item Count", () => {
    const p = projection(
      [entry("copycats:copycat_block")],
      [
        [
          0,
          be(
            `{id:"copycats:copycat",Material:{Name:"minecraft:stone"},Item:{id:"minecraft:stone",Count:1b}}`,
          ),
        ],
      ],
    );
    expect(snbtAt(swapAll(p, "minecraft:stone"), 0)).toBe(
      `{id:"copycats:copycat",Material:{Name:"minecraft:cherry_log",Properties:{axis:"y"}},Item:{id:"minecraft:cherry_log",Count:1B}}`,
    );
  });

  it("sets multi-state material_data.<part>.material and consumedItem.id", () => {
    const p = projection(
      [entry("copycats:copycat_slab", { type: "double" })],
      [
        [
          0,
          be(
            `{id:"copycats:multistate_copycat",material_data:{top:{material:{Name:"minecraft:jungle_log",Properties:{axis:"y"}},enableCT:1b,consumedItem:{id:"minecraft:jungle_log",count:1}},bottom:{material:{Name:"minecraft:stone"},enableCT:1b,consumedItem:{id:"minecraft:stone",count:1}}}}`,
          ),
        ],
      ],
    );
    expect(snbtAt(swapAll(p, "minecraft:jungle_log[axis=y]"), 0)).toBe(
      `{id:"copycats:multistate_copycat",material_data:{top:{material:{Name:"minecraft:cherry_log",Properties:{axis:"y"}},enableCT:1B,consumedItem:{id:"minecraft:cherry_log",count:1}},bottom:{material:{Name:"minecraft:stone"},enableCT:1B,consumedItem:{id:"minecraft:stone",count:1}}}}`,
    );
  });

  it("rewrites a legacy plain Material on a multi-state block", () => {
    const p = projection(
      [entry("copycats:copycat_slab", { type: "double" })],
      [
        [
          0,
          be(
            `{id:"copycats:multistate_copycat",Material:{Name:"minecraft:stone"},Item:{id:"minecraft:stone",count:1}}`,
          ),
        ],
      ],
    );
    const next = swapAll(p, "minecraft:stone");
    expect(snbtAt(next, 0)).toBe(
      `{id:"copycats:multistate_copycat",Material:{Name:"minecraft:cherry_log",Properties:{axis:"y"}},Item:{id:"minecraft:cherry_log",count:1}}`,
    );
    expect(next.palette[0].camoMaterials).toEqual([
      expect.objectContaining({
        blockState: "minecraft:cherry_log[axis=y]",
        count: 2,
      }),
    ]);
  });

  it("shows the new camo in the exported NBT", () => {
    const swapped = swapCamoMaterial(scene(), DARK_OAK_SOURCE, SPRUCE, {
      kind: "all",
    });
    const result = serializeSchematic({
      schematic: swapped,
      inputFilename: "test.nbt",
      outputFormat: "Structure",
    });
    if (!result.ok) throw new Error(result.error);
    const parsed = parseSchematic(result.bytes);
    if (!parsed.ok) throw new Error(parsed.error);
    const exported = parsed.schematic;
    const byX = (x: number) => {
      const pos = exported.regions[0].blocks.find((b) => b.pos[0] === x)!.pos;
      const found = exported.regions[0].blockEntities.find(
        (b) => b.pos.join() === pos.join(),
      )!;
      return toSnbt(fromNbtValue(found.nbt));
    };
    expect(byX(3)).toContain(`state:{Name:"minecraft:spruce_planks"}`);
    expect(byX(4)).toContain(`state:{Name:"minecraft:stone"}`);
    expect(byX(0)).toContain(
      `camo_two:{type:"framedblocks:block",state:{Name:"minecraft:oak_planks"}}`,
    );
    expect(
      exported.palette
        .flatMap((e) => e.camoMaterials ?? [])
        .find((m) => m.blockId === "minecraft:spruce_planks")?.count,
    ).toBe(3);
    expect(
      exported.palette
        .flatMap((e) => e.camoMaterials ?? [])
        .filter((m) => m.blockId === "minecraft:spruce_planks")
        .reduce((n, m) => n + m.count, 0),
    ).toBe(6);
  });
});

describe("swapCamoMaterial empty slots and removal", () => {
  const OAK: CamoSwapTarget = {
    blockId: "minecraft:oak_planks",
    properties: {},
  };
  const EMPTY_SOURCE = { kind: "empty", blockState: "" } as const;
  const fill = (
    p: ParsedSchematicProjection,
    scope: Parameters<typeof swapCamoMaterial>[3] = { kind: "all" },
  ) => swapCamoMaterial(p, EMPTY_SOURCE, OAK, scope);
  const remove = (p: ParsedSchematicProjection, blockState: string) =>
    swapCamoMaterial(p, { kind: "block", blockState }, null, { kind: "all" });

  it("creates the block entity of a framed block that has none", () => {
    const next = fill(projection([entry("framedblocks:framed_stairs")], [[0]]));
    expect(snbtAt(next, 0)).toBe(
      `{id:"framedblocks:framed_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:oak_planks"}}}`,
    );
    expect(next.palette[0].camoMaterials).toEqual([
      expect.objectContaining({ kind: "block", count: 1 }),
    ]);
  });

  it("fills both slots of a new double block's block entity", () => {
    const next = fill(
      projection([entry("framedblocks:framed_double_slab")], [[0]]),
    );
    expect(snbtAt(next, 0)).toBe(
      `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:oak_planks"}},camo_two:{type:"framedblocks:block",state:{Name:"minecraft:oak_planks"}}}`,
    );
  });

  it("creates copycat block entities in each format", () => {
    const next = fill(
      projection(
        [
          entry("create:copycat_step", { facing: "north", half: "top" }),
          entry("copycats:copycat_slab", { type: "top" }),
        ],
        [[0], [1]],
      ),
    );
    expect(snbtAt(next, 0)).toBe(
      `{id:"create:copycat",Material:{Name:"minecraft:oak_planks"},Item:{id:"minecraft:oak_planks",count:1},EnableCT:1B}`,
    );
    expect(snbtAt(next, 1)).toBe(
      `{id:"copycats:multistate_copycat",material_data:{top:{material:{Name:"minecraft:oak_planks"},enableCT:1B,consumedItem:{id:"minecraft:oak_planks",count:1}}}}`,
    );
  });

  it("writes 1.20.1's Item Count into a new block entity", () => {
    const p = projection([entry("copycats:copycat_block")], [[0]]);
    const legacy = fill({
      ...p,
      minecraftVersion: {
        platform: "java",
        versionNumber: [1, 20, 1],
        dataVersion: 3465,
      },
    });
    expect(snbtAt(legacy, 0)).toContain(
      `Item:{id:"minecraft:oak_planks",Count:1B}`,
    );
  });

  it("fills only the empty slots, under one parent with a parent scope", () => {
    const p = projection(
      [PANEL, SOUTH],
      [
        [
          0,
          be(
            `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:stone"}},camo_two:{type:"framedblocks:empty"}}`,
          ),
        ],
        [1],
      ],
    );
    const next = fill(p, {
      kind: "parent",
      parentBlockState: PANEL.blockState,
    });
    expect(snbtAt(next, 0)).toBe(
      `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:block",state:{Name:"minecraft:stone"}},camo_two:{type:"framedblocks:block",state:{Name:"minecraft:oak_planks"}}}`,
    );
    expect(next.regions[0].blockEntities).toHaveLength(1);
  });

  it("removes a FramedBlocks block or fluid camo", () => {
    const p = projection(
      [PANEL],
      [
        [0, framed("minecraft:stone", "minecraft:oak_planks")],
        [
          0,
          be(
            `{id:"framedblocks:framed_tile",reinforced:0b,camo:{type:"framedblocks:fluid",fluid:"minecraft:water",flow_dir:"up"}}`,
          ),
        ],
      ],
    );
    expect(snbtAt(remove(p, "minecraft:stone"), 0)).toBe(
      `{id:"framedblocks:framed_double_tile",camo:{type:"framedblocks:empty"},camo_two:{type:"framedblocks:block",state:{Name:"minecraft:oak_planks"}}}`,
    );
    const noFluid = swapCamoMaterial(
      p,
      { kind: "fluid", blockState: "minecraft:water" },
      null,
      { kind: "all" },
    );
    expect(snbtAt(noFluid, 1)).toBe(
      `{id:"framedblocks:framed_tile",reinforced:0B,camo:{type:"framedblocks:empty"}}`,
    );
  });

  it("removes copycat camos the way the mods save an empty copycat", () => {
    const p = projection(
      [
        entry("create:copycat_panel", { facing: "up" }),
        entry("copycats:copycat_slab", { type: "double" }),
      ],
      [
        [
          0,
          be(
            `{id:"create:copycat",EnableCT:1b,Material:{Name:"minecraft:stone"},Item:{id:"minecraft:stone",count:1}}`,
          ),
        ],
        [
          1,
          be(
            `{id:"copycats:multistate_copycat",material_data:{top:{material:{Name:"minecraft:stone"},enableCT:1b,consumedItem:{id:"minecraft:stone",count:1}},bottom:{material:{Name:"minecraft:oak_planks"},enableCT:1b,consumedItem:{id:"minecraft:oak_planks",count:1}}}}`,
          ),
        ],
      ],
    );
    const next = remove(p, "minecraft:stone");
    expect(snbtAt(next, 0)).toBe(
      `{id:"create:copycat",EnableCT:1B,Material:{Name:"create:copycat_base"},Item:{}}`,
    );
    expect(snbtAt(next, 1)).toBe(
      `{id:"copycats:multistate_copycat",material_data:{top:{material:{Name:"create:copycat_base"},enableCT:1B,consumedItem:{}},bottom:{material:{Name:"minecraft:oak_planks"},enableCT:1B,consumedItem:{id:"minecraft:oak_planks",count:1}}}}`,
    );
    expect(next.palette[0].camoMaterials).toEqual([
      expect.objectContaining({ kind: "empty", count: 1 }),
    ]);
  });

  it("is a no-op for removing empty slots or a block without camo", () => {
    const p = projection(
      [entry("framedblocks:framed_cube"), entry("create:copycat_base")],
      [[0], [1]],
    );
    expect(swapCamoMaterial(p, EMPTY_SOURCE, null, { kind: "all" })).toBe(p);
    const base = projection([entry("create:copycat_base")], [[0]]);
    expect(fill(base)).toBe(base);
  });

  it("lets a block swapped to a framed block take a camo", () => {
    const p = projection(
      [entry("minecraft:chest")],
      [[0, be(`{id:"minecraft:chest"}`)]],
    );
    const swapped = swapBlockState(p, "minecraft:chest", {
      blockId: "framedblocks:framed_chest",
      properties: { facing: "north" },
    });
    expect(swapped.regions[0].blockEntities).toEqual([]);
    expect(swapped.palette[0].camoMaterials).toEqual([
      expect.objectContaining({ kind: "empty", count: 1 }),
    ]);
    expect(snbtAt(fill(swapped), 0)).toBe(
      `{id:"framedblocks:framed_chest",camo:{type:"framedblocks:block",state:{Name:"minecraft:oak_planks"}}}`,
    );
  });
});

describe("parent swaps and camo block entities", () => {
  it("keeps the camo when the target has the same block-entity type", () => {
    const p = projection([PANEL], [[0, framed(DARK_OAK)]]);
    const next = swapBlockState(p, PANEL.blockState, {
      blockId: "framedblocks:framed_slab",
      properties: { type: "bottom" },
    });
    expect(next.regions[0].blockEntities).toEqual(p.regions[0].blockEntities);
    expect(next.palette[0].camoMaterials?.map((m) => m.blockId)).toEqual([
      DARK_OAK,
    ]);
  });

  it("drops the block entity for a non-camo target or another type", () => {
    const p = projection([PANEL], [[0, framed(DARK_OAK)]]);
    for (const blockId of ["minecraft:stone", "framedblocks:framed_door"]) {
      const next = swapBlockState(p, PANEL.blockState, {
        blockId,
        properties: {},
      });
      expect(next.regions[0].blockEntities).toEqual([]);
    }
  });

  it("knows the block-entity types the mods save", () => {
    expect(camoBlockEntityType("framedblocks:framed_panel")).toBe(
      "framedblocks:framed_tile",
    );
    expect(camoBlockEntityType("framedblocks:framed_double_panel")).toBe(
      "framedblocks:framed_double_tile",
    );
    expect(camoBlockEntityType("framedblocks:framed_double_slope")).toBe(
      "framedblocks:framed_double_slope",
    );
    expect(camoBlockEntityType("copycats:copycat_board")).toBe(
      "copycats:multistate_copycat",
    );
    expect(camoBlockEntityType("create:copycat_step")).toBe("create:copycat");
    expect(camoBlockEntityType("create:copycat_base")).toBeUndefined();
    expect(camoBlockEntityType("minecraft:chest")).toBeUndefined();
    expect(
      keepsBlockEntity("copycats:copycat_slab", "copycats:copycat_board"),
    ).toBe(true);
    expect(
      keepsBlockEntity(
        "framedblocks:framed_panel",
        "framedblocks:framed_double_panel",
      ),
    ).toBe(false);
    expect(keepsBlockEntity("minecraft:chest", "minecraft:chest")).toBe(true);
    expect(keepsBlockEntity("minecraft:chest", "minecraft:barrel")).toBe(false);
  });
});

describe("applyCamoSwap undo", () => {
  beforeEach(() => {
    __resetEditorStateForTests();
  });

  const ready = () => {
    const s = getEditorState().parseStatus;
    if (s.status !== "ready") throw new Error("not ready");
    return s.schematic;
  };

  it("is a no-op without a ready parse", () => {
    expect(applyCamoSwap(DARK_OAK_SOURCE, SPRUCE, { kind: "all" })).toBe(false);
  });

  it("applies and undoes through the swap snapshot", () => {
    const original = scene();
    setParseStatus({ status: "ready", schematic: original });
    expect(applyCamoSwap(DARK_OAK_SOURCE, SPRUCE, { kind: "all" })).toBe(true);
    expect(camoNames(ready(), 3)).toEqual(["minecraft:spruce_planks"]);
    expect(getEditorState().lastSwapSnapshot).toBe(original);
    expect(undoLastSwap()).toBe(true);
    expect(ready()).toBe(original);
    expect(getEditorState().lastSwapSnapshot).toBeNull();
  });

  it("doesn't record a snapshot when nothing changes", () => {
    setParseStatus({ status: "ready", schematic: scene() });
    expect(
      applyCamoSwap({ kind: "block", blockState: "minecraft:dirt" }, SPRUCE, {
        kind: "all",
      }),
    ).toBe(false);
    expect(getEditorState().lastSwapSnapshot).toBeNull();
  });

  it("shares single-step undo with block swaps", () => {
    const original = scene();
    setParseStatus({ status: "ready", schematic: original });
    applyBlockSwap(PANEL.blockState, {
      blockId: "minecraft:stone",
      properties: {},
    });
    const afterBlockSwap = ready();
    applyCamoSwap(DARK_OAK_SOURCE, SPRUCE, {
      kind: "parent",
      parentBlockState: SOUTH.blockState,
    });
    expect(undoLastSwap()).toBe(true);
    expect(ready()).toBe(afterBlockSwap);
  });

  it("interacts with translation undo like a block swap", () => {
    const original = scene();
    setParseStatus({ status: "ready", schematic: original });
    applyVersionMapping(
      { platform: "java", versionNumber: [1, 21, 4], dataVersion: 4189 },
      {},
      FRAMED_TARGET,
    );
    const translated = ready();
    applyCamoSwap(DARK_OAK_SOURCE, SPRUCE, { kind: "all" });
    expect(getEditorState().lastSwapSnapshot).toBe(translated);
    // Undoing the translation also undoes the camo swap layered on it.
    expect(undoLastTranslation()).toBe(true);
    expect(ready()).toBe(original);
    expect(getEditorState().lastSwapSnapshot).toBeNull();

    // A translation after a camo swap drops the swap's undo.
    applyCamoSwap(DARK_OAK_SOURCE, SPRUCE, { kind: "all" });
    applyVersionMapping(
      { platform: "java", versionNumber: [1, 21, 4], dataVersion: 4189 },
      {},
      FRAMED_TARGET,
    );
    expect(getEditorState().lastSwapSnapshot).toBeNull();
    expect(camoNames(ready(), 3)).toEqual(["minecraft:spruce_planks"]);
  });
});
