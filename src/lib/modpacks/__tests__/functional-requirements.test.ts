// End-to-end checks of the modpack epic's functional requirements (SCHEM-144),
// one `describe` per FR. Packs are synthetic: an instance folder of fflate
// jars run through the real extraction (and the CLI itself for FR-1 to FR-3),
// plus hand-built packs with camo blocks, all published into the fake Blob
// store with `publishModpack`. Details are tested next to their code; these
// tests check each requirement as a whole.

import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { gunzipSync, strToU8, zipSync } from "fflate";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { clearBlockDataCache } from "../../blockdata/load";
import { extractCamoSlots } from "../../camo/extract";
import { CAMO_WRITE_VERSIONS, isCamoWritable } from "../../camo/write-versions";
import { parseSchematic, type ParsedSchematicProjection } from "../../convert";
import { checkBuildTool, compileBuildTool } from "../../mcp/build-tools";
import { cleanupExpiredOutputs } from "../../mcp/cleanup";
import { generateShapeTool } from "../../mcp/generate-shape";
import { listModpacksTool } from "../../mcp/list-modpacks";
import { OUTPUT_PREFIX } from "../../mcp/output";
import {
  convertSchematicTool,
  inspectSchematicTool,
  renderSchematicTool,
} from "../../mcp/schematic-tools";
import { searchBlocksTool, suggestPaletteTool } from "../../mcp/block-tools";
import { createMcpRequestHandler } from "../../mcp/server";
import { modpackCamoFrames } from "../../mcp/camo-options";
import { modpackRenderSource } from "../../mcp/render";
import { showBlocksTool } from "../../mcp/show-blocks";
import { resolveToolBlocks } from "../../mcp/tool-blocks";
import { runTool, TOOLS } from "../../mcp/tools";
import type { McpDeps } from "../../mcp/types";
import { createFakeBlob, type FakeBlob } from "../../mcp/__tests__/fake-blob";
import { blockShapeOfKind } from "../../render/block-shapes";
import {
  decodePng,
  srgbToOklab,
  type RgbaImage,
} from "../../render/block-appearance";
import { fallbackBlockColor, oklabToHex } from "../../render/static-views";
import { vanillaDescriptorSources } from "../appearance";
import { classifyModBlock } from "../classify";
import {
  extractModpack,
  MAX_MOD_JAR_BYTES,
  type ModpackExtraction,
  type ModpackSource,
} from "../extract";
import { readInstanceFolder } from "../instance-folder";
import {
  MOD_FILES_PREFIX,
  modFileSwatchesPath,
  modpackDataPath,
  modpackIndexPath,
  MODPACKS_PREFIX,
} from "../paths";
import { encodeRgbaPng } from "../png";
import { publishModpack, type ModpackStore } from "../publish";
import { clearModpackCache, loadModpackIndex } from "../reader";
import { parseModpackRef } from "../ref";
import {
  MOD_BLOCK_KINDS,
  MOD_STATUSES,
  MODPACK_FORMAT_VERSION,
  modpackDataSchema,
  type ModpackBlock,
  type ModpackData,
  type ModpackIndexVersion,
} from "../schema";

const ROOT = path.join(__dirname, "../../../..");
const NOW = new Date("2026-10-06T12:00:00.000Z");

// 1.21.4 blocks stand in for every version's block list.
const BLOCKS_JSON = readFileSync(
  path.join(
    ROOT,
    "src/lib/mcp/__tests__/fixtures/palette-mcmeta-1.21.4-blocks.json",
  ),
  "utf8",
);
const fetchStub = vi.fn(async (input: RequestInfo | URL) =>
  /misode\/mcmeta@[^/]+-summary\/blocks\/data\.min\.json$/.test(String(input))
    ? new Response(BLOCKS_JSON, { status: 200 })
    : new Response("not found", { status: 404 }),
);

// ── Synthetic jars and instance folder ─────────────────────────────────────

const json = (value: unknown) => strToU8(JSON.stringify(value));

function solidPng(rgba: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return encodeRgbaPng(16, 16, data);
}

/** Brass Things: a cube, a stair and a gizmo of custom elements. */
function brassJar(): Uint8Array {
  const stairVariants: Record<string, unknown> = {};
  for (const facing of ["east", "north", "south", "west"]) {
    for (const half of ["bottom", "top"]) {
      for (const shape of ["straight", "inner_left", "outer_left"]) {
        stairVariants[`facing=${facing},half=${half},shape=${shape}`] = {
          model: `brass:block/brass_stairs${shape === "straight" ? "" : `_${shape.split("_")[0]}`}`,
        };
      }
    }
  }
  const stairModel = (parent: string) => ({
    parent,
    textures: {
      bottom: "brass:block/brass_block",
      top: "brass:block/brass_block",
      side: "brass:block/brass_block",
    },
  });
  return zipSync({
    "assets/brass/blockstates/brass_block.json": json({
      variants: { "": { model: "brass:block/brass_block" } },
    }),
    "assets/brass/blockstates/brass_stairs.json": json({
      variants: stairVariants,
    }),
    "assets/brass/blockstates/brass_gizmo.json": json({
      variants: { "": { model: "brass:block/brass_gizmo" } },
    }),
    "assets/brass/models/block/brass_block.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "brass:block/brass_block" },
    }),
    "assets/brass/models/block/brass_stairs.json": json(
      stairModel("minecraft:block/stairs"),
    ),
    "assets/brass/models/block/brass_stairs_inner.json": json(
      stairModel("minecraft:block/inner_stairs"),
    ),
    "assets/brass/models/block/brass_stairs_outer.json": json(
      stairModel("minecraft:block/outer_stairs"),
    ),
    "assets/brass/models/block/brass_gizmo.json": json({
      textures: { all: "brass:block/brass_block" },
      elements: [
        {
          from: [3, 0, 3],
          to: [13, 9, 13],
          faces: {
            up: { texture: "#all" },
            north: { texture: "#all" },
          },
        },
      ],
    }),
    "assets/brass/textures/block/brass_block.png": solidPng([
      200, 140, 40, 255,
    ]),
    "assets/brass/lang/en_us.json": json({
      "block.brass.brass_block": "Block of Brass",
    }),
  });
}

/** A library mod with no blocks. */
function libraryJar(): Uint8Array {
  return zipSync({
    "META-INF/neoforge.mods.toml": strToU8('modId="lib"\n'),
    "assets/lib/lang/en_us.json": json({ "item.lib.thing": "Thing" }),
  });
}

function addon(addonID: number, name: string, fileId: number, file: string) {
  return {
    addonID,
    name,
    fileNameOnDisk: file,
    categorySection: { path: "mods" },
    isEnabled: true,
    installedFile: { id: fileId, fileName: file, gameVersion: ["1.21.1"] },
  };
}

