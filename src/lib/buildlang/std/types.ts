// A built-in template: an operation list like a program's `templates`
// entry, plus a default for every parameter it uses. Worker-safe.

export interface StdTemplate {
  /** Parameter → default value. Every `$name` in `body` is listed here. */
  params: Readonly<Record<string, unknown>>;
  /** Operations, with `$name` parameters as in program templates. */
  body: readonly unknown[];
}
