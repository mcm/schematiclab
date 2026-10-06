// End-to-end checks of the block discovery epic's functional requirements
// (SCHEM-150), one `describe` per FR. Packs are synthetic: fflate jars (with
// nested jars, compat packs and lang-only blocks), a `kubejs/assets/` folder
// and a server block list, run through `extractModpack`, the CLI itself
// (FR-6, FR-15) and the MCP tools over the fake Blob store (FR-9, FR-14).
// Details are tested next to their code; these tests check each requirement
// as a whole.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { gunzipSync, strFromU8, strToU8, zipSync } from "fflate";
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
import { searchBlocksTool, suggestPaletteTool } from "../../mcp/block-tools";
import { listModpacksTool } from "../../mcp/list-modpacks";
import {
  clearSwatchSheetCache,
  NO_VISUAL_INFO_LABEL,
  showBlocksTool,
} from "../../mcp/show-blocks";
import { runTool } from "../../mcp/tools";
import type { McpDeps } from "../../mcp/types";
import { createFakeBlob, type FakeBlob } from "../../mcp/__tests__/fake-blob";
import {
  MAX_ASSET_BYTES,
  MAX_NESTED_JAR_DEPTH,
  parseModJar,
} from "../../mods/parse-mod-jar";
import { vanillaDescriptorSources } from "../appearance";
import { BLOCK_LIST_MOD_KEY, type BlockList } from "../block-list";
import { COMPAT_BLOCK_PREFIXES } from "../compat-blocks";
import { readPackZipKubeJsAssets } from "../curseforge-source";
import {
  extractModpack,
  type ModpackExtraction,
  type ModpackModSource,
  type ModpackSource,
} from "../extract";
import { readInstanceFolder } from "../instance-folder";
import { modFileSwatchesPath } from "../paths";
import { encodeRgbaPng } from "../png";
import {
  blobModpackStore,
  publishModpack,
  type ModpackStore,
} from "../publish";
import { fakeModpackBlobApi } from "./fake-modpack-blob";
import { clearModpackCache } from "../reader";
import {
  MODPACK_FORMAT_VERSION,
  modpackDataSchema,
  type ModpackData,
} from "../schema";

const ROOT = process.cwd();
const NOW = new Date("2026-10-06T12:00:00.000Z");

// Vanilla models only (cube_all), so mod textures make swatches.
const vanilla = vanillaDescriptorSources({
  models: JSON.parse(
    readFileSync(
      path.join(ROOT, "public", "minecraft-assets", "models.json"),
      "utf8",
    ),
  ) as Record<string, unknown>,
  atlas: { width: 1, height: 1, data: new Uint8Array(4) },
  uvs: {},
});

// 1.21.4 blocks stand in for every version's vanilla registry.
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

// ── Synthetic jars and packs ───────────────────────────────────────────────

type Files = Record<string, Uint8Array>;
type Rgba = [number, number, number, number];

const BLUE: Rgba = [40, 40, 200, 255];
const RED: Rgba = [200, 40, 40, 255];
const GREEN: Rgba = [40, 200, 40, 255];

const json = (value: unknown) => strToU8(JSON.stringify(value));

function solidPng(rgba: Rgba): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return encodeRgbaPng(16, 16, data);
}

/** A self-contained cube block: blockstate, cube_all model and texture. */
function cube(id: string, rgba: Rgba = BLUE, at = "assets"): Files {
  const [ns, p] = id.split(":");
  return {
    [`${at}/${ns}/blockstates/${p}.json`]: json({
      variants: { "": { model: `${ns}:block/${p}` } },
    }),
    [`${at}/${ns}/models/block/${p}.json`]: json({
      parent: "minecraft:block/cube_all",
      textures: { all: `${ns}:block/${p}` },
    }),
    [`${at}/${ns}/textures/block/${p}.png`]: solidPng(rgba),
  };
}

/** A cube's model and texture without its blockstate. */
function modelOnly(id: string, rgba: Rgba = BLUE): Files {
  const files = cube(id, rgba);
  const [ns, p] = id.split(":");
  delete files[`assets/${ns}/blockstates/${p}.json`];
  return files;
}

const lang = (ns: string, entries: Record<string, string>): Files => ({
  [`assets/${ns}/lang/en_us.json`]: json(entries),
});

const modsToml = (ids: string[]) =>
  strToU8(
    `modLoader="javafml"\nloaderVersion="[1,)"\n${ids
      .map((id) => `[[mods]]\nmodId="${id}"\nversion="1"\n`)
      .join("")}`,
  );

interface Nested {
  file: string;
  group?: string;
  artifact?: string;
  version?: string;
  modIds?: string[];
  files?: Files;
  nested?: Nested[];
}

/** A jar of `files`, declaring `modIds`, with `nested` in `META-INF/jarjar/`. */
function jar(
  files: Files,
  modIds: string[] = [],
  nested: Nested[] = [],
): Uint8Array {
  const out: Files = { ...files };
  if (modIds.length > 0) out["META-INF/neoforge.mods.toml"] = modsToml(modIds);
  const listed = nested.filter((n) => n.artifact !== undefined);
  if (listed.length > 0) {
    out["META-INF/jarjar/metadata.json"] = json({
      jars: listed.map((n) => ({
        identifier: { group: n.group ?? "com.example", artifact: n.artifact },
        version: { range: `[${n.version},)`, artifactVersion: n.version },
        path: `META-INF/jarjar/${n.file}`,
      })),
    });
  }
  for (const n of nested) {
    out[`META-INF/jarjar/${n.file}`] = jar(
      n.files ?? {},
      n.modIds ?? [],
      n.nested ?? [],
    );
  }
  return zipSync(out);
}

