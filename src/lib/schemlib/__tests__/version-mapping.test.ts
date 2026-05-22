// Integration tests for MinecraftVersionMapper.mapBlock — exercises the full
// translator pipeline through the public API. Pure-translator unit tests live
// in data/__tests__/translate.test.ts.

import { describe, it, expect } from "vitest";

import { Block, BlockPos, BlockState } from "../blocks";
import { MinecraftVersionMapper, posKey } from "../schematic-formats/version-mapping";
import { fixupDoors } from "../data/translate";

const at = (name: string, props?: Record<string, string>) =>
  new Block(BlockPos.ORIGIN, new BlockState({ Name: name, Properties: props }));

describe("MinecraftVersionMapper", () => {
  it("returns the same block when source and target match", () => {
    const block = at("minecraft:stone");
    const mapper = new MinecraftVersionMapper(
      new Map([[posKey(BlockPos.ORIGIN), block]]),
      MinecraftVersionMapper.getVersion("1.20.1"),
    );

    const mapped = mapper.mapBlock(block, MinecraftVersionMapper.getVersion("1.20.1"));
    expect(mapped.state.equals(block.state)).toBe(true);
    expect(mapped.pos.equals(block.pos)).toBe(true);
  });

  it("stone passes through unchanged across the version chain", () => {
    const block = at("minecraft:stone");
    const mapper = new MinecraftVersionMapper(
      new Map([[posKey(BlockPos.ORIGIN), block]]),
      MinecraftVersionMapper.getVersion("1.13.1"),
    );

    const mapped = mapper.mapBlock(block, MinecraftVersionMapper.getVersion("1.20.1"));
    expect(mapped.state.equals(block.state)).toBe(true);
  });

  it("translates pre-flatten legacy id (synthetic name) into a post-flatten state", () => {
    // Legacy `5:1` is spruce planks. Readers for `.schematic` files synthesize
    // this `minecraft:#id:meta` name so the rest of the pipeline can carry
    // pre-flatten blocks through a normal BlockState.
    const block = at("minecraft:#5:1");
    const mapper = new MinecraftVersionMapper(
      new Map([[posKey(BlockPos.ORIGIN), block]]),
      MinecraftVersionMapper.getVersion("1.12.2"),
    );

    const mapped = mapper.mapBlock(block, MinecraftVersionMapper.getVersion("1.20.1"));
    expect(mapped.state.equals(new BlockState({ Name: "minecraft:spruce_planks" }))).toBe(true);
  });

  it("renames grass_path → dirt_path across the 1.17 boundary", () => {
    const block = at("minecraft:grass_path");
    const mapper = new MinecraftVersionMapper(
      new Map([[posKey(BlockPos.ORIGIN), block]]),
      MinecraftVersionMapper.getVersion("1.16.5"),
    );

    const mapped = mapper.mapBlock(block, MinecraftVersionMapper.getVersion("1.17.1"));
    expect(mapped.state.equals(new BlockState({ Name: "minecraft:dirt_path" }))).toBe(true);
  });

  it("renames sign → oak_sign across the 1.14 boundary", () => {
    const block = at("minecraft:sign", { rotation: "0" });
    const mapper = new MinecraftVersionMapper(
      new Map([[posKey(BlockPos.ORIGIN), block]]),
      MinecraftVersionMapper.getVersion("1.13.1"),
    );

    const mapped = mapper.mapBlock(block, MinecraftVersionMapper.getVersion("1.20.1"));
    expect(mapped.state.Name).toBe("minecraft:oak_sign");
  });

  it("reverses dirt_path → grass_path when going backward across 1.17", () => {
    const block = at("minecraft:dirt_path");
    const mapper = new MinecraftVersionMapper(
      new Map([[posKey(BlockPos.ORIGIN), block]]),
      MinecraftVersionMapper.getVersion("1.17.1"),
    );

    const mapped = mapper.mapBlock(block, MinecraftVersionMapper.getVersion("1.16.5"));
    expect(mapped.state.Name).toBe("minecraft:grass_path");
  });

  it("emits a warning and falls back to air when a block didn't exist in the target", () => {
    // Copper blocks were added in 1.17. Going 1.17 → 1.16 should drop them.
    const block = at("minecraft:copper_block");
    const warnings: string[] = [];
    const mapper = new MinecraftVersionMapper(
      new Map([[posKey(BlockPos.ORIGIN), block]]),
      MinecraftVersionMapper.getVersion("1.17.1"),
    );

    const mapped = mapper.mapBlock(
      block,
      MinecraftVersionMapper.getVersion("1.16.5"),
      { onWarning: (m) => warnings.push(m) },
    );
    expect(mapped.state.Name).toBe("minecraft:air");
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ── Door cross-block fixup ────────────────────────────────────────────────

describe("fixupDoors", () => {
  it("copies hinge/powered from upper half down to lower half", () => {
    // Set up a translated post-flatten door where the lower half has the
    // legacy-table defaults (hinge=right, powered=false) and the upper half
    // has the real hinge=left.
    const lower = new Block(
      new BlockPos(0, 0, 0),
      new BlockState({
        Name: "minecraft:oak_door",
        Properties: { half: "lower", facing: "south", open: "true", hinge: "right", powered: "false" },
      }),
    );
    const upper = new Block(
      new BlockPos(0, 1, 0),
      new BlockState({
        Name: "minecraft:oak_door",
        Properties: { half: "upper", facing: "east", open: "false", hinge: "left", powered: "true" },
      }),
    );
    const matrix = new Map<string, Block>([
      [posKey(lower.pos), lower],
      [posKey(upper.pos), upper],
    ]);

    fixupDoors(matrix);

    const fixedLower = matrix.get(posKey(lower.pos))!;
    const fixedUpper = matrix.get(posKey(upper.pos))!;

    // Lower picked up real hinge + powered from upper.
    expect(fixedLower.state.Properties.get("hinge")).toBe("left");
    expect(fixedLower.state.Properties.get("powered")).toBe("true");
    // Lower's own facing + open untouched.
    expect(fixedLower.state.Properties.get("facing")).toBe("south");
    expect(fixedLower.state.Properties.get("open")).toBe("true");

    // Upper picked up real facing + open from lower.
    expect(fixedUpper.state.Properties.get("facing")).toBe("south");
    expect(fixedUpper.state.Properties.get("open")).toBe("true");
    // Upper's own hinge + powered untouched.
    expect(fixedUpper.state.Properties.get("hinge")).toBe("left");
    expect(fixedUpper.state.Properties.get("powered")).toBe("true");
  });

  it("leaves blocks alone when the neighbor is not the matching door half", () => {
    const lower = new Block(
      new BlockPos(0, 0, 0),
      new BlockState({
        Name: "minecraft:oak_door",
        Properties: { half: "lower", facing: "south", open: "false", hinge: "right", powered: "false" },
      }),
    );
    const matrix = new Map([[posKey(lower.pos), lower]]);

    fixupDoors(matrix);

    expect(matrix.get(posKey(lower.pos))!.state.Properties.get("hinge")).toBe("right");
  });

  it("end-to-end: a 1.12 door at metadata (south+open, right-hinge) translates correctly", () => {
    // 1.12 wooden_door id=64. Lower meta=5 = facing=south + open; upper meta=9 = hinge=right.
    // Use the Forge-named pre-flatten form (what BG0 would emit).
    const lower = new Block(
      new BlockPos(0, 0, 0),
      new BlockState({
        Name: "minecraft:wooden_door",
        Properties: { facing: "south", half: "lower", open: "true", hinge: "left", powered: "false" },
      }),
    );
    const upper = new Block(
      new BlockPos(0, 1, 0),
      new BlockState({
        Name: "minecraft:wooden_door",
        Properties: { facing: "north", half: "upper", open: "false", hinge: "right", powered: "false" },
      }),
    );
    const matrix = new Map<string, Block>([
      [posKey(lower.pos), lower],
      [posKey(upper.pos), upper],
    ]);

    const mapper = new MinecraftVersionMapper(
      matrix,
      MinecraftVersionMapper.getVersion("1.12.2"),
    );
    const out = new Map<string, Block>();
    for (const [k, b] of matrix) {
      out.set(k, mapper.mapBlock(b, MinecraftVersionMapper.getVersion("1.20.1")));
    }
    fixupDoors(out);

    const fixedLower = out.get(posKey(lower.pos))!;
    const fixedUpper = out.get(posKey(upper.pos))!;

    expect(fixedLower.state.Name).toBe("minecraft:oak_door");
    expect(fixedUpper.state.Name).toBe("minecraft:oak_door");
    // Both halves agree on hinge & facing & open.
    expect(fixedLower.state.Properties.get("hinge")).toBe(fixedUpper.state.Properties.get("hinge"));
    expect(fixedLower.state.Properties.get("facing")).toBe(fixedUpper.state.Properties.get("facing"));
    expect(fixedLower.state.Properties.get("open")).toBe(fixedUpper.state.Properties.get("open"));
    // facing came from the lower's real metadata (south).
    expect(fixedLower.state.Properties.get("facing")).toBe("south");
    expect(fixedLower.state.Properties.get("open")).toBe("true");
    // hinge came from the upper's real metadata (right).
    expect(fixedLower.state.Properties.get("hinge")).toBe("right");
  });
});
