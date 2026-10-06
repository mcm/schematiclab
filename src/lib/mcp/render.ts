// Server-side contact sheets: the Advanced Editor's "Static renders" sheet
// (`render/contact-sheet.ts`) drawn on an `@napi-rs/canvas` canvas and encoded
// as PNG. Serverless functions have no system fonts, so the sheet uses the
// bundled Geist font (SIL OFL 1.1, `fonts/OFL.txt`). Vanilla colours come from
// `public/minecraft-assets/block-colors.json`, read from disk; both files are
// traced into the MCP route by `outputFileTracingIncludes` in
// `next.config.ts`. With a modpack (`modpackRenderSource`), mod blocks take
// their pack colour and, when their shape `kind` is confident, the boxes of
// that kind.

import { readFileSync } from "node:fs";
import path from "node:path";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import type { ParsedSchematicProjection } from "../convert";
import type { ModpackBlocks } from "../modpacks/registry";
import type { BlockAppearance } from "../render/block-appearance";
import {
  blockShape,
  blockShapeOfKind,
  type ShapeBox,
} from "../render/block-shapes";
import {
  contactSheetLayout,
  drawContactSheet,
  type ContactSheetOptions,
} from "../render/contact-sheet";
import { toDisplayProjection } from "../render/display-translation";
import {
  staticRenderColors,
  type RenderAppearance,
} from "../render/static-render-colors";
import { buildVoxelModel } from "../render/static-views";

/** Longest edge of a rendered PNG (the largest image Claude takes unscaled). */
export const MAX_RENDER_EDGE = 1568;

/**
 * Most cells in one face of the box enclosing the visible blocks (2048 ×
 * 2048). Elevations and plan slices allocate a grid per face, so a few blocks
 * spread far apart (regions with distant origins) would otherwise need
 * gigabytes.
 */
export const MAX_RENDER_FACE_CELLS = 2048 * 2048;

/** The bundled font family renders draw text with (`registerRenderFonts`). */
export const FONT_FAMILY = "Geist";
const FONT_DIR = path.join(process.cwd(), "src", "lib", "mcp", "fonts");
const FONT_FILES = ["Geist-Regular.ttf", "Geist-SemiBold.ttf"];
const BLOCK_COLORS_PATH = path.join(
  process.cwd(),
  "public",
  "minecraft-assets",
  "block-colors.json",
);

let fontsRegistered = false;

/** Registers the bundled render font once per instance. */
export function registerRenderFonts(): void {
  if (fontsRegistered) return;
  for (const file of FONT_FILES) {
    if (GlobalFonts.registerFromPath(path.join(FONT_DIR, file)) === null) {
      throw new Error(`Could not load the render font ${file}`);
    }
  }
  fontsRegistered = true;
}

let blockColors: Record<string, BlockAppearance> | undefined;

/** `block-colors.json`, read once per instance. */
export function vanillaBlockColors(): Record<string, BlockAppearance> {
  blockColors ??= JSON.parse(readFileSync(BLOCK_COLORS_PATH, "utf8")) as Record<
    string,
    BlockAppearance
  >;
  return blockColors;
}

export interface RenderedPng {
  png: Uint8Array;
  width: number;
  height: number;
}

/** Colours and shapes of the blocks the vanilla bundle doesn't know. */
export interface RenderAppearanceSource {
  /** A block's colour, or undefined for the vanilla colour or fallback. */
  appearance(blockId: string): RenderAppearance | undefined;
  /** A block state's boxes, or undefined for a full cube. */
  shape(
    blockId: string,
    properties: Record<string, string>,
  ): readonly ShapeBox[] | undefined;
}

/**
 * The block states of `projection`'s palette whose block `modpack` lacks
 * (neither a vanilla block of its Minecraft version nor one of its mod
 * blocks), in palette order.
 */
export function statesNotInModpack(
  projection: ParsedSchematicProjection,
  modpack: ModpackBlocks,
): string[] {
  return projection.palette
    .filter((entry) => !modpack.registry.exists(entry.blockId))
    .map((entry) => entry.blockState);
}

export type RenderOptions = Partial<ContactSheetOptions> & {
  /** Mod block colours and shapes, e.g. `modpackRenderSource(pack)`. */
  appearance?: RenderAppearanceSource;
};

const sources = new WeakMap<ModpackBlocks, RenderAppearanceSource>();

/**
 * A modpack's mod blocks as a render source: their pack colour, and the boxes
 * of their `kind` when it's confident (not `unknown`); full cubes otherwise,
 * whatever their name. Blocks the pack doesn't have keep the name-based
 * shapes.
 */
export function modpackRenderSource(
  modpack: ModpackBlocks,
): RenderAppearanceSource {
  let source = sources.get(modpack);
  if (source === undefined) {
    source = {
      appearance: (blockId) => modpack.modBlock(blockId)?.appearance,
      shape: (blockId, properties) => {
        const block = modpack.modBlock(blockId);
        if (block === undefined) return blockShape(blockId, properties);
        return block.kind === "unknown"
          ? undefined
          : blockShapeOfKind(block.kind, properties);
      },
    };
    sources.set(modpack, source);
  }
  return source;
}

/**
 * A contact sheet of `projection` as a PNG, scaled down so its longest edge
 * is at most `MAX_RENDER_EDGE`. Blocks without colour data (vanilla, or
 * `options.appearance`) get `fallbackBlockColor`.
 */
export function renderProjectionPng(
  projection: ParsedSchematicProjection,
  options: RenderOptions = {},
): RenderedPng {
  registerRenderFonts();
  const colorsById = vanillaBlockColors();
  // Legacy and renamed ids are translated to the colour bundle's version.
  const display = toDisplayProjection(projection);
  const source = options.appearance;
  const colors = staticRenderColors(display, (blockId) =>
    Object.hasOwn(colorsById, blockId)
      ? colorsById[blockId]
      : source?.appearance(blockId),
  );
  const model = buildVoxelModel(
    display,
    colors.colorFor,
    colors.colorAt,
    source && ((blockId, properties) => source.shape(blockId, properties)),
  );
  const [sx, sy, sz] = model.size;
  if (Math.max(sx * sy, sy * sz, sx * sz) > MAX_RENDER_FACE_CELLS) {
    throw new Error(
      `This schematic spans ${model.size.join(" × ")} blocks, too far apart to render (at most ${MAX_RENDER_FACE_CELLS.toLocaleString("en-US")} blocks on a face of its bounding box).`,
    );
  }
  const layout = contactSheetLayout(model, {
    name: options.name ?? (projection.name.trim() || "schematic"),
    planLevels: options.planLevels,
  });

  const scale = Math.min(
    1,
    MAX_RENDER_EDGE / Math.max(layout.width, layout.height),
  );
  const width = Math.max(1, Math.floor(layout.width * scale));
  const height = Math.max(1, Math.floor(layout.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // `@napi-rs/canvas` implements the DOM 2D context API.
  drawContactSheet(ctx as unknown as CanvasRenderingContext2D, model, layout, {
    fontFamily: FONT_FAMILY,
  });
  return { png: canvas.toBuffer("image/png"), width, height };
}
