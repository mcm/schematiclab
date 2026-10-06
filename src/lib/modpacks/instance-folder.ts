// Reads a locally installed modpack for the upload CLI: a CurseForge app
// instance folder (`minecraftinstance.json` + `mods/`) or an exported pack
// (`manifest.json` + `overrides/mods/`, or `mods/` when it was installed
// from the export). Jars the instance manifest lists get their CurseForge
// project and file ids; other jars are keyed by their SHA-256 later.
//
// Node only (`node:fs`). Imports carry their `.ts` extension so node's
// strip-types can load it.

import { existsSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  isResourcePackAssetEntry,
  resourcePackBudget,
} from "../mods/parse-mod-jar.ts";
import {
  MODPACK_MANIFEST_NAME,
  parseMinecraftInstance,
} from "../mods/modpack-instance.ts";
import type { ModpackModSource, ModpackSource } from "./extract.ts";
import {
  EXPORT_MANIFEST_NAME,
  parsePackManifest,
  toModpackLoader,
} from "./pack-manifest.ts";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Couldn't read ${file}: ${reason}`);
  }
}

/** File name → full path of every `*.jar` directly inside `dir`. */
async function jarsIn(dir: string): Promise<Map<string, string>> {
  const jars = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return jars;
  }
  for (const name of names.sort()) {
    if (!name.toLowerCase().endsWith(".jar")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isFile()) jars.set(name, full);
  }
  return jars;
}

function jarSource(
  name: string,
  file: string,
  ids: { projectId: number; fileId: number } | null,
): ModpackModSource {
  return {
    name,
    fileName: path.basename(file),
    curseForgeProjectId: ids?.projectId ?? null,
    curseForgeFileId: ids?.fileId ?? null,
    size: statSync(file).size,
    read: async () => new Uint8Array(await readFile(file)),
  };
}

/** `create-1.21.1-6.0.4.jar` → `create-1.21.1-6.0.4`. */
function nameFromJar(fileName: string): string {
  return fileName.replace(/\.jar$/i, "");
}

function byName(a: ModpackModSource, b: ModpackModSource): number {
  return a.name.localeCompare(b.name);
}

/**
 * Reads the resource pack in folder `root` (`<root>/assets/<ns>/…`): the
 * files `isResourcePackAssetEntry` accepts, within `resourcePackBudget`'s
 * limits. Symbolic links aren't followed.
 */
export async function readResourcePackFolder(
  root: string,
): Promise<Record<string, Uint8Array>> {
  const budget = resourcePackBudget(root);
  const files: Record<string, Uint8Array> = {};
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const name = `${rel}/${entry.name}`;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, name);
      } else if (entry.isFile() && isResourcePackAssetEntry(name)) {
        budget.charge((await stat(full)).size);
        files[name] = new Uint8Array(await readFile(full));
      }
    }
  };
  await walk(path.join(root, "assets"), "assets");
  return files;
}

/** Reads the first of `dirs/assets` that exists, else null. */
function kubeJsAssetsReader(
  dirs: readonly string[],
): () => Promise<Record<string, Uint8Array> | null> {
  return async () => {
    const dir = dirs.find((d) => existsSync(path.join(d, "assets")));
    return dir === undefined ? null : readResourcePackFolder(dir);
  };
}

/**
 * The pack in `dir`. Throws when the folder has neither
 * `minecraftinstance.json` nor `manifest.json`.
 */
export async function readInstanceFolder(dir: string): Promise<ModpackSource> {
  const instanceFile = path.join(dir, MODPACK_MANIFEST_NAME);
  if (existsSync(instanceFile))
    return readCurseForgeInstance(dir, instanceFile);
  const exportFile = path.join(dir, EXPORT_MANIFEST_NAME);
  if (existsSync(exportFile)) return readExportedPack(dir, exportFile);
  throw new Error(
    `${dir} has neither ${MODPACK_MANIFEST_NAME} nor ${EXPORT_MANIFEST_NAME}. Point --instance at a CurseForge instance folder or an unzipped pack export.`,
  );
}

