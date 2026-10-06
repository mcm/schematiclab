// `list_modpacks`: the modpacks uploaded to this server (`pnpm modpack:upload`),
// with the refs the block-aware tools take as `modpack`.

import { z } from "zod";
import {
  loadModpack,
  loadModpackIndex,
  type ResolvedModpack,
} from "../modpacks/reader";
import { formatModpackRef } from "../modpacks/ref";
import {
  MOD_STATUSES,
  type ModStatus,
  type ModpackIndexEntry,
  type ModpackIndexVersion,
} from "../modpacks/schema";
import { defineTool, jsonResult, type McpDeps } from "./types";

const OPERATOR_NOTE =
  "Modpacks are added by the server's operator; they can't be loaded from here.";

type SkippedStatus = Exclude<ModStatus, "ok">;
const SKIPPED_STATUSES = MOD_STATUSES.filter(
  (s): s is SkippedStatus => s !== "ok",
);

export interface ModpackVersionInfo {
  ref: string;
  display_version: string;
  minecraft_version: string;
  loader: string;
  mod_count: number;
  uploaded_at: string;
}

export interface ModpackInfo {
  slug: string;
  name: string;
  versions: ModpackVersionInfo[];
  /** Of the newest version: mods per status other than `ok`. */
  skipped_mods?: Record<SkippedStatus, number>;
  /** Of the newest version: blocks registered at runtime, not in the data. */
  unsupported_sources?: { kind: string; name: string; message: string }[];
  /** Why the newest version's details couldn't be read. */
  details_error?: string;
}

export interface ListModpacksResult {
  packs: ModpackInfo[];
  note?: string;
}

/** Lower-case letters and digits only: `All the Mods 10` → `allthemods10`. */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Abbreviations from initials, numbers kept whole: `all-the-mods-10` and
 * `All the Mods 10` → `atm10`, `SkyFactory 4` → `sf4`.
 */
export function modpackAbbreviations(pack: {
  slug: string;
  name: string;
}): string[] {
  const out = new Set<string>();
  for (const text of [pack.slug, pack.name]) {
    const words = text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/)
      .filter((w) => w.length > 0)
      .map((w) => w.toLowerCase());
    const abbreviation = words
      .map((w) => (/^[0-9]+$/.test(w) ? w : w[0]))
      .join("");
    if (abbreviation.length >= 2) out.add(abbreviation);
  }
  return [...out];
}

/**
 * Case-insensitive: the query (letters and digits only) is part of the slug
 * or name, or the start of an abbreviation (`ATM` finds every All the Mods).
 */
export function modpackMatches(
  pack: { slug: string; name: string },
  query: string,
): boolean {
  const q = compact(query);
  if (q.length === 0) return true;
  if (compact(pack.slug).includes(q) || compact(pack.name).includes(q)) {
    return true;
  }
  return modpackAbbreviations(pack).some((a) => a.startsWith(q));
}

function newestFirst(versions: ModpackIndexVersion[]): ModpackIndexVersion[] {
  return [...versions].sort(
    (a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt),
  );
}

/**
 * The ref that pins a version: its pack file id, else its display version
 * (which, with several uploads of one display version, means the newest).
 */
function versionRef(slug: string, v: ModpackIndexVersion): string {
  return formatModpackRef({
    slug,
    version: v.packFileId !== null ? String(v.packFileId) : v.displayVersion,
  });
}

async function packInfo(
  pack: ModpackIndexEntry,
  blob: NonNullable<McpDeps["blob"]>,
): Promise<ModpackInfo> {
  const versions = newestFirst(pack.versions);
  const info: ModpackInfo = {
    slug: pack.slug,
    name: pack.name,
    versions: versions.map((v) => ({
      ref: versionRef(pack.slug, v),
      display_version: v.displayVersion,
      minecraft_version: v.minecraftVersion,
      loader: v.loader,
      mod_count: v.modCount,
      uploaded_at: v.uploadedAt,
    })),
  };
  const newest = versions[0];
  if (!newest) return info;
  try {
    const resolved: ResolvedModpack = { pack, version: newest };
    const data = await loadModpack(resolved, blob);
    const skipped = Object.fromEntries(
      SKIPPED_STATUSES.map((s) => [s, 0]),
    ) as Record<SkippedStatus, number>;
    for (const mod of data.mods) {
      if (mod.status !== "ok") skipped[mod.status] += 1;
    }
    info.skipped_mods = skipped;
    info.unsupported_sources = data.runtimeBlockSources.map((s) => ({
      kind: s.kind,
      name: s.name,
      message: s.message,
    }));
  } catch (err) {
    info.details_error = err instanceof Error ? err.message : String(err);
  }
  return info;
}

export async function listModpacks(
  args: { query?: string },
  deps: Pick<McpDeps, "blob">,
): Promise<ListModpacksResult> {
  if (!deps.blob) {
    return {
      packs: [],
      note: `No modpacks: this server has no Blob store configured. ${OPERATOR_NOTE}`,
    };
  }
  const blob = deps.blob;
  const index = await loadModpackIndex(blob);
  if (index.packs.length === 0) {
    return {
      packs: [],
      note: `No modpacks are uploaded yet. ${OPERATOR_NOTE}`,
    };
  }
  const query = args.query?.trim() ?? "";
  const matching = index.packs
    .filter((p) => modpackMatches(p, query))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (matching.length === 0) {
    return {
      packs: [],
      note: `No uploaded modpack matches '${query}' (uploaded: ${index.packs
        .map((p) => p.slug)
        .sort()
        .join(", ")}). ${OPERATOR_NOTE}`,
    };
  }
  return { packs: await Promise.all(matching.map((p) => packInfo(p, blob))) };
}

const versionOutput = z.object({
  ref: z.string(),
  display_version: z.string(),
  minecraft_version: z.string(),
  loader: z.string(),
  mod_count: z.number(),
  uploaded_at: z.string(),
});

export const listModpacksTool = defineTool({
  name: "list_modpacks",
  title: "List modpacks",
  description:
    "List the modpacks uploaded to this server, to find the modpack ref a block-aware tool takes (search_blocks, suggest_palette, show_blocks, inspect/convert/render_schematic, generate_shape, compile_build, check_build). Per pack: slug (the ref for its latest upload), name and versions newest first, each with a pinned ref, its Minecraft version, loader and mod count; for the newest version, how many mods were skipped or failed (their blocks are missing) and the runtime block sources (KubeJS, generated-block mods) whose blocks aren't known. query matches slug, name or initials case-insensitively ('ATM10' finds all-the-mods-10). Packs are added by the server's operator.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Part of a pack's slug or name, or its initials (e.g. 'ATM10'). Leave out to list every pack.",
      ),
  }),
  outputSchema: z.object({
    packs: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        versions: z.array(versionOutput),
        skipped_mods: z.record(z.string(), z.number()).optional(),
        unsupported_sources: z
          .array(
            z.object({
              kind: z.string(),
              name: z.string(),
              message: z.string(),
            }),
          )
          .optional(),
        details_error: z.string().optional(),
      }),
    ),
    note: z.string().optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) =>
    jsonResult({ ...(await listModpacks(args, deps)) }),
});