function writeInstance(dir: string): string {
  const instance = path.join(dir, "instance");
  mkdirSync(path.join(instance, "mods"), { recursive: true });
  mkdirSync(path.join(instance, "kubejs", "startup_scripts"), {
    recursive: true,
  });
  writeFileSync(path.join(instance, "mods", "brass-1.0.jar"), brassJar());
  writeFileSync(path.join(instance, "mods", "lib-1.0.jar"), libraryJar());
  writeFileSync(
    path.join(instance, "minecraftinstance.json"),
    JSON.stringify({
      name: "Brass Test Pack",
      gameVersion: "1.21.1",
      baseModLoader: { name: "neoforge-21.1.77", type: 6 },
      installedModpack: { addonID: 9000, installedFile: { id: 777 } },
      manifest: { version: "1.2.3" },
      installedAddons: [
        addon(11, "Brass Things", 1111, "brass-1.0.jar"),
        addon(12, "Lib", 1212, "lib-1.0.jar"),
        addon(13, "Gone Mod", 1313, "gone-1.0.jar"),
      ],
    }),
  );
  return instance;
}

// Model and texture lookups only need the jar's own assets here.
const vanilla = vanillaDescriptorSources({
  models: JSON.parse(
    readFileSync(
      path.join(ROOT, "public/minecraft-assets/models.json"),
      "utf8",
    ),
  ) as Record<string, unknown>,
  atlas: { width: 1, height: 1, data: new Uint8Array(4) },
  uvs: {},
});

// ── Hand-built camo pack: "All the Mods 10" on 1.20.1 and 1.21.1 ──────────

function appearance(r: number, g: number, b: number) {
  const oklab = srgbToOklab(r, g, b);
  const hex = oklabToHex(oklab);
  return { hex, oklab, dominant: [{ hex, share: 1 }], variance: 0.1 };
}

const BRASS = appearance(200, 160, 70);

function block(
  id: string,
  mod: string,
  extra: Partial<ModpackBlock> = {},
): ModpackBlock {
  return {
    id,
    mod,
    displayName: id,
    properties: {},
    defaults: {},
    kind: "block",
    fullCube: true,
    ...extra,
  };
}

const STAIR_PROPERTIES = {
  facing: ["north", "south", "west", "east"],
  half: ["top", "bottom"],
  shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
  waterlogged: ["true", "false"],
};
const STAIR_DEFAULTS = {
  facing: "north",
  half: "bottom",
  shape: "straight",
  waterlogged: "false",
};

const ATM_BLOCKS: ModpackBlock[] = [
  block("create:brass_block", "cf-1", { appearance: BRASS }),
  block("create:brass_casing", "cf-1", {
    appearance: appearance(180, 130, 60),
  }),
  block("copycats:copycat_block", "cf-2", {
    appearance: appearance(150, 150, 150),
    camo: { slots: 1 },
  }),
  block("copycats:copycat_stairs", "cf-2", {
    properties: STAIR_PROPERTIES,
    defaults: STAIR_DEFAULTS,
    kind: "unknown",
    fullCube: false,
    appearance: appearance(150, 150, 150),
    camo: { slots: 1 },
  }),
].sort((a, b) => a.id.localeCompare(b.id));

function atmVersion(
  minecraftVersion: string,
  packFileId: number,
  displayVersion: string,
  uploadedAt: string,
): ModpackIndexVersion {
  return {
    key: `cf-${packFileId}`,
    packFileId,
    displayVersion,
    minecraftVersion,
    loader: "neoforge",
    modCount: 2,
    uploadedAt,
  };
}

const ATM_OLD = atmVersion("1.20.1", 100, "1.0", "2026-09-01T00:00:00.000Z");
const ATM_NEW = atmVersion("1.21.1", 200, "2.0", "2026-10-01T00:00:00.000Z");

function atmPack(version: ModpackIndexVersion): ModpackExtraction {
  const data: ModpackData = {
    formatVersion: MODPACK_FORMAT_VERSION,
    slug: "all-the-mods-10",
    name: "All the Mods 10",
    curseForgeProjectId: 925200,
    version,
    mods: [
      {
        key: "cf-1",
        name: "Create",
        curseForgeProjectId: 328085,
        curseForgeFileId: 1,
        fileName: "create.jar",
        namespaces: ["create"],
        status: "ok",
        hasSwatches: false,
      },
      {
        key: "cf-2",
        name: "Copycats+",
        curseForgeProjectId: 968398,
        curseForgeFileId: 2,
        fileName: "copycats.jar",
        namespaces: ["copycats"],
        status: "ok",
        hasSwatches: false,
      },
    ],
    blocks: ATM_BLOCKS,
    runtimeBlockSources: [],
  };
  return {
    data,
    swatches: new Map(),
    nestedJars: [],
    compatPacks: [],
    droppedCompatBlocks: [],
    warnings: [],
  };
}

// ── Fake Blob store and tool calls ─────────────────────────────────────────

/** `publishModpack`'s store, writing into the fake Blob store. */
function fakeBlobStore(blob: FakeBlob): ModpackStore {
  return {
    description: "fake Blob",
    readIndex() {
      clearModpackCache();
      return loadModpackIndex(blob);
    },
    exists: async (pathname) => blob.objects.has(pathname),
    async write(pathname, body) {
      blob.objects.set(pathname, { body, uploadedAt: NOW });
    },
  };
}

let tmp: string;
let instance: string;
let brass: ModpackExtraction;
let blob: FakeBlob;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "modpack-fr-"));
  instance = writeInstance(tmp);
  brass = await extractModpack(await readInstanceFolder(instance), {
    vanilla,
    now: () => NOW,
  });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  clearModpackCache();
  clearBlockDataCache();
  fetchStub.mockClear();
  blob = createFakeBlob(() => NOW);
  const store = fakeBlobStore(blob);
  for (const pack of [brass, atmPack(ATM_OLD), atmPack(ATM_NEW)]) {
    await publishModpack(store, pack);
  }
  // publishModpack's index reads fill the server's index cache.
  clearModpackCache();
  blob.calls.length = 0;
});

function makeDeps(): McpDeps {
  return { fetch: fetchStub as never, now: () => NOW, blob };
}

const BRASS_REF = "brass-test-pack";
const ATM = "all-the-mods-10";

