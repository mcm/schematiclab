import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { convertSchematic } from "../convert";
import { detectSchematicType } from "../schemlib/schematic-formats";
import { SpongeSchematicV2 } from "../schemlib/schematic-formats/sponge";
import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/version-mapping";

const fixturePath = (filename: string): string =>
  path.resolve(__dirname, "../../../../schemlib/tests/schematics/", filename);

const loadBytes = (filename: string): Uint8Array =>
  new Uint8Array(readFileSync(fixturePath(filename)));

describe("convertSchematic", () => {
  it("converts a Litematic to Sponge v2", () => {
    const input = loadBytes("one_stone_block.litematic");

    const result = convertSchematic({
      bytes: input,
      inputFilename: "one_stone_block.litematic",
      outputFormat: "Sponge[v2]",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.filename).toBe("one_stone_block.schem");
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);

    // Round-trip: the output should detect as Sponge v2.
    expect(detectSchematicType(result.bytes)).toBe("Sponge[v2]");
  });

  it("returns a failure result when input cannot be detected", () => {
    const garbage = new TextEncoder().encode("not a schematic, just text");

    const result = convertSchematic({
      bytes: garbage,
      inputFilename: "garbage.bin",
      outputFormat: "Sponge[v2]",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/detect/i);
    expect(result.cause).toBeDefined();
  });

  it("stamps the requested targetVersion's data version on the output", () => {
    const input = loadBytes("one_stone_block.litematic");
    const targetVersion = "1.20.1";
    const expectedDataVersion = KNOWN_VERSIONS[targetVersion].dataVersion;

    const result = convertSchematic({
      bytes: input,
      inputFilename: "one_stone_block.litematic",
      outputFormat: "Sponge[v2]",
      targetVersion,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reloaded = SpongeSchematicV2.schematicLoad(result.bytes);
    expect(reloaded.DataVersion).toBe(expectedDataVersion);
  });

  it("derives the output filename from the input basename and target extension", () => {
    const input = loadBytes("one_stone_block.litematic");

    const result = convertSchematic({
      bytes: input,
      inputFilename: "/some/path/My Castle.litematic",
      outputFormat: "Structure",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("My Castle.nbt");
  });
});
