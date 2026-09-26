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
