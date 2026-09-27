// Hand-curated translation rules that codegen can't infer from per-version
// block schemas. Edits here flow into `block-translations.generated.ts` the
// next time `pnpm gen:translations` runs.
//
// The diff codegen detects added/removed blocks and added/removed properties
// purely structurally. It cannot know:
//   - A removed block is actually a rename of a new one (no syntactic signal).
//   - When a property is added, what default to use (codegen has no semantic
//     prior — `false` for booleans is usually right but not always).
//   - A removed block should fall back to a substitute rather than air.
//   - A property value enum was renamed (e.g. `axis=none` → `axis=y`).
//
// Each entry below documents the version transition it covers. Renames are
// applied bidirectionally by the runtime; the rest are one-directional unless
// noted.

import type { AnchorVersion } from "./types";

export interface ManualVersionOverride {
  from: AnchorVersion;
  to: AnchorVersion;

  /** `from-name → to-name`. Applied bidirectionally at runtime. */
  renamedBlocks?: Record<string, string>;

  /**
   * When a block is removed `from → to`, substitute with this blockstate
   * string instead of dropping to air. Format: "minecraft:foo[a=b]".
   * Note: when going `to → from` the removed block didn't exist in `to` at
   * all, so this entry isn't consulted for the reverse direction.
   */
  removedFallbacks?: Record<string, string>;

  /**
   * Default value for properties newly added `from → to`. Keyed by
   * `block name → property name → default value`. Used when translating
   * forward and we need to synthesize a property that the source didn't
   * have. Codegen will detect which properties were added; this only
   * supplies the default when first-value-in-schema isn't right.
   */
  addedDefaults?: Record<string, Record<string, string>>;

  /**
   * Property-value renames within a block. `block → prop → {oldValue: newValue}`.
   * Applied bidirectionally (codegen inverts for the reverse direction).
   */
  valueRenames?: Record<string, Record<string, Record<string, string>>>;
}

export const MANUAL_OVERRIDES: readonly ManualVersionOverride[] = [
  // ── 1.13.2 → 1.14.4 ────────────────────────────────────────────────────
  // The unified `sign` / `wall_sign` blocks split into per-wood variants in
  // 1.14. Other wood types (spruce, birch, etc.) only exist on the 1.14 side,
  // so the only round-trippable rename is oak.
  {
    from: "1.13.2",
    to: "1.14.4",
    renamedBlocks: {
      "minecraft:sign": "minecraft:oak_sign",
      "minecraft:wall_sign": "minecraft:oak_wall_sign",
    },
  },

  // ── 1.16.5 → 1.17.1 ────────────────────────────────────────────────────
  // `grass_path` → `dirt_path` (cosmetic rename).
  // The 1.17 cauldron rework split `cauldron[level=N]` for N>0 into
  // `water_cauldron[level=N]`; empty cauldrons keep the bare name. We model
  // this as a removed-fallback rather than a rename because the bare
  // `cauldron` name still exists.
  {
    from: "1.16.5",
    to: "1.17.1",
    renamedBlocks: {
      "minecraft:grass_path": "minecraft:dirt_path",
    },
  },

  // ── 1.20.2 → 1.20.3 ────────────────────────────────────────────────────
  // In 1.20.3 Mojang renamed `minecraft:grass` (the short grass plant) to
  // `minecraft:short_grass` to disambiguate from `minecraft:grass_block`.
  {
    from: "1.20.2",
    to: "1.20.3",
    renamedBlocks: {
      "minecraft:grass": "minecraft:short_grass",
    },
  },

  // ── 1.21.4 → 1.21.5 ────────────────────────────────────────────────────
  // `creaking_heart[active=true|false]` became `creaking_heart_state` with
  // `uprooted` / `dormant` / `awake`. Overrides can't map one property onto
  // another, so forward translation drops `active` and uses the vanilla
  // default `uprooted` (codegen's first-value default); backward drops
  // `creaking_heart_state` and restores `active=false`.

  // ── 1.21.6 → 1.21.9 ────────────────────────────────────────────────────
  // The Copper Age drop added copper chains and renamed the original chain.
  {
    from: "1.21.6",
    to: "1.21.9",
    renamedBlocks: {
      "minecraft:chain": "minecraft:iron_chain",
    },
  },

  // Other transitions (1.14 → 1.15, 1.15 → 1.16, 1.17 → 1.18, 1.18 → 1.19,
  // 1.19 → 1.20) have not had block-name renames that affect schematic
  // interchange. New blocks (copper, deepslate, mangrove, cherry, pale oak,
  // etc.) are detected by codegen as `addedBlocks` and round-trip backward
  // by dropping to air with a warning.
];

/**
 * For 1.12 → 1.13 the flatten table from minecraft-data is the source of
 * truth (codegen reads `pc/common/legacy.json` directly). But the *reverse*
 * direction (1.13 → 1.12) has unavoidable collisions: e.g. `minecraft:water`
 * can come from legacy id 8 (flowing) or 9 (still). We bias toward the lower
 * id and metadata=0 when nothing else disambiguates; specific exceptions go
 * here.
 */
export const FLATTEN_REVERSE_OVERRIDES: Readonly<Record<string, string>> = {
  // Prefer still water (id 9) over flowing water (id 8) when reversing —
  // schematics rarely want flowing water by default.
  "minecraft:water[level=0]": "9:0",
  "minecraft:lava[level=0]": "11:0",
};
