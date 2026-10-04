import { describe, expect, it } from "vitest";

import { orientStates, rotateY, Scope, type Vec } from "../scope";

const root = Scope.root([21, 16, 15]);

/** The world cells a scope covers, sorted. */
function footprint(scope: Scope): string[] {
  return [...scope.cells()].map((c) => scope.world(...c).join(",")).sort();
}

function bounds(scope: Scope): { min: Vec; max: Vec } {
  const cells = [...scope.cells()].map((c) => scope.world(...c));
  const pick = (f: (...n: number[]) => number, i: number) =>
    f(...cells.map((c) => c[i]));
  return {
    min: [pick(Math.min, 0), pick(Math.min, 1), pick(Math.min, 2)],
    max: [pick(Math.max, 0), pick(Math.max, 1), pick(Math.max, 2)],
  };
}

describe("rotateY", () => {
  it("turns clockwise seen from above", () => {
    expect(rotateY([1, 0, 0], 1)).toEqual([0, 0, 1]);
    expect(rotateY([0, 0, 1], 1)).toEqual([-1, 0, 0]);
    expect(rotateY([1, 2, 0], 2)).toEqual([-1, 2, 0]);
    expect(rotateY([1, 0, 0], 4)).toEqual([1, 0, 0]);
    expect(rotateY([1, 0, 0], -1)).toEqual([0, 0, -1]);
  });
});

describe("Scope.world", () => {
  it("offsets the root by local coordinates", () => {
    expect(root.world(1, 2, 3)).toEqual([1, 2, 3]);
  });

  it("maps through a sub box's axes", () => {
    const child = root.sub([2, 1, 3], [4, 4, 4]);
    expect(child.world(0, 0, 0)).toEqual([2, 1, 3]);
    expect(child.world(1, 1, 1)).toEqual([3, 2, 4]);
  });
});

describe("rotated boxes", () => {
  it("keeps the footprint at `at` with size in the child's own axes", () => {
    const wing = root.sub([7, 4, 7], [9, 8, 7], 1);
    expect(bounds(wing)).toEqual({ min: [7, 4, 7], max: [13, 11, 15] });
    expect(wing.size).toEqual([9, 8, 7]);
  });

  it.each([0, 1, 2, 3])(
    "rotate %i covers the same cells as its footprint",
    (r) => {
      const size: Vec = r % 2 ? [3, 2, 5] : [5, 2, 3];
      const turned = root.sub([2, 0, 4], size, r);
      expect(footprint(turned)).toEqual(
        footprint(root.sub([2, 0, 4], [5, 2, 3])),
      );
    },
  );

  it("treats rotate modulo 4", () => {
    expect(root.sub([0, 0, 0], [3, 1, 2], 5)).toEqual(
      root.sub([0, 0, 0], [3, 1, 2], 1),
    );
    expect(root.sub([0, 0, 0], [3, 1, 2], -1)).toEqual(
      root.sub([0, 0, 0], [3, 1, 2], 3),
    );
  });

  it("composes rotations of nested boxes", () => {
    const once = root.sub([0, 0, 0], [5, 5, 5], 1).sub([0, 0, 0], [5, 5, 5], 1);
    const twice = root.sub([0, 0, 0], [5, 5, 5], 2);
    expect(once.facing("+z")).toBe(twice.facing("+z"));
    expect(footprint(once)).toEqual(footprint(twice));
  });
});

