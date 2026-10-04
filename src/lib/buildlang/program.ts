// Build language programs (Cairn `SPEC.md` sections 1–3): the program and
// operation types, and `validateProgram`, which checks a parsed JSON program
// before it is compiled and reports every problem at its program path
// (`build[2].box.do[0].split.parts[1]`). Worker-safe.
//
// Validation is structural. Material names, block states and template
// parameters are checked when the program is compiled. Inside template
// bodies, any value or key containing `$` is a parameter and is accepted as
// written.

import { parseLength, type LengthContext } from "./lengths";

/** Largest program `size` on each axis. */
export const MAX_BUILD_SIZE = 256;

/** Deepest nesting of operations `validateProgram` follows. */
export const MAX_VALIDATION_DEPTH = 64;

/** `#`-prefixed keys are comments and may appear in any object. */
export type CommentKeys = { [comment: `#${string}`]: unknown };

export type Vec3<T> = [T, T, T];
export type Axis = "x" | "y" | "z";

/** An integer, `"N%"`, `"~"`, `"~N"` or `"center"`/`"start"`/`"end"`; see `lengths.ts`. */
export type LengthSpec = number | string;

/** A block id (with optional `[states]`), `"@role"`, `"@role:variant"`, `"family:variant"` or a mix. */
export type MaterialSpec =
  | string
  | ({ mix: Record<string, number> } & CommentKeys);

export type StateValue = string | number | boolean;

/** `priority` and `carve` (section 3a), allowed in every argument object. */
export interface LayerArgs {
  priority?: number;
  carve?: boolean;
}

export type Operations = Operation[];

export interface BoxArgs extends LayerArgs {
  at?: Vec3<LengthSpec>;
  size?: Vec3<LengthSpec>;
  rotate?: number;
  do?: Operations;
}

export interface SplitPart {
  size: LengthSpec;
  do?: Operations;
}

export interface SplitArgs extends LayerArgs {
  axis: Axis;
  parts: (SplitPart & CommentKeys)[];
}

export type RepeatAlign = "center" | "start" | "end" | "stretch";

export interface RepeatArgs extends LayerArgs {
  axis: Axis;
  every?: number;
  gap?: number;
  count?: number;
  margin?: number;
  align?: RepeatAlign;
  do?: Operations;
  pattern?: Operations[];
  first?: Operations;
  last?: Operations;
  ends?: Operations;
}

export const INSET_SIDES = [
  "x",
  "y",
  "z",
  "left",
  "right",
  "front",
  "back",
  "top",
  "bottom",
] as const;
export type InsetSide = (typeof INSET_SIDES)[number];

export interface InsetArgs extends LayerArgs {
  by: number | (Partial<Record<InsetSide, number>> & CommentKeys);
  do?: Operations;
}

export const FACE_NAMES = [
  "sides",
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "edges",
] as const;
export type FaceName = (typeof FACE_NAMES)[number];

export type FacesArgs = LayerArgs &
  Partial<Record<FaceName, Operations>> & { thickness?: number };

/** Local directions a `facing` may name (section 4); compass names pass through. */
export const FACING_NAMES = [
  "+x",
  "-x",
  "+z",
  "-z",
  "up",
  "down",
  "in",
  "out",
  "left",
  "right",
  "front",
  "back",
  "north",
  "south",
  "east",
  "west",
] as const;
export type FacingName = (typeof FACING_NAMES)[number];

/** Materials `replace` may overwrite; `"solid"` (or `"any"`) is any non-air block. */
export type ReplaceSpec = MaterialSpec | MaterialSpec[];

export interface PlacementArgs {
  replace?: ReplaceSpec;
  only_empty?: boolean;
  facing?: FacingName;
  axis?: Axis;
  half?: string;
  state?: Record<string, StateValue>;
}

export interface FillArgs extends LayerArgs, PlacementArgs {
  material: MaterialSpec;
}

export interface BlockArgs extends LayerArgs {
  material: MaterialSpec;
  at?: Vec3<LengthSpec>;
  only_empty?: boolean;
  facing?: FacingName;
  axis?: Axis;
  half?: string;
  state?: Record<string, StateValue>;
}

export interface DoorArgs extends LayerArgs {
  material?: MaterialSpec;
  x?: number;
  facing?: FacingName;
  hinge?: "left" | "right";
}

