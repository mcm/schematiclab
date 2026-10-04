import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { convertSchematic, parseSchematic } from "../convert";
import { MAX_DECOMPRESSED_BYTES } from "../mcp/limits";
import {
  DecompressedTooLargeError,
  gunzipCapped,
  isGzip,
  loadNbtFromBytes,
} from "../schemlib/nbt";
import { gzipBomb } from "./oversized-schematics";

// Counts the inflations: one-shot `gunzipSync` calls and streaming `Gunzip`s.
const inflations = vi.hoisted(() => ({ sync: 0, streams: 0 }));

vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  class CountingGunzip extends actual.Gunzip {
    constructor(...args: ConstructorParameters<typeof actual.Gunzip>) {
      super(...args);
      inflations.streams++;
    }
  }
  return {
    ...actual,
    Gunzip: CountingGunzip,
    gunzipSync: (...args: Parameters<typeof actual.gunzipSync>) => {
      inflations.sync++;
      return actual.gunzipSync(...args);
    },
  };
});

const FIXTURES = path.join(__dirname, "fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

const gzippedFixtures = readdirSync(FIXTURES).filter((name) =>
  isGzip(fixture(name)),
);

// A gzip of zeros that inflates to twice the cap.
const BOMB_BYTES = 2 * MAX_DECOMPRESSED_BYTES;
let bomb: Uint8Array;

beforeAll(async () => {
  bomb = await gzipBomb(BOMB_BYTES);
});

beforeEach(() => {
  inflations.sync = 0;
  inflations.streams = 0;
});

describe("gunzipCapped", () => {
  it("inflates a file under the cap like gunzipSync", () => {
    const bytes = fixture("one_stone_block.litematic");
    const whole = gunzipCapped(bytes, Number.MAX_SAFE_INTEGER);
    expect(gunzipCapped(bytes, whole.length)).toEqual(whole);
    expect(() => gunzipCapped(bytes, whole.length - 1)).toThrow(
      DecompressedTooLargeError,
    );
  });

  it("stops a small gzip bomb soon after the cap, without inflating the rest", () => {
    expect(bomb.length).toBeLessThan(1024 * 1024);
    let error: unknown;
    try {
      gunzipCapped(bomb, MAX_DECOMPRESSED_BYTES);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DecompressedTooLargeError);
    const { inflatedBytes, maxBytes } = error as DecompressedTooLargeError;
    expect(maxBytes).toBe(MAX_DECOMPRESSED_BYTES);
    expect(inflatedBytes).toBeGreaterThan(MAX_DECOMPRESSED_BYTES);
    // One 16 KB input chunk inflates to at most ~16.5 MB.
    expect(inflatedBytes).toBeLessThan(MAX_DECOMPRESSED_BYTES + 17 * 1024 ** 2);
    expect(inflatedBytes).toBeLessThan(BOMB_BYTES);
    expect((error as Error).message).toBe(
      "This schematic decompresses to more than 134,217,728 bytes, the most this server handles.",
    );
  });

  it("is what loadNbtFromBytes uses when given a cap", () => {
    expect(() =>
      loadNbtFromBytes(bomb, { maxDecompressedBytes: MAX_DECOMPRESSED_BYTES }),
    ).toThrow(DecompressedTooLargeError);
    expect(inflations.sync).toBe(0);
  });
});

describe("MAX_DECOMPRESSED_BYTES", () => {
  it("fits a 2,000,000-block Structure file, the bulkiest format per block", () => {
    // Per block: a compound with `pos` (list of 3 ints) and `state` (int).
    const perBlock = 1 + (1 + 2 + 3 + 1 + 4 + 12) + (1 + 2 + 5 + 4);
    expect(perBlock * 2_000_000).toBeLessThan(MAX_DECOMPRESSED_BYTES * 0.6);
  });
});

describe("parseSchematic with maxDecompressedBytes", () => {
  it("fails on a gzip bomb with the cap's error", () => {
    const result = parseSchematic(bomb, {
      maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cause).toBeInstanceOf(DecompressedTooLargeError);
    expect(result.error).toBe((result.cause as Error).message);
    expect(inflations.sync).toBe(0);
    expect(inflations.streams).toBe(1);
  });

  it.each(gzippedFixtures)(
    "inflates %s once for detection and loading",
    (name) => {
      const bytes = fixture(name);
      const uncapped = parseSchematic(bytes);
      expect(inflations.sync).toBeGreaterThanOrEqual(2);

      inflations.sync = 0;
      const capped = parseSchematic(bytes, {
        maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
      });
      expect(inflations).toEqual({ sync: 0, streams: 1 });
      expect(capped).toEqual(uncapped);
    },
  );

  it("caps the gzipped body of a Building Gadgets v1 file", () => {
    const bytes = fixture("one_stone_block_bg1.txt");
    expect(parseSchematic(bytes).ok).toBe(true);
    const result = parseSchematic(bytes, { maxDecompressedBytes: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(
      "decompresses to more than 10 bytes, the most this server handles.",
    );
  });

  it("fails on invalid gzip without inflating it again uncapped", () => {
    const broken = new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4, 5]);
    const result = parseSchematic(broken, {
      maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^Could not decompress the schematic: /);
    expect(inflations.sync).toBe(0);
  });
});

describe("convertSchematic with loadOptions", () => {
  it("fails on a gzip bomb with the cap's error", () => {
    const result = convertSchematic({
      bytes: bomb,
      inputFilename: "bomb.nbt",
      outputFormat: "Sponge[v2]",
      loadOptions: { maxDecompressedBytes: MAX_DECOMPRESSED_BYTES },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cause).toBeInstanceOf(DecompressedTooLargeError);
    expect(inflations).toEqual({ sync: 0, streams: 1 });
  });

  it("inflates the input once, capped, and converts it as before", () => {
    const options = {
      bytes: fixture("one_stone_block.litematic"),
      inputFilename: "one_stone_block.litematic",
      outputFormat: "Sponge[v2]",
    } as const;
    const uncapped = convertSchematic(options);
    inflations.sync = 0;
    inflations.streams = 0;
    const capped = convertSchematic({
      ...options,
      loadOptions: { maxDecompressedBytes: MAX_DECOMPRESSED_BYTES },
    });
    // The output is gzipped, not inflated.
    expect(inflations).toEqual({ sync: 0, streams: 1 });
    expect(capped).toEqual(uncapped);
  });
});