function mod(
  name: string,
  fileId: number,
  bytes: Uint8Array,
): ModpackModSource {
  return {
    name,
    fileName: `${name.toLowerCase().replace(/\s+/g, "-")}.jar`,
    curseForgeProjectId: fileId,
    curseForgeFileId: fileId,
    size: bytes.length,
    read: async () => bytes,
  };
}

function pack(
  mods: ModpackModSource[],
  kubejs: Files | null = null,
  minecraftVersion = "1.21.1",
): ModpackSource {
  return {
    name: "Discovery Pack",
    displayVersion: "1.0",
    minecraftVersion,
    loader: "neoforge",
    curseForgeProjectId: null,
    packFileId: null,
    hasKubeJs: kubejs !== null,
    readKubeJsAssets: async () => kubejs,
    warnings: [],
    mods,
  };
}

const list = (ids: string[], sha256 = "0".repeat(64)): BlockList => ({
  ids,
  sha256,
});

const extract = (
  source: ModpackSource,
  options: { blockList?: BlockList; vanillaBlockIds?: string[] } = {},
) => extractModpack(source, { vanilla, now: () => NOW, ...options });

const idsOf = (data: ModpackData) => data.blocks.map((b) => b.id);
const blockOf = (data: ModpackData, id: string) =>
  data.blocks.find((b) => b.id === id);

// ── Fake Blob store and tool calls ─────────────────────────────────────────

/** `publishModpack`'s store, writing into the fake Blob store. */
function fakeBlobStore(blob: FakeBlob): ModpackStore {
  return blobModpackStore(fakeModpackBlobApi(blob, () => NOW));
}

async function published(
  ...extractions: ModpackExtraction[]
): Promise<FakeBlob> {
  const blob = createFakeBlob(() => NOW);
  for (const extraction of extractions) {
    await publishModpack(fakeBlobStore(blob), extraction);
  }
  clearModpackCache();
  clearBlockDataCache();
  clearSwatchSheetCache();
  return blob;
}

async function call(
  blob: FakeBlob,
  tool: Parameters<typeof runTool>[0],
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const deps: McpDeps = { fetch: fetchStub as never, now: () => NOW, blob };
  return runTool(tool, args, deps);
}

async function structured<T>(
  blob: FakeBlob,
  tool: Parameters<typeof runTool>[0],
  args: Record<string, unknown>,
): Promise<T> {
  const result = await call(blob, tool, args);
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent as T;
}

interface Look {
  id: string;
  mod: string;
  kind: string;
  visual_info?: false;
  hex?: string;
  dominant?: unknown;
  variance?: number;
}

// ── The CLI ────────────────────────────────────────────────────────────────

const run = promisify(execFile);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "block-discovery-fr-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  clearModpackCache();
  clearBlockDataCache();
  clearSwatchSheetCache();
  fetchStub.mockClear();
});

