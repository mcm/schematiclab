// An index of the Java sources `gen:everycomp` reads: every class of the
// Every Compat, Stone Zone, Gems Realm and Moonlight checkouts with its
// package, imports, superclass and static fields, so builder-chain
// identifiers (child-key constants, palette strategies, `res(…)`) resolve the
// way javac would.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { stripComments } from "./java.ts";

export type Repo = "everycomp" | "stonezone" | "gemsrealm" | "moonlight";
export type SourceSet = "common" | "fabric" | "neoforge";

export interface StaticField {
  name: string;
  /** Declared type, e.g. `String`, `PaletteStrategy`. */
  type: string;
  /** Initializer source (comments stripped), or null. */
  init: string | null;
}

export interface JavaClass {
  repo: Repo;
  sourceSet: SourceSet;
  /** Path relative to the repo root. */
  file: string;
  packageName: string;
  name: string;
  fqcn: string;
  abstract: boolean;
  /** Simple name of the superclass, or null. */
  superName: string | null;
  /** Simple name → fqcn of `import a.b.C;`. */
  imports: Map<string, string>;
  /** `import a.b.*;`: `a.b`. */
  wildcardImports: string[];
  /** `import static a.b.C.X;`: X → `a.b.C`. */
  staticImports: Map<string, string>;
  /** `import static a.b.C.*;`: `a.b.C`. */
  staticWildcards: string[];
  fields: Map<string, StaticField>;
  /** Comment-stripped source. */
  src: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".java")) out.push(path);
  }
  return out;
}

const FIELD_RE =
  /\b(?:public|protected|private)?\s*static\s+final\s+(?:@\w+\s+)?([\w.<>,? ]+?)\s+(\w+)\s*=\s*/g;

function parseFields(src: string): Map<string, StaticField> {
  const fields = new Map<string, StaticField>();
  FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_RE.exec(src)) !== null) {
    // The initializer runs to the `;` at depth 0.
    let depth = 0;
    let j = FIELD_RE.lastIndex;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '"') {
        j++;
        while (j < src.length && src[j] !== '"') {
          if (src[j] === "\\") j++;
          j++;
        }
        continue;
      }
      if ("({[".includes(c)) depth++;
      else if (")}]".includes(c)) depth--;
      else if (c === ";" && depth === 0) break;
    }
    fields.set(m[2], {
      name: m[2],
      type: m[1].trim(),
      init: src.slice(FIELD_RE.lastIndex, j).trim(),
    });
  }
  return fields;
}

function parseClass(repo: Repo, root: string, path: string): JavaClass | null {
  const src = stripComments(readFileSync(path, "utf8"));
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(src);
  const name = /([^/]+)\.java$/.exec(path)![1];
  const header = new RegExp(
    String.raw`\b(abstract\s+)?(?:class|interface|record|enum)\s+${name}\b(?:<[^{]*?>)?(?:\s*\([^)]*\))?\s*(?:extends\s+([\w.]+))?`,
  ).exec(src);
  if (pkg === null) return null;
  const imports = new Map<string, string>();
  const staticImports = new Map<string, string>();
  const staticWildcards: string[] = [];
  const wildcardImports: string[] = [];
  for (const m of src.matchAll(
    /^\s*import\s+(static\s+)?([\w.]+)(\.\*)?\s*;/gm,
  )) {
    const fq = m[2];
    if (m[1] !== undefined) {
      if (m[3] !== undefined) staticWildcards.push(fq);
      else {
        const dot = fq.lastIndexOf(".");
        staticImports.set(fq.slice(dot + 1), fq.slice(0, dot));
      }
    } else if (m[3] === undefined) {
      imports.set(fq.slice(fq.lastIndexOf(".") + 1), fq);
    } else {
      wildcardImports.push(fq);
    }
  }
  const sourceSet = relative(root, path).split("/")[0] as SourceSet;
  return {
    repo,
    sourceSet,
    file: relative(root, path),
    packageName: pkg[1],
    name,
    fqcn: `${pkg[1]}.${name}`,
    abstract: header?.[1] !== undefined,
    superName: header?.[2]?.split(".").pop() ?? null,
    imports,
    wildcardImports,
    staticImports,
    staticWildcards,
    fields: parseFields(src),
    src,
  };
}

export class SourceIndex {
  readonly classes: JavaClass[] = [];
  private readonly byFqcn = new Map<string, JavaClass>();
  private readonly bySimple = new Map<string, JavaClass[]>();

  readonly roots: Readonly<Record<Repo, string>>;

  constructor(roots: Readonly<Record<Repo, string>>) {
    this.roots = roots;
    for (const [repo, root] of Object.entries(roots) as [Repo, string][]) {
      for (const set of ["common", "fabric", "neoforge"]) {
        for (const path of walk(join(root, set, "src/main/java"))) {
          const cls = parseClass(repo, root, path);
          if (cls === null) continue;
          this.classes.push(cls);
          this.byFqcn.set(cls.fqcn, cls);
          const list = this.bySimple.get(cls.name) ?? [];
          list.push(cls);
          this.bySimple.set(cls.name, list);
        }
      }
    }
  }

  get(fqcn: string): JavaClass | null {
    return this.byFqcn.get(fqcn) ?? null;
  }

  /** The class `simple` refers to from inside `from`. */
  resolveClass(from: JavaClass, simple: string): JavaClass | null {
    const imported = from.imports.get(simple);
    if (imported !== undefined) return this.get(imported);
    const samePackage = this.get(`${from.packageName}.${simple}`);
    if (samePackage !== null) return samePackage;
    for (const pkg of from.wildcardImports) {
      const found = this.get(`${pkg}.${simple}`);
      if (found !== null) return found;
    }
    const candidates = (this.bySimple.get(simple) ?? []).filter(
      (c) => c.repo === from.repo || c.repo === "moonlight",
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  /** The superclass chain of `cls`, itself first. */
  hierarchy(cls: JavaClass): JavaClass[] {
    const chain: JavaClass[] = [];
    let cur: JavaClass | null = cls;
    while (cur !== null && !chain.includes(cur)) {
      chain.push(cur);
      cur =
        cur.superName === null ? null : this.resolveClass(cur, cur.superName);
    }
    return chain;
  }

  /** The class declaring static field `name` as seen from `from`, or null. */
  resolveField(
    from: JavaClass,
    name: string,
  ): { owner: JavaClass; field: StaticField } | null {
    for (const cls of this.hierarchy(from)) {
      const field = cls.fields.get(name);
      if (field !== undefined) return { owner: cls, field };
    }
    for (const cls of this.hierarchy(from)) {
      const explicit = cls.staticImports.get(name);
      if (explicit !== undefined) {
        const owner = this.get(explicit);
        const field = owner?.fields.get(name);
        if (owner && field) return { owner, field };
      }
      for (const wildcard of cls.staticWildcards) {
        const owner = this.get(wildcard);
        const field = owner?.fields.get(name);
        if (owner && field) return { owner, field };
      }
    }
    return null;
  }

  /** `Owner.NAME` from `from`. */
  resolveQualifiedField(
    from: JavaClass,
    owner: string,
    name: string,
  ): { owner: JavaClass; field: StaticField } | null {
    const cls = this.resolveClass(from, owner);
    if (cls === null) return null;
    for (const c of this.hierarchy(cls)) {
      const field = c.fields.get(name);
      if (field !== undefined) return { owner: c, field };
    }
    return null;
  }
}