function text(result: CallToolResult): string {
  const first = result.content.find((c) => c.type === "text");
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

async function call<T = Record<string, unknown>>(
  tool: (typeof TOOLS)[number],
  args: Record<string, unknown>,
): Promise<T> {
  const result = await runTool(
    tool as typeof searchBlocksTool,
    args,
    makeDeps(),
  );
  if (result.isError) throw new Error(text(result));
  return result.structuredContent as T;
}

async function callError(
  tool: (typeof TOOLS)[number],
  args: Record<string, unknown>,
): Promise<string> {
  const result = await runTool(
    tool as typeof searchBlocksTool,
    args,
    makeDeps(),
  );
  expect(result.isError).toBe(true);
  return text(result);
}

function imageOf(result: CallToolResult): RgbaImage {
  const image = result.content.find((c) => c.type === "image");
  if (image?.type !== "image") throw new Error("expected an image");
  const png = decodePng(new Uint8Array(Buffer.from(image.data, "base64")));
  if (!png) throw new Error("not a readable PNG");
  return png;
}

function hasColor(image: RgbaImage, hex: string): boolean {
  const want = parseInt(hex.slice(1), 16);
  for (let i = 0; i < image.data.length; i += 4) {
    const c =
      (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
    if (c === want) return true;
  }
  return false;
}

/** The output files tool calls wrote (everything outside the pack data). */
function takeOutputs(): Uint8Array[] {
  const outputs = [...blob.objects].filter(([p]) =>
    p.startsWith(OUTPUT_PREFIX),
  );
  for (const [p] of outputs) blob.objects.delete(p);
  return outputs.map(([, o]) => o.body);
}

function parsed(bytes: Uint8Array): ParsedSchematicProjection {
  const result = parseSchematic(bytes);
  if (!result.ok) throw new Error(result.error);
  return result.schematic;
}

/** A Sponge schematic of `blockIds` in a row, from generate_shape without a pack. */
async function schematicOf(blockIds: string[]): Promise<{
  base64: string;
  filename: string;
}> {
  const projection: ParsedSchematicProjection = {
    name: "fr",
    inputFormat: "Sponge[v2]",
    minecraftVersion: {
      platform: "java",
      versionNumber: [1, 21, 1],
      dataVersion: 3955,
    },
    totalBlocks: blockIds.length,
    palette: blockIds.map((blockId) => ({
      blockState: blockId,
      blockId,
      properties: {},
      count: 1,
    })),
    regions: [
      {
        origin: [0, 0, 0],
        size: [blockIds.length, 1, 1],
        blocks: blockIds.map((_, i) => ({
          pos: [i, 0, 0] as [number, number, number],
          paletteIndex: i,
        })),
        blockEntities: [],
      },
    ],
  };
  const { serializeSchematic } = await import("../../convert");
  const serialized = serializeSchematic({
    schematic: projection,
    inputFilename: "fr.json",
    outputFormat: "Sponge[v2]",
    targetVersion: "1.21.1",
  });
  if (!serialized.ok) throw new Error(serialized.error);
  return {
    base64: Buffer.from(serialized.bytes).toString("base64"),
    filename: serialized.filename,
  };
}

const run = promisify(execFile);

/** Runs `pnpm modpack:upload`'s script with node, as the package script does. */
function uploadCli(args: string[]) {
  return run(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "scripts/upload-modpack.mts",
      ...args,
    ],
    { cwd: ROOT, env: { ...process.env, CURSEFORGE_API_KEY: "" } },
  );
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) =>
      path
        .relative(dir, path.join(d.parentPath, d.name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}

// ── FR-1 to FR-5: the CLI and storage ──────────────────────────────────────

describe("FR-1: pnpm modpack:upload sources and output", () => {
  it("runs the upload script", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    );
    expect(pkg.scripts["modpack:upload"]).toBe(
      "node --experimental-strip-types scripts/upload-modpack.mts",
    );
  });

  it("refuses --instance with --curseforge, and neither", async () => {
    await expect(
      uploadCli([
        "--instance",
        instance,
        "--curseforge",
        "atm10",
        "--dry-run",
        "--out",
        tmp,
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "Pass either --instance or --curseforge, not both.",
      ),
    });
    await expect(uploadCli(["--dry-run", "--out", tmp])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Usage: pnpm modpack:upload"),
    });
  }, 60_000);

  it("writes an instance folder's pack under modpacks/ and mod-files/", async () => {
    const out = path.join(tmp, "dry-run");
    const { stdout } = await uploadCli([
      "--instance",
      instance,
      "--dry-run",
      "--out",
      out,
    ]);
    const files = filesUnder(out);
    expect(files).toContain(modpackIndexPath());
    expect(files).toContain(modpackDataPath(BRASS_REF, "cf-777"));
    expect(files).toContain(modFileSwatchesPath("cf-1111"));
    for (const file of files) {
      expect(
        file.startsWith(MODPACKS_PREFIX) || file.startsWith(MOD_FILES_PREFIX),
      ).toBe(true);
    }
    expect(stdout).toContain("Modpack ref: brass-test-pack@1.2.3");
  }, 60_000);
});

describe("FR-2: one status per mod and a summary with the ref", () => {
  it("gives the instance's mods ok, no-blocks and failed", () => {
    const statuses = Object.fromEntries(
      brass.data.mods.map((m) => [m.name, m.status]),
    );
    expect(statuses).toEqual({
      "Brass Things": "ok",
      Lib: "no-blocks",
      "Gone Mod": "failed",
    });
    expect(
      brass.data.mods.find((m) => m.status === "failed")?.message,
    ).toBeTruthy();
  });

  it("gives every source mod exactly one of the five statuses", async () => {
    const mod = (
      name: string,
      extra: Partial<ModpackSource["mods"][number]>,
    ) => ({
      name,
      fileName: `${name}.jar`,
      curseForgeProjectId: null,
      curseForgeFileId: null,
      size: null,
      read: null,
      ...extra,
    });
    const source: ModpackSource = {
      name: "Status Pack",
      displayVersion: "1",
      minecraftVersion: "1.21.1",
      loader: "neoforge",
      curseForgeProjectId: null,
      packFileId: null,
      hasKubeJs: false,
      warnings: [],
      mods: [
        mod("brass", { read: async () => brassJar() }),
        mod("lib", { read: async () => libraryJar() }),
        mod("hidden", {
          missingStatus: "skipped-undistributable",
          missingMessage: "no download URL",
        }),
        mod("huge", {
          size: MAX_MOD_JAR_BYTES + 1,
          read: async () => new Uint8Array(),
        }),
        mod("broken", { read: async () => strToU8("not a zip") }),
      ],
    };
    const { data } = await extractModpack(source, { vanilla, now: () => NOW });
    expect(data.mods.map((m) => m.status)).toEqual([
      "ok",
      "no-blocks",
      "skipped-undistributable",
      "skipped-too-large",
      "failed",
    ]);
    expect(new Set(data.mods.map((m) => m.status))).toEqual(
      new Set(MOD_STATUSES),
    );
  });

  it("prints counts per status and the pack's ref", async () => {
    const { stdout } = await uploadCli([
      "--instance",
      instance,
      "--dry-run",
      "--out",
      path.join(tmp, "summary"),
    ]);
    expect(stdout).toMatch(
      /Mods \(3\):\n {2}ok: 1\n {2}no-blocks: 1\n {2}failed: 1/,
    );
    expect(stdout).toContain("Modpack ref: brass-test-pack@1.2.3");
    expect(stdout).toContain("Unsupported:");
  }, 60_000);
});

