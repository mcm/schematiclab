// Main-thread client for the mod-jar worker.
//
// Lazy-owns at most one `Worker`; pairs requests to responses by id; exposes
// `parseModJarInWorker` and `computeModAppearancesInWorker` as
// Promise-returning wrappers. `cancel()` tears down
// the active worker and rejects every in-flight request — the next call lazily
// creates a fresh worker.

import type { ModAppearanceInput } from "./mod-appearance";
import type {
  ComputeAppearancesResult,
  ModJarWorkerRequest,
  ModJarWorkerResponse,
} from "./mod-jar.worker";
import type { ParsedModAssets } from "./types";

type RequestType = ModJarWorkerRequest["type"];
type ResultOf<K extends RequestType> = Extract<
  ModJarWorkerResponse,
  { ok: true; type: K }
>["result"];

// One member per request type, so the response is narrowed by `type` before
// it resolves the caller's promise.
type Pending = {
  [K in RequestType]: {
    type: K;
    resolve: (value: ResultOf<K>) => void;
    reject: (reason: unknown) => void;
  };
}[RequestType];

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
    if (!data.ok) {
      entry.reject(new Error(data.error));
    } else if (data.type === "parseJar" && entry.type === "parseJar") {
      entry.resolve(data.result);
    } else if (
      data.type === "computeAppearances" &&
      entry.type === "computeAppearances"
    ) {
      entry.resolve(data.result);
    } else {
      entry.reject(
        new Error(`Expected a ${entry.type} response, got ${data.type}`),
      );
    }
  });

  // A terminated worker can still deliver a queued error; ignore it so it
  // cannot reject requests on (or tear down) a replacement worker.
  w.addEventListener("error", (event) => {
    if (worker !== w) return;
    const message =
      typeof (event as ErrorEvent).message === "string" &&
      (event as ErrorEvent).message.length > 0
        ? (event as ErrorEvent).message
        : "Worker error";
    rejectAllPending(new Error(message));
    discardWorker();
  });

  w.addEventListener("messageerror", () => {
    if (worker !== w) return;
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
 * When `bytes` spans its whole `ArrayBuffer`, that buffer is transferred (no
 * copy) and the caller's view becomes detached; a view into a larger buffer is
 * copied instead so other views stay intact. Texture buffers in the result are
 * transferred back.
 */
export function parseModJarInWorker(
  bytes: Uint8Array,
): Promise<ParsedModAssets> {
  let transfer: Transferable[] = [];
  if (bytes.buffer instanceof ArrayBuffer) {
    if (
      bytes.byteOffset !== 0 ||
      bytes.byteLength !== bytes.buffer.byteLength
    ) {
      bytes = bytes.slice();
    }
    transfer = [bytes.buffer];
  }
  return request<ParsedModAssets>(
    (id) => ({ id, type: "parseJar", payload: { bytes } }),
    (resolve, reject) => ({ type: "parseJar", resolve, reject }),
    transfer,
  );
}

/**
 * Compute block appearances for a stored mod file in the worker. Texture
 * bytes are copied, never transferred.
 */
export function computeModAppearancesInWorker(
  input: ModAppearanceInput,
): Promise<ComputeAppearancesResult> {
  return request<ComputeAppearancesResult>(
    (id) => ({ id, type: "computeAppearances", payload: input }),
    (resolve, reject) => ({ type: "computeAppearances", resolve, reject }),
  );
}

// `track` builds the pending entry for the request's type; typing it per
// request type keeps the resolved value matched to the response.
function request<T>(
  build: (id: number) => ModJarWorkerRequest,
  track: (
    resolve: (value: T) => void,
    reject: (reason: unknown) => void,
  ) => Pending,
  transfer: Transferable[] = [],
): Promise<T> {
  if (worker === null) worker = createWorker();
  const w = worker;
  const id = nextId++;
  const message = build(id);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, track(resolve, reject));
    try {
      w.postMessage(message, transfer);
    } catch (err) {
      // e.g. DataCloneError for an already-detached buffer.
      pending.delete(id);
      reject(err);
    }
  });
}

/**
 * Terminate the active worker (if any) and reject every in-flight request.
 */
export function cancel(): void {
  discardWorker();
  rejectAllPending(new Error("Worker cancelled"));
}