async function readCurseForgeInstance(
  dir: string,
  instanceFile: string,
): Promise<ModpackSource> {
  const raw = await readJson(instanceFile);
  const instance = parseMinecraftInstance(raw);
  const root = asObject(raw);
  const installed = asObject(root.installedModpack);
  const installedFile = asObject(installed.installedFile);
  const manifest = asObject(root.manifest);

  const jars = await jarsIn(path.join(dir, "mods"));
  const mods: ModpackModSource[] = [];
  for (const mod of instance.mods) {
    const file = jars.get(mod.fileName);
    if (file === undefined) {
      mods.push({
        name: mod.name,
        fileName: mod.fileName,
        curseForgeProjectId: mod.modId,
        curseForgeFileId: mod.fileId,
        size: null,
        read: null,
        missingMessage: `${MODPACK_MANIFEST_NAME} lists ${mod.fileName}, but it isn't in mods/.`,
      });
      continue;
    }
    jars.delete(mod.fileName);
    mods.push(
      jarSource(mod.name, file, { projectId: mod.modId, fileId: mod.fileId }),
    );
  }
  // Jars added by hand (or disabled in the manifest but present as `.jar`).
  for (const [name, file] of jars) {
    mods.push(jarSource(nameFromJar(name), file, null));
  }
  mods.sort(byName);

  return {
    name: instance.name,
    displayVersion: str(manifest.version),
    minecraftVersion: instance.gameVersion,
    loader: toModpackLoader(instance.loader),
    curseForgeProjectId: positiveInt(installed.addonID),
    packFileId: positiveInt(installedFile.id),
    mods,
    hasKubeJs: existsSync(path.join(dir, "kubejs")),
    readKubeJsAssets: kubeJsAssetsReader([path.join(dir, "kubejs")]),
    warnings: [],
  };
}

async function readExportedPack(
  dir: string,
  exportFile: string,
): Promise<ModpackSource> {
  const raw = await readJson(exportFile);
  const manifest = parsePackManifest(raw, exportFile);
  const overrides = path.join(dir, manifest.overrides);

  const jars = new Map([
    ...(await jarsIn(path.join(overrides, "mods"))),
    ...(await jarsIn(path.join(dir, "mods"))),
  ]);
  const mods: ModpackModSource[] = [...jars].map(([name, file]) =>
    jarSource(nameFromJar(name), file, null),
  );
  const { files } = manifest;
  const warnings: string[] = [];
  const installedJars = await jarsIn(path.join(dir, "mods"));
  if (installedJars.size > 0) {
    // The manifest names projects and files but not jar names, so installed
    // jars can't be matched to their ids.
    warnings.push(
      `${EXPORT_MANIFEST_NAME} lists ${files.length} CurseForge files, which can't be matched to the jars in mods/ by name; those jars are keyed by their SHA-256.`,
    );
  } else {
    // A bare export: CurseForge files are downloaded by the launcher.
    for (const { projectId, fileId } of files) {
      mods.push({
        name: `CurseForge project ${projectId}`,
        fileName: null,
        curseForgeProjectId: projectId,
        curseForgeFileId: fileId,
        size: null,
        read: null,
        missingMessage:
          "The export doesn't include CurseForge files (the launcher downloads them). Upload an installed instance, or use --curseforge.",
      });
    }
  }
  mods.sort(byName);

  return {
    name: manifest.name ?? path.basename(path.resolve(dir)),
    displayVersion: manifest.version,
    minecraftVersion: manifest.minecraftVersion,
    loader: manifest.loader,
    curseForgeProjectId: manifest.projectId,
    packFileId: null,
    mods,
    hasKubeJs:
      existsSync(path.join(dir, "kubejs")) ||
      existsSync(path.join(overrides, "kubejs")),
    readKubeJsAssets: kubeJsAssetsReader([
      path.join(dir, "kubejs"),
      path.join(overrides, "kubejs"),
    ]),
    warnings,
  };
}
