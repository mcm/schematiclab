import { describe, expect, it } from "vitest";

import type { GeneratedTextureImage } from "../../../types";
import {
  generateEcTexture,
  looksLikeLeafTexture,
  looksLikeSideLogTexture,
  looksLikeTopLogTexture,
  normalizeLabel,
  texturePredicate,
} from "../generate";
import { TextureImage } from "../texture-image";
import { GOLDENS, img, makePlanks, makeRespriteInputs } from "./fixtures";

// End-to-end checks of the per-texture pipeline against the Java Respriter
// goldens (see fixtures.ts): generateEcTexture must produce the same pixels
// and animation as the equivalent Moonlight calls.

const planks = makePlanks();
const { src, mask, src2, overlay } = makeRespriteInputs();
const MAIN = "everycomp:PaletteStrategies.MAIN_CHILD";

function sources(target: TextureImage): Map<string, GeneratedTextureImage> {
  return new Map([
    ["src", src.toGenerated()],
    ["src2", src2.toGenerated()],
    ["mask", mask.toGenerated()],
    ["overlay", overlay.toGenerated()],
    ["planks", target.toGenerated()],
  ]);
}

function run(
  main: TextureImage,
  target: TextureImage,
  params: Partial<Parameters<typeof generateEcTexture>[2]>,
) {
  const out = generateEcTexture(main.toGenerated(), sources(target), {
    target: "planks",
    strategy: MAIN,
    typeId: "minecraft:oak",
    ...params,
  });
  return out === null ? null : img(TextureImage.fromGenerated(out));
}

describe("generateEcTexture", () => {
  planks.forEach((target, i) => {
    it(`matches the Java respriter (planks ${i})`, () => {
      expect(run(src, target, {})).toBe(GOLDENS[`resprite.of.${i}`]);
      expect(run(src, target, { noAnimation: true })).toBe(
        GOLDENS[`resprite.of.noanim.${i}`],
      );
      expect(run(src, target, { mask: "mask" })).toBe(
        GOLDENS[`resprite.masked.${i}`],
      );
      expect(run(src, target, { copyTexture: true, mask: "mask" })).toBe(
        GOLDENS[`resprite.copy.${i}`],
      );
      expect(
        run(src2, target, {
          mask: "mask",
          mergedWith: ["src", { texture: "src2", mask: "mask" }],
        }),
      ).toBe(GOLDENS[`resprite.merged.${i}`]);
      expect(
        run(src, target, { strategy: "everycomp:PaletteStrategies.SIGN_LIKE" }),
      ).toBe(GOLDENS[`resprite.sign.${i}`]);
      expect(run(src, target, { mask: "mask", overlay: "overlay" })).toBe(
        GOLDENS[`resprite.overlay.${i}`],
      );
    });
  });

  it("writes the merged .png.mcmeta of an adopted animation", () => {
    const out = generateEcTexture(src.toGenerated(), sources(planks[3]), {
      target: "planks",
      strategy: MAIN,
      typeId: "minecraft:oak",
    });
    expect(out?.image.height).toBe(48);
    expect(out?.meta).toEqual({
      animation: {
        frametime: 2,
        interpolate: false,
        height: 16,
        width: 16,
        frames: [
          { time: 3, index: 0 },
          { time: 2, index: 2 },
          { time: 2, index: 1 },
        ],
      },
    });
    const still = generateEcTexture(src.toGenerated(), sources(planks[0]), {
      target: "planks",
      strategy: MAIN,
      typeId: "minecraft:oak",
    });
    expect(still?.meta).toBeUndefined();
  });

  it("returns null where Java skips the texture", () => {
    const base = { target: "planks", strategy: MAIN, typeId: "minecraft:oak" };
    const s = sources(planks[0]);
    expect(
      generateEcTexture(src.toGenerated(), s, { ...base, target: "nope" }),
    ).toBeNull();
    expect(
      generateEcTexture(src.toGenerated(), s, { ...base, strategy: "x:Y.Z" }),
    ).toBeNull();
    expect(
      generateEcTexture(src.toGenerated(), s, { ...base, mask: "nope" }),
    ).toBeNull();
    const blank = {
      image: { width: 16, height: 16, data: new Uint8Array(1024) },
    };
    expect(generateEcTexture(blank, s, base)).toBeNull();
    expect(
      generateEcTexture(src.toGenerated(), s, {
        ...base,
        mergedWith: ["nope"],
      }),
    ).toBeNull();
    expect(
      generateEcTexture({ image: src.toRgba(), meta: [1, 2] }, s, base),
    ).toBeNull();
  });

  it("keeps the image when the overlay is missing or too small", () => {
    const s = sources(planks[0]);
    s.set(
      "tiny",
      new TextureImage(4, 4, new Int32Array(16).fill(-1), null).toGenerated(),
    );
    const params = {
      target: "planks",
      strategy: MAIN,
      typeId: "minecraft:oak",
      mask: "mask",
    };
    for (const ov of ["tiny", "missing"]) {
      const out = generateEcTexture(src.toGenerated(), s, {
        ...params,
        overlay: ov,
      });
      expect(img(TextureImage.fromGenerated(out!))).toBe(
        GOLDENS["resprite.masked.0"],
      );
    }
  });

  it("uses the block type id for special cases", () => {
    const s = sources(planks[2]);
    const params = {
      target: "planks",
      strategy: "everycomp:ChippedMainModule.POLISHED_PALETTE",
    };
    const oak = generateEcTexture(src.toGenerated(), s, {
      ...params,
      typeId: "minecraft:oak",
    });
    const witch = generateEcTexture(src.toGenerated(), s, {
      ...params,
      typeId: "arsmagicalegacy:witchwood",
    });
    expect(oak).not.toBeNull();
    expect(witch).not.toBeNull();
    expect(oak!.image.data).not.toEqual(witch!.image.data);
  });
});

describe("texture predicates", () => {
  it("normalizes labels like ResourceLocation.tryParse", () => {
    expect(normalizeLabel("minecraft:block/oak_log_top")).toBe(
      "block/oak_log_top",
    );
    expect(normalizeLabel("block/oak_log")).toBe("block/oak_log");
    expect(normalizeLabel("#all")).toBe("all");
    expect(normalizeLabel("Mod:Block/X")).toBe("Mod:Block/X");
  });

  it("classifies log, top and leaf textures", () => {
    expect(looksLikeTopLogTexture("minecraft:block/oak_log_top")).toBe(true);
    expect(looksLikeTopLogTexture("mod:block/log_end")).toBe(true);
    expect(looksLikeTopLogTexture("mod:block/log_top_overlay")).toBe(false);
    expect(looksLikeSideLogTexture("minecraft:block/oak_log")).toBe(true);
    expect(looksLikeSideLogTexture("minecraft:block/oak_log_top")).toBe(false);
    expect(looksLikeSideLogTexture("mod:block/grass_overlay")).toBe(false);
    expect(looksLikeSideLogTexture("mod:block/oak_leaves_overlay")).toBe(true);
    expect(looksLikeLeafTexture("minecraft:block/oak_leaves")).toBe(true);
    expect(looksLikeLeafTexture("mod:block/leaves_snow")).toBe(false);
    expect(looksLikeLeafTexture("mod:block/snow/leaves")).toBe(false);
    expect(texturePredicate("any")("anything_top")).toBe(true);
    expect(texturePredicate("top")("x_up")).toBe(true);
    expect(texturePredicate("side")("x_up")).toBe(false);
    expect(texturePredicate("leaf")("x_bushy")).toBe(false);
  });
});