describe("block-state rotation", () => {
  const box = (r: number) => root.sub([0, 0, 0], [5, 4, 5], r);

  it.each([
    [0, "south"],
    [1, "west"],
    [2, "north"],
    [3, "east"],
  ])("a facing=+z stair in a box turned %i faces %s", (r, facing) => {
    const { states } = orientStates(box(r), { facing: "+z", half: "bottom" });
    expect(states).toEqual({ facing, half: "bottom" });
  });

  it.each([
    [0, "x"],
    [1, "z"],
    [2, "x"],
    [3, "z"],
  ])("an axis=x log in a box turned %i runs along %s", (r, axis) => {
    expect(orientStates(box(r), { axis: "x" }).states).toEqual({ axis });
    expect(box(r).axis("y")).toBe("y");
  });

  it.each([
    [0, "7"],
    [1, "11"],
    [2, "15"],
    [3, "3"],
  ])("rotation=7 in a box turned %i becomes %s", (r, rotation) => {
    expect(orientStates(box(r), { rotation: "7" }).states).toEqual({
      rotation,
    });
  });

  it("turns rotation 0 to face where local +z faces", () => {
    const names = { 0: "south", 4: "west", 8: "north", 12: "east" } as const;
    for (const r of [0, 1, 2, 3]) {
      expect(names[box(r).rotation(0) as 0 | 4 | 8 | 12]).toBe(
        box(r).facing("+z"),
      );
    }
  });

  it("maps up, down and compass names unchanged", () => {
    expect(box(1).facing("up")).toBe("up");
    expect(box(1).facing("down")).toBe("down");
    expect(box(1).facing("north")).toBe("north");
    expect(box(1).facing("sideways")).toBeNull();
    expect(box(1).facing("toString")).toBeNull();
  });

  it("maps every local direction in a turned box", () => {
    const b = box(1);
    expect(b.facing("+x")).toBe("south");
    expect(b.facing("-x")).toBe("north");
    expect(b.facing("-z")).toBe("east");
    expect(b.facing("front")).toBe("west");
    expect(b.facing("back")).toBe("east");
  });

  it("reports an unknown facing and passes other states through", () => {
    expect(
      orientStates(root, { facing: "Sideways", half: "TOP", axis: "q" }),
    ).toEqual({
      states: { half: "top", axis: "q" },
      unknown: ["facing"],
    });
    expect(orientStates(root, { rotation: "16" }).states).toEqual({
      rotation: "16",
    });
  });
});

describe("face scopes", () => {
  const house = Scope.root([5, 3, 4]);

  it("runs x left to right seen from outside", () => {
    // front (z max) seen from the south: left is west
    expect(house.face("front").world(0, 0, 0)).toEqual([0, 0, 3]);
    // back seen from the north: left is east
    expect(house.face("back").world(0, 0, 0)).toEqual([4, 0, 0]);
    // left (x = 0) seen from the west: left is north
    expect(house.face("left").world(0, 0, 0)).toEqual([0, 0, 0]);
    // right (x max) seen from the east: left is south
    expect(house.face("right").world(0, 0, 0)).toEqual([4, 0, 3]);
    expect(house.face("front").world(4, 0, 0)).toEqual([4, 0, 3]);
  });

  it("points z inward", () => {
    expect(house.face("front", 2).world(0, 0, 1)).toEqual([0, 0, 2]);
    expect(house.face("back").facing("in")).toBe("south");
    expect(house.face("left").facing("in")).toBe("east");
    expect(house.face("right").facing("in")).toBe("west");
  });

  it("maps in, out, left and right", () => {
    const front = house.face("front");
    expect(front.kind).toBe("face");
    expect(front.facing("in")).toBe("north");
    expect(front.facing("out")).toBe("south");
    expect(front.facing("left")).toBe("west");
    expect(front.facing("right")).toBe("east");
  });

  it("sizes side faces by their width and the thickness", () => {
    expect(house.face("front", 2).size).toEqual([5, 3, 2]);
    expect(house.face("left").size).toEqual([4, 3, 1]);
  });

  it("makes top and bottom boxes with the parent's axes", () => {
    const top = house.face("top");
    expect(top.kind).toBe("box");
    expect(top.size).toEqual([5, 1, 4]);
    expect(top.world(0, 0, 0)).toEqual([0, 2, 0]);
    expect(house.face("bottom").world(1, 0, 1)).toEqual([1, 0, 1]);
  });

  it("follows a turned box: its front faces west", () => {
    const front = Scope.root([5, 4, 5])
      .sub([0, 0, 0], [5, 4, 5], 1)
      .face("front");
    expect(
      new Set([...front.cells()].map((c) => front.world(...c)[0])),
    ).toEqual(new Set([0]));
    expect(front.facing("in")).toBe("east");
  });

  it("mirrors in-between rotations", () => {
    const front = house.face("front");
    expect(front.rotation(0)).toBe(8); // faces in: north
    expect(front.rotation(4)).toBe(4); // faces local -x: west
    expect(front.rotation(1)).toBe(7);
  });
});

describe("edges", () => {
  it("gives the four corner columns", () => {
    const cols = Scope.root([5, 3, 4]).edges();
    expect(cols.map((c) => c.world(0, 0, 0))).toEqual([
      [0, 0, 0],
      [4, 0, 0],
      [0, 0, 3],
      [4, 0, 3],
    ]);
    expect(cols.every((c) => c.size.join() === "1,3,1")).toBe(true);
  });
});
