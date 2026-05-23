// Builds the static Minecraft asset bundle used by the 3D preview.
//
// Outputs to `public/minecraft-assets/`:
//   - atlas.png          — pre-stitched block texture atlas (mcmeta `atlas` branch)
//   - atlas-uvs.json     — pixel-space [x, y, w, h] per texture id (mcmeta)
//   - blockstates.json   — { <block_path>: <blockstate JSON> } (mcmeta)
//   - models.json        — { <model_path>: <block model JSON> } (mcmeta)
//   - opaque-blocks.json — { "opaque": ["minecraft:stone", ...] } (deepslate demo)
//
// The runtime loader (`src/lib/render/minecraft-resources.ts`) fetches all
// five and constructs a deepslate `Resources` implementation.
//
// Usage:
//   node --experimental-strip-types scripts/build-minecraft-assets.mts
//   (wired up as `pnpm gen:mc-assets`)

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_DIR = join(REPO_ROOT, "public", "minecraft-assets");

const MCMETA_ASSETS_ZIP =
  "https://codeload.github.com/misode/mcmeta/legacy.zip/refs/heads/assets-json";
const ATLAS_PNG_URL =
  "https://raw.githubusercontent.com/misode/mcmeta/atlas/blocks/atlas.png";
const ATLAS_UVS_URL =
  "https://raw.githubusercontent.com/misode/mcmeta/atlas/blocks/data.min.json";
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
mkdirSync(tmpExtract, { recursive: true });

console.log("Downloading mcmeta assets-json branch...");
curl(MCMETA_ASSETS_ZIP, tmpZip);
console.log("Extracting...");
execSync(`unzip -q -o ${tmpZip} -d ${tmpExtract}`);
const extractedRoot = readdirSync(tmpExtract).find((n) =>
  n.startsWith("misode-mcmeta-"),
);
if (!extractedRoot) throw new Error("Failed to locate extracted mcmeta root");
const mcRoot = join(tmpExtract, extractedRoot, "assets", "minecraft");

console.log("Reading blockstates...");
const blockstates = readJsonDir(join(mcRoot, "blockstates"));
console.log(`  ${Object.keys(blockstates).length} entries`);

console.log("Reading block models...");
const blockModels = readJsonDir(join(mcRoot, "models", "block"));
console.log(`  ${Object.keys(blockModels).length} entries`);

writeFileSync(join(OUT_DIR, "blockstates.json"), JSON.stringify(blockstates));
writeFileSync(join(OUT_DIR, "models.json"), JSON.stringify(blockModels));

console.log("Downloading texture atlas + UVs...");
curl(ATLAS_PNG_URL, join(OUT_DIR, "atlas.png"));
curl(ATLAS_UVS_URL, join(OUT_DIR, "atlas-uvs.json"));

console.log("Downloading opaque-blocks list...");
curl(OPAQUE_BLOCKS_URL, join(OUT_DIR, "opaque-blocks.json"));

console.log("Done. Outputs in", OUT_DIR);