export interface RoundArgs extends FillArgs {
  hollow?: boolean;
  thickness?: number;
}

/** Roofs come in a later epic; their arguments are not checked yet. */
export type RoofArgs = string | (LayerArgs & Record<string, unknown>);

export type UseArgs = string | { name: string; with?: Record<string, unknown> };

export type ChooseArgs =
  | Operations[]
  | (LayerArgs & { options: Operations[]; weights?: number[] });

export interface WhenArgs extends LayerArgs {
  min?: Vec3<number | null>;
  max?: Vec3<number | null>;
  do?: Operations;
  else?: Operations;
}

export interface OperationArgs {
  box: BoxArgs;
  split: SplitArgs;
  repeat: RepeatArgs;
  inset: InsetArgs;
  faces: FacesArgs;
  fill: MaterialSpec | FillArgs;
  clear: true | LayerArgs;
  frame: MaterialSpec | FillArgs;
  block: BlockArgs;
  door: MaterialSpec | DoorArgs;
  cylinder: MaterialSpec | RoundArgs;
  ellipsoid: MaterialSpec | RoundArgs;
  roof: RoofArgs;
  use: UseArgs;
  choose: ChooseArgs;
  when: WhenArgs;
}

export type OperationName = keyof OperationArgs;

/** One operation: exactly one operation key, plus any `#` comment keys. */
export type Operation = {
  [K in OperationName]: { [P in K]: OperationArgs[K] } & CommentKeys;
}[OperationName];

export const OPERATION_NAMES: readonly OperationName[] = [
  "box",
  "split",
  "repeat",
  "inset",
  "faces",
  "fill",
  "clear",
  "frame",
  "block",
  "door",
  "cylinder",
  "ellipsoid",
  "roof",
  "use",
  "choose",
  "when",
];

export interface Program {
  name?: string;
  /** `[width (x), height (y), depth (z)]`, each 1–`MAX_BUILD_SIZE`. */
  size: Vec3<number>;
  seed?: number;
  palette?: Record<string, MaterialSpec>;
  templates?: Record<string, Operations>;
  build: Operations;
}

export interface ProgramError {
  /** Program path, e.g. `build[2].box.do[0].split.parts[1]`; `""` for the program itself. */
  path: string;
  message: string;
}

export type ProgramValidation =
  | { ok: true; program: Program }
  | { ok: false; errors: ProgramError[] };

/** `path: message`, the form errors are reported in. */
export function formatProgramError(error: ProgramError): string {
  return error.path ? `${error.path}: ${error.message}` : error.message;
}

type Json = Record<string, unknown>;

const LAYER_KEYS = ["priority", "carve"];
const PLACEMENT_KEYS = [
  "replace",
  "only_empty",
  "facing",
  "axis",
  "half",
  "state",
];
const AXES = ["x", "y", "z"];
const REPEAT_ALIGNS = ["center", "start", "end", "stretch"];
const PROGRAM_KEYS = ["name", "size", "seed", "palette", "templates", "build"];

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function show(v: unknown): string {
  return JSON.stringify(v) ?? String(v);
}

/** `path.k`, or `path["k"]` for keys that aren't identifiers. */
export function pathKey(path: string, k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)
    ? `${path}.${k}`
    : `${path}[${JSON.stringify(k)}]`;
}

class Validator {
  readonly errors: ProgramError[] = [];
  /** Inside a template body, where `$` values and keys are parameters. */
  private inTemplate = false;

  constructor(private readonly templateNames: ReadonlySet<string>) {}

