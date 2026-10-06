// `show_blocks`' picture: one card per block with two textured isometric
// views (front-left from the south-west, back-right from the north-east) of
// its shape's boxes, and its flat top and side swatches. Drawn on an
// `@napi-rs/canvas` canvas with the same bundled font as the contact sheets
// (`render.ts`), and scaled down to `MAX_RENDER_EDGE` like them.
//
// Textures are the 16×16 face swatches of `modpacks/appearance.ts`. Each box
// face is the matching part of its swatch drawn through an affine transform,
// nearest-neighbour, then shaded like the contact sheet's faces.

import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { RgbaImage } from "../render/block-appearance";
import type { ShapeBox } from "../render/block-shapes";
import { paintOrder } from "../render/static-views";
import {
  FONT_FAMILY,
  MAX_RENDER_EDGE,
  registerRenderFonts,
  type RenderedPng,
} from "./render";

/** One block of the sheet. */
export interface BlockCard {
  /** The block state (or frame and camo) the card shows. */
  title: string;
  /** Kind, mod and colour, in a line. */
  subtitle: string;
  /** The shape's boxes; undefined for a full cube. */
  boxes: readonly ShapeBox[] | undefined;
  /** Swatches of the faces drawn; any size, usually 16×16. */
  top: RgbaImage;
  side: RgbaImage;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BlockCellKind = "front-left" | "back-right" | "top" | "side";

export const BLOCK_CELL_KINDS: readonly BlockCellKind[] = [
  "front-left",
  "back-right",
  "top",
  "side",
];

export interface BlockCardLayout {
  rect: Rect;
  /** One cell per `BLOCK_CELL_KINDS` entry, in that order. */
  cells: { kind: BlockCellKind; rect: Rect }[];
}

export interface BlockSheetLayout {
  /** Unscaled size; the PNG is scaled to fit `MAX_RENDER_EDGE`. */
  width: number;
  height: number;
  cards: BlockCardLayout[];
}

const MARGIN = 10;
const GAP = 10;
const HEADER_HEIGHT = 36;
const CARD_PADDING = 10;
const CARD_TITLE_HEIGHT = 40;
const CELL = 132;
const CELL_GAP = 8;
const CELL_LABEL_HEIGHT = 18;
const CARD_WIDTH = 2 * CARD_PADDING + 4 * CELL + 3 * CELL_GAP;
const CARD_HEIGHT = CARD_TITLE_HEIGHT + CELL + CELL_LABEL_HEIGHT + CARD_PADDING;
const EMPTY_HEIGHT = 40;

const COLORS = {
  page: "#eef0f4",
  panel: "#f8fafc",
  title: "#1f2329",
  subtitle: "#6b7280",
  cell: "#ffffff",
  outline: "rgba(0, 0, 0, 0.35)",
};

// As the contact sheet: light from the top, then the camera's left, then
// its right.
const SHADE = { top: 1, left: 0.8, right: 0.62 };

/** Where every card and cell of a sheet of `count` blocks goes. */
export function blockSheetLayout(count: number): BlockSheetLayout {
  const columns = count <= 4 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const width = 2 * MARGIN + columns * CARD_WIDTH + (columns - 1) * GAP;
  const body =
    rows === 0 ? EMPTY_HEIGHT : rows * CARD_HEIGHT + (rows - 1) * GAP;
  const height = 2 * MARGIN + HEADER_HEIGHT + body;
  const cards: BlockCardLayout[] = [];
  for (let i = 0; i < count; i++) {
    const x = MARGIN + (i % columns) * (CARD_WIDTH + GAP);
    const y =
      MARGIN + HEADER_HEIGHT + Math.floor(i / columns) * (CARD_HEIGHT + GAP);
    cards.push({
      rect: { x, y, width: CARD_WIDTH, height: CARD_HEIGHT },
      cells: BLOCK_CELL_KINDS.map((kind, j) => ({
        kind,
        rect: {
          x: x + CARD_PADDING + j * (CELL + CELL_GAP),
          y: y + CARD_TITLE_HEIGHT,
          width: CELL,
          height: CELL,
        },
      })),
    });
  }
  return { width, height, cards };
}

/** The scale `blockSheetLayout(count)` is drawn at. */
export function blockSheetScale(layout: BlockSheetLayout): number {
  return Math.min(1, MAX_RENDER_EDGE / Math.max(layout.width, layout.height));
}

// ── Isometric geometry ────────────────────────────────────────────────────

type Corner = "south-west" | "north-east";
type Point = [number, number];
export type Vec3 = [number, number, number];

const COS30 = Math.cos(Math.PI / 6);
const FULL_CUBE: readonly ShapeBox[] = [[0, 0, 0, 1, 1, 1]];

// World (x, z) of a block-local point → view (u, v), the camera towards +u
// and +v (as `static-views.ts`, about the block's centre).
function toView(corner: Corner, x: number, z: number): [number, number] {
  return corner === "south-west" ? [z - 0.5, 0.5 - x] : [0.5 - z, x - 0.5];
}

function project(corner: Corner, [x, y, z]: Vec3): Point {
  const [u, v] = toView(corner, x, z);
  return [(u - v) * COS30, (u + v) * 0.5 - y];
}

/** A face to draw: its swatch, the part of it, and texel → world. */
interface IsoFace {
  texture: "top" | "side";
  shade: number;
  /** Texel rectangle `[a0, b0, a1, b1]` of the 16-wide texture space. */
  src: [number, number, number, number];
  /** World point of texel (a, b), in a 16-texel texture space. */
  world: (a: number, b: number) => Vec3;
}

// The faces of `box` the camera at `corner` sees: the top, then the side
// towards +u (`right`) and the side towards +v (`left`).
function boxFaces(corner: Corner, box: ShapeBox): IsoFace[] {
  const [x0, y0, z0, x1, y1, z1] = box;
  const t = (n: number) => n * 16;
  const vertical = [t(1 - y1), t(1 - y0)] as const;
  const top: IsoFace = {
    texture: "top",
    shade: SHADE.top,
    src: [t(x0), t(z0), t(x1), t(z1)],
    world: (a, b) => [a / 16, y1, b / 16],
  };
  const south: IsoFace = {
    texture: "side",
    shade: 0,
    src: [t(x0), vertical[0], t(x1), vertical[1]],
    world: (a, b) => [a / 16, 1 - b / 16, z1],
  };
  const west: IsoFace = {
    texture: "side",
    shade: 0,
    src: [t(z0), vertical[0], t(z1), vertical[1]],
    world: (a, b) => [x0, 1 - b / 16, a / 16],
  };
  const north: IsoFace = {
    texture: "side",
    shade: 0,
    src: [t(1 - x1), vertical[0], t(1 - x0), vertical[1]],
    world: (a, b) => [1 - a / 16, 1 - b / 16, z0],
  };
  const east: IsoFace = {
    texture: "side",
    shade: 0,
    src: [t(1 - z1), vertical[0], t(1 - z0), vertical[1]],
    world: (a, b) => [x1, 1 - b / 16, 1 - a / 16],
  };
  // South-west: +u is south (+z), +v is west (-x); north-east the opposite.
  const [right, left] = corner === "south-west" ? [south, west] : [north, east];
  return [
    top,
    { ...right, shade: SHADE.right },
    { ...left, shade: SHADE.left },
  ];
}

// `box` in view coordinates (u0, y0, v0, u1, y1, v1), for `paintOrder`.
function viewBox(corner: Corner, box: ShapeBox): ShapeBox {
  const [x0, y0, z0, x1, y1, z1] = box;
  const [ua, va] = toView(corner, x0, z0);
  const [ub, vb] = toView(corner, x1, z1);
  return [
    Math.min(ua, ub),
    y0,
    Math.min(va, vb),
    Math.max(ua, ub),
    y1,
    Math.max(va, vb),
  ];
}

// ── Drawing ───────────────────────────────────────────────────────────────

function imageCanvas(image: RgbaImage): Canvas {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const data = ctx.createImageData(image.width, image.height);
  data.data.set(image.data);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function ellipsize(ctx: SKRSContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > width) {
    end--;
  }
  return `${text.slice(0, end)}…`;
}

const CORNER_OF: Record<"front-left" | "back-right", Corner> = {
  "front-left": "south-west",
  "back-right": "north-east",
};

/**
 * Where the block-local point `p` (0–1 on each axis) lands in an isometric
 * `cell` of the unscaled layout.
 */
export function isoCellPoint(
  cell: Rect,
  view: "front-left" | "back-right",
  p: Vec3,
): Point {
  // A full cube spans x ±cos 30°, y from -1.5 to 0.5; every shape fits in it.
  const pad = 12;
  const unit = Math.min(
    (cell.width - 2 * pad) / (2 * COS30),
    (cell.height - 2 * pad) / 2,
  );
  const [sx, sy] = project(CORNER_OF[view], p);
  return [
    cell.x + cell.width / 2 + sx * unit,
    cell.y + cell.height / 2 + (sy + 0.5) * unit,
  ];
}

function drawIso(
  ctx: SKRSContext2D,
  card: BlockCard,
  textures: { top: Canvas; side: Canvas },
  view: "front-left" | "back-right",
  cell: Rect,
  scale: number,
): void {
  const corner = CORNER_OF[view];
  const screen = (p: Vec3): Point => {
    const [x, y] = isoCellPoint(cell, view, p);
    return [x * scale, y * scale];
  };

  const boxes = card.boxes ?? FULL_CUBE;
  const worldOf = new Map<ShapeBox, ShapeBox>();
  for (const box of boxes) worldOf.set(viewBox(corner, box), box);
  for (const view of paintOrder([...worldOf.keys()])) {
    for (const face of boxFaces(corner, worldOf.get(view)!)) {
      const [a0, b0, a1, b1] = face.src;
      if (a1 <= a0 || b1 <= b0) continue;
      const o = screen(face.world(0, 0));
      const ea = screen(face.world(16, 0));
      const eb = screen(face.world(0, 16));
      ctx.save();
      ctx.setTransform(
        (ea[0] - o[0]) / 16,
        (ea[1] - o[1]) / 16,
        (eb[0] - o[0]) / 16,
        (eb[1] - o[1]) / 16,
        o[0],
        o[1],
      );
      const texture = textures[face.texture];
      const kx = texture.width / 16;
      const ky = texture.height / 16;
      ctx.drawImage(
        texture,
        a0 * kx,
        b0 * ky,
        (a1 - a0) * kx,
        (b1 - b0) * ky,
        a0,
        b0,
        a1 - a0,
        b1 - b0,
      );
      if (face.shade < 1) {
        ctx.fillStyle = `rgba(0, 0, 0, ${(1 - face.shade).toFixed(3)})`;
        ctx.fillRect(a0, b0, a1 - a0, b1 - b0);
      }
      ctx.restore();
      // Outlines in screen space, so they're even, and hide seams.
      const corners = [
        screen(face.world(a0, b0)),
        screen(face.world(a1, b0)),
        screen(face.world(a1, b1)),
        screen(face.world(a0, b1)),
      ];
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      corners.forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y),
      );
      ctx.closePath();
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.5, scale);
      ctx.strokeStyle = COLORS.outline;
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * The cards as one PNG under `title` and `subtitle`, its longest edge at most
 * `MAX_RENDER_EDGE`. No cards draws a one-line "nothing to show" sheet.
 */
export function renderBlockSheetPng(
  cards: readonly BlockCard[],
  title: string,
  subtitle: string,
): RenderedPng {
  registerRenderFonts();
  const font = FONT_FAMILY;
  const layout = blockSheetLayout(cards.length);
  const scale = blockSheetScale(layout);
  const width = Math.max(1, Math.floor(layout.width * scale));
  const height = Math.max(1, Math.floor(layout.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const base = () => ctx.setTransform(scale, 0, 0, scale, 0, 0);
  base();

  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.title;
  ctx.font = `600 18px ${font}`;
  ctx.fillText(title, MARGIN + 4, MARGIN + HEADER_HEIGHT / 2 - 4);
  const titleWidth = ctx.measureText(title).width;
  ctx.fillStyle = COLORS.subtitle;
  ctx.font = `12px ${font}`;
  ctx.fillText(
    subtitle,
    MARGIN + 4 + titleWidth + 16,
    MARGIN + HEADER_HEIGHT / 2 - 4,
  );
  if (cards.length === 0) {
    ctx.font = `13px ${font}`;
    ctx.fillText(
      "None of the blocks exist, so there is nothing to show.",
      MARGIN + 4,
      MARGIN + HEADER_HEIGHT + EMPTY_HEIGHT / 2 - 4,
    );
  }

  cards.forEach((card, i) => {
    const { rect, cells } = layout.cards[i];
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    const textWidth = rect.width - 2 * CARD_PADDING;
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.title;
    ctx.font = `600 13px ${font}`;
    ctx.fillText(
      ellipsize(ctx, card.title, textWidth),
      rect.x + CARD_PADDING,
      rect.y + 13,
    );
    ctx.fillStyle = COLORS.subtitle;
    ctx.font = `11px ${font}`;
    ctx.fillText(
      ellipsize(ctx, card.subtitle, textWidth),
      rect.x + CARD_PADDING,
      rect.y + 29,
    );

    const textures = {
      top: imageCanvas(card.top),
      side: imageCanvas(card.side),
    };
    for (const { kind, rect: cell } of cells) {
      ctx.fillStyle = COLORS.cell;
      ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
      if (kind === "top" || kind === "side") {
        const texture = textures[kind];
        ctx.drawImage(
          texture,
          0,
          0,
          texture.width,
          texture.height,
          cell.x,
          cell.y,
          cell.width,
          cell.height,
        );
      } else {
        drawIso(ctx, card, textures, kind, cell, scale);
        base();
      }
      ctx.fillStyle = COLORS.subtitle;
      ctx.font = `11px ${font}`;
      ctx.textAlign = "center";
      ctx.fillText(
        kind,
        cell.x + cell.width / 2,
        cell.y + cell.height + CELL_LABEL_HEIGHT / 2,
      );
      ctx.textAlign = "start";
    }
  });

  return { png: canvas.toBuffer("image/png"), width, height };
}
