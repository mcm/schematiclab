import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSchematic } from "../../convert";
import { decodePng } from "../../render/block-appearance";
import {
  buildShapeProjection,
  MAX_SHAPE_BLOCKS,
  type ShapeSpec,
} from "../../shapes/generate";
import { generateShapeTool } from "../generate-shape";
import { BLOB_NOT_CONFIGURED_MESSAGE } from "../output";
import { createMcpRequestHandler } from "../server";
import { runTool } from "../tools";
import type { McpDeps } from "../types";
import { createFakeBlob, type FakeBlob } from "./fake-blob";

const NOW = new Date("2026-10-04T12:00:00Z");

function makeDeps(
  overrides: Partial<McpDeps> = {},
): McpDeps & { blob: FakeBlob } {
  return {
    fetch: vi.fn(() => Promise.reject(new Error("no network"))) as never,
    now: () => NOW,
    blob: createFakeBlob(() => NOW),
    blobStoreId: "store_store",
    ...overrides,
  } as McpDeps & { blob: FakeBlob };
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

interface GenerateData {
  url: string;
  filename: string;
  bytes: number;
  expires_at: string;
  format: string;
  minecraft_version: string;
  size: number[];
  block_count: number;
  block_state: string;
}

const glassEllipsoid = {
  shape: "ellipsoid",
  width: 9,
  height: 7,
  depth: 9,
  hollow: true,
  material: "glass",
  version: "1.20.1",
  output_format: "Sponge[v2]",
};

// The error `generate.ts` reports for `spec`.
function generateError(spec: ShapeSpec): string {
  const built = buildShapeProjection(spec);
  if (built.ok) throw new Error("expected the shape to fail");
  return built.error;
}

describe("generate_shape", () => {
  it("writes a hollow glass ellipsoid for 1.20.1 as Sponge", async () => {
    const deps = makeDeps();
    const result = await runTool(generateShapeTool, glassEllipsoid, deps);
    expect(result.isError).toBeFalsy();
    expect(result.content.map((c) => c.type)).toEqual(["text"]);
    const data = result.structuredContent as unknown as GenerateData;
    expect(JSON.parse(text(result))).toEqual(data);

    const expected = buildShapeProjection({
      shape: "ellipsoid",
      width: 9,
      height: 7,
      depth: 9,
      hollow: true,
      material: "glass",
      versionId: "1.20.1",
    });
    if (!expected.ok) throw new Error(expected.error);
    expect(data).toMatchObject({
      filename: "glass_hollow_ellipsoid_9x7x9.schem",
      format: "Sponge[v2]",
      minecraft_version: "1.20.1",
      size: [9, 7, 9],
      block_count: expected.projection.totalBlocks,
      block_state: "minecraft:glass",
      expires_at: "2026-10-05T12:00:00.000Z",
    });
    // Hollow: fewer blocks than the solid ellipsoid.
    const solid = buildShapeProjection({
      shape: "ellipsoid",
      width: 9,
      height: 7,
      depth: 9,
      material: "glass",
      versionId: "1.20.1",
    });
    expect(solid.ok && solid.projection.totalBlocks).toBeGreaterThan(
      data.block_count,
    );
    expect(data.url).toMatch(
      /^https:\/\/store\.private\.blob\.vercel-storage\.com\/mcp\/glass_hollow_ellipsoid_9x7x9-rnd1\.schem\?/,
    );

    const [[pathname, stored]] = [...deps.blob.objects];
    expect(pathname).toBe("mcp/glass_hollow_ellipsoid_9x7x9-rnd1.schem");
    expect(data.bytes).toBe(stored.body.length);
    const reparsed = parseSchematic(stored.body);
    if (!reparsed.ok) throw new Error(reparsed.error);
    expect(reparsed.schematic.inputFormat).toBe("Sponge[v2]");
    expect(reparsed.schematic.minecraftVersion.versionNumber).toEqual([
      1, 20, 1,
    ]);
    const blocks = reparsed.schematic.palette.filter(
      (e) => e.blockId !== "minecraft:air",
    );
    expect(blocks.map((e) => [e.blockState, e.count])).toEqual([
      ["minecraft:glass", data.block_count],
    ]);
  });

  it("writes minecraft:granite for 1.12.2 as its Forge 1.12 state", async () => {
    const deps = makeDeps();
    const result = await runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 2,
        height: 3,
        depth: 4,
        material: "minecraft:granite",
        version: "1.12.2",
        output_format: "Litematic",
      },
      deps,
    );
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as unknown as GenerateData;
    expect(data).toMatchObject({
      filename: "granite_cuboid_2x3x4.litematic",
      minecraft_version: "1.12.2",
      block_count: 24,
      block_state: "minecraft:stone[variant=granite]",
    });
    const [stored] = [...deps.blob.objects.values()];
    const reparsed = parseSchematic(stored.body);
    if (!reparsed.ok) throw new Error(reparsed.error);
    expect(reparsed.schematic.minecraftVersion.versionNumber).toEqual([
      1, 12, 2,
    ]);
    const blocks = reparsed.schematic.palette.filter(
      (e) => e.blockId !== "minecraft:air",
    );
    expect(blocks.map((e) => [e.blockState, e.count])).toEqual([
      ["minecraft:stone[variant=granite]", 24],
    ]);
  });

  it("returns the PNG when render is true", async () => {
    const result = await runTool(
      generateShapeTool,
      { ...glassEllipsoid, render: true },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content.map((c) => c.type)).toEqual(["text", "image"]);
    const image = result.content[1];
    if (image.type !== "image") throw new Error("expected image content");
    expect(image.mimeType).toBe("image/png");
    const png = decodePng(new Uint8Array(Buffer.from(image.data, "base64")));
    expect(png).not.toBeNull();
  });

  it("returns the Shape Generator's errors word for word", async () => {
    const base = {
      shape: "cuboid",
      width: 4,
      height: 4,
      depth: 4,
      material: "stone",
      version: "1.20.1",
      output_format: "Litematic",
    } as const;
    const spec: ShapeSpec = {
      shape: "cuboid",
      width: 4,
      height: 4,
      depth: 4,
      material: "stone",
      versionId: "1.20.1",
    };
    const cases: [Record<string, unknown>, ShapeSpec][] = [
      // Bad material.
      [
        { ...base, material: "not a block!" },
        { ...spec, material: "not a block!" },
      ],
      [
        { ...base, material: "stone[facing]" },
        { ...spec, material: "stone[facing]" },
      ],
      // Block missing in the version.
      [
        { ...base, material: "cherry_planks", version: "1.18.2" },
        { ...spec, material: "cherry_planks", versionId: "1.18.2" },
      ],
      // Over MAX_SHAPE_BLOCKS.
      [
        { ...base, width: 256, height: 256, depth: 256 },
        { ...spec, width: 256, height: 256, depth: 256 },
      ],
      // Out-of-range dimensions and thickness.
      [
        { ...base, width: 0 },
        { ...spec, width: 0 },
      ],
      [
        { ...base, hollow: true, thickness: 500 },
        { ...spec, hollow: true, thickness: 500 },
      ],
    ];
    for (const [args, failing] of cases) {
      const deps = makeDeps();
      const result = await runTool(generateShapeTool, args, deps);
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(generateError(failing));
      expect(deps.blob.objects.size).toBe(0);
    }
    expect(
      generateError({ ...spec, width: 256, height: 256, depth: 256 }),
    ).toContain(MAX_SHAPE_BLOCKS.toLocaleString("en-US"));
    expect(
      generateError({
        ...spec,
        material: "cherry_planks",
        versionId: "1.18.2",
      }),
    ).toBe("minecraft:cherry_planks isn't a block in Minecraft 1.18.2.");
  });

  it("rejects an unknown version and a format outside the version's range", async () => {
    const unknown = await runTool(
      generateShapeTool,
      { ...glassEllipsoid, version: "constructor" },
      makeDeps(),
    );
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toBe(
      "Unknown Minecraft version 'constructor'. Call list_versions for the supported versions.",
    );

    const outOfRange = await runTool(
      generateShapeTool,
      {
        ...glassEllipsoid,
        output_format: "BuildingGadgets2[1.20+]",
        version: "1.16.5",
      },
      makeDeps(),
    );
    expect(outOfRange.isError).toBe(true);
    expect(text(outOfRange)).toMatch(/BuildingGadgets2/);
  });

  it("is a tool error when no Blob store is configured", async () => {
    const result = await runTool(
      generateShapeTool,
      glassEllipsoid,
      makeDeps({ blob: null }),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(BLOB_NOT_CONFIGURED_MESSAGE);
  });

  it("fails without a Blob store before building or rendering the shape", async () => {
    // An unknown material would otherwise be the error.
    const result = await runTool(
      generateShapeTool,
      { ...glassEllipsoid, material: "minecraft:not_a_block", render: true },
      makeDeps({ blob: null }),
    );
    expect(text(result)).toBe(BLOB_NOT_CONFIGURED_MESSAGE);
  });

  describe("over MCP", () => {
    const clients: Client[] = [];
    afterEach(async () => {
      await Promise.all(clients.splice(0).map((c) => c.close()));
    });

    it("lists the tool and returns results that pass the SDK's validation", async () => {
      const handler = createMcpRequestHandler(makeDeps());
      const client = new Client({ name: "test", version: "0.0.0" });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
          fetch: (input, init) => handler(new Request(input, init)),
        }),
      );
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("generate_shape");

      const result = await client.callTool({
        name: "generate_shape",
        arguments: { ...glassEllipsoid, render: true },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        format: "Sponge[v2]",
        block_state: "minecraft:glass",
      });
      const content = result.content as { type: string }[];
      expect(content.map((c) => c.type)).toEqual(["text", "image"]);

      const failed = await client.callTool({
        name: "generate_shape",
        arguments: {
          ...glassEllipsoid,
          material: "cherry_planks",
          version: "1.18.2",
        },
      });
      expect(failed.isError).toBe(true);
    });
  });
});
