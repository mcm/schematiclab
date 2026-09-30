import { beforeAll, describe, expect, it } from "vitest";
import { Identifier, type Resources, type UV } from "deepslate";

import vanillaBlockstates from "../../../../../public/minecraft-assets/blockstates.json";
import vanillaModels from "../../../../../public/minecraft-assets/models.json";
import { toNbtCompoundValue } from "../../../nbt-value";
import * as nbt from "../../../schemlib/nbt";
import { fromSnbt } from "../../../schemlib/snbt";
import { MISSING_TEXTURE_ID } from "../../atlas-layout";
import {
  assembleResources,
  createVanillaBlockData,
  type VanillaBlockData,
} from "../../block-resources";
import { CamoBlockDefinition, coversFullCube } from "../camo-definition";
import { CAMO_PROPERTY, CamoTable, withCamoProperty } from "../camo-table";
import { validateShapePack, type ShapePack } from "../shape-pack";

const MISSING_UV: UV = [0.5, 0.5, 0.75, 0.75];
const STONE_UV: UV = [0.25, 0, 0.5, 0.25];
const GLASS_UV: UV = [0.75, 0, 1, 0.25];
const FRAME_UV: UV = [0, 0.25, 0.25, 0.5];
const FRAME_ALT_UV: UV = [0.25, 0.25, 0.5, 0.5];
const COPYCAT_UV: UV = [0.5, 0.25, 0.75, 0.5];

const UV_MAP: Record<string, UV> = {
  [MISSING_TEXTURE_ID]: MISSING_UV,
  "minecraft:block/stone": STONE_UV,
  "minecraft:block/glass": GLASS_UV,
  "framedblocks:block/framed_block": FRAME_UV,
  "framedblocks:block/framed_block_alt": FRAME_ALT_UV,
  "create:block/copycat_base": COPYCAT_UV,
};
const ATLAS = { width: 4, height: 4 } as unknown as ImageData;

const FULL = { from: [0, 0, 0], to: [16, 16, 16] };
const BOTTOM = { from: [0, 0, 0], to: [16, 8, 16] };

const PACK: ShapePack = validateShapePack({
  formatVersion: 2,
  source: {
    mod: "framedblocks",
    repository: "test",
    commit: "test",
    modVersion: "test",
    license: "test",
  },
  blocks: {
    "framedblocks:framed_cube": [
      { pieces: [{ slot: "camo", select: FULL, cull: ["up"] }] },
    ],
    "framedblocks:framed_slab": [
      {
        when: { top: "false" },
        pieces: [{ slot: "camo", select: BOTTOM }],
      },
    ],
    "framedblocks:framed_double_slab": [
      {
        pieces: [
          { slot: "camo", select: BOTTOM },
          { slot: "camo_two", select: BOTTOM, transform: ["flipY"] },
        ],
      },
    ],
  },
});

let vanilla: VanillaBlockData;

beforeAll(() => {
  vanilla = createVanillaBlockData(
    vanillaBlockstates as Record<string, unknown>,
    vanillaModels as Record<string, unknown>,
    ["minecraft:stone"],
  );
});

function setup(loaded: string[], packs: ShapePack[] = [PACK]) {
  const table = new CamoTable();
  const { resources } = assembleResources({
    vanilla,
    mods: [],
    uvMap: UV_MAP,
    atlasImage: ATLAS,
    camo: {
      loadedNamespaces: new Set(loaded),
      packs,
      getTable: () => table,
    },
  });
  return { resources, table };
}

function camo(state: string, slot = "camo"): string {
  return `${slot}:{type:"framedblocks:block",state:${state}}`;
}
const EMPTY_CAMO = `{type:"framedblocks:empty"}`;
const STONE = `{Name:"minecraft:stone"}`;
const GLASS = `{Name:"minecraft:glass"}`;

/** Props with `__camo` for a block whose block entity is `snbt`. */
function place(
  table: CamoTable,
  blockId: string,
  props: Record<string, string>,
  snbt?: string,
): Record<string, string> {
  let entity;
  if (snbt !== undefined) {
    const tag = fromSnbt(snbt);
    if (!(tag instanceof nbt.Compound)) throw new Error("not a compound");
    entity = toNbtCompoundValue(tag);
  }
  return withCamoProperty(table, blockId, props, entity);
}