  error(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  private isParam(v: unknown): boolean {
    return this.inTemplate && typeof v === "string" && v.includes("$");
  }

  private isIgnoredKey(k: string): boolean {
    return k.startsWith("#") || (this.inTemplate && k.includes("$"));
  }

  /** Reports keys of `obj` outside `allowed` (plus `priority` and `carve` in argument objects). */
  private keys(
    obj: Json,
    path: string,
    allowed: readonly string[],
    layer = true,
  ): void {
    const expected = layer ? [...allowed, ...LAYER_KEYS] : allowed;
    for (const k of Object.keys(obj)) {
      if (this.isIgnoredKey(k) || expected.includes(k)) continue;
      this.error(
        pathKey(path, k),
        `unknown key '${k}' (expected ${expected.map((a) => `'${a}'`).join(", ")})`,
      );
    }
  }

  template(name: string, body: unknown): void {
    this.inTemplate = true;
    this.operations(body, pathKey("templates", name), 0);
    this.inTemplate = false;
  }

  operations(ops: unknown, path: string, depth: number): void {
    if (this.isParam(ops)) return;
    if (!Array.isArray(ops)) {
      this.error(path, `expected a list of operations, got ${show(ops)}`);
      return;
    }
    if (depth > MAX_VALIDATION_DEPTH) {
      this.error(
        path,
        `operations nested more than ${MAX_VALIDATION_DEPTH} deep`,
      );
      return;
    }
    ops.forEach((op, i) => this.operation(op, `${path}[${i}]`, depth));
  }

  private operation(op: unknown, path: string, depth: number): void {
    if (this.isParam(op)) return;
    if (!isObject(op)) {
      this.error(
        path,
        `each operation must be an object like {"fill": ...}, got ${show(op)}`,
      );
      return;
    }
    const keys = Object.keys(op).filter((k) => !k.startsWith("#"));
    if (keys.length !== 1) {
      this.error(
        path,
        keys.length === 0
          ? 'operation has no key; expected exactly one, like {"fill": ...}'
          : `operation must have exactly one key (besides '#' comments), got ${keys.map((k) => `'${k}'`).join(", ")}`,
      );
      return;
    }
    const name = keys[0];
    if (this.isIgnoredKey(name)) return;
    if (!(OPERATION_NAMES as readonly string[]).includes(name)) {
      this.error(
        path,
        `unknown operation '${name}' (known: ${OPERATION_NAMES.join(", ")})`,
      );
      return;
    }
    const arg = op[name];
    const argPath = `${path}.${name}`;
    if (this.isParam(arg)) return;
    if (isObject(arg)) this.layer(arg, argPath);
    this.args(name as OperationName, arg, argPath, depth + 1);
  }

  private layer(arg: Json, path: string): void {
    if ("priority" in arg && !this.isParam(arg.priority)) {
      if (!Number.isInteger(arg.priority)) {
        this.error(
          `${path}.priority`,
          `must be an integer, got ${show(arg.priority)}`,
        );
      }
    }
    if ("carve" in arg) this.boolean(arg.carve, `${path}.carve`);
  }

  private args(
    name: OperationName,
    arg: unknown,
    path: string,
    depth: number,
  ): void {
    switch (name) {
      case "box":
        return this.box(arg, path, depth);
      case "split":
        return this.split(arg, path, depth);
      case "repeat":
        return this.repeat(arg, path, depth);
      case "inset":
        return this.inset(arg, path, depth);
      case "faces":
        return this.faces(arg, path, depth);
      case "fill":
      case "frame":
        return this.fill(arg, path, []);
      case "cylinder":
      case "ellipsoid":
        return this.fill(arg, path, ["hollow", "thickness"]);
      case "clear":
        return this.clear(arg, path);
      case "block":
        return this.block(arg, path);
      case "door":
        return this.door(arg, path);
      case "roof":
        return this.roof(arg, path);
      case "use":
        return this.use(arg, path);
      case "choose":
        return this.choose(arg, path, depth);
      case "when":
        return this.when(arg, path, depth);
    }
  }

  // -- values -------------------------------------------------------------------

  private integer(v: unknown, path: string, min?: number): void {
    if (this.isParam(v)) return;
    if (!Number.isInteger(v)) {
      this.error(path, `must be an integer, got ${show(v)}`);
    } else if (min !== undefined && (v as number) < min) {
      this.error(path, `must be at least ${min}, got ${show(v)}`);
    }
  }

  private boolean(v: unknown, path: string): void {
    if (this.isParam(v)) return;
    if (typeof v !== "boolean") {
      this.error(path, `must be true or false, got ${show(v)}`);
    }
  }

  private oneOf(v: unknown, path: string, allowed: readonly string[]): void {
    if (this.isParam(v)) return;
    if (typeof v !== "string" || !allowed.includes(v)) {
      this.error(
        path,
        `must be one of ${allowed.map((a) => `"${a}"`).join(", ")}, got ${show(v)}`,
      );
    }
  }

  private length(v: unknown, path: string, context: LengthContext): void {
    if (this.isParam(v)) return;
    const parsed = parseLength(v, context);
    if (!parsed.ok) this.error(path, parsed.error);
  }

  private vec3(
    v: unknown,
    path: string,
    item: (value: unknown, path: string) => void,
  ): void {
    if (this.isParam(v)) return;
    if (!Array.isArray(v) || v.length !== 3) {
      this.error(path, `must be a list of 3 values [x, y, z], got ${show(v)}`);
      return;
    }
    v.forEach((value, i) => item(value, `${path}[${i}]`));
  }

  material(v: unknown, path: string): void {
    if (this.isParam(v)) return;
    if (typeof v === "string") {
      if (v.trim() === "") this.error(path, "material must not be empty");
      return;
    }
    if (!isObject(v) || !("mix" in v)) {
      this.error(
        path,
        `material must be a string or {"mix": {...}}, got ${show(v)}`,
      );
      return;
    }
    this.keys(v, path, ["mix"], false);
    const mix = v.mix;
    const mixPath = `${path}.mix`;
    if (this.isParam(mix)) return;
    if (!isObject(mix)) {
      this.error(
        mixPath,
        `must be an object of material → weight, got ${show(mix)}`,
      );
      return;
    }
    const entries = Object.entries(mix).filter(([k]) => !this.isIgnoredKey(k));
    if (Object.keys(mix).every((k) => k.startsWith("#"))) {
      this.error(mixPath, "mix must not be empty");
    }
    for (const [name, weight] of entries) {
      if (name.trim() === "")
        this.error(mixPath, "mix material must not be empty");
      if (this.isParam(weight)) continue;
      if (
        typeof weight !== "number" ||
        !(weight > 0) ||
        !Number.isFinite(weight)
      ) {
        this.error(
          pathKey(mixPath, name),
          `weight must be a positive number, got ${show(weight)}`,
        );
      }
    }
  }

  private replace(v: unknown, path: string): void {
    if (this.isParam(v)) return;
    if (Array.isArray(v)) {
      if (v.length === 0) this.error(path, "must not be an empty list");
      v.forEach((m, i) => this.material(m, `${path}[${i}]`));
      return;
    }
    this.material(v, path);
  }

  private placement(arg: Json, path: string): void {
    if ("replace" in arg) this.replace(arg.replace, `${path}.replace`);
    if ("only_empty" in arg) this.boolean(arg.only_empty, `${path}.only_empty`);
    if ("facing" in arg) this.oneOf(arg.facing, `${path}.facing`, FACING_NAMES);
    if ("axis" in arg) this.oneOf(arg.axis, `${path}.axis`, AXES);
    if (
      "half" in arg &&
      !this.isParam(arg.half) &&
      typeof arg.half !== "string"
    ) {
      this.error(`${path}.half`, `must be a string, got ${show(arg.half)}`);
    }
    if ("state" in arg) this.state(arg.state, `${path}.state`);
  }

  private state(v: unknown, path: string): void {
    if (this.isParam(v)) return;
    if (!isObject(v)) {
      this.error(path, `must be an object of state → value, got ${show(v)}`);
      return;
    }
    for (const [k, value] of Object.entries(v)) {
      if (this.isIgnoredKey(k) || this.isParam(value)) continue;
      if (!["string", "number", "boolean"].includes(typeof value)) {
        this.error(
          pathKey(path, k),
          `state value must be a string, number or boolean, got ${show(value)}`,
        );
      }
    }
  }

  // -- scope operations ---------------------------------------------------------

  private object(arg: unknown, path: string, expected: string): arg is Json {
    if (isObject(arg)) return true;
    this.error(path, `expected ${expected}, got ${show(arg)}`);
    return false;
  }

  private box(arg: unknown, path: string, depth: number): void {
    if (
      !this.object(arg, path, "an object with 'at', 'size', 'rotate' and 'do'")
    )
      return;
    this.keys(arg, path, ["at", "size", "rotate", "do"]);
    if ("at" in arg) {
      this.vec3(arg.at, `${path}.at`, (v, p) => this.length(v, p, "position"));
    }
    if ("size" in arg) {
      this.vec3(arg.size, `${path}.size`, (v, p) => this.length(v, p, "size"));
    }
    if ("rotate" in arg) this.integer(arg.rotate, `${path}.rotate`);
    if ("do" in arg) this.operations(arg.do, `${path}.do`, depth);
  }

  private split(arg: unknown, path: string, depth: number): void {
    if (!this.object(arg, path, "an object with 'axis' and 'parts'")) return;
    this.keys(arg, path, ["axis", "parts"]);
    if (!("axis" in arg)) this.error(path, "needs 'axis'");
    else this.oneOf(arg.axis, `${path}.axis`, AXES);
    if (!("parts" in arg)) {
      this.error(path, "needs 'parts'");
      return;
    }
    const parts = arg.parts;
    if (this.isParam(parts)) return;
    if (!Array.isArray(parts) || parts.length === 0) {
      this.error(
        `${path}.parts`,
        `must be a non-empty list, got ${show(parts)}`,
      );
      return;
    }
    parts.forEach((part, i) => {
      const partPath = `${path}.parts[${i}]`;
      if (this.isParam(part)) return;
      if (!this.object(part, partPath, "an object with 'size' and 'do'"))
        return;
      this.keys(part, partPath, ["size", "do"]);
      if (!("size" in part)) this.error(partPath, "each part needs a 'size'");
      else this.length(part.size, `${partPath}.size`, "part");
      if ("do" in part) this.operations(part.do, `${partPath}.do`, depth);
    });
  }

  private repeat(arg: unknown, path: string, depth: number): void {
    if (!this.object(arg, path, "an object with 'axis' and 'every' or 'count'"))
      return;
    this.keys(arg, path, [
      "axis",
      "every",
      "gap",
      "count",
      "margin",
      "align",
      "do",
      "pattern",
      "first",
      "last",
      "ends",
    ]);
    if (!("axis" in arg)) this.error(path, "needs 'axis'");
    else this.oneOf(arg.axis, `${path}.axis`, AXES);
    if (!("every" in arg) && !("count" in arg)) {
      this.error(path, "needs 'every' or 'count'");
    }
    if ("every" in arg) this.integer(arg.every, `${path}.every`, 1);
    if ("count" in arg) this.integer(arg.count, `${path}.count`, 0);
    if ("gap" in arg) this.integer(arg.gap, `${path}.gap`, 0);
    if ("margin" in arg) this.integer(arg.margin, `${path}.margin`, 0);
    if ("align" in arg) this.oneOf(arg.align, `${path}.align`, REPEAT_ALIGNS);
    for (const k of ["do", "first", "last", "ends"]) {
      if (k in arg) this.operations(arg[k], `${path}.${k}`, depth);
    }
    if ("pattern" in arg) {
      const pattern = arg.pattern;
      if (this.isParam(pattern)) return;
      if (!Array.isArray(pattern) || pattern.length === 0) {
        this.error(
          `${path}.pattern`,
          `must be a non-empty list of operation lists, got ${show(pattern)}`,
        );
        return;
      }
      pattern.forEach((ops, i) =>
        this.operations(ops, `${path}.pattern[${i}]`, depth),
      );
    }
  }

  private inset(arg: unknown, path: string, depth: number): void {
    if (!this.object(arg, path, "an object with 'by' and 'do'")) return;
    this.keys(arg, path, ["by", "do"]);
    if (!("by" in arg)) {
      this.error(path, "needs 'by'");
    } else if (isObject(arg.by)) {
      const by = arg.by;
      for (const [side, amount] of Object.entries(by)) {
        if (this.isIgnoredKey(side)) continue;
        if (!(INSET_SIDES as readonly string[]).includes(side)) {
          this.error(
            `${path}.by`,
            `unknown side '${side}' (expected ${INSET_SIDES.join(", ")})`,
          );
        } else {
          this.integer(amount, `${path}.by.${side}`);
        }
      }
    } else if (!this.isParam(arg.by) && !Number.isInteger(arg.by)) {
      this.error(
        `${path}.by`,
        `must be an integer or an object of sides, got ${show(arg.by)}`,
      );
    }
    if ("do" in arg) this.operations(arg.do, `${path}.do`, depth);
  }

  private faces(arg: unknown, path: string, depth: number): void {
    if (!this.object(arg, path, "an object of face → operations")) return;
    for (const k of Object.keys(arg)) {
      if (this.isIgnoredKey(k) || LAYER_KEYS.includes(k)) continue;
      if (k === "thickness") {
        this.integer(arg.thickness, `${path}.thickness`, 1);
      } else if ((FACE_NAMES as readonly string[]).includes(k)) {
        this.operations(arg[k], `${path}.${k}`, depth);
      } else {
        this.error(
          pathKey(path, k),
          `unknown face '${k}' (expected ${FACE_NAMES.join(", ")} or thickness)`,
        );
      }
    }
  }

  // -- material operations ------------------------------------------------------

  private fill(arg: unknown, path: string, extraKeys: string[]): void {
    if (typeof arg === "string" || (isObject(arg) && "mix" in arg)) {
      this.material(arg, path);
      return;
    }
    if (!this.object(arg, path, "a material or an object with 'material'"))
      return;
    this.keys(arg, path, ["material", ...PLACEMENT_KEYS, ...extraKeys]);
    if (!("material" in arg)) this.error(path, "missing 'material'");
    else this.material(arg.material, `${path}.material`);
    this.placement(arg, path);
    if ("hollow" in arg) this.boolean(arg.hollow, `${path}.hollow`);
    if ("thickness" in arg) this.integer(arg.thickness, `${path}.thickness`, 1);
  }

  private clear(arg: unknown, path: string): void {
    if (arg === true) return;
    if (!this.object(arg, path, "true or an object with 'priority'/'carve'"))
      return;
    this.keys(arg, path, []);
  }

  private block(arg: unknown, path: string): void {
    if (
      !this.object(
        arg,
        path,
        'an object like {"material": ..., "at": [x, y, z]}',
      )
    )
      return;
    this.keys(arg, path, [
      "material",
      "at",
      "only_empty",
      "facing",
      "axis",
      "half",
      "state",
    ]);
    if (!("material" in arg)) this.error(path, "missing 'material'");
    else this.material(arg.material, `${path}.material`);
    if ("at" in arg) {
      this.vec3(arg.at, `${path}.at`, (v, p) => this.length(v, p, "position"));
    }
    this.placement(arg, path);
  }

  private door(arg: unknown, path: string): void {
    if (typeof arg === "string" || (isObject(arg) && "mix" in arg)) {
      this.material(arg, path);
      return;
    }
    if (!this.object(arg, path, "a material or an object with 'material'"))
      return;
    this.keys(arg, path, ["material", "x", "facing", "hinge"]);
    if ("material" in arg) this.material(arg.material, `${path}.material`);
    if ("x" in arg) this.integer(arg.x, `${path}.x`, 0);
    if ("facing" in arg) this.oneOf(arg.facing, `${path}.facing`, FACING_NAMES);
    if ("hinge" in arg)
      this.oneOf(arg.hinge, `${path}.hinge`, ["left", "right"]);
  }

  private roof(arg: unknown, path: string): void {
    if (typeof arg === "string") return;
    this.object(arg, path, "a roof type or an object");
  }

  // -- composition --------------------------------------------------------------

  private use(arg: unknown, path: string): void {
    let name: unknown = arg;
    if (isObject(arg)) {
      this.keys(arg, path, ["name", "with"]);
      if (!("name" in arg)) {
        this.error(path, "missing 'name'");
        return;
      }
      name = arg.name;
      if ("with" in arg && !this.isParam(arg.with) && !isObject(arg.with)) {
        this.error(
          `${path}.with`,
          `must be an object of parameter → value, got ${show(arg.with)}`,
        );
      }
    }
    if (this.isParam(name)) return;
    if (typeof name !== "string") {
      this.error(
        path,
        `expected a template name or {"name": ..., "with": {...}}, got ${show(arg)}`,
      );
      return;
    }
    if (!this.templateNames.has(name)) {
      const defined = [...this.templateNames].sort();
      this.error(
        path,
        `unknown template '${name}' (defined: ${defined.length ? defined.join(", ") : "none"})`,
      );
    }
  }

  private choose(arg: unknown, path: string, depth: number): void {
    let options: unknown = arg;
    let optionsPath = path;
    if (isObject(arg)) {
      this.keys(arg, path, ["options", "weights"]);
      options = arg.options;
      optionsPath = `${path}.options`;
    }
    if (this.isParam(options)) return;
    if (!Array.isArray(options) || options.length === 0) {
      this.error(
        optionsPath,
        `needs a non-empty list of options, got ${show(options)}`,
      );
      return;
    }
    options.forEach((ops, i) =>
      this.operations(ops, `${optionsPath}[${i}]`, depth),
    );
    if (!isObject(arg) || !("weights" in arg) || this.isParam(arg.weights))
      return;
    const weights = arg.weights;
    if (!Array.isArray(weights) || weights.length !== options.length) {
      this.error(
        `${path}.weights`,
        `must be a list of ${options.length} numbers, one per option, got ${show(weights)}`,
      );
      return;
    }
    weights.forEach((w, i) => {
      if (this.isParam(w)) return;
      if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
        this.error(
          `${path}.weights[${i}]`,
          `must be a non-negative number, got ${show(w)}`,
        );
      }
    });
    if (
      weights.every((w) => typeof w === "number") &&
      !weights.some((w) => w > 0)
    ) {
      this.error(`${path}.weights`, "at least one weight must be positive");
    }
  }

