import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clearBlockDataCache } from "../../blockdata/load";
import {
  type BlockRegistry,
  loadBlockRegistry,
} from "../../blockdata/registry";
import { BuildError } from "../errors";
import { MaterialResolver, pickEntry } from "../materials";
import type { MaterialSpec, ReplaceSpec } from "../program";
import {
  LayerStack,
  type Pos,
  type Write,
  WriteLog,
  composeCell,
  resolveReplace,
} from "../writes";

const FIXTURES = path.join(__dirname, "../../blockdata/__tests__/fixtures");
const BLOCKS_URL =
  "https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-summary/blocks/data.min.json";
const fetch = vi.fn(async (input: RequestInfo | URL) =>
  String(input) === BLOCKS_URL
    ? new Response(
        readFileSync(
          path.join(FIXTURES, "registry-mcmeta-1.21.4-blocks.json"),
          "utf8",
        ),
        { status: 200 },
      )
    : new Response("not found", { status: 404 }),
);

let registry: BlockRegistry;

beforeAll(async () => {
  clearBlockDataCache();
  registry = await loadBlockRegistry("1.21.4", { fetch });
});

// A stand-in for the compiler's walk (SCHEM-107/108): nested boxes carrying
// layers, `fill` with `replace`/`only_empty`, and single `block`s, all
// written through `LayerStack` and `WriteLog` the way the compiler does.
type Op =
  | {
      box: {
        at?: Pos;
        size?: Pos;
        priority?: number;
        carve?: boolean;
        do: Op[];
      };
    }
  | {
      fill:
        | MaterialSpec
        | {
            material: MaterialSpec;
            replace?: ReplaceSpec;
            only_empty?: boolean;
            priority?: number;
            carve?: boolean;
          };
    }
  | { block: { at: Pos; material: MaterialSpec } };

interface Region {
  at: Pos;
  size: Pos;
}

function run(
  ops: Op[],
  size: Pos,
  palette: Record<string, MaterialSpec> = {},
): { log: WriteLog; blocks: Map<string, string> } {
  const log = new WriteLog(size);
  const layers = new LayerStack();
  const resolver = new MaterialResolver(registry, palette);
  const place = (
    pos: Pos,
    spec: MaterialSpec,
    opPath: string,
    extra: Partial<Write> = {},
  ) => {
    const entry = pickEntry(resolver.resolve(spec, opPath), 0, pos);
    log.write(pos, {
      ...layers.current,
      seq: log.nextSeq(),
      block:
        entry.id === "minecraft:air"
          ? null
          : { id: entry.id, states: entry.states },
      onlyEmpty: false,
      replace: null,
      path: opPath,
      point: false,
      ...extra,
    });
  };
  const exec = (list: Op[], region: Region, listPath: string) =>
    list.forEach((op, i) => {
      const opPath = `${listPath}[${i}]`;
      if ("box" in op) {
        const { box } = op;
        const at = box.at ?? [0, 0, 0];
        const child: Region = {
          at: [
            region.at[0] + at[0],
            region.at[1] + at[1],
            region.at[2] + at[2],
          ],
          size: box.size ?? region.size,
        };
        layers.within(box, () => exec(box.do, child, `${opPath}.box.do`));
      } else if ("fill" in op) {
        const arg = op.fill;
        const fillPath = `${opPath}.fill`;
        const simple = typeof arg === "string" || "mix" in arg;
        const material = simple ? arg : arg.material;
        layers.within(arg, () => {
          const replace =
            !simple && arg.replace !== undefined
              ? resolveReplace(resolver, arg.replace, `${fillPath}.replace`)
              : null;
          const onlyEmpty = !simple && arg.only_empty === true;
          for (let x = 0; x < region.size[0]; x++) {
            for (let y = 0; y < region.size[1]; y++) {
              for (let z = 0; z < region.size[2]; z++) {
                const pos: Pos = [
                  region.at[0] + x,
                  region.at[1] + y,
                  region.at[2] + z,
                ];
                place(pos, material, fillPath, { replace, onlyEmpty });
              }
            }
          }
        });
      } else {
        const { at, material } = op.block;
        const pos: Pos = [
          region.at[0] + at[0],
          region.at[1] + at[1],
          region.at[2] + at[2],
        ];
        place(pos, material, `${opPath}.block`, { point: true });
      }
    });
  exec(ops, { at: [0, 0, 0], size }, "build");
  const blocks = new Map<string, string>();
  for (const [pos, block] of log.compose()) {
    const states = Object.entries(block.states)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    blocks.set(
      pos.join(","),
      block.id.replace("minecraft:", "") + (states ? `[${states}]` : ""),
    );
  }
  return { log, blocks };
}

