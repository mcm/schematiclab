"use client";

import * as React from "react";
import {
  BlockPos,
  Structure,
  StructureRenderer,
  type Resources,
} from "deepslate";
import { mat4 } from "gl-matrix";
import type { ParsedSchematicProjection } from "@/lib/convert";
import {
  ensureMinecraftResourcesLoading,
  getCachedMinecraftResources,
  getMinecraftResourcesError,
  isInvisibleBlockId,
  subscribeMinecraftResources,
} from "@/lib/render/minecraft-resources";

interface ThreeDPreviewProps {
  projection: ParsedSchematicProjection;
}

// Matches `Renderer.getPerspective()` in deepslate — keep in sync if upstream
// changes the FoV.
const FIELD_OF_VIEW_DEG = 70;

interface Bounds {
  min: [number, number, number];
  size: [number, number, number];
}

// Compute the smallest axis-aligned bounding box containing every visible
// block placement. Returns null if the schematic has no visible blocks (all
// air, or empty).
function computeBounds(projection: ParsedSchematicProjection): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;

  for (const region of projection.regions) {
    for (const placement of region.blocks) {
      const entry = projection.palette[placement.paletteIndex];
      if (entry === undefined || isInvisibleBlockId(entry.blockId)) continue;
      any = true;
      const [x, y, z] = placement.pos;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }

  if (!any) return null;
  return {
    min: [minX, minY, minZ],
    size: [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1],
  };
}

// Build a deepslate `Structure` from our projection. Block positions are
// translated by `-bounds.min` so the structure sits at the origin.
function buildStructure(
  projection: ParsedSchematicProjection,
  bounds: Bounds,
): Structure {
  const structure = new Structure(
    BlockPos.create(bounds.size[0], bounds.size[1], bounds.size[2]),
  );
  for (const region of projection.regions) {
    for (const placement of region.blocks) {
      const entry = projection.palette[placement.paletteIndex];
      if (entry === undefined || isInvisibleBlockId(entry.blockId)) continue;
      const [x, y, z] = placement.pos;
      structure.addBlock(
        BlockPos.create(x - bounds.min[0], y - bounds.min[1], z - bounds.min[2]),
        entry.blockId,
        entry.properties,
      );
    }
  }
  return structure;
}

// Auto-fit camera: pull back from the structure center by enough that the
// bounding sphere (half the box diagonal) just fits inside the vertical FoV,
// plus a small margin so the schematic isn't kissing the viewport edges.
function buildViewMatrix(size: [number, number, number]): mat4 {
  const [Lx, Ly, Lz] = size;
  const radius = 0.5 * Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
  const halfFov = (FIELD_OF_VIEW_DEG * Math.PI) / 360;
  const fitDistance = radius / Math.tan(halfFov);
  const distance = -fitDistance * 1.25;

  const view = mat4.create();
  mat4.translate(view, view, [0, 0, distance]);
  mat4.rotateX(view, view, Math.PI / 6); // ~30° tilt down
  mat4.rotateY(view, view, Math.PI / 4); // ~45° yaw
  mat4.translate(view, view, [-Lx / 2, -Ly / 2, -Lz / 2]);
  return view;
}

// One-shot probe: does this browser support WebGL? Done synchronously so we
// can render the "WebGL unavailable" fallback without needing effect state,
// which would otherwise trip react-hooks/set-state-in-effect.
let webGLAvailableCache: boolean | null = null;
function isWebGLAvailable(): boolean {
  if (typeof document === "undefined") return false;
  if (webGLAvailableCache !== null) return webGLAvailableCache;
  try {
    const probe = document.createElement("canvas");
    webGLAvailableCache = probe.getContext("webgl") !== null;
  } catch {
    webGLAvailableCache = false;
  }
  return webGLAvailableCache;
}

function useMinecraftResources(): {
  resources: Resources | null;
  error: Error | null;
} {
  const resources = React.useSyncExternalStore(
    subscribeMinecraftResources,
    getCachedMinecraftResources,
    () => null,
  );
  const error = React.useSyncExternalStore(
    subscribeMinecraftResources,
    getMinecraftResourcesError,
    () => null,
  );

  // Trigger the load on first mount. The function is idempotent — repeated
  // calls share the same singleton promise — so it's safe to call from every
  // mounted instance.
  React.useEffect(() => {
    ensureMinecraftResourcesLoading();
  }, []);

  return { resources, error };
}

export function ThreeDPreview({ projection }: ThreeDPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const bounds = React.useMemo(() => computeBounds(projection), [projection]);
  const webGLOk = React.useMemo(() => isWebGLAvailable(), []);
  const { resources, error: resourcesError } = useMinecraftResources();

  React.useEffect(() => {
    if (!webGLOk || bounds === null || resources === null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl");
    if (gl === null) return;

    let renderer: StructureRenderer | null = null;
    try {
      const structure = buildStructure(projection, bounds);
      renderer = new StructureRenderer(gl, structure, resources, {
        chunkSize: 16,
        useInvisibleBlockBuffer: false,
      });

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
      const width = canvas.clientWidth || canvas.width || 320;
      const height = canvas.clientHeight || canvas.height || 240;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      renderer.setViewport(0, 0, canvas.width, canvas.height);

      const view = buildViewMatrix(bounds.size);
      gl.clearColor(0.07, 0.08, 0.1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.drawGrid(view);
      renderer.drawStructure(view);
    } catch (err) {
      // Renderer construction failures here would be deepslate-internal
      // (shader compile, mesh build) and are not user-actionable. Log so
      // they're surfaced in dev tools; the canvas stays blank, which is its
      // own signal something went wrong.
      console.error("ThreeDPreview render failed", err);
    }

    return () => {
      // Drop the renderer reference; the canvas and its WebGL context will
      // be GC'd when this component unmounts. Don't call
      // `WEBGL_lose_context.loseContext()` here — under React strict mode
      // the cleanup runs between mount/unmount/remount on the same canvas,
      // and a lost context can't be reinitialized, which would break the
      // second mount's StructureRenderer (shader compile returns no log).
      renderer = null;
    };
  }, [projection, bounds, webGLOk, resources]);

  if (!webGLOk) {
    return (
      <div
        role="alert"
        style={{
          color: "var(--color-error)",
          fontSize: "var(--text-sm)",
          padding: "var(--space-3)",
        }}
      >
        WebGL is not available in this browser.
      </div>
    );
  }

  if (bounds === null) {
    return (
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
          padding: "var(--space-3)",
        }}
      >
        Schematic contains no visible blocks to render.
      </div>
    );
  }

  if (resourcesError !== null) {
    return (
      <div
        role="alert"
        style={{
          color: "var(--color-error)",
          fontSize: "var(--text-sm)",
          padding: "var(--space-3)",
        }}
      >
        Failed to load Minecraft assets for the 3D preview.
      </div>
    );
  }

  if (resources === null) {
    return (
      <div
        role="status"
        aria-label="Loading 3D preview"
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-sm)",
          padding: "var(--space-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        Loading 3D preview…
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="3D preview of the staged schematic"
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        borderRadius: "var(--radius-md)",
      }}
    />
  );
}
