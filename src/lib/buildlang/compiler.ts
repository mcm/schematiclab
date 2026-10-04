// The build language compiler (port of Cairn's `cairn/compiler.py`): walks a
// validated program through oriented scopes and logs every placement in a
// `WriteLog`, reporting errors at their program paths and carrying on.
// Worker-safe.
//
// Scope operations (Cairn `SPEC.md` section 3): `box`, `split`, `repeat`,
// `inset` and `faces`. Material operations write through `place`.
// Composition: `use` (templates), `choose` and `when`.
//
// Paths are real program paths: an operation inside a repeat's `do` reports
// at `….repeat.do[0]` for every tile, and one inside `faces.sides` at
// `….faces.sides[0]` for every wall, so repeated problems collapse into one
// message (with a count) and always point at something the agent wrote.
// Operations in a template body report at `templates.<name>[i]…`, with the
// outermost `use` that reached them added to the message.

import type { BlockRegistry } from "../blockdata/registry";
import {
  buildShapeGrid,
  MAX_DIMENSION,
  MAX_THICKNESS,
  type VoxelGrid,
  voxelIndex,
} from "../shapes/shapes";
import { BuildError } from "./errors";
import {
  type Length,
  parseLength,
  type LengthContext,
  resolvePosition,
  resolveSize,
  splitSizes,
} from "./lengths";
import {
  AIR,
  hash01,
  type Material,
  type MaterialEntry,
  MaterialResolver,
  pickEntry,
  validatePlacedState,
} from "./materials";
import {
  type Axis,
  type BlockArgs,
  type BoxArgs,
  type DoorArgs,
  type FillArgs,
  type InsetArgs,
  type MaterialSpec,
  pathKey,
  type Program,
  type ProgramError,
  type RepeatArgs,
  type SplitArgs,
  validateOperations,
} from "./program";
import { postprocess } from "./postprocess";
import { orientStates, Scope, type ScopeFaceName, type Vec } from "./scope";
import { MAX_TEMPLATE_DEPTH, substituteParams } from "./templates";
import {
  type BlockGrid,
  LayerStack,
  type Pos,
  type ReplaceSet,
  resolveReplace,
  WriteLog,
} from "./writes";

/** Deepest nesting of operations the compiler follows (template recursion). */
export const MAX_COMPILE_DEPTH = 64;

/** Most block placements one program may make. */
export const MAX_PLACEMENTS = 2_000_000;

export interface CompileResult {
  size: Pos;
  /** Every placement, as written. */
  log: WriteLog;
  /** The final blocks: the log composed, with neighbour-dependent states set. */
  blocks: BlockGrid;
  errors: ProgramError[];
  warnings: ProgramError[];
  /** Fallbacks and repairs (a variant the material lacks, a misspelt block). */
  notes: ProgramError[];
}

export interface CompileOptions {
  /** Most placements before the compile stops (default `MAX_PLACEMENTS`). */
  maxPlacements?: number;
}

/** Stops the whole compile (too many placements), not just one operation. */
class FatalBuildError extends BuildError {}

const AXIS_INDEX: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };

const SIDE_FACES: readonly ScopeFaceName[] = ["front", "right", "back", "left"];
const NAMED_FACES: readonly ScopeFaceName[] = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
];

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function show(v: unknown): string {
  return JSON.stringify(v) ?? String(v);
}

function length(spec: unknown, context: LengthContext, path: string): Length {
  const parsed = parseLength(spec, context);
  if (!parsed.ok) throw new BuildError(path, parsed.error);
  return parsed.length;
}

function integer(v: unknown, path: string, fallback: number, min = -Infinity) {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || (v as number) < min) {
    throw new BuildError(
      path,
      min === -Infinity
        ? `must be an integer, got ${show(v)}`
        : `must be an integer of at least ${min}, got ${show(v)}`,
    );
  }
  return v as number;
}

function axisOf(arg: Json, path: string): 0 | 1 | 2 {
  const axis = arg.axis;
  if (typeof axis !== "string" || !Object.hasOwn(AXIS_INDEX, axis)) {
    throw new BuildError(
      `${path}.axis`,
      `must be "x", "y" or "z", got ${show(axis)}`,
    );
  }
  return AXIS_INDEX[axis as Axis];
}

function withAxis(v: Vec, axis: number, value: number): Vec {
  const out: [number, number, number] = [v[0], v[1], v[2]];
  out[axis] = value;
  return out;
}

/**
 * The same message reported many times (once per tile or wall) collapses into
 * one, with its count.
 */
function dedupe(errors: readonly ProgramError[]): ProgramError[] {
  const counts = new Map<string, { error: ProgramError; count: number }>();
  for (const error of errors) {
    const key = JSON.stringify([error.path, error.message]);
    const seen = counts.get(key);
    if (seen) seen.count++;
    else counts.set(key, { error, count: 1 });
  }
  return [...counts.values()].map(({ error, count }) =>
    count === 1 ? error : { ...error, message: `${error.message} (x${count})` },
  );
}

