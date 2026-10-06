// `show_blocks`: up to `MAX_SHOW_BLOCKS` blocks of a Minecraft version or a
// modpack as one picture (`block-sheet.ts`), with their kind, mod and colours.
// Camo pairs draw the frame's shape in the camo material's swatches.
//
// Vanilla swatches come from the asset bundle on disk
// (`vanilla-appearance.ts`); mod swatches from the mod file's swatch sheet
// in Blob (`mod-files/<key>/swatches.png`), read only for the requested
// blocks' mod files and cached per instance.

import { z } from "zod";
import { isCamoCapableBlockId } from "../camo/extract";
import { SWATCH_SIZE, type SwatchFace } from "../modpacks/appearance";
import { modFileSwatchesPath } from "../modpacks/paths";
import { readBlob } from "../modpacks/reader";
import type { ModpackBlockInfo } from "../modpacks/registry";
import type { ModBlockSwatch } from "../modpacks/schema";
import { decodePng, type RgbaImage } from "../render/block-appearance";
import {
  blockShape,
  blockShapeOfKind,
  type ShapeBox,
} from "../render/block-shapes";
import { fallbackBlockColor } from "../render/static-views";
import type { BlobClient } from "./blob";
import { renderBlockSheetPng, type BlockCard } from "./block-sheet";
import {
  CAMO_MATERIAL_NOTE,
  CAMO_MATERIAL_RULE,
  modpackCamoFrames,
} from "./camo-options";
import {
  camoMaterialsOf,
  lookOf,
  scopeNote,
  searchScope,
  vanillaBundleId,
  versionInput,
  type BlockLook,
  type SearchScope,
} from "./block-tools";
import { modpackInput } from "./input";
import { defineTool } from "./types";
import { vanillaBlockDescriptors } from "./vanilla-appearance";

export const MAX_SHOW_BLOCKS = 16;

/** Most bytes of one swatch sheet (`MAX_SWATCH_SHEET_BYTES`, with room). */
const MAX_SWATCH_SHEET_READ_BYTES = 8 * 1024 * 1024;

// ── Swatch sheets ──────────────────────────────────────────────────────────

// Decoded sheets per mod-file key. A key names one file's content, so a
// sheet never changes; failed reads aren't kept.
const sheetCache = new Map<string, Promise<RgbaImage | null>>();

export function clearSwatchSheetCache(): void {
  sheetCache.clear();
}

/** A mod file's decoded swatch sheet, or null when it isn't stored. */
export function loadSwatchSheet(
  blob: BlobClient,
  fileKey: string,
): Promise<RgbaImage | null> {
  let sheet = sheetCache.get(fileKey);
  if (!sheet) {
    const path = modFileSwatchesPath(fileKey);
    sheet = readBlob(blob, path, MAX_SWATCH_SHEET_READ_BYTES).then((bytes) => {
      if (bytes === null) return null;
      const image = decodePng(bytes);
      if (!image) throw new Error(`${path} is not a PNG this server reads.`);
      return image;
    });
    const pending = sheet;
    sheetCache.set(fileKey, pending);
    pending.then(
      (image) => {
        if (image === null && sheetCache.get(fileKey) === pending) {
          sheetCache.delete(fileKey);
        }
      },
      () => {
        if (sheetCache.get(fileKey) === pending) sheetCache.delete(fileKey);
      },
    );
  }
  return sheet;
}

