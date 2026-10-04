// Hand port of every palette strategy (`PaletteStrategy`) the Every Compat,
// Stone Zone and Gems Realm modules use: Every Compat's
// `net.mehvahdjukaar.every_compat.api.PaletteStrategies` and the
// module-local `registerCached(...)` strategies, Stone Zone's
// `StonePaletteStrategies` and module strategies, and Gems Realm's
// `MetalPaletteStrategies`, `DustPaletteStrategies`, module strategies and
// the deprecated `createPaletteFromRockChild` builder palette.
//
// Sources: Every Compat (https://github.com/MehVahdJukaar/WoodGood, branch
// 1.21, commit 556d936), Stone Zone (commit d17ed21) and Gems Realm (commit
// 66b66be); Every Compat and Stone Zone are by MehVahdJukaar and the
// Supplementaries Team, Gems Realm by Xelbayria, all under the Supplementaries
// Team License; this port is a derivative of them under the same terms.
//
// A strategy picks a texture of one child of the block type (the caller does
// that lookup, `findFirstBlockTextureLocation` with `predicate`), extracts
// one palette per frame (`Palette.fromAnimatedImage`, tolerance 1/170 unless
// noted) and transforms each frame's palette in place. The texture's own
// mcmeta is the target animation.
//
// Keys are `"<repo>:<DeclaringClassSimpleName>.<FIELD>"`. Fields inherited
// through `StonePaletteStrategies` / `MetalPaletteStrategies` /
// `DustPaletteStrategies` (they extend `PaletteStrategies`) resolve to the
// Every Compat key through `paletteStrategy`. Strategies made inline by a
// method call are keyed by the call (`PaletteStrategies.removeDarkestBy(2,
// log, side)`, `GemsRealmEntrySet.createPaletteFromRockChild(cluster)`).
//
// Not ported:
// - Builders Delight's `createPaletteFromPlanks(this::lessContrastPalette)`:
//   `lessContrastPalette` is not defined anywhere in the Every Compat
//   checkout, so the module doesn't compile there.
// - Stone Zone's deprecated `createPaletteFromStone` / `createPaletteFromBricks`
//   / `createPaletteFromStoneChild` and Gems Realm's `createPaletteFromBlock`
//   / `createPaletteFromBricks`: no module calls them.
// - Wilder Wild's `createPaletteFromChild` calls are commented out.
//
// Java loops that never end when a colour can't be added
// (`while (p.size() <= 9) p.increaseInner()` with a clipped mix) hang the
// game's resource thread; here they throw after making no progress, which
// skips the texture.
//
// Worker-safe: no DOM access.

import { PaletteColor } from "./colors";
import type { Palette } from "./palette";
import { extrapolateSignBlockPalette } from "./respriter";

const f = Math.fround;

/** A texture predicate of `CompatSpritesHelper` (`LOOKS_LIKE_*`), or any texture. */
export type TexturePredicateKind = "any" | "side" | "top" | "leaf";

export interface PaletteStrategySpec {
  /** Child key of the block type whose texture gives the palette; "main" = the type's main child (planks / stone / block). */
  child: string;
  /** Texture predicate for findFirstBlockTextureLocation: "any" | "side" | "top" | "leaf" (CompatSpritesHelper LOOKS_LIKE_*). */
  predicate: TexturePredicateKind;
  /** True when the child is an item (findFirstItemTextureLocation). */
  item?: boolean;
  /** Use the main child when `child` is missing (Stone Zone's *_STANDARD). */
  fallbackToMain?: boolean;
  /**
   * With `fallbackToMain`: the child whose absence switches to the main child,
   * when it isn't `child` itself (Gems Realm's `createPaletteFromRockChild`
   * checks `bricks` whatever child it reads).
   */
  fallbackWhenMissing?: string;
  /** Tolerance of the target palette (default 1/170; signs 1/300). */
  tolerance?: number;
  /** Per-frame transform of the target palettes (in place), as the Java lambda does. May depend on the block type id (e.g. a special case for one wood). */
  transform?: (palettes: Palette[], typeId: string) => void;
}

/** `targetPalette.forEach(paletteTransform)`. */
function perFrame(
  fn: (p: Palette, typeId: string) => void,
): PaletteStrategySpec["transform"] {
  return (palettes, typeId) => {
    for (const p of palettes) fn(p, typeId);
  };
}

/** `p.increaseInner()` in a `while` loop: throw instead of hanging. */
function increaseInnerOrThrow(p: Palette): void {
  const before = p.size();
  p.increaseInner();
  if (p.size() === before) {
    throw new Error("increaseInner added nothing; the Java loop never ends");
  }
}

function times(n: number, fn: () => void): void {
  for (let i = 0; i < n; i++) fn();
}