describe("FR-3: only index.json, pack.json.gz and swatch atlases", () => {
  it("writes no jars, raw textures or raw models", async () => {
    const out = path.join(tmp, "only-derived");
    await uploadCli(["--instance", instance, "--dry-run", "--out", out]);
    const files = filesUnder(out);
    expect(files).toEqual(
      [
        modpackIndexPath(),
        modpackDataPath(BRASS_REF, "cf-777"),
        modFileSwatchesPath("cf-1111"),
      ].sort(),
    );
    // The pack record is derived data: no blockstate, model or texture JSON.
    const record = new TextDecoder().decode(
      gunzipSync(
        readFileSync(path.join(out, modpackDataPath(BRASS_REF, "cf-777"))),
      ),
    );
    const data = modpackDataSchema.parse(JSON.parse(record));
    expect(data.blocks.map((b) => b.id)).toEqual([
      "brass:brass_block",
      "brass:brass_gizmo",
      "brass:brass_stairs",
    ]);
    for (const raw of [
      "variants",
      "elements",
      "brass:block/brass_stairs_inner",
      "minecraft:block/cube_all",
    ]) {
      expect(record).not.toContain(raw);
    }
  }, 60_000);

  it("publishes only those paths to the Blob store", () => {
    expect([...blob.objects.keys()].sort()).toEqual(
      [
        modpackIndexPath(),
        modpackDataPath(BRASS_REF, "cf-777"),
        modpackDataPath(ATM, "cf-100"),
        modpackDataPath(ATM, "cf-200"),
        modFileSwatchesPath("cf-1111"),
      ].sort(),
    );
  });
});

describe("FR-4: uploads keep the rest of the index", () => {
  it("keeps every other pack and version", async () => {
    const index = await loadModpackIndex(blob);
    expect(
      index.packs.map((p) => [p.slug, p.versions.map((v) => v.key)]),
    ).toEqual([
      [ATM, ["cf-100", "cf-200"]],
      [BRASS_REF, ["cf-777"]],
    ]);

    // Re-uploading a version replaces just that version.
    const again = atmPack({
      ...ATM_OLD,
      uploadedAt: "2026-10-05T00:00:00.000Z",
    });
    await publishModpack(fakeBlobStore(blob), again);
    clearModpackCache();
    const after = await loadModpackIndex(blob);
    expect(
      after.packs.map((p) => [p.slug, p.versions.map((v) => v.uploadedAt)]),
    ).toEqual([
      [ATM, ["2026-10-01T00:00:00.000Z", "2026-10-05T00:00:00.000Z"]],
      [BRASS_REF, [NOW.toISOString()]],
    ]);
  });
});

describe("FR-5: the cleanup cron stays inside mcp/", () => {
  it("never lists or deletes modpack data, however old", async () => {
    const old = new Date("2020-01-01T00:00:00.000Z");
    for (const o of blob.objects.values()) o.uploadedAt = old;
    blob.objects.set(`${OUTPUT_PREFIX}old.nbt`, {
      body: new Uint8Array(1),
      uploadedAt: old,
    });
    const packPaths = [...blob.objects.keys()].filter(
      (p) => !p.startsWith(OUTPUT_PREFIX),
    );
    const result = await cleanupExpiredOutputs({ blob, now: () => NOW });
    expect(result.deleted).toBe(1);
    for (const p of packPaths) expect(blob.objects.has(p)).toBe(true);
    for (const c of blob.calls) {
      if (c.method === "list") {
        expect((c.args[0] as { prefix: string }).prefix).toBe(OUTPUT_PREFIX);
      }
      if (c.method === "del") {
        for (const p of c.args[0] as string[]) {
          expect(p.startsWith(OUTPUT_PREFIX)).toBe(true);
        }
      }
    }
    expect(OUTPUT_PREFIX.startsWith(MODPACKS_PREFIX)).toBe(false);
    expect(OUTPUT_PREFIX.startsWith(MOD_FILES_PREFIX)).toBe(false);
  });
});

// ── FR-6 to FR-8: refs, list_modpacks and the block set ────────────────────

describe("FR-6: modpack refs", () => {
  it("parses <slug>, <slug>@<file id> and <slug>@<display version>", () => {
    expect(parseModpackRef(ATM)).toMatchObject({ slug: ATM });
    expect(parseModpackRef(`${ATM}@100`)).toMatchObject({
      slug: ATM,
      version: "100",
    });
    expect(parseModpackRef(`${ATM}@2.0`)).toMatchObject({
      slug: ATM,
      version: "2.0",
    });
    for (const bad of ["", "ATM 10", `${ATM}@`, `@100`, `${ATM}@1@2`]) {
      expect(() => parseModpackRef(bad)).toThrow();
    }
  });

  it("picks the latest upload, or the pinned version", async () => {
    const version = async (modpack: string) =>
      (
        await call<{ version: string }>(searchBlocksTool, {
          query: "stone",
          modpack,
        })
      ).version;
    expect(await version(ATM)).toBe("1.21.1");
    expect(await version(`${ATM}@100`)).toBe("1.20.1");
    expect(await version(`${ATM}@1.0`)).toBe("1.20.1");
    expect(await version(`${ATM}@200`)).toBe("1.21.1");
  });

  it("answers an unknown or malformed ref with a tool error naming list_modpacks", async () => {
    for (const modpack of ["no-such-pack", `${ATM}@999`]) {
      expect(
        await callError(searchBlocksTool, { query: "stone", modpack }),
      ).toContain("list_modpacks");
    }
    expect(
      await callError(searchBlocksTool, {
        query: "stone",
        modpack: "Not A Ref!",
      }),
    ).not.toBe("");
  });
});

describe("FR-7: list_modpacks", () => {
  interface Listed {
    packs: { slug: string; versions: { ref: string }[] }[];
    note?: string;
  }

  it("lists every pack, and matches queries by name and initials", async () => {
    const all = await call<Listed>(listModpacksTool, {});
    expect(all.packs.map((p) => p.slug)).toEqual([ATM, BRASS_REF]);
    expect(all.packs[0].versions.map((v) => v.ref)).toEqual([
      `${ATM}@200`,
      `${ATM}@100`,
    ]);
    for (const query of ["ATM10", "atm", "all the mods", "mods-10"]) {
      expect(
        (await call<Listed>(listModpacksTool, { query })).packs.map(
          (p) => p.slug,
        ),
      ).toEqual([ATM]);
    }
    expect(
      (await call<Listed>(listModpacksTool, { query: "BTP" })).packs.map(
        (p) => p.slug,
      ),
    ).toEqual([BRASS_REF]);
    const none = await call<Listed>(listModpacksTool, { query: "skyfactory" });
    expect(none.packs).toEqual([]);
  });
});

