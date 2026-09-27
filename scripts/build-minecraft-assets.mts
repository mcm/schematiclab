// Builds the static Minecraft asset bundle used by the 3D preview.
//
// Outputs to `public/minecraft-assets/`:
//   - atlas.png          — pre-stitched block texture atlas (mcmeta `atlas` branch)
//   - atlas-uvs.json     — pixel-space [x, y, w, h] per texture id (mcmeta)
//   - blockstates.json   — { <block_path>: <blockstate JSON> } (mcmeta)
//   - models.json        — { <model_path>: <block model JSON> } (mcmeta)
//   - opaque-blocks.json — { "opaque": ["minecraft:stone", ...] } (deepslate demo)
//   - entity-textures.zip — `entity/**/*.png` requested by deepslate's
//                           block-entity renderers (chests, heads, ...) that
//                           the block atlas lacks (mcmeta `assets` branch)
//   - version.json       — mcmeta's record of the Minecraft version above
//
// Every mcmeta download is pinned to one Minecraft version via mcmeta's
// per-version tags (`<id>-assets-json`, `<id>-atlas`, `<id>-assets`), so the
// files always agree. The runtime loader
// (`src/lib/render/minecraft-resources.ts`) fetches the bundle and constructs
// a deepslate `Resources` implementation.
//
// Usage:
//   node --experimental-strip-types scripts/build-minecraft-assets.mts
//   (wired up as `pnpm gen:mc-assets`). Builds the newest version on mcmeta;
//   set MCMETA_VERSION (e.g. `26.2-snapshot-8`) to rebuild a specific one.

import { execSync } from "node:child_process";
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
  execSync(`curl -sfL "${url}" -o "${outPath}"`, { stdio: "inherit" });
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

mkdirSync(OUT_DIR, { recursive: true });

const tmpRoot = "/tmp/schematiclab-mcmeta";
const tmpZip = `${tmpRoot}/assets-json.zip`;
const tmpExtract = `${tmpRoot}/extracted`;
// Start clean so a previous run's extraction can't be picked up below.
rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpExtract, { recursive: true });

const requestedVersion = process.env.MCMETA_VERSION;
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
execSync(`unzip -q -o ${tmpZip} -d ${tmpExtract}`);
const extractedRoot = readdirSync(tmpExtract).find((n) =>
  n.startsWith("misode-mcmeta-"),
);
if (!extractedRoot) throw new Error("Failed to locate extracted mcmeta root");
const mcRoot = join(tmpExtract, extractedRoot, "assets", "minecraft");

const versionFile = join(tmpExtract, extractedRoot, "version.json");
const { id: versionId } = JSON.parse(readFileSync(versionFile, "utf8")) as {
  id: string;
};
console.log(`  Minecraft ${versionId}`);
copyFileSync(versionFile, join(OUT_DIR, "version.json"));

console.log("Reading blockstates...");
const blockstates = readJsonDir(join(mcRoot, "blockstates"));
console.log(`  ${Object.keys(blockstates).length} entries`);

console.log("Reading block models...");
const blockModels = readJsonDir(join(mcRoot, "models", "block"));
console.log(`  ${Object.keys(blockModels).length} entries`);

writeFileSync(join(OUT_DIR, "blockstates.json"), JSON.stringify(blockstates));
writeFileSync(join(OUT_DIR, "models.json"), JSON.stringify(blockModels));

console.log("Downloading texture atlas + UVs...");
const atlasBase = `${MCMETA_RAW_BASE}/${versionId}-atlas/blocks`;
curl(`${atlasBase}/atlas.png`, join(OUT_DIR, "atlas.png"));
curl(`${atlasBase}/data.min.json`, join(OUT_DIR, "atlas-uvs.json"));

console.log("Downloading block-entity textures...");
const blockAtlas = JSON.parse(
  readFileSync(join(OUT_DIR, "atlas-uvs.json"), "utf8"),
) as Record<string, unknown>;
const entityTextures: Record<string, Uint8Array> = {};
for (const id of [...specialRendererTextures(blockstates)].sort()) {
  const path = id.replace(/^minecraft:/, "");
  if (path in blockAtlas || isSupersededEntityTexture(id)) continue;
  const file = join(tmpRoot, "textures", `${path}.png`);
  mkdirSync(dirname(file), { recursive: true });
  // `curl -f` fails on a 404, i.e. deepslate asks for a texture this
  // Minecraft version doesn't ship; see SUPERSEDED_ENTITY_TEXTURE_PREFIXES.
  curl(
    `${MCMETA_RAW_BASE}/${versionId}-assets/assets/minecraft/textures/${path}.png`,
    file,
  );
  entityTextures[`${path}.png`] = readFileSync(file);
}
console.log(`  ${Object.keys(entityTextures).length} textures`);
// PNGs are already compressed.
writeFileSync(
  join(OUT_DIR, "entity-textures.zip"),
  zipSync(entityTextures, { level: 0 }),
);

console.log("Downloading opaque-blocks list...");
curl(OPAQUE_BLOCKS_URL, join(OUT_DIR, "opaque-blocks.json"));

console.log("Done. Outputs in", OUT_DIR);