  private when(arg: unknown, path: string, depth: number): void {
    if (!this.object(arg, path, "an object with 'min'/'max', 'do' and 'else'"))
      return;
    this.keys(arg, path, ["min", "max", "do", "else"]);
    for (const k of ["min", "max"]) {
      if (!(k in arg)) continue;
      this.vec3(arg[k], `${path}.${k}`, (v, p) => {
        if (v !== null) this.integer(v, p, 0);
      });
    }
    if ("do" in arg) this.operations(arg.do, `${path}.do`, depth);
    if ("else" in arg) this.operations(arg.else, `${path}.else`, depth);
  }

  // -- program ------------------------------------------------------------------

  program(json: Json): void {
    for (const k of Object.keys(json)) {
      if (k.startsWith("#") || PROGRAM_KEYS.includes(k)) continue;
      this.error(
        pathKey("", k).replace(/^\./, ""),
        `unknown program key '${k}' (expected ${PROGRAM_KEYS.join(", ")})`,
      );
    }
    if ("name" in json && typeof json.name !== "string") {
      this.error("name", `must be a string, got ${show(json.name)}`);
    }
    this.size(json.size);
    if ("seed" in json) this.integer(json.seed, "seed");
    if ("palette" in json) this.palette(json.palette);
    if ("templates" in json) {
      if (!isObject(json.templates)) {
        this.error(
          "templates",
          `must be an object of template name → operations, got ${show(json.templates)}`,
        );
      } else {
        for (const [name, body] of Object.entries(json.templates)) {
          if (!name.startsWith("#")) this.template(name, body);
        }
      }
    }
    if (!("build" in json))
      this.error("build", "missing; expected a list of operations");
    else this.operations(json.build, "build", 0);
  }