export class Compiler {
  readonly log: WriteLog;
  readonly layers = new LayerStack();
  readonly resolver: MaterialResolver;
  readonly errors: ProgramError[] = [];
  readonly warnings: ProgramError[] = [];
  /** States a block doesn't have, ignored (fallbacks are the resolver's). */
  readonly notes: ProgramError[] = [];
  private readonly notedStates = new Set<string>();
  private readonly seed: number;
  private readonly maxPlacements: number;
  private placements = 0;
  private readonly checkedStates = new Set<string>();
  /** Paths of the `use` operations being expanded, outermost first. */
  private readonly callers: string[] = [];
  /** Substituted and checked template bodies, by name and parameters. */
  private readonly expansions = new Map<
    string,
    { body: unknown; errors: ProgramError[]; unused: string[] }
  >();

  constructor(
    readonly program: Program,
    readonly registry: BlockRegistry,
    options: CompileOptions = {},
  ) {
    this.maxPlacements = options.maxPlacements ?? MAX_PLACEMENTS;
    this.log = new WriteLog(program.size);
    this.resolver = new MaterialResolver(registry, program.palette ?? {});
    this.seed = program.seed ?? 0;
  }

  run(): CompileResult {
    try {
      this.execOps(
        this.program.build,
        Scope.root(this.program.size),
        "build",
        0,
      );
    } catch (e) {
      if (!(e instanceof FatalBuildError)) throw e;
      this.errors.push(e.toProgramError());
    }
    const warnings = [...this.warnings, ...this.log.collisions(this.registry)];
    if (this.log.outOfBounds > 0) {
      warnings.push({
        path: "",
        message:
          `${this.log.outOfBounds} block(s) fell outside the build size ` +
          `${show(this.program.size)} and were dropped (inset the structure ` +
          `or enlarge 'size')`,
      });
    }
    const blocks = this.log.composeGrid();
    postprocess(blocks, this.registry);
    return {
      size: this.program.size,
      log: this.log,
      blocks,
      errors: dedupe(this.errors),
      warnings: dedupe(warnings),
      notes: [...this.resolver.notes, ...this.notes],
    };
  }

  // -- reporting ------------------------------------------------------------------

  /** Inside a template, names the outermost `use` that reached the problem. */
  private located(problem: ProgramError): ProgramError {
    if (this.callers.length === 0) return problem;
    return {
      ...problem,
      message: `${problem.message} (in a template used at ${this.callers[0]})`,
    };
  }

  private error(problem: ProgramError): void {
    this.errors.push(this.located(problem));
  }

  private warn(problem: ProgramError): void {
    this.warnings.push(this.located(problem));
  }

  // -- walking --------------------------------------------------------------------

  execOps(ops: unknown, scope: Scope, path: string, depth: number): void {
    if (depth > MAX_COMPILE_DEPTH) {
      throw new BuildError(
        path,
        `operations nested more than ${MAX_COMPILE_DEPTH} deep (template recursion?)`,
      );
    }
    if (!Array.isArray(ops)) {
      this.error({
        path,
        message: `expected a list of operations, got ${show(ops)}`,
      });
      return;
    }
    ops.forEach((op, i) => {
      const opPath = `${path}[${i}]`;
      try {
        this.execOp(op, scope, opPath, depth);
      } catch (e) {
        if (!(e instanceof BuildError) || e instanceof FatalBuildError) throw e;
        this.error(e.toProgramError());
      }
    });
  }

  private execOp(op: unknown, scope: Scope, path: string, depth: number) {
    if (!isObject(op)) {
      throw new BuildError(
        path,
        `each operation must be an object like {"fill": ...}, got ${show(op)}`,
      );
    }
    // zero-size scopes are legal and simply do nothing
    if (Math.min(...scope.size) <= 0) return;
    const keys = Object.keys(op).filter((k) => !k.startsWith("#"));
    if (keys.length !== 1) {
      throw new BuildError(
        path,
        `operation must have exactly one key, got ${keys.map((k) => `'${k}'`).join(", ") || "none"}`,
      );
    }
    const name = keys[0];
    const arg = op[name];
    const argPath = `${path}.${name}`;
    this.layers.within(arg, () =>
      this.dispatch(name, arg, scope, argPath, depth),
    );
  }

