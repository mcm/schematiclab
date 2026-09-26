// Main-thread client for the mod-jar worker.
//
// Lazy-owns at most one `Worker`; pairs requests to responses by id; exposes
// `parseModJarInWorker` as a Promise-returning wrapper. `cancel()` tears down
// the active worker and rejects every in-flight request — the next call lazily
// creates a fresh worker.

import type {
  ModJarWorkerRequest,
  ModJarWorkerResponse,
} from "./mod-jar.worker";
import type { ParsedModAssets } from "./types";

type Pending = {
  resolve: (value: ParsedModAssets) => void;
  reject: (reason: unknown) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function createWorker(): Worker {
  const w = new Worker(new URL("./mod-jar.worker.ts", import.meta.url), {
    type: "module",
  });

  w.addEventListener("message", (event: MessageEvent<ModJarWorkerResponse>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (entry === undefined) return;
    pending.delete(data.id);
    if (data.ok) {
      entry.resolve(data.result);
    } else {
      entry.reject(new Error(data.error));
    }
  });

  w.addEventListener("error", (event) => {
    const message =
      typeof (event as ErrorEvent).message === "string" &&
      (event as ErrorEvent).message.length > 0
        ? (event as ErrorEvent).message
        : "Worker error";
    rejectAllPending(new Error(message));
    discardWorker();
  });

  w.addEventListener("messageerror", () => {
    rejectAllPending(new Error("Worker message could not be deserialized"));
    discardWorker();
  });

  return w;
}

function rejectAllPending(reason: unknown): void {
  for (const entry of pending.values()) entry.reject(reason);
  pending.clear();
}

function discardWorker(): void {
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
}

/**
 * Parse a mod jar in the worker, returning its blocks and render assets.
 *
 * `bytes.buffer` is transferred (no copy); the caller's view becomes detached
 * after this call. Texture buffers in the result are transferred back.
 */
export function parseModJarInWorker(
  bytes: Uint8Array,
): Promise<ParsedModAssets> {
  if (worker === null) worker = createWorker();
  const w = worker;
  const id = nextId++;
  const transfer: Transferable[] =
    bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
  return new Promise<ParsedModAssets>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const message: ModJarWorkerRequest = {
      id,
      type: "parseJar",
      payload: { bytes },
    };
    w.postMessage(message, transfer);
  });
}

/**
 * Terminate the active worker (if any) and reject every in-flight request.
 */
export function cancel(): void {
  discardWorker();
  rejectAllPending(new Error("Worker cancelled"));
}