  private size(size: unknown): void {
    if (
      !Array.isArray(size) ||
      size.length !== 3 ||
      !size.every((v) => Number.isInteger(v) && v > 0)
    ) {
      this.error(
        "size",
        `must be [width, height, depth] as positive integers, got ${show(size)}`,
      );
      return;
    }
    const axes = ["width (x)", "height (y)", "depth (z)"];
    size.forEach((v: number, i) => {
      if (v > MAX_BUILD_SIZE) {
        this.error(
          `size[${i}]`,
          `${axes[i]} ${v} is over the limit of ${MAX_BUILD_SIZE} blocks per axis`,
        );
      }
    });
  }

  private palette(palette: unknown): void {
    if (!isObject(palette)) {
      this.error(
        "palette",
        `must be an object of role → material, got ${show(palette)}`,
      );
      return;
    }
    for (const [role, material] of Object.entries(palette)) {
      if (!role.startsWith("#"))
        this.material(material, pathKey("palette", role));
    }
  }
}

/**
 * Checks the structure of a parsed JSON program. Returns the program typed
 * as `Program` when it is well-formed, or every error found, each at its
 * program path.
 */
export function validateProgram(json: unknown): ProgramValidation {
  if (!isObject(json)) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          message: `program must be a JSON object, got ${show(json)}`,
        },
      ],
    };
  }
  const templateNames = isObject(json.templates)
    ? Object.keys(json.templates).filter((k) => !k.startsWith("#"))
    : [];
  const validator = new Validator(new Set(templateNames));
  validator.program(json);
  return validator.errors.length > 0
    ? { ok: false, errors: validator.errors }
    : { ok: true, program: json as unknown as Program };
}

/**
 * Checks an operation list on its own, outside any template body (so `$`
 * values are not parameters). The compiler runs it on a template body after
 * substituting its parameters, reporting at the body's own paths.
 */
export function validateOperations(
  ops: unknown,
  path: string,
  templateNames: Iterable<string>,
): ProgramError[] {
  const validator = new Validator(new Set(templateNames));
  validator.operations(ops, path, 0);
  return validator.errors;
}
