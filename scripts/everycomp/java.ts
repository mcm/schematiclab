// A tiny Java source reader for `gen:everycomp`: comment stripping, argument
// splitting, and a parser for the expression subset Every Compat / Stone
// Zone / Gems Realm modules use in builder chains (lambdas, string
// concatenation, method calls, `if`/`return` blocks). The emitter in
// `emit.ts` turns the parsed lambdas into TypeScript, with a whitelist of
// what they may call.

/** Replace comments with spaces (newlines kept); strings stay intact. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '"' && src.startsWith('"""', i)) {
      const j = src.indexOf('"""', i + 3);
      const end = j < 0 ? n : j + 3;
      out += src.slice(i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && d === "/") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      out += " ".repeat(j - i);
      i = j;
    } else if (c === "/" && d === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function skipString(s: string, j: number): number {
  const quote = s[j];
  j++;
  while (j < s.length && s[j] !== quote) {
    if (s[j] === "\\") j++;
    j++;
  }
  return j;
}

/** Index of the bracket closing the one at `open`, or -1. */
export function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'") {
      j = skipString(s, j);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Split `s` at top-level commas. */
export function splitArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'") {
      const k = skipString(s, j);
      cur += s.slice(j, k + 1);
      j = k;
      continue;
    }
    if ("({[".includes(c)) depth++;
    if (")}]".includes(c)) depth--;
    if (c === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") args.push(cur.trim());
  return args;
}

/** 1-based line of offset `index`. */
export function lineOf(s: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/** The value of a Java string literal (with its quotes). */
export function unescapeJava(literal: string): string {
  const body = literal.slice(1, -1);
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, e: string) => {
    if (e.startsWith("u") && e.length === 5) {
      return String.fromCharCode(parseInt(e.slice(1), 16));
    }
    switch (e) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "0":
        return "\0";
      default:
        return e;
    }
  });
}

// ── Expression parser ────────────────────────────────────────────────────

export type JavaNode =
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "name"; name: string }
  | { kind: "field"; target: JavaNode; name: string }
  | { kind: "call"; target: JavaNode | null; name: string; args: JavaNode[] }
  | { kind: "methodRef"; target: string; name: string }
  | { kind: "unary"; op: "!" | "-"; operand: JavaNode }
  | { kind: "binary"; op: string; left: JavaNode; right: JavaNode }
  | { kind: "ternary"; test: JavaNode; then: JavaNode; else: JavaNode }
  | { kind: "lambda"; params: string[]; body: JavaNode | JavaStatement[] }
  | { kind: "cast"; type: string; operand: JavaNode };

export type JavaStatement =
  | { kind: "var"; name: string; init: JavaNode }
  | { kind: "return"; value: JavaNode }
  | { kind: "if"; test: JavaNode; then: JavaStatement[]; else: JavaStatement[] }
  | { kind: "expr"; value: JavaNode };

