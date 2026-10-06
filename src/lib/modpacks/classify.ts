// Shape classification of mod blocks: a `kind` from the vanilla vocabulary of
// `blockdata/registry.ts` (stairs, slab, wall…) and a `full_cube` flag, read
// from two kinds of evidence and never from the block's name:
//
//   - property sets: `facing`+`half`+`shape` is a stair, `type` of
//     top/bottom/double a slab, `hinge`+`half=upper|lower` a door…
//     Some sets only narrow it down (four side booleans: fence or pane;
//     `face`+`powered`: button or lever; `axis`: log or a plain block).
//   - model parent chains that reach a vanilla `minecraft:block/*` template
//     (`block/stairs`, `block/template_wall_post`, `block/cube_column`…), or
//     elements that are a full 0–16 cube.
//
// Strong property sets win unless a model contradicts them; weak ones need a
// model to agree. Conflicting or missing evidence gives `unknown` with low
// confidence instead of a guess. Pass 1.12 assets through
// `modernizeLegacyModAssets` first, so Forge variants become ordinary
// blockstates and models.
//
// Pure; imports carry their `.ts` extension so the upload CLI can load it
// with node's strip-types.

import type { BlockKind } from "../blockdata/registry.ts";
import {
  defaultStateModels,
  isFullCubeModel,
  normalizeResourceId,
} from "../render/block-appearance.ts";

export type ClassifiedKind = BlockKind | "unknown";

export interface ModBlockClassification {
  kind: ClassifiedKind;
  /** True when every model of the default state is a full 0–16 cube. */
  full_cube: boolean;
  /** `high` whenever `kind` isn't `unknown`. */
  confidence: "high" | "low";
}

export interface ModBlockShapeInput {
  /** Namespaced block id, e.g. `create:brass_block`. */
  id: string;
  /** Property name → the values it takes. */
  properties: Readonly<Record<string, readonly string[]>>;
  /** The block's (modern) blockstate JSON. */
  blockstate: unknown;
  /**
   * Model JSON by normalized id (`ns:block/x`). Vanilla models may be
   * included; a chain stops at the first vanilla template either way.
   */
  models: Readonly<Record<string, unknown>>;
}

const MAX_DEPTH = 32;

/** What a vanilla template says: its kinds, and whether it's a full cube. */
interface Template {
  kinds: readonly BlockKind[];
  fullCube: boolean;
}

const CUBE: Template = { kinds: ["block"], fullCube: true };
const COLUMN: Template = { kinds: ["block", "log"], fullCube: true };
const shaped = (kind: BlockKind): Template => ({
  kinds: [kind],
  fullCube: false,
});

// `minecraft:block/<name>` templates, modern and 1.12 names.
const TEMPLATES: Record<string, Template> = {
  cube: CUBE,
  cube_all: CUBE,
  cube_all_inner_faces: CUBE,
  cube_bottom_top: CUBE,
  cube_bottom_top_inner_faces: CUBE,
  cube_top: CUBE,
  cube_directional: CUBE,
  cube_mirrored: CUBE,
  cube_mirrored_all: CUBE,
  cube_north_west_mirrored_all: CUBE,
  orientable: CUBE,
  orientable_with_bottom: CUBE,
  orientable_vertical: CUBE,
  template_glazed_terracotta: CUBE,
  template_single_face: CUBE,
  template_command_block: CUBE,
  cube_column: COLUMN,
  cube_column_horizontal: COLUMN,
  cube_column_mirrored: COLUMN,
  cube_column_uv_locked_x: COLUMN,
  cube_column_uv_locked_y: COLUMN,
  cube_column_uv_locked_z: COLUMN,
  column_side: COLUMN,
  leaves: { kinds: ["leaves"], fullCube: true },
  stairs: shaped("stairs"),
  inner_stairs: shaped("stairs"),
  outer_stairs: shaped("stairs"),
  slab: shaped("slab"),
  slab_top: shaped("slab"),
  half_slab: shaped("slab"),
  upper_slab: shaped("slab"),
  template_wall_post: shaped("wall"),
  template_wall_side: shaped("wall"),
  template_wall_side_tall: shaped("wall"),
  wall_inventory: shaped("wall"),
  button: shaped("button"),
  button_pressed: shaped("button"),
  button_inventory: shaped("button"),
  pressure_plate_up: shaped("pressure_plate"),
  pressure_plate_down: shaped("pressure_plate"),
  carpet: shaped("carpet"),
  torch: shaped("torch"),
  template_torch: shaped("torch"),
  wall_torch: shaped("wall_torch"),
  torch_wall: shaped("wall_torch"),
  template_torch_wall: shaped("wall_torch"),
  template_lantern: shaped("lantern"),
  template_hanging_lantern: shaped("lantern"),
  lever: shaped("lever"),
  lever_on: shaped("lever"),
  cross: shaped("plant"),
  tinted_cross: shaped("plant"),
  crop: shaped("plant"),
  flower_pot: shaped("pot"),
  flower_pot_cross: shaped("pot"),
  template_bed_head: shaped("bed"),
  template_bed_foot: shaped("bed"),
};

