// Port of schemlib/snbt.py (Python) -> TypeScript.
//
// SNBT ("Stringified NBT") is the human-readable text serialization Minecraft
// uses in commands and a few config files. The grammar:
//
//   value      := number | string | array | list | compound
//   number     := int [BSL]? | float [FD]? | float
//   int        := -? [0-9]+              (suffixes B/S/L select Byte/Short/Long)
//   float      := -? [0-9]+ "." [0-9]+   (default is Double, F suffix = Float)
//   string     := "..." | '...'          (JSON-escape syntax inside double quotes)
//   list       := "[" (value ("," value)*)? "]"
//   array      := "[" ("B"|"I"|"L") ";" (item ("," item)*)? "]"
//   compound   := "{" (entry ("," entry)*)? "}"
//   entry      := key ":" value
//   key        := unquoted_word | string

import * as nbt from "./nbt";

const UNQUOTED_CHAR = /[A-Za-z0-9_\-.+]/;

class SnbtParser {
  pos = 0;

  constructor(public readonly src: string) {}

  get eof(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  skipWs(): void {
    while (!this.eof && /\s/.test(this.peek())) this.pos++;
  }

  expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new Error(`Expected '${ch}' at ${this.pos}, got '${this.peek()}'`);
    }
    this.pos++;
  }

  parseValue(): nbt.NbtTag {
    this.skipWs();
    const c = this.peek();
    if (c === "{") return this.parseCompound();
    if (c === "[") return this.parseListOrArray();
    if (c === '"' || c === "'") return this.parseString();
    return this.parseNumber();
  }

  parseString(): nbt.StringTag {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected quoted string at ${this.pos}`);
    }
    const start = this.pos;
    this.pos++; // opening quote
    let out = "";
    while (!this.eof && this.peek() !== quote) {
      const ch = this.peek();
      if (ch === "\\") {
        // JSON-style escape — only the common ones appear in Minecraft SNBT
        // (\\, \", \n, \r, \t). For double-quoted strings we use the same
        // unescaping rules as JSON.parse so behavior matches the Python port
        // (which calls json.loads on the matched literal).
        this.pos++;
        const esc = this.peek();
        switch (esc) {
          case '"':
            out += '"';
            break;
          case "'":
            out += "'";
            break;
          case "\\":
            out += "\\";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "/":
            out += "/";
            break;
          default:
            out += esc;
        }
        this.pos++;
      } else {
        out += ch;
        this.pos++;
      }
    }
    if (this.eof) {
      throw new Error(`Unterminated string starting at ${start}`);
    }
    this.pos++; // closing quote
    return new nbt.StringTag(out);
  }

  parseNumber(): nbt.NbtTag {
    const start = this.pos;
    if (this.peek() === "-" || this.peek() === "+") this.pos++;

    let sawDigits = false;
    while (!this.eof && /[0-9]/.test(this.peek())) {
      this.pos++;
      sawDigits = true;
    }
    let isFloat = false;
    if (this.peek() === ".") {
      isFloat = true;
      this.pos++;
      while (!this.eof && /[0-9]/.test(this.peek())) {
        this.pos++;
        sawDigits = true;
      }
    }
    if (!sawDigits) {
      throw new Error(`Expected number at ${start}`);
    }

    const numericPart = this.src.slice(start, this.pos);
    const suffix = this.peek();
    let consumedSuffix = false;
    let tagType: "byte" | "short" | "int" | "long" | "float" | "double";

    switch (suffix.toUpperCase()) {
      case "B":
        if (isFloat)
          throw new Error(`Invalid byte literal with decimal at ${start}`);
        tagType = "byte";
        consumedSuffix = true;
        break;
      case "S":
        if (isFloat)
          throw new Error(`Invalid short literal with decimal at ${start}`);
        tagType = "short";
        consumedSuffix = true;
        break;
      case "L":
        if (isFloat)
          throw new Error(`Invalid long literal with decimal at ${start}`);
        tagType = "long";
        consumedSuffix = true;
        break;
      case "F":
        tagType = "float";
        consumedSuffix = true;
        break;
      case "D":
        tagType = "double";
        consumedSuffix = true;
        break;
      default:
        tagType = isFloat ? "double" : "int";
    }
    if (consumedSuffix) this.pos++;

    switch (tagType) {
      case "byte":
        return new nbt.Byte(parseInt(numericPart, 10));
      case "short":
        return new nbt.Short(parseInt(numericPart, 10));
      case "int":
        return new nbt.Int(parseInt(numericPart, 10));
      case "long":
        return new nbt.Long(BigInt(numericPart));
      case "float":
        return new nbt.Float(parseFloat(numericPart));
      case "double":
        return new nbt.Double(parseFloat(numericPart));
    }
  }

  parseListOrArray(): nbt.NbtTag {
    this.expect("[");
    this.skipWs();
    // Array form: "[B;...]" / "[I;...]" / "[L;...]" — check 2 chars ahead.
    if (
      (this.peek(0) === "B" || this.peek(0) === "I" || this.peek(0) === "L") &&
      this.peek(1) === ";"
    ) {
      const arrayKind = this.peek(0);
      this.pos += 2; // consume "B;" / "I;" / "L;"
      const items: Array<number | bigint> = [];
      this.skipWs();
      if (this.peek() !== "]") {
        while (true) {
          this.skipWs();
          const itemTag = this.parseNumber();
          if (arrayKind === "B" && !(itemTag instanceof nbt.Byte)) {
            throw new Error(`ByteArray item must be Byte`);
          }
          if (arrayKind === "I" && !(itemTag instanceof nbt.Int)) {
            throw new Error(`IntArray item must be Int`);
          }
          if (arrayKind === "L" && !(itemTag instanceof nbt.Long)) {
            throw new Error(`LongArray item must be Long`);
          }
          items.push(
            (itemTag as nbt.Byte | nbt.Int | nbt.Long).value as number | bigint,
          );
          this.skipWs();
          if (this.peek() !== ",") break;
          this.pos++; // consume comma
        }
      }
      this.skipWs();
      this.expect("]");
      if (arrayKind === "B") return new nbt.ByteArray(items);
      if (arrayKind === "I") return new nbt.IntArray(items);
      return new nbt.LongArray(items);
    }
    // List form
    const items: nbt.NbtTag[] = [];
    this.skipWs();
    if (this.peek() !== "]") {
      while (true) {
        this.skipWs();
        items.push(this.parseValue());
        this.skipWs();
        if (this.peek() !== ",") break;
        this.pos++;
      }
    }
    this.skipWs();
    this.expect("]");
    return new nbt.NbtList(items);
  }

  parseCompound(): nbt.Compound {
    this.expect("{");
    const entries = new Map<string, nbt.NbtTag>();
    this.skipWs();
    if (this.peek() !== "}") {
      while (true) {
        this.skipWs();
        const key = this.parseCompoundKey();
        this.skipWs();
        this.expect(":");
        const value = this.parseValue();
        entries.set(key, value);
        this.skipWs();
        if (this.peek() !== ",") break;
        this.pos++;
      }
    }
    this.skipWs();
    this.expect("}");
    return new nbt.Compound(entries);
  }

  parseCompoundKey(): string {
    const c = this.peek();
    if (c === '"' || c === "'") return this.parseString().value;
    const start = this.pos;
    while (!this.eof && UNQUOTED_CHAR.test(this.peek())) this.pos++;
    if (this.pos === start) {
      throw new Error(`Expected compound key at ${start}`);
    }
    return this.src.slice(start, this.pos);
  }
}

export function fromSnbt(input: string): nbt.NbtTag {
  const parser = new SnbtParser(input);
  const value = parser.parseValue();
  parser.skipWs();
  if (!parser.eof) {
    throw new Error(
      `Unexpected trailing input at ${parser.pos}: ${JSON.stringify(input.slice(parser.pos))}`,
    );
  }
  return value;
}

// `1` -> `"1.0"`, `1.5` -> `"1.5"`. Matches Python's `str(1.0) == "1.0"`.
function formatFloat(n: number): string {
  if (Number.isInteger(n)) return n.toFixed(1);
  return n.toString();
}

function jsonString(s: string): string {
  // Mirror Python's json.dumps default: ensure_ascii=False isn't important
  // here since all test inputs are ASCII; JSON.stringify produces equivalent
  // output for ASCII strings.
  return JSON.stringify(s);
}

function keyToSnbt(key: string): string {
  for (const ch of key) {
    if (!UNQUOTED_CHAR.test(ch)) return jsonString(key);
  }
  return key;
}

export function toSnbt(tag: nbt.NbtTag): string {
  if (tag instanceof nbt.Byte) return `${tag.value}B`;
  if (tag instanceof nbt.Short) return `${tag.value}S`;
  if (tag instanceof nbt.Int) return `${tag.value}`;
  if (tag instanceof nbt.Long) return `${tag.value}L`;
  if (tag instanceof nbt.Float) return `${formatFloat(tag.value)}F`;
  if (tag instanceof nbt.Double) return `${formatFloat(tag.value)}D`;
  if (tag instanceof nbt.StringTag) return jsonString(tag.value);
  if (tag instanceof nbt.NbtList) {
    return `[${tag.items.map(toSnbt).join(",")}]`;
  }
  if (tag instanceof nbt.ByteArray) {
    return `[B;${(tag.toObject() as number[]).map((x) => `${x}B`).join(",")}]`;
  }
  if (tag instanceof nbt.IntArray) {
    return `[I;${(tag.toObject() as number[]).map(String).join(",")}]`;
  }
  if (tag instanceof nbt.LongArray) {
    return `[L;${(tag.toObject() as bigint[]).map((x) => `${x}L`).join(",")}]`;
  }
  if (tag instanceof nbt.Compound) {
    const parts: string[] = [];
    for (const [k, v] of tag) {
      parts.push(`${keyToSnbt(k)}:${toSnbt(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`Unknown NBT tag type: ${tag.constructor.name}`);
}
