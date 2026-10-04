// The "Static renders" contact sheet: one image with four isometric views,
// front / side / top elevations, two plan slices and a cutaway (see
// `static-views.ts` for the geometry). `contactSheetLayout` is pure;
// `drawContactSheet` paints onto a 2D canvas context.

import {
  defaultPlanLevels,
  elevation,
  fadeHex,
  isoView,
  planSlice,
  shadeHex,
  type Elevation,
  type IsoCorner,
  type IsoView,
  type OrthoGrid,
  type VoxelModel,
} from "./static-views";

export const SHEET_WIDTH = 1440;
const MARGIN = 10;
const GAP = 10;
const HEADER_HEIGHT = 36;
const PANEL_TITLE_HEIGHT = 30;
const PANEL_PADDING = 10;
const ISO_PANEL_HEIGHT = 480;
// Room for the axis labels around a grid.
const GRID_LEFT = 34;
const GRID_BOTTOM = 30;
const GRID_RIGHT = 10;
const MAX_GRID_HEIGHT = 420;

const COLORS = {
  page: "#eef0f4",
  panel: "#f8fafc",
  title: "#1f2329",
  subtitle: "#6b7280",
  gridLine: "#1f2329",
  gridEmpty: "#ffffff",
};

// Light from the top, then the camera's right, then its left.
const FACE_SHADE = { top: 1, left: 0.8, right: 0.62 };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ContactSheetPanel =
  | {
      kind: "iso";
      title: string;
      subtitle: string;
      rect: Rect;
      corner: IsoCorner;
      maxY?: number;
    }
  | {
      kind: "grid";
      title: string;
      subtitle: string;
      rect: Rect;
      grid: OrthoGrid;
      /** Pixels per block. */
      cell: number;
      xAxis: Axis;
      yAxis: Axis;
      /** Shade cells by `nearness` (darker = further). */
      depthShading: "none" | "light" | "strong";
    };

/** Labels along one side of a grid. */
export interface Axis {
  name: string;
  /** Label of the first column (or the top row). */
  start: number;
  /** +1 or -1 per cell. */
  step: 1 | -1;
}

export interface ContactSheetLayout {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  panels: ContactSheetPanel[];
}

export interface ContactSheetOptions {
  name: string;
  /** Plan slice levels, relative to the model's lowest layer. */
  planLevels?: [number, number];
}

const ISO_TITLES: Record<IsoCorner, string> = {
  "south-east": "ISO 1",
  "north-east": "ISO 2",
  "north-west": "ISO 3",
  "south-west": "ISO 4",
};

// Views that depend only on the model (the four iso views and the
// elevations), kept per model so changing the plan levels only recomputes
// the plan slices and the cutaway.
const modelViews = new WeakMap<
  VoxelModel,
  { iso: Map<IsoCorner, IsoView>; elevations: Map<Elevation, OrthoGrid> }
>();

function viewsOf(model: VoxelModel) {
  let views = modelViews.get(model);
  if (views === undefined) {
    views = { iso: new Map(), elevations: new Map() };
    modelViews.set(model, views);
  }
  return views;
}

function cachedIsoView(
  model: VoxelModel,
  corner: IsoCorner,
  maxY: number | undefined,
): IsoView {
  if (maxY !== undefined) return isoView(model, corner, { maxY });
  const { iso } = viewsOf(model);
  let view = iso.get(corner);
  if (view === undefined) {
    view = isoView(model, corner);
    iso.set(corner, view);
  }
  return view;
}

function cachedElevation(model: VoxelModel, view: Elevation): OrthoGrid {
  const { elevations } = viewsOf(model);
  let grid = elevations.get(view);
  if (grid === undefined) {
    grid = elevation(model, view);
    elevations.set(view, grid);
  }
  return grid;
}

function columns(count: number): number {
  return (SHEET_WIDTH - 2 * MARGIN - (count - 1) * GAP) / count;
}