const at = (blocks: Map<string, string>, x: number, y: number, z: number) =>
  blocks.get(`${x},${y},${z}`) ?? "air";

function write(overrides: Partial<Write>): Write {
  return {
    priority: 0,
    carve: false,
    seq: 0,
    block: { id: "minecraft:stone", states: {} },
    onlyEmpty: false,
    replace: null,
    path: "build[0].fill",
    point: false,
    ...overrides,
  };
}

describe("LayerStack", () => {
  it("starts at priority 0 without carve", () => {
    expect(new LayerStack().current).toEqual({ priority: 0, carve: false });
  });

  it("is inherited by nested operations and restored after them", () => {
    const layers = new LayerStack();
    const seen: unknown[] = [];
    layers.within({ priority: 2 }, () => {
      seen.push(layers.current);
      layers.within({ carve: true }, () => {
        seen.push(layers.current);
        layers.within({ material: "stone" }, () => seen.push(layers.current));
        layers.within("stone", () => seen.push(layers.current));
        layers.within({ priority: -1 }, () => seen.push(layers.current));
      });
      layers.within({ carve: false }, () => seen.push(layers.current));
      seen.push(layers.current);
    });
    seen.push(layers.current);
    expect(seen).toEqual([
      { priority: 2, carve: false },
      { priority: 2, carve: true },
      { priority: 2, carve: true },
      { priority: 2, carve: true },
      { priority: -1, carve: true },
      { priority: 2, carve: false },
      { priority: 2, carve: false },
      { priority: 0, carve: false },
    ]);
  });

  it("pops the layer when the operation throws", () => {
    const layers = new LayerStack();
    expect(() =>
      layers.within({ priority: 3 }, () => {
        throw new BuildError("build[0]", "boom");
      }),
    ).toThrow(BuildError);
    expect(layers.current).toEqual({ priority: 0, carve: false });
  });
});

