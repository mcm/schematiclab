// Template parameter substitution for `use` (port of Cairn's `_substitute`).
// Worker-safe.
//
// In a template body, a value `"$name"` becomes the parameter itself (any
// JSON value), a key `"$name"` becomes the parameter's string, and
// `"${name}"` inside a longer string becomes the parameter's text. Unlike
// Cairn, a reference to a parameter the `use` doesn't pass is an error at the
// reference's path instead of being left in place, and `#` comment keys are
// never touched.

import { type ProgramError, pathKey } from "./program";

/** Deepest chain of templates using templates. */
export const MAX_TEMPLATE_DEPTH = 32;

const WHOLE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const INLINE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const MISSING = Symbol("missing parameter");

export interface Substitution {
  body: unknown;
  /** Missing parameters and parameters of the wrong type, at their paths. */
  errors: ProgramError[];
  /** Names of the parameters the body uses. */
  used: Set<string>;
}

function show(v: unknown): string {
  return JSON.stringify(v) ?? String(v);
}

/**
 * Substitutes `params` into a template `body` found at `path`
 * (`templates.<name>`).
 */
export function substituteParams(
  body: unknown,
  params: Readonly<Record<string, unknown>>,
  path: string,
): Substitution {
  const errors: ProgramError[] = [];
  const used = new Set<string>();

  /** The parameter's value, or `MISSING` (reported) when it isn't passed. */
  const lookup = (name: string, at: string): unknown => {
    used.add(name);
    if (Object.hasOwn(params, name)) return params[name];
    errors.push({
      path: at,
      message: `missing parameter '${name}' (pass it in the use's "with")`,
    });
    return MISSING;
  };

  const text = (s: string, at: string): unknown => {
    const whole = WHOLE.exec(s);
    if (whole) {
      const v = lookup(whole[1], at);
      return v === MISSING ? s : v;
    }
    return s.replace(INLINE, (ref, name: string) => {
      const v = lookup(name, at);
      if (v === MISSING) return ref;
      if (typeof v === "string" || typeof v === "number") return String(v);
      errors.push({
        path: at,
        message: `parameter '${name}' is used inside text, so it must be a string or number, got ${show(v)}`,
      });
      return ref;
    });
  };

  const walk = (v: unknown, at: string): unknown => {
    if (typeof v === "string") return text(v, at);
    if (Array.isArray(v)) return v.map((item, i) => walk(item, `${at}[${i}]`));
    if (typeof v !== "object" || v === null) return v;
    const out: Record<string, unknown> = {};
    for (const [k, value] of Object.entries(v)) {
      if (k.startsWith("#")) {
        out[k] = value;
        continue;
      }
      const keyPath = pathKey(at, k);
      let key = k;
      const ref = WHOLE.exec(k);
      if (ref) {
        const name = lookup(ref[1], keyPath);
        if (typeof name === "string") key = name;
        else if (name !== MISSING) {
          errors.push({
            path: keyPath,
            message: `parameter '${ref[1]}' is used as a key, so it must be a string, got ${show(name)}`,
          });
        }
      }
      out[key] = walk(value, keyPath);
    }
    return out;
  };

  return { body: walk(body, path), errors, used };
}
