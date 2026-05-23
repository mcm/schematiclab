"use client";

import * as React from "react";
import {
  BlockPos,
  Structure,
  StructureRenderer,
  type Resources,
} from "deepslate";
import { mat4 } from "gl-matrix";
import { Button } from "@iamthemcmaster/ui";
import { IconRefresh } from "@tabler/icons-react";
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
const HALF_FOV_RAD = (FIELD_OF_VIEW_DEG * Math.PI) / 360;

// Camera interaction tuning.
const ORBIT_RADIANS_PER_PIXEL = 0.01;
const WHEEL_ZOOM_BASE = 1.0015; // distance multiplier per wheel deltaY unit
const PITCH_LIMIT = (Math.PI / 2) * 0.99; // ~89° — avoid pole flip
const MIN_DISTANCE_FACTOR = 0.05; // relative to fitDistance
const MAX_DISTANCE_FACTOR = 10;
const FIT_DISTANCE_MARGIN = 1.25;

interface Bounds {
  min: [number, number, number];
  size: [number, number, number];
}

interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  panX: number;
  panY: number;
}

interface CameraInitial {
  camera: CameraState;
  minDistance: number;
  maxDistance: number;
}

interface CameraApi {
  reset: () => void;
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

// Auto-fit: pull back enough that the bounding sphere fits in the vertical FoV,
// plus a small margin so the schematic isn't kissing the viewport edges.
function computeInitialCamera(size: [number, number, number]): CameraInitial {
  const [Lx, Ly, Lz] = size;
  const radius = 0.5 * Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
  const fitDistance = (radius / Math.tan(HALF_FOV_RAD)) * FIT_DISTANCE_MARGIN;
  return {
    camera: {
      yaw: Math.PI / 4,
      pitch: Math.PI / 6,
      distance: fitDistance,
      panX: 0,
      panY: 0,
    },
    minDistance: Math.max(0.5, fitDistance * MIN_DISTANCE_FACTOR),
    maxDistance: fitDistance * MAX_DISTANCE_FACTOR,
  };
}

function buildViewMatrix(
  cam: CameraState,
  size: [number, number, number],
): mat4 {
  const view = mat4.create();
  // Order applied to world coords (innermost first):
  //   1. -centroid:           translate the structure so its center is at origin
  //   2. yaw (around Y):      spin horizontally
  //   3. pitch (around X):    tilt
  //   4. -distance / +pan:    push back along -Z and offset in screen space
  mat4.translate(view, view, [cam.panX, cam.panY, -cam.distance]);
  mat4.rotateX(view, view, cam.pitch);
  mat4.rotateY(view, view, cam.yaw);
  mat4.translate(view, view, [-size[0] / 2, -size[1] / 2, -size[2] / 2]);
  return view;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
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
  const apiRef = React.useRef<CameraApi | null>(null);
  const bounds = React.useMemo(() => computeBounds(projection), [projection]);
  const webGLOk = React.useMemo(() => isWebGLAvailable(), []);
  const { resources, error: resourcesError } = useMinecraftResources();

  React.useEffect(() => {
    if (!webGLOk || bounds === null || resources === null) return;
    const canvasMaybe = canvasRef.current;
    if (!canvasMaybe) return;
    const canvas: HTMLCanvasElement = canvasMaybe;
    const gl = canvas.getContext("webgl");
    if (gl === null) return;

    let renderer: StructureRenderer | null = null;
    let scheduledFrame = 0;
    const initial = computeInitialCamera(bounds.size);
    const camera: CameraState = { ...initial.camera };

    function render() {
      if (!renderer || !gl) return;
      const view = buildViewMatrix(camera, bounds!.size);
      gl.clearColor(0.07, 0.08, 0.1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.drawGrid(view);
      renderer.drawStructure(view);
    }

    function requestRender() {
      if (scheduledFrame) return;
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = 0;
        render();
      });
    }

    function resizeCanvas() {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
      const width = canvas.clientWidth || canvas.width || 320;
      const height = canvas.clientHeight || canvas.height || 240;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      if (renderer) renderer.setViewport(0, 0, canvas.width, canvas.height);
    }

    try {
      const structure = buildStructure(projection, bounds);
      renderer = new StructureRenderer(gl, structure, resources, {
        chunkSize: 16,
        useInvisibleBlockBuffer: false,
      });
      resizeCanvas();
      render();
    } catch (err) {
      // Renderer construction failures here would be deepslate-internal
      // (shader compile, mesh build) and are not user-actionable. Log so
      // they're surfaced in dev tools; the canvas stays blank, which is its
      // own signal something went wrong.
      console.error("ThreeDPreview render failed", err);
      return;
    }

    const activePointers = new Map<
      number,
      { x: number; y: number; type: string }
    >();
    let lastPinchDistance: number | null = null;
    let lastPinchMidpoint: { x: number; y: number } | null = null;

    function applyOrbit(dx: number, dy: number) {
      camera.yaw += dx * ORBIT_RADIANS_PER_PIXEL;
      camera.pitch = clamp(
        camera.pitch + dy * ORBIT_RADIANS_PER_PIXEL,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
      requestRender();
    }

    function applyPan(dxPixels: number, dyPixels: number) {
      // Project screen-space pixel deltas into world units at the focal plane:
      // viewport height in world units = 2 · distance · tan(halfFov).
      const viewportH = canvas.clientHeight || 1;
      const worldPerPixel =
        (2 * camera.distance * Math.tan(HALF_FOV_RAD)) / viewportH;
      camera.panX += dxPixels * worldPerPixel;
      // Screen Y grows downward; world Y in our view (after the screen-space
      // pan translation) grows upward, so invert.
      camera.panY -= dyPixels * worldPerPixel;
      requestRender();
    }

    function applyZoom(factor: number) {
      camera.distance = clamp(
        camera.distance * factor,
        initial.minDistance,
        initial.maxDistance,
      );
      requestRender();
    }

    function isPanGesture(e: PointerEvent): boolean {
      if (e.pointerType === "touch") return false;
      const rightButtonHeld = (e.buttons & 2) !== 0;
      return rightButtonHeld || e.shiftKey;
    }

    function onPointerDown(e: PointerEvent) {
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType,
      });
      if (activePointers.size === 2) {
        const pts = [...activePointers.values()];
        lastPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        lastPinchMidpoint = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
      }
    }

    function onPointerMove(e: PointerEvent) {
      const prev = activePointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      activePointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType,
      });