describe("priority and carve", () => {
  // Cairn's test_priority_is_order_independent.
  it("lets the higher layer win in either program order", () => {
    const ops: Op[] = [
      { box: { priority: 1, size: [1, 1, 1], do: [{ fill: "bricks" }] } },
      { box: { size: [1, 1, 1], do: [{ fill: "stone" }] } },
    ];
    for (const order of [ops, [...ops].reverse()]) {
      expect(at(run(order, [1, 1, 1]).blocks, 0, 0, 0)).toBe("bricks");
    }
  });

  it("gives identical blocks for a program compiled in two orders", () => {
    const palette = {
      wall: { mix: { cobblestone: 3, mossy_cobblestone: 1 } },
    };
    // Reversing the top-level list reverses same-layer painting too, so each
    // feature keeps its own painting inside one box and sits on its own layer
    // (or, like the window, is judged against lower layers only).
    const ops: Op[] = [
      // a shell on layer 0: walls, then the hollow inside
      {
        box: {
          do: [
            { fill: "@wall" },
            { box: { at: [1, 0, 1], size: [3, 4, 3], do: [{ fill: "air" }] } },
          ],
        },
      },
      // a chimney on layer 1, its flue cut on layer 1
      {
        box: {
          at: [3, 0, 3],
          size: [2, 6, 2],
          priority: 1,
          do: [
            { fill: "bricks" },
            { box: { at: [0, 1, 0], size: [1, 5, 1], do: [{ fill: "air" }] } },
          ],
        },
      },
      // a skylight carved through everything on layer 2
      {
        box: {
          at: [1, 5, 1],
          size: [1, 1, 1],
          priority: 2,
          carve: true,
          do: [{ fill: "air" }],
        },
      },
      // a window on layer 1 punched through the wall only
      {
        box: {
          at: [0, 2, 1],
          size: [1, 1, 3],
          priority: 1,
          do: [{ fill: { material: "glass", replace: "@wall" } }],
        },
      },
    ];
    const forward = run(ops, [5, 6, 5], palette).blocks;
    const backward = run([...ops].reverse(), [5, 6, 5], palette).blocks;
    expect(at(forward, 4, 3, 4)).toBe("bricks");
    expect(at(forward, 3, 2, 3)).toBe("air");
    expect(at(forward, 3, 0, 3)).toBe("bricks");
    expect(at(forward, 1, 5, 1)).toBe("air");
    expect(at(forward, 2, 5, 2)).toMatch(/cobblestone/);
    expect(at(forward, 0, 2, 2)).toBe("glass");
    expect(at(forward, 1, 2, 2)).toBe("air");
    expect(forward.size).toBeGreaterThan(50);
    expect([...backward].sort()).toEqual([...forward].sort());
  });

  // Cairn's test_air_only_erases_its_own_layer_unless_carve.
  it("lets air erase only its own layer unless it carves", () => {
    const base: Op[] = [{ fill: "stone" }];
    const higherAir = run(
      [...base, { box: { priority: 1, do: [{ fill: "air" }] } }],
      [1, 1, 1],
    );
    expect(at(higherAir.blocks, 0, 0, 0)).toBe("stone");
    const carved = run(
      [...base, { box: { priority: 1, carve: true, do: [{ fill: "air" }] } }],
      [1, 1, 1],
    );
    expect(at(carved.blocks, 0, 0, 0)).toBe("air");
    const sameLayer = run([...base, { fill: "air" }], [1, 1, 1]);
    expect(at(sameLayer.blocks, 0, 0, 0)).toBe("air");
  });

  it("never lets a lower layer's later air or block win", () => {
    const { blocks } = run(
      [
        { box: { priority: 1, do: [{ fill: "bricks" }] } },
        { fill: "stone" },
        { fill: "air" },
        { box: { carve: true, do: [{ fill: "air" }] } },
      ],
      [1, 1, 1],
    );
    expect(at(blocks, 0, 0, 0)).toBe("bricks");
  });

  it("paints a layer in program order", () => {
    const { blocks } = run(
      [{ box: { priority: -1, do: [{ fill: "stone" }, { fill: "bricks" }] } }],
      [1, 1, 1],
    );
    expect(at(blocks, 0, 0, 0)).toBe("bricks");
  });

  it("takes priority and carve from a fill's own argument object", () => {
    const air = (carve: boolean): Op => ({
      fill: { material: "air", priority: 1, carve },
    });
    const ops = (carve: boolean): Op[] => [air(carve), { fill: "stone" }];
    expect(at(run(ops(false), [1, 1, 1]).blocks, 0, 0, 0)).toBe("stone");
    expect(at(run(ops(true), [1, 1, 1]).blocks, 0, 0, 0)).toBe("air");
    // Carving air erases lower layers only: a higher layer applies after it.
    const { blocks } = run(
      [
        { fill: { material: "bricks", priority: 2 } },
        air(true),
        { fill: "stone" },
      ],
      [1, 1, 1],
    );
    expect(at(blocks, 0, 0, 0)).toBe("bricks");
  });
});

