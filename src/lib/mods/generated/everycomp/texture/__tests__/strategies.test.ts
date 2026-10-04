import { describe, expect, it } from "vitest";

import { BASE_TOLERANCE, Palette } from "../palette";
import {
  DEFAULT_PALETTE_STRATEGY,
  PALETTE_STRATEGIES,
  paletteStrategy,
} from "../strategies";
import { GOLDENS, makePlanks, pals } from "./fixtures";

// Goldens: the strategy lambdas copied from the Every Compat / Stone Zone /
// Gems Realm sources, run on the real Moonlight `Palette` (see fixtures.ts).

const planks = makePlanks();

const goldenKeys = Object.keys(GOLDENS).filter((k) =>
  k.startsWith("strategy."),
);
const cases = new Map<string, Set<string>>();
for (const k of goldenKeys) {
  // strategy.<key>.<typeId>.<planks index>; keys and type ids contain dots.
  const rest = k.slice("strategy.".length, k.lastIndexOf("."));
  const typeStart = rest.search(/\.(minecraft|arsmagicalegacy):/);
  const key = rest.slice(0, typeStart);
  const typeId = rest.slice(typeStart + 1);
  if (!cases.has(key)) cases.set(key, new Set());
  cases.get(key)!.add(typeId);
}

describe("palette strategies", () => {
  it("cover every Java strategy with a transform", () => {
    expect(cases.size).toBeGreaterThan(30);
    for (const key of cases.keys()) {
      expect(PALETTE_STRATEGIES[key]?.transform, key).toBeTypeOf("function");
    }
  });

  for (const [key, typeIds] of cases) {
    for (const typeId of typeIds) {
      it(`${key} matches Java (${typeId})`, () => {
        const spec = PALETTE_STRATEGIES[key];
        planks.forEach((image, i) => {
          const palettes = Palette.fromAnimatedImage(
            image,
            null,
            spec.tolerance ?? BASE_TOLERANCE,
          );
          let result: string;
          try {
            spec.transform!(palettes, typeId);
            result = pals(palettes);
          } catch {
            result = "ERR";
          }
          expect(result, `planks ${i}`).toBe(
            GOLDENS[`strategy.${key}.${typeId}.${i}`],
          );
        });
      });
    }
  }

  it("resolve inherited PaletteStrategies fields and the default", () => {
    expect(
      paletteStrategy("stonezone:StonePaletteStrategies.PLANKS_STANDARD"),
    ).toBe(PALETTE_STRATEGIES["everycomp:PaletteStrategies.PLANKS_STANDARD"]);
    expect(paletteStrategy("gemsrealm:MetalPaletteStrategies.MAIN_CHILD")).toBe(
      PALETTE_STRATEGIES[DEFAULT_PALETTE_STRATEGY],
    );
    expect(paletteStrategy("everycomp:NoSuchModule.X")).toBeUndefined();
    expect(PALETTE_STRATEGIES[DEFAULT_PALETTE_STRATEGY]).toEqual({
      child: "main",
      predicate: "any",
    });
  });

  it("describe their child textures", () => {
    expect(
      PALETTE_STRATEGIES["everycomp:PaletteStrategies.LOG_TOP_STANDARD"],
    ).toMatchObject({
      child: "log",
      predicate: "top",
    });
    expect(
      PALETTE_STRATEGIES["gemsrealm:MetalPaletteStrategies.INGOT_STANDARD"]
        ?.item,
    ).toBe(true);
    expect(
      PALETTE_STRATEGIES["stonezone:StonePaletteStrategies.BRICKS_STANDARD"],
    ).toMatchObject({
      child: "bricks",
      fallbackToMain: true,
    });
    expect(
      PALETTE_STRATEGIES[
        "gemsrealm:GemsRealmEntrySet.createPaletteFromRockChild(cluster)"
      ],
    ).toMatchObject({
      child: "cluster",
      fallbackToMain: true,
      fallbackWhenMissing: "bricks",
    });
    expect(
      PALETTE_STRATEGIES["everycomp:PaletteStrategies.SIGN_LIKE"]?.tolerance,
    ).toBe(Math.fround(1 / 300));
  });
});
