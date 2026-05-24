// Generates `src/lib/schemlib/data/block-translations.generated.ts`.
//
// Inputs:
//   - PrismarineJS/minecraft-data
//       data/pc/common/legacy.json   → 1.12 ↔ 1.13 flatten table
//       data/pc/1.13.2/blocks.json   → 1.13 anchor schema (only anchor where
//                                      mcmeta has no data — it starts at 1.14)
//   - misode/mcmeta (tagged branches)
//       <version>-summary:blocks/data.min.json   → 1.14+ anchor schemas
//   - src/lib/schemlib/data/manual-overrides.ts
//
// Output:
//   - src/lib/schemlib/data/block-translations.generated.ts
//
// Usage:
//   node --experimental-strip-types scripts/generate-block-translations.mts
//   (also wired up as `pnpm gen:translations`)
//
// Override repo locations with env vars MINECRAFT_DATA_PATH and MCMETA_PATH.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANCHOR_VERSIONS,
  type AnchorVersion,
  type AnchorSchemas,
  type VersionDiff,
} from "../src/lib/schemlib/data/types.ts";
import {
  MANUAL_OVERRIDES,
  FLATTEN_REVERSE_OVERRIDES,
  type ManualVersionOverride,
} from "../src/lib/schemlib/data/manual-overrides.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_PATH = join(
  REPO_ROOT,
  "src/lib/schemlib/data/block-translations.generated.ts",
);

const HOME = process.env.HOME ?? "";
const MINECRAFT_DATA =
  process.env.MINECRAFT_DATA_PATH ?? join(HOME, "projects/minecraft-data");
const MCMETA = process.env.MCMETA_PATH ?? join(HOME, "projects/mcmeta");

// ── Input readers ──────────────────────────────────────────────────────────

interface McdataBlock {
  name: string;
  states?: Array<{
    name: string;
    type: "enum" | "bool" | "int" | string;
    num_values: number;
    values?: string[];
  }>;
}

function readMinecraftDataBlocks(version: string): AnchorSchemas {
  const path = join(MINECRAFT_DATA, "data/pc", version, "blocks.json");
  const raw = JSON.parse(readFileSync(path, "utf-8")) as McdataBlock[];
  const out: AnchorSchemas = {};
  for (const block of raw) {
    const schema: Record<string, readonly string[]> = {};
    for (const state of block.states ?? []) {
      if (state.values && state.values.length > 0) {
        schema[state.name] = [...state.values];
      } else if (state.type === "bool") {
        schema[state.name] = ["true", "false"];
      } else if (state.type === "int") {
        schema[state.name] = Array.from({ length: state.num_values }, (_, i) =>
          String(i),
        );
      } else {
        schema[state.name] = [];
      }
    }
    out[`minecraft:${block.name}`] = schema;
  }
  return out;
}

type McmetaEntry = [
  Record<string, string[]>, // property schema: prop → allowed values
  Record<string, string>, // default state: prop → value
];