  private dispatch(
    name: string,
    arg: unknown,
    scope: Scope,
    path: string,
    depth: number,
  ): void {
    switch (name) {
      case "box":
        return this.box(arg, scope, path, depth);
      case "split":
        return this.split(arg, scope, path, depth);
      case "repeat":
        return this.repeat(arg, scope, path, depth);
      case "inset":
        return this.inset(arg, scope, path, depth);
      case "faces":
        return this.faces(arg, scope, path, depth);
      case "fill":
        return this.fill(arg, scope, path);
      case "clear":
        return this.fill("air", scope, path);
      case "frame":
        return this.frame(arg, scope, path);
      case "block":
        return this.block(arg, scope, path);
      case "door":
        return this.door(arg, scope, path);
      case "cylinder":
        return this.round(arg, scope, path, "cylinder");
      case "ellipsoid":
        return this.round(arg, scope, path, "ellipsoid");
      case "roof":
        throw new BuildError(path, "roof is not supported yet");
      case "use":
        return this.use(arg, scope, path, depth);
      case "choose":
        return this.choose(arg, scope, path, depth);
      case "when":
        return this.when(arg, scope, path, depth);
      default:
        throw new BuildError(path, `unknown operation '${name}'`);
    }
  }

  // -- scope operations -------------------------------------------------------------

  private expectObject(arg: unknown, path: string, what: string): Json {
    if (!isObject(arg)) {
      throw new BuildError(path, `expected ${what}, got ${show(arg)}`);
    }
    return arg;
  }

  /** `box`: a child scope at `at`, `size` in its own axes, turned by `rotate`. */
  private box(raw: unknown, scope: Scope, path: string, depth: number) {
    const arg = this.expectObject(
      raw,
      path,
      "an object with 'at', 'size', 'rotate' and 'do'",
    ) as BoxArgs;
    const rotate = integer(arg.rotate, `${path}.rotate`, 0);
    const turn = ((rotate % 4) + 4) % 4;
    const at = arg.at ?? [0, 0, 0];
    const size = arg.size ?? ["~", "~", "~"];
    for (const [key, v] of [
      ["at", at],
      ["size", size],
    ] as const) {
      if (!Array.isArray(v) || v.length !== 3) {
        throw new BuildError(
          `${path}.${key}`,
          `must be a list of 3 values [x, y, z], got ${show(v)}`,
        );
      }
    }
    // size is in the child's axes; its footprint swaps x and z under odd turns
    const footprintSize = turn % 2 === 0 ? size : [size[2], size[1], size[0]];
    const sizeIndex = turn % 2 === 0 ? [0, 1, 2] : [2, 1, 0];
    const pos: number[] = [];
    const extent: number[] = [];
    for (let i = 0; i < 3; i++) {
      const total = scope.size[i];
      const atLen = length(at[i], "position", `${path}.at[${i}]`);
      const sizeLen = length(
        footprintSize[i],
        "size",
        `${path}.size[${sizeIndex[i]}]`,
      );
      // an aligned child needs its size first; otherwise "~" is the rest after `at`
      if (atLen.kind === "align") {
        extent[i] = resolveSize(sizeLen, total, total);
        pos[i] = resolvePosition(atLen, total, extent[i]);
      } else {
        pos[i] = resolvePosition(atLen, total, 0);
        extent[i] = resolveSize(sizeLen, total, total - pos[i]);
      }
    }
    const childSize: Vec =
      turn % 2 === 0
        ? [extent[0], extent[1], extent[2]]
        : [extent[2], extent[1], extent[0]];
    if (Math.min(...childSize) <= 0) return;
    const child = scope.sub([pos[0], pos[1], pos[2]], childSize, turn);
    this.execOps(arg.do ?? [], child, `${path}.do`, depth + 1);
  }