// Template families matched by name pattern.
const TEMPLATE_PATTERNS: readonly [RegExp, BlockKind][] = [
  [/^wall_(post|n|ne|ns|nse|nsew)$/, "wall"],
  [/^(custom_)?fence_(post|side|inventory|n|ne|ns|nse|nsew)$/, "fence"],
  [/^custom_fence_side_(north|east|south|west)$/, "fence"],
  [/^template_(custom_)?fence_gate(_wall)?(_open)?$/, "fence_gate"],
  [/^(fence|wall)_gate_(open|closed)$/, "fence_gate"],
  [/^template_glass_pane_/, "pane"],
  [/^pane_(post|side|side_alt|noside|noside_alt|n|ne|ns|nse|nsew)$/, "pane"],
  [/^template_bars_/, "pane"],
  [/^door_(bottom|top)/, "door"],
  [/^template_(orientable_)?trapdoor_(bottom|top|open)$/, "trapdoor"],
  [/^trapdoor_(bottom|top|open)$/, "trapdoor"],
];

function vanillaTemplate(modelId: string): Template | null {
  const prefix = "minecraft:block/";
  if (!modelId.startsWith(prefix)) return null;
  const name = modelId.slice(prefix.length);
  if (Object.hasOwn(TEMPLATES, name)) return TEMPLATES[name];
  for (const [pattern, kind] of TEMPLATE_PATTERNS) {
    if (pattern.test(name)) return shaped(kind);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What one model says: a template's kinds, elements' shape (`kinds` is
 * `["block"]` for a full cube, empty for custom elements), or null when the
 * chain can't be followed (a missing model, a `builtin/` parent, no
 * elements anywhere).
 */
type ModelEvidence = Template;

function modelEvidence(
  modelId: string,
  models: Readonly<Record<string, unknown>>,
): ModelEvidence | null {
  let id = modelId;
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const template = vanillaTemplate(id);
    if (template !== null) return template;
    const model = Object.hasOwn(models, id) ? models[id] : undefined;
    if (!isRecord(model)) return null;
    if (Array.isArray(model.elements)) {
      return isFullCubeModel(model.elements)
        ? CUBE
        : { kinds: [], fullCube: false };
    }
    if (typeof model.parent !== "string") return null;
    id = normalizeResourceId(model.parent);
    if (id.startsWith("minecraft:builtin/")) return null;
  }
  return null;
}

/** Every model a blockstate can draw, normalized. */
function blockstateModels(blockstate: unknown): string[] {
  if (!isRecord(blockstate)) return [];
  const out = new Set<string>();
  const add = (value: unknown) => {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (isRecord(entry) && typeof entry.model === "string") {
        out.add(normalizeResourceId(entry.model));
      }
    }
  };
  if (isRecord(blockstate.variants)) {
    Object.values(blockstate.variants).forEach(add);
  }
  if (Array.isArray(blockstate.multipart)) {
    for (const part of blockstate.multipart) {
      if (isRecord(part)) add(part.apply);
    }
  }
  return [...out];
}

/**
 * The kinds the models allow: the intersection of what every model with a
 * kind says (a slab's double-slab cube doesn't count), or null when no model
 * says anything.
 */
function modelKinds(evidence: readonly ModelEvidence[]): Set<BlockKind> | null {
  let withKinds = evidence.filter((e) => e.kinds.length > 0);
  if (withKinds.some((e) => e.kinds.includes("slab"))) {
    withKinds = withKinds.filter((e) => e !== CUBE);
  }
  if (withKinds.length === 0) return null;
  let kinds = new Set(withKinds[0].kinds);
  for (const e of withKinds.slice(1)) {
    kinds = new Set(e.kinds.filter((kind) => kinds.has(kind)));
  }
  return kinds;
}

const SIDES = ["north", "east", "south", "west"] as const;