describe("only_empty and replace", () => {
  it("judges only_empty against lower layers and earlier writes", () => {
    const ops: Op[] = [
      { fill: { material: "oak_planks", only_empty: true } },
      { box: { priority: -1, size: [1, 1, 1], do: [{ fill: "stone" }] } },
    ];
    // (0,0,0) holds stone from a lower layer whichever comes first.
    for (const order of [ops, [...ops].reverse()]) {
      const { blocks } = run(order, [2, 1, 1]);
      expect(at(blocks, 0, 0, 0)).toBe("stone");
      expect(at(blocks, 1, 0, 0)).toBe("oak_planks");
    }
    // A later write on the same layer comes after it.
    const { blocks } = run(
      [
        { fill: { material: "oak_planks", only_empty: true } },
        { fill: "cobblestone" },
      ],
      [1, 1, 1],
    );
    expect(at(blocks, 0, 0, 0)).toBe("cobblestone");
  });

  it("replaces only the listed ids", () => {
    const { blocks } = run(
      [
        { box: { size: [1, 1, 1], do: [{ fill: "stone" }] } },
        { box: { at: [1, 0, 0], size: [1, 1, 1], do: [{ fill: "bricks" }] } },
        { fill: { material: "glass", replace: "minecraft:stone" } },
      ],
      [3, 1, 1],
    );
    expect([0, 1, 2].map((x) => at(blocks, x, 0, 0))).toEqual([
      "glass",
      "bricks",
      "air",
    ]);
  });

  it("replaces roles, mixes and lists of them", () => {
    const palette = { wall: "stone_bricks" };
    const ops = (replace: ReplaceSpec): Op[] => [
      { box: { size: [1, 1, 1], do: [{ fill: "@wall" }] } },
      {
        box: { at: [1, 0, 0], size: [1, 1, 1], do: [{ fill: "cobblestone" }] },
      },
      { box: { at: [2, 0, 0], size: [1, 1, 1], do: [{ fill: "bricks" }] } },
      { fill: { material: "glass", replace } },
    ];
    const row = (replace: ReplaceSpec) => {
      const { blocks } = run(ops(replace), [4, 1, 1], palette);
      return [0, 1, 2, 3].map((x) => at(blocks, x, 0, 0));
    };
    expect(row("@wall")).toEqual(["glass", "cobblestone", "bricks", "air"]);
    expect(row({ mix: { cobblestone: 1, bricks: 1 } })).toEqual([
      "stone_bricks",
      "glass",
      "glass",
      "air",
    ]);
    expect(row(["@wall", "bricks"])).toEqual([
      "glass",
      "cobblestone",
      "glass",
      "air",
    ]);
    expect(row("air")).toEqual([
      "stone_bricks",
      "cobblestone",
      "bricks",
      "glass",
    ]);
  });

  it('replaces any non-air block with "solid"', () => {
    const { blocks } = run(
      [
        { box: { size: [2, 1, 1], do: [{ fill: "stone" }] } },
        { fill: { material: "glass", replace: ["bricks", "solid"] } },
      ],
      [3, 1, 1],
    );
    expect([0, 1, 2].map((x) => at(blocks, x, 0, 0))).toEqual([
      "glass",
      "glass",
      "air",
    ]);
  });

  it("judges replace against lower layers whichever comes first", () => {
    const ops: Op[] = [
      { fill: { material: "glass", replace: "stone" } },
      { box: { priority: -1, size: [1, 1, 1], do: [{ fill: "stone" }] } },
    ];
    for (const order of [ops, [...ops].reverse()]) {
      const { blocks } = run(order, [2, 1, 1]);
      expect(at(blocks, 0, 0, 0)).toBe("glass");
      expect(at(blocks, 1, 0, 0)).toBe("air");
    }
  });

  it("can't erase with replace or only_empty outside the rules", () => {
    expect(
      composeCell([
        write({ seq: 1 }),
        write({ seq: 2, block: null, priority: 1, replace: "solid" }),
      ]),
    ).toEqual({ id: "minecraft:stone", states: {} });
    expect(
      composeCell([
        write({ seq: 1 }),
        write({ seq: 2, block: null, replace: "solid" }),
      ]),
    ).toBeNull();
    expect(composeCell([write({ seq: 1, block: null, onlyEmpty: true })])).toBe(
      null,
    );
  });

  it("reports replace materials that don't resolve at their path", () => {
    const resolver = new MaterialResolver(registry);
    expect(() =>
      resolveReplace(resolver, ["stone", "@nope"], "build[0].fill.replace"),
    ).toThrow(
      expect.objectContaining({ path: "build[0].fill.replace[1]" }) as Error,
    );
    expect(() =>
      resolveReplace(resolver, "@nope", "build[0].fill.replace"),
    ).toThrow(
      expect.objectContaining({ path: "build[0].fill.replace" }) as Error,
    );
  });

  it("resolves replace sets to block ids", () => {
    const resolver = new MaterialResolver(registry, { wall: "stone_bricks" });
    expect(
      resolveReplace(resolver, ["@wall", "oak_stairs[half=top]"], "p"),
    ).toEqual(new Set(["minecraft:stone_bricks", "minecraft:oak_stairs"]));
    expect(resolveReplace(resolver, "any", "p")).toBe("solid");
  });
});

describe("write log", () => {
  it("records each write's program path", () => {
    const { log } = run(
      [
        { fill: "stone" },
        { box: { priority: 1, do: [{ fill: "bricks" }] } },
        { block: { at: [0, 0, 0], material: "lantern" } },
      ],
      [1, 1, 1],
    );
    expect(log.writesAt([0, 0, 0]).map((w) => [w.path, w.point])).toEqual([
      ["build[0].fill", false],
      ["build[1].box.do[0].fill", false],
      ["build[2].block", true],
    ]);
  });

  it("counts and drops writes outside the build", () => {
    const log = new WriteLog([2, 2, 2]);
    expect(log.write([2, 0, 0], write({}))).toBe(false);
    expect(log.write([0, -1, 0], write({}))).toBe(false);
    expect(log.write([1, 1, 1], write({}))).toBe(true);
    expect(log.outOfBounds).toBe(2);
    expect(log.writesAt([5, 5, 5])).toEqual([]);
    expect(log.peek([1, 1, 1])).toEqual({ id: "minecraft:stone", states: {} });
    expect(log.peek([0, 0, 0])).toBeNull();
  });

  it("maps cells back to their positions", () => {
    const log = new WriteLog([3, 4, 5]);
    const positions: Pos[] = [
      [0, 0, 0],
      [2, 3, 4],
      [1, 2, 3],
      [2, 0, 4],
      [0, 3, 0],
    ];
    for (const pos of positions) log.write(pos, write({}));
    expect([...log.compose()].map(([pos]) => pos).sort()).toEqual(
      [...positions].sort(),
    );
  });

  it("numbers placements in program order", () => {
    const log = new WriteLog([1, 1, 1]);
    expect([log.nextSeq(), log.nextSeq(), log.nextSeq()]).toEqual([1, 2, 3]);
  });
});

