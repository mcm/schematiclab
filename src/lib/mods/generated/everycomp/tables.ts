// The generated module tables of the Every Compat family, one per addon.
//
// Worker-safe: no DOM access.

import type { EcAddon, EcAddonTable } from "./entry-sets";
import { EVERYCOMP_TABLE } from "./tables/everycomp.generated";
import { GEMSREALM_TABLE } from "./tables/gemsrealm.generated";
import { STONEZONE_TABLE } from "./tables/stonezone.generated";

export const EC_TABLES: Readonly<Record<EcAddon, EcAddonTable>> = {
  everycomp: EVERYCOMP_TABLE,
  stonezone: STONEZONE_TABLE,
  gemsrealm: GEMSREALM_TABLE,
};

/**
 * Special textures of every addon: the addons feed theirs into Every
 * Compat's shared `TextureCache` (`SpriteExtra`), so all of them apply.
 */
export const EC_SPECIAL_TEXTURES = Object.values(EC_TABLES).flatMap(
  (table) => table.specialTextures,
);