describe("FR-8: a modpack's block set", () => {
  it("is the version's vanilla blocks plus the pack's mod blocks", async () => {
    const blocks = await resolveToolBlocks({ modpack: BRASS_REF }, makeDeps());
    expect(blocks.versionId).toBe("1.21.1");
    for (const id of blocks.data.blocks.keys()) {
      expect(blocks.registry.exists(id)).toBe(true);
    }
    for (const b of brass.data.blocks) {
      expect(blocks.registry.exists(b.id)).toBe(true);
    }
    for (const id of [
      "create:brass_block",
      "brass:copper_block",
      "minecraft:not_a_block",
    ]) {
      expect(blocks.registry.exists(id)).toBe(false);
    }
  });

  it("makes a conflicting version a tool error", async () => {
    expect(
      await callError(searchBlocksTool, {
        query: "stone",
        modpack: BRASS_REF,
        version: "1.20.1",
      }),
    ).toContain("Modpack 'brass-test-pack' is Minecraft 1.21.1");
    // The pack's own version is fine.
    await call(searchBlocksTool, {
      query: "stone",
      modpack: BRASS_REF,
      version: "1.21.1",
    });
  });
});

// ── FR-9 to FR-14: block data, search, camo and show_blocks ────────────────

describe("FR-9: kind, full_cube and confidence of mod blocks", () => {
  it("classifies every block, with unknown for unclear evidence", async () => {
    const kinds = Object.fromEntries(
      brass.data.blocks.map((b) => [b.id, [b.kind, b.fullCube]]),
    );
    expect(kinds).toEqual({
      "brass:brass_block": ["block", true],
      "brass:brass_stairs": ["stairs", false],
      "brass:brass_gizmo": ["unknown", false],
    });
    for (const b of brass.data.blocks) {
      expect(MOD_BLOCK_KINDS).toContain(b.kind);
    }
    expect(
      classifyModBlock({
        // Stairs properties on a fence model: conflicting evidence.
        id: "odd:thing",
        properties: {
          facing: ["north"],
          half: ["bottom", "top"],
          shape: ["straight"],
        },
        blockstate: {
          variants: { "": { model: "minecraft:block/fence_post" } },
        },
        models: {},
      }),
    ).toEqual({ kind: "unknown", full_cube: false, confidence: "low" });

    const results = (
      await call<{
        results: { id: string; kind: string; shape_confidence: string }[];
      }>(searchBlocksTool, { query: "brass:", modpack: BRASS_REF })
    ).results;
    expect(results.map((r) => [r.id, r.kind, r.shape_confidence])).toEqual(
      expect.arrayContaining([
        ["brass:brass_stairs", "stairs", "high"],
        ["brass:brass_gizmo", "unknown", "low"],
      ]),
    );
  });
});

interface Look {
  id: string;
  mod: string;
  hex?: string;
  dominant?: { hex: string; share: number }[];
  variance?: number;
}

