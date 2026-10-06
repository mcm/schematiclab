// Uploads a locally installed modpack's block data for the MCP tools.
//
//   pnpm modpack:upload --instance <dir> [--slug <slug>] [--version <label>]
//   pnpm modpack:upload --curseforge <slug|id> [--file <id>] [--mods-dir <dir>] [--slug …]
//   pnpm modpack:upload --instance <dir> --dry-run --out <dir>
//   pnpm modpack:upload (--instance <dir> | --curseforge …) --block-list <file>
//
// `--instance` is a CurseForge app instance folder (`minecraftinstance.json`
// + `mods/`) or an unzipped pack export (`manifest.json` + `overrides/mods/`).
// `--curseforge` downloads the pack (its latest file, or `--file`) and its
// mods from CurseForge into a temp directory removed at the end; it needs
// `CURSEFORGE_API_KEY`. Mods whose authors disallow third-party downloads,
// and jars over `CURSEFORGE_MAX_JAR_BYTES`, are skipped unless `--mods-dir`
// (an installed copy's `mods/`, a server install's will do) has the same
// file: matched by CurseForge's file name and size.
// `--block-list` takes a server's block dump: one block id per line, blank
// lines and `#` comments skipped. The pack data's blocks become exactly its
// modded ids: blocks it doesn't list are dropped, and listed ids no jar
// describes are added without a look (`src/lib/modpacks/block-list.ts`).
// Its `minecraft:` ids are checked against the pack version's vanilla
// blocks (a warning when they differ; vanilla data isn't changed).
// The pack's `kubejs/assets/` (or `overrides/kubejs/assets/`) is read as a
// resource pack over the jars: its blockstates, models and textures replace
// theirs, and with `--block-list` its blockstates of listed ids no jar has
// add those blocks with their looks; without one they are left out.
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

import { loadBlockData } from "../src/lib/blockdata/load.ts";
import { maxJarBytesFromEnv } from "../src/lib/curseforge/constants.ts";
import { decodePng } from "../src/lib/render/block-appearance.ts";
import { vanillaDescriptorSources } from "../src/lib/modpacks/appearance.ts";
import {
  readBlockList,
  type BlockList,
} from "../src/lib/modpacks/block-list.ts";
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

const USAGE = `Usage: pnpm modpack:upload (--instance <dir> | --curseforge <slug|id> [--file <id>] [--mods-dir <dir>]) [--slug <slug>] [--version <label>] [--block-list <file>] [--dry-run --out <dir>]

  --instance <dir>  CurseForge instance folder or unzipped pack export
  --curseforge <p>  CurseForge modpack slug or project id (needs CURSEFORGE_API_KEY)
  --file <id>       Pack file id with --curseforge (default: the latest file)
  --mods-dir <dir>  With --curseforge, read files that can't be downloaded
                    (undistributable or too large) from this mods folder
  --slug <slug>     Pack slug (default: the pack name, slugified)
  --version <label> Display version (default: the pack's own version)
  --block-list <f>  The server's block dump, one block id per line (blank
                    lines and lines starting with # skipped): the pack's
                    blocks become exactly its modded ids, and listed blocks
                    no jar describes are added (from the pack's
                    kubejs/assets/ when it has their blockstate, else with
                    unknown looks)
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

/**
 * The vanilla block ids of `minecraftVersion` (`blockdata/load.ts`), to
 * check a block list against; undefined (with a note) when unavailable.
 */
async function loadVanillaBlockIds(
  minecraftVersion: string | null,
): Promise<string[] | undefined> {
  if (minecraftVersion === null) return undefined;
  try {
    const data = await loadBlockData(minecraftVersion, { fetch });
    if (data.translateOnExport) {
      console.warn(
        `warning: Minecraft ${minecraftVersion}'s own block registry isn't available (only ${data.sourceVersion}'s flattened ids); the block list's minecraft: ids weren't checked.`,
      );
      return undefined;
    }
    return [...data.blocks.keys()];
  } catch (err) {
    console.warn(
      `warning: Couldn't load Minecraft ${minecraftVersion}'s vanilla blocks to check the block list: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
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
        "block-list": { type: "string" },
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

  let blockList: BlockList | undefined;
  const blockListPath = values["block-list"];
  if (blockListPath !== undefined) {
    if (!existsSync(blockListPath) || !statSync(blockListPath).isFile()) {
      fail(`--block-list ${blockListPath} isn't a file.`);
    }
    try {
      blockList = await readBlockList(readFileSync(blockListPath));
    } catch (err) {
      fail(
        `${blockListPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
      (source) => upload(source, store, values, blockList, dryRun),
    );
  } else {
    const source = await readInstanceFolder(
      path.resolve(values.instance as string),
    );
    await upload(source, store, values, blockList, dryRun);
  }
}

async function upload(
  source: ModpackSource,
  store: ModpackStore,
  options: { slug?: string; version?: string },
  blockList: BlockList | undefined,
  dryRun: boolean,
): Promise<void> {
  console.log(
    `${source.name}: Minecraft ${source.minecraftVersion ?? "?"} (${source.loader}), ${source.mods.length} mods`,
  );
  const vanillaBlockIds =
    blockList === undefined
      ? undefined
      : await loadVanillaBlockIds(source.minecraftVersion);
  const extraction = await extractModpack(source, {
    slug: options.slug,
    displayVersion: options.version,
    blockList,
    vanillaBlockIds,
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
  console.log(`Mods (${data.version.modCount}):`);
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
  if (extraction.compatPacks.length > 0) {
    console.log(`Compat packs read (${extraction.compatPacks.length}):`);
    for (const pack of extraction.compatPacks) {
      console.log(
        `  compat_packs/${pack.modId} from ${pack.mod}: ${pack.blocks} blocks`,
      );
    }
  }
  const { droppedCompatBlocks } = extraction;
  if (droppedCompatBlocks.length > 0) {
    const dropped = droppedCompatBlocks.reduce((n, d) => n + d.count, 0);
    console.log(`Compat blocks for absent mods dropped (${dropped}):`);
    for (const d of droppedCompatBlocks) {
      console.log(
        `  ${d.namespace}:${d.prefix}* (needs ${d.modId}): ${d.count}`,
      );
    }
  }
  if (extraction.blockList !== undefined) {
    const { listed, dropped, added } = extraction.blockList;
    console.log(`Block list: ${listed} ids`);
    const total = dropped.reduce((n, d) => n + d.count, 0);
    if (total > 0) {
      console.log(`  Blocks not on the list dropped (${total}):`);
      for (const d of dropped.slice(0, 10)) {
        console.log(`    ${d.namespace}: ${d.count}`);
      }
      if (dropped.length > 10) {
        console.log(`    …and ${dropped.length - 10} more namespaces`);
      }
    }
    console.log(`  Listed blocks added with unknown looks: ${added}`);
  }
  if (extraction.kubejs !== undefined) {
    const { overridden, added, ignored } = extraction.kubejs;
    console.log("kubejs/assets:");
    console.log(`  Blocks overridden: ${overridden}`);
    console.log(`  Blocks added: ${added}`);
    if (ignored > 0) {
      console.log(
        `  Blockstates of blocks no jar has, ignored without --block-list: ${ignored}`,
      );
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