type Token =
  | { t: "str"; v: string }
  | { t: "num"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const OPS = [
  "->",
  "::",
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "!",
  "?",
  ":",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ",",
  ".",
  ";",
  "=",
  "<",
  ">",
];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const j = skipString(src, i);
      tokens.push({ t: "str", v: unescapeJava(src.slice(i, j + 1)) });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const j = skipString(src, i);
      tokens.push({ t: "str", v: unescapeJava(src.slice(i, j + 1)) });
      i = j + 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?[fFdDlL]?/.exec(src.slice(i));
    if (num !== null) {
      tokens.push({ t: "num", v: num[0].replace(/[fFdDlL]$/, "") });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (id !== null) {
      tokens.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op === undefined) {
      throw new Error(`Unexpected character ${JSON.stringify(c)} in ${src}`);
    }
    tokens.push({ t: "op", v: op });
    i += op.length;
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private isOp(v: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t?.t === "op" && t.v === v;
  }

  private isId(v?: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t?.t === "id" && (v === undefined || t.v === v);
  }

  private expectOp(v: string): void {
    if (!this.isOp(v)) {
      throw new Error(
        `Expected ${v} at token ${this.pos}: ${JSON.stringify(this.peek())}`,
      );
    }
    this.pos++;
  }

  private ident(): string {
    const t = this.peek();
    if (t?.t !== "id") {
      throw new Error(`Expected identifier, got ${JSON.stringify(t)}`);
    }
    this.pos++;
    return t.v;
  }

  done(): boolean {
    return this.pos >= this.tokens.length;
  }

  expression(): JavaNode {
    const lambda = this.tryLambda();
    if (lambda !== null) return lambda;
    return this.ternary();
  }

  private tryLambda(): JavaNode | null {
    // `x -> …`
    if (this.isId() && this.isOp("->", 1)) {
      const param = this.ident();
      this.pos++;
      return { kind: "lambda", params: [param], body: this.lambdaBody() };
    }
    // `(a, b) -> …` / `(Type a) -> …`
    if (this.isOp("(")) {
      let j = this.pos + 1;
      const params: string[] = [];
      let ok = true;
      while (
        j < this.tokens.length &&
        !(this.tokens[j].t === "op" && this.tokens[j].v === ")")
      ) {
        const t = this.tokens[j];
        if (t.t === "id") {
          // `Type name`: keep the last identifier before a comma
          const next = this.tokens[j + 1];
          if (next?.t === "id") {
            j++;
            continue;
          }
          params.push(t.v);
        } else if (!(t.t === "op" && t.v === ",")) {
          ok = false;
          break;
        }
        j++;
      }
      const arrow = this.tokens[j + 1];
      if (ok && arrow?.t === "op" && arrow.v === "->") {
        this.pos = j + 2;
        return { kind: "lambda", params, body: this.lambdaBody() };
      }
    }
    return null;
  }

  private lambdaBody(): JavaNode | JavaStatement[] {
    if (this.isOp("{")) return this.block();
    return this.expression();
  }

  block(): JavaStatement[] {
    this.expectOp("{");
    const statements: JavaStatement[] = [];
    while (!this.isOp("}")) statements.push(this.statement());
    this.expectOp("}");
    return statements;
  }

  private statement(): JavaStatement {
    if (this.isId("return")) {
      this.pos++;
      const value = this.expression();
      this.expectOp(";");
      return { kind: "return", value };
    }
    if (this.isId("if")) {
      this.pos++;
      this.expectOp("(");
      const test = this.expression();
      this.expectOp(")");
      const then = this.isOp("{") ? this.block() : [this.statement()];
      let otherwise: JavaStatement[] = [];
      if (this.isId("else")) {
        this.pos++;
        otherwise = this.isOp("{") ? this.block() : [this.statement()];
      }
      return { kind: "if", test, then, else: otherwise };
    }
    // `Type name = expr;` (also `final Type name`, `var name`)
    if (this.isId("final")) this.pos++;
    if (this.isId() && this.isId(undefined, 1) && this.isOp("=", 2)) {
      this.pos++;
      const name = this.ident();
      this.expectOp("=");
      const init = this.expression();
      this.expectOp(";");
      return { kind: "var", name, init };
    }
    const value = this.expression();
    this.expectOp(";");
    return { kind: "expr", value };
  }

  private ternary(): JavaNode {
    const test = this.binary(0);
    if (this.isOp("?")) {
      this.pos++;
      const then = this.expression();
      this.expectOp(":");
      const otherwise = this.expression();
      return { kind: "ternary", test, then, else: otherwise };
    }
    return test;
  }

  private static readonly PRECEDENCE: readonly (readonly string[])[] = [
    ["||"],
    ["&&"],
    ["==", "!="],
    ["<", ">", "<=", ">="],
    ["+", "-"],
    ["*", "/"],
  ];

  private binary(level: number): JavaNode {
    if (level >= Parser.PRECEDENCE.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t?.t !== "op" || !Parser.PRECEDENCE[level].includes(t.v)) break;
      this.pos++;
      const right = this.binary(level + 1);
      left = { kind: "binary", op: t.v, left, right };
    }
    return left;
  }

  private unary(): JavaNode {
    if (this.isOp("!")) {
      this.pos++;
      return { kind: "unary", op: "!", operand: this.unary() };
    }
    if (this.isOp("-")) {
      this.pos++;
      return { kind: "unary", op: "-", operand: this.unary() };
    }
    // `(Type) expr` casts
    if (
      this.isOp("(") &&
      this.isId(undefined, 1) &&
      this.isOp(")", 2) &&
      /^[A-Z]/.test((this.peek(1) as { v: string }).v)
    ) {
      const t = this.peek(3);
      if (t !== undefined && (t.t !== "op" || t.v === "(")) {
        this.pos++;
        const type = this.ident();
        this.pos++;
        return { kind: "cast", type, operand: this.unary() };
      }
    }
    return this.postfix();
  }

  private args(): JavaNode[] {
    this.expectOp("(");
    const args: JavaNode[] = [];
    while (!this.isOp(")")) {
      args.push(this.expression());
      if (this.isOp(",")) this.pos++;
    }
    this.expectOp(")");
    return args;
  }

  private skipTypeArgs(): void {
    if (!this.isOp("<")) return;
    let depth = 0;
    do {
      if (this.isOp("<")) depth++;
      else if (this.isOp(">")) depth--;
      this.pos++;
    } while (depth > 0 && !this.done());
  }

  private postfix(): JavaNode {
    let node = this.primary();
    for (;;) {
      if (this.isOp(".")) {
        this.pos++;
        this.skipTypeArgs();
        const name = this.ident();
        if (this.isOp("(")) {
          node = { kind: "call", target: node, name, args: this.args() };
        } else {
          node = { kind: "field", target: node, name };
        }
      } else if (this.isOp("::")) {
        this.pos++;
        const name = this.ident();
        node = { kind: "methodRef", target: qualifiedName(node), name };
      } else {
        return node;
      }
    }
  }

  private primary(): JavaNode {
    const t = this.peek();
    if (t === undefined) throw new Error("Unexpected end of expression");
    if (t.t === "str") {
      this.pos++;
      return { kind: "string", value: t.v };
    }
    if (t.t === "num") {
      this.pos++;
      return { kind: "number", value: t.v };
    }
    if (t.t === "op" && t.v === "(") {
      this.pos++;
      const inner = this.expression();
      this.expectOp(")");
      return inner;
    }
    if (t.t === "id") {
      this.pos++;
      if (t.v === "true" || t.v === "false") {
        return { kind: "bool", value: t.v === "true" };
      }
      if (t.v === "null") return { kind: "null" };
      if (t.v === "new") {
        throw new Error("`new` is not supported");
      }
      if (this.isOp("(")) {
        return { kind: "call", target: null, name: t.v, args: this.args() };
      }
      return { kind: "name", name: t.v };
    }
    throw new Error(`Unexpected token ${JSON.stringify(t)}`);
  }
}

/** `a.b.C` of a name/field chain, for method references. */
export function qualifiedName(node: JavaNode): string {
  if (node.kind === "name") return node.name;
  if (node.kind === "field")
    return `${qualifiedName(node.target)}.${node.name}`;
  throw new Error(`Not a qualified name: ${JSON.stringify(node)}`);
}

/** Parse one Java expression (a builder argument). */
export function parseJavaExpression(src: string): JavaNode {
  const parser = new Parser(tokenize(src));
  const node = parser.expression();
  if (!parser.done()) throw new Error(`Trailing tokens in ${src}`);
  return node;
}
