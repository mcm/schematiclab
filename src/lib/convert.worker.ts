// Web Worker entry point for schemlib detect + convert calls.
//
// Owns no UI state — receives typed requests, runs the schemlib pipeline, and
// posts back a tagged response. Imported by the main thread via
// `new Worker(new URL("./convert.worker.ts", import.meta.url), { type: "module" })`.

import { detectSchematicType } from "./schemlib/schematic-formats";
import type { MinecraftVersion } from "./schemlib/schematic-formats";
import {
  convertSchematic,
  parseSchematic,
  serializeSchematic,
  type ConvertResult,
  type ParsedSchematicProjection,
  type ParseResult,
  type SchematicFormatId,
} from "./convert";
import type { ModMappingContext } from "./advanced/mod-mapping";
import {
  buildShapePreview,
  buildShapeProjection,
  type ShapePreviewResult,
  type ShapeSpec,
} from "./shapes/generate";
import {
  previewVersionMapping,
  type VersionMappingPreview,
} from "./advanced/version-mapping-preview";

// ── Wire protocol ─────────────────────────────────────────────────────────

export interface DetectPayload {
  bytes: Uint8Array;
}

export interface ConvertPayload {
  bytes: Uint8Array;
  outputFormat: SchematicFormatId;
  targetVersion?: MinecraftVersion | string;
  inputFilename?: string;
}

export interface ParsePayload {
  bytes: Uint8Array;
}

export interface TranslatePreviewPayload {
  schematic: ParsedSchematicProjection;
  // Null runs only the mod mapping (vanilla entries untouched).
  targetVersion: MinecraftVersion | null;
  // Per-namespace modded validation / rewrite input.
  mods: ModMappingContext;
}

export interface ExportPayload {
  schematic: ParsedSchematicProjection;
  outputFormat: SchematicFormatId;
  targetVersion?: MinecraftVersion | string;
  inputFilename: string;
}

export interface PreviewShapePayload {
  spec: ShapeSpec;
  /** Bigger shapes come back without their schematic. */
  maxBlocks: number;
}

export interface ExportShapePayload {
  spec: ShapeSpec;
  outputFormat: SchematicFormatId;
  inputFilename: string;
}

export type WorkerRequest =
  | { id: number; type: "detect"; payload: DetectPayload }
  | { id: number; type: "convert"; payload: ConvertPayload }
  | { id: number; type: "parse"; payload: ParsePayload }
  | {
      id: number;
      type: "translatePreview";
      payload: TranslatePreviewPayload;
    }
  | { id: number; type: "export"; payload: ExportPayload }
  | { id: number; type: "previewShape"; payload: PreviewShapePayload }
  | { id: number; type: "exportShape"; payload: ExportShapePayload };

export type WorkerResponse =
  | { id: number; ok: true; type: "detect"; result: string }
  | { id: number; ok: true; type: "convert"; result: ConvertResult }
  | { id: number; ok: true; type: "parse"; result: ParseResult }
  | {
      id: number;
      ok: true;
      type: "translatePreview";
      result: VersionMappingPreview;
    }
  | { id: number; ok: true; type: "export"; result: ConvertResult }
  | {
      id: number;
      ok: true;
      type: "previewShape";
      result: ShapePreviewResult;
    }
  | { id: number; ok: true; type: "exportShape"; result: ConvertResult }
  | { id: number; ok: false; error: string };

// ── Worker scope shim ─────────────────────────────────────────────────────
//
// tsconfig uses the "dom" lib (`self` typed as Window); the postMessage
// signature there demands a `targetOrigin`. Cast to a minimal worker-scope
// shape so we get the no-origin signature plus transferables.

type WorkerScope = {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
};

const ctx = self as unknown as WorkerScope;

// ── Handler ───────────────────────────────────────────────────────────────

ctx.addEventListener("message", (event) => {
  const request = event.data;
  const { id, type } = request;

  try {
    if (type === "detect") {
      const result = detectSchematicType(request.payload.bytes);
      ctx.postMessage({ id, ok: true, type: "detect", result });
      return;
    }

    if (type === "convert") {
      const { bytes, outputFormat, targetVersion, inputFilename } =
        request.payload;
      const result = convertSchematic({
        bytes,
        outputFormat,
        targetVersion,
        inputFilename: inputFilename ?? "schematic",
      });

      const transfer: Transferable[] =
        result.ok && result.bytes.buffer instanceof ArrayBuffer
          ? [result.bytes.buffer]
          : [];

      ctx.postMessage({ id, ok: true, type: "convert", result }, transfer);
      return;
    }

    if (type === "parse") {
      const result = parseSchematic(request.payload.bytes);
      ctx.postMessage({ id, ok: true, type: "parse", result });
      return;
    }

    if (type === "translatePreview") {
      const { schematic, targetVersion, mods } = request.payload;
      const result = previewVersionMapping(schematic, targetVersion, mods);
      ctx.postMessage({ id, ok: true, type: "translatePreview", result });
      return;
    }

    if (type === "export") {
      const { schematic, outputFormat, targetVersion, inputFilename } =
        request.payload;
      const result = serializeSchematic({
        schematic,
        outputFormat,
        targetVersion,
        inputFilename,
      });
      const transfer: Transferable[] =
        result.ok && result.bytes.buffer instanceof ArrayBuffer
          ? [result.bytes.buffer]
          : [];
      ctx.postMessage({ id, ok: true, type: "export", result }, transfer);
      return;
    }

    if (type === "previewShape") {
      const { spec, maxBlocks } = request.payload;
      const result = buildShapePreview(spec, maxBlocks);
      ctx.postMessage({ id, ok: true, type: "previewShape", result });
      return;
    }

    // Built and written here, so a big shape's placements never cross to the
    // main thread. Written for the shape's own version, so a format that
    // can't hold it (Building Gadgets) fails instead of moving it to another.
    if (type === "exportShape") {
      const { spec, outputFormat, inputFilename } = request.payload;
      const built = buildShapeProjection(spec);
      const result: ConvertResult = built.ok
        ? serializeSchematic({
            schematic: built.projection,
            outputFormat,
            inputFilename,
            targetVersion: spec.versionId,
          })
        : built;
      const transfer: Transferable[] =
        result.ok && result.bytes.buffer instanceof ArrayBuffer
          ? [result.bytes.buffer]
          : [];
      ctx.postMessage({ id, ok: true, type: "exportShape", result }, transfer);
      return;
    }

    ctx.postMessage({
      id,
      ok: false,
      error: `Unknown request type: ${String((request as { type: string }).type)}`,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown worker error";
    ctx.postMessage({ id, ok: false, error });
  }
});
