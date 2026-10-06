// Uploads a locally installed modpack's block data for the MCP tools.
//
//   pnpm modpack:upload --instance <dir> [--slug <slug>] [--version <label>]
//   pnpm modpack:upload --instance <dir> --dry-run --out <dir>
//
// `--instance` is a CurseForge app instance folder (`minecraftinstance.json`
// + `mods/`) or an unzipped pack export (`manifest.json` + `overrides/mods/`).
// Every jar goes through the browser's jar parser; only derived block data
// and face swatches are uploaded (see `src/lib/modpacks/extract.ts`), to the
// private Vercel Blob store under `modpacks/` and `mod-files/`.
//
// Blob credentials come from the environment, as for the MCP server:
// `vercel env pull .env.local` writes them, and this script reads
// `.env.local` when present. `--dry-run` writes the same files under `--out`
// instead and needs no credentials.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { decodePng } from "../src/lib/render/block-appearance.ts";
import { vanillaDescriptorSources } from "../src/lib/modpacks/appearance.ts";
import { extractModpack } from "../src/lib/modpacks/extract.ts";
import { readInstanceFolder } from "../src/lib/modpacks/instance-folder.ts";
import {
  blobModpackStore,
  blobUploadCredentialsConfigured,
  countModStatuses,
  directoryModpackStore,
  MISSING_BLOB_CREDENTIALS,
  publishModpack,
} from "../src/lib/modpacks/publish.ts";
import { parseModpackRef } from "../src/lib/modpacks/ref.ts";
import { MOD_STATUSES, type ModpackData } from "../src/lib/modpacks/schema.ts";

const USAGE = `Usage: pnpm modpack:upload --instance <dir> [--slug <slug>] [--version <label>] [--dry-run --out <dir>]

  --instance <dir>  CurseForge instance folder or unzipped pack export
  --slug <slug>     Pack slug (default: the pack name, slugified)
  --version <label> Display version (default: the pack's own version)
  --dry-run         Write to --out instead of Vercel Blob
  --out <dir>       Output folder for --dry-run`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadVanillaSources() {
  const assets = path.join(process.cwd(), "public", "minecraft-assets");
  const json = (name: string) =>
    JSON.parse(readFileSync(path.join(assets, name), "utf8")) as Record<
      string,
      unknown
    >;
  const atlas = decodePng(readFileSync(path.join(assets, "atlas.png")));
  if (atlas === null) fail(`Couldn't decode ${assets}/atlas.png.`);
  return vanillaDescriptorSources({
    models: json("models.json"),
    atlas,
    uvs: json("atlas-uvs.json"),
  });
}

/** `<slug>@<display version>`, or the pack file id when the label won't parse. */
function modpackRefFor(data: ModpackData): string {
  const ref = `${data.slug}@${data.version.displayVersion}`;
  try {
    parseModpackRef(ref);
    return ref;
  } catch {
    return data.version.packFileId !== null
      ? `${data.slug}@${data.version.packFileId}`
      : data.slug;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        instance: { type: "string" },
        slug: { type: "string" },
        version: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        out: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }));
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.instance === undefined) fail(USAGE);
  const dryRun = values["dry-run"];
  if (dryRun && values.out === undefined) fail("--dry-run needs --out <dir>.");
  if (!dryRun && values.out !== undefined) {
    fail("--out is only used with --dry-run.");
  }

  if (!dryRun) {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    if (!blobUploadCredentialsConfigured(process.env)) {
      fail(MISSING_BLOB_CREDENTIALS);
    }
  }
  const store = dryRun
    ? directoryModpackStore(path.resolve(values.out as string))
    : blobModpackStore();

  const source = await readInstanceFolder(path.resolve(values.instance));
  console.log(
    `${source.name}: Minecraft ${source.minecraftVersion ?? "?"} (${source.loader}), ${source.mods.length} mods`,
  );
  const extraction = await extractModpack(source, {
    slug: values.slug,
    displayVersion: values.version,
    vanilla: loadVanillaSources(),
    onMod: (mod, index, total) => {
      const note = mod.message ? `: ${mod.message}` : "";
      console.log(`  [${index + 1}/${total}] ${mod.name} ${mod.status}${note}`);
    },
  });
  const { data } = extraction;

  console.log(`Writing to ${store.description}…`);
  const published = await publishModpack(store, extraction);

  const counts = countModStatuses(data);
  console.log("");
  for (const warning of extraction.warnings)
    console.warn(`warning: ${warning}`);
  console.log(`Mods (${data.mods.length}):`);
  for (const status of MOD_STATUSES) {
    if (counts[status] > 0) console.log(`  ${status}: ${counts[status]}`);
  }
  console.log(`Blocks: ${data.blocks.length}`);
  for (const source of data.runtimeBlockSources) {
    console.log(`Unsupported: ${source.message}`);
  }
  console.log(
    `${dryRun ? "Written" : "Uploaded"}: ${formatBytes(published.bytesWritten)} (${published.swatchesWritten} swatch sheets, ${published.swatchesSkipped} already stored)`,
  );
  console.log(`Modpack ref: ${modpackRefFor(data)}`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
