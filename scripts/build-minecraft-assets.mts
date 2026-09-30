// Builds the static Minecraft asset bundle used by the 3D preview.
//
// Outputs to `public/minecraft-assets/`:
//   - atlas.png          — pre-stitched block texture atlas (mcmeta `atlas` branch)
//   - atlas-uvs.json     — pixel-space [x, y, w, h] per texture id (mcmeta)
//   - blockstates.json   — { <block_path>: <blockstate JSON> } (mcmeta)
//   - models.json        — { <model_path>: <block model JSON> } (mcmeta)
//   - opaque-blocks.json — { "opaque": ["minecraft:stone", ...] } (deepslate demo)
//   - block-colors.json  — { "minecraft:stone": { oklab: [L, a, b], fullCube } }
//                          for block substitution suggestions, computed from
//                          the atlas and models above, using each block's
//                          default state from mcmeta's block summary
//                          (`src/lib/render/block-appearance.ts`)
//   - entity-textures.zip — `entity/**/*.png` requested by deepslate's
//                           block-entity renderers (chests, heads, ...) that
//                           the block atlas lacks (mcmeta `assets` branch)
//   - version.json       — mcmeta's record of the Minecraft version above
//
// Every mcmeta download is pinned to one Minecraft version via mcmeta's
// per-version tags (`<id>-assets-json`, `<id>-atlas`, `<id>-assets`,
// `<id>-summary`), so the
// files always agree. The runtime loader
// (`src/lib/render/minecraft-resources.ts`) fetches the bundle and constructs
// a deepslate `Resources` implementation.
//
// Usage:
//   node --experimental-strip-types scripts/build-minecraft-assets.mts
//   (wired up as `pnpm gen:mc-assets`). Builds the newest version on mcmeta;
//   set MCMETA_VERSION (e.g. `26.2-snapshot-8`) to rebuild a specific one.
//   Outputs are staged and only copied into `public/minecraft-assets/` once
//   every download has succeeded, so a failed run leaves the bundle as it was.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

import {
  decodePng,
  vanillaBlockColors,
  type BlockStateProperties,
} from "../src/lib/render/block-appearance.ts";
import {
  isSupersededEntityTexture,
  specialRendererTextures,
} from "../src/lib/render/special-textures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_DIR = join(REPO_ROOT, "public", "minecraft-assets");

const MCMETA_ZIP_BASE = "https://codeload.github.com/misode/mcmeta/legacy.zip";
const MCMETA_RAW_BASE = "https://raw.githubusercontent.com/misode/mcmeta";
const OPAQUE_BLOCKS_URL =
  "https://raw.githubusercontent.com/misode/deepslate/main/website/src/components/blocks.json";

function curl(url: string, outPath: string) {
  execFileSync("curl", ["-sfL", url, "-o", outPath], { stdio: "inherit" });
}

/** mcmeta version ids (`26.3`, `26.2-snapshot-8`) are used in tag URLs. */
function checkVersionId(id: string, source: string): string {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(id)) {
    throw new Error(`Invalid Minecraft version id from ${source}: ${id}`);
  }
  return id;
}

function readJsonDir(dir: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const id = entry.name.replace(/\.json$/, "");
      out[id] = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
    }
  }
  return out;
}

/** mcmeta summary `{ <block>: [properties, defaults] }` → block → defaults. */
function blockDefaultProperties(
  summary: unknown,
): Record<string, BlockStateProperties> {
  if (typeof summary !== "object" || summary === null) {
    throw new Error("Unexpected mcmeta blocks summary");
  }
  const out: Record<string, BlockStateProperties> = {};
  for (const [block, entry] of Object.entries(summary)) {
    const defaults: unknown = Array.isArray(entry) ? entry[1] : undefined;
    if (typeof defaults !== "object" || defaults === null) continue;
    out[block] = Object.fromEntries(
      Object.entries(defaults).map(([name, value]) => [name, String(value)]),
    );
  }
  return out;
}

const tmpRoot = "/tmp/schematiclab-mcmeta";
const tmpZip = `${tmpRoot}/assets-json.zip`;
const tmpExtract = `${tmpRoot}/extracted`;
const STAGE_DIR = `${tmpRoot}/out`;
// Start clean so a previous run's extraction can't be picked up below.
rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpExtract, { recursive: true });
mkdirSync(STAGE_DIR, { recursive: true });

const requestedVersion =
  process.env.MCMETA_VERSION === undefined
    ? undefined
    : checkVersionId(process.env.MCMETA_VERSION, "MCMETA_VERSION");
console.log(
  `Downloading mcmeta assets-json (${requestedVersion ?? "latest"})...`,
);
curl(
  requestedVersion
    ? `${MCMETA_ZIP_BASE}/refs/tags/${requestedVersion}-assets-json`
    : `${MCMETA_ZIP_BASE}/refs/heads/assets-json`,
  tmpZip,
);
console.log("Extracting...");
execFileSync("unzip", ["-q", "-o", tmpZip, "-d", tmpExtract]);
const extractedRoot = readdirSync(tmpExtract).find((n) =>
  n.startsWith("misode-mcmeta-"),
);
if (!extractedRoot) throw new Error("Failed to locate extracted mcmeta root");
const mcRoot = join(tmpExtract, extractedRoot, "assets", "minecraft");

