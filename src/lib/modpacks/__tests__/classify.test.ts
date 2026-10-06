import { describe, expect, it } from "vitest";
import { modernizeLegacyModAssets } from "../../mods/generated/legacy-blockstate";
import { classifyModBlock } from "../classify";
import type { ModBlockShapeInput } from "../classify";

const BOOL = ["false", "true"];
const SIDES_BOOL = { north: BOOL, east: BOOL, south: BOOL, west: BOOL };

/** A blockstate with one variant per model, keyed `"m=<index>"`. */
function variants(...models: string[]): Record<string, unknown> {
  return {
    variants: Object.fromEntries(
      models.map((model, index) => [`m=${index}`, { model }]),
    ),
  };
}

/** A mod model `test:block/<name>` parenting `parent`. */
function child(name: string, parent: string): Record<string, unknown> {
  return { [`test:block/${name}`]: { parent, textures: { all: "test:x" } } };
}

function block(
  properties: ModBlockShapeInput["properties"],
  blockstate: unknown,
  models: Record<string, unknown> = {},
): ModBlockShapeInput {
  return { id: "test:thing", properties, blockstate, models };
}

const CUSTOM_ELEMENT = {
  from: [2, 0, 2],
  to: [14, 10, 14],
  faces: { up: { texture: "#all" } },
};
const FULL_ELEMENT = {
  from: [0, 0, 0],
  to: [16, 16, 16],
  faces: { up: { texture: "#all" } },
};

