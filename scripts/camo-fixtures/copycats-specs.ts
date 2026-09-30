// Copycats+ (copycats, `multiloader` branch, MC 1.21.1) and Create
// (`mc1.21.1/dev`, 6.0.11) copycat blocks for the fixture datapack written by
// `scripts/generate-camo-fixture-datapacks.mts`.
//
// Ids come from CCBlocks.java plus Create's AllBlocks; properties from each
// block's createBlockStateDefinition() and its vanilla superclass. Every
// block Copycats+ registers is here except `copycat_base` (no block entity)
// and `wrapped_copycat` (internal, render-only). The catwalk and box items
// place `copycat_board` with a set of faces, so the board rows cover them.
//
// Block entity NBT (see generateNbt in the generator):
//   - single-state blocks: Material (block state), Item (the material's
//     block item: ICopycatBlockEntity rejects a mismatch and resets the
//     material), EnableCT
//   - multi-state blocks: material_data.<part>.{material, consumedItem,
//     enableCT}; part keys are the state property names (MaterialItemStorage)
//
// States are sampled, not exhaustive: horizontal facings north and east,
// layer counts 1/4/8, and a few connection sets. `falling` marks states that
// `/setblock` would recompute from neighbours on 1.21.1 (connections, stair
// shapes, gate in_wall, doors); the generator lands those as falling blocks.

export type State = Record<string, string>;

export interface CopycatSpec {
  id: string;
  fixture: "shapes" | "slopes";
  states: State[];
  /** Multi-state blocks: the material_data parts that exist in `state`. */
  parts?: (state: State) => string[];
  /** Two-block door: states are the lower half; the upper half is added. */
  door?: boolean;
  /** Place as a falling block so neighbour updates don't change the state. */
  falling?: boolean;
  /** Offset of the block the placement hangs on (buttons, ladders). */
  support?: (state: State) => [number, number, number] | undefined;
  /** Extra single-state materials, placed in `states[0]`. */
  materials?: { state: string; item: string }[];
}

function product(props: Record<string, string[]>): State[] {
  let states: State[] = [{}];
  for (const [name, values] of Object.entries(props)) {
    states = states.flatMap((state) =>
      values.map((value) => ({ ...state, [name]: value })),
    );
  }
  return states;
}

const H = ["north", "east"];
const H6 = ["down", "up", "north", "east"];
const LAYERS = ["1", "4", "8"];

/** Block a wall-mounted block facing `facing` hangs on. */
function behind(facing: string): [number, number, number] | undefined {
  return (
    {
      north: [0, 0, 1],
      south: [0, 0, -1],
      east: [-1, 0, 0],
      west: [1, 0, 0],
    } as Record<string, [number, number, number]>
  )[facing];
}

const truthy = (state: State, names: string[]) =>
  names.filter((name) => state[name] === "true");

/** Sets of `true` sides out of `sides`, as states. */
function sideSets(sides: string[], sets: string[][]): State[] {
  return sets.map((set) =>
    Object.fromEntries(sides.map((side) => [side, String(set.includes(side))])),
  );
}

const HORIZONTAL = ["north", "east", "south", "west"];
const SIX = ["up", "down", ...HORIZONTAL];
const CORNERS = [
  "top_northeast",
  "top_northwest",
  "top_southeast",
  "top_southwest",
  "bottom_northeast",
  "bottom_northwest",
  "bottom_southeast",
  "bottom_southwest",
];
const PANEL_CORNERS = ["bottom_left", "bottom_right", "top_left", "top_right"];

const button = (id: string): CopycatSpec => ({
  id,
  fixture: "shapes",
  states: [
    ...product({ face: ["floor", "ceiling"], facing: H }),
    ...product({ face: ["wall"], facing: H }),
  ],
  support: (state) =>
    state.face === "ceiling"
      ? [0, 1, 0]
      : state.face === "wall"
        ? behind(state.facing)
        : undefined,
});

const layerPairs = [
  ["4", "0"],
  ["0", "4"],
  ["4", "4"],
  ["2", "6"],
  ["8", "8"],
].map(([positive, negative]) => ({
  positive_layers: positive,
  negative_layers: negative,
}));

const layerParts = (state: State) =>
  ["positive_layers", "negative_layers"].filter((part) => state[part] !== "0");

const door = (id: string): CopycatSpec => ({
  id,
  fixture: "shapes",
  door: true,
  states: [
    ...product({ facing: H, hinge: ["left"], open: ["false"] }),
    ...product({ facing: H, hinge: ["left", "right"], open: ["true"] }),
  ],
});

/** Sliding/folding doors: an open door is drawn by the block entity. */
const slidingDoor = (id: string): CopycatSpec => ({
  id,
  fixture: "shapes",
  door: true,
  states: [
    ...product({
      facing: H,
      hinge: ["left"],
      open: ["false"],
      visible: ["true"],
    }),
    ...product({
      facing: H,
      hinge: ["left"],
      open: ["true"],
      visible: ["false"],
    }),
  ],
});

