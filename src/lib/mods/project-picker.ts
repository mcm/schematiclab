// Pure helpers behind the shared CurseForge project picker
// (`src/components/mod-project-picker.tsx`, SCHEM-60).

import type { CurseForgeModSummary } from "../curseforge/types";
import { startModLoad } from "./load-mod";
import { setNamespaceMapping } from "./mappings";

/**
 * Whether the project's author disallows third-party downloads. Its files
 * can't be fetched through the API, so it can't be added, mapped or used as
 * a replacement. Shared by the Mods tab and the project picker.
 */
export function isRestrictedProject(
  mod: Pick<CurseForgeModSummary, "allowModDistribution">,
): boolean {
  return !mod.allowModDistribution;
}

/**
 * The result whose slug equals `namespace` exactly (case-insensitive), or
 * null. Partial and fuzzy matches never count: this is the only result the
 * picker preselects. Restricted projects are never matched.
 */
export function exactSlugMatch(
  namespace: string,
  results: readonly CurseForgeModSummary[],
): CurseForgeModSummary | null {
  const wanted = namespace.trim().toLowerCase();
  if (wanted === "") return null;
  return (
    results.find(
      (mod) => mod.slug.toLowerCase() === wanted && !isRestrictedProject(mod),
    ) ?? null
  );
}

export interface MapNamespaceDeps {
  setMapping: typeof setNamespaceMapping;
  startLoad: typeof startModLoad;
  now: () => number;
}

const DEFAULT_DEPS: MapNamespaceDeps = {
  setMapping: setNamespaceMapping,
  startLoad: startModLoad,
  now: Date.now,
};

/**
 * Map `namespace` to `mod` and start loading the mod's file for
 * `sourceVersion` (the schematic's own version). The load runs in the
 * background; its progress lives in the `load-mod` store.
 */
export async function mapNamespaceToProject(
  namespace: string,
  mod: CurseForgeModSummary,
  sourceVersion: string,
  deps: MapNamespaceDeps = DEFAULT_DEPS,
): Promise<void> {
  await deps.setMapping({
    namespace,
    modId: mod.id,
    modName: mod.name,
    modSlug: mod.slug,
    logoUrl: mod.logoThumbnailUrl,
    mappedAt: deps.now(),
  });
  void deps.startLoad({ mod, gameVersion: sourceVersion, loader: null });
}
