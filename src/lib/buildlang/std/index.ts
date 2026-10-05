// The standard template library: templates every program can run as
// `{"use": "std:<name>"}`. Worker-safe.
//
// A program's own templates live in another namespace, so a program template
// named `window_bay` never replaces `std:window_bay`. Unlike program
// templates, standard templates have parameter defaults.

import { balcony } from "./balcony";
import { chimney } from "./chimney";
import { doorBay } from "./door_bay";
import { dormer } from "./dormer";
import { porch } from "./porch";
import { staircase } from "./staircase";
import type { StdTemplate } from "./types";
import { windowBay } from "./window_bay";

export type { StdParam, StdTemplate } from "./types";

/** The prefix of a standard template's name in `use`. */
export const STD_PREFIX = "std:";

/** Standard templates by name, without `std:`. */
export const STD_TEMPLATES: Readonly<Record<string, StdTemplate>> = {
  window_bay: windowBay,
  door_bay: doorBay,
  porch,
  dormer,
  chimney,
  staircase,
  balcony,
};

/** The standard template a `use` name refers to, if any. */
export function stdTemplate(name: string): StdTemplate | undefined {
  if (!name.startsWith(STD_PREFIX)) return undefined;
  const key = name.slice(STD_PREFIX.length);
  return Object.hasOwn(STD_TEMPLATES, key) ? STD_TEMPLATES[key] : undefined;
}

/** Every standard template's `use` name, sorted. */
export function stdTemplateNames(): string[] {
  return Object.keys(STD_TEMPLATES)
    .sort()
    .map((name) => STD_PREFIX + name);
}

/** The defaults of a standard template's parameters. */
export function stdDefaults(template: StdTemplate): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(template.params).map(([name, p]) => [name, p.default]),
  );
}