/** `PaletteStrategies.removeDarkestBy(number, childKey, whichSide)`. */
export function removeDarkestBy(
  count: number,
  child: string,
  predicate: TexturePredicateKind,
): PaletteStrategySpec {
  return {
    child,
    predicate,
    transform: perFrame((p) => {
      times(count, () => {
        p.reduceDown();
        p.increaseUp();
      });
    }),
  };
}

/** `GemsRealmEntrySet.Builder.createPaletteFromRockChild(childKey)`. */
function gemsRealmRockChild(child: string): PaletteStrategySpec {
  return {
    child,
    predicate: "any",
    fallbackToMain: true,
    fallbackWhenMissing: "bricks",
  };
}

/** Chipped `LIGHT_PALETTE` / `STRIPPED_LOG_LIGHT_PALETTE` body. */
function chippedLight(p: Palette): void {
  const leftover = p.size() - 1;
  if (leftover > 2) {
    p.reduceDown();
  } else {
    const color = p.get(0);
    color.getDarkened(); // result unused in Java
    p.add(color); // already present: a no-op
  }
}

/** `p.add(p.increaseInner())`, then removals. */
function addInner(p: Palette): void {
  p.add(p.increaseInner());
}

export const PALETTE_STRATEGIES: Record<string, PaletteStrategySpec> = {
  // ── Every Compat: PaletteStrategies ──────────────────────────────────
  "everycomp:PaletteStrategies.MAIN_CHILD": { child: "main", predicate: "any" },
  "everycomp:PaletteStrategies.PLANKS_STANDARD": {
    child: "planks",
    predicate: "any",
  },
  "everycomp:PaletteStrategies.LOG_SIDE_STANDARD": {
    child: "log",
    predicate: "side",
  },
  "everycomp:PaletteStrategies.LOG_TOP_STANDARD": {
    child: "log",
    predicate: "top",
  },
  "everycomp:PaletteStrategies.STRIPPED_LOG_TOP_STANDARD": {
    child: "stripped_log",
    predicate: "top",
  },
  "everycomp:PaletteStrategies.STRIPPED_LOG_SIDE_STANDARD": {
    child: "stripped_log",
    predicate: "side",
  },
  "everycomp:PaletteStrategies.SIGN_LIKE": {
    child: "planks",
    predicate: "any",
    tolerance: f(1 / 300),
    transform: perFrame((p) => extrapolateSignBlockPalette(p)),
  },
  "everycomp:PaletteStrategies.LOG_SIDE_REMOVE_2_DARKEST": {
    child: "log",
    predicate: "side",
    transform: perFrame((p) => {
      p.increaseUp();
      p.increaseUp();
      p.reduceDown();
      p.reduceDown();
    }),
  },
  "everycomp:PaletteStrategies.PLANKS_REMOVE_DARKEST": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.increaseUp();
      p.reduceDown();
    }),
  },
  "everycomp:PaletteStrategies.PLANKS_REMOVE_2_DARKEST": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.increaseUp();
      p.increaseUp();
      p.reduceDown();
      p.reduceDown();
    }),
  },
  "everycomp:PaletteStrategies.PLANKS_LOW_CONTRAST": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.matchLuminanceStep(f(p.getAverageLuminanceStep() * f(0.9)));
    }),
  },
  "everycomp:PaletteStrategies.WOOD_ITEM": {
    child: "main",
    predicate: "any",
    transform: perFrame((p) => extrapolateSignBlockPalette(p)),
  },
  "everycomp:PaletteStrategies.removeDarkestBy(2,log,side)": removeDarkestBy(
    2,
    "log",
    "side",
  ),

  // ── Every Compat: ChippedMainModule ──────────────────────────────────
  "everycomp:ChippedMainModule.LIGHT_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame(chippedLight),
  },
  "everycomp:ChippedMainModule.DULL_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      if (p.size() - 3 > 6) {
        p.increaseInner();
        p.remove(p.getLightest());
        p.remove(p.getDarkest());
        p.remove(p.getDarkest());
        p.remove(p.getDarkest());
      }
    }),
  },
  "everycomp:ChippedMainModule.DULLER_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      if (p.size() - 4 > 6) {
        p.remove(p.getLightest());
        p.remove(p.getLightest());
        p.remove(p.getDarkest());
        p.remove(p.getDarkest());
      }
    }),
  },
  "everycomp:ChippedMainModule.DULL_LUMINANCE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      while (p.size() < 8) increaseInnerOrThrow(p);
      if (p.size() < 17) {
        times(8, () => p.increaseInner());
        times(4, () => p.reduceUp());
        p.reduceDown();
        p.reduceDown();
      }
    }),
  },
  "everycomp:ChippedMainModule.DARK_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      if (p.size() > 25) {
        while (p.size() > 6) p.reduce();
      }
      p.increaseInner();
      p.increaseInner();
      p.increaseInner();
      p.reduceUp();
      p.reduceUp();
      p.reduceDown();
    }),
  },
  "everycomp:ChippedMainModule.DARKER_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.reduceDown();
      p.reduceUp();
    }),
  },
  "everycomp:ChippedMainModule.PANEL_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.reduceDown();
      p.increaseInner();
      p.reduceDown();
      p.increaseInner();
      p.reduceDown();
      p.increaseInner();
      p.reduceUp();
    }),
  },
  "everycomp:ChippedMainModule.POLISHED_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p, typeId) => {
      if (typeId === "arsmagicalegacy:witchwood") {
        p.matchSize(12, f(0.045));
        const darkest = p.getDarkest();
        p.reduceDown();
        p.add(darkest.getDarkened());
      } else {
        const darker = p.getDarkest(1);
        p.reduceDown();
        p.reduceDown();
        p.matchSize(11);
        p.matchLuminanceStep(f(p.getAverageLuminanceStep() * f(0.75)));
        p.add(darker);
      }
    }),
  },

  // ── Every Compat: ChippedLogModule ───────────────────────────────────
  "everycomp:ChippedLogModule.DAMAGED_PALETTE": {
    child: "log",
    predicate: "side",
    transform: perFrame((p) => {
      if (p.size() > 3) p.reduceDown();
      if (p.size() < 4) p.increaseUp();
    }),
  },
  "everycomp:ChippedLogModule.LOG_SIDE_LIGHT_PALETTE": {
    child: "log",
    predicate: "side",
    transform: perFrame((p) => {
      if (p.size() > 3) {
        p.reduceDown();
        p.reduceDown();
      }
      if (p.size() < 4) p.increaseInner();
    }),
  },
  "everycomp:ChippedLogModule.STRIPPED_LOG_LIGHT_PALETTE": {
    child: "stripped_log",
    predicate: "side",
    transform: perFrame(chippedLight),
  },

  // ── Every Compat: other modules ──────────────────────────────────────
  "everycomp:MacawDoorsModuleAbstract.PLANKS_DARKER_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      addInner(p);
      p.remove(p.getDarkest());
      p.remove(p.getLightest());
    }),
  },
  "everycomp:MacawWindowsModuleAbstract.shutterPalette": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      if (p.size() - 3 > 6) {
        p.remove(p.getLightest());
        p.remove(p.getDarkest());
        p.remove(p.getDarkest());
      }
    }),
  },
  "everycomp:StorageDrawersModule.DRAWERS_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.remove(p.getLightest());
      p.increaseInner();
      p.increaseInner();
      p.increaseInner();
      p.increaseUp();
    }),
  },
  "everycomp:StorageDrawersModule.TRIM_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.remove(p.getLightest());
      p.increaseInner();
      p.increaseUp();
    }),
  },
  "everycomp:ArchitectsPaletteModule.CUSTOM_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame(architectsPaletteCustom),
  },
  "everycomp:FarmersDelightModule.CUSTOM_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      p.reduceDown();
      if (p.size() < 9) {
        while (p.size() <= 9) increaseInnerOrThrow(p);
      } else {
        while (p.size() >= 9) p.reduce();
      }
    }),
  },
  "everycomp:DawnOfTimeModule.DULL_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      addInner(p);
      addInner(p);
      p.remove(p.getLightest());
      p.remove(p.getDarkest());
      p.remove(p.getDarkest());
    }),
  },
  "everycomp:QuarkModule.BOOKSHELF_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      const l0 = p.getDarkest();
      times(4, () => p.increaseDown());
      p.remove(l0);
    }),
  },
  "everycomp:XercaModule.NEUTRAL_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      addInner(p);
      p.reduceDown();
      p.reduceUp();
    }),
  },
  "everycomp:XercaModule.DARK_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      addInner(p);
      p.reduceDown();
      times(2, () => p.reduceUp());
    }),
  },
  "everycomp:XercaModule.DARKER_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      addInner(p);
      p.reduceDown();
      times(3, () => p.reduceUp());
    }),
  },
  "everycomp:XercaModule.DARKEST_PALETTE": {
    child: "planks",
    predicate: "any",
    transform: perFrame((p) => {
      addInner(p);
      p.reduceDown();
      p.reduceDown();
      times(3, () => p.reduceUp());
    }),
  },

  // ── Stone Zone ───────────────────────────────────────────────────────
  "stonezone:StonePaletteStrategies.BRICKS_STANDARD": {
    child: "bricks",
    predicate: "any",
    fallbackToMain: true,
  },
  "stonezone:StonePaletteStrategies.SMOOTH_STANDARD": {
    child: "smooth",
    predicate: "any",
    fallbackToMain: true,
  },
  "stonezone:StonePaletteStrategies.POLISHED_STANDARD": {
    child: "polished",
    predicate: "any",
    fallbackToMain: true,
  },
  // VanillaStoneChildKeys.STONE is "block".
  "stonezone:TwigsModule.customPalette": {
    child: "block",
    predicate: "any",
    transform: perFrame((p) => {
      while (p.size() > 7) p.reduce();
      p.reduceUp();
      p.reduceUp();
    }),
  },
  "stonezone:StoneChestModule.customPalette": {
    child: "block",
    predicate: "any",
    transform: perFrame((p) => {
      while (p.size() > 4) p.reduceUp();
    }),
  },

  // ── Gems Realm ───────────────────────────────────────────────────────
  "gemsrealm:MetalPaletteStrategies.RAW_BLOCK_STANDARD": {
    child: "raw_block",
    predicate: "any",
  },
  "gemsrealm:MetalPaletteStrategies.TRAPDOOR_STANDARD": {
    child: "trapdoor",
    predicate: "any",
  },
  "gemsrealm:MetalPaletteStrategies.INGOT_STANDARD": {
    child: "ingot",
    predicate: "any",
    item: true,
  },
  "gemsrealm:DustPaletteStrategies.RAW_BLOCK_STANDARD": {
    child: "raw_block",
    predicate: "any",
  },
  "gemsrealm:RechiseledModuleM.BLOCK_LOW_CONTRAST": {
    child: "block",
    predicate: "any",
    transform: perFrame((p) => {
      p.matchLuminanceStep(f(p.getAverageLuminanceStep() * f(0.85)));
    }),
  },
  "gemsrealm:MoreBeautifulTorchesModuleC.CLUSTER_STANDARD": {
    child: "cluster",
    predicate: "any",
  },
  "gemsrealm:MoreBeautifulTorchesModuleM.RAW_BLOCK_STANDARD": {
    child: "raw_block",
    predicate: "any",
  },
  // Deprecated builder palettes: override every texture of the entry set.
  "gemsrealm:GemsRealmEntrySet.createPaletteFromRockChild(cluster)":
    gemsRealmRockChild("cluster"),
  "gemsrealm:GemsRealmEntrySet.createPaletteFromRockChild(raw_block)":
    gemsRealmRockChild("raw_block"),
  "gemsrealm:GemsRealmEntrySet.createPaletteFromRockChild(budding)":
    gemsRealmRockChild("budding"),
};

