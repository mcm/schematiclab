// Parses a CurseForge pack's `manifest.json` (the one in a pack zip or an
// unzipped export): name, version, Minecraft version, loader, overrides
// folder and the CurseForge files the launcher downloads.
//
// Pure. Imports carry their `.ts` extension so node's strip-types can load it.

import { MODPACK_LOADERS, type ModpackLoader } from "./schema.ts";

/** A pack's manifest file name. */
export const EXPORT_MANIFEST_NAME = "manifest.json";

export interface PackManifestFile {
  projectId: number;
  fileId: number;
}

export interface PackManifest {
  name: string | null;
  version: string | null;
  minecraftVersion: string;
  loader: ModpackLoader;
  /** The overrides folder, relative to the manifest (default `overrides`). */
  overrides: string;
  /** The pack's CurseForge project, when the manifest names it. */
  projectId: number | null;
  /** Required CurseForge files, in manifest order. */
  files: PackManifestFile[];
}

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

export function toModpackLoader(value: string | null): ModpackLoader {
  return value !== null &&
    (MODPACK_LOADERS as readonly string[]).includes(value)
    ? (value as ModpackLoader)
    : "unknown";
}

/**
 * The manifest `raw`. Throws (naming `where`) when it has no
 * `minecraft.version` or `files`.
 */
export function parsePackManifest(raw: unknown, where: string): PackManifest {
  const root = asObject(raw);
  const minecraft = asObject(root.minecraft);
  const minecraftVersion = str(minecraft.version);
  if (minecraftVersion === null || !Array.isArray(root.files)) {
    throw new Error(
      `${where} isn't a CurseForge pack manifest (no minecraft.version or files).`,
    );
  }
  const loaders = Array.isArray(minecraft.modLoaders)
    ? minecraft.modLoaders.map(asObject)
    : [];
  const primary = loaders.find((l) => l.primary === true) ?? loaders[0];
  const files: PackManifestFile[] = [];
  for (const file of root.files.map(asObject)) {
    if (file.required === false) continue;
    const projectId = positiveInt(file.projectID);
    const fileId = positiveInt(file.fileID);
    if (projectId !== null && fileId !== null) {
      files.push({ projectId, fileId });
    }
  }
  return {
    name: str(root.name),
    version: str(root.version),
    minecraftVersion,
    loader: toModpackLoader(
      str(primary?.id)?.split("-")[0]?.toLowerCase() ?? null,
    ),
    overrides: str(root.overrides) ?? "overrides",
    projectId: positiveInt(root.projectID),
    files,
  };
}