function showGitFile(repo: string, ref: string, path: string): string {
  return execSync(`git -C ${repo} show ${ref}:${path}`, {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * mcmeta splits block data across two tags: `<v>-summary` (blocks/data.min.json)
 * only contains *stateful* blocks (those with at least one property), while
 * `<v>-registries` (block/data.min.json) is a flat list of every block name.
 * We need both: the registry gives us the full block set (so we can detect
 * additions/removals of stateless blocks like `dirt_path`), and the summary
 * gives us the property schema for stateful blocks.
 */
function readMcmetaBlocks(version: AnchorVersion): AnchorSchemas {
  const fullList = JSON.parse(
    showGitFile(MCMETA, `${version}-registries`, "block/data.min.json"),
  ) as string[];
  const summary = JSON.parse(
    showGitFile(MCMETA, `${version}-summary`, "blocks/data.min.json"),
  ) as Record<string, McmetaEntry>;

  const out: AnchorSchemas = {};
  for (const name of fullList) {
    const entry = summary[name];
    const schema: Record<string, readonly string[]> = {};
    if (entry) {
      for (const [prop, values] of Object.entries(entry[0])) {
        schema[prop] = [...values];
      }
    }
    out[`minecraft:${name}`] = schema;
  }
  return out;
}

interface LegacyFile {
  blocks: Record<string, string>;
  items?: Record<string, string>;
}

function readLegacyTable(): Record<string, string> {
  const path = join(MINECRAFT_DATA, "data/pc/common/legacy.json");
  const raw = JSON.parse(readFileSync(path, "utf-8")) as LegacyFile;
  return raw.blocks;
}

// ── Diff computation ───────────────────────────────────────────────────────

function computeDiff(
  from: AnchorVersion,
  to: AnchorVersion,
  fromSchemas: AnchorSchemas,
  toSchemas: AnchorSchemas,
  override: ManualVersionOverride | undefined,
): VersionDiff {
  const fromNames = new Set(Object.keys(fromSchemas));
  const toNames = new Set(Object.keys(toSchemas));

  const renamedBlocks = override?.renamedBlocks ?? {};
  const renamedSources = new Set(Object.keys(renamedBlocks));
  const renamedTargets = new Set(Object.values(renamedBlocks));

  // Sanity-check the override: each rename source must exist in `from`, each
  // target must exist in `to`. We don't want a typo to silently lose data.
  for (const [src, tgt] of Object.entries(renamedBlocks)) {
    if (!fromNames.has(src)) {
      throw new Error(
        `Manual rename ${from}→${to}: source ${src} not in ${from} schemas`,
      );
    }
    if (!toNames.has(tgt)) {
      throw new Error(
        `Manual rename ${from}→${to}: target ${tgt} not in ${to} schemas`,
      );
    }
  }

  const addedBlocks = [...toNames]
    .filter((n) => !fromNames.has(n) && !renamedTargets.has(n))
    .sort();
  const removedBlocks = [...fromNames]
    .filter((n) => !toNames.has(n) && !renamedSources.has(n))
    .sort();

  const propertyChanges: Record<
    string,
    {
      added: Record<string, readonly string[]>;
      removed: string[];
      valueRenames: Record<string, Record<string, string>>;
    }
  > = {};

  for (const fromName of fromNames) {
    const toName = renamedBlocks[fromName] ?? fromName;
    const toSchema = toSchemas[toName];
    if (!toSchema) continue;

    const fromSchema = fromSchemas[fromName];
    const fromProps = new Set(Object.keys(fromSchema));
    const toProps = new Set(Object.keys(toSchema));

    const added: Record<string, readonly string[]> = {};
    for (const p of toProps) {
      if (!fromProps.has(p)) added[p] = [...toSchema[p]];
    }
    const removed = [...fromProps].filter((p) => !toProps.has(p)).sort();
    const valueRenames = override?.valueRenames?.[fromName] ?? {};

    if (
      Object.keys(added).length > 0 ||
      removed.length > 0 ||
      Object.keys(valueRenames).length > 0
    ) {
      propertyChanges[fromName] = { added, removed, valueRenames };
    }
  }

  return {
    from,
    to,
    addedBlocks,
    removedBlocks,
    renamedBlocks,
    propertyChanges,
    removedFallbacks: override?.removedFallbacks ?? {},
    addedDefaults: override?.addedDefaults ?? {},
  };
}

// ── Reverse flatten table ──────────────────────────────────────────────────

function buildReverseFlattenTable(
  forward: Record<string, string>,
): Record<string, string> {
  // Group by flattened state, then pick the canonical legacy id per state
  // (lowest id, then lowest metadata). FLATTEN_REVERSE_OVERRIDES wins.
  const byState = new Map<string, string[]>();
  for (const [legacy, state] of Object.entries(forward)) {
    const list = byState.get(state) ?? [];
    list.push(legacy);
    byState.set(state, list);
  }

  const parseLegacy = (s: string): [number, number] => {
    const [id, meta] = s.split(":").map(Number);
    return [id, meta];
  };

  const reverse: Record<string, string> = {};
  for (const [state, candidates] of byState) {
    candidates.sort((a, b) => {
      const [ai, am] = parseLegacy(a);
      const [bi, bm] = parseLegacy(b);
      return ai - bi || am - bm;
    });
    reverse[state] = candidates[0];
  }
  for (const [state, legacy] of Object.entries(FLATTEN_REVERSE_OVERRIDES)) {
    reverse[state] = legacy;
  }
  return reverse;
}

// ── Emitter ────────────────────────────────────────────────────────────────

const HEADER = `// AUTO-GENERATED by scripts/generate-block-translations.mts — do NOT edit by hand.
// Regenerate with: pnpm gen:translations
//
// Inputs:
//   - PrismarineJS/minecraft-data  (legacy.json, 1.13.2 blocks.json)
//   - misode/mcmeta                (<version>-summary tags, blocks/data.min.json)
//   - src/lib/schemlib/data/manual-overrides.ts

import type { VersionDiff } from "./types";
`;

function emitBundle(
  diffs: readonly VersionDiff[],
  flattenTable: Record<string, string>,
  reverseFlattenTable: Record<string, string>,
): string {
  // JSON.stringify with 2-space indent produces a deterministic, diff-friendly
  // module. We then wrap it as `export const X = (...) as const;`.
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  return [
    HEADER,
    `export const FLATTEN_TABLE: Readonly<Record<string, string>> = ${json(
      flattenTable,
    )};`,
    "",
    `export const REVERSE_FLATTEN_TABLE: Readonly<Record<string, string>> = ${json(
      reverseFlattenTable,
    )};`,
    "",
    `export const VERSION_DIFFS: readonly VersionDiff[] = ${json(diffs)};`,
    "",
  ].join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function loadAnchorSchemas(version: AnchorVersion): AnchorSchemas {
  if (version === "1.12.2") {
    // The 1.12 "schema" is implicit in the legacy flatten table — we never
    // diff against it directly. Return an empty map.
    return {};
  }
  if (version === "1.13.2") {
    return readMinecraftDataBlocks("1.13.2");
  }
  return readMcmetaBlocks(version);
}

function main(): void {
  const schemas: Record<AnchorVersion, AnchorSchemas> = {} as Record<
    AnchorVersion,
    AnchorSchemas
  >;
  for (const v of ANCHOR_VERSIONS) {
    process.stderr.write(`Loading ${v}…\n`);
    schemas[v] = loadAnchorSchemas(v);
  }

  const overrideByPair = new Map<string, ManualVersionOverride>();
  for (const o of MANUAL_OVERRIDES) {
    overrideByPair.set(`${o.from}→${o.to}`, o);
  }

  // Diff each adjacent pair from 1.13.2 onward. 1.12 ↔ 1.13 is handled via
  // the flatten table; we don't emit a structural diff for it.
  const diffs: VersionDiff[] = [];
  for (let i = 1; i < ANCHOR_VERSIONS.length - 1; i++) {
    const from = ANCHOR_VERSIONS[i];
    const to = ANCHOR_VERSIONS[i + 1];
    process.stderr.write(`Diffing ${from} → ${to}…\n`);
    diffs.push(
      computeDiff(
        from,
        to,
        schemas[from],
        schemas[to],
        overrideByPair.get(`${from}→${to}`),
      ),
    );
  }

  const flattenTable = readLegacyTable();
  const reverseFlattenTable = buildReverseFlattenTable(flattenTable);

  process.stderr.write(`Writing ${OUT_PATH}…\n`);
  writeFileSync(OUT_PATH, emitBundle(diffs, flattenTable, reverseFlattenTable));

  // Summary so reviewers can sanity-check the diff sizes.
  for (const d of diffs) {
    const np = Object.keys(d.propertyChanges).length;
    process.stderr.write(
      `  ${d.from} → ${d.to}: +${d.addedBlocks.length} -${d.removedBlocks.length} blocks, ` +
        `${Object.keys(d.renamedBlocks).length} renames, ${np} blocks with prop changes\n`,
    );
  }
  process.stderr.write(
    `  flatten table: ${Object.keys(flattenTable).length} entries\n`,
  );
}

main();
