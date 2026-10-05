// The shape of a standard library template (`use: "std:<name>"`).

import type { Operations } from "../program";

export interface StdParam {
  /** Used when the `use` doesn't pass the parameter. */
  default: unknown;
  /** One line for SPEC.md. */
  doc: string;
}

export interface StdTemplate {
  /** What the template builds, and the scope it expects. */
  doc: string;
  params: Readonly<Record<string, StdParam>>;
  /** Operations with `$name` parameters, as in a program's `templates`. */
  body: Operations;
}
