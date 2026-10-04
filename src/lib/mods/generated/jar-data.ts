// Jar data read for generated-block providers.
//
// A provider whose mod ships its generation rules as data (Unlimited Chisel
// Works' `ucwdefs`) registers a reader here. `parseModJar` inflates the
// reader's entries alongside the render assets and stores the reader's output
// as `providerData[namespace]` on the loaded file.
//
// Worker-safe: no DOM access.

import type { LoadedModMeta, ProviderData } from "../types";
import {
  asUcwProviderData,
  countUcwRules,
  parseUcwRules,
  UCW_NAMESPACE,
  UCW_RELOAD_WARNING,
  UCW_RULE_PATH_RE,
} from "./ucw/rules";

export interface ProviderJarReader {
  /** Provider namespace; also added to the file's namespaces. */
  readonly namespace: string;
  /** The key of a jar entry the reader wants, or null to ignore the entry. */
  entryKey(name: string): string | null;
  /**
   * Plain, structured-cloneable data from the reader's entries (key → parsed
   * JSON, undefined when the JSON didn't parse). Problems go to `warnings`.
   */
  read(entries: ReadonlyMap<string, unknown>, warnings: string[]): unknown;
  /** True when `data` (from `read`) describes at least one block. */
  generatesBlocks(data: unknown): boolean;
  /** CurseForge slugs of the mod, to recognise files loaded without its data. */
  readonly curseForgeSlugs: readonly string[];
  /** Warning on a stored file of the mod loaded before the reader existed. */
  readonly reloadWarning: string;
  /**
   * Textures (`ns:path`) of a jar to keep although no blockstate reaches
   * them (masks a provider reads). Applies to every jar.
   */
  keepTexture?(id: string): boolean;
}

const UCW_READER: ProviderJarReader = {
  namespace: UCW_NAMESPACE,
  entryKey: (name) => UCW_RULE_PATH_RE.exec(name)?.[1] ?? null,
  read: parseUcwRules,
  generatesBlocks(data) {
    const rules = asUcwProviderData(data);
    return rules !== null && countUcwRules(rules) > 0;
  },
  curseForgeSlugs: ["unlimited-chisel-works"],
  reloadWarning: UCW_RELOAD_WARNING,
};

/**
 * An Every Compat family addon (Every Compat, Stone Zone, Gems Realm): its
 * jar holds no rules (those are generated from the mod's sources into
 * `everycomp/tables/`), but the masks, overlays and hand-made textures its
 * modules use, and the `block_type.*` names of its generated blocks.
 */
function everyCompatReader(
  namespace: string,
  modName: string,
  curseForgeSlugs: readonly string[],
): ProviderJarReader {
  const langPath = `assets/${namespace}/lang/en_us.json`;
  return {
    namespace,
    entryKey: (name) => (name === langPath ? "lang" : null),
    read(entries) {
      const json = entries.get("lang");
      const lang: Record<string, string> = {};
      if (typeof json === "object" && json !== null) {
        for (const [key, value] of Object.entries(json)) {
          if (key.startsWith("block_type.") && typeof value === "string") {
            lang[key] = value;
          }
        }
      }
      return { lang };
    },
    generatesBlocks: () => true,
    curseForgeSlugs,
    reloadWarning: `Reload ${modName}: it was loaded before its masks and textures were read, so its generated blocks can't be drawn`,
    keepTexture: (id) => id.startsWith(`${namespace}:`),
  };
}

export const PROVIDER_JAR_READERS: readonly ProviderJarReader[] = [
  UCW_READER,
  everyCompatReader("everycomp", "Every Compat", ["every-compat"]),
  everyCompatReader("stonezone", "Stone Zone", [
    "stone-zone",
    "every-compat-stone-zone",
  ]),
  everyCompatReader("gemsrealm", "Gems Realm", [
    "gems-realm",
    "every-compat-gems-realm",
  ]),
];

/** The reader wanting jar entry `name` and the entry's key, or null. */
export function providerJarEntry(
  name: string,
): { reader: ProviderJarReader; key: string } | null {
  for (const reader of PROVIDER_JAR_READERS) {
    const key = reader.entryKey(name);
    if (key !== null) return { reader, key };
  }
  return null;
}

/** True when some reader's data in `providerData` describes a block. */
export function providerDataGeneratesBlocks(
  providerData: ProviderData | undefined,
): boolean {
  if (providerData === undefined) return false;
  return PROVIDER_JAR_READERS.some(
    (reader) =>
      Object.hasOwn(providerData, reader.namespace) &&
      reader.generatesBlocks(providerData[reader.namespace]),
  );
}

/**
 * `meta` plus a reload warning for each reader whose mod this file is but
 * whose data wasn't read when it was loaded (files loaded before the reader
 * existed). Returns `meta` itself when nothing is missing.
 */
export function withProviderDataWarnings(meta: LoadedModMeta): LoadedModMeta {
  const read = meta.providerDataRead ?? [];
  const missing = PROVIDER_JAR_READERS.filter(
    (reader) =>
      !read.includes(reader.namespace) &&
      (meta.namespaces.includes(reader.namespace) ||
        reader.curseForgeSlugs.includes(meta.modSlug)) &&
      !(meta.warnings ?? []).includes(reader.reloadWarning),
  );
  if (missing.length === 0) return meta;
  return {
    ...meta,
    warnings: [
      ...missing.map((reader) => reader.reloadWarning),
      ...(meta.warnings ?? []),
    ],
  };
}