describe("classifyModBlock", () => {
  const cases: [string, ModBlockShapeInput, string, boolean][] = [
    [
      "block (cube_all through a mod model)",
      block(
        {},
        variants("test:block/bricks"),
        child("bricks", "block/cube_all"),
      ),
      "block",
      true,
    ],
    [
      "block (elements spanning the full cube)",
      block({}, variants("test:block/crate"), {
        "test:block/crate": { elements: [FULL_ELEMENT, FULL_ELEMENT] },
      }),
      "block",
      true,
    ],
    [
      "block (orientable with facing)",
      block(
        { facing: ["north", "south"] },
        variants("minecraft:block/orientable"),
      ),
      "block",
      true,
    ],
    [
      "stairs",
      block(
        {
          facing: ["east", "north", "south", "west"],
          half: ["bottom", "top"],
          shape: ["inner_left", "outer_right", "straight"],
          waterlogged: BOOL,
        },
        variants(
          "test:block/brass_stairs",
          "test:block/brass_stairs_inner",
          "test:block/brass_stairs_outer",
        ),
        {
          ...child("brass_stairs", "minecraft:block/stairs"),
          ...child("brass_stairs_inner", "minecraft:block/inner_stairs"),
          ...child("brass_stairs_outer", "minecraft:block/outer_stairs"),
        },
      ),
      "stairs",
      false,
    ],
    [
      "slab (its double slab is a cube)",
      block(
        { type: ["bottom", "double", "top"], waterlogged: BOOL },
        variants(
          "minecraft:block/slab",
          "minecraft:block/slab_top",
          "test:block/brass_block",
        ),
        child("brass_block", "minecraft:block/cube_all"),
      ),
      "slab",
      false,
    ],
    [
      "wall",
      block(
        {
          up: BOOL,
          north: ["low", "none", "tall"],
          east: ["low", "none", "tall"],
          south: ["low", "none", "tall"],
          west: ["low", "none", "tall"],
        },
        {
          multipart: [
            { when: { up: "true" }, apply: { model: "test:block/w_post" } },
            { when: { north: "low" }, apply: { model: "test:block/w_side" } },
            {
              when: { north: "tall" },
              apply: { model: "test:block/w_side_tall" },
            },
          ],
        },
        {
          ...child("w_post", "minecraft:block/template_wall_post"),
          ...child("w_side", "minecraft:block/template_wall_side"),
          ...child("w_side_tall", "minecraft:block/template_wall_side_tall"),
        },
      ),
      "wall",
      false,
    ],
    [
      "fence",
      block(
        { ...SIDES_BOOL, waterlogged: BOOL },
        {
          multipart: [
            { apply: { model: "test:block/f_post" } },
            { when: { north: "true" }, apply: { model: "test:block/f_side" } },
          ],
        },
        {
          ...child("f_post", "minecraft:block/fence_post"),
          ...child("f_side", "minecraft:block/fence_side"),
        },
      ),
      "fence",
      false,
    ],
    [
      "pane",
      block(
        SIDES_BOOL,
        {
          multipart: [
            { apply: { model: "test:block/p_post" } },
            { when: { north: "true" }, apply: { model: "test:block/p_side" } },
          ],
        },
        {
          ...child("p_post", "minecraft:block/template_glass_pane_post"),
          ...child("p_side", "minecraft:block/template_glass_pane_side"),
        },
      ),
      "pane",
      false,
    ],
    [
      "fence_gate",
      block(
        {
          facing: ["north"],
          in_wall: BOOL,
          open: BOOL,
          powered: BOOL,
        },
        variants(
          "minecraft:block/template_fence_gate",
          "minecraft:block/template_fence_gate_wall_open",
        ),
      ),
      "fence_gate",
      false,
    ],
    [
      "door",
      block(
        {
          facing: ["north"],
          half: ["lower", "upper"],
          hinge: ["left", "right"],
          open: BOOL,
        },
        variants(
          "minecraft:block/door_bottom_left",
          "minecraft:block/door_top_right_open",
        ),
      ),
      "door",
      false,
    ],
    [
      "trapdoor",
      block(
        { facing: ["north"], half: ["bottom", "top"], open: BOOL },
        variants(
          "minecraft:block/template_orientable_trapdoor_bottom",
          "minecraft:block/template_orientable_trapdoor_open",
        ),
      ),
      "trapdoor",
      false,
    ],
    [
      "log (axis and cube_column)",
      block(
        { axis: ["x", "y", "z"] },
        variants("test:block/oak_log_ish", "test:block/oak_log_ish_horizontal"),
        {
          ...child("oak_log_ish", "minecraft:block/cube_column"),
          ...child(
            "oak_log_ish_horizontal",
            "minecraft:block/cube_column_horizontal",
          ),
        },
      ),
      "log",
      true,
    ],
    [
      "block (cube_column without axis)",
      block({}, variants("minecraft:block/cube_column")),
      "block",
      true,
    ],
    [
      "button",
      block(
        {
          face: ["ceiling", "floor", "wall"],
          facing: ["north"],
          powered: BOOL,
        },
        variants("minecraft:block/button", "minecraft:block/button_pressed"),
      ),
      "button",
      false,
    ],
    [
      "lever",
      block(
        {
          face: ["ceiling", "floor", "wall"],
          facing: ["north"],
          powered: BOOL,
        },
        variants("minecraft:block/lever", "minecraft:block/lever_on"),
      ),
      "lever",
      false,
    ],
    [
      "pressure_plate",
      block(
        { powered: BOOL },
        variants(
          "minecraft:block/pressure_plate_up",
          "minecraft:block/pressure_plate_down",
        ),
      ),
      "pressure_plate",
      false,
    ],
    ["carpet", block({}, variants("minecraft:block/carpet")), "carpet", false],
    [
      "torch",
      block({}, variants("minecraft:block/template_torch")),
      "torch",
      false,
    ],
    [
      "wall_torch",
      block(
        { facing: ["east", "north"] },
        variants("minecraft:block/template_torch_wall"),
      ),
      "wall_torch",
      false,
    ],
    [
      "lantern",
      block(
        { hanging: BOOL, waterlogged: BOOL },
        variants(
          "minecraft:block/template_lantern",
          "minecraft:block/template_hanging_lantern",
        ),
      ),
      "lantern",
      false,
    ],
    [
      "leaves",
      block(
        { distance: ["1", "7"], persistent: BOOL },
        variants("test:block/leafy"),
        child("leafy", "minecraft:block/leaves"),
      ),
      "leaves",
      true,
    ],
    ["plant", block({}, variants("minecraft:block/cross")), "plant", false],
    [
      "pot",
      block({}, variants("minecraft:block/flower_pot_cross")),
      "pot",
      false,
    ],
    [
      "bed (properties, entity model)",
      block(
        { facing: ["north"], occupied: BOOL, part: ["foot", "head"] },
        variants("test:block/bed"),
        { "test:block/bed": { textures: { particle: "test:x" } } },
      ),
      "bed",
      false,
    ],
    [
      "chest (properties, builtin model)",
      block(
        { facing: ["north"], type: ["left", "right", "single"] },
        variants("test:block/chest"),
        { "test:block/chest": { parent: "builtin/entity" } },
      ),
      "chest",
      false,
    ],
    [
      "stairs from properties alone (custom elements)",
      block(
        {
          facing: ["north"],
          half: ["bottom", "top"],
          shape: ["straight"],
        },
        variants("test:block/fancy_stairs"),
        { "test:block/fancy_stairs": { elements: [CUSTOM_ELEMENT] } },
      ),
      "stairs",
      false,
    ],
  ];

  it.each(cases)("%s", (_name, input, kind, fullCube) => {
    expect(classifyModBlock(input)).toEqual({
      kind,
      full_cube: fullCube,
      confidence: "high",
    });
  });

  it("reads a 1.12 Forge forge_marker blockstate through modernizeLegacyModAssets", () => {
    const assets = modernizeLegacyModAssets(
      {
        blockstates: {
          "test:old_log": {
            forge_marker: 1,
            defaults: {
              model: "cube_column",
              textures: { end: "test:blocks/log_top", side: "test:blocks/log" },
            },
            variants: {
              axis: { y: {}, x: { x: 90, y: 90 }, z: { x: 90 } },
              inventory: [{}],
            },
          },
          "test:old_slab": {
            forge_marker: 1,
            defaults: { textures: { all: "test:blocks/stone" } },
            variants: {
              half: {
                bottom: { model: "half_slab" },
                top: { model: "upper_slab" },
              },
            },
          },
        },
        models: {},
      },
      () => false,
    );
    expect(
      classifyModBlock({
        id: "test:old_log",
        properties: { axis: ["x", "y", "z"] },
        blockstate: assets.blockstates["test:old_log"],
        models: assets.models,
      }),
    ).toEqual({ kind: "log", full_cube: true, confidence: "high" });
    // 1.12 slabs have `half`, not `type`: the models alone decide.
    expect(
      classifyModBlock({
        id: "test:old_slab",
        properties: { half: ["bottom", "top"] },
        blockstate: assets.blockstates["test:old_slab"],
        models: assets.models,
      }),
    ).toEqual({ kind: "slab", full_cube: false, confidence: "high" });
  });

  it("gives a block of custom elements no kind and no full cube", () => {
    expect(
      classifyModBlock(
        block({ facing: ["north", "south"] }, variants("test:block/machine"), {
          "test:block/machine": {
            parent: "minecraft:block/block",
            elements: [CUSTOM_ELEMENT, FULL_ELEMENT],
          },
        }),
      ),
    ).toEqual({ kind: "unknown", full_cube: false, confidence: "low" });
  });

  it("returns unknown for ambiguous or conflicting evidence", () => {
    const unknown = { kind: "unknown", full_cube: false, confidence: "low" };
    // Four side booleans: fence or pane, and no model to tell.
    expect(classifyModBlock(block(SIDES_BOOL, {}))).toEqual(unknown);
    // face + powered: button or lever, and a missing model.
    expect(
      classifyModBlock(
        block(
          { face: ["floor"], facing: ["north"], powered: BOOL },
          variants("test:block/missing"),
        ),
      ),
    ).toEqual(unknown);
    // Stairs properties on a fence model.
    expect(
      classifyModBlock(
        block(
          { facing: ["north"], half: ["bottom", "top"], shape: ["straight"] },
          variants("minecraft:block/fence_post"),
        ),
      ),
    ).toEqual(unknown);
    // Models that disagree with each other.
    expect(
      classifyModBlock(
        block(
          {},
          variants("minecraft:block/carpet", "minecraft:block/template_torch"),
        ),
      ),
    ).toEqual(unknown);
    // An unknown vanilla parent and no elements.
    expect(
      classifyModBlock(
        block({}, variants("test:block/odd"), child("odd", "block/block")),
      ),
    ).toEqual(unknown);
    // `axis` on a model with custom elements.
    expect(
      classifyModBlock(
        block({ axis: ["x", "y", "z"] }, variants("test:block/chain"), {
          "test:block/chain": { elements: [CUSTOM_ELEMENT] },
        }),
      ),
    ).toEqual(unknown);
  });

  it("checks every model of the default state for full_cube", () => {
    // Both unconditional parts draw, and only one is a full cube.
    const result = classifyModBlock(
      block(
        {},
        {
          multipart: [
            { apply: { model: "minecraft:block/cube_all" } },
            { apply: { model: "minecraft:block/carpet" } },
          ],
        },
      ),
    );
    expect(result.full_cube).toBe(false);
  });
});
