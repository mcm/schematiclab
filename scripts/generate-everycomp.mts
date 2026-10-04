// Generates the Every Compat family's module tables from the mods' Java
// sources:
//
//   src/lib/mods/generated/everycomp/tables/everycomp.generated.ts
//   src/lib/mods/generated/everycomp/tables/stonezone.generated.ts
//   src/lib/mods/generated/everycomp/tables/gemsrealm.generated.ts
//
// Every Compat (Wood Good), Stone Zone and Gems Realm register their blocks
// at runtime from Java builder chains (`SimpleEntrySet.builder(...)
// .addTexture(...)...`), one module per supported mod. The app never loads
// class files, so this script reads those chains (and the module
// registrations, hardcoded sprites and Stone Zone's hardcoded models) into
// data, translating the few lambdas they use (`addModelTransform`,
// `addCondition`) to TypeScript with a whitelist (`scripts/everycomp/emit.ts`).
// Anything it can't translate is recorded on the entry set (`unsupported`)
// and printed.
//
// Inputs (each overridable by an env var, else ~/projects/<dir> or
// ../<dir>):
//   EVERYCOMP_PATH  MehVahdJukaar/WoodGood   (dir `everycomp`, branch 1.21)
//   STONEZONE_PATH  MehVahdJukaar/StoneZone  (dir `stonezone`, branch 1.21)
//   GEMSREALM_PATH  Xelbayria/GemsRealm      (dir `gemsrealm`, branch 1.21.1)
//   MOONLIGHT_PATH  MehVahdJukaar/Moonlight  (dir `moonlight`, branch 1.21)
//
// Usage:
//   node --experimental-strip-types scripts/generate-everycomp.mts
//   (also wired up as `pnpm gen:everycomp`)

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import {
  alreadySupportedMods,
  chainNames,
  entryName,
  entrySetName,
  hasCustomClientResources,
  moduleHierarchy,
  moduleShortId,
  parseChains,
  parseEntrySet,
  readRegistrations,
  type Addon,
  type ChainContext,
  type ParsedEntrySet,
} from "./everycomp/modules.ts";
import { SourceIndex, type Repo } from "./everycomp/source-index.ts";
import {
  readHardcodedModels,
  readOtherCompatMods,
  readSpecialTextures,
} from "./everycomp/sprites.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_DIR = join(REPO_ROOT, "src/lib/mods/generated/everycomp/tables");

function checkout(env: string, dir: string): string {
  const fromEnv = process.env[env];
  const candidates = [
    fromEnv,
    join(homedir(), "projects", dir),
    resolve(REPO_ROOT, "..", dir),
  ].filter((p): p is string => p !== undefined && p !== "");
  const found = candidates.find((p) =>
    existsSync(join(p, "gradle.properties")),
  );
  if (found === undefined) {
    throw new Error(`${dir} checkout not found (set ${env})`);
  }
  return found;
}

const ROOTS: Record<Repo, string> = {
  everycomp: checkout("EVERYCOMP_PATH", "everycomp"),
  stonezone: checkout("STONEZONE_PATH", "stonezone"),
  gemsrealm: checkout("GEMSREALM_PATH", "gemsrealm"),
  moonlight: checkout("MOONLIGHT_PATH", "moonlight"),
};

const ADDONS: Record<
  Addon,
  { modName: string; repository: string; tableName: string }
> = {
  everycomp: {
    modName: "Every Compat",
    repository: "https://github.com/MehVahdJukaar/WoodGood",
    tableName: "EVERYCOMP_TABLE",
  },
  stonezone: {
    modName: "Stone Zone",
    repository: "https://github.com/MehVahdJukaar/StoneZone",
    tableName: "STONEZONE_TABLE",
  },
  gemsrealm: {
    modName: "Gems Realm",
    repository: "https://github.com/Xelbayria/GemsRealm",
    tableName: "GEMSREALM_TABLE",
  },
};

function gradleProperty(root: string, key: string): string {
  const props = readFileSync(join(root, "gradle.properties"), "utf8");
  const m = new RegExp(String.raw`^\s*${key}\s*=\s*(.+?)\s*$`, "m").exec(props);
  return m?.[1] ?? "";
}

function typeNameOf(id: string): string {
  const path = id.slice(id.indexOf(":") + 1);
  return path.slice(path.lastIndexOf("/") + 1);
}

