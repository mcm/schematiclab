// Turns the lambdas of Every Compat / Stone Zone / Gems Realm builder chains
// (`addModelTransform`, `addCondition`) into TypeScript source for the
// generated entry-set tables. Only a whitelist of calls is translated; the
// runtime side of every name used here lives in
// `src/lib/mods/generated/everycomp/runtime.ts` (`EcContext`,
// `EcResTransformer`, `EcTypeView`, `EcResourceLocation`, `J`).

import type { JavaNode, JavaStatement } from "./java.ts";

/** What the emitter knows about the module a lambda comes from. */
export interface EmitScope {
  /** Supported mod id (`CompatModule.modId`), or null when it varies by registration. */
  modId: string;
  shortId: string;
  /** Addon namespace: `everycomp`, `stonezone` or `gemsrealm`. */
  addon: string;
  /** Static constant resolution (child keys, mod ids…): name → string value. */
  constant(name: string): string | null;
  /** Entry-set field name → entry-set name (for `field.blocks.get(t)`). */
  entryField(field: string): string | null;
}

export class EmitError extends Error {}

const RESERVED = new Set(["function", "var", "let", "const", "delete", "in"]);

/** Methods translated to `J.<name>(receiver, …)` (Java String semantics). */
const STRING_METHODS = new Set([
  "replace",
  "replaceAll",
  "matches",
  "equals",
  "contains",
  "startsWith",
  "endsWith",
  "isEmpty",
]);

/** Methods the runtime objects implement with their Java names. */
const OBJECT_METHODS = new Set([
  // EcResourceLocation
  "toString",
  "withPrefix",
  "withSuffix",
  "getPath",
  // EcTypeView
  "getId",
  "getTypeName",
  "getNamespace",
  "isBambooLike",
  "getAssociatedWoodType",
  "getItemOfThis",
  "getBlockOfThis",
  "getChild",
  "hasChild",
  "createFullIdWith",
  "CreateStandardId",
  // EcResTransformer
  "addModifier",
  "replaceString",
  "replaceWithTextureFromChild",
  "replaceBlockType",
  "replaceGenericType",
  "replaceSimpleType",
  "replaceItemType",
]);

const ADDON_RES: Record<string, string> = {
  EveryCompat: "everycomp",
  StoneZone: "stonezone",
  GemsRealm: "gemsrealm",
};

function str(value: string): string {
  return JSON.stringify(value);
}

function ident(name: string): string {
  return RESERVED.has(name) ? `${name}_` : name;
}

class Emitter {
  private readonly locals: Set<string>[] = [];
  private readonly scope: EmitScope;

  constructor(scope: EmitScope) {
    this.scope = scope;
  }

  private isLocal(name: string): boolean {
    return this.locals.some((set) => set.has(name));
  }

  expr(node: JavaNode): string {
    switch (node.kind) {
      case "string":
        return str(node.value);
      case "number":
        return node.value;
      case "bool":
        return String(node.value);
      case "null":
        return "null";
      case "cast":
        return this.expr(node.operand);
      case "name":
        return this.name(node.name);
      case "field":
        return this.field(node);
      case "unary":
        return `${node.op}${this.paren(node.operand)}`;
      case "binary": {
        let op = node.op;
        const nullCompare =
          node.left.kind === "null" || node.right.kind === "null";
        if (op === "==") op = nullCompare ? "==" : "===";
        if (op === "!=") op = nullCompare ? "!=" : "!==";
        return `${this.paren(node.left)} ${op} ${this.paren(node.right)}`;
      }
      case "ternary":
        return `${this.paren(node.test)} ? ${this.paren(node.then)} : ${this.paren(node.else)}`;
      case "lambda":
        return this.lambda(node.params, node.body);
      case "methodRef":
        return this.methodRef(node.target, node.name);
      case "call":
        return this.call(node);
    }
  }

  private paren(node: JavaNode): string {
    const out = this.expr(node);
    return node.kind === "binary" ||
      node.kind === "ternary" ||
      node.kind === "lambda"
      ? `(${out})`
      : out;
  }

  private name(name: string): string {
    if (this.isLocal(name)) return ident(name);
    const value = this.scope.constant(name);
    if (value !== null) return str(value);
    throw new EmitError(`Unknown name ${name}`);
  }

  private field(node: Extract<JavaNode, { kind: "field" }>): string {
    if (node.target.kind === "name") {
      const owner = node.target.name;
      if (owner in ADDON_RES && node.name === "MOD_ID") {
        return str(ADDON_RES[owner]);
      }
      if (owner === "CompatSpritesHelper" && /^LOOKS_LIKE_/.test(node.name)) {
        return `c.${node.name}`;
      }
      const qualified = this.scope.constant(`${owner}.${node.name}`);
      if (qualified !== null) return str(qualified);
    }
    throw new EmitError(`Unknown field access ${JSON.stringify(node)}`);
  }