const trapdoor = (id: string): CopycatSpec => ({
  id,
  fixture: "shapes",
  states: product({
    facing: H,
    half: ["top", "bottom"],
    open: ["true", "false"],
  }),
});

export const COPYCAT_SPECS: CopycatSpec[] = [
  // ── Create ──────────────────────────────────────────────────────────────
  {
    id: "create:copycat_step",
    fixture: "shapes",
    states: product({ facing: H, half: ["top", "bottom"] }),
  },
  {
    id: "create:copycat_panel",
    fixture: "shapes",
    states: product({ facing: H6 }),
    // CopycatSpecialCases: bars and trapdoor materials swap the model.
    materials: [
      { state: `{Name:"minecraft:iron_bars"}`, item: "minecraft:iron_bars" },
      {
        state: `{Name:"minecraft:oak_trapdoor",Properties:{facing:"north",half:"bottom",open:"false"}}`,
        item: "minecraft:oak_trapdoor",
      },
      {
        state: `{Name:"minecraft:oak_trapdoor",Properties:{facing:"north",half:"bottom",open:"true"}}`,
        item: "minecraft:oak_trapdoor",
      },
    ],
  },

  // ── Copycats+ single-state ──────────────────────────────────────────────
  { id: "copycats:copycat_block", fixture: "shapes", states: [{}] },
  { id: "copycats:copycat_ghost_block", fixture: "shapes", states: [{}] },
  {
    id: "copycats:copycat_beam",
    fixture: "shapes",
    states: product({ axis: ["x", "y", "z"] }),
  },
  {
    id: "copycats:copycat_flat_pane",
    fixture: "shapes",
    states: product({ axis: ["x", "y", "z"] }),
  },
  {
    id: "copycats:copycat_half_panel",
    fixture: "shapes",
    // offset must be perpendicular to facing.
    states: [
      ...product({ facing: ["up", "down"], offset: HORIZONTAL }),
      ...product({ facing: ["north"], offset: ["east", "west"] }),
      ...product({ facing: ["east"], offset: ["north", "south"] }),
    ],
  },
  {
    id: "copycats:copycat_layer",
    fixture: "shapes",
    states: product({ facing: H6, layers: LAYERS }),
  },
  {
    id: "copycats:copycat_slice",
    fixture: "shapes",
    states: product({ facing: H, half: ["top", "bottom"], layers: LAYERS }),
  },
  {
    id: "copycats:copycat_corner_slice",
    fixture: "shapes",
    states: product({ facing: H, half: ["top", "bottom"], layers: LAYERS }),
  },
  {
    id: "copycats:copycat_vertical_slice",
    fixture: "shapes",
    states: product({ facing: H, layers: LAYERS }),
  },
  {
    id: "copycats:copycat_vertical_step",
    fixture: "shapes",
    states: product({ facing: H }),
  },
  {
    id: "copycats:copycat_stairs",
    fixture: "shapes",
    falling: true,
    states: product({
      facing: H,
      half: ["top", "bottom"],
      shape: ["straight", "inner_left", "outer_right"],
    }),
  },
  {
    id: "copycats:copycat_vertical_stairs",
    fixture: "shapes",
    falling: true,
    states: product({
      facing: H,
      side: ["left", "right"],
      vertical_stair_shape: ["straight", "outer_top", "inner_bottom"],
    }),
  },
  {
    id: "copycats:copycat_fence",
    fixture: "shapes",
    falling: true,
    states: sideSets(HORIZONTAL, [
      [],
      ["north"],
      ["north", "south"],
      ["north", "east"],
      HORIZONTAL,
    ]),
  },
  {
    id: "copycats:copycat_pane",
    fixture: "shapes",
    falling: true,
    states: sideSets(HORIZONTAL, [
      [],
      ["north"],
      ["north", "south"],
      ["north", "east"],
      HORIZONTAL,
    ]),
  },
  {
    id: "copycats:copycat_wall",
    fixture: "shapes",
    falling: true,
    states: [
      { up: "true", north: "none", east: "none", south: "none", west: "none" },
      { up: "false", north: "low", east: "none", south: "low", west: "none" },
      { up: "true", north: "low", east: "tall", south: "none", west: "none" },
      { up: "true", north: "tall", east: "tall", south: "tall", west: "tall" },
    ],
  },
  {
    id: "copycats:copycat_fence_gate",
    fixture: "shapes",
    falling: true,
    states: product({
      facing: H,
      open: ["true", "false"],
      in_wall: ["true", "false"],
    }),
  },
  trapdoor("copycats:copycat_trapdoor"),
  trapdoor("copycats:copycat_iron_trapdoor"),
  door("copycats:copycat_door"),
  door("copycats:copycat_iron_door"),
  slidingDoor("copycats:copycat_sliding_door"),
  slidingDoor("copycats:copycat_folding_door"),
  {
    id: "copycats:copycat_ladder",
    fixture: "shapes",
    states: product({ facing: H }),
    support: (state) => behind(state.facing),
  },
  button("copycats:copycat_wooden_button"),
  button("copycats:copycat_stone_button"),
  ...[
    "copycats:copycat_wooden_pressure_plate",
    "copycats:copycat_stone_pressure_plate",
    "copycats:copycat_light_weighted_pressure_plate",
    "copycats:copycat_heavy_weighted_pressure_plate",
  ].map((id): CopycatSpec => ({ id, fixture: "shapes", states: [{}] })),
  {
    id: "copycats:copycat_fluid_pipe",
    fixture: "shapes",
    falling: true,
    states: sideSets(SIX, [
      ["north", "south"],
      ["north", "east"],
      ["up", "down", "north"],
      SIX,
    ]),
  },
  {
    // No item: the wrenched form of copycat_fluid_pipe.
    id: "copycats:copycat_glass_fluid_pipe",
    fixture: "shapes",
    states: product({ axis: ["x", "y", "z"] }),
  },

  // ── Copycats+ multi-state ───────────────────────────────────────────────
  {
    id: "copycats:copycat_slab",
    fixture: "shapes",
    states: product({
      axis: ["x", "y", "z"],
      type: ["bottom", "top", "double"],
    }),
    parts: (state) =>
      state.type === "double" ? ["top", "bottom"] : [state.type],
  },
  {
    // Catwalk and box are boards with these face sets.
    id: "copycats:copycat_board",
    fixture: "shapes",
    states: sideSets(SIX, [
      ["down"],
      ["north"],
      ["up", "down"],
      ["north", "east"],
      ["down", ...HORIZONTAL],
      SIX,
    ]),
    parts: (state) => truthy(state, SIX),
  },
  {
    id: "copycats:copycat_byte",
    fixture: "shapes",
    states: sideSets(CORNERS, [
      ["bottom_northeast"],
      ["top_northwest", "bottom_southeast"],
      CORNERS.slice(4),
      CORNERS.slice(1),
      CORNERS,
    ]),
    parts: (state) => truthy(state, CORNERS),
  },
  {
    id: "copycats:copycat_byte_panel",
    fixture: "shapes",
    states: ["up", "north", "east"].flatMap((facing) =>
      sideSets(PANEL_CORNERS, [
        ["bottom_left"],
        ["bottom_left", "top_right"],
        PANEL_CORNERS,
      ]).map((state) => ({ facing, ...state })),
    ),
    parts: (state) => truthy(state, PANEL_CORNERS),
  },
  {
    id: "copycats:copycat_half_layer",
    fixture: "shapes",
    states: product({ axis: ["x", "z"], half: ["top", "bottom"] }).flatMap(
      (state) => layerPairs.map((layers) => ({ ...state, ...layers })),
    ),
    parts: layerParts,
  },
  {
    id: "copycats:copycat_vertical_half_layer",
    fixture: "shapes",
    states: product({ facing: H }).flatMap((state) =>
      layerPairs.map((layers) => ({ ...state, ...layers })),
    ),
    parts: layerParts,
  },
  {
    id: "copycats:copycat_stacked_half_layer",
    fixture: "shapes",
    states: product({ facing: H }).flatMap((state) =>
      layerPairs.map((layers) => ({ ...state, ...layers })),
    ),
    parts: layerParts,
  },

  // ── Slopes and kinetic copycats (US-016) ────────────────────────────────
  {
    id: "copycats:copycat_slope",
    fixture: "slopes",
    states: product({ facing: H, half: ["top", "bottom"] }),
  },
  {
    id: "copycats:copycat_vertical_slope",
    fixture: "slopes",
    states: product({ facing: H }),
  },
  {
    id: "copycats:copycat_slope_layer",
    fixture: "slopes",
    states: product({
      facing: H,
      half: ["top", "bottom"],
      layers: ["1", "2", "3", "4", "5", "6", "7", "8"],
    }),
  },
  {
    id: "copycats:copycat_shaft",
    fixture: "slopes",
    states: product({ axis: ["x", "y", "z"] }),
  },
  {
    id: "copycats:copycat_cogwheel",
    fixture: "slopes",
    states: product({ axis: ["x", "y", "z"] }),
    parts: () => ["cogwheel", "shaft"],
  },
  {
    id: "copycats:copycat_large_cogwheel",
    fixture: "slopes",
    states: product({ axis: ["x", "y", "z"] }),
    parts: () => ["cogwheel", "shaft"],
  },
];
