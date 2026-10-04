import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectSchematicType } from "../schemlib/schematic-formats";
import {
  SchematicTooLargeError,
  checkDeclaredVolume,
} from "../schemlib/schematic-formats/abstract";
import { parseSchematic } from "../convert";
import { oversizedSchematics } from "./oversized-schematics";

const FIXTURES = path.join(__dirname, "fixtures");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkDeclaredVolume", () => {
  it("allows exactly maxBlocks and rejects one more, summing regions", () => {
    const sizes: [number, number, number][] = [
      [10, 10, 10],
      [-10, 10, 10],
    ];
    expect(() => checkDeclaredVolume(sizes, { maxBlocks: 2000 })).not.toThrow();
    expect(() => checkDeclaredVolume(sizes, { maxBlocks: 1999 })).toThrow(
      SchematicTooLargeError,
    );
  });

  it("does nothing without a cap", () => {
    expect(() => checkDeclaredVolume([[1e6, 1e6, 1e6]], {})).not.toThrow();
    expect(() =>
      checkDeclaredVolume([[1e6, 1e6, 1e6]], undefined),
    ).not.toThrow();
  });
});

describe("parseSchematic with maxBlocks", () => {
  for (const file of oversizedSchematics()) {
    describe(file.format, () => {
      it("is detected as that format", () => {
        expect(detectSchematicType(file.bytes)).toBe(file.format);
      });

      it("stops on the declared size without decoding blocks", () => {
        const decode = vi.spyOn(file.region.prototype, "getBlockMatrix");
        const result = parseSchematic(file.bytes, { maxBlocks: 2_000_000 });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.cause).toBeInstanceOf(SchematicTooLargeError);
        expect(result.cause).toMatchObject({
          blocks: file.declaredBlocks,
          maxBlocks: 2_000_000,
        });
        expect(result.error).toBe(
          `This schematic declares ${file.declaredBlocks.toLocaleString("en-US")} blocks, more than the 2,000,000 allowed.`,
        );
        expect(decode).not.toHaveBeenCalled();
      });

      if (file.uncappedError !== undefined) {
        const uncappedError = file.uncappedError;
        it("decodes its block data while loading when there is no cap", () => {
          const result = parseSchematic(file.bytes);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.cause).not.toBeInstanceOf(SchematicTooLargeError);
          expect(result.error).toContain(uncappedError);
        });
      }
    });
  }

  it("parses real files under the cap as before", () => {
    const bytes = new Uint8Array(
      readFileSync(path.join(FIXTURES, "one_stone_block.nbt")),
    );
    const capped = parseSchematic(bytes, { maxBlocks: 1 });
    const uncapped = parseSchematic(bytes);
    expect(capped).toEqual(uncapped);
    expect(capped.ok).toBe(true);
  });
});