  private lambda(params: string[], body: JavaNode | JavaStatement[]): string {
    this.locals.push(new Set(params));
    try {
      const list = params.map(ident).join(", ");
      if (Array.isArray(body)) return `(${list}) => {${this.block(body)}}`;
      return `(${list}) => ${this.paren(body)}`;
    } finally {
      this.locals.pop();
    }
  }

  private block(statements: JavaStatement[]): string {
    this.locals.push(new Set());
    try {
      return statements.map((s) => this.statement(s)).join(" ");
    } finally {
      this.locals.pop();
    }
  }

  private statement(statement: JavaStatement): string {
    switch (statement.kind) {
      case "var":
        this.locals[this.locals.length - 1].add(statement.name);
        return `const ${ident(statement.name)} = ${this.expr(statement.init)};`;
      case "return":
        return `return ${this.expr(statement.value)};`;
      case "expr":
        return `${this.expr(statement.value)};`;
      case "if":
        return (
          `if (${this.expr(statement.test)}) {${this.block(statement.then)}}` +
          (statement.else.length > 0
            ? ` else {${this.block(statement.else)}}`
            : "")
        );
    }
  }

  private methodRef(target: string, name: string): string {
    if (
      /^(WoodType|LeavesType|StoneType|MudType|MetalType|GemType|CrystalType|DustType)$/.test(
        target,
      ) &&
      OBJECT_METHODS.has(name)
    ) {
      return `(t) => t.${name}()`;
    }
    if (target === "CompatSpritesHelper") {
      return `(m) => c.${name}(m)`;
    }
    throw new EmitError(`Unknown method reference ${target}::${name}`);
  }

  private args(nodes: JavaNode[]): string {
    return nodes.map((n) => this.expr(n)).join(", ");
  }

  private call(node: Extract<JavaNode, { kind: "call" }>): string {
    const { target, name, args } = node;
    if (target === null) return this.moduleCall(name, args);
    if (target.kind === "name") {
      const owner = target.name;
      if (owner === "Objects" && name === "nonNull" && args.length === 1) {
        return `(${this.expr(args[0])} != null)`;
      }
      if (owner === "Objects" && name === "isNull" && args.length === 1) {
        return `(${this.expr(args[0])} == null)`;
      }
      if (owner === "PlatHelper" && name === "isModLoaded") {
        return `c.isModLoaded(${this.args(args)})`;
      }
      if (owner in ADDON_RES && name === "res") {
        return `c.rl(${str(ADDON_RES[owner])}, ${this.args(args)})`;
      }
      if (owner === "ResourceLocation" && name === "parse") {
        return `c.parseRl(${this.args(args)})`;
      }
      if (owner === "ResourceLocation" && name === "withDefaultNamespace") {
        return `c.rl("minecraft", ${this.args(args)})`;
      }
    }
    // `field.blocks.get(type)`: whether another entry set generates for type
    if (
      name === "get" &&
      target.kind === "field" &&
      target.name === "blocks" &&
      target.target.kind === "name" &&
      !this.isLocal(target.target.name)
    ) {
      const entry = this.scope.entryField(target.target.name);
      if (entry === null) {
        throw new EmitError(`Unknown entry set field ${target.target.name}`);
      }
      return `c.entryBlock(${str(entry)}, ${this.args(args)})`;
    }
    const receiver = this.paren(target);
    if (STRING_METHODS.has(name)) {
      return `J.${name}(${[receiver, ...args.map((a) => this.expr(a))].join(", ")})`;
    }
    if (OBJECT_METHODS.has(name)) {
      return `${receiver}.${name}(${this.args(args)})`;
    }
    throw new EmitError(`Unknown method ${name}`);
  }

  private moduleCall(name: string, args: JavaNode[]): string {
    const { scope } = this;
    switch (name) {
      case "shortenedId":
        return str(scope.shortId);
      case "getModId":
        return "c.modId";
      case "modRes":
        return `c.rl(c.modId, ${this.args(args)})`;
      case "res":
        return `c.rl(${str(scope.addon)}, ${this.args(args)})`;
      case "getParentBlock":
        if (args.length !== 2) break;
        return `${this.paren(args[0])}.getBlockOfThis(c.modId + ":" + ${this.paren(args[1])})`;
      case "createStandardId":
        if (args.length !== 3) break;
        return `${this.paren(args[0])}.createFullIdWith(${str(scope.addon)}, "", ${str(scope.shortId)}, ${this.expr(args[1])}, ${this.expr(args[2])})`;
    }
    throw new EmitError(`Unknown module method ${name}`);
  }
}

/** TypeScript source for a Java lambda/expression in `scope`. */
export function emitLambda(node: JavaNode, scope: EmitScope): string {
  return new Emitter(scope).expr(node);
}
