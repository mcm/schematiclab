// Every Blob pathname of uploaded modpack data, built here and nowhere else.
// None of them may start with the MCP output prefix (`mcp/`): the cleanup
// cron deletes old files under it, and pack data must outlive it.

import { BLOB_KEY_PATTERN, MODPACK_SLUG_PATTERN } from "./schema.ts";

export const MODPACKS_PREFIX = "modpacks/";
export const MOD_FILES_PREFIX = "mod-files/";

/** Every prefix modpack data is stored under. */
export const MODPACK_BLOB_PREFIXES = [MODPACKS_PREFIX, MOD_FILES_PREFIX];

export function modpackIndexPath(): string {
  return `${MODPACKS_PREFIX}index.json`;
}

export function modpackDataPath(slug: string, versionKey: string): string {
  if (!MODPACK_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid modpack slug "${slug}".`);
  }
  return `${MODPACKS_PREFIX}${slug}/${checkKey(versionKey)}/pack.json.gz`;
}

export function modFileSwatchesPath(fileKey: string): string {
  return `${MOD_FILES_PREFIX}${checkKey(fileKey)}/swatches.png`;
}

function checkKey(key: string): string {
  if (!BLOB_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid modpack Blob key "${key}".`);
  }
  return key;
}
