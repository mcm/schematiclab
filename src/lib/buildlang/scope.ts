// Oriented scopes (port of Cairn's `cairn/scope.py`). A scope is a box in
// world space with its own local axes. Operations only use local coordinates,
// and directional block states (`facing`, `axis`, `rotation`) are written
// locally and turned into world values at placement time. Worker-safe.
//
// World (Minecraft): +x east, +y up, +z south.
// Box scopes: front is the +z face, back -z, left -x, right +x (as seen by
// someone standing in front).
// Face scopes (from `faces`): local x runs left to right seen from outside,
// y is up and z points into the building (z = 0 is the outer surface).

import type { Axis } from "./program";

export type Vec = readonly [number, number, number];

/** A world compass direction, as Minecraft's `facing` state writes it. */
export type WorldFacing = "north" | "south" | "east" | "west" | "up" | "down";

export type ScopeKind = "box" | "face";

/** The faces `face()` builds (`edges` is separate: it gives four scopes). */
export type ScopeFaceName =
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

// `+ 0` turns -0 into 0, so vectors compare and print cleanly.
const vec = (x: number, y: number, z: number): Vec => [x + 0, y + 0, z + 0];
const add = (a: Vec, b: Vec): Vec => vec(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
const mul = (a: Vec, s: number): Vec => vec(a[0] * s, a[1] * s, a[2] * s);
const neg = (a: Vec): Vec => mul(a, -1);

const WORLD_FACINGS: readonly (readonly [Vec, WorldFacing])[] = [
  [[0, 0, -1], "north"],
  [[0, 0, 1], "south"],
  [[1, 0, 0], "east"],
  [[-1, 0, 0], "west"],
  [[0, 1, 0], "up"],
  [[0, -1, 0], "down"],
];

function worldFacing(v: Vec): WorldFacing {
  for (const [w, name] of WORLD_FACINGS) {
    if (w[0] === v[0] && w[1] === v[1] && w[2] === v[2]) return name;
  }
  throw new Error(`not a unit axis vector: ${v.join(",")}`);
}

const WORLD_FACING_NAMES = new Set<string>(WORLD_FACINGS.map(([, n]) => n));

/**
 * Local direction names. `in`/`out`/`left`/`right` are meant for face scopes
 * (z points inward) and `front`/`back` for boxes, but like Cairn every scope
 * accepts all of them.
 */
export const LOCAL_DIRECTIONS: Readonly<Record<string, Vec>> = {
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+z": [0, 0, 1],
  "-z": [0, 0, -1],
  up: [0, 1, 0],
  down: [0, -1, 0],
  in: [0, 0, 1],
  out: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
};

/**
 * Rotate by `r` quarter turns about the vertical axis. `r = 1` maps +x to +z,
 * which is clockwise seen from above.
 */
export function rotateY(v: Vec, r: number): Vec {
  let [x, z] = [v[0], v[2]];
  for (let i = 0; i < ((r % 4) + 4) % 4; i++) [x, z] = [-z, x];
  return vec(x, v[1], z);
}

// Minecraft's 16-step `rotation` (signs, banners, heads): 0 faces south and
// each quarter turn clockwise seen from above adds 4.
const ROTATION_OF: Partial<Record<WorldFacing, number>> = {
  south: 0,
  west: 4,
  north: 8,
  east: 12,
};

export class Scope {
  constructor(
    /** World position of local (0, 0, 0). */
    readonly origin: Vec,
    /** World direction of local +x. */
    readonly ux: Vec,
    /** World direction of local +y. */
    readonly uy: Vec,
    /** World direction of local +z. */
    readonly uz: Vec,
    /** Size in blocks along the local axes. */
    readonly size: Vec,
    readonly kind: ScopeKind = "box",
  ) {}

  static root(size: Vec): Scope {
    return new Scope([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], size);
  }

  // -- coordinate mapping ------------------------------------------------------

  world(x: number, y: number, z: number): Vec {
    return add(this.origin, this.localDirToWorld([x, y, z]));
  }

  localDirToWorld(d: Vec): Vec {
    return add(add(mul(this.ux, d[0]), mul(this.uy, d[1])), mul(this.uz, d[2]));
  }

  /**
   * The world `facing` of a local direction name (see `LOCAL_DIRECTIONS`).
   * Compass names pass through unchanged; anything else gives null.
   */
  facing(name: string): WorldFacing | null {
    const local = Object.hasOwn(LOCAL_DIRECTIONS, name)
      ? LOCAL_DIRECTIONS[name]
      : undefined;
    if (local === undefined) {
      return WORLD_FACING_NAMES.has(name) ? (name as WorldFacing) : null;
    }
    return worldFacing(this.localDirToWorld(local));
  }

  /** The world axis a local axis runs along (x and z swap under odd turns). */
  axis(local: Axis): Axis {
    const v = local === "x" ? this.ux : local === "y" ? this.uy : this.uz;
    return v[0] ? "x" : v[1] ? "y" : "z";
  }

  /**
   * The world value of a local 16-step `rotation` (0 faces local +z, each
   * quarter turn clockwise seen from above adds 4). Face scopes are mirrored
   * (seen from outside, x runs left to right while z points in), and so are
   * their in-between rotations.
   */
  rotation(local: number): number {
    const base = ROTATION_OF[worldFacing(this.uz)] ?? 0;
    // local -x is a quarter turn clockwise from local +z
    const quarter = ROTATION_OF[worldFacing(neg(this.ux))] ?? 0;
    const sign = (quarter - base + 16) % 16 === 4 ? 1 : -1;
    return (((base + sign * local) % 16) + 16) % 16;
  }

  /** Every local cell, y-major then z then x. */
  *cells(): Generator<Vec> {
    const [sx, sy, sz] = this.size;
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) yield [x, y, z];
      }
    }
  }

  // -- derived scopes ----------------------------------------------------------

  /**
   * A child box at local offset `at` with `size` in its own axes, turned by
   * `rotate` quarter turns (clockwise seen from above). The footprint starts at
   * `at` in this scope's coordinates whatever the rotation, so `rotate: 1`
   * with `size [9, h, 7]` covers 7 along this scope's x and 9 along its z.
   */
  sub(at: Vec, size: Vec, rotate = 0): Scope {
    const r = ((rotate % 4) + 4) % 4;
    if (r === 0)
      return new Scope(this.world(...at), this.ux, this.uy, this.uz, size);
    // the child's axes in this scope's local terms
    const cx = rotateY([1, 0, 0], r);
    const cz = rotateY([0, 0, 1], r);
    const [sx, , sz] = size;
    const corners = [0, sx - 1].flatMap((i) =>
      [0, sz - 1].map((k) => add(mul(cx, i), mul(cz, k))),
    );
    const minX = Math.min(...corners.map((c) => c[0]));
    const minZ = Math.min(...corners.map((c) => c[2]));
    const localOrigin = vec(at[0] - minX, at[1], at[2] - minZ);
    return new Scope(
      this.world(...localOrigin),
      this.localDirToWorld(cx),
      this.uy,
      this.localDirToWorld(cz),
      size,
    );
  }

  /**
   * One face of this box, `thickness` deep. Side faces are face scopes (x
   * left to right seen from outside, z inward); top and bottom are boxes with
   * this scope's axes.
   */
  face(name: ScopeFaceName, thickness = 1): Scope {
    const [w, h, d] = this.size;
    const { ux, uy, uz } = this;
    const t = thickness;
    switch (name) {
      case "front": // local z = d - 1, outward +uz
        return new Scope(
          this.world(0, 0, d - 1),
          ux,
          uy,
          neg(uz),
          [w, h, t],
          "face",
        );
      case "back": // local z = 0, outward -uz
        return new Scope(
          this.world(w - 1, 0, 0),
          neg(ux),
          uy,
          uz,
          [w, h, t],
          "face",
        );
      case "left": // local x = 0, outward -ux
        return new Scope(this.world(0, 0, 0), uz, uy, ux, [d, h, t], "face");
      case "right": // local x = w - 1, outward +ux
        return new Scope(
          this.world(w - 1, 0, d - 1),
          neg(uz),
          uy,
          neg(ux),
          [d, h, t],
          "face",
        );
      case "top":
        return new Scope(this.world(0, h - 1, 0), ux, uy, uz, [w, t, d]);
      case "bottom":
        return new Scope(this.world(0, 0, 0), ux, uy, uz, [w, t, d]);
    }
  }

  /** The four vertical corner columns (pillars, quoins, timber posts). */
  edges(): Scope[] {
    const [w, h, d] = this.size;
    const corners: Vec[] = [
      [0, 0, 0],
      [w - 1, 0, 0],
      [0, 0, d - 1],
      [w - 1, 0, d - 1],
    ];
    return corners.map((p) => this.sub(p, [1, h, 1]));
  }
}

/**
 * Turn the directional states of a block written in `scope` into world
 * values: `facing` through `Scope.facing`, a local `axis` through
 * `Scope.axis`, and a numeric `rotation` (0–15) through `Scope.rotation`.
 * Other states pass through. A `facing` that isn't a direction gives an
 * `unknown` entry and is left out; the caller reports it.
 */
export function orientStates(
  scope: Scope,
  states: Readonly<Record<string, string>>,
): { states: Record<string, string>; unknown: string[] } {
  const out: Record<string, string> = {};
  const unknown: string[] = [];
  for (const [key, raw] of Object.entries(states)) {
    const value = raw.toLowerCase();
    if (key === "facing") {
      const facing = scope.facing(value);
      if (facing === null) unknown.push(key);
      else out[key] = facing;
    } else if (
      key === "axis" &&
      (value === "x" || value === "y" || value === "z")
    ) {
      out[key] = scope.axis(value);
    } else if (key === "rotation" && /^(?:[0-9]|1[0-5])$/.test(value)) {
      out[key] = String(scope.rotation(Number(value)));
    } else {
      out[key] = value;
    }
  }
  return { states: out, unknown };
}