/** `ArchitectsPaletteModule.CUSTOM_PALETTE`'s lambda. */
function architectsPaletteCustom(p: Palette): void {
  while (p.size() > 7) p.remove(p.getDarkest());
  const col = p.getColorAtSlope(0.5);
  const ind = p.indexOf(col);
  const lab = col.lab;
  const newC = PaletteColor.of(lab.withLuminance(f(lab.luminance * f(1.03))));
  const dl = f(p.get(ind + 1).luminance - newC.luminance);
  p.set(ind, newC);
  const before = p.get(ind - 1);
  // `newC.luminance() - before.luminance() > dl * 1.5`: a double comparison.
  if (f(newC.luminance - before.luminance) > dl * 1.5) {
    const newBefore = PaletteColor.of(
      before.lab.withLuminance(
        f(f(before.luminance * f(0.6)) + f(f(newC.luminance + dl) * f(0.4))),
      ),
    );
    p.set(ind - 1, newBefore);
  }
}

/** Classes that extend `PaletteStrategies` and so expose its fields. */
const PALETTE_STRATEGIES_SUBCLASSES = new Set([
  "stonezone:StonePaletteStrategies",
  "gemsrealm:MetalPaletteStrategies",
  "gemsrealm:DustPaletteStrategies",
]);

/**
 * The strategy for `key`, resolving fields inherited from Every Compat's
 * `PaletteStrategies` (e.g. `stonezone:StonePaletteStrategies.MAIN_CHILD`).
 */
export function paletteStrategy(key: string): PaletteStrategySpec | undefined {
  const own = PALETTE_STRATEGIES[key];
  if (own !== undefined) return own;
  const dot = key.lastIndexOf(".");
  if (dot < 0 || !PALETTE_STRATEGIES_SUBCLASSES.has(key.slice(0, dot)))
    return undefined;
  return PALETTE_STRATEGIES[
    `everycomp:PaletteStrategies.${key.slice(dot + 1)}`
  ];
}

/** `TextureInfo`'s default strategy. */
export const DEFAULT_PALETTE_STRATEGY =
  "everycomp:PaletteStrategies.MAIN_CHILD";
