// Reads the hardcoded "special textures" Every Compat and its addons register
// for `findFirstBlockTextureLocation` (EC `CompatSpritesHelper.
// addHardcodedSprites`, the addons' `SpriteExtra`s) and Stone Zone's
// hardcoded model ids (`CompatSpritesHelper.addHardcodedModel`).

import { matchBracket, splitArgs, unescapeJava } from "./java.ts";
import type { JavaClass, SourceIndex } from "./source-index.ts";
import type { Addon } from "./modules.ts";

export interface SpecialTexture {
  block: string;
  label: string;
  texture: string;
  unlessLoaded?: string;
}

function literal(arg: string, cls: JavaClass): string | null {
  // "a" + "b" concatenations of literals and MOD_ID constants
  const parts = arg.split("+").map((p) => p.trim());
  let out = "";
  for (const part of parts) {
    if (/^"(?:[^"\\]|\\.)*"$/.test(part)) out += unescapeJava(part);
    else if (/^(EveryCompat|StoneZone|GemsRealm)\.MOD_ID$/.test(part)) {
      out += {
        EveryCompat: "everycomp",
        StoneZone: "stonezone",
        GemsRealm: "gemsrealm",
      }[part.split(".")[0]];
    } else return null;
  }
  void cls;
  return out;
}

function unlessLoaded(src: string, at: number): string | undefined {
  // the innermost enclosing `if (!PlatHelper.isModLoaded("x")) {`
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        const head = src.slice(Math.max(0, i - 200), i);
        const m =
          /if\s*\(\s*!\s*PlatHelper\.isModLoaded\(\s*"([^"]+)"\s*\)\s*\)\s*$/.exec(
            head,
          );
        return m?.[1];
      }
      depth--;
    }
  }
  return undefined;
}

function methodBody(
  cls: JavaClass,
  name: string,
): { body: string; offset: number } | null {
  const m = new RegExp(String.raw`void\s+${name}\s*\(\s*\)\s*\{`).exec(cls.src);
  if (m === null) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBracket(cls.src, open);
  return { body: cls.src.slice(open, close + 1), offset: open };
}

export function readSpecialTextures(
  index: SourceIndex,
  addon: Addon,
  warnings: string[],
): SpecialTexture[] {
  const out: SpecialTexture[] = [];
  const helpers = index.classes.filter(
    (c) =>
      c.repo === addon &&
      (c.name === "CompatSpritesHelper" || c.name === "CompatSpriteHelper"),
  );
  for (const cls of helpers) {
    const method =
      methodBody(cls, "addHardcodedSprites") ??
      methodBody(cls, "initHardcodedSprite");
    if (method === null) continue;
    const re =
      /\b(addOptional|addOptionalInEC|TextureCache\.registerSpecialTextureForBlock)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(method.body)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(method.body, open);
      const args = splitArgs(method.body.slice(open + 1, close));
      re.lastIndex = close;
      const unless = unlessLoaded(method.body, m.index);
      let entry: SpecialTexture | null = null;
      if (m[1] === "TextureCache.registerSpecialTextureForBlock") {
        const block = /^Blocks\.(\w+)$/.exec(args[0]);
        const label = literal(args[1], cls);
        const tex = /^EveryCompat\.res\(\s*"([^"]+)"\s*\)$/.exec(args[2]);
        if (block && label !== null && tex) {
          entry = {
            block: `minecraft:${block[1].toLowerCase()}`,
            label,
            texture: `everycomp:${tex[1]}`,
          };
        }
      } else if (args.length === 3) {
        const [block, label, texture] = args.map((a) => literal(a, cls));
        if (block !== null && label !== null && texture !== null) {
          entry = {
            block,
            label,
            texture:
              m[1] === "addOptionalInEC"
                ? `everycomp:${texture}`
                : texture.includes(":")
                  ? texture
                  : `minecraft:${texture}`,
          };
        }
      } else if (args.length === 4) {
        const [mod, path, label, texture] = args.map((a) => literal(a, cls));
        if (
          mod !== null &&
          path !== null &&
          label !== null &&
          texture !== null
        ) {
          entry = {
            block: `${mod}:${path}`,
            label,
            texture: `${mod}:${texture}`,
          };
        }
      }
      if (entry === null) {
        // the helper methods' own definitions have parameter names
        if (!/^String\s|^currentSprite\./.test(args[0] ?? "")) {
          warnings.push(
            `${cls.file}: unreadable special texture ${args.join(", ")}`,
          );
        }
        continue;
      }
      out.push(
        unless === undefined ? entry : { ...entry, unlessLoaded: unless },
      );
    }
  }
  return out;
}

/** Stone Zone `CompatSpritesHelper.addHardcodedModel`: block path → model id. */
export function readHardcodedModels(
  index: SourceIndex,
  addon: Addon,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cls of index.classes) {
    if (cls.repo !== addon || !/^CompatSprites?Helper$/.test(cls.name))
      continue;
    const method = methodBody(cls, "addHardcodedModel");
    if (method === null) continue;
    for (const m of method.body.matchAll(
      /addToModelId\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)/g,
    )) {
      out[unescapeJava(m[1])] = unescapeJava(m[2]);
    }
  }
  return out;
}

/** `addOtherCompatMod(modId, woods…, blocks…)` calls of an addon. */
export function readOtherCompatMods(
  index: SourceIndex,
  addon: Addon,
): { modId: string; woodsFrom: string[]; blocksFrom: string[] }[] {
  const out: { modId: string; woodsFrom: string[]; blocksFrom: string[] }[] =
    [];
  for (const cls of index.classes) {
    if (cls.repo !== addon || !/Common$|Forge$|Fabric$/.test(cls.name))
      continue;
    const re = /\baddOtherCompatMod\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cls.src)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(cls.src, open);
      re.lastIndex = close;
      const args = splitArgs(cls.src.slice(open + 1, close));
      if (!/^"/.test(args[0] ?? "")) continue;
      const strings = (a: string) =>
        [...a.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) =>
          unescapeJava(`"${x[1]}"`),
        );
      const modId = strings(args[0])[0];
      const woodsFrom = strings(args[1]);
      const blocksFrom = args.slice(2).flatMap(strings);
      out.push({ modId, woodsFrom, blocksFrom });
    }
  }
  return out;
}