  /** `split`: consecutive parts along one axis (CGA split). */
  private split(raw: unknown, scope: Scope, path: string, depth: number) {
    const arg = this.expectObject(
      raw,
      path,
      "an object with 'axis' and 'parts'",
    ) as unknown as SplitArgs & Json;
    const axis = axisOf(arg, path);
    const parts: unknown = arg.parts;
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new BuildError(
        `${path}.parts`,
        `must be a non-empty list, got ${show(parts)}`,
      );
    }
    const lengths = parts.map((part, i) => {
      const partPath = `${path}.parts[${i}]`;
      if (!isObject(part) || !("size" in part)) {
        throw new BuildError(partPath, "each part needs a 'size'");
      }
      return length(part.size, "part", `${partPath}.size`);
    });
    const total = scope.size[axis];
    const { sizes, overflow } = splitSizes(lengths, total);
    if (overflow > 0) {
      this.warn({
        path,
        message:
          `fixed part sizes (${total + overflow}) exceed the available ` +
          `${total}; trailing parts were cut`,
      });
    }
    let offset = 0;
    parts.forEach((part: Json, i) => {
      const size = sizes[i];
      if (size > 0 && part.do !== undefined) {
        const child = scope.sub(
          withAxis([0, 0, 0], axis, offset),
          withAxis(scope.size, axis, size),
        );
        this.execOps(part.do, child, `${path}.parts[${i}].do`, depth + 1);
      }
      offset += size;
    });
  }

  /**
   * `repeat`: tiles along one axis. The tile count is
   * ⌊(L − 2·margin + gap) / (every + gap)⌋ unless `count` forces it, and the
   * leftover is split between the ends (`align`), with a warning when centred
   * tiles can't be exactly symmetric.
   */
  private repeat(raw: unknown, scope: Scope, path: string, depth: number) {
    const arg = this.expectObject(
      raw,
      path,
      "an object with 'axis' and 'every' or 'count'",
    ) as unknown as RepeatArgs & Json;
    const axis = axisOf(arg, path);
    const total = scope.size[axis];
    const gap = integer(arg.gap, `${path}.gap`, 0, 0);
    const margin = integer(arg.margin, `${path}.margin`, 0, 0);
    const align = arg.align ?? "center";
    if (!["center", "start", "end", "stretch"].includes(align)) {
      throw new BuildError(
        `${path}.align`,
        `must be one of "center", "start", "end", "stretch", got ${show(align)}`,
      );
    }
    const available = total - 2 * margin;
    let count: number;
    let every: number;
    if (arg.count !== undefined) {
      count = integer(arg.count, `${path}.count`, 0, 0);
      every = integer(
        arg.every,
        `${path}.every`,
        Math.max(
          1,
          Math.floor((available - gap * (count - 1)) / Math.max(count, 1)),
        ),
        1,
      );
    } else if (arg.every !== undefined) {
      every = integer(arg.every, `${path}.every`, 1, 1);
      count = Math.max(0, Math.floor((available + gap) / (every + gap)));
    } else {
      throw new BuildError(path, "needs 'every' or 'count'");
    }
    if (count <= 0) return;

    let sizes: number[];
    let start: number;
    if (align === "stretch") {
      sizes = splitSizes(
        Array.from({ length: count }, () => ({ kind: "rest", weight: 1 })),
        available - gap * (count - 1),
      ).sizes;
      start = margin;
    } else {
      sizes = Array.from({ length: count }, () => every);
      const slack = total - (every * count + gap * (count - 1));
      start =
        align === "start"
          ? margin
          : align === "end"
            ? slack - margin
            : Math.floor(slack / 2);
      if (
        align === "center" &&
        Math.abs(slack) % 2 === 1 &&
        count > 1 &&
        gap > 0
      ) {
        this.warn({
          path,
          message:
            `tiles cannot be exactly centred (odd leftover space ${slack}); ` +
            `change 'every' or 'gap' by 1 for perfect symmetry`,
        });
      }
    }

    const pattern = Array.isArray(arg.pattern) ? arg.pattern : null;
    let offset = start;
    sizes.forEach((size, i) => {
      let ops: unknown;
      let opsPath: string;
      if (i === 0 && arg.first !== undefined) {
        [ops, opsPath] = [arg.first, `${path}.first`];
      } else if (i === count - 1 && arg.last !== undefined) {
        [ops, opsPath] = [arg.last, `${path}.last`];
      } else if ((i === 0 || i === count - 1) && arg.ends !== undefined) {
        [ops, opsPath] = [arg.ends, `${path}.ends`];
      } else if (pattern && pattern.length > 0) {
        const k = i % pattern.length;
        [ops, opsPath] = [pattern[k], `${path}.pattern[${k}]`];
      } else {
        [ops, opsPath] = [arg.do ?? [], `${path}.do`];
      }
      if (size > 0) {
        const child = scope.sub(
          withAxis([0, 0, 0], axis, offset),
          withAxis(scope.size, axis, size),
        );
        this.execOps(ops, child, opsPath, depth + 1);
      }
      offset += size + gap;
    });
  }

  /** `inset`: shrink the scope, x and z on both sides or per side. */
  private inset(raw: unknown, scope: Scope, path: string, depth: number) {
    const arg = this.expectObject(
      raw,
      path,
      "an object with 'by' and 'do'",
    ) as unknown as InsetArgs & Json;
    const by: unknown = arg.by;
    const amount = { left: 0, right: 0, front: 0, back: 0, top: 0, bottom: 0 };
    if (Number.isInteger(by)) {
      const n = by as number;
      Object.assign(amount, { left: n, right: n, front: n, back: n });
    } else if (isObject(by)) {
      for (const [side, raw] of Object.entries(by)) {
        if (side.startsWith("#")) continue;
        const n = integer(raw, `${path}.by.${side}`, 0);
        if (side === "x") Object.assign(amount, { left: n, right: n });
        else if (side === "y") Object.assign(amount, { top: n, bottom: n });
        else if (side === "z") Object.assign(amount, { front: n, back: n });
        else if (Object.hasOwn(amount, side)) {
          amount[side as keyof typeof amount] = n;
        } else {
          throw new BuildError(`${path}.by`, `unknown side '${side}'`);
        }
      }
    } else {
      throw new BuildError(
        `${path}.by`,
        `must be an integer or an object of sides, got ${show(by)}`,
      );
    }
    const [sx, sy, sz] = scope.size;
    // a box's back is its -z side (local z = 0), its front +z
    const size: Vec = [
      sx - amount.left - amount.right,
      sy - amount.top - amount.bottom,
      sz - amount.front - amount.back,
    ];
    if (Math.min(...size) <= 0) {
      this.warn({
        path,
        message: `inset leaves nothing (scope ${show(scope.size)})`,
      });
      return;
    }
    const child = scope.sub([amount.left, amount.bottom, amount.back], size);
    this.execOps(arg.do ?? [], child, `${path}.do`, depth + 1);
  }

  /**
   * `faces` (CGA comp(f)): `sides` on all four walls, then the named faces
   * (overriding `sides`), then `top`/`bottom`, then `edges`, the four
   * vertical corner columns.
   */
  private faces(raw: unknown, scope: Scope, path: string, depth: number) {
    const arg = this.expectObject(raw, path, "an object of face → operations");
    const thickness = integer(arg.thickness, `${path}.thickness`, 1, 1);
    if (arg.sides !== undefined) {
      for (const face of SIDE_FACES) {
        this.execOps(
          arg.sides,
          scope.face(face, thickness),
          `${path}.sides`,
          depth + 1,
        );
      }
    }
    for (const face of NAMED_FACES) {
      if (arg[face] !== undefined) {
        this.execOps(
          arg[face],
          scope.face(face, thickness),
          `${path}.${face}`,
          depth + 1,
        );
      }
    }
    if (arg.edges !== undefined) {
      for (const edge of scope.edges()) {
        this.execOps(arg.edges, edge, `${path}.edges`, depth + 1);
      }
    }
  }

  // -- composition ------------------------------------------------------------------

  /**
   * `use`: runs a template in the current scope, by name or as
   * `{name, with}`. The body is substituted (`templates.ts`), checked like
   * the rest of the program, and run at its own `templates.<name>` path.
   */
  private use(raw: unknown, scope: Scope, path: string, depth: number) {
    let name: unknown = raw;
    let params: Json = {};
    if (isObject(raw)) {
      name = raw.name;
      if (raw.with !== undefined) {
        if (!isObject(raw.with)) {
          throw new BuildError(
            `${path}.with`,
            `must be an object of parameter → value, got ${show(raw.with)}`,
          );
        }
        params = raw.with;
      }
    }
    if (typeof name !== "string") {
      throw new BuildError(
        path,
        `expected a template name or {"name": ..., "with": {...}}, got ${show(raw)}`,
      );
    }
    const templates = this.program.templates ?? {};
    if (name.startsWith("#") || !Object.hasOwn(templates, name)) {
      const defined = this.templateNames();
      throw new BuildError(
        path,
        `unknown template '${name}' (defined: ${defined.length ? defined.join(", ") : "none"})`,
      );
    }
    if (this.callers.length >= MAX_TEMPLATE_DEPTH) {
      throw new BuildError(
        path,
        `templates nested more than ${MAX_TEMPLATE_DEPTH} deep (does '${name}' use itself?)`,
      );
    }
    const bodyPath = pathKey("templates", name);
    const expansion = this.expand(name, params, bodyPath);
    for (const unused of expansion.unused) {
      this.warn({
        path: pathKey(`${path}.with`, unused),
        message: `template '${name}' has no parameter '${unused}'`,
      });
    }
    this.callers.push(path);
    try {
      // a body that doesn't substitute cleanly doesn't run
      for (const problem of expansion.errors) this.error(problem);
      if (expansion.errors.length === 0) {
        this.execOps(expansion.body, scope, bodyPath, depth + 1);
      }
    } finally {
      this.callers.pop();
    }
  }

  private templateNames(): string[] {
    return Object.keys(this.program.templates ?? {})
      .filter((k) => !k.startsWith("#"))
      .sort();
  }

  private expand(name: string, params: Json, bodyPath: string) {
    const key = JSON.stringify([name, params]);
    let expansion = this.expansions.get(key);
    if (!expansion) {
      const body = (this.program.templates ?? {})[name];
      const substituted = substituteParams(body, params, bodyPath);
      const errors =
        substituted.errors.length > 0
          ? substituted.errors
          : validateOperations(
              substituted.body,
              bodyPath,
              this.templateNames(),
            );
      const unused = Object.keys(params).filter(
        (k) => !substituted.used.has(k),
      );
      expansion = { body: substituted.body, errors, unused };
      this.expansions.set(key, expansion);
    }
    return expansion;
  }

  /**
   * `choose`: a seeded, weighted pick between operation lists, given as a
   * list or `{options, weights}`. The pick hashes the seed, the scope's
   * origin and the path, so it is stable for a program and seed.
   */
  private choose(raw: unknown, scope: Scope, path: string, depth: number) {
    const options: unknown = isObject(raw) ? raw.options : raw;
    const optionsPath = isObject(raw) ? `${path}.options` : path;
    if (!Array.isArray(options) || options.length === 0) {
      throw new BuildError(
        optionsPath,
        `needs a non-empty list of options, got ${show(options)}`,
      );
    }
    const weights: unknown =
      isObject(raw) && raw.weights !== undefined
        ? raw.weights
        : options.map(() => 1);
    if (
      !Array.isArray(weights) ||
      weights.length !== options.length ||
      !weights.every(
        (w) => typeof w === "number" && Number.isFinite(w) && w >= 0,
      ) ||
      !weights.some((w) => w > 0)
    ) {
      throw new BuildError(
        `${path}.weights`,
        `must be a list of ${options.length} non-negative numbers, one per option, at least one positive, got ${show(weights)}`,
      );
    }
    const total = (weights as number[]).reduce((a, b) => a + b, 0);
    let r = hash01(this.seed, ...scope.origin, path) * total;
    let pick = 0;
    for (let i = 0; i < options.length; i++) {
      const w = weights[i] as number;
      if (w <= 0) continue;
      pick = i;
      if (r < w) break;
      r -= w;
    }
    this.execOps(options[pick], scope, `${optionsPath}[${pick}]`, depth + 1);
  }

  /**
   * `when`: runs `do` when the scope's size is at least `min` and at most
   * `max` on every axis that isn't `null`, else `else`.
   */
  private when(raw: unknown, scope: Scope, path: string, depth: number) {
    const arg = this.expectObject(
      raw,
      path,
      "an object with 'min'/'max', 'do' and 'else'",
    );
    const bound = (key: "min" | "max"): (number | null)[] => {
      const v = arg[key];
      if (v === undefined) return [null, null, null];
      if (
        !Array.isArray(v) ||
        v.length !== 3 ||
        !v.every((n) => n === null || Number.isInteger(n))
      ) {
        throw new BuildError(
          `${path}.${key}`,
          `must be [x, y, z] of integers or null, got ${show(v)}`,
        );
      }
      return v as (number | null)[];
    };
    const min = bound("min");
    const max = bound("max");
    const ok = scope.size.every(
      (n, i) =>
        (min[i] === null || n >= min[i]) && (max[i] === null || n <= max[i]),
    );
    const branch = ok ? "do" : "else";
    if (arg[branch] !== undefined) {
      this.execOps(arg[branch], scope, `${path}.${branch}`, depth + 1);
    }
  }

  // -- material operations ----------------------------------------------------------

  /**
   * The material and placement arguments of `fill`, `frame`, `cylinder` and
   * `ellipsoid`: a bare material, or an object with `material`, `replace`,
   * `only_empty`, `facing`, `axis`, `half` and `state`.
   */
  private placementArgs(
    raw: unknown,
    path: string,
  ): PlacementOptions & {
    material: Material;
  } {
    if (typeof raw === "string" || (isObject(raw) && "mix" in raw)) {
      return { material: this.resolver.resolve(raw as MaterialSpec, path) };
    }
    if (!isObject(raw)) {
      throw new BuildError(
        path,
        `expected a material or an object with 'material', got ${show(raw)}`,
      );
    }
    const arg = raw as unknown as FillArgs;
    if (arg.material === undefined) {
      throw new BuildError(path, "missing 'material'");
    }
    return {
      material: this.resolver.resolve(arg.material, path),
      extra: extraStates(arg),
      onlyEmpty: arg.only_empty === true,
      replace:
        arg.replace === undefined
          ? null
          : resolveReplace(this.resolver, arg.replace, `${path}.replace`),
    };
  }

  /** `fill` (and `clear`): every cell of the scope. */
  private fill(raw: unknown, scope: Scope, path: string) {
    const { material, ...options } = this.placementArgs(raw, path);
    for (const [x, y, z] of scope.cells()) {
      this.place(scope, [x, y, z], material, path, options);
    }
  }

  /** `frame`: the 12 edges of the scope, logs running along each edge. */
  private frame(raw: unknown, scope: Scope, path: string) {
    const { material, ...options } = this.placementArgs(raw, path);
    const [sx, sy, sz] = scope.size;
    for (const [x, y, z] of scope.cells()) {
      const ex = x === 0 || x === sx - 1;
      const ey = y === 0 || y === sy - 1;
      const ez = z === 0 || z === sz - 1;
      if (Number(ex) + Number(ey) + Number(ez) < 2) continue;
      const axis = ex && ez ? "y" : ey && ez ? "x" : "z";
      this.place(scope, [x, y, z], material, path, {
        ...options,
        auto: { axis },
      });
    }
  }

  /** `block`: one block at `at` (lengths and alignments as for `box`). */
  private block(raw: unknown, scope: Scope, path: string) {
    const arg = this.expectObject(
      raw,
      path,
      'an object like {"material": ..., "at": [x, y, z]}',
    ) as unknown as BlockArgs;
    if (arg.material === undefined) {
      throw new BuildError(path, "missing 'material'");
    }
    const at: unknown = arg.at ?? [0, 0, 0];
    if (!Array.isArray(at) || at.length !== 3) {
      throw new BuildError(
        `${path}.at`,
        `must be a list of 3 values [x, y, z], got ${show(at)}`,
      );
    }
    const pos = [0, 1, 2].map((i) =>
      resolvePosition(
        length(at[i], "position", `${path}.at[${i}]`),
        scope.size[i],
        1,
      ),
    );
    const material = this.resolver.resolve(arg.material, path);
    this.place(scope, [pos[0], pos[1], pos[2]], material, path, {
      extra: extraStates(arg),
      onlyEmpty: arg.only_empty === true,
      point: true,
    });
  }

  /**
   * `door`: clears a 1×2 opening at the bottom centre of the scope (z = 0)
   * and hangs a door in it, facing inward on a face scope (`+z` otherwise).
   * Without a material it uses `@door`.
   */
  private door(raw: unknown, scope: Scope, path: string) {
    let arg: DoorArgs;
    if (typeof raw === "string" || (isObject(raw) && "mix" in raw)) {
      arg = { material: raw as MaterialSpec };
    } else {
      arg = this.expectObject(
        raw,
        path,
        "a material or an object with 'material'",
      ) as DoorArgs;
    }
    const [sx, sy] = scope.size;
    const x = integer(arg.x, `${path}.x`, Math.floor((sx - 1) / 2), 0);
    if (x >= sx) {
      throw new BuildError(
        `${path}.x`,
        `must be less than the scope's width ${sx}, got ${x}`,
      );
    }
    const material = this.resolver.resolve(
      arg.material ?? "@door",
      path,
      "door",
    );
    const extra: Record<string, string> = {
      facing: String(arg.facing ?? (scope.kind === "face" ? "in" : "+z")),
    };
    if (arg.hinge !== undefined) extra.hinge = String(arg.hinge);
    for (let y = 0; y < Math.min(2, sy); y++) {
      this.place(scope, [x, y, 0], AIR_MATERIAL, path);
    }
    this.place(scope, [x, 0, 0], material, path, {
      extra: lowercase(extra),
    });
  }

  /**
   * `cylinder` (vertical) and `ellipsoid`, fitted to the scope through the
   * Shape Generator's voxel grids. A hollow cylinder is a tube: each layer
   * is a ring `thickness` blocks thick, open at the top and bottom.
   */
  private round(
    raw: unknown,
    scope: Scope,
    path: string,
    shape: "cylinder" | "ellipsoid",
  ) {
    const { material, ...options } = this.placementArgs(raw, path);
    const arg: Json = isObject(raw) && !("mix" in raw) ? raw : {};
    const hollow = arg.hollow === true;
    const thickness = Math.min(
      integer(arg.thickness, `${path}.thickness`, 1, 1),
      MAX_THICKNESS,
    );
    const [sx, sy, sz] = scope.size;
    let grid: VoxelGrid;
    try {
      grid = buildShapeGrid({
        shape,
        width: sx,
        height: shape === "cylinder" ? 1 : sy,
        depth: sz,
        hollow,
        thickness,
      });
    } catch {
      throw new BuildError(
        path,
        `scope ${show(scope.size)} is too big for '${shape}' (at most ${MAX_DIMENSION} per side)`,
      );
    }
    for (const [x, y, z] of scope.cells()) {
      const gy = shape === "cylinder" ? 0 : y;
      if (grid.filled[voxelIndex(grid.size, x, gy, z)]) {
        this.place(scope, [x, y, z], material, path, options);
      }
    }
  }

  /**
   * Logs one placement of `material` at local `at`: picks the mix entry for
   * the world cell, adds `extra` states the block has (noting the rest) and
   * the automatic ones (`auto`, then an axis from a flat scope's shape and
   * doors, trapdoors and wall torches facing in or out of a face scope),
   * turns them into world states and checks them against the version.
   * Doors and beds write both halves, sharing one sequence number.
   */
  place(
    scope: Scope,
    at: Vec,
    material: Material,
    path: string,
    options: PlacementOptions = {},
  ): void {
    const pos = scope.world(...at);
    if (++this.placements > this.maxPlacements) {
      throw new FatalBuildError(
        path,
        `too many block placements (more than ${this.maxPlacements.toLocaleString("en-US")})`,
      );
    }
    const entry = pickEntry(material, this.seed, pos);
    const write = {
      ...this.layers.current,
      seq: this.log.nextSeq(),
      onlyEmpty: options.onlyEmpty ?? false,
      replace: options.replace ?? null,
      path,
      point: options.point ?? false,
    };
    if (entry.id === AIR) {
      this.log.write(pos, { ...write, block: null });
      return;
    }
    const states = this.localStates(entry, scope, path, options);
    const oriented = orientStates(scope, states);
    for (const key of oriented.unknown) {
      this.warn({
        path,
        message: `unknown ${key} '${states[key]}' ignored`,
      });
    }
    const parts: [Vec, Record<string, string>][] = [];
    const kind = this.registry.kind(entry.id);
    if (kind === "door") {
      parts.push([pos, { ...oriented.states, half: "lower" }]);
      parts.push([add(pos, [0, 1, 0]), { ...oriented.states, half: "upper" }]);
    } else if (kind === "bed") {
      const facing =
        oriented.states.facing ??
        this.registry.defaults(entry.id)?.facing ??
        "north";
      parts.push([pos, { ...oriented.states, part: "foot" }]);
      parts.push([
        add(pos, FACING_VECTORS[facing] ?? [0, 0, 0]),
        { ...oriented.states, part: "head" },
      ]);
    } else {
      parts.push([pos, oriented.states]);
    }
    for (const [, partStates] of parts) {
      const key = JSON.stringify([entry.id, partStates]);
      if (!this.checkedStates.has(key)) {
        const error = validatePlacedState(this.registry, entry.id, partStates);
        if (error) throw new BuildError(path, error);
        this.checkedStates.add(key);
      }
    }
    for (const [partPos, partStates] of parts) {
      this.log.write(partPos, {
        ...write,
        block: { id: entry.id, states: partStates },
      });
    }
  }

  /**
   * The states of one placement, directions still local: the material's own,
   * `extra` (Cairn: a state the block doesn't have is noted and ignored, so
   * one `axis` can serve a mix of logs and stone) and the automatic ones.
   */
  private localStates(
    entry: MaterialEntry,
    scope: Scope,
    path: string,
    options: PlacementOptions,
  ): Record<string, string> {
    const properties = this.registry.properties(entry.id) ?? {};
    const states = { ...entry.states };
    for (const [key, value] of Object.entries(options.extra ?? {})) {
      if (Object.hasOwn(properties, key)) {
        states[key] = value;
        continue;
      }
      const message = `'${shortId(entry.id)}' has no state '${key}'; ignored`;
      const noteKey = JSON.stringify([path, message]);
      if (!this.notedStates.has(noteKey)) {
        this.notedStates.add(noteKey);
        this.notes.push({ path, message });
      }
    }
    for (const [key, value] of Object.entries(options.auto ?? {})) {
      if (Object.hasOwn(properties, key) && !(key in states)) {
        states[key] = value;
      }
    }
    if (Object.hasOwn(properties, "axis") && !("axis" in states)) {
      // a one-block-high run of logs lies along its length; a flat area of
      // them stands upright
      const [sx, sy, sz] = scope.size;
      if (sy === 1 && sx > 1 !== sz > 1) states.axis = sx > 1 ? "x" : "z";
      else if (sy === 1 && sx > 1 && sz > 1) states.axis = "y";
    }
    const kind = this.registry.kind(entry.id);
    if (
      scope.kind === "face" &&
      !("facing" in states) &&
      (kind === "door" || kind === "trapdoor" || kind === "wall_torch")
    ) {
      states.facing = kind === "door" ? "in" : "out";
    }
    return states;
  }
}

