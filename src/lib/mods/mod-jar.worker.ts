// Web Worker entry point for mod jar parsing.
//
// Receives a jar's bytes, runs `parseModJar`, and posts the result back with
// every texture buffer transferred (no structured-clone copies). Also computes
// block appearances for mods stored before appearances existed
// (`computeAppearances`). Both load the vanilla models and atlas once, for
// mod models built on vanilla parents. Imported by
// the main thread via
// `new Worker(new URL("./mod-jar.worker.ts", import.meta.url), { type: "module" })`.

import type { BlockAppearance } from "../render/block-appearance";
import {
  computeModAppearances,
  type ModAppearanceInput,
} from "./mod-appearance";
import { parseModJar, textureTransferables } from "./parse-mod-jar";
import type { ParsedModAssets } from "./types";
import { loadVanillaAppearanceSources } from "./vanilla-appearance-sources";

// ── Wire protocol ─────────────────────────────────────────────────────────

export interface ParseJarPayload {
  bytes: Uint8Array;
}

export interface ComputeAppearancesResult {
  appearances: Record<string, BlockAppearance>;
  /** False when the vanilla bundle couldn't be loaded. */
  complete: boolean;
}

export type ModJarWorkerRequest =
  | { id: number; type: "parseJar"; payload: ParseJarPayload }
  | { id: number; type: "computeAppearances"; payload: ModAppearanceInput };

export type ModJarWorkerResponse =
  | { id: number; ok: true; type: "parseJar"; result: ParsedModAssets }
  | {
      id: number;
      ok: true;
      type: "computeAppearances";
      result: ComputeAppearancesResult;
    }
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

// Start fetching the vanilla bundle now so it overlaps the jar download.
// It never rejects (a failure resolves to null and is retried on the next
// call), so handlers still await it and fall back as before.
void loadVanillaAppearanceSources();

ctx.addEventListener("message", (event) => {
  void handle(event.data);
});

async function handle(request: ModJarWorkerRequest): Promise<void> {
  const { id, type } = request;
  try {
    if (type === "parseJar") {
      const vanilla = await loadVanillaAppearanceSources();
      const result = parseModJar(request.payload.bytes, vanilla);
      ctx.postMessage(
        { id, ok: true, type: "parseJar", result },
        textureTransferables(result),
      );
      return;
    }
    if (type === "computeAppearances") {
      const vanilla = await loadVanillaAppearanceSources();
      const appearances = computeModAppearances(request.payload, vanilla);
      ctx.postMessage({
        id,
        ok: true,
        type: "computeAppearances",
        result: { appearances, complete: vanilla !== null },
      });
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
}