describe("collisions", () => {
  const warnings = (ops: Op[], size: Pos) =>
    run(ops, size).log.collisions(registry);

  it("warns when a placed block replaces another feature's block", () => {
    expect(
      warnings(
        [
          { box: { at: [0, 0, 0], size: [1, 3, 1], do: [{ fill: "bricks" }] } },
          { block: { at: [0, 1, 0], material: "red_bed" } },
        ],
        [1, 3, 1],
      ),
    ).toEqual([
      {
        path: "build[1].block",
        message:
          "red_bed at [0,1,0] replaced bricks from build[0].box.do[0].fill " +
          "(two features occupy the same space; move one of them)",
      },
    ]);
  });

  it("warns when a placed block is overwritten later", () => {
    const out = warnings(
      [{ block: { at: [0, 0, 0], material: "lantern" } }, { fill: "stone" }],
      [1, 1, 1],
    );
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("build[0].block");
    expect(out[0].message).toContain(
      "lantern at [0,0,0] was overwritten by stone from build[1].fill",
    );
  });

  it("names the winning other write", () => {
    const out = warnings(
      [
        { block: { at: [0, 0, 0], material: "lantern" } },
        { box: { priority: 1, do: [{ fill: "bricks" }] } },
        { fill: "stone" },
      ],
      [1, 1, 1],
    );
    expect(out.map((w) => w.message)).toEqual([
      expect.stringContaining(
        "was overwritten by bricks from build[1].box.do[0].fill",
      ),
    ]);
  });

  it("exempts doors, trapdoors and wall torches set into solid walls", () => {
    for (const material of [
      "oak_door",
      "oak_trapdoor",
      "wall_torch",
      "stone_button",
    ]) {
      expect(
        warnings(
          [{ fill: "stone_bricks" }, { block: { at: [0, 0, 0], material } }],
          [1, 1, 1],
        ),
      ).toEqual([]);
    }
    expect(
      warnings(
        [{ fill: "oak_log" }, { block: { at: [0, 0, 0], material: "torch" } }],
        [1, 1, 1],
      ),
    ).toHaveLength(1);
  });

  it("still warns about a door eating a window pane", () => {
    const out = warnings(
      [
        { fill: "glass_pane" },
        { block: { at: [0, 0, 0], material: "oak_door" } },
      ],
      [1, 1, 1],
    );
    expect(out.map((w) => w.message)).toEqual([
      expect.stringContaining("oak_door at [0,0,0] replaced glass_pane"),
    ]);
  });

  it("ignores air, its own path and cells without placed blocks", () => {
    expect(
      warnings(
        [
          { fill: "air" },
          { block: { at: [0, 0, 0], material: "lantern" } },
          { fill: "stone" },
          { fill: "bricks" },
        ],
        [2, 1, 1],
      ).map((w) => w.message),
    ).toEqual([expect.stringContaining("lantern at [0,0,0] was overwritten")]);
    expect(
      warnings([{ block: { at: [0, 0, 0], material: "lantern" } }], [1, 1, 1]),
    ).toEqual([]);
  });

  it("reports one warning per pair of paths and outcome", () => {
    const out = warnings(
      [{ fill: "stone" }, { box: { do: [{ fill: "lantern" }] } }],
      [3, 1, 1],
    );
    expect(out).toEqual([]);
    const log = new WriteLog([3, 1, 1]);
    for (let x = 0; x < 3; x++) {
      log.write([x, 0, 0], write({ seq: 1, path: "build[0].fill" }));
      log.write(
        [x, 0, 0],
        write({
          seq: 2,
          path: "build[1].block",
          point: true,
          block: { id: "minecraft:lantern", states: {} },
        }),
      );
    }
    expect(log.collisions(registry)).toHaveLength(1);
  });
});
