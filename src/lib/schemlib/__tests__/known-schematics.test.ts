import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, beforeAll } from "vitest";

import { BlockPos } from "../blocks";
import { AbstractRegion, AbstractSchematic } from "../schematic-formats/abstract";
import { LitematicSchematic } from "../schematic-formats/litematic";
import { StructureSchematic } from "../schematic-formats/structure";
import {
  BuildingGadgetsV0Schematic,
  BuildingGadgetsV1Schematic,
  BuildingGadgetsV2Schematic,
} from "../schematic-formats/building-gadgets";
import { SpongeSchematicV1, SpongeSchematicV2, SpongeSchematicV3 } from "../schematic-formats/sponge";

// ── Fixtures ───────────────────────────────────────────────────────────────

type SchematicCtor = typeof AbstractSchematic & {
  new (...args: never[]): AbstractSchematic;
  schematicLoad(obj: string | Uint8Array): AbstractSchematic;
  getDefaultExtension(): string;
  getDefaultVersion(): import("../schematic-formats/version-mapping").MinecraftVersion;
  fromSchematic(
    schematic: AbstractSchematic,
    targetVersion: import("../schematic-formats/version-mapping").MinecraftVersion | null,
  ): AbstractSchematic;
};

const schematics: Array<[string, SchematicCtor]> = [
  ["one_stone_block.litematic", LitematicSchematic as unknown as SchematicCtor],
  ["one_stone_block.nbt", StructureSchematic as unknown as SchematicCtor],
  ["one_stone_block_bg0.txt", BuildingGadgetsV0Schematic as unknown as SchematicCtor],
  ["one_stone_block_bg1.txt", BuildingGadgetsV1Schematic as unknown as SchematicCtor],
  ["one_stone_block_bg2.txt", BuildingGadgetsV2Schematic as unknown as SchematicCtor],
  ["one_stone_block_v1.schem", SpongeSchematicV1 as unknown as SchematicCtor],
  ["one_stone_block_v2.schem", SpongeSchematicV2 as unknown as SchematicCtor],
  ["one_stone_block_v3.schem", SpongeSchematicV3 as unknown as SchematicCtor],
];

// Conversion targets exclude BuildingGadgetsV0Schematic (matches Python's
// `target_classes = ... if target_class is not BuildingGadgetsV0Schematic`).
const targetClasses: SchematicCtor[] = schematics
  .map(([, cls]) => cls)
  .filter((cls) => cls !== (BuildingGadgetsV0Schematic as unknown as SchematicCtor));

const fixturePath = (filename: string): string =>
  path.resolve(__dirname, "../../__tests__/fixtures", filename);

const loadBytes = (filename: string): Uint8Array =>
  new Uint8Array(readFileSync(fixturePath(filename)));

// Targets whose fromSchematic is a stub that throws "not implemented".
const NOT_IMPLEMENTED_TARGETS = new Set<SchematicCtor>([
  BuildingGadgetsV1Schematic as unknown as SchematicCtor,
  BuildingGadgetsV2Schematic as unknown as SchematicCtor,
]);

// ── Per-fixture suites ────────────────────────────────────────────────────

for (const [filename, schematicType] of schematics) {
  describe(`schematic: ${filename}`, () => {
    let schematic: AbstractSchematic;

    beforeAll(() => {
      const bytes = loadBytes(filename);
      schematic = schematicType.schematicLoad(bytes);
    });

    it("loads as an instance of the right class", () => {
      expect(schematic).toBeInstanceOf(schematicType);
    });

    it("get_metadata matches author/description when present", () => {
      const metadata = schematic.getMetadata();
      if ("author" in metadata) {
        expect(metadata.author).toBe("Steve McMaster");
      }
      if ("description" in metadata) {
        expect(metadata.description).toBe("stone block schematic for testing");
      }
    });

    it("get_default_extension matches the fixture's extension", () => {
      const ext = filename.split(".").pop()!;
      expect(schematicType.getDefaultExtension()).toBe(ext);
    });

    it("get_minecraft_version returns a Java MinecraftVersion", () => {
      const v = schematic.getMinecraftVersion();
      expect(v).toBeDefined();
      expect(v.platform).toBe("java");
      expect(Array.isArray(v.versionNumber)).toBe(true);
      expect(v.versionNumber.length).toBe(3);
    });

    it("has exactly one region", () => {
      expect(schematic.getRegions().length).toBe(1);
    });

    it("region is an AbstractRegion", () => {
      expect(schematic.getRegions()[0]).toBeInstanceOf(AbstractRegion);
    });

    it("region origin is at the world origin", () => {
      expect(schematic.getRegions()[0].getOrigin().equals(BlockPos.ORIGIN)).toBe(true);
    });

    it("region has one stone block", () => {
      const blocks = schematic.getRegions()[0].getBlocks();
      expect(blocks.length).toBe(1);
      expect(blocks[0].state.Name).toBe("minecraft:stone");
    });

    it("region size is (1, 1, 1)", () => {
      expect(schematic.getRegions()[0].getSize()).toEqual([1, 1, 1]);
    });

    it("region bounding box is (ORIGIN, ORIGIN)", () => {
      const [a, b] = schematic.getRegions()[0].getBoundingBox();
      expect(a.equals(BlockPos.ORIGIN)).toBe(true);
      expect(b.equals(BlockPos.ORIGIN)).toBe(true);
    });

    // ── Conversion ────────────────────────────────────────────────────────
    for (const targetClass of targetClasses) {
      const targetName = targetClass.name;

      if (NOT_IMPLEMENTED_TARGETS.has(targetClass)) {
        // BG v1 / v2 raise NotImplementedError; skip them as conversion
        // targets (matches Python intent).
        it.skip(`converts to ${targetName} (skipped: from_schematic not implemented)`, () => {});
        continue;
      }

      it(`converts to ${targetName}`, () => {
        if (targetClass === (schematicType as unknown as SchematicCtor)) {
          // skip self-conversion (no-op, matches `if target is self: return`).
          return;
        }
        const converted = targetClass.fromSchematic(schematic, targetClass.getDefaultVersion());

        expect(converted.getRegion(0).getSize()).toEqual(schematic.getRegion(0).getSize());

        const [origA, origB] = schematic.getRegion(0).getBoundingBox();
        const [convA, convB] = converted.getRegion(0).getBoundingBox();
        expect(convA.equals(origA)).toBe(true);
        expect(convB.equals(origB)).toBe(true);

        const blocks = schematic.getRegions()[0].getBlocks();
        expect(blocks.length).toBe(1);
        expect(blocks[0].state.Name).toBe("minecraft:stone");
      });
    }
  });
}