/** What the property set says, and whether that holds without a model. */
interface PropertyEvidence {
  kinds: readonly BlockKind[];
  strong: boolean;
}

function within(
  values: readonly string[] | undefined,
  allowed: readonly string[],
): boolean {
  return (
    values !== undefined &&
    values.length > 0 &&
    values.every((value) => allowed.includes(value))
  );
}

function propertyEvidence(
  properties: Readonly<Record<string, readonly string[]>>,
): PropertyEvidence | null {
  const has = (name: string) => Object.hasOwn(properties, name);
  const values = (name: string): readonly string[] | undefined =>
    has(name) ? properties[name] : undefined;
  const booleans = (name: string) => within(values(name), ["true", "false"]);
  const strong = (kind: BlockKind): PropertyEvidence => ({
    kinds: [kind],
    strong: true,
  });
  const weak = (...kinds: BlockKind[]): PropertyEvidence => ({
    kinds,
    strong: false,
  });

  if (
    has("facing") &&
    within(values("half"), ["top", "bottom"]) &&
    within(values("shape"), [
      "straight",
      "inner_left",
      "inner_right",
      "outer_left",
      "outer_right",
    ])
  ) {
    return strong("stairs");
  }
  if (has("hinge") && within(values("half"), ["upper", "lower"])) {
    return strong("door");
  }
  const type = values("type");
  if (
    within(type, ["top", "bottom", "double"]) &&
    (type?.includes("top") || type?.includes("bottom"))
  ) {
    return strong("slab");
  }
  if (has("in_wall")) return strong("fence_gate");
  if (
    has("open") &&
    within(values("half"), ["top", "bottom"]) &&
    !has("shape")
  ) {
    return strong("trapdoor");
  }
  if (
    has("up") &&
    SIDES.every((side) => within(values(side), ["none", "low", "tall"]))
  ) {
    return strong("wall");
  }
  if (within(values("part"), ["head", "foot"]) && has("occupied")) {
    return strong("bed");
  }
  if (within(type, ["single", "left", "right"])) return strong("chest");

  const fourSides = SIDES.every(booleans);
  // 1.12 walls: `up` and four side booleans (but so are vines).
  if (fourSides && booleans("up") && !has("down")) return weak("wall");
  if (fourSides && !has("up") && !has("down")) return weak("fence", "pane");
  if (within(values("face"), ["floor", "wall", "ceiling"]) && has("powered")) {
    return weak("button", "lever");
  }
  if (
    (has("distance") && has("persistent")) ||
    (has("decayable") && has("check_decay"))
  ) {
    return weak("leaves");
  }
  if (has("hanging")) return weak("lantern");
  if (within(values("axis"), ["x", "y", "z"])) return weak("log", "block");
  return null;
}

const UNKNOWN = { kind: "unknown", confidence: "low" } as const;

function decideKind(
  props: PropertyEvidence | null,
  models: Set<BlockKind> | null,
): Pick<ModBlockClassification, "kind" | "confidence"> {
  const one = (kinds: Set<BlockKind>) =>
    kinds.size === 1
      ? ({ kind: [...kinds][0], confidence: "high" } as const)
      : UNKNOWN;
  if (props === null) {
    if (models === null) return UNKNOWN;
    // A column template without `axis` is a plain block that doesn't turn.
    if (models.size === 2 && models.has("block") && models.has("log")) {
      return { kind: "block", confidence: "high" };
    }
    return one(models);
  }
  if (models === null) {
    return props.strong ? one(new Set(props.kinds)) : UNKNOWN;
  }
  const both = new Set(props.kinds.filter((kind) => models.has(kind)));
  // `axis` on a column template: a log.
  if (both.size === 2 && both.has("block") && both.has("log")) {
    return { kind: "log", confidence: "high" };
  }
  return one(both);
}

/** The shape class of a mod block from its properties, blockstate and models. */
export function classifyModBlock(
  input: ModBlockShapeInput,
): ModBlockClassification {
  const evidence = blockstateModels(input.blockstate)
    .map((id) => modelEvidence(id, input.models))
    .filter((e): e is ModelEvidence => e !== null);
  const decided = decideKind(
    propertyEvidence(input.properties),
    modelKinds(evidence),
  );

  const defaults = defaultStateModels(input.blockstate);
  const full_cube =
    defaults.length > 0 &&
    defaults.every((id) => modelEvidence(id, input.models)?.fullCube === true);
  return { ...decided, full_cube };
}
