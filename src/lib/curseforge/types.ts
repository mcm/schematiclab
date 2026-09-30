// Client-facing CurseForge types. These are trimmed projections of the
// upstream API objects returned by our `/api/curseforge/*` proxy routes — the
// browser never talks to api.curseforge.com directly.

export type ModLoader = "forge" | "neoforge" | "fabric" | "quilt";

export const MOD_LOADERS: readonly ModLoader[] = [
  "forge",
  "neoforge",
  "fabric",
  "quilt",
];

/** CurseForge `modLoaderType` enum values for each supported loader. */
export const MOD_LOADER_TYPE: Record<ModLoader, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

export function isModLoader(value: unknown): value is ModLoader {
  return (
    typeof value === "string" &&
    (MOD_LOADERS as readonly string[]).includes(value)
  );
}

const LOADER_TAGS: Record<string, ModLoader> = {
  forge: "forge",
  neoforge: "neoforge",
  fabric: "fabric",
  quilt: "quilt",
};

/**
 * Split a CurseForge file's `gameVersions` tags into Minecraft versions and
 * loaders, dropping everything else (`Client`, `Java 21`, …).
 */
export function splitGameVersionTags(tags: readonly unknown[]): {
  gameVersions: string[];
  loaders: ModLoader[];
} {
  const loaders: ModLoader[] = [];
  const gameVersions: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const loader = LOADER_TAGS[tag.toLowerCase()];
    if (loader) {
      if (!loaders.includes(loader)) loaders.push(loader);
    } else if (/^\d+\.\d+(\.\d+)?(-Snapshot)?$/i.test(tag)) {
      gameVersions.push(tag);
    }
  }
  return { gameVersions, loaders };
}

export interface CurseForgeModSummary {
  id: number;
  name: string;
  slug: string;
  summary: string;
  authors: string[];
  logoThumbnailUrl: string | null;
  downloadCount: number;
  websiteUrl: string | null;
  allowModDistribution: boolean;
}

export interface CurseForgeModFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  fileLength: number;
  /** ISO-8601 timestamp. */
  fileDate: string;
  /** Minecraft versions only (e.g. `1.20.1`); loader tags are in `loaders`. */
  gameVersions: string[];
  loaders: ModLoader[];
  /** False when the author disallows third-party distribution. */
  downloadable: boolean;
}

export interface CurseForgeSearchResponse {
  mods: CurseForgeModSummary[];
  pagination: { index: number; pageSize: number; totalCount: number };
}