function expectLook(look: Look | undefined, mod: string) {
  expect(look).toBeDefined();
  expect(look!.mod).toBe(mod);
  expect(look!.hex).toMatch(/^#[0-9a-f]{6}$/);
  expect(look!.dominant!.length).toBeGreaterThan(0);
  expect(look!.dominant!.length).toBeLessThanOrEqual(3);
  for (const d of look!.dominant!) {
    expect(d.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.share).toBeGreaterThan(0);
    expect(d.share).toBeLessThanOrEqual(1);
  }
  expect(look!.variance).toBeGreaterThanOrEqual(0);
}

describe("FR-10: appearance fields on every block result", () => {
  it("search_blocks, suggest_palette and show_blocks", async () => {
    const search = await call<{ results: Look[] }>(searchBlocksTool, {
      query: "brass_block",
      modpack: BRASS_REF,
    });
    expectLook(
      search.results.find((r) => r.id === "brass:brass_block"),
      "Brass Things",
    );
    const stone = await call<{ results: Look[] }>(searchBlocksTool, {
      query: "stone",
      modpack: BRASS_REF,
    });
    expectLook(
      stone.results.find((r) => r.id === "minecraft:stone"),
      "minecraft",
    );

    const palette = await call<{ blocks: Look[] }>(suggestPaletteTool, {
      color: "#c88c28",
      modpack: BRASS_REF,
      n: 10,
    });
    expect(palette.blocks[0].id).toBe("brass:brass_block");
    expectLook(palette.blocks[0], "Brass Things");
    expectLook(
      palette.blocks.find((b) => b.mod === "minecraft"),
      "minecraft",
    );

    const shown = await call<{ blocks: Look[] }>(showBlocksTool, {
      blocks: ["brass:brass_block", "minecraft:stone"],
      modpack: BRASS_REF,
    });
    expectLook(shown.blocks[0], "Brass Things");
    expectLook(shown.blocks[1], "minecraft");
  });
});

describe("FR-11: search with modpack and shape returns only pack blocks", () => {
  it("never returns an id the pack lacks", async () => {
    const blocks = await resolveToolBlocks({ modpack: ATM }, makeDeps());
    const search = await call<{ results: { id: string }[] }>(searchBlocksTool, {
      query: "brass_stairs",
      modpack: ATM,
    });
    expect(search.results.map((r) => r.id)).not.toContain(
      "create:brass_stairs",
    );
    for (const query of ["brass", "stairs", "create:", "oak"]) {
      const found = await call<{ results: { id: string; kind: string }[] }>(
        searchBlocksTool,
        { query, modpack: ATM, shape: ["stairs", "full_cube"], limit: 100 },
      );
      for (const r of found.results)
        expect(blocks.registry.exists(r.id)).toBe(true);
    }
    const palette = await call<{ blocks: { id: string; kind: string }[] }>(
      suggestPaletteTool,
      { color: "#c8a046", modpack: ATM, shape: ["stairs"], n: 20 },
    );
    expect(palette.blocks.length).toBeGreaterThan(0);
    for (const b of palette.blocks) {
      expect(blocks.registry.exists(b.id)).toBe(true);
      expect(b.kind).toBe("stairs");
    }
  });
});

interface CamoResult {
  camo_options?: {
    frame: string;
    kind: string;
    camo?: string;
    writable: boolean;
    reason?: string;
  }[];
  camo_material_rule?: string;
}

describe("FR-12: camo options", () => {
  it("offers a camo frame of the shape with a matching material", async () => {
    const search = await call<CamoResult>(searchBlocksTool, {
      query: "brass",
      modpack: ATM,
      shape: ["stairs"],
    });
    expect(search.camo_material_rule).toBe("approximate");
    expect(search.camo_options?.[0]).toMatchObject({
      frame: "copycats:copycat_stairs",
      kind: "stairs",
      camo: "create:brass_block",
      writable: true,
    });
    const palette = await call<CamoResult>(suggestPaletteTool, {
      color: BRASS.hex,
      modpack: ATM,
      shape: ["stairs"],
    });
    expect(palette.camo_options?.[0]).toMatchObject({
      frame: "copycats:copycat_stairs",
      kind: "stairs",
      camo: "create:brass_block",
      writable: true,
    });
    // A pack without camo blocks has none.
    const plain = await call<CamoResult>(searchBlocksTool, {
      query: "brass",
      modpack: BRASS_REF,
      shape: ["stairs"],
    });
    expect(plain.camo_options).toBeUndefined();
  });

  it("finds camo frames whose jar blockstates name no properties", async () => {
    // Like the real jars: every frame state points at one placeholder model.
    const placeholderJar = (namespace: string, names: string[]) => {
      const files: Record<string, Uint8Array> = {
        [`assets/${namespace}/textures/block/frame.png`]: solidPng([
          150, 150, 150, 255,
        ]),
        [`assets/${namespace}/models/block/frame.json`]: json({
          parent: "minecraft:block/cube_all",
          textures: { all: `${namespace}:block/frame` },
        }),
      };
      for (const name of names) {
        files[`assets/${namespace}/blockstates/${name}.json`] = json({
          variants: { "": { model: `${namespace}:block/frame` } },
        });
      }
      return zipSync(files);
    };
    const dir = path.join(tmp, "camo-instance");
    mkdirSync(path.join(dir, "mods"), { recursive: true });
    const jars: [number, string, Uint8Array][] = [
      [
        1,
        "create",
        placeholderJar("create", [
          "brass_block",
          "copycat_step",
          "copycat_panel",
        ]),
      ],
      [
        2,
        "copycats",
        placeholderJar("copycats", ["copycat_stairs", "copycat_slab"]),
      ],
      [
        3,
        "framedblocks",
        placeholderJar("framedblocks", [
          "framed_stairs",
          "framed_slab",
          "framed_pane",
          "framed_door",
          "framed_fence_gate",
        ]),
      ],
    ];
    for (const [, name, bytes] of jars) {
      writeFileSync(path.join(dir, "mods", `${name}.jar`), bytes);
    }
    writeFileSync(
      path.join(dir, "minecraftinstance.json"),
      JSON.stringify({
        name: "Camo Frames",
        gameVersion: "1.21.1",
        baseModLoader: { name: "neoforge-21.1.77", type: 6 },
        installedModpack: { addonID: 9100, installedFile: { id: 888 } },
        manifest: { version: "1.0" },
        installedAddons: jars.map(([id, name]) =>
          addon(id, name, id, `${name}.jar`),
        ),
      }),
    );
    const extraction = await extractModpack(await readInstanceFolder(dir), {
      vanilla,
      now: () => NOW,
    });
    // Stored as uploaded: no state properties on the frames.
    const stored = extraction.data.blocks.find(
      (b) => b.id === "framedblocks:framed_stairs",
    );
    expect(stored?.properties).toEqual({});
    await publishModpack(fakeBlobStore(blob), extraction);
    clearModpackCache();
    const ref = "camo-frames";

    const blocks = await resolveToolBlocks({ modpack: ref }, makeDeps());
    const frames = new Map(
      modpackCamoFrames(blocks.modpack!).map((f) => [f.id, f]),
    );
    for (const id of [
      "framedblocks:framed_stairs",
      "framedblocks:framed_slab",
      "copycats:copycat_stairs",
      "copycats:copycat_slab",
      "create:copycat_step",
      "create:copycat_panel",
    ]) {
      expect(frames.get(id)?.writable, id).toBe(true);
    }

    const search = await call<CamoResult>(searchBlocksTool, {
      query: "brass_stairs",
      modpack: ref,
    });
    expect(search.camo_options).toContainEqual(
      expect.objectContaining({
        frame: "framedblocks:framed_stairs",
        kind: "stairs",
        camo: "create:brass_block",
        writable: true,
      }),
    );

    // Frames take the kind of the vanilla shape they copy.
    const kinds = await call<{
      results: { id: string; kind: string; full_cube: boolean }[];
    }>(searchBlocksTool, { query: "framedblocks:", modpack: ref });
    expect(
      Object.fromEntries(
        kinds.results.map((r) => [r.id, [r.kind, r.full_cube]]),
      ),
    ).toEqual({
      "framedblocks:framed_door": ["door", false],
      "framedblocks:framed_fence_gate": ["fence_gate", false],
      "framedblocks:framed_pane": ["pane", false],
      "framedblocks:framed_slab": ["slab", false],
      "framedblocks:framed_stairs": ["stairs", false],
    });
    const stairs = { facing: "north", half: "bottom", shape: "straight" };
    expect(
      modpackRenderSource(blocks.modpack!).shape?.(
        "framedblocks:framed_stairs",
        stairs,
      ),
    ).toEqual(blockShapeOfKind("stairs", stairs));

    const shown = await call<{
      blocks: { writable?: boolean; reason?: string }[];
    }>(showBlocksTool, {
      blocks: [
        { frame: "framedblocks:framed_stairs", camo: "create:brass_block" },
      ],
      modpack: ref,
    });
    expect(shown.blocks[0]).toMatchObject({ writable: true });
    expect(shown.blocks[0].reason).toBeUndefined();

    const material =
      "framedblocks:framed_stairs[facing=east,half=top]{camo=create:brass_block}";
    const compiled = await runTool(
      compileBuildTool,
      {
        program: {
          name: "Frames",
          size: [1, 1, 1],
          build: [{ block: { material } }],
        },
        modpack: ref,
        version: "1.21.1",
        output_format: "Litematic",
        render: false,
      },
      makeDeps(),
    );
    expect(compiled.isError, text(compiled)).toBeFalsy();
    expect(compiled.structuredContent).toMatchObject({ errors: 0 });
    const shape = await runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 1,
        height: 1,
        depth: 1,
        material,
        modpack: ref,
        version: "1.21.1",
        output_format: "Structure",
      },
      makeDeps(),
    );
    expect(shape.isError, text(shape)).toBeFalsy();
  });
});

describe("FR-13: writable only in CAMO_WRITE_VERSIONS", () => {
  it("is false with a reason for other versions", async () => {
    const old = await call<CamoResult>(searchBlocksTool, {
      query: "brass",
      modpack: `${ATM}@100`,
      shape: ["stairs"],
    });
    expect(old.camo_options?.length).toBeGreaterThan(0);
    for (const o of old.camo_options!) {
      expect(o.writable).toBe(false);
      expect(o.reason).toContain("1.20.1");
    }
    for (const [namespace, versions] of Object.entries(CAMO_WRITE_VERSIONS)) {
      for (const v of versions) expect(isCamoWritable(namespace, v)).toBe(true);
      expect(isCamoWritable(namespace, "1.20.1")).toBe(false);
    }
    expect(isCamoWritable("create", "26.1.2")).toBe(false);
  });
});

