// Modpack references as tools take them: `<slug>` for the latest upload,
// `<slug>@<pack file id or display version>` for a specific one.

import { MODPACK_SLUG_PATTERN } from "./schema.ts";

export interface ModpackRef {
  slug: string;
  /** Pack file id or display version; null for the latest upload. */
  version: string | null;
}

export const MODPACK_REF_FORM =
  "'<slug>' or '<slug>@<pack file id or version>' (e.g. 'all-the-mods-10' or 'all-the-mods-10@5678901')";

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export function parseModpackRef(raw: string): ModpackRef {
  const ref = raw.trim();
  const at = ref.indexOf("@");
  const slug = at === -1 ? ref : ref.slice(0, at);
  const version = at === -1 ? null : ref.slice(at + 1);
  if (
    !MODPACK_SLUG_PATTERN.test(slug) ||
    (version !== null && !VERSION_PATTERN.test(version))
  ) {
    throw new Error(
      `Invalid modpack reference '${raw}'. Expected ${MODPACK_REF_FORM}.`,
    );
  }
  return { slug, version };
}

export function formatModpackRef(ref: ModpackRef): string {
  return ref.version === null ? ref.slug : `${ref.slug}@${ref.version}`;
}
