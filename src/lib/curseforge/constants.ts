// CurseForge constants shared by the `/api/curseforge/*` routes and the
// modpack upload CLI (`pnpm modpack:upload --curseforge`). Import-free, so
// node's strip-types can load it.

export const CURSEFORGE_API_BASE = "https://api.curseforge.com";
export const MINECRAFT_GAME_ID = 432;
export const MODS_CLASS_ID = 6;
export const MODPACKS_CLASS_ID = 4471;

/** Jar size cap when `CURSEFORGE_MAX_JAR_BYTES` isn't set. */
export const DEFAULT_MAX_JAR_BYTES = 100 * 1024 * 1024;
/** Redirect hops followed from a CDN URL. */
export const MAX_CDN_REDIRECTS = 5;
/** Hosts mod files may be downloaded from (every redirect hop included). */
export const CURSEFORGE_CDN_HOSTS: ReadonlySet<string> = new Set([
  "edge.forgecdn.net",
  "mediafilez.forgecdn.net",
]);

/** True for an https URL on a CurseForge CDN host. */
export function isAllowedCdnUrl(url: URL): boolean {
  return url.protocol === "https:" && CURSEFORGE_CDN_HOSTS.has(url.hostname);
}

/** `CURSEFORGE_MAX_JAR_BYTES` when it's a positive integer, else the default. */
export function maxJarBytesFromEnv(raw: string | undefined): number {
  if (raw !== undefined && /^[1-9]\d*$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n)) return n;
  }
  return DEFAULT_MAX_JAR_BYTES;
}
