// Web Worker entry point for schemlib detect + convert calls.
//
// Owns no UI state — receives typed requests, runs the schemlib pipeline, and
// posts back a tagged response. Imported by the main thread via
// `new Worker(new URL("./convert.worker.ts", import.meta.url), { type: "module" })`.

import { detectSchematicType } from "./schemlib/schematic-formats";
import type { MinecraftVersion } from "./schemlib/schematic-formats";
import {
  convertSchematic,
  type ConvertResult,
  type SchematicFormatId,
} from "./convert";

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

export type WorkerRequest =
  | { id: number; type: "detect"; payload: DetectPayload }
  | { id: number; type: "convert"; payload: ConvertPayload };

export type WorkerResponse =
  | { id: number; ok: true; type: "detect"; result: string }
  | { id: number; ok: true; type: "convert"; result: ConvertResult }
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