function crop(
  sheet: RgbaImage,
  [x, y, width, height]: readonly number[],
): RgbaImage | null {
  if (x + width > sheet.width || y + height > sheet.height) return null;
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * sheet.width + x) * 4;
    data.set(sheet.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

function solid(hex: string): RgbaImage {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const data = new Uint8Array(SWATCH_SIZE * SWATCH_SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: SWATCH_SIZE, height: SWATCH_SIZE, data };
}

type Faces = Partial<Record<SwatchFace, RgbaImage | null>>;

/** The top and side to draw, each falling back on the other faces. */
function pickFaces(
  faces: Faces | undefined,
  fallbackHex: string,
): { top: RgbaImage; side: RgbaImage; textured: boolean } {
  const first = (...order: SwatchFace[]) =>
    order.map((face) => faces?.[face]).find((image) => image != null) ??
    undefined;
  const top = first("top", "side", "bottom");
  const side = first("side", "top", "bottom");
  return {
    top: top ?? solid(fallbackHex),
    side: side ?? solid(fallbackHex),
    textured: top !== undefined,
  };
}

// ── Blocks ─────────────────────────────────────────────────────────────────

const blockEntryInput = z.union([
  z
    .string()
    .min(1)
    .describe(
      "A block state, e.g. minecraft:oak_stairs[facing=east] or create:brass_casing.",
    ),
  z
    .object({
      frame: z
        .string()
        .min(1)
        .describe(
          "A camo frame's block state, e.g. framedblocks:framed_stairs.",
        ),
      camo: z.string().min(1).describe("The camo material's block id."),
    })
    .describe("A camo frame holding a camo material."),
]);

const showBlocksInput = z.object({
  blocks: z
    .array(blockEntryInput)
    .min(1)
    .max(MAX_SHOW_BLOCKS)
    .describe(
      `1 to ${MAX_SHOW_BLOCKS} block states, or { frame, camo } camo pairs.`,
    ),
  version: versionInput,
  modpack: modpackInput,
});

interface ResolvedState {
  id: string;
  /** The properties the state names. */
  properties: Record<string, string>;
  /** Every property: defaults overlaid with `properties`. */
  state: Record<string, string>;
  look: BlockLook;
  mod?: ModpackBlockInfo;
}

interface NotFound {
  id: string;
  did_you_mean: string[];
}

// A block state of `scope`, or why it isn't one: a block the scope lacks is
// `not_found`; bad properties of a block it has are an error.
function resolveState(
  scope: SearchScope,
  raw: string,
): ResolvedState | NotFound {
  const text = raw.trim();
  const checked = scope.registry.validateState(text);
  if (!checked.ok) {
    const name = text.replace(/\[.*$/, "");
    if (!scope.registry.exists(name)) {
      return { id: name, did_you_mean: scope.registry.suggest(name) };
    }
    throw new Error(checked.error);
  }
  return {
    id: checked.id,
    properties: checked.properties,
    state: checked.state,
    look: lookOf(scope, checked.id),
    mod: scope.modpack?.modBlock(checked.id),
  };
}

const isNotFound = (r: ResolvedState | NotFound): r is NotFound =>
  "did_you_mean" in r;

/** A block state's text: the id with the properties it names. */
function stateText({ id, properties }: ResolvedState): string {
  const props = Object.entries(properties);
  return props.length === 0
    ? id
    : `${id}[${props.map(([k, v]) => `${k}=${v}`).join(",")}]`;
}

// Boxes as the static renders draw them: a mod block's kind when it's
// confident, the name rules for vanilla blocks.
function shapeOf(block: ResolvedState): readonly ShapeBox[] | undefined {
  if (block.mod) {
    return block.mod.kind === "unknown"
      ? undefined
      : blockShapeOfKind(block.mod.kind, block.state);
  }
  return blockShape(block.id, block.state);
}

const lookOutput = {
  id: z.string(),
  properties: z.record(z.string(), z.string()).optional(),
  mod: z.string(),
  kind: z.string(),
  hex: z.string().optional(),
  dominant: z
    .array(z.object({ hex: z.string(), share: z.number() }))
    .optional(),
  variance: z.number().optional(),
};

interface ShownLook {
  id: string;
  properties?: Record<string, string>;
  mod: string;
  kind: string;
  hex?: string;
  dominant?: { hex: string; share: number }[];
  variance?: number;
}

function shownLook(block: ResolvedState, kind = block.look.kind): ShownLook {
  const { look } = block;
  return {
    id: block.id,
    ...(Object.keys(block.properties).length > 0 && {
      properties: block.properties,
    }),
    mod: look.mod,
    kind,
    ...(look.hex !== undefined && { hex: look.hex }),
    ...(look.dominant !== undefined && { dominant: look.dominant }),
    ...(look.variance !== undefined && { variance: look.variance }),
  };
}

type Entry =
  | { type: "block"; block: ResolvedState }
  | {
      type: "camo";
      frame: ResolvedState;
      camo: ResolvedState;
      kind: string;
      writable: boolean;
      reason?: string;
      approximateMaterial: boolean;
    };

export const showBlocksTool = defineTool({
  name: "show_blocks",
  title: "Show blocks",
  description: `See up to ${MAX_SHOW_BLOCKS} blocks of a Minecraft version or a modpack as one PNG: per block, two textured isometric views (front-left and back-right) of its shape and its flat top and side faces, built from the blocks' face swatches. Give block states, or { frame, camo } pairs to see a camo frame (FramedBlocks, Copycats+, Create copycats) holding a camo material. Also returns each block's mod, kind, average colour (hex), dominant colours and texture variance; ids the version or pack lacks are listed under not_found with close names and aren't drawn. Use it to check a block looks right before building with it: block names (black_terracotta, brass_block) don't reliably say how a block looks, least of all mod blocks. When the user names a modpack, pass its ref (from list_modpacks) as modpack.`,
  inputSchema: showBlocksInput,
  outputSchema: z.object({
    version: z.string(),
    modpack: z.string().optional(),
    blocks: z.array(
      z.object({
        ...lookOutput,
        camo: z.object(lookOutput).optional(),
        writable: z.boolean().optional(),
        reason: z.string().optional(),
      }),
    ),
    not_found: z.array(
      z.object({ id: z.string(), did_you_mean: z.array(z.string()) }),
    ),
    camo_material_rule: z.literal(CAMO_MATERIAL_RULE).optional(),
    note: z.string().optional(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args, deps) => {
    const scope = await searchScope(args, deps);
    const notFound: NotFound[] = [];
    const entries: Entry[] = [];
    const notes: string[] = [];
    const versionNote = scopeNote(scope);
    if (versionNote) notes.push(versionNote);

    const resolve = (raw: string) => {
      const result = resolveState(scope, raw);
      if (!isNotFound(result)) return result;
      if (!notFound.some((n) => n.id === result.id)) notFound.push(result);
      return undefined;
    };
    for (const raw of args.blocks) {
      if (typeof raw === "string") {
        const block = resolve(raw);
        if (block) entries.push({ type: "block", block });
        continue;
      }
      const frame = resolve(raw.frame);
      const camo = resolve(raw.camo);
      if (!frame || !camo) continue;
      if (!isCamoCapableBlockId(frame.id)) {
        throw new Error(
          `${frame.id} isn't a camo frame; give a FramedBlocks or copycat block as frame.`,
        );
      }
      const known = scope.modpack
        ? modpackCamoFrames(scope.modpack).find((f) => f.id === frame.id)
        : undefined;
      const kind = known?.kind ?? frame.look.kind;
      const materials = scope.modpack
        ? camoMaterialsOf({ ...scope, modpack: scope.modpack })
        : undefined;
      const reason = known
        ? known.reason
        : `No camo shape rule covers ${frame.id}, so the server doesn't write its camo.`;
      entries.push({
        type: "camo",
        frame,
        camo,
        kind,
        writable: known?.writable ?? false,
        ...(reason !== undefined && { reason }),
        approximateMaterial: materials?.has(camo.id) ?? false,
      });
    }

    // Swatch sheets of the requested mod blocks' files only.
    const files = new Set<string>();
    for (const entry of entries) {
      const block = entry.type === "block" ? entry.block : entry.camo;
      if (block.mod?.swatch) files.add(block.mod.swatch.file);
    }
    const sheets = new Map<string, RgbaImage | null>();
    if (files.size > 0 && deps.blob) {
      const blob = deps.blob;
      await Promise.all(
        [...files].map(async (file) =>
          sheets.set(file, await loadSwatchSheet(blob, file)),
        ),
      );
    }

    const descriptors = vanillaBlockDescriptors();
    const facesOf = (block: ResolvedState): Faces | undefined => {
      if (block.mod) {
        const swatch: ModBlockSwatch | undefined = block.mod.swatch;
        const sheet = swatch && sheets.get(swatch.file);
        if (!swatch || !sheet) return undefined;
        const faces: Faces = {};
        for (const [face, rect] of Object.entries(swatch.faces)) {
          faces[face as SwatchFace] = crop(sheet, rect);
        }
        return faces;
      }
      const bundleId = vanillaBundleId(scope.data, block.id);
      return bundleId ? descriptors.get(bundleId)?.faces : undefined;
    };
    const flat: string[] = [];
    const swatchesOf = (block: ResolvedState) => {
      const picked = pickFaces(
        facesOf(block),
        block.look.hex ?? fallbackBlockColor(block.id),
      );
      if (!picked.textured && !flat.includes(block.id)) flat.push(block.id);
      return picked;
    };

    const cards: BlockCard[] = [];
    const shown: Record<string, unknown>[] = [];
    let camoShown = false;
    for (const entry of entries) {
      if (entry.type === "block") {
        const { block } = entry;
        const { top, side } = swatchesOf(block);
        const look = block.look;
        cards.push({
          title: stateText(block),
          subtitle: [look.kind, look.mod, look.hex].filter(Boolean).join(" · "),
          boxes: shapeOf(block),
          top,
          side,
        });
        shown.push({ ...shownLook(block) });
        continue;
      }
      camoShown = true;
      const { frame, camo, kind } = entry;
      const { top, side } = swatchesOf(camo);
      const boxes =
        kind === "block" || kind === "unknown"
          ? undefined
          : blockShapeOfKind(kind, frame.state);
      cards.push({
        title: `${stateText(frame)} + ${camo.id}`,
        subtitle: [
          `${kind} frame`,
          `camo ${camo.look.mod}`,
          camo.look.hex,
          entry.writable ? undefined : "not writable",
        ]
          .filter(Boolean)
          .join(" · "),
        boxes,
        top,
        side,
      });
      shown.push({
        ...shownLook(frame, kind),
        camo: shownLook(camo),
        writable: entry.writable,
        ...(entry.reason !== undefined && { reason: entry.reason }),
      });
      if (!entry.approximateMaterial) {
        notes.push(
          `${camo.id} isn't a full-cube camo material, so ${frame.id} may refuse it.`,
        );
      }
    }

    if (notFound.length > 0) {
      notes.push(
        `Not drawn, not in ${scope.modpack ? `modpack '${scope.modpack.ref}'` : `Minecraft ${scope.versionId}`}: ${notFound.map((n) => n.id).join(", ")}.`,
      );
    }
    if (flat.length > 0) {
      notes.push(
        `No face swatches for ${flat.join(", ")}; drawn in a flat colour.`,
      );
    }
    if (camoShown) notes.push(CAMO_MATERIAL_NOTE);

    const where = scope.modpack
      ? `${scope.modpack.ref} · Minecraft ${scope.versionId}`
      : `Minecraft ${scope.versionId}`;
    const { png, width, height } = renderBlockSheetPng(cards, "Blocks", where);
    const value = {
      version: scope.versionId,
      ...(scope.modpack ? { modpack: scope.modpack.ref } : {}),
      blocks: shown,
      not_found: notFound,
      ...(camoShown ? { camo_material_rule: CAMO_MATERIAL_RULE } : {}),
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
    return {
      content: [
        {
          type: "image",
          data: Buffer.from(png).toString("base64"),
          mimeType: "image/png",
        },
        {
          type: "text",
          text: `${cards.length} block${cards.length === 1 ? "" : "s"} (${width}×${height} PNG). ${JSON.stringify(value)}`,
        },
      ],
      structuredContent: value,
    };
  },
});
