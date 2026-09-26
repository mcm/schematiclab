// Web Worker entry point for mod jar parsing.
//
// Receives a jar's bytes, runs `parseModJar`, and posts the result back with
// every texture buffer transferred (no structured-clone copies). Imported by
// the main thread via
// `new Worker(new URL("./mod-jar.worker.ts", import.meta.url), { type: "module" })`.

import { parseModJar, textureTransferables } from "./parse-mod-jar";
import type { ParsedModAssets } from "./types";

// ── Wire protocol ─────────────────────────────────────────────────────────

export interface ParseJarPayload {
  bytes: Uint8Array;
}

export type ModJarWorkerRequest = {
  id: number;
  type: "parseJar";
  payload: ParseJarPayload;
};

export type ModJarWorkerResponse =
  | { id: number; ok: true; type: "parseJar"; result: ParsedModAssets }
  | { id: number; ok: false; error: string };

// ── Worker scope shim ─────────────────────────────────────────────────────
//
// tsconfig uses the "dom" lib (`self` typed as Window); cast to a minimal
// worker-scope shape so we get the no-origin postMessage signature.

type WorkerScope = {
  postMessage(message: ModJarWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ModJarWorkerRequest>) => void,
  ): void;
};

const ctx = self as unknown as WorkerScope;

// ── Handler ───────────────────────────────────────────────────────────────

ctx.addEventListener("message", (event) => {
  const { id, type, payload } = event.data;
  try {
    if (type === "parseJar") {
      const result = parseModJar(payload.bytes);
      ctx.postMessage(
        { id, ok: true, type: "parseJar", result },
        textureTransferables(result),
      );
      return;
    }
    ctx.postMessage({
      id,
      ok: false,
      error: `Unknown request type: ${String(type)}`,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ id, ok: false, error });
  }
});
