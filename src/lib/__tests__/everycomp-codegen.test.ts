// `gen:everycomp`'s Java reader: builder-chain lambdas parsed and translated
// to TypeScript, then run against the runtime helpers they call.

import { describe, expect, it } from "vitest";

import {
  emitLambda,
  EmitError,
  type EmitScope,
} from "../../../scripts/everycomp/emit";
import {
  parseJavaExpression,
  splitArgs,
  stripComments,
  unescapeJava,
} from "../../../scripts/everycomp/java";
import {
  createFullIdWith,
  EcResourceLocation,
  J,
} from "../mods/generated/everycomp/runtime";

const SCOPE: EmitScope = {
  modId: "",
  shortId: "rcd",
  addon: "everycomp",
  constant: (name) =>
    ({ STRIPPED_LOG: "stripped_log", LEAVES: "leaves" })[name] ?? null,
  entryField: (field) => (field === "beams" ? "planks_beams" : null),
};

/** Evaluate translated TS (plain JS here) with the runtime in scope. */
function run<T>(source: string, c: object): T {
  return new Function("J", "c", `return (${source});`)(J, c) as T;
}

const fir = {
  getTypeName: () => "fir",
  getNamespace: () => "biomesoplenty",
  getId: () => new EcResourceLocation("biomesoplenty", "fir"),
  createFullIdWith: (m: string, f: string, s: string, p: string, x: string) =>
    createFullIdWith(
      { namespace: "biomesoplenty", typeName: "fir" },
      m,
      f,
      s,
      p,
      x,
    ),
};

describe("Java source helpers", () => {
  it("strips comments but not strings", () => {
    expect(stripComments('a // x\n"//b" /* c */ d')).toBe(
      'a     \n"//b"         d',
    );
  });

  it("splits top-level arguments", () => {
    expect(splitArgs('a(b, c), "d,e", f -> g(h, i)')).toEqual([
      "a(b, c)",
      '"d,e"',
      "f -> g(h, i)",
    ]);
  });

  it("unescapes string literals", () => {
    expect(unescapeJava('"\\"x\\"\\\\w"')).toBe('"x"\\w');
  });
});

describe("emitLambda", () => {
  it("translates Rechiseled's connecting-model modifier", () => {
    const node =
      parseJavaExpression(`m -> m.addModifier((s, blockId, woodType) ->
      s.replace("\\"rechiseled:oak_planks_beams_stairs\\"", "\\"" + blockId.toString() + "\\"")
       .replaceAll("\\"rechiseled:oak_(\\\\w+)\\"", "\\"" + createStandardId(woodType, "", "") + "_$1\\""))`);
    const source = emitLambda(node, SCOPE);
    let modifier:
      | ((s: string, id: EcResourceLocation, t: typeof fir) => string)
      | null = null;
    const m = {
      addModifier(fn: typeof modifier) {
        modifier = fn;
        return m;
      },
    };
    run<(m: object) => void>(source, {})(m);
    const out = modifier!(
      '{"a": "rechiseled:oak_planks_beams_stairs", "b": "rechiseled:oak_planks"}',
      EcResourceLocation.parse(
        "everycomp:rcd/biomesoplenty/fir_planks_beams_stairs",
      ),
      fir,
    );
    expect(out).toBe(
      '{"a": "everycomp:rcd/biomesoplenty/fir_planks_beams_stairs", "b": "everycomp:rcd/biomesoplenty/fir_planks"}',
    );
  });

  it("translates conditions with constants, null checks and entry maps", () => {
    const node = parseJavaExpression(
      'w -> !w.getId().toString().matches("bop:(a|b)") && Objects.nonNull(beams.blocks.get(w)) && w.getChild(STRIPPED_LOG) != null',
    );
    const source = emitLambda(node, SCOPE);
    expect(source).toContain('c.entryBlock("planks_beams", w)');
    const condition = run<(t: object) => boolean>(source, {
      entryBlock: (name: string) => (name === "planks_beams" ? "x:y" : null),
    });
    const type = (id: string, stripped: string | null) => ({
      getId: () => EcResourceLocation.parse(id),
      getChild: (key: string) => (key === "stripped_log" ? stripped : null),
    });
    expect(condition(type("bop:c", "bop:stripped_c_log"))).toBe(true);
    expect(condition(type("bop:a", "bop:stripped_a_log"))).toBe(false);
    expect(condition(type("bop:c", null))).toBe(false);
  });

  it("translates block lambdas with locals and if/else", () => {
    const node = parseJavaExpression(`(s, id, w) -> {
      String prefix = "x";
      if (w.getNamespace().equals("tfc")) { return s.replace("a", prefix); }
      else { return s.replace("a", w.getTypeName()); }
    }`);
    const fn = run<(s: string, id: unknown, w: object) => string>(
      emitLambda(node, SCOPE),
      {},
    );
    expect(fn("aaa", null, fir)).toBe("firfirfir");
  });

  it("rejects calls outside the whitelist", () => {
    expect(() =>
      emitLambda(
        parseJavaExpression("w -> w.planks.defaultBlockState()"),
        SCOPE,
      ),
    ).toThrow(EmitError);
  });
});

describe("J", () => {
  it("has Java String semantics", () => {
    expect(J.replace("a.a.a", ".", "-")).toBe("a-a-a");
    expect(J.replaceAll("oak_x oak_y", "oak_(\\w+)", "fir_$1")).toBe(
      "fir_x fir_y",
    );
    expect(J.matches("abc", "b")).toBe(false);
    expect(J.matches("abc", "a.c")).toBe(true);
  });
});