function gridChromeHeight(): number {
  return PANEL_TITLE_HEIGHT + PANEL_PADDING + GRID_BOTTOM;
}

// Pixels per block that fit every grid of a row into its column width.
function rowCell(grids: OrthoGrid[], width: number): number {
  const fits = grids.map((g) =>
    Math.min(
      (width - GRID_LEFT - GRID_RIGHT - 2 * PANEL_PADDING) /
        Math.max(1, g.width),
      MAX_GRID_HEIGHT / Math.max(1, g.height),
    ),
  );
  const cell = Math.min(...fits);
  return cell >= 2 ? Math.floor(cell) : cell;
}

/** Where every panel of the sheet goes, and what it shows. */
export function contactSheetLayout(
  model: VoxelModel,
  options: ContactSheetOptions,
): ContactSheetLayout {
  const [sx, sy, sz] = model.size;
  const planLevels = options.planLevels ?? defaultPlanLevels(model);
  const panels: ContactSheetPanel[] = [];
  let y = MARGIN + HEADER_HEIGHT;

  const isoWidth = columns(2);
  const corners: IsoCorner[][] = [
    ["south-east", "north-east"],
    ["north-west", "south-west"],
  ];
  for (const row of corners) {
    row.forEach((corner, i) => {
      panels.push({
        kind: "iso",
        title: ISO_TITLES[corner],
        subtitle: `from ${corner}`,
        rect: {
          x: MARGIN + i * (isoWidth + GAP),
          y,
          width: isoWidth,
          height: ISO_PANEL_HEIGHT,
        },
        corner,
      });
    });
    y += ISO_PANEL_HEIGHT + GAP;
  }

  const thirdWidth = columns(3);
  const yAxis: Axis = { name: "y", start: sy - 1, step: -1 };
  const zDown: Axis = { name: "z", start: 0, step: 1 };
  const xRight: Axis = { name: "x", start: 0, step: 1 };

  const elevations = [
    {
      title: "FRONT",
      subtitle: "from south, looking north",
      grid: cachedElevation(model, "front"),
      xAxis: xRight,
      yAxis,
      depthShading: "light" as const,
    },
    {
      title: "RIGHT SIDE",
      subtitle: "from east, looking west",
      grid: cachedElevation(model, "side"),
      xAxis: { name: "z", start: sz - 1, step: -1 } as Axis,
      yAxis,
      depthShading: "light" as const,
    },
    {
      title: "TOP",
      subtitle: "north up; brighter = higher",
      grid: cachedElevation(model, "top"),
      xAxis: xRight,
      yAxis: zDown,
      depthShading: "strong" as const,
    },
  ];
  const elevationCell = rowCell(
    elevations.map((e) => e.grid),
    thirdWidth,
  );
  const elevationHeight =
    Math.max(...elevations.map((e) => e.grid.height)) * elevationCell +
    gridChromeHeight() +
    PANEL_PADDING;
  elevations.forEach((e, i) => {
    panels.push({
      kind: "grid",
      ...e,
      rect: {
        x: MARGIN + i * (thirdWidth + GAP),
        y,
        width: thirdWidth,
        height: elevationHeight,
      },
      cell: elevationCell,
    });
  });
  y += elevationHeight + GAP;

  const plans = planLevels.map((level) => ({
    level,
    grid: planSlice(model, level),
  }));
  const planCell = rowCell(
    plans.map((p) => p.grid),
    thirdWidth,
  );
  const planHeight = Math.max(
    sz * planCell + gridChromeHeight() + PANEL_PADDING,
    // The cutaway shares the row; give it room when the plans are flat.
    320,
  );
  plans.forEach(({ level, grid }, i) => {
    panels.push({
      kind: "grid",
      title: `PLAN y=${level}`,
      subtitle: "faded = floor below",
      grid,
      xAxis: xRight,
      yAxis: zDown,
      depthShading: "none",
      rect: {
        x: MARGIN + i * (thirdWidth + GAP),
        y,
        width: thirdWidth,
        height: planHeight,
      },
      cell: planCell,
    });
  });
  panels.push({
    kind: "iso",
    title: "CUTAWAY",
    subtitle: `iso from south-east, blocks above y=${planLevels[0]} removed`,
    rect: {
      x: MARGIN + 2 * (thirdWidth + GAP),
      y,
      width: thirdWidth,
      height: planHeight,
    },
    corner: "south-east",
    maxY: planLevels[0],
  });
  y += planHeight + MARGIN;

  const blocks = model.voxels.length;
  return {
    width: SHEET_WIDTH,
    height: Math.ceil(y),
    title: options.name,
    subtitle: [
      `bounds [${sx}, ${sy}, ${sz}] (x,y,z)`,
      `${blocks.toLocaleString("en-US")} ${blocks === 1 ? "block" : "blocks"}`,
      "front = +z (south)",
    ].join("  |  "),
    panels,
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────

const DEFAULT_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export interface DrawContactSheetOptions {
  /** CSS font family list; the server passes its bundled font. */
  fontFamily?: string;
}

/** Paints `layout` onto `ctx`, whose canvas is `layout.width` × `layout.height`. */
export function drawContactSheet(
  ctx: CanvasRenderingContext2D,
  model: VoxelModel,
  layout: ContactSheetLayout,
  options: DrawContactSheetOptions = {},
): void {
  const font = options.fontFamily ?? DEFAULT_FONT;
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.title;
  ctx.font = `600 18px ${font}`;
  ctx.fillText(layout.title, MARGIN + 4, MARGIN + HEADER_HEIGHT / 2 - 4);
  const titleWidth = ctx.measureText(layout.title).width;
  ctx.fillStyle = COLORS.subtitle;
  ctx.font = `12px ${font}`;
  ctx.fillText(
    layout.subtitle,
    MARGIN + 4 + titleWidth + 16,
    MARGIN + HEADER_HEIGHT / 2 - 4,
  );

  for (const panel of layout.panels) {
    const { rect } = panel;
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.title;
    ctx.font = `600 13px ${font}`;
    const titleY = rect.y + PANEL_TITLE_HEIGHT / 2;
    ctx.fillText(panel.title, rect.x + PANEL_PADDING, titleY);
    const w = ctx.measureText(panel.title).width;
    ctx.fillStyle = COLORS.subtitle;
    ctx.font = `11px ${font}`;
    ctx.fillText(panel.subtitle, rect.x + PANEL_PADDING + w + 8, titleY);

    const content: Rect = {
      x: rect.x + PANEL_PADDING,
      y: rect.y + PANEL_TITLE_HEIGHT,
      width: rect.width - 2 * PANEL_PADDING,
      height: rect.height - PANEL_TITLE_HEIGHT - PANEL_PADDING,
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    if (panel.kind === "iso") {
      drawIso(
        ctx,
        model,
        cachedIsoView(model, panel.corner, panel.maxY),
        content,
        font,
      );
    } else {
      drawGrid(ctx, model, panel, content, font);
    }
    ctx.restore();
  }
}

function drawIso(
  ctx: CanvasRenderingContext2D,
  model: VoxelModel,
  view: IsoView,
  area: Rect,
  font: string,
): void {
  const { bounds } = view;
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
  const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const pad = 16;
  const scale = Math.min(
    (area.width - 2 * pad) / bw,
    (area.height - 2 * pad) / bh,
  );
  const ox = area.x + (area.width - bw * scale) / 2 - bounds.minX * scale;
  const oy = area.y + (area.height - bh * scale) / 2 - bounds.minY * scale;
  // Outlines once a block is big enough to show them.
  const outline = scale >= 5;
  ctx.lineJoin = "round";
  ctx.lineWidth = outline ? Math.min(1, scale / 12) : 0.5;
  for (const face of view.faces) {
    const fill = shadeHex(model.colors[face.color], FACE_SHADE[face.kind]);
    ctx.beginPath();
    face.points.forEach(([px, py], i) => {
      const sx = ox + px * scale;
      const sy = oy + py * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // Without outlines, stroking with the fill hides seams between faces.
    ctx.strokeStyle = outline ? shadeHex(fill, 0.55) : fill;
    ctx.stroke();
  }
  drawCompass(ctx, view.north, area, font);
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  north: [number, number],
  area: Rect,
  font: string,
): void {
  const cx = area.x + area.width - 30;
  const cy = area.y + area.height - 24;
  const [nx, ny] = north;
  const len = 12;
  ctx.strokeStyle = COLORS.title;
  ctx.fillStyle = COLORS.title;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - nx * len, cy - ny * len);
  ctx.lineTo(cx + nx * len, cy + ny * len);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + nx * len, cy + ny * len, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 12px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", cx + nx * (len + 9), cy + ny * (len + 9));
  ctx.textAlign = "start";
}

// Smallest "nice" label step that keeps labels at least `minPixels` apart.
export function tickStep(cell: number, minPixels = 24): number {
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const step of [1, 2, 5]) {
      if (step * magnitude * cell >= minPixels) return step * magnitude;
    }
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  model: VoxelModel,
  panel: Extract<ContactSheetPanel, { kind: "grid" }>,
  area: Rect,
  font: string,
): void {
  const { grid, cell } = panel;
  const gx = area.x + GRID_LEFT;
  const gy = area.y + 4;
  const width = grid.width * cell;
  const height = grid.height * cell;

  ctx.fillStyle = COLORS.gridEmpty;
  ctx.fillRect(gx, gy, width, height);
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const i = row * grid.width + col;
      const color = grid.cells[i];
      if (color < 0) continue;
      let fill = model.colors[color];
      if (panel.depthShading === "strong") {
        // Darken low blocks and lighten high ones, which also reads on
        // near-black blocks.
        const n = grid.nearness[i];
        fill = fadeHex(shadeHex(fill, 0.5 + 0.5 * n), 0.3 * n);
      } else if (panel.depthShading === "light") {
        fill = shadeHex(fill, 0.8 + 0.2 * grid.nearness[i]);
      }
      if (grid.below?.[i] === 1) fill = fadeHex(fill, 0.65);
      ctx.fillStyle = fill;
      // Overlap by a fraction of a pixel so small cells leave no seams.
      ctx.fillRect(
        gx + col * cell,
        gy + row * cell,
        cell + (cell < 4 ? 0.5 : 0),
        cell + (cell < 4 ? 0.5 : 0),
      );
    }
  }

  if (cell >= 6) {
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let col = 0; col <= grid.width; col++) {
      ctx.moveTo(gx + col * cell, gy);
      ctx.lineTo(gx + col * cell, gy + height);
    }
    for (let row = 0; row <= grid.height; row++) {
      ctx.moveTo(gx, gy + row * cell);
      ctx.lineTo(gx + width, gy + row * cell);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(gx, gy, width, height);

  ctx.fillStyle = COLORS.subtitle;
  ctx.font = `10px ${font}`;
  const step = tickStep(cell);
  const { xAxis, yAxis } = panel;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let col = 0; col < grid.width; col++) {
    const label = xAxis.start + xAxis.step * col;
    if (label % step !== 0) continue;
    ctx.fillText(String(label), gx + (col + 0.5) * cell, gy + height + 4);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let row = 0; row < grid.height; row++) {
    const label = yAxis.start + yAxis.step * row;
    if (label % step !== 0) continue;
    ctx.fillText(String(label), gx - 6, gy + (row + 0.5) * cell);
  }
  ctx.fillStyle = COLORS.title;
  ctx.font = `600 11px ${font}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(xAxis.name, gx + width, gy + height + 16);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(yAxis.name, area.x, gy);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