interface PlacementOptions {
  /** States the operation asked for; ignored (with a note) where missing. */
  extra?: Readonly<Record<string, string>>;
  /** Automatic states, used where the block has them and nothing set them. */
  auto?: Readonly<Record<string, string>>;
  onlyEmpty?: boolean;
  replace?: ReplaceSet | null;
  /** A single placed block (`block`), checked for collisions. */
  point?: boolean;
}

const AIR_MATERIAL: Material = {
  entries: [{ weight: 1, id: AIR, states: {} }],
};

const FACING_VECTORS: Readonly<Record<string, Vec>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function shortId(id: string): string {
  return id.replace(/^minecraft:/, "");
}

function lowercase(states: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(states).map(([k, v]) => [k, v.toLowerCase()]),
  );
}

/** `facing`, `axis`, `half` and `state` of a placement, lowercased. */
function extraStates(arg: {
  facing?: unknown;
  axis?: unknown;
  half?: unknown;
  state?: Record<string, unknown>;
}): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const key of ["facing", "axis", "half"] as const) {
    if (arg[key] !== undefined) extra[key] = String(arg[key]);
  }
  for (const [key, value] of Object.entries(arg.state ?? {})) {
    if (!key.startsWith("#")) extra[key] = String(value);
  }
  return lowercase(extra);
}

/** Compiles a validated program against one version's block registry. */
export function compileProgram(
  program: Program,
  registry: BlockRegistry,
  options: CompileOptions = {},
): CompileResult {
  return new Compiler(program, registry, options).run();
}