      if (activePointers.size === 1) {
        if (isPanGesture(e)) {
          applyPan(dx, dy);
        } else {
          applyOrbit(dx, dy);
        }
        return;
      }

      // Two-finger pinch (zoom + pan via midpoint). Driven by both pointers,
      // so we recompute once per move event regardless of which one fired.
      const pts = [...activePointers.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      if (lastPinchDistance !== null && dist > 0) {
        applyZoom(lastPinchDistance / dist);
      }
      if (lastPinchMidpoint !== null) {
        applyPan(mid.x - lastPinchMidpoint.x, mid.y - lastPinchMidpoint.y);
      }
      lastPinchDistance = dist;
      lastPinchMidpoint = mid;
    }

    function onPointerUp(e: PointerEvent) {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        lastPinchDistance = null;
        lastPinchMidpoint = null;
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      applyZoom(WHEEL_ZOOM_BASE ** e.deltaY);
    }

    function onContextMenu(e: MouseEvent) {
      // Suppress the browser context menu so right-button-drag pan is usable.
      e.preventDefault();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            resizeCanvas();
            requestRender();
          })
        : null;
    resizeObserver?.observe(canvas);

    apiRef.current = {
      reset: () => {
        const fresh = computeInitialCamera(bounds!.size).camera;
        camera.yaw = fresh.yaw;
        camera.pitch = fresh.pitch;
        camera.distance = fresh.distance;
        camera.panX = fresh.panX;
        camera.panY = fresh.panY;
        requestRender();
      },
    };

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      resizeObserver?.disconnect();
      if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
      apiRef.current = null;
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
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        aria-label="3D preview of the staged schematic. Drag to orbit, right-click drag or shift+drag to pan, scroll to zoom."
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          borderRadius: "var(--radius-md)",
          touchAction: "none",
          cursor: "grab",
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => apiRef.current?.reset()}
        style={{
          position: "absolute",
          top: "var(--space-2)",
          right: "var(--space-2)",
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
        }}
      >
        <IconRefresh size={14} aria-hidden="true" />
        Reset view
      </Button>
    </div>
  );
}