/** JS source of a value with embedded function sources (`{ $code: … }`). */
function code(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value !== null && typeof value === "object" && "$code" in value) {
    return (value as { $code: string }).$code;
  }
  if (Array.isArray(value)) return `[${value.map(code).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${entries
      .map(
        ([k, v]) =>
          `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${code(v)}`,
      )
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}

function entrySetValue(entry: ParsedEntrySet): Record<string, unknown> {
  return {
    kind: entry.kind,
    name: entry.name,
    prefix: entry.prefix,
    baseType: entry.baseType,
    baseBlock: entry.baseBlock?.includes(":") ? entry.baseBlock : undefined,
    field: entry.field,
    line: entry.line,
    textures: entry.textures.length > 0 ? entry.textures : undefined,
    mergedPalette: entry.mergedPalette || undefined,
    modelTransform: entry.modelTransform
      ? { $code: entry.modelTransform }
      : undefined,
    condition: entry.condition ? { $code: entry.condition } : undefined,
    includeModels: entry.includeModels,
    renderType: entry.renderType,
    tile: entry.tile || undefined,
    copyTint: entry.copyTint || undefined,
    unsupported: entry.unsupported.length > 0 ? entry.unsupported : undefined,
  };
}

async function main(): Promise<void> {
  const index = new SourceIndex(ROOTS);
  mkdirSync(OUT_DIR, { recursive: true });
  let failures = 0;
  for (const addon of Object.keys(ADDONS) as Addon[]) {
    const root = ROOTS[addon];
    const warnings: string[] = [];
    const registrations = readRegistrations(index, addon);
    const modules = new Map<string, Record<string, unknown>>();
    const regOut = new Map<
      string,
      {
        modId: string;
        module: string;
        platforms: Set<string>;
        requiresAnyOf?: string[];
        requiresNoneOf?: string[];
      }
    >();
    let entryCount = 0;
    let unsupportedCount = 0;
    for (const reg of registrations) {
      const key = `${reg.cls.sourceSet}:${reg.cls.name}`;
      const platforms =
        reg.sourceSet === "common" ? ["fabric", "neoforge"] : [reg.sourceSet];
      const regKey = `${reg.modId}|${key}|${JSON.stringify(reg.requiresAnyOf ?? null)}`;
      const existing = regOut.get(regKey);
      if (existing) platforms.forEach((p) => existing.platforms.add(p));
      else {
        regOut.set(regKey, {
          modId: reg.modId,
          module: key,
          platforms: new Set(platforms),
          ...(reg.requiresAnyOf ? { requiresAnyOf: reg.requiresAnyOf } : {}),
          ...(reg.requiresNoneOf ? { requiresNoneOf: reg.requiresNoneOf } : {}),
        });
      }
      if (modules.has(key)) continue;

      const shortId = moduleShortId(index, reg.cls);
      // Chains are written in the module class or its abstract parents.
      const classes = moduleHierarchy(index, reg.cls).reverse();
      const fields = new Map<string, string>();
      const entrySets: Record<string, unknown>[] = [];
      for (const cls of classes) {
        const chains = parseChains(cls.src);
        for (const chain of chains) {
          // Field names first, so requiresFromMap sees later sets too.
          if (chain.field) {
            const { name, prefix } = chainNames(chain);
            fields.set(chain.field, entrySetName(prefix, name));
          }
        }
        for (const chain of chains) {
          const ctx: ChainContext = {
            index,
            addon,
            cls,
            shortId,
            fields,
            warnings,
          };
          let parsed: ParsedEntrySet;
          try {
            parsed = parseEntrySet(ctx, chain);
          } catch (err) {
            warnings.push(
              `${cls.file}:${chain.line}: ${(err as Error).message}`,
            );
            failures++;
            continue;
          }
          if (parsed.itemOnly) continue;
          const expected = entryName(
            parsed.prefix,
            parsed.name,
            typeNameOf(parsed.baseType),
          );
          if (
            parsed.baseBlock !== null &&
            parsed.baseBlock.replace(/^minecraft:/, "") !== expected
          ) {
            warnings.push(
              `${cls.file}:${chain.line}: base block ${parsed.baseBlock} doesn't match entry name ${expected}`,
            );
          }
          entryCount++;
          if (parsed.unsupported.length > 0) unsupportedCount++;
          entrySets.push(entrySetValue(parsed));
        }
      }
      const supported = alreadySupportedMods(index, reg.cls);
      modules.set(key, {
        key,
        shortId,
        file: reg.cls.file,
        entrySets,
        alreadySupportedMods:
          supported && supported.length > 0 ? supported : undefined,
        customClientResources:
          hasCustomClientResources(index, reg.cls) || undefined,
      });
    }

    const meta = ADDONS[addon];
    const commit = execSync("git rev-parse HEAD", { cwd: root })
      .toString()
      .trim();
    const table = {
      addon,
      modName: meta.modName,
      source: {
        repository: meta.repository,
        commit,
        modVersion: gradleProperty(root, "mod_version"),
        minecraftVersion: gradleProperty(root, "minecraft_version"),
        license: "Supplementaries Team License",
      },
      modules: Object.fromEntries(
        [...modules].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
      registrations: [...regOut.values()].map((r) => ({
        ...r,
        platforms: [...r.platforms].sort(),
      })),
      otherCompatMods: readOtherCompatMods(index, addon),
      specialTextures: readSpecialTextures(index, addon, warnings),
      hardcodedModels: readHardcodedModels(index, addon),
    };

    const header = [
      "// AUTO-GENERATED by scripts/generate-everycomp.mts — do NOT edit by hand.",
      "// Regenerate with: pnpm gen:everycomp",
      "//",
      `// ${meta.modName} ${table.source.modVersion} (Minecraft ${table.source.minecraftVersion}),`,
      `// ${meta.repository} commit ${commit}.`,
      "// Copyright (c) MehVahdJukaar, Xel'Bayria and the Supplementaries Team;",
      "// licensed under the Supplementaries Team License. This table is derived",
      "// from the mod's module sources (builder chains, with their lambdas",
      "// translated to TypeScript) and credits its authors as that license asks.",
      "",
      "/* eslint-disable */",
      'import type { EcAddonTable } from "../entry-sets";',
      'import { J } from "../runtime";',
      "",
    ].join("\n");
    const body = `export const ${meta.tableName}: EcAddonTable = ${code(table)};\n`;
    const source = await format(header + body, { parser: "typescript" });
    writeFileSync(join(OUT_DIR, `${addon}.generated.ts`), source);
    console.log(
      `${addon}: ${modules.size} modules, ${table.registrations.length} registrations, ${entryCount} entry sets (${unsupportedCount} with unsupported parts), ${table.specialTextures.length} special textures`,
    );
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
  if (failures > 0) {
    console.log(`${failures} builder chain(s) could not be read.`);
  }
}

await main();
