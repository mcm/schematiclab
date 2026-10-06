// Lenient JSON reading, close to what Minecraft's resource loading accepts.
//
// Minecraft reads blockstates and models with Gson in lenient mode, which
// stops after the first complete top-level value and skips comments. Mods
// ship files that rely on this (a stray character after the closing brace),
// so a strict `JSON.parse` would silently drop their blocks. Worker-safe.

/**
 * The first complete top-level JSON value in `text`, with comments outside
 * strings blanked out, or null when there is none (empty, truncated, or an
 * unterminated string or block comment). Comments are `//` and `#` to the end
 * of the line, and `/* … *\/`, as Gson's lenient reader accepts.
 *
 * The result still needs `JSON.parse`; this only finds where the value ends.
 */
export function firstJsonValue(text: string): string | null {
  let out = "";
  let depth = 0;
  let started = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      i = lineEnd(text, i);
      out += " ";
      continue;
    }
    if (c === "#") {
      i = lineEnd(text, i);
      out += " ";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
      out += " ";
      continue;
    }
    if (c === '"') {
      const end = stringEnd(text, i);
      if (end < 0) return null;
      out += text.slice(i, end);
      i = end;
      started = true;
      if (depth === 0) return out;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
      started = true;
    } else if (c === "}" || c === "]") {
      depth--;
      out += c;
      i++;
      if (depth <= 0) return depth === 0 ? out : null;
      continue;
    } else if (depth === 0 && !isWhitespace(c)) {
      // A top-level scalar (number, true, false, null) ends at the next
      // delimiter.
      let end = i;
      while (end < n && !isDelimiter(text[end])) end++;
      return out + text.slice(i, end);
    }
    out += c;
    i++;
  }
  return started && depth === 0 ? out : null;
}

/** Index after the closing quote of the string starting at `start`, or -1. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"') return i + 1;
  }
  return -1;
}

function lineEnd(text: string, start: number): number {
  const lf = text.indexOf("\n", start);
  const cr = text.indexOf("\r", start);
  const ends = [lf, cr].filter((e) => e >= 0);
  return ends.length === 0 ? text.length : Math.min(...ends);
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿";
}

function isDelimiter(c: string): boolean {
  return (
    isWhitespace(c) ||
    c === "," ||
    c === "{" ||
    c === "}" ||
    c === "[" ||
    c === "]" ||
    c === ":" ||
    c === "/" ||
    c === "#" ||
    c === '"'
  );
}