describe("FR-14: show_blocks", () => {
  it("draws 1–16 blocks and camo pairs as one PNG, listing unknown ids", async () => {
    const result = await runTool(
      showBlocksTool,
      {
        blocks: [
          "create:brass_block",
          "minecraft:oak_stairs",
          { frame: "copycats:copycat_stairs", camo: "create:brass_block" },
          "create:brass_stairs",
        ],
        modpack: ATM,
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content.filter((c) => c.type === "image")).toHaveLength(1);
    const image = imageOf(result);
    expect(image.width).toBeGreaterThan(0);
    expect(hasColor(image, BRASS.hex)).toBe(true);
    const data = result.structuredContent as {
      blocks: (Look & { kind: string; camo?: Look })[];
      not_found: { id: string }[];
    };
    expect(data.blocks.map((b) => b.id)).toEqual([
      "create:brass_block",
      "minecraft:oak_stairs",
      "copycats:copycat_stairs",
    ]);
    expect(data.blocks[2]).toMatchObject({
      kind: "stairs",
      camo: { id: "create:brass_block", hex: BRASS.hex },
    });
    expect(data.not_found.map((n) => n.id)).toEqual(["create:brass_stairs"]);

    // 1 to 16 blocks, checked by the input schema.
    const many = Array.from({ length: 17 }, () => "minecraft:stone");
    for (const blocks of [many, []]) {
      expect(
        showBlocksTool.inputSchema.safeParse({ blocks, modpack: ATM }).success,
      ).toBe(false);
    }
    expect(
      showBlocksTool.inputSchema.safeParse({
        blocks: many.slice(1),
        modpack: ATM,
      }).success,
    ).toBe(true);
  });
});

// ── FR-15 to FR-18: renders, schematics and build materials ───────────────

describe("FR-15: renders with pack colours", () => {
  it("render_schematic, compile_build and generate_shape use the pack's colours", async () => {
    const brassHex = brass.data.blocks.find(
      (b) => b.id === "brass:brass_block",
    )!.appearance!.hex;
    const fallback = fallbackBlockColor("brass:brass_block");
    const args = await schematicOf(["brass:brass_block", "minecraft:stone"]);

    const withPack = imageOf(
      await runTool(
        renderSchematicTool,
        { ...args, modpack: BRASS_REF },
        makeDeps(),
      ),
    );
    expect(hasColor(withPack, brassHex)).toBe(true);
    expect(hasColor(withPack, fallback)).toBe(false);
    const without = imageOf(
      await runTool(renderSchematicTool, args, makeDeps()),
    );
    expect(hasColor(without, fallback)).toBe(true);
    expect(hasColor(without, brassHex)).toBe(false);

    const compiled = await runTool(
      compileBuildTool,
      {
        program: {
          name: "Brass cube",
          size: [2, 2, 2],
          palette: { body: "brass:brass_block" },
          build: [{ box: { do: [{ fill: "@body" }] } }],
        },
        modpack: BRASS_REF,
        version: "1.21.1",
      },
      makeDeps(),
    );
    expect(compiled.isError).toBeFalsy();
    expect(hasColor(imageOf(compiled), brassHex)).toBe(true);

    const shape = await runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 2,
        height: 2,
        depth: 2,
        material: "brass:brass_block",
        modpack: BRASS_REF,
        version: "1.21.1",
        output_format: "Sponge[v2]",
        render: true,
      },
      makeDeps(),
    );
    expect(shape.isError).toBeFalsy();
    expect(hasColor(imageOf(shape), brassHex)).toBe(true);
  });

  it("colours a camo frame with its camo", async () => {
    const result = await runTool(
      compileBuildTool,
      {
        program: {
          name: "Camo stairs",
          size: [2, 1, 1],
          build: [
            {
              box: {
                do: [
                  {
                    fill: {
                      material:
                        "copycats:copycat_stairs{camo=create:brass_block}",
                      facing: "-z",
                    },
                  },
                ],
              },
            },
          ],
        },
        modpack: ATM,
        version: "1.21.1",
      },
      makeDeps(),
    );
    expect(result.isError).toBeFalsy();
    expect(hasColor(imageOf(result), BRASS.hex)).toBe(true);
  });
});

describe("FR-16: inspect_schematic and convert_schematic", () => {
  it("flags rows in_modpack, lists missing states and warns on convert", async () => {
    const args = await schematicOf([
      "brass:brass_block",
      "minecraft:stone",
      "create:brass_block",
    ]);
    const inspected = await call<{
      palette: { block_state: string; in_modpack?: boolean; mod?: string }[];
      missing_from_modpack?: { block_states: { block_state: string }[] };
    }>(inspectSchematicTool, { ...args, modpack: BRASS_REF });
    const row = (s: string) =>
      inspected.palette.find((r) => r.block_state === s);
    expect(row("brass:brass_block")).toMatchObject({
      in_modpack: true,
      mod: "Brass Things",
    });
    expect(row("minecraft:stone")).toMatchObject({ in_modpack: true });
    expect(row("create:brass_block")).toMatchObject({ in_modpack: false });
    expect(inspected.missing_from_modpack?.block_states).toEqual([
      expect.objectContaining({ block_state: "create:brass_block" }),
    ]);

    const converted = await call<{ warnings: string[] }>(convertSchematicTool, {
      ...args,
      output_format: "Litematic",
      modpack: BRASS_REF,
    });
    expect(converted.warnings).toEqual([
      "create:brass_block: not in modpack 'brass-test-pack' (1 block).",
    ]);
  });
});

describe("FR-17: build materials the pack lacks", () => {
  it("are a generate_shape tool error and a report error at the program path", async () => {
    expect(
      await callError(generateShapeTool, {
        shape: "cuboid",
        width: 1,
        height: 1,
        depth: 1,
        material: "create:brass_block",
        modpack: BRASS_REF,
        version: "1.21.1",
        output_format: "Sponge[v2]",
      }),
    ).toContain("create:brass_block");

    const program = {
      name: "Missing",
      size: [1, 2, 1],
      palette: { body: "create:brass_block" },
      build: [
        { block: { material: "@body", at: [0, 0, 0] } },
        { block: { material: "brass:copper_block", at: [0, 1, 0] } },
      ],
    };
    for (const tool of [compileBuildTool, checkBuildTool]) {
      const result = await runTool(
        tool,
        { program, modpack: BRASS_REF, version: "1.21.1", render: false },
        makeDeps(),
      );
      expect(result.structuredContent).toMatchObject({ errors: 2 });
      const report = text(result);
      expect(report).toMatch(
        /palette\.body.*unknown block\/material 'create:brass_block'/,
      );
      expect(report).toMatch(
        /build\[1\]\.block.*unknown block\/material 'brass:copper_block'/,
      );
    }
  });
});

