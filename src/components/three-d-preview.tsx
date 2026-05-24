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

// Chunk size matches the deepslate default we pass to StructureRenderer. Keep
// these in lock-step.
const CHUNK_SIZE = 16;

// Number of chunks to build per yield. Each call iterates the full block list
// once and only does mesh work for blocks in the supplied chunks, so larger
// batches amortize iteration overhead at the cost of longer main-thread
// occupancy. 4 keeps each pause under ~16ms on typical fixtures.
const CHUNK_BUILD_BATCH = 4;

interface Bounds {
  min: [number, number, number];
  size: [number, number, number];
}

interface ProjectionStats {
  bounds: Bounds | null;
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
// (non-air) block placement. Returns null bounds if no visible blocks exist.
function computeProjectionStats(
  projection: ParsedSchematicProjection,
): ProjectionStats {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;

  // Pre-compute visibility per palette entry so the inner loop is one map
  // lookup + one boolean check rather than a Set probe per placement.
  const visibleMask = projection.palette.map(
    (entry) => !isInvisibleBlockId(entry.blockId),
  );

  for (const region of projection.regions) {
    for (const placement of region.blocks) {
      if (!visibleMask[placement.paletteIndex]) continue;
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

  if (!any) {
    return { bounds: null };
  }
  return {
    bounds: {
      min: [minX, minY, minZ],
      size: [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1],
    },
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

// Enumerate every chunk position the structure occupies (in `CHUNK_SIZE`
// units). The chunk builder lazy-allocates chunks on demand, so this list just
// drives the batched build loop.
function listChunkPositions(
  size: [number, number, number],
): Array<[number, number, number]> {
  const cx = Math.max(1, Math.ceil(size[0] / CHUNK_SIZE));
  const cy = Math.max(1, Math.ceil(size[1] / CHUNK_SIZE));
  const cz = Math.max(1, Math.ceil(size[2] / CHUNK_SIZE));
  const out: Array<[number, number, number]> = [];
  for (let x = 0; x < cx; x += 1) {
    for (let y = 0; y < cy; y += 1) {
      for (let z = 0; z < cz; z += 1) {
        out.push([x, y, z]);
      }
    }
  }
  return out;
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

// Yields control to the browser so layout, input, and other tasks can run.
// `requestAnimationFrame` is preferred over `setTimeout(0)` because it
// guarantees a paint between batches — the user sees the structure assemble
// chunk-by-chunk rather than appearing in one jump after every yield is done.
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// Deepslate's StructureRenderer rebuilds every chunk in its constructor and
// in `setStructure()`. For large schematics that single pass is exactly what
// blocks the main thread. We dodge it by constructing the renderer over an
// empty stand-in structure (one chunk's worth of nothing → cheap), then
// reaching into the private `structure` / `chunkBuilder.structure` fields to
// swap in the real one. After that we drive `chunkBuilder.updateStructureBuffers`
// per-chunk so the work is broken up into yields. The cast lives in this one
// helper so the rest of the component doesn't care about deepslate internals.
interface PrivateChunkBuilder {
  structure: Structure;
  updateStructureBuffers: (positions?: Array<[number, number, number]>) => void;
}
interface PrivateStructureRenderer {
  structure: Structure;
  chunkBuilder: PrivateChunkBuilder;
  gridMesh: unknown;
  invisibleBlocksMesh: unknown;
  getGridMesh: () => unknown;
  getInvisibleBlocksMesh: () => unknown;
}

function swapStructureWithoutFullRebuild(
  renderer: StructureRenderer,
  realStructure: Structure,
): void {
  const priv = renderer as unknown as PrivateStructureRenderer;
  priv.structure = realStructure;
  priv.chunkBuilder.structure = realStructure;
  // The grid and invisible-blocks line meshes are sized from the structure,
  // so they need to be rebuilt after the swap. Both rebuilds are O(perimeter)
  // and don't touch block meshes.
  priv.gridMesh = priv.getGridMesh();
  priv.invisibleBlocksMesh = priv.getInvisibleBlocksMesh();
}

export function ThreeDPreview({ projection }: ThreeDPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const apiRef = React.useRef<CameraApi | null>(null);
  const stats = React.useMemo(
    () => computeProjectionStats(projection),
    [projection],
  );
  const webGLOk = React.useMemo(() => isWebGLAvailable(), []);
  const { resources, error: resourcesError } = useMinecraftResources();

  // Cleared back to false once the chunked builder finishes (or aborts via
  // cleanup). Drives the "Building preview…" overlay.
  const [isBuilding, setIsBuilding] = React.useState(false);

  React.useEffect(() => {
    if (!webGLOk || stats.bounds === null || resources === null) {
      return;
    }
    const canvasMaybe = canvasRef.current;
    if (!canvasMaybe) return;
    const canvas: HTMLCanvasElement = canvasMaybe;
    const gl = canvas.getContext("webgl");
    if (gl === null) return;

    const bounds = stats.bounds;
    let renderer: StructureRenderer | null = null;
    let scheduledFrame = 0;
    const initial = computeInitialCamera(bounds.size);
    const camera: CameraState = { ...initial.camera };
    // Set to true by the cleanup function; the async build loop checks this
    // between batches and bails out so an unmount mid-build (or a new
    // projection arriving) doesn't leak work onto the next effect.
    let cancelled = false;

    function render() {
      if (!renderer || !gl) return;
      const view = buildViewMatrix(camera, bounds.size);
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

    // Construct the renderer over an empty 0×0×0 stub so the constructor's
    // mandatory full-mesh pass is a no-op. The real structure is poked in
    // afterwards and built chunk-by-chunk below.
    try {
      const emptyStub = new Structure(BlockPos.ZERO);
      renderer = new StructureRenderer(gl, emptyStub, resources, {
        chunkSize: CHUNK_SIZE,
        useInvisibleBlockBuffer: false,
      });
      resizeCanvas();
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
        const fresh = computeInitialCamera(bounds.size).camera;
        camera.yaw = fresh.yaw;
        camera.pitch = fresh.pitch;
        camera.distance = fresh.distance;
        camera.panX = fresh.panX;
        camera.panY = fresh.panY;
        requestRender();
      },
    };

    // Kick off the chunked build. Structure-build itself is a single O(N)
    // pass (deepslate's `Structure.addBlock` does a per-call palette
    // findIndex). Then we yield once and walk the chunk list in batches,
    // rendering between each so the structure visibly assembles instead of
    // appearing all at once.
    //
    // All `setIsBuilding` calls happen inside async callbacks (after a
    // `yieldToMainThread` / `await`) — never synchronously inside the effect
    // body — so the lint rule against synchronous setState-in-effect stays
    // happy. The very first `setIsBuilding(true)` is itself behind an `await`.
    const realStructure = buildStructure(projection, bounds);
    const chunkPositions = listChunkPositions(bounds.size);

    void (async () => {
      try {
        await yieldToMainThread();
        if (cancelled || !renderer) return;
        setIsBuilding(true);
        swapStructureWithoutFullRebuild(renderer, realStructure);
        const builder = (renderer as unknown as PrivateStructureRenderer)
          .chunkBuilder;

        for (let i = 0; i < chunkPositions.length; i += CHUNK_BUILD_BATCH) {
          if (cancelled) return;
          const batch = chunkPositions.slice(i, i + CHUNK_BUILD_BATCH);
          builder.updateStructureBuffers(batch);
          requestRender();
          if (i + CHUNK_BUILD_BATCH < chunkPositions.length) {
            await yieldToMainThread();
          }
        }
        if (!cancelled) setIsBuilding(false);
      } catch (err) {
        console.error("ThreeDPreview chunk build failed", err);
        if (!cancelled) setIsBuilding(false);
      }
    })();

    return () => {
      cancelled = true;
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
  }, [projection, stats, webGLOk, resources]);

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

  if (stats.bounds === null) {
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
      {isBuilding ? (
        <div
          role="status"
          aria-label="Building 3D preview"
          style={{
            position: "absolute",
            top: "var(--space-2)",
            left: "var(--space-2)",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--bg-page) 75%, transparent)",
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
          }}
        >
          Building preview…
        </div>
      ) : null}
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
