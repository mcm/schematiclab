// Uploads a locally installed modpack's block data for the MCP tools.
//
//   pnpm modpack:upload --instance <dir> [--slug <slug>] [--version <label>]
//   pnpm modpack:upload --curseforge <slug|id> [--file <id>] [--mods-dir <dir>] [--slug …]
//   pnpm modpack:upload --instance <dir> --dry-run --out <dir>
//
// `--instance` is a CurseForge app instance folder (`minecraftinstance.json`
// + `mods/`) or an unzipped pack export (`manifest.json` + `overrides/mods/`).
// `--curseforge` downloads the pack (its latest file, or `--file`) and its
// mods from CurseForge into a temp directory removed at the end; it needs
// `CURSEFORGE_API_KEY`. Mods whose authors disallow third-party downloads,
// and jars over `CURSEFORGE_MAX_JAR_BYTES`, are skipped unless `--mods-dir`
// (an installed copy's `mods/`, a server install's will do) has the same
// file: matched by CurseForge's file name and size.
// Every jar goes through the browser's jar parser; only derived block data
// and face swatches are uploaded (see `src/lib/modpacks/extract.ts`), to the
// private Vercel Blob store under `modpacks/` and `mod-files/`.
//
// Blob credentials come from the environment, as for the MCP server:
// `vercel env pull .env.local` writes them, and this script reads
// `.env.local` when present (also for `CURSEFORGE_API_KEY`). `--dry-run` writes the same files under `--out`
// instead and needs no credentials.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { maxJarBytesFromEnv } from "../src/lib/curseforge/constants.ts";
import { decodePng } from "../src/lib/render/block-appearance.ts";
import { vanillaDescriptorSources } from "../src/lib/modpacks/appearance.ts";
import {
  UNDISTRIBUTABLE_HINT,
  withCurseForgePack,
} from "../src/lib/modpacks/curseforge-source.ts";
import {
  extractModpack,
  type ModpackSource,
} from "../src/lib/modpacks/extract.ts";
import { readInstanceFolder } from "../src/lib/modpacks/instance-folder.ts";
import { nestedJarLabel } from "../src/lib/modpacks/nested-mods.ts";
import {
  blobModpackStore,
  blobUploadCredentialsConfigured,
  countModStatuses,
  directoryModpackStore,
  MISSING_BLOB_CREDENTIALS,
  publishModpack,
  type ModpackStore,
} from "../src/lib/modpacks/publish.ts";
import { parseModpackRef } from "../src/lib/modpacks/ref.ts";
import { MOD_STATUSES, type ModpackData } from "../src/lib/modpacks/schema.ts";

const USAGE = `Usage: pnpm modpack:upload (--instance <dir> | --curseforge <slug|id> [--file <id>] [--mods-dir <dir>]) [--slug <slug>] [--version <label>] [--dry-run --out <dir>]

  --instance <dir>  CurseForge instance folder or unzipped pack export
  --curseforge <p>  CurseForge modpack slug or project id (needs CURSEFORGE_API_KEY)
  --file <id>       Pack file id with --curseforge (default: the latest file)
  --mods-dir <dir>  With --curseforge, read files that can't be downloaded
                    (undistributable or too large) from this mods folder
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
        curseforge: { type: "string" },
        file: { type: "string" },
        "mods-dir": { type: "string" },
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
  if (values.instance !== undefined && values.curseforge !== undefined) {
    fail("Pass either --instance or --curseforge, not both.");
  }
  if (values.instance === undefined && values.curseforge === undefined) {
    fail(USAGE);
  }
  if (values.file !== undefined && values.curseforge === undefined) {
    fail("--file is only used with --curseforge.");
  }
  const modsDir = values["mods-dir"];
  if (modsDir !== undefined) {
    if (values.curseforge === undefined) {
      fail("--mods-dir is only used with --curseforge.");
    }
    if (!existsSync(modsDir) || !statSync(modsDir).isDirectory()) {
      fail(`--mods-dir ${modsDir} isn't a folder.`);
    }
  }
  let fileId: number | undefined;
  if (values.file !== undefined) {
    fileId = /^[1-9]\d*$/.test(values.file) ? Number(values.file) : NaN;
    if (!Number.isSafeInteger(fileId)) {
      fail("--file must be a CurseForge file id (a positive integer).");
    }
  }
  const dryRun = values["dry-run"];
  if (dryRun && values.out === undefined) fail("--dry-run needs --out <dir>.");
  if (!dryRun && values.out !== undefined) {
    fail("--out is only used with --dry-run.");
  }

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!dryRun && !blobUploadCredentialsConfigured(process.env)) {
    fail(MISSING_BLOB_CREDENTIALS);
  }
  // `.env.local` escapes `$` as `\$` for Next.js; loadEnvFile doesn't.
  const apiKey = process.env.CURSEFORGE_API_KEY?.replace(/\\\$/g, "$");
  if (values.curseforge !== undefined && !apiKey) {
    fail(
      "--curseforge needs CURSEFORGE_API_KEY (in the environment or .env.local).",
    );
  }
  const store = dryRun
    ? directoryModpackStore(path.resolve(values.out as string))
    : blobModpackStore();

  if (values.curseforge !== undefined) {
    await withCurseForgePack(
      {
        apiKey: apiKey as string,
        project: values.curseforge,
        fileId,
        localModsDir: modsDir === undefined ? undefined : path.resolve(modsDir),
        maxJarBytes: maxJarBytesFromEnv(process.env.CURSEFORGE_MAX_JAR_BYTES),
        log: (line) => console.log(line),
      },
      (source) => upload(source, store, values, dryRun),
    );
  } else {
    const source = await readInstanceFolder(
      path.resolve(values.instance as string),
    );
    await upload(source, store, values, dryRun);
  }
}

async function upload(
  source: ModpackSource,
  store: ModpackStore,
  options: { slug?: string; version?: string },
  dryRun: boolean,
): Promise<void> {
  console.log(
    `${source.name}: Minecraft ${source.minecraftVersion ?? "?"} (${source.loader}), ${source.mods.length} mods`,
  );
  const extraction = await extractModpack(source, {
    slug: options.slug,
    displayVersion: options.version,
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
  // Plain libraries (no mods.toml) aren't listed as read: there are many.
  const nestedRead = extraction.nestedJars.filter(
    (jar) => jar.kept && jar.modIds.length > 0,
  );
  const nestedSkipped = extraction.nestedJars.filter((jar) => !jar.kept);
  if (nestedRead.length > 0) {
    console.log(`Nested mods read (${nestedRead.length}):`);
    for (const jar of nestedRead) {
      console.log(`  ${nestedJarLabel(jar)} from ${jar.outer}`);
    }
  }
  if (nestedSkipped.length > 0) {
    console.log(`Nested copies skipped (${nestedSkipped.length}):`);
    for (const jar of nestedSkipped) {
      console.log(`  ${nestedJarLabel(jar)} in ${jar.outer}: ${jar.reason}`);
    }
  }
  console.log(`Blocks: ${data.blocks.length}`);
  for (const runtime of data.runtimeBlockSources) {
    console.log(`Unsupported: ${runtime.message}`);
  }
  console.log(
    `${dryRun ? "Written" : "Uploaded"}: ${formatBytes(published.bytesWritten)} (${published.swatchesWritten} swatch sheets, ${published.swatchesSkipped} already stored)`,
  );
  console.log(`Modpack ref: ${modpackRefFor(data)}`);
  if (counts["skipped-undistributable"] > 0) {
    console.log("");
    console.log(UNDISTRIBUTABLE_HINT);
  }
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