describe("FR-18: camo materials are written through camo/write.ts", () => {
  const stairs = "copycats:copycat_stairs";
  const material = `${stairs}{camo=create:brass_block}`;

  function camoNames(
    projection: ParsedSchematicProjection,
  ): (string | undefined)[] {
    const names: (string | undefined)[] = [];
    for (const region of projection.regions) {
      const nbtAt = new Map(
        region.blockEntities.map((be) => [be.pos.join(","), be.nbt]),
      );
      for (const placed of region.blocks) {
        const entry = projection.palette[placed.paletteIndex];
        if (entry.blockId !== stairs) continue;
        for (const slot of extractCamoSlots(
          entry.blockId,
          entry.properties,
          nbtAt.get(placed.pos.join(",")),
        )) {
          names.push(slot.state?.name);
        }
      }
    }
    return names;
  }

  it("writes the camo with compile_build and generate_shape on a writable version", async () => {
    const compiled = await runTool(
      compileBuildTool,
      {
        program: {
          name: "Camo",
          size: [2, 1, 1],
          build: [{ box: { do: [{ fill: { material, facing: "-z" } }] } }],
        },
        modpack: ATM,
        version: "1.21.1",
        output_format: "Litematic",
        render: false,
      },
      makeDeps(),
    );
    expect(compiled.structuredContent).toMatchObject({ errors: 0 });
    expect(camoNames(parsed(takeOutputs()[0]))).toEqual([
      "create:brass_block",
      "create:brass_block",
    ]);

    const shape = await runTool(
      generateShapeTool,
      {
        shape: "cuboid",
        width: 1,
        height: 1,
        depth: 1,
        material,
        modpack: ATM,
        version: "1.21.1",
        output_format: "Structure",
      },
      makeDeps(),
    );
    expect(shape.isError).toBeFalsy();
    expect(camoNames(parsed(takeOutputs()[0]))).toEqual(["create:brass_block"]);
  });

  it("refuses versions outside CAMO_WRITE_VERSIONS", async () => {
    expect(
      await callError(generateShapeTool, {
        shape: "cuboid",
        width: 1,
        height: 1,
        depth: 1,
        material,
        modpack: `${ATM}@100`,
        version: "1.20.1",
        output_format: "Structure",
      }),
    ).toContain("1.20.1");
    const checked = await runTool(
      checkBuildTool,
      {
        program: {
          name: "Camo",
          size: [1, 1, 1],
          build: [{ block: { material } }],
        },
        modpack: `${ATM}@100`,
        version: "1.20.1",
      },
      makeDeps(),
    );
    expect(checked.structuredContent).toMatchObject({ errors: 1 });
    expect(text(checked)).toContain("1.20.1");
  });

  it("only camo/write.ts writes camo NBT", () => {
    // The MCP and build-language writers go through writeCamoChoice.
    for (const file of [
      "src/lib/mcp/generate-shape.ts",
      "src/lib/buildlang/build.ts",
    ]) {
      expect(readFileSync(path.join(ROOT, file), "utf8")).toMatch(
        /import \{[^}]*writeCamoChoice[^}]*\} from "(?:\.\.\/|@\/lib\/)camo\/write"/,
      );
    }
  });
});

// ── FR-19, FR-20: unchanged without a modpack; documentation ───────────────

describe("FR-19: without a modpack nothing changes", () => {
  it("block tools read no modpack data and add no modpack fields", async () => {
    const search = await call<Record<string, unknown>>(searchBlocksTool, {
      query: "stone",
      version: "1.21.4",
      shape: ["stairs"],
    });
    expect(search.modpack).toBeUndefined();
    expect(search.camo_options).toBeUndefined();
    const args = await schematicOf(["minecraft:stone", "brass:brass_block"]);
    const inspected = await call<Record<string, unknown>>(
      inspectSchematicTool,
      args,
    );
    expect(inspected.missing_from_modpack).toBeUndefined();
    // Without a pack, mod ids stay as typed in generate_shape and are
    // rejected by the build language, as before.
    await call(generateShapeTool, {
      shape: "cuboid",
      width: 1,
      height: 1,
      depth: 1,
      material: "brass:brass_block",
      version: "1.21.1",
      output_format: "Sponge[v2]",
    });
    const checked = await runTool(
      checkBuildTool,
      {
        program: {
          name: "Mod",
          size: [1, 1, 1],
          build: [{ block: { material: "brass:brass_block" } }],
        },
        version: "1.21.1",
      },
      makeDeps(),
    );
    expect(checked.structuredContent).toMatchObject({ errors: 1 });
    // A camo needs a modpack.
    const camo = await runTool(
      checkBuildTool,
      {
        program: {
          name: "Camo",
          size: [1, 1, 1],
          build: [
            { block: { material: "copycats:copycat_stairs{camo=stone}" } },
          ],
        },
        version: "1.21.1",
      },
      makeDeps(),
    );
    expect(camo.structuredContent).toMatchObject({ errors: 1 });
    expect(
      blob.calls.filter(
        (c) =>
          (c.method === "get" || c.method === "list") &&
          String(c.args[0]).match(/^(modpacks|mod-files)\//),
      ),
    ).toEqual([]);
  });
});

describe("FR-20: documentation, tool descriptions and the design_build prompt", () => {
  it("tell agents to resolve a pack with list_modpacks and pass modpack", async () => {
    const docs = readFileSync(path.join(ROOT, "docs/mcp.md"), "utf8");
    expect(docs).toContain("## Modpacks");
    expect(docs).toContain("list_modpacks");
    expect(docs).toMatch(/pass(?:es)? `?modpack`?/i);

    const handler = createMcpRequestHandler(makeDeps());
    const client = new Client({ name: "fr-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
        fetch: async (input, init) => handler(new Request(input, init)),
      }),
    );
    try {
      const { tools } = await client.listTools();
      const withModpack = tools.filter(
        (t) => (t.inputSchema.properties as Record<string, unknown>)?.modpack,
      );
      expect(withModpack.map((t) => t.name).sort()).toEqual(
        [
          "check_build",
          "compile_build",
          "convert_schematic",
          "generate_shape",
          "inspect_schematic",
          "render_schematic",
          "search_blocks",
          "show_blocks",
          "suggest_palette",
        ].sort(),
      );
      for (const tool of withModpack) {
        const modpack = (
          tool.inputSchema.properties as Record<
            string,
            { description?: string }
          >
        ).modpack;
        expect(modpack.description).toContain("list_modpacks");
      }
      expect(
        tools.find((t) => t.name === "list_modpacks")?.description,
      ).toMatch(/modpack/);
      const prompt = await client.getPrompt({
        name: "design_build",
        arguments: {
          request: "a starter base",
          version: "1.21.1",
          modpack: ATM,
        },
      });
      const promptText = prompt.messages
        .map((m) => (m.content.type === "text" ? m.content.text : ""))
        .join("\n");
      expect(promptText).toContain("list_modpacks");
      expect(promptText).toContain(ATM);
    } finally {
      await client.close();
    }
  });
});