function writeFiles(root: string, files: Files) {
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(root, ...name.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
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

/**
 * An instance folder with every block source: nested copies of `lib` in two
 * jars, Dyenamics-style compat packs for a present and an absent mod, a
 * compat block for an absent mod, and `kubejs/assets/` retexturing a jar
 * block and adding two blocks no jar has.
 */
function writeCliInstance(dir: string): string {
  mkdirSync(path.join(dir, "mods"), { recursive: true });
  writeFileSync(
    path.join(dir, "minecraftinstance.json"),
    JSON.stringify({
      name: "CLI Pack",
      gameVersion: "1.21.1",
      baseModLoader: { name: "neoforge-21.1.77", type: 6 },
      manifest: { version: "1.0" },
      installedAddons: [],
    }),
  );
  writeFiles(path.join(dir, "mods"), {
    "alpha.jar": jar(
      {
        ...cube("alpha:gear"),
        ...lang("alpha", {
          "block.alpha.gear": "Gear",
          "block.alpha.sludge": "Alpha Sludge",
        }),
      },
      ["alpha"],
      [
        {
          file: "lib-1.0.jar",
          artifact: "lib",
          version: "1.0",
          modIds: ["lib"],
          files: cube("lib:old_block"),
        },
      ],
    ),
    "beta.jar": jar(
      { ...cube("beta:frame"), ...cube("beta:stale") },
      ["beta"],
      [
        {
          file: "lib-2.0.jar",
          artifact: "lib",
          version: "2.0",
          modIds: ["lib"],
          files: cube("lib:new_block"),
        },
      ],
    ),
    "dnf.jar": jar(
      {
        ...cube("dyenamicsandfriends:peach_wool"),
        ...cube("dyenamicsandfriends:quark_peach_chest"),
        ...cube(
          "dyenamicsandfriends:alpha_peach_bed",
          BLUE,
          "compat_packs/alpha/assets",
        ),
        ...cube(
          "dyenamicsandfriends:botanypots_peach_pot",
          BLUE,
          "compat_packs/botanypots/assets",
        ),
      },
      ["dyenamicsandfriends"],
    ),
  });
  writeFiles(path.join(dir, "kubejs"), {
    "assets/alpha/textures/block/gear.png": solidPng(RED),
    ...cube("kubejs:magical_soil", GREEN),
    ...cube("kubejs:unlisted", GREEN),
    "startup_scripts/blocks.js": strToU8("// registers blocks"),
  });
  return dir;
}

// Vanilla blocks for the CLI, which loads them over the network.
const STUB_FETCH = `globalThis.fetch = async (url) =>
  /blocks\\/data\\.min\\.json$/.test(String(url))
    ? new Response(JSON.stringify({ air: [{}, {}], stone: [{}, {}], dirt: [{}, {}] }))
    : new Response("not found", { status: 404 });
`;

/** Runs `pnpm modpack:upload`'s script with node and a stubbed fetch. */
function uploadCli(args: string[]) {
  const stub = path.join(tmp, "stub-fetch.mjs");
  writeFileSync(stub, STUB_FETCH);
  return run(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      pathToFileURL(stub).href,
      "scripts/upload-modpack.mts",
      ...args,
    ],
    { cwd: ROOT, env: { ...process.env, CURSEFORGE_API_KEY: "" } },
  );
}

function readPackData(out: string): ModpackData {
  const file = filesUnder(out).find((f) => f.endsWith("pack.json.gz"));
  expect(file).toBeDefined();
  return modpackDataSchema.parse(
    JSON.parse(strFromU8(gunzipSync(readFileSync(path.join(out, file!))))),
  );
}

const CLI_BLOCK_LIST = `# dumped from the server
minecraft:stone
minecraft:copper_golem_statue
alpha:gear
alpha:sludge
lib:new_block
dyenamicsandfriends:peach_wool
dyenamicsandfriends:alpha_peach_bed
kubejs:magical_soil
ghost:block
`;

let cliPlain: { stdout: string; stderr: string; data: ModpackData };
let cliListed: { stdout: string; stderr: string; data: ModpackData };

beforeAll(async () => {
  const instance = writeCliInstance(path.join(tmp, "instance"));
  const listFile = path.join(tmp, "blocks.txt");
  writeFileSync(listFile, CLI_BLOCK_LIST);
  const plainOut = path.join(tmp, "out-plain");
  const listedOut = path.join(tmp, "out-listed");
  const [plain, listed] = await Promise.all([
    uploadCli(["--instance", instance, "--dry-run", "--out", plainOut]),
    uploadCli([
      "--instance",
      instance,
      "--block-list",
      listFile,
      "--dry-run",
      "--out",
      listedOut,
    ]),
  ]);
  cliPlain = { ...plain, data: readPackData(plainOut) };
  cliListed = { ...listed, data: readPackData(listedOut) };
}, 120_000);

// ── FR-1 ───────────────────────────────────────────────────────────────────

describe("FR-1: blockstate and model JSON read leniently", () => {
  const text = (s: string) => strToU8(s);
  const files: Files = {
    ...modelOnly("lenient:junk"),
    "assets/lenient/blockstates/junk.json": text(
      '{"variants":{"":{"model":"lenient:block/junk"}}}\n}} trailing junk',
    ),
    ...cube("lenient:commented"),
    "assets/lenient/blockstates/commented.json": text(
      '// written by hand\n{ /* the only variant */ "variants": { "": { "model": "lenient:block/commented", "note": "a // b /* c */" } } }',
    ),
    "assets/lenient/models/block/commented.json": text(
      '{ // cube_all\n "parent": "minecraft:block/cube_all", "textures": { "all": "lenient:block/commented" } }',
    ),
    ...cube("lenient:strict"),
    "assets/lenient/blockstates/empty.json": text(""),
    "assets/lenient/blockstates/truncated.json": text('{"variants":{"":'),
  };

  it("reads the first JSON value, ignoring comments and trailing text, with a warning", async () => {
    const { data } = await extract(pack([mod("Lenient", 1, jar(files))]));
    expect(idsOf(data)).toEqual([
      "lenient:commented",
      "lenient:junk",
      "lenient:strict",
    ]);
    // The commented model still gives its block a look.
    for (const id of idsOf(data)) {
      expect(blockOf(data, id)?.appearance).toBeDefined();
      expect(blockOf(data, id)?.swatch).toBeDefined();
    }

    const { warnings } = parseModJar(jar(files));
    const lenient = (name: string) =>
      `Read assets/lenient/${name} leniently (comments or content after the JSON value ignored)`;
    expect(warnings).toContain(lenient("blockstates/junk.json"));
    expect(warnings).toContain(lenient("blockstates/commented.json"));
    expect(warnings).toContain(lenient("models/block/commented.json"));
    // Strict files are read as before, without a warning.
    expect(warnings.join("\n")).not.toContain("strict");
    // Empty and truncated files are still skipped.
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^Skipped malformed JSON assets\/lenient\/blockstates\/empty\.json/,
        ),
        expect.stringMatching(
          /^Skipped malformed JSON assets\/lenient\/blockstates\/truncated\.json/,
        ),
      ]),
    );
  });
});

// ── FR-2 ───────────────────────────────────────────────────────────────────

