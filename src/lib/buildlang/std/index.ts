// The standard template library: built-in templates a program runs with
// `{"use": "std:<name>"}` (documented in `SPEC.md`, "Standard templates").
// They live in their own namespace, so a program template of the same name
// never replaces one. Worker-safe.

import { balcony } from "./balcony";
import { chimney } from "./chimney";
import { doorBay } from "./door-bay";
import { dormer } from "./dormer";
import { porch } from "./porch";
import { staircase } from "./staircase";
import type { StdTemplate } from "./types";
import { windowBay } from "./window-bay";

export type { StdTemplate } from "./types";

/** Prefix of a built-in template's name in `use`. */
export const STD_PREFIX = "std:";

/** Built-in templates by name (without `std:`). */
export const STD_TEMPLATES: Readonly<Record<string, StdTemplate>> = {
  balcony,
  chimney,
  door_bay: doorBay,
  dormer,
  porch,
  staircase,
  window_bay: windowBay,
};

/** The built-in template a `use` names (`"std:porch"`), if any. */
export function stdTemplate(name: string): StdTemplate | undefined {
  if (!name.startsWith(STD_PREFIX)) return undefined;
  const key = name.slice(STD_PREFIX.length);
  return Object.hasOwn(STD_TEMPLATES, key) ? STD_TEMPLATES[key] : undefined;
}

/** Every built-in template's `use` name, sorted. */
export function stdTemplateNames(): string[] {
  return Object.keys(STD_TEMPLATES)
    .map((k) => STD_PREFIX + k)
    .sort();
}