function mesh(
  resources: Resources,
  blockId: string,
  props: Record<string, string>,
) {
  const name = Identifier.parse(blockId);
  const definition = resources.getBlockDefinition(name);
  if (definition === null) throw new Error("no definition");
  return definition.getMesh(name, props, resources, resources, {});
}

/** UV rect (`textureLimit`) → [min y, max y] of the quads using it. */
function textureYRanges(
  resources: Resources,
  blockId: string,
  props: Record<string, string>,
): Map<string, [number, number]> {
  const ranges = new Map<string, [number, number]>();
  for (const quad of mesh(resources, blockId, props).quads) {
    const key = JSON.stringify(quad.v1.textureLimit);
    const [lo, hi] = ranges.get(key) ?? [Infinity, -Infinity];
    const ys = quad.vertices().map((v) => v.pos.y);
    ranges.set(key, [Math.min(lo, ...ys), Math.max(hi, ...ys)]);
  }
  return ranges;
}

const rect = (uv: UV) => JSON.stringify(uv);

describe("camo rendering", () => {
  it("adds __camo only to camo-capable blocks and dedupes combinations", () => {
    const table = new CamoTable();
    expect(place(table, "minecraft:stone", {})).toEqual({});
    const a = place(table, "framedblocks:framed_cube", {}, `{${camo(STONE)}}`);
    const b = place(table, "framedblocks:framed_cube", {}, `{${camo(STONE)}}`);
    const c = place(table, "framedblocks:framed_cube", {}, `{${camo(GLASS)}}`);
    expect(a[CAMO_PROPERTY]).toBe("0");
    expect(b[CAMO_PROPERTY]).toBe("0");
    expect(c[CAMO_PROPERTY]).toBe("1");
    expect(table.entries).toHaveLength(2);
  });

  it("cuts the shape from the camo's own mesh", () => {
    const { resources, table } = setup(["framedblocks"]);
    const props = place(
      table,
      "framedblocks:framed_slab",
      { top: "false" },
      `{${camo(STONE)}}`,
    );
    expect(
      resources.getBlockDefinition(
        Identifier.parse("framedblocks:framed_slab"),
      ),
    ).toBeInstanceOf(CamoBlockDefinition);
    const ranges = textureYRanges(resources, "framedblocks:framed_slab", props);
    expect([...ranges.keys()]).toEqual([rect(STONE_UV)]);
    expect(ranges.get(rect(STONE_UV))).toEqual([0, 0.5]);
  });

  it("renders the missing cube when the mod isn't loaded", () => {
    const { resources, table } = setup([]);
    const props = place(
      table,
      "framedblocks:framed_slab",
      { top: "false" },
      `{${camo(STONE)}}`,
    );
    const ranges = textureYRanges(resources, "framedblocks:framed_slab", props);
    expect([...ranges.keys()]).toEqual([rect(MISSING_UV)]);
    expect(ranges.get(rect(MISSING_UV))).toEqual([0, 1]);
  });

  it("renders a full frame cube with no pack entry", () => {
    const { resources, table } = setup(["framedblocks", "create"]);
    const framed = place(
      table,
      "framedblocks:framed_torch",
      {},
      `{${camo(STONE)}}`,
    );
    let ranges = textureYRanges(resources, "framedblocks:framed_torch", framed);
    expect([...ranges.keys()]).toEqual([rect(FRAME_UV)]);
    expect(ranges.get(rect(FRAME_UV))).toEqual([0, 1]);

    const copycat = place(
      table,
      "create:copycat_step",
      {},
      `{Material:${STONE}}`,
    );
    ranges = textureYRanges(resources, "create:copycat_step", copycat);
    expect([...ranges.keys()]).toEqual([rect(COPYCAT_UV)]);

    // Unmatched states count as no entry too.
    const top = place(
      table,
      "framedblocks:framed_slab",
      { top: "true" },
      `{${camo(STONE)}}`,
    );
    ranges = textureYRanges(resources, "framedblocks:framed_slab", top);
    expect(ranges.get(rect(FRAME_UV))).toEqual([0, 1]);
  });

  it("treats a pack with an unknown formatVersion as no pack entry", async () => {
    const { loadShapePacks, __resetShapePacksForTests } =
      await import("../pack-loader");
    __resetShapePacksForTests();
    const packs = await loadShapePacks(new Set(["framedblocks"]), async () =>
      Response.json({ ...PACK, formatVersion: 99 }),
    );
    __resetShapePacksForTests();
    const { resources, table } = setup(["framedblocks"], packs);
    const props = place(
      table,
      "framedblocks:framed_slab",
      { top: "false" },
      `{${camo(STONE)}}`,
    );
    const ranges = textureYRanges(resources, "framedblocks:framed_slab", props);
    expect(ranges.get(rect(FRAME_UV))).toEqual([0, 1]);
  });

  it("renders an unknown camo block in shape with the missing texture", () => {
    const { resources, table } = setup(["framedblocks"]);
    const props = place(
      table,
      "framedblocks:framed_slab",
      { top: "false" },
      `{${camo(`{Name:"somemod:unknown"}`)}}`,
    );
    const ranges = textureYRanges(resources, "framedblocks:framed_slab", props);
    expect([...ranges.keys()]).toEqual([rect(MISSING_UV)]);
    expect(ranges.get(rect(MISSING_UV))).toEqual([0, 0.5]);
  });

  it("renders empty camos in shape with the frame textures", () => {
    const { resources, table } = setup(["framedblocks"]);
    const props = place(
      table,
      "framedblocks:framed_double_slab",
      {},
      `{camo:${EMPTY_CAMO},camo_two:${EMPTY_CAMO}}`,
    );
    const ranges = textureYRanges(
      resources,
      "framedblocks:framed_double_slab",
      props,
    );
    expect(ranges.get(rect(FRAME_UV))).toEqual([0, 0.5]);
    expect(ranges.get(rect(FRAME_ALT_UV))).toEqual([0.5, 1]);

    // No block entity at all: the same as empty.
    const bare = place(table, "framedblocks:framed_double_slab", {});
    expect(
      textureYRanges(resources, "framedblocks:framed_double_slab", bare).get(
        rect(FRAME_ALT_UV),
      ),
    ).toEqual([0.5, 1]);
  });

  it("drops faces deepslate culls", () => {
    const { resources, table } = setup(["framedblocks"]);
    const props = place(
      table,
      "framedblocks:framed_cube",
      {},
      `{${camo(STONE)}}`,
    );
    const name = Identifier.parse("framedblocks:framed_cube");
    const definition = resources.getBlockDefinition(name)!;
    const all = definition.getMesh(name, props, resources, resources, {});
    const culled = definition.getMesh(name, props, resources, resources, {
      up: true,
    });
    expect(all.quads).toHaveLength(6);
    expect(culled.quads).toHaveLength(5);
  });

  it("is opaque only with a full-cube shape and opaque camos everywhere", () => {
    const flags = (resources: Resources, id: string) =>
      resources.getBlockFlags(Identifier.parse(id))?.opaque;

    let { resources, table } = setup(["framedblocks"]);
    place(table, "framedblocks:framed_cube", {}, `{${camo(STONE)}}`);
    place(
      table,
      "framedblocks:framed_slab",
      { top: "false" },
      `{${camo(STONE)}}`,
    );
    place(
      table,
      "framedblocks:framed_double_slab",
      {},
      `{${camo(STONE)},${camo(STONE, "camo_two")}}`,
    );
    expect(flags(resources, "framedblocks:framed_cube")).toBe(true);
    expect(flags(resources, "framedblocks:framed_slab")).toBe(false);
    expect(flags(resources, "framedblocks:framed_double_slab")).toBe(true);

    ({ resources, table } = setup(["framedblocks"]));
    place(table, "framedblocks:framed_cube", {}, `{${camo(STONE)}}`);
    place(table, "framedblocks:framed_cube", {}, `{${camo(GLASS)}}`);
    place(
      table,
      "framedblocks:framed_double_slab",
      {},
      `{${camo(STONE)},camo_two:${EMPTY_CAMO}}`,
    );
    expect(flags(resources, "framedblocks:framed_cube")).toBe(false);
    expect(flags(resources, "framedblocks:framed_double_slab")).toBe(false);
  });

  it("detects full-cube rules from their pieces", () => {
    const [cube, slab, double] = [
      "framedblocks:framed_cube",
      "framedblocks:framed_slab",
      "framedblocks:framed_double_slab",
    ].map((id) => PACK.blocks[id][0]);
    expect(coversFullCube(cube)).toBe(true);
    expect(coversFullCube(slab)).toBe(false);
    expect(coversFullCube(double)).toBe(true);
  });
});