describe("FR-2: nested jars read to depth 3 within one budget", () => {
  // outer → alpha (1) → beta (2) → gamma (3) → delta (4, not read).
  const chain = (): Uint8Array =>
    jar(
      cube("outer:base"),
      ["outer"],
      [
        {
          file: "alpha-1.2.0.jar",
          group: "com.example.alpha",
          artifact: "alpha",
          version: "1.2.0",
          modIds: ["alpha"],
          files: cube("alpha:one"),
          nested: [
            {
              file: "beta.jar",
              modIds: ["beta"],
              files: cube("beta:two"),
              nested: [
                {
                  file: "gamma.jar",
                  modIds: ["gamma"],
                  files: cube("gamma:three"),
                  nested: [
                    {
                      file: "delta.jar",
                      modIds: ["delta"],
                      files: cube("delta:four"),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    );

  it("reads three levels of nested jars into the pack, under the outer jar", async () => {
    const { data, nestedJars } = await extract(
      pack([mod("Outer", 1, chain())]),
    );
    expect(idsOf(data)).toEqual([
      "alpha:one",
      "beta:two",
      "gamma:three",
      "outer:base",
    ]);
    expect(new Set(data.blocks.map((b) => b.mod))).toEqual(new Set(["cf-1"]));
    expect(
      nestedJars.map((n) => [n.artifact, n.version, n.modIds, n.kept]),
    ).toEqual([
      ["alpha", "1.2.0", ["alpha"], true],
      [null, null, ["beta"], true],
      [null, null, ["gamma"], true],
    ]);
  });

  it("reports each nested jar's group, artifact, version, mod ids and blocks", () => {
    const parsed = parseModJar(chain());
    expect(MAX_NESTED_JAR_DEPTH).toBe(3);
    expect(parsed.modIds).toEqual(["outer"]);
    expect(parsed.nestedJars).toEqual([
      {
        path: "META-INF/jarjar/alpha-1.2.0.jar",
        group: "com.example.alpha",
        artifact: "alpha",
        version: "1.2.0",
        modIds: ["alpha"],
        blockIds: ["alpha:one"],
        depth: 1,
      },
      expect.objectContaining({
        path: "META-INF/jarjar/alpha-1.2.0.jar!/META-INF/jarjar/beta.jar",
        modIds: ["beta"],
        blockIds: ["beta:two"],
        depth: 2,
      }),
      expect.objectContaining({
        modIds: ["gamma"],
        blockIds: ["gamma:three"],
        depth: 3,
      }),
    ]);
    expect(parsed.warnings).toEqual([
      expect.stringMatching(
        /^Skipped nested jar .*delta\.jar: jars nested more than 3 deep/,
      ),
    ]);
  });

  it("charges nested content to the outer jar's budget", async () => {
    const name = "assets/big/textures/block/x.png";
    const inner = zipSync({ [name]: new Uint8Array(8) });
    // Declare the nested entry nearly the whole budget.
    const view = new DataView(inner.buffer);
    for (let i = 0; i + 46 <= inner.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, MAX_ASSET_BYTES - 64, true);
      }
    }
    const outer = zipSync({
      "META-INF/jarjar/big.jar": inner,
      ...cube("outer:base"),
      "assets/outer/textures/block/pad.png": new Uint8Array(256),
    });
    const { data } = await extract(pack([mod("Outer", 1, outer)]));
    expect(data.mods[0]).toMatchObject({
      status: "skipped-too-large",
      message: expect.stringMatching(/too large/),
    });
  });
});

// ── FR-3 ───────────────────────────────────────────────────────────────────

describe("FR-3: one copy of each nested mod across the pack", () => {
  const lib = (version: string, block: string): Nested => ({
    file: `lib-${version}.jar`,
    artifact: "lib",
    version,
    modIds: ["lib"],
    files: cube(block),
  });

  it("keeps the highest version, none when a top-level jar is the mod, attributed to the outer jar", async () => {
    const { data, nestedJars } = await extract(
      pack([
        mod(
          "Alpha",
          1,
          jar(cube("alpha:block"), ["alpha"], [lib("1.0", "lib:old_block")]),
        ),
        mod(
          "Beta",
          2,
          jar(
            cube("beta:block"),
            ["beta"],
            [
              lib("2.0", "lib:new_block"),
              {
                file: "top-0.9.jar",
                artifact: "top",
                version: "0.9",
                modIds: ["top"],
                files: cube("top:nested_copy"),
              },
            ],
          ),
        ),
        mod("Top", 3, jar(cube("top:real"), ["top"])),
        // Only nested mods: still `ok`.
        mod(
          "Shell",
          4,
          jar(
            {},
            ["shell"],
            [
              {
                file: "inner.jar",
                artifact: "inner",
                version: "1",
                modIds: ["inner"],
                files: cube("inner:thing"),
              },
            ],
          ),
        ),
      ]),
    );
    expect(data.blocks.map((b) => [b.id, b.mod])).toEqual([
      ["alpha:block", "cf-1"],
      ["beta:block", "cf-2"],
      ["inner:thing", "cf-4"],
      ["lib:new_block", "cf-2"],
      ["top:real", "cf-3"],
    ]);
    expect(data.mods.map((m) => [m.key, m.status])).toEqual([
      ["cf-1", "ok"],
      ["cf-2", "ok"],
      ["cf-3", "ok"],
      ["cf-4", "ok"],
    ]);
    expect(
      nestedJars.map((n) => [n.outer, n.artifact, n.kept, n.reason]),
    ).toEqual([
      ["alpha.jar", "lib", false, "lib 2.0 is read from beta.jar"],
      ["beta.jar", "lib", true, undefined],
      ["beta.jar", "top", false, "mod top is a top-level jar (top.jar)"],
      ["shell.jar", "inner", true, undefined],
    ]);
  });
});

// ── FR-4 and FR-5 ──────────────────────────────────────────────────────────

/** Dyenamics-style jar: own blocks, compat blocks and two compat packs. */
function dnf(): Uint8Array {
  return jar(
    {
      ...cube("dyenamicsandfriends:peach_wool"),
      ...cube("dyenamicsandfriends:quark_peach_chest"),
      ...cube("dyenamicsandfriends:botanypots_peach_pot"),
      ...cube(
        "dyenamicsandfriends:alpha_peach_bed",
        RED,
        "compat_packs/alpha/assets",
      ),
      ...cube(
        "dyenamicsandfriends:supplementaries_peach_flag",
        RED,
        "compat_packs/supplementaries/assets",
      ),
    },
    ["dyenamicsandfriends"],
  );
}

describe("FR-4: compat_packs merged only for mods in the pack, upload only", () => {
  it("merges compat_packs/<modid>/assets/ when the pack has <modid>", async () => {
    const { data, compatPacks } = await extract(
      pack([
        mod("Dyenamics and Friends", 1, dnf()),
        mod("Alpha", 2, jar(cube("alpha:block"), ["alpha"])),
      ]),
    );
    expect(idsOf(data)).toContain("dyenamicsandfriends:alpha_peach_bed");
    expect(idsOf(data)).not.toContain(
      "dyenamicsandfriends:supplementaries_peach_flag",
    );
    expect(blockOf(data, "dyenamicsandfriends:alpha_peach_bed")).toMatchObject({
      mod: "cf-1",
      swatch: { file: "cf-1" },
    });
    expect(compatPacks).toEqual([
      { mod: "Dyenamics and Friends", modId: "alpha", blocks: 1 },
    ]);
  });

  it("enables a compat pack for a mod nested in another jar", async () => {
    const { data } = await extract(
      pack([
        mod("Dyenamics and Friends", 1, dnf()),
        mod(
          "Shell",
          2,
          jar({}, ["shell"], [{ file: "alpha.jar", modIds: ["alpha"] }]),
        ),
      ]),
    );
    expect(idsOf(data)).toContain("dyenamicsandfriends:alpha_peach_bed");
  });

  it("keeps compat packs out of the Advanced Editor's blocks", () => {
    const parsed = parseModJar(dnf());
    const ids = parsed.blocks.map((b) => b.id);
    expect(ids).not.toContain("dyenamicsandfriends:alpha_peach_bed");
    expect(ids).not.toContain("dyenamicsandfriends:supplementaries_peach_flag");
    expect(Object.keys(parsed.compatPacks).sort()).toEqual([
      "alpha",
      "supplementaries",
    ]);
    // The worker strips them before posting the result to the editor.
    const worker = readFileSync(
      path.join(ROOT, "src/lib/mods/mod-jar.worker.ts"),
      "utf8",
    );
    expect(worker).toContain("result.compatPacks = {};");
  });
});

describe("FR-5: compat blocks dropped when the pack lacks their mod", () => {
  it("drops prefixed blocks of absent mods and keeps unprefixed ones", async () => {
    expect(COMPAT_BLOCK_PREFIXES.dyenamicsandfriends.quark_).toBe("quark");
    const { data, droppedCompatBlocks } = await extract(
      pack([
        mod("Dyenamics and Friends", 1, dnf()),
        mod("Botany Pots", 2, jar(cube("botanypots:pot"), ["botanypots"])),
      ]),
    );
    expect(idsOf(data)).toEqual([
      "botanypots:pot",
      "dyenamicsandfriends:botanypots_peach_pot",
      "dyenamicsandfriends:peach_wool",
    ]);
    expect(droppedCompatBlocks).toEqual([
      {
        namespace: "dyenamicsandfriends",
        prefix: "quark_",
        modId: "quark",
        count: 1,
      },
    ]);
  });
});

// ── FR-6 to FR-9: the block list ───────────────────────────────────────────

describe("FR-6: --block-list makes the pack's modded ids exactly the list's", () => {
  it("drops unlisted blocks and adds listed ones bare (the CLI)", () => {
    const modded = CLI_BLOCK_LIST.split("\n").filter(
      (l) => l !== "" && !l.startsWith("#") && !l.startsWith("minecraft:"),
    );
    expect(idsOf(cliListed.data)).toEqual([...modded].sort());
    expect(idsOf(cliPlain.data)).toEqual(
      expect.arrayContaining(["beta:frame", "beta:stale"]),
    );
    for (const id of ["alpha:sludge", "ghost:block"]) {
      const bare = blockOf(cliListed.data, id)!;
      expect(bare).toMatchObject({
        properties: {},
        defaults: {},
        kind: "unknown",
      });
      expect(bare).not.toHaveProperty("appearance");
      expect(bare).not.toHaveProperty("swatch");
    }
    // Described blocks keep their data.
    expect(blockOf(cliListed.data, "lib:new_block")?.appearance).toBeDefined();
  }, 120_000);

  it("fails on a line that isn't a block id", async () => {
    const bad = path.join(tmp, "bad-list.txt");
    writeFileSync(bad, "minecraft:stone\nnot a block\n");
    await expect(
      uploadCli([
        "--instance",
        path.join(tmp, "instance"),
        "--block-list",
        bad,
        "--dry-run",
        "--out",
        path.join(tmp, "out-bad"),
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/line 2/),
    });
  }, 60_000);
});

describe("FR-7: bare blocks' names and mods", () => {
  it("names them from lang entries and gives them their namespace's mod, else block-list", () => {
    const sludge = blockOf(cliListed.data, "alpha:sludge")!;
    expect(sludge.displayName).toBe("Alpha Sludge");
    const alphaMod = cliListed.data.mods.find((m) =>
      m.namespaces.includes("alpha"),
    );
    expect(sludge.mod).toBe(alphaMod?.key);

    const ghost = blockOf(cliListed.data, "ghost:block")!;
    expect(ghost.mod).toBe(BLOCK_LIST_MOD_KEY);
    expect(ghost.displayName).toBe("Block");
    expect(
      cliListed.data.mods.find((m) => m.key === BLOCK_LIST_MOD_KEY),
    ).toMatchObject({
      name: "Server block list",
      namespaces: ["ghost", "kubejs"],
      status: "ok",
    });
    // The synthetic mod isn't one of the pack's mods.
    expect(cliListed.data.version.modCount).toBe(3);
  });
});

describe("FR-8: the list's minecraft: ids are checked, vanilla data untouched", () => {
  it("warns about a mismatch (the CLI)", () => {
    expect(cliListed.stderr).toMatch(
      /warning: .*1 listed id isn't a vanilla block, 2 vanilla blocks aren't listed \(e\.g\. .*minecraft:copper_golem_statue/,
    );
    expect(cliPlain.stderr).not.toMatch(/vanilla block/);
    expect(
      idsOf(cliListed.data).some((id) => id.startsWith("minecraft:")),
    ).toBe(false);
  });

  it("keeps every vanilla block of the version in the tools", async () => {
    const extraction = await extract(
      pack([mod("Alpha", 1, jar(cube("alpha:gear"), ["alpha"]))]),
      {
        blockList: list(["minecraft:stone", "alpha:gear"]),
        vanillaBlockIds: ["minecraft:stone", "minecraft:dirt"],
      },
    );
    expect(extraction.warnings).toEqual([
      expect.stringMatching(
        /1 vanilla block isn't listed \(e\.g\. minecraft:dirt\)/,
      ),
    ]);
    const blob = await published(extraction);
    const found = await structured<{ results: Look[] }>(
      blob,
      searchBlocksTool,
      {
        query: "minecraft:dirt",
        modpack: "discovery-pack",
      },
    );
    expect(found.results.map((r) => r.id)).toContain("minecraft:dirt");
  });
});

describe("FR-9: blockList in the pack record and list_modpacks", () => {
  it("stores { blocks, sha256 } and reports block_list: true", async () => {
    expect(MODPACK_FORMAT_VERSION).toBe(1);
    const listed = await extract(
      pack([mod("Alpha", 1, jar(cube("alpha:gear"), ["alpha"]))]),
      { blockList: list(["minecraft:stone", "alpha:gear"], "ab".repeat(32)) },
    );
    expect(listed.data.blockList).toEqual({
      blocks: 2,
      sha256: "ab".repeat(32),
    });
    const plain = await extract({
      ...pack([mod("Alpha", 1, jar(cube("alpha:gear"), ["alpha"]))]),
      name: "Plain Pack",
    });
    expect(plain.data).not.toHaveProperty("blockList");
    expect(() => modpackDataSchema.parse(plain.data)).not.toThrow();

    const sha = createHash("sha256").update(CLI_BLOCK_LIST).digest("hex");
    expect(cliListed.data.blockList).toEqual({ blocks: 9, sha256: sha });

    const blob = await published(listed, plain);
    const { packs } = await structured<{ packs: Record<string, unknown>[] }>(
      blob,
      listModpacksTool,
      {},
    );
    expect(packs.find((p) => p.slug === "discovery-pack")?.block_list).toBe(
      true,
    );
    expect(packs.find((p) => p.slug === "plain-pack")).not.toHaveProperty(
      "block_list",
    );
  });
});

// ── FR-10 to FR-12: kubejs/assets ──────────────────────────────────────────

/** Industry: three blue cubes. */
const industry = () =>
  jar(
    {
      ...cube("industry:machine"),
      ...cube("industry:casing"),
      ...cube("industry:plain"),
    },
    ["industry"],
  );

/**
 * kubejs/assets: a new blockstate (with `lit`) and red texture for
 * `industry:machine`, a green texture for `industry:casing`, and a
 * runtime-registered `kubejs:magical_soil`.
 */
function kubejsAssets(): Files {
  return {
    "assets/industry/blockstates/machine.json": json({
      variants: {
        "lit=false": { model: "industry:block/machine_kjs" },
        "lit=true": { model: "industry:block/machine_kjs" },
      },
    }),
    "assets/industry/models/block/machine_kjs.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "industry:block/machine_kjs" },
    }),
    "assets/industry/textures/block/machine_kjs.png": solidPng(RED),
    "assets/industry/textures/block/casing.png": solidPng(GREEN),
    ...cube("kubejs:magical_soil", GREEN),
    ...lang("kubejs", { "block.kubejs.magical_soil": "Magical Soil" }),
  };
}

describe("FR-10: kubejs/assets overrides the jars' assets", () => {
  it("recomputes properties, kind, appearance and swatch of the blocks it changes", async () => {
    const before = await extract(pack([mod("Industry", 1, industry())]));
    const after = await extract(
      pack([mod("Industry", 1, industry())], kubejsAssets()),
    );
    const sheet = after.packSheets[0];
    expect(sheet).toMatch(/^pack-[0-9a-f]{16}$/);
    expect(blockOf(after.data, "industry:machine")).toMatchObject({
      properties: { lit: ["false", "true"] },
      defaults: { lit: "false" },
      kind: "block",
      swatch: { file: sheet },
    });
    for (const id of ["industry:machine", "industry:casing"]) {
      expect(blockOf(after.data, id)?.appearance?.hex).not.toBe(
        blockOf(before.data, id)?.appearance?.hex,
      );
    }
    expect(blockOf(after.data, "industry:plain")).toEqual(
      blockOf(before.data, "industry:plain"),
    );
    expect(after.kubejs).toMatchObject({ overridden: 2, added: 0, ignored: 1 });
  });

  it("is read from an instance folder and from a CurseForge pack zip", async () => {
    const dir = mkdtempSync(path.join(tmp, "kubejs-instance-"));
    writeFiles(path.join(dir, "overrides", "kubejs"), kubejsAssets());
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        minecraft: {
          version: "1.21.1",
          modLoaders: [{ id: "neoforge-21.1.77", primary: true }],
        },
        manifestType: "minecraftModpack",
        name: "Exported",
        version: "4.0",
        files: [],
        overrides: "overrides",
      }),
    );
    const source = await readInstanceFolder(dir);
    expect(await source.readKubeJsAssets!()).toEqual(kubejsAssets());

    const zip = zipSync(
      Object.fromEntries(
        Object.entries(kubejsAssets()).map(([name, bytes]) => [
          `overrides/kubejs/${name}`,
          bytes,
        ]),
      ),
    );
    expect(readPackZipKubeJsAssets(zip, "overrides")).toEqual(kubejsAssets());
  });
});

describe("FR-11: kubejs/assets-only ids need the block list", () => {
  it("ignores them without a list and adds listed ones with full data", async () => {
    const plain = await extract(
      pack([mod("Industry", 1, industry())], kubejsAssets()),
    );
    expect(idsOf(plain.data)).not.toContain("kubejs:magical_soil");
    expect(plain.kubejs?.ignored).toBe(1);

    const listed = await extract(
      pack([mod("Industry", 1, industry())], kubejsAssets()),
      {
        blockList: list(["industry:plain", "kubejs:magical_soil"]),
      },
    );
    const soil = blockOf(listed.data, "kubejs:magical_soil")!;
    expect(soil).toMatchObject({
      mod: BLOCK_LIST_MOD_KEY,
      displayName: "Magical Soil",
      kind: "block",
      fullCube: true,
      swatch: { file: listed.packSheets[0] },
    });
    expect(soil.appearance).toBeDefined();
    expect(listed.kubejs).toMatchObject({ added: 1, ignored: 0 });
    // Described from kubejs/assets, so not counted as a bare add.
    expect(listed.blockList?.added).toBe(0);
  });
});

describe("FR-12: a content-keyed kubejs swatch sheet", () => {
  it("writes mod-files/pack-<hash>/swatches.png", async () => {
    const extraction = await extract(
      pack([mod("Industry", 1, industry())], kubejsAssets()),
    );
    const key = extraction.packSheets[0];
    const png = extraction.swatches.get(key)!;
    expect(key).toBe(
      `pack-${createHash("sha256").update(png).digest("hex").slice(0, 16)}`,
    );
    const blob = await published(extraction);
    expect(blob.objects.get(modFileSwatchesPath(key))?.body).toEqual(png);
    // The jar's own sheet is still written, unchanged by kubejs/assets.
    const jarOnly = await extract(pack([mod("Industry", 1, industry())]));
    expect(blob.objects.get(modFileSwatchesPath("cf-1"))?.body).toEqual(
      jarOnly.swatches.get("cf-1"),
    );
  });
});

// ── FR-13 ──────────────────────────────────────────────────────────────────

describe("FR-13: blocks with a block model and lang name but no blockstate", () => {
  it("adds them with a single-variant blockstate and a look", async () => {
    const bees = jar(
      {
        ...modelOnly("bees:hive_core"),
        ...modelOnly("bees:frames/wooden"),
        // A dotted key, a key without a model, and a key whose block has a
        // blockstate: none adds a block.
        ...modelOnly("bees:tooltip"),
        ...cube("bees:apiary"),
        ...lang("bees", {
          "block.bees.hive_core": "Hive Core",
          "block.bees.frames/wooden": "Wooden Frame",
          "block.bees.tooltip.extra": "Tooltip",
          "block.bees.no_model": "No Model",
          "block.bees.apiary": "Apiary",
        }),
      },
      ["bees"],
      [
        {
          file: "nested-bees.jar",
          modIds: ["nestedbees"],
          files: {
            ...modelOnly("nestedbees:comb"),
            ...lang("nestedbees", { "block.nestedbees.comb": "Comb" }),
          },
        },
      ],
    );
    const { data } = await extract(pack([mod("Bees", 1, bees)]));
    expect(idsOf(data)).toEqual([
      "bees:apiary",
      "bees:frames/wooden",
      "bees:hive_core",
      "nestedbees:comb",
    ]);
    expect(blockOf(data, "bees:hive_core")).toMatchObject({
      displayName: "Hive Core",
      properties: {},
      kind: "block",
      fullCube: true,
      swatch: { file: "cf-1" },
    });
    expect(blockOf(data, "bees:hive_core")?.appearance).toBeDefined();
    expect(blockOf(data, "nestedbees:comb")?.mod).toBe("cf-1");

    const parsed = parseModJar(bees);
    expect(parsed.blockstates["bees:hive_core"]).toEqual({
      variants: { "": { model: "bees:block/hive_core" } },
    });
    expect(parsed.nestedJars[0].blockIds).toEqual(["nestedbees:comb"]);
  });
});

// ── FR-14 ──────────────────────────────────────────────────────────────────

describe("FR-14: MCP tools and blocks without visual information", () => {
  let blob: FakeBlob;
  beforeEach(async () => {
    const extraction = await extract(
      pack([mod("Industry", 1, industry())], kubejsAssets()),
      {
        blockList: list([
          "industry:machine",
          "industry:sludge",
          "kubejs:magical_soil",
        ]),
      },
    );
    blob = await published(extraction);
  });
  const ref = { modpack: "discovery-pack" };

  it("search_blocks says visual_info: false, without colour fields", async () => {
    const { results, note } = await structured<{
      results: Look[];
      note?: string;
    }>(blob, searchBlocksTool, { query: "industry:", ...ref });
    const sludge = results.find((r) => r.id === "industry:sludge");
    expect(sludge).toEqual({
      id: "industry:sludge",
      kind: "unknown",
      mod: "Industry",
      shape_confidence: "low",
      full_cube: false,
      visual_info: false,
    });
    const machine = results.find((r) => r.id === "industry:machine");
    expect(machine).not.toHaveProperty("visual_info");
    expect(machine?.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(note).toContain("visual_info: false");
  });

  it("show_blocks draws them as a placeholder", async () => {
    const result = await call(blob, showBlocksTool, {
      blocks: ["industry:sludge", "industry:machine"],
      ...ref,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content.some((c) => c.type === "image")).toBe(true);
    const data = result.structuredContent as { blocks: Look[]; note?: string };
    expect(data.blocks[0]).toEqual({
      id: "industry:sludge",
      mod: "Industry",
      kind: "unknown",
      visual_info: false,
    });
    expect(data.blocks[1]).not.toHaveProperty("visual_info");
    expect(data.note).toContain(`"${NO_VISUAL_INFO_LABEL}" tiles`);
  });

  it("suggest_palette never picks them", async () => {
    for (const color of ["#000000", "#808080", "#ffffff", "#2828c8"]) {
      const { blocks } = await structured<{ blocks: Look[] }>(
        blob,
        suggestPaletteTool,
        { color, count: 50, ...ref },
      );
      expect(blocks.map((b) => b.id)).not.toContain("industry:sludge");
    }
    const asReference = await call(blob, suggestPaletteTool, {
      reference_block: "industry:sludge",
      ...ref,
    });
    expect(asReference.isError).toBe(true);
  });
});

// ── FR-15 ──────────────────────────────────────────────────────────────────

describe("FR-15: the CLI summary", () => {
  it("reports nested mods, compat packs and blocks, the block list and kubejs/assets", () => {
    const plain = cliPlain.stdout;
    expect(plain).toContain("Nested mods read (1):\n  lib 2.0 from beta.jar");
    expect(plain).toContain(
      "Nested copies skipped (1):\n  lib 1.0 in alpha.jar: lib 2.0 is read from beta.jar",
    );
    expect(plain).toContain(
      "Compat packs read (1):\n  compat_packs/alpha from dnf: 1 blocks",
    );
    expect(plain).toContain(
      "Compat blocks for absent mods dropped (1):\n  dyenamicsandfriends:quark_* (needs quark): 1",
    );
    expect(plain).toContain(
      "kubejs/assets:\n  Blocks overridden: 1\n  Blocks added: 0\n  Blockstates of blocks no jar has, ignored without --block-list: 2",
    );
    expect(plain).not.toContain("Block list:");
    expect(plain).toMatch(
      /Models and textures from other jars:\n {2}Blocks given a look from another jar: \d+\n {2}Jars re-read: \d+\n {2}Ids no jar has: \d+\n/,
    );

    const listed = cliListed.stdout;
    expect(listed).toContain(
      "Block list: 9 ids\n  Blocks not on the list dropped (2):\n    beta: 2\n  Listed blocks added with unknown looks: 2",
    );
    expect(listed).toContain(
      "kubejs/assets:\n  Blocks overridden: 1\n  Blocks added: 1\n",
    );
    expect(listed).not.toContain("ignored without --block-list");
  });
});

// ── FR-16 ──────────────────────────────────────────────────────────────────

describe("FR-16: docs, USAGE and tool descriptions", () => {
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("describe the upload's block sources and the block list", () => {
    const claude = read("CLAUDE.md");
    for (const phrase of [
      "lenient-json.ts",
      "META-INF/jarjar/",
      "compat_packs/<modid>/assets/",
      "modpacks/compat-blocks.ts",
      "--block-list <file>",
      "kubejs/assets/",
      "pack-<first 16 hex",
      "inferLangModelBlockstates",
      "visual_info: false",
    ]) {
      expect(claude).toContain(phrase);
    }
    const docs = read("docs/mcp.md");
    for (const phrase of [
      "read leniently",
      "META-INF/jarjar/",
      "compat_packs/<modid>/",
      "`--block-list <file>`",
      "kubejs/assets/",
      "block_list: true",
      "visual_info: false",
      "no visual information",
      "nested mods read",
    ]) {
      expect(docs).toContain(phrase);
    }
    const usage = read("scripts/upload-modpack.mts");
    expect(usage).toMatch(/--block-list <f>\s+The server's block dump/);
    expect(usage).toContain("kubejs/assets/");
  });

  it("tell agents about visual_info and block_list", async () => {
    expect(searchBlocksTool.description).toContain("visual_info: false");
    expect(suggestPaletteTool.description).toContain("visual_info: false");
    expect(showBlocksTool.description).toContain(NO_VISUAL_INFO_LABEL);
    expect(listModpacksTool.description).toContain("block_list");
  });
});
