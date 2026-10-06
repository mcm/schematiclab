// Reads a CurseForge app instance folder: the folder holding
// `minecraftinstance.json` and `mods/`. The manifest's `installedAddons` give
// each jar's CurseForge project and file ids, so pack mods can be registered
// exactly like mods added from the Mods tab (and downloaded from CurseForge
// when a jar is missing on disk).
//
// Pure: no DOM, no I/O. The caller supplies the parsed JSON and the picked
// files' relative paths.

import {
  MOD_LOADER_TYPE,
  isModLoader,
  splitGameVersionTags,
  type ModLoader,
} from "../curseforge/types.ts";

export const MODPACK_MANIFEST_NAME = "minecraftinstance.json";

/** One enabled mod jar listed in a modpack's manifest. */
export interface ModpackMod {
  /** CurseForge project id. */
  modId: number;
  /** CurseForge file id. */
  fileId: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  /** File name in the instance's `mods/` folder. */
  fileName: string;
  fileDisplayName: string;
  gameVersions: string[];
  loader: ModLoader | null;
}

export interface ModpackInstance {
  name: string;
  /** Minecraft version the instance runs, e.g. `1.21.1`. */
  gameVersion: string | null;
  loader: ModLoader | null;
  mods: ModpackMod[];
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

const LOADER_BY_TYPE = new Map<number, ModLoader>(
  Object.entries(MOD_LOADER_TYPE).map(([loader, type]) => [
    type,
    loader as ModLoader,
  ]),
);

/** `baseModLoader` → loader, from its type id or its `neoforge-21.1.1` name. */
function instanceLoader(baseModLoader: Json): ModLoader | null {
  const byType =
    typeof baseModLoader.type === "number"
      ? LOADER_BY_TYPE.get(baseModLoader.type)
      : undefined;
  if (byType) return byType;
  const prefix = str(baseModLoader.name)?.split("-")[0]?.toLowerCase();
  return isModLoader(prefix) ? prefix : null;
}

/** `https://www.curseforge.com/minecraft/mc-mods/jei` → `jei`. */
function slugFromUrl(url: string | null): string {
  if (url === null) return "";
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

function toModpackMod(
  raw: unknown,
  packLoader: ModLoader | null,
): ModpackMod | null {
  const addon = asObject(raw);
  const file = asObject(addon.installedFile);
  if (addon.isEnabled === false) return null;
  // Mods only: skip resource packs, shader packs, worlds.
  const section = str(asObject(addon.categorySection).path);
  if (section !== null && section !== "mods") return null;

  const modId = positiveInt(addon.addonID) ?? positiveInt(file.projectId);
  const fileId = positiveInt(file.id);
  const fileName =
    str(addon.fileNameOnDisk) ?? str(file.fileNameOnDisk) ?? str(file.fileName);
  // Disabled mods are renamed to `*.jar.disabled`.
  if (modId === null || fileId === null || fileName === null) return null;
  if (!fileName.toLowerCase().endsWith(".jar")) return null;

  const { gameVersions, loaders } = splitGameVersionTags(
    Array.isArray(file.gameVersion) ? file.gameVersion : [],
  );
  return {
    modId,
    fileId,
    name: str(addon.name) ?? fileName,
    slug: slugFromUrl(str(addon.webSiteURL)),
    logoUrl: str(addon.thumbnailUrl),
    fileName,
    fileDisplayName: str(file.displayName) ?? str(file.fileName) ?? fileName,
    gameVersions,
    // Same rule as the Mods tab: the pack's loader stands in for the filter.
    loader: packLoader ?? (loaders.length === 1 ? loaders[0] : null),
  };
}

/**
 * Parse `minecraftinstance.json`. Throws a user-facing error when the JSON
 * isn't a CurseForge instance manifest.
 */
export function parseMinecraftInstance(json: unknown): ModpackInstance {
  const root = asObject(json);
  if (!Array.isArray(root.installedAddons)) {
    throw new Error(
      `${MODPACK_MANIFEST_NAME} doesn't list any installed mods. Is this a CurseForge instance?`,
    );
  }
  const baseModLoader = asObject(root.baseModLoader);
  const loader = instanceLoader(baseModLoader);
  const mods: ModpackMod[] = [];
  const seen = new Set<number>();
  for (const addon of root.installedAddons) {
    const mod = toModpackMod(addon, loader);
    // The registry keeps one file per mod; the first listing wins.
    if (mod === null || seen.has(mod.modId)) continue;
    seen.add(mod.modId);
    mods.push(mod);
  }
  mods.sort((a, b) => a.name.localeCompare(b.name));
  return {
    name:
      str(root.name) ?? str(asObject(root.installedModpack).name) ?? "Modpack",
    gameVersion:
      str(root.gameVersion) ?? str(baseModLoader.minecraftVersion) ?? null,
    loader,
    mods,
  };
}

export interface ModpackFiles<T> {
  manifest: T;
  /** File name → file, for jars directly inside the instance's `mods/`. */
  jars: Map<string, T>;
}

/**
 * Find the manifest and mod jars among files picked from a folder. `path` is
 * the file's path relative to the picked folder's parent (the
 * `webkitRelativePath` form, `/`-separated). The shallowest manifest wins, so
 * picking a folder that contains the instance folder also works. Returns
 * null when there's no manifest.
 */
export function locateModpackFiles<T extends { path: string }>(
  files: readonly T[],
): ModpackFiles<T> | null {
  let manifest: T | null = null;
  let manifestDepth = Infinity;
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts[parts.length - 1] !== MODPACK_MANIFEST_NAME) continue;
    if (parts.length < manifestDepth) {
      manifest = file;
      manifestDepth = parts.length;
    }
  }
  if (manifest === null) return null;

  const root = manifest.path.slice(
    0,
    manifest.path.length - MODPACK_MANIFEST_NAME.length,
  );
  const modsDir = `${root}mods/`;
  const jars = new Map<string, T>();
  for (const file of files) {
    if (!file.path.startsWith(modsDir)) continue;
    const name = file.path.slice(modsDir.length);
    if (name !== "" && !name.includes("/")) jars.set(name, file);
  }
  return { manifest, jars };
}
