// Which copy of each nested (jar-in-jar) mod a pack loads, as NeoForge
// decides it: one copy per `group:artifact` (by mod id when the parent jar's
// metadata doesn't list it), the highest `artifactVersion`, and none when a
// top-level jar is the same mod.
//
// Pure. Imports carry their `.ts` extension so node's strip-types can load it.

import type { ModJarIndex } from "../mods/parse-mod-jar.ts";

/** One top-level jar of the pack, as far as nested jars go. */
export interface NestedJarOwner {
  /** The jar's label in messages (its file name, else the mod's name). */
  outer: string;
  /** Null when the jar couldn't be read. Its asset ids aren't needed. */
  index:
    | (Pick<ModJarIndex, "modIds"> & {
        nestedJars: Omit<ModJarIndex["nestedJars"][number], "assets">[];
      })
    | null;
}

/** What happens to one nested jar of the pack. */
export interface NestedJarDecision {
  /** Index of the owning jar in the list given to `chooseNestedJars`. */
  owner: number;
  outer: string;
  /** `NestedModJar.path` inside the owning jar. */
  path: string;
  artifact: string | null;
  version: string | null;
  modIds: string[];
  kept: boolean;
  /** Why the copy is skipped (with `kept: false`). */
  reason?: string;
}

/** `<artifact> <version>` of a nested jar, for messages. */
export function nestedJarLabel(
  jar: Pick<NestedJarDecision, "artifact" | "version" | "modIds" | "path">,
): string {
  const name =
    jar.artifact ??
    jar.modIds[0] ??
    jar.path.slice(jar.path.lastIndexOf("/") + 1).replace(/\.jar$/i, "");
  return jar.version === null ? name : `${name} ${jar.version}`;
}

/** Decides, for every nested jar of `owners`, whether it is read. */
export function chooseNestedJars(
  owners: readonly NestedJarOwner[],
): NestedJarDecision[] {
  const topLevel = new Map<string, string>();
  for (const owner of owners) {
    for (const id of owner.index?.modIds ?? []) {
      if (!topLevel.has(id)) topLevel.set(id, owner.outer);
    }
  }

  const decisions: NestedJarDecision[] = [];
  const groups = new Map<string, NestedJarDecision[]>();
  for (const [ownerIndex, owner] of owners.entries()) {
    for (const jar of owner.index?.nestedJars ?? []) {
      const decision: NestedJarDecision = {
        owner: ownerIndex,
        outer: owner.outer,
        path: jar.path,
        artifact: jar.artifact,
        version: jar.version,
        modIds: jar.modIds,
        kept: true,
      };
      decisions.push(decision);
      const shadowing = jar.modIds.find((id) => topLevel.has(id));
      if (shadowing !== undefined) {
        decision.kept = false;
        decision.reason = `mod ${shadowing} is a top-level jar (${topLevel.get(shadowing)})`;
        continue;
      }
      const key =
        jar.group !== null && jar.artifact !== null
          ? `${jar.group}:${jar.artifact}`
          : jar.modIds.length > 0
            ? `mod:${jar.modIds.join(",")}`
            : null;
      if (key === null) continue;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [decision]);
      else group.push(decision);
    }
  }

  for (const group of groups.values()) {
    // The first of the highest versions wins (pack order, then path order).
    let winner = group[0];
    for (const candidate of group.slice(1)) {
      if (compareMavenVersions(candidate.version, winner.version) > 0) {
        winner = candidate;
      }
    }
    for (const candidate of group) {
      if (candidate === winner) continue;
      candidate.kept = false;
      candidate.reason =
        compareMavenVersions(candidate.version, winner.version) === 0
          ? `the same version is read from ${winner.outer}`
          : `${nestedJarLabel(winner)} is read from ${winner.outer}`;
    }
  }
  return decisions;
}

// ── Maven version ordering ────────────────────────────────────────────────

type VersionItem = number | string;

/** Release-equivalent qualifiers, dropped like trailing zeros. */
const RELEASE_QUALIFIERS = new Set(["", "ga", "final", "release"]);

/** Known qualifiers in order; a release ranks between `snapshot` and `sp`. */
const QUALIFIER_RANKS: Readonly<Record<string, number>> = {
  alpha: 0,
  a: 0,
  beta: 1,
  b: 1,
  milestone: 2,
  m: 2,
  rc: 3,
  cr: 3,
  snapshot: 4,
  sp: 6,
};
const RELEASE_RANK = 5;
const UNKNOWN_RANK = 7;

/**
 * `1.2.0-rc1` → `[1, 2, "rc", 1]`: zeros ending a run of numbers and
 * release qualifiers are dropped, so `1.0-rc` equals `1-rc` and `1.0` `1`.
 */
function versionItems(version: string): VersionItem[] {
  const tokens = version
    .toLowerCase()
    .split(/[.\-+_]/)
    .flatMap((part) => part.match(/\d+|[^\d]+/g) ?? [""])
    .map((token): VersionItem => (/^\d+$/.test(token) ? Number(token) : token));
  const items: VersionItem[] = [];
  // Walk backwards: a zero is dropped while only dropped items follow it,
  // or a qualifier does.
  let droppable = true;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const item = tokens[i];
    if (typeof item === "string") {
      if (droppable && RELEASE_QUALIFIERS.has(item)) continue;
      droppable = true;
      items.unshift(item);
    } else if (droppable && item === 0) {
      continue;
    } else {
      droppable = false;
      items.unshift(item);
    }
  }
  return items;
}

function qualifierRank(item: string): number {
  if (RELEASE_QUALIFIERS.has(item)) return RELEASE_RANK;
  return QUALIFIER_RANKS[item] ?? UNKNOWN_RANK;
}

/** Compares one item with a missing one (a release `0`). */
function compareWithMissing(item: VersionItem): number {
  if (typeof item === "number") return item > 0 ? 1 : 0;
  return Math.sign(qualifierRank(item) - RELEASE_RANK);
}

function compareItems(a: VersionItem, b: VersionItem): number {
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  // A number is newer than any qualifier (`1.1` > `1-rc`).
  if (typeof a === "number") return 1;
  if (typeof b === "number") return -1;
  const ranks = qualifierRank(a) - qualifierRank(b);
  if (ranks !== 0) return Math.sign(ranks);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Maven-style ordering of two versions: numeric segments compared
 * numerically, then qualifiers (`alpha` < `beta` < `milestone` < `rc` <
 * `snapshot` < release < `sp` < others, alphabetically). A missing version
 * sorts below any version.
 */
export function compareMavenVersions(
  a: string | null,
  b: string | null,
): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? -1 : 1;
  }
  const left = versionItems(a);
  const right = versionItems(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const order =
      i >= left.length
        ? -compareWithMissing(right[i])
        : i >= right.length
          ? compareWithMissing(left[i])
          : compareItems(left[i], right[i]);
    if (order !== 0) return order;
  }
  return 0;
}
