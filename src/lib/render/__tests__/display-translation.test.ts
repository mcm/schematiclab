import { describe, expect, it } from "vitest";

import vanillaBlockstates from "../../../../public/minecraft-assets/blockstates.json";
import type {
  ParsedSchematicPaletteEntry,
  ParsedSchematicProjection,
} from "../../convert";
import { ANCHOR_VERSIONS } from "../../schemlib/data/types";
import { KNOWN_VERSIONS } from "../../schemlib/schematic-formats/version-mapping";
import {
  BUNDLE_MINECRAFT_VERSION,
  minecraftVersionFromMcmeta,
  toDisplayProjection,
} from "../display-translation";

function entry(
  blockId: string,
  properties: Record<string, string> = {},
): ParsedSchematicPaletteEntry {
  // Sorted, like `BlockState.toString()`.
  const props = Object.keys(properties)
    .sort()
    .map((k) => `${k}=${properties[k]}`)
    .join(",");
  return {
    blockState: props === "" ? blockId : `${blockId}[${props}]`,
    blockId,
    properties,
    count: 1,
  };
}

function projection(
  version: string,
  palette: ParsedSchematicPaletteEntry[],
): ParsedSchematicProjection {
  return {
    name: "test",
    inputFormat: "Sponge[v2]",
    minecraftVersion: KNOWN_VERSIONS[version],
    totalBlocks: palette.length,
    palette,
    regions: [
      {
        origin: [0, 0, 0],
        size: [palette.length, 1, 1],
        blocks: palette.map((_, i) => ({ pos: [i, 0, 0], paletteIndex: i })),
      },
    ],
  } as unknown as ParsedSchematicProjection;
}

describe("minecraftVersionFromMcmeta", () => {
  it("reads releases, snapshots and pre-releases as their release line", () => {
    expect(
      minecraftVersionFromMcmeta({ id: "26.2-snapshot-8", data_version: 4893 }),
    ).toEqual({
      platform: "java",
      versionNumber: [26, 2, 0],
      dataVersion: 4893,
    });
    expect(
      minecraftVersionFromMcmeta({ id: "1.21.5-rc-1", data_version: 4323 })
        .versionNumber,
    ).toEqual([1, 21, 5]);
  });

  it("rejects ids without a release number", () => {
    expect(() =>
      minecraftVersionFromMcmeta({ id: "24w14a", data_version: 3827 }),
    ).toThrow("24w14a");
  });

  // Regenerating the bundle for a version newer than the translation data
  // leaves blocks renamed in between unmapped: add an anchor to
  // ANCHOR_VERSIONS and run `pnpm gen:translations`.
  it("is covered by the translation anchors", () => {
    const [major, minor] = BUNDLE_MINECRAFT_VERSION.versionNumber;
    const anchorLines = ANCHOR_VERSIONS.map((anchor) =>
      anchor.split(".").slice(0, 2).join("."),
    );
    expect(anchorLines).toContain(`${major}.${minor}`);
  });
});

describe("toDisplayProjection", () => {
  it("renames blocks to their names in the bundle's version", () => {
    // `grass_path` became `dirt_path` in 1.17, `grass` `short_grass` in 1.20.3.
    const input = projection("1.16.5", [
      entry("minecraft:grass"),
      entry("minecraft:grass_path"),
      entry("minecraft:stone"),
    ]);
    const display = toDisplayProjection(input);
    expect(display.palette.map((e) => e.blockId)).toEqual([
      "minecraft:short_grass",
      "minecraft:dirt_path",
      "minecraft:stone",
    ]);
    // Only the palette is replaced; placements still index into it.
    expect(display.regions).toBe(input.regions);
    for (const e of display.palette) {
      expect(e.blockId.replace(/^minecraft:/, "") in vanillaBlockstates).toBe(
        true,
      );
    }
  });

  it("applies renames from 1.21+ drops", () => {
    const display = toDisplayProjection(
      projection("1.21.4", [entry("minecraft:chain", { axis: "x" })]),
    );
    expect(display.palette[0]?.blockId).toBe("minecraft:iron_chain");
  });

  it("flattens Forge 1.12 block states", () => {
    const display = toDisplayProjection(
      projection("1.12.2", [entry("minecraft:planks", { variant: "spruce" })]),
    );
    expect(display.palette[0]).toMatchObject({
      blockId: "minecraft:spruce_planks",
      properties: {},
    });
  });

  it("passes mod blocks through", () => {
    const modded = entry("create:andesite_casing");
    const display = toDisplayProjection(
      projection("1.12.2", [
        modded,
        entry("minecraft:planks", { variant: "oak" }),
      ]),
    );
    expect(display.palette[0]).toBe(modded);
  });

  it("returns the input when nothing needs translating", () => {
    const input = projection("1.21.4", [entry("minecraft:stone")]);
    expect(toDisplayProjection(input)).toBe(input);
  });
});
