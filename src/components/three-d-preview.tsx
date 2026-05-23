"use client";

import * as React from "react";
import { BlockPos, Structure, StructureRenderer } from "deepslate";
import { mat4 } from "gl-matrix";
import type { ParsedSchematicProjection } from "@/lib/convert";
import {
  createSmokeResources,
  isInvisibleBlockId,
} from "@/lib/render/smoke-resources";

interface ThreeDPreviewProps {
  projection: ParsedSchematicProjection;
}

// Compute the smallest axis-aligned bounding box containing every visible
// block placement. Returns null if the schematic has no visible blocks (all
// air, or empty).
function computeBounds(projection: ParsedSchematicProjection): {
  min: [number, number, number];
  size: [number, number, number];
} | null {
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
  bounds: { min: [number, number, number]; size: [number, number, number] },
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

// Place the camera so the whole bounding box is visible. We pull back to
// 1.5× the longest dimension along -Z, then rotate slightly so the user can
// see depth without any camera controls.
function buildViewMatrix(size: [number, number, number]): mat4 {
  const maxDim = Math.max(size[0], size[1], size[2], 1);
  const distance = -maxDim * 2.5;
  const view = mat4.create();
  mat4.translate(view, view, [0, 0, distance]);
  mat4.rotateX(view, view, Math.PI / 6); // ~30° tilt down
  mat4.rotateY(view, view, Math.PI / 4); // ~45° yaw
  mat4.translate(view, view, [-size[0] / 2, -size[1] / 2, -size[2] / 2]);
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

export function ThreeDPreview({ projection }: ThreeDPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const bounds = React.useMemo(() => computeBounds(projection), [projection]);
  const webGLOk = React.useMemo(() => isWebGLAvailable(), []);

  React.useEffect(() => {
    if (!webGLOk || bounds === null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl");
    if (gl === null) return;

    let renderer: StructureRenderer | null = null;
    try {
      const structure = buildStructure(projection, bounds);
      const resources = createSmokeResources();
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
  }, [projection, bounds, webGLOk]);

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
