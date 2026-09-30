import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModJarWorkerRequest, ParseJarPayload } from "../mod-jar.worker";

type Listener = (event: unknown) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, Listener[]>();
  posted: { message: ModJarWorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  throwOnPost: Error | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: ModJarWorkerRequest, transfer: Transferable[]): void {
    if (this.throwOnPost !== null) throw this.throwOnPost;
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

async function loadClient() {
  vi.resetModules();
  return import("../mod-jar-client");
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseModJarInWorker", () => {
  it("ignores a stale error from a replaced worker", async () => {
    const { cancel, parseModJarInWorker } = await loadClient();
    const first = parseModJarInWorker(new Uint8Array([1]));
    cancel();
    await expect(first).rejects.toThrow("Worker cancelled");

    const second = parseModJarInWorker(new Uint8Array([2]));
    const [old, current] = FakeWorker.instances;
    old.emit("error", { message: "boom" });
    old.emit("messageerror");

    expect(current.terminated).toBe(false);
    const { id } = current.posted[0].message;
    current.emit("message", { data: { id, ok: false, error: "done" } });
    await expect(second).rejects.toThrow("done");
  });

  it("transfers a whole-buffer view without copying", async () => {
    const { parseModJarInWorker } = await loadClient();
    const bytes = new Uint8Array([1, 2, 3]);
    void parseModJarInWorker(bytes);

    const { message, transfer } = FakeWorker.instances[0].posted[0];
    const payload = message.payload as ParseJarPayload;
    expect(payload.bytes).toBe(bytes);
    expect(transfer).toEqual([bytes.buffer]);
  });

  it("copies a partial view so the shared buffer isn't detached", async () => {
    const { parseModJarInWorker } = await loadClient();
    const shared = new Uint8Array([1, 2, 3, 4]);
    void parseModJarInWorker(shared.subarray(1, 3));

    const { message, transfer } = FakeWorker.instances[0].posted[0];
    const payload = message.payload as ParseJarPayload;
    expect(payload.bytes).toEqual(new Uint8Array([2, 3]));
    expect(payload.bytes.buffer).not.toBe(shared.buffer);
    expect(transfer).toEqual([payload.bytes.buffer]);
  });

  it("computes appearances without transferring texture buffers", async () => {
    const { computeModAppearancesInWorker } = await loadClient();
    const input = {
      blockIds: ["a:x"],
      blockstates: {},
      models: {},
      textures: { "a:block/x": new Uint8Array([1]) },
      textureMeta: {},
    };
    const result = computeModAppearancesInWorker(input);

    const w = FakeWorker.instances[0];
    const { message, transfer } = w.posted[0];
    expect(message).toEqual({
      id: message.id,
      type: "computeAppearances",
      payload: input,
    });
    expect(transfer).toEqual([]);
    const done = { appearances: {}, complete: true };
    w.emit("message", {
      data: {
        id: message.id,
        ok: true,
        type: "computeAppearances",
        result: done,
      },
    });
    await expect(result).resolves.toBe(done);
  });

  it("rejects a response of the wrong type", async () => {
    const { parseModJarInWorker } = await loadClient();
    const result = parseModJarInWorker(new Uint8Array([1]));
    const w = FakeWorker.instances[0];
    w.emit("message", {
      data: {
        id: w.posted[0].message.id,
        ok: true,
        type: "computeAppearances",
        result: { appearances: {}, complete: true },
      },
    });
    await expect(result).rejects.toThrow(
      "Expected a parseJar response, got computeAppearances",
    );
  });

  it("rejects and forgets the request when postMessage throws", async () => {
    const { parseModJarInWorker } = await loadClient();
    const pending = parseModJarInWorker(new Uint8Array([1]));
    const w = FakeWorker.instances[0];

    w.throwOnPost = new Error("DataCloneError");
    await expect(parseModJarInWorker(new Uint8Array([2]))).rejects.toThrow(
      "DataCloneError",
    );

    // The earlier request is unaffected and still settles normally.
    w.emit("error", { message: "boom" });
    await expect(pending).rejects.toThrow("boom");
  });
});