const versionFile = join(tmpExtract, extractedRoot, "version.json");
const versionId = checkVersionId(
  (JSON.parse(readFileSync(versionFile, "utf8")) as { id: string }).id,
  "mcmeta version.json",
);
console.log(`  Minecraft ${versionId}`);
copyFileSync(versionFile, join(STAGE_DIR, "version.json"));

console.log("Reading blockstates...");
const blockstates = readJsonDir(join(mcRoot, "blockstates"));
console.log(`  ${Object.keys(blockstates).length} entries`);

console.log("Reading block models...");
const blockModels = readJsonDir(join(mcRoot, "models", "block"));
console.log(`  ${Object.keys(blockModels).length} entries`);

writeFileSync(join(STAGE_DIR, "blockstates.json"), JSON.stringify(blockstates));
writeFileSync(join(STAGE_DIR, "models.json"), JSON.stringify(blockModels));

console.log("Downloading texture atlas + UVs...");
const atlasBase = `${MCMETA_RAW_BASE}/${versionId}-atlas/blocks`;
curl(`${atlasBase}/atlas.png`, join(STAGE_DIR, "atlas.png"));
curl(`${atlasBase}/data.min.json`, join(STAGE_DIR, "atlas-uvs.json"));

console.log("Downloading block default states...");
// `blocks/data.min.json` maps a block path to `[properties, defaults]`; it is
// only used here, so it lives outside the staged bundle.
const blockSummaryFile = join(tmpRoot, "blocks-summary.json");
curl(
  `${MCMETA_RAW_BASE}/${versionId}-summary/blocks/data.min.json`,
  blockSummaryFile,
);
const defaultProperties = blockDefaultProperties(
  JSON.parse(readFileSync(blockSummaryFile, "utf8")),
);
console.log(`  ${Object.keys(defaultProperties).length} blocks`);

console.log("Computing block colours...");
const atlasImage = decodePng(readFileSync(join(STAGE_DIR, "atlas.png")));
if (atlasImage === null) throw new Error("Could not decode atlas.png");
const blockColors = vanillaBlockColors(
  blockstates,
  blockModels,
  atlasImage,
  JSON.parse(readFileSync(join(STAGE_DIR, "atlas-uvs.json"), "utf8")) as Record<
    string,
    unknown
  >,
  defaultProperties,
);
writeFileSync(
  join(STAGE_DIR, "block-colors.json"),
  JSON.stringify(blockColors),
);
console.log(`  ${Object.keys(blockColors).length} blocks`);

console.log("Downloading block-entity textures...");
const blockAtlas = JSON.parse(
  readFileSync(join(STAGE_DIR, "atlas-uvs.json"), "utf8"),
) as Record<string, unknown>;
const entityTextures: Record<string, Uint8Array> = {};
const missingTextures: string[] = [];
for (const id of [...specialRendererTextures(blockstates)].sort()) {
  const path = id.replace(/^minecraft:/, "");
  if (path in blockAtlas || isSupersededEntityTexture(id)) continue;
  const file = join(tmpRoot, "textures", `${path}.png`);
  mkdirSync(dirname(file), { recursive: true });
  try {
    curl(
      `${MCMETA_RAW_BASE}/${versionId}-assets/assets/minecraft/textures/${path}.png`,
      file,
    );
  } catch {
    // `curl -f` fails on a 404: this version doesn't ship the texture.
    missingTextures.push(id);
    continue;
  }
  entityTextures[`${path}.png`] = readFileSync(file);
}
if (missingTextures.length > 0) {
  throw new Error(
    `deepslate's block-entity renderers request textures Minecraft ` +
      `${versionId} doesn't ship: ${missingTextures.join(", ")}. If Minecraft ` +
      `replaced them with block models, add their prefix to ` +
      `SUPERSEDED_ENTITY_TEXTURE_PREFIXES in src/lib/render/special-textures.ts. ` +
      `public/minecraft-assets was not modified.`,
  );
}
console.log(`  ${Object.keys(entityTextures).length} textures`);
// PNGs are already compressed. A fixed mtime keeps the zip byte-identical
// across runs, so regenerating an unchanged version produces no diff.
writeFileSync(
  join(STAGE_DIR, "entity-textures.zip"),
  zipSync(entityTextures, { level: 0, mtime: "1980-01-01T00:00:00Z" }),
);

console.log("Downloading opaque-blocks list...");
curl(OPAQUE_BLOCKS_URL, join(STAGE_DIR, "opaque-blocks.json"));

// Every download succeeded; replace the bundle.
mkdirSync(OUT_DIR, { recursive: true });
for (const name of readdirSync(STAGE_DIR)) {
  copyFileSync(join(STAGE_DIR, name), join(OUT_DIR, name));
}

console.log("Done. Outputs in", OUT_DIR);
