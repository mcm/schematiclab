// Camo materials as text: `<frame state>{camo=<block state>}`, and
// `{camo=<a>,camo_two=<b>}` for FramedBlocks double blocks. The build
// language and the MCP `generate_shape` tool both read this syntax; the
// camo is written with `write.ts` (`writeCamoChoice`).
//
// Worker-safe: no DOM access. Must not import from src/lib/render/.

import { defaultCamoSlots } from "./extract";
import type { CamoChoice, CamoTarget } from "./write";

/** The camo keys of the syntax: `camo`, plus `camo_two` for double blocks. */
export type CamoKey = "camo" | "camo_two";

export const CAMO_KEYS: readonly CamoKey[] = ["camo", "camo_two"];

/** A material split into its frame and its camo block states, as written. */
export interface CamoMaterialText {
  frame: string;
  /** `camo_two` only when written; undefined without a `{...}` suffix. */
  camo?: { camo: string; camo_two?: string };
}

/**
 * Splits `text` into the frame and the `{camo=...,camo_two=...}` suffix.
 * Commas inside a camo's `[...]` states don't split. Returns an error
 * message for a malformed suffix.
 */
export function splitCamoMaterial(
  text: string,
): { ok: true; value: CamoMaterialText } | { ok: false; error: string } {
  const trimmed = text.trim();
  const open = trimmed.indexOf("{");
  if (open < 0) {
    return trimmed.includes("}")
      ? { ok: false, error: `unbalanced '}' in ${JSON.stringify(text)}` }
      : { ok: true, value: { frame: trimmed } };
  }
  const usage = "write {camo=<block>} or {camo=<block>,camo_two=<block>}";
  if (!trimmed.endsWith("}")) {
    return {
      ok: false,
      error: `the camo suffix must end the material (${usage})`,
    };
  }
  const frame = trimmed.slice(0, open).trim();
  if (frame === "") {
    return { ok: false, error: `a camo needs a frame block before '{'` };
  }
  const body = trimmed.slice(open + 1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === "{" || c === "}") {
      return { ok: false, error: `nested braces in the camo (${usage})` };
    } else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  const camo: Partial<Record<CamoKey, string>> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (eq < 0 || !(CAMO_KEYS as readonly string[]).includes(key) || !value) {
      return {
        ok: false,
        error: `bad camo ${JSON.stringify(part.trim())} (${usage})`,
      };
    }
    if (Object.hasOwn(camo, key)) {
      return { ok: false, error: `'${key}' is given twice` };
    }
    camo[key as CamoKey] = value;
  }
  if (camo.camo === undefined) {
    return { ok: false, error: `the camo suffix needs camo= (${usage})` };
  }
  return {
    ok: true,
    value: {
      frame,
      camo: {
        camo: camo.camo,
        ...(camo.camo_two !== undefined && { camo_two: camo.camo_two }),
      },
    },
  };
}

/**
 * Why `frameId` can't take `keys` (null when it can): it must save camo,
 * and `camo_two` needs a block with two camo slots.
 */
export function camoFrameError(
  frameId: string,
  frameProperties: Record<string, string>,
  keys: readonly CamoKey[],
): string | null {
  const slots = defaultCamoSlots(frameId, frameProperties);
  if (slots.length === 0) {
    return `${frameId} doesn't hold a camo; a camo frame is a FramedBlocks or copycat block.`;
  }
  if (keys.includes("camo_two") && slots.length < 2) {
    return `${frameId} has one camo slot; camo_two is only for double blocks.`;
  }
  return null;
}

/**
 * The camo of each slot of a placed frame: the first slot takes `camo`, the
 * second `camo_two` when given, and every other slot `camo`.
 */
export function camoChoiceForFrame(
  frameId: string,
  frameProperties: Record<string, string>,
  camo: { camo: CamoTarget; camo_two?: CamoTarget },
): CamoChoice {
  const slots = defaultCamoSlots(frameId, frameProperties);
  return Object.fromEntries(
    slots.map((slot, i) => [
      slot,
      i === 1 && camo.camo_two !== undefined ? camo.camo_two : camo.camo,
    ]),
  );
}

/** `{camo=...,camo_two=...}` of camo targets, as the syntax writes it. */
export function formatCamoSuffix(camo: {
  camo: CamoTarget;
  camo_two?: CamoTarget;
}): string {
  const state = ({ blockId, properties }: CamoTarget) => {
    const list = Object.entries(properties)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return list ? `${blockId}[${list}]` : blockId;
  };
  return `{camo=${state(camo.camo)}${camo.camo_two ? `,camo_two=${state(camo.camo_two)}` : ""}}`;
}
