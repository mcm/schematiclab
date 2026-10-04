// Simple Mode (`src/app/page.tsx`) must not pull the modded-translation code
// into its bundle. Walks the static and dynamic source imports reachable from
// the page and checks that none of the forbidden modules are among them.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const PAGE = path.join(SRC, "app/page.tsx");

const FORBIDDEN = [
  "lib/mods/mappings.ts",
  "components/mod-project-picker.tsx",
  "lib/mods/project-picker.ts",
  "lib/advanced/suggest-blocks.ts",
  "lib/advanced/vanilla-block-colors.ts",
  "components/block-suggestions.tsx",
  "lib/advanced/mod-namespace-status.ts",
  "components/version-mapping-mods-section.tsx",
  "lib/mods/generated/registry.ts",
  "lib/mcp/tools.ts",
  "lib/mcp/server.ts",
  "lib/blockdata/load.ts",
  "lib/blockdata/registry.ts",
];

// Module specifiers in `source`: static imports, re-exports and literal
// dynamic `import("...")` calls, ignoring comments and strings. Dynamic
// imports with a non-literal specifier aren't followed.
function importSpecifiers(source: string): string[] {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((ref) => ref.fileName);
}

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !/\.tsx?$/.test(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(source)) {
      const resolved = resolve(file, spec);
      if (resolved !== null) queue.push(resolved);
    }
  }
  return seen;
}

describe("Simple Mode import graph", () => {
  it("doesn't include modded-translation modules", () => {
    const reachable = [...reachableFrom(PAGE)].map((file) =>
      path.relative(SRC, file).split(path.sep).join("/"),
    );
    expect(reachable).toContain("app/page.tsx");
    expect(reachable).toContain("lib/convert-client.ts");
    for (const forbidden of FORBIDDEN) {
      expect(reachable).not.toContain(forbidden);
    }
  });
});
