// Main-thread client for the convert worker.
//
// Lazy-owns at most one `Worker`; pairs requests to responses by id; exposes
// `detectInWorker` / `convertInWorker` as Promise-returning wrappers. `cancel()`
// tears down the active worker and rejects every in-flight request — the next
// call lazily creates a fresh worker.

import type { MinecraftVersion } from "./schemlib/schematic-formats";
import type { ConvertResult, SchematicFormatId } from "./convert";
import type { WorkerRequest, WorkerResponse } from "./convert.worker";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function createWorker(): Worker {
  const w = new Worker(new URL("./convert.worker.ts", import.meta.url), {
    type: "module",
  });

  w.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
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
  });

  w.addEventListener("messageerror", () => {
    rejectAllPending(new Error("Worker message could not be deserialized"));
  });

  return w;
}

function getWorker(): Worker {
  if (worker === null) {
    worker = createWorker();
  }
  return worker;
}

function rejectAllPending(reason: unknown): void {
  for (const entry of pending.values()) entry.reject(reason);
  pending.clear();
}

function send<T>(
  request: Omit<WorkerRequest, "id"> & { id?: number },
  transfer: Transferable[],
): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    const message = { ...request, id } as WorkerRequest;
    w.postMessage(message, transfer);
  });
}

/**
 * Detect the schematic format of `bytes` in the worker.
 *
 * `bytes.buffer` is transferred (no copy); the caller's view becomes detached
 * after this call.
 */
export function detectInWorker(bytes: Uint8Array): Promise<string> {
  const transfer: Transferable[] =
    bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
  return send<string>(
    { type: "detect", payload: { bytes } },
    transfer,
  );
}

/**
 * Convert `bytes` to `outputFormat` in the worker, optionally version-mapping
 * to `targetVersion`. Pass `inputFilename` so the output filename can be
 * derived; defaults to "schematic" if omitted.
 *
 * `bytes.buffer` is transferred (no copy); the caller's view becomes detached
 * after this call.
 */
export function convertInWorker(
  bytes: Uint8Array,
  outputFormat: SchematicFormatId,
  targetVersion?: MinecraftVersion | string,
  inputFilename?: string,
): Promise<ConvertResult> {
  const transfer: Transferable[] =
    bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
  return send<ConvertResult>(
    {
      type: "convert",
      payload: { bytes, outputFormat, targetVersion, inputFilename },
    },
    transfer,
  );
}

/**
 * Terminate the active worker (if any) and reject every in-flight request.
 * The next `detectInWorker` / `convertInWorker` call lazily creates a new
 * worker.
 */
export function cancel(): void {
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
  rejectAllPending(new Error("Worker cancelled"));
}
